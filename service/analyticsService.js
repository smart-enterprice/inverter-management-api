// service/analyticsService.js
//
// Read-only aggregations for dashboard charts and KPIs.
// All pipelines start with a $match on indexed fields (created_at, dealer_id,
// salesman_id, status) so they stay fast as the collection grows.

import asyncHandler from "express-async-handler";

import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";

import { BadRequestException, ForbiddenException } from "../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import { DEFAULT_SALESMAN_TARGET_QTY, ORDER_STATUSES, ROLES } from "../utils/constants.js";

const MAX_LIMIT = 100;
const DEFAULT_TOP_N = 10;

// Money math used everywhere in this file.
//
// Source of truth (per order_details row, snapshotted at order-creation time so
// price/cost hikes after the fact do NOT rewrite history):
//   - qty_ordered          : original ordered quantity (never decreases)
//   - qty_delivered        : cumulative delivered
//   - total_cancelled_qty  : cumulative cancelled (kept correct by orderService)
//   - unit_product_price   : list price per unit at the time of order
//   - dealer_discount      : per-unit discount applied for this order
//   - is_free              : true for scheme/freebie lines (excluded from money)
//
// Net unit price = unit_product_price − dealer_discount → actual rupees per unit.
// "Revenue" anywhere in this file means NET (after discount). Gross numbers are
// not surfaced because the dealer never owes the gross — the discount is baked
// into the order at creation and doesn't move later.
//
// Honest revenue meanings:
//   revenue_booked    = SUM(qty_ordered          × net_unit_price)  // contracted
//   revenue_delivered = SUM(qty_delivered        × net_unit_price)  // realised
//   revenue_cancelled = SUM(total_cancelled_qty  × net_unit_price)  // fell off
//   revenue_pending   = booked − delivered − cancelled               // still owed
//
// All money sums skip is_free lines.

// Net unit price expression for pipelines that operate on `orderdetails` docs.
const NET_UNIT_PRICE = {
    $subtract: [
        { $ifNull: ["$unit_product_price", 0] },
        { $ifNull: ["$dealer_discount", 0] },
    ],
};

// Net unit price expression for $reduce loops over a $lookup-joined details
// array (current detail bound to $$this).
const REDUCE_NET_UNIT_PRICE = {
    $subtract: [
        { $ifNull: ["$$this.unit_product_price", 0] },
        { $ifNull: ["$$this.dealer_discount", 0] },
    ],
};

// $reduce helper: SUM(qty × net_unit_price) over a $lookup'ed `details` array,
// skipping is_free lines. `qtyField` is the orderDetails field name as a
// string, e.g. "qty_ordered", "qty_delivered", "total_cancelled_qty".
const reduceNetRevenueByQty = (qtyField) => ({
    $reduce: {
        input: "$details",
        initialValue: 0,
        in: {
            $add: [
                "$$value",
                {
                    $cond: [
                        { $ne: ["$$this.is_free", true] },
                        {
                            $multiply: [
                                { $ifNull: [`$$this.${qtyField}`, 0] },
                                REDUCE_NET_UNIT_PRICE,
                            ],
                        },
                        0,
                    ],
                },
            ],
        },
    },
});

// Money split model:
//   Booked    = total ever ordered, in money
//   Delivered = of Booked, actually shipped
//   Cancelled = of Booked, fell off while order was active (partial or full cancel)
//   Rejected  = of Booked, parent order was rejected outright
//   Pending   = Booked − Delivered − Cancelled − Rejected   (= still to ship & bill)
//
// Cancellation qty is tracked on the order_detail itself, so we attribute it to
// "Cancelled" or "Rejected" based on the *parent order's* status.
const isParentRejectedExpr = { $eq: ["$status", ORDER_STATUSES.REJECTED] };

// Build a "qty × per-unit-amount, only if not is_free, split by parent
// rejected/not" pair. Used in Order aggregations after $lookup → $unwind of
// details. `qtyField` is the orderDetails qty (e.g. "total_cancelled_qty"),
// `perUnitExpr` is the per-unit money expression (e.g. NET_UNIT_PRICE_DETAILS).
const buildCancellationSplit = (qtyField, perUnitExpr) => {
    const lineValue = {
        $cond: [
            { $ne: ["$details.is_free", true] },
            { $multiply: [{ $ifNull: [`$details.${qtyField}`, 0] }, perUnitExpr] },
            0,
        ],
    };
    return {
        cancelled: { $cond: [isParentRejectedExpr, 0, lineValue] },
        rejected:  { $cond: [isParentRejectedExpr, lineValue, 0] },
    };
};

// Money expressions usable AFTER `$unwind: "$details"` (details fields are
// addressed as $details.xxx, not $$this.xxx).
const NET_UNIT_PRICE_DETAILS = {
    $subtract: [
        { $ifNull: ["$details.unit_product_price", 0] },
        { $ifNull: ["$details.dealer_discount", 0] },
    ],
};
const GROSS_UNIT_PRICE_DETAILS = { $ifNull: ["$details.unit_product_price", 0] };
const DISCOUNT_UNIT_DETAILS = { $ifNull: ["$details.dealer_discount", 0] };
// Profit per unit = net selling price − snapshotted cost-at-order-time.
// Cost is taken from the orderDetails snapshot, NOT the live product, so a
// later cost hike on the product master never rewrites historical profit.
const PROFIT_UNIT_DETAILS = {
    $subtract: [NET_UNIT_PRICE_DETAILS, { $ifNull: ["$details.unit_product_cost", 0] }],
};

// Single-doc variants for OrderDetails pipelines (no $unwind).
const NET_UNIT_PRICE_DOC = {
    $subtract: [
        { $ifNull: ["$unit_product_price", 0] },
        { $ifNull: ["$dealer_discount", 0] },
    ],
};
const PROFIT_UNIT_DOC = {
    $subtract: [NET_UNIT_PRICE_DOC, { $ifNull: ["$unit_product_cost", 0] }],
};

// $reduce-flavored variants ($$this.xxx).
const REDUCE_PROFIT_UNIT = {
    $subtract: [
        REDUCE_NET_UNIT_PRICE,
        { $ifNull: ["$$this.unit_product_cost", 0] },
    ],
};

// $reduce helper: SUM(qty × per-unit-expr) over the lookup'ed details array,
// skipping is_free lines. Generic version of reduceNetRevenueByQty.
const reduceSumByQty = (qtyField, perUnitExpr) => ({
    $reduce: {
        input: "$details",
        initialValue: 0,
        in: {
            $add: [
                "$$value",
                {
                    $cond: [
                        { $ne: ["$$this.is_free", true] },
                        { $multiply: [{ $ifNull: [`$$this.${qtyField}`, 0] }, perUnitExpr] },
                        0,
                    ],
                },
            ],
        },
    },
});

// Analytics access is restricted to these three roles only.
// Sales team / dealers / accounts / production / packing / delivery / supervisor
// don't see analytics — frontend hides the page, backend returns 403.
const ANALYTICS_ALLOWED_ROLES = new Set([
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.MANAGER,
]);

// Profit (cost-sensitive number) is restricted further — managers see revenue
// but NOT profit. Only super-admin and admin see profit fields.
const PROFIT_VISIBLE_ROLES = new Set([
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
]);

const callerCanSeeProfit = () => {
    const { employeeRole } = getAuthenticatedEmployeeContext();
    return PROFIT_VISIBLE_ROLES.has(employeeRole);
};

const parseDate = (value, label) => {
    if (!value) throw new BadRequestException(`${label} is required (ISO date).`);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`${label} is not a valid date.`);
    }
    return d;
};

const parseLimit = (value, fallback = DEFAULT_TOP_N) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, MAX_LIMIT);
};

// Build a $match stage scoped to the caller's role.
// - Admin-tier roles see everything (optionally filtered by dealer_id / salesman_id).
// - Salesmen are forced to their own salesman_id.
// - Dealers are forced to their own dealer_id.
// - Other roles are forbidden from analytics.
const buildScopedMatch = ({ from, to, dealer_id, salesman_id }) => {
    const { employeeRole } = getAuthenticatedEmployeeContext();

    if (!ANALYTICS_ALLOWED_ROLES.has(employeeRole)) {
        throw new ForbiddenException("Analytics is not available for your role.");
    }

    const match = {
        created_at: { $gte: from, $lte: to },
    };

    // Admin-tier may optionally narrow by dealer or salesman.
    if (dealer_id) match.dealer_id = String(dealer_id);
    if (salesman_id) match.salesman_id = String(salesman_id);

    return match;
};

const analyticsService = {

    // KPI summary + status distribution for the dashboard header.
    //
    // Money split (all NET of dealer discount):
    //   Booked    = SUM(qty_ordered         × net_unit_price)  every order ever placed
    //   Delivered = SUM(qty_delivered       × net_unit_price)  shipped portion
    //   Cancelled = SUM(cancelled_qty × net) where parent.status ≠ REJECTED
    //   Rejected  = SUM(cancelled_qty × net) where parent.status = REJECTED
    //   Pending   = Booked − Delivered − Cancelled − Rejected  still to ship & bill
    //
    // Identity: Booked = Delivered + Pending + Cancelled + Rejected (always).
    //
    // Cash flow (proper accounts-receivable view):
    //   Paid    = SUM(Order.amount_paid)                                    cash actually collected
    //   Due     = SUM_per_order( max(0, order_delivered_value − paid) )     cash owed on delivered units
    //   Advance = SUM_per_order( max(0, paid − order_delivered_value) )     cash collected ahead of delivery
    //
    // Why per-order max(0, ...): if Dealer A overpaid (advance) and Dealer B
    // underpaid (due), system Due = B's underpayment, NOT the net of both.
    // Computing max(0,...) per order then summing keeps the two sides separate.
    getSummary: asyncHandler(async ({ from, to, dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const match = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        // 1. Order-level aggregation: counts, status, and proper cash math.
        //    Due / Advance are computed per-order against actually-delivered
        //    revenue (not against the legacy Order.amount_due, which counts
        //    pending units as if already owed).
        const [orderAgg = {}] = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    order_revenue_delivered: reduceNetRevenueByQty("qty_delivered"),
                },
            },
            {
                $addFields: {
                    order_cash_due: {
                        $max: [0, { $subtract: ["$order_revenue_delivered", { $ifNull: ["$amount_paid", 0] }] }],
                    },
                    order_cash_advance: {
                        $max: [0, { $subtract: [{ $ifNull: ["$amount_paid", 0] }, "$order_revenue_delivered"] }],
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    orders_total: { $sum: 1 },
                    revenue_paid: { $sum: { $ifNull: ["$amount_paid", 0] } },
                    revenue_due: { $sum: "$order_cash_due" },
                    revenue_advance: { $sum: "$order_cash_advance" },
                    orders_delivered: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.DELIVERED] }, 1, 0] },
                    },
                    orders_completed: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.COMPLETED] }, 1, 0] },
                    },
                    orders_cancelled: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.CANCELLED] }, 1, 0] },
                    },
                    orders_rejected: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.REJECTED] }, 1, 0] },
                    },
                    statuses: { $push: "$status" },
                    order_numbers: { $push: "$order_number" },
                },
            },
        ]);

        // 2. Revenue split — join Order → details so we can attribute the
        //    cancelled qty to "Cancelled" vs "Rejected" based on the parent
        //    order's status. is_free scheme lines are excluded from money.
        const orderNumbers = orderAgg.order_numbers || [];
        let revenue_booked = 0;
        let revenue_delivered = 0;
        let revenue_cancelled = 0;
        let revenue_rejected = 0;
        let revenue_booked_gross = 0;
        let discount_booked = 0;
        let discount_delivered = 0;
        let discount_cancelled = 0;
        let discount_rejected = 0;
        let profit_booked = 0;
        let profit_delivered = 0;

        if (orderNumbers.length > 0) {
            const cancelSplitNet = buildCancellationSplit("total_cancelled_qty", NET_UNIT_PRICE_DETAILS);
            const cancelSplitDiscount = buildCancellationSplit("total_cancelled_qty", DISCOUNT_UNIT_DETAILS);

            const [revAgg = {}] = await Order.aggregate([
                { $match: match },
                {
                    $lookup: {
                        from: "orderdetails",
                        localField: "order_number",
                        foreignField: "order_number",
                        as: "details",
                    },
                },
                { $unwind: { path: "$details", preserveNullAndEmptyArrays: false } },
                { $match: { "details.is_free": { $ne: true } } },
                {
                    $group: {
                        _id: null,
                        revenue_booked: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_ordered", 0] }, NET_UNIT_PRICE_DETAILS] },
                        },
                        revenue_delivered: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_delivered", 0] }, NET_UNIT_PRICE_DETAILS] },
                        },
                        revenue_cancelled: { $sum: cancelSplitNet.cancelled },
                        revenue_rejected:  { $sum: cancelSplitNet.rejected },
                        revenue_booked_gross: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_ordered", 0] }, GROSS_UNIT_PRICE_DETAILS] },
                        },
                        discount_booked: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_ordered", 0] }, DISCOUNT_UNIT_DETAILS] },
                        },
                        discount_delivered: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_delivered", 0] }, DISCOUNT_UNIT_DETAILS] },
                        },
                        discount_cancelled: { $sum: cancelSplitDiscount.cancelled },
                        discount_rejected:  { $sum: cancelSplitDiscount.rejected },
                        profit_booked: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_ordered", 0] }, PROFIT_UNIT_DETAILS] },
                        },
                        profit_delivered: {
                            $sum: { $multiply: [{ $ifNull: ["$details.qty_delivered", 0] }, PROFIT_UNIT_DETAILS] },
                        },
                    },
                },
            ]);
            revenue_booked = revAgg.revenue_booked || 0;
            revenue_delivered = revAgg.revenue_delivered || 0;
            revenue_cancelled = revAgg.revenue_cancelled || 0;
            revenue_rejected = revAgg.revenue_rejected || 0;
            revenue_booked_gross = revAgg.revenue_booked_gross || 0;
            discount_booked = revAgg.discount_booked || 0;
            discount_delivered = revAgg.discount_delivered || 0;
            discount_cancelled = revAgg.discount_cancelled || 0;
            discount_rejected = revAgg.discount_rejected || 0;
            profit_booked = revAgg.profit_booked || 0;
            profit_delivered = revAgg.profit_delivered || 0;
        }

        const revenue_pending = Math.max(
            0,
            revenue_booked - revenue_delivered - revenue_cancelled - revenue_rejected
        );

        const status_distribution = Object.values(ORDER_STATUSES)
            .reduce((acc, s) => { acc[s] = 0; return acc; }, {});

        for (const s of orderAgg.statuses || []) {
            if (status_distribution[s] !== undefined) status_distribution[s] += 1;
        }

        return {
            range: { from: fromDate, to: toDate },
            orders_total: orderAgg.orders_total || 0,
            orders_delivered: orderAgg.orders_delivered || 0,
            orders_completed: orderAgg.orders_completed || 0,
            orders_cancelled: orderAgg.orders_cancelled || 0,
            orders_rejected: orderAgg.orders_rejected || 0,
            revenue_booked,
            revenue_delivered,
            revenue_pending,
            revenue_cancelled,
            revenue_rejected,
            revenue_booked_gross,
            discount_booked,
            discount_delivered,
            discount_cancelled,
            discount_rejected,
            ...(callerCanSeeProfit() ? { profit_booked, profit_delivered } : {}),
            revenue_paid: orderAgg.revenue_paid || 0,
            revenue_due: orderAgg.revenue_due || 0,
            revenue_advance: orderAgg.revenue_advance || 0,
            status_distribution,
        };
    }),

    // Time-series for the main line chart.
    getSalesTrend: asyncHandler(async ({ from, to, interval = "day", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const formatByInterval = {
            day: "%Y-%m-%d",
            week: "%G-W%V",
            month: "%Y-%m",
        };
        const fmt = formatByInterval[interval];
        if (!fmt) {
            throw new BadRequestException("interval must be one of: day, week, month.");
        }

        const match = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        // Per-bucket series, all NET of dealer discount, all skipping is_free.
        // Cancelled is split from Rejected by the parent order's status so the
        // chart can show all four buckets distinctly.
        //   revenue   = booked    = SUM(qty_ordered          × net_unit_price)
        //   delivered = delivered = SUM(qty_delivered        × net_unit_price)
        //   cancelled = SUM(cancelled_qty × net)  where order.status ≠ REJECTED
        //   rejected  = SUM(cancelled_qty × net)  where order.status = REJECTED
        //   paid      = from Order.amount_paid (payments collected)
        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    revenue_booked: reduceNetRevenueByQty("qty_ordered"),
                    revenue_delivered: reduceNetRevenueByQty("qty_delivered"),
                    revenue_lost: reduceNetRevenueByQty("total_cancelled_qty"),
                },
            },
            {
                $addFields: {
                    revenue_cancelled: {
                        $cond: [isParentRejectedExpr, 0, "$revenue_lost"],
                    },
                    revenue_rejected: {
                        $cond: [isParentRejectedExpr, "$revenue_lost", 0],
                    },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: fmt, date: "$created_at", timezone: "Asia/Kolkata" } },
                    orders: { $sum: 1 },
                    revenue: { $sum: "$revenue_booked" },
                    delivered: { $sum: "$revenue_delivered" },
                    cancelled: { $sum: "$revenue_cancelled" },
                    rejected: { $sum: "$revenue_rejected" },
                    paid: { $sum: "$amount_paid" },
                },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1, delivered: 1, cancelled: 1, rejected: 1, paid: 1 } },
        ]);

        return { interval, series: rows };
    }),

    // Top-N products. `view`:
    //   "delivered" (default) — qty/revenue/profit from qty_delivered only
    //   "booked"              — qty/revenue/profit from qty_ordered (all booked, incl. pending/cancelled)
    //
    // Profit uses the snapshotted unit_product_cost on each detail, so it
    // reflects cost-at-order-time, not the current product master cost.
    // Profit is hidden (and metric=profit rejected) for non-admin callers.
    getTopProducts: asyncHandler(async ({ from, to, limit, metric = "revenue", view = "delivered", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }
        if (!["revenue", "qty", "profit"].includes(metric)) {
            throw new BadRequestException("metric must be 'revenue', 'qty', or 'profit'.");
        }
        if (!["delivered", "booked"].includes(view)) {
            throw new BadRequestException("view must be 'delivered' or 'booked'.");
        }

        const showProfit = callerCanSeeProfit();
        if (metric === "profit" && !showProfit) {
            throw new ForbiddenException("Profit metric is not available for your role.");
        }

        const cap = parseLimit(limit);
        const qtyField = view === "booked" ? "qty_ordered" : "qty_delivered";

        const orderMatch = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });
        const scopedOrderNumbers = await Order.find(orderMatch).distinct("order_number");

        if (scopedOrderNumbers.length === 0) {
            return { metric, view, items: [] };
        }

        const sortField = metric === "qty" ? "qty_sold" : metric;

        // qty_sold = SUM(qty)                               — units in the chosen view
        // revenue  = SUM(qty × net_unit_price)              — NET revenue (price − discount)
        // profit   = SUM(qty × (net_unit_price − unit_cost)) — using snapshotted cost
        const rows = await OrderDetails.aggregate([
            { $match: { order_number: { $in: scopedOrderNumbers }, is_free: { $ne: true } } },
            {
                $group: {
                    _id: "$product_id",
                    product_name: { $first: "$product_name" },
                    product_brand: { $first: "$product_brand" },
                    product_model: { $first: "$product_model" },
                    qty_sold: { $sum: { $ifNull: [`$${qtyField}`, 0] } },
                    revenue: { $sum: { $multiply: [{ $ifNull: [`$${qtyField}`, 0] }, NET_UNIT_PRICE] } },
                    profit:  { $sum: { $multiply: [{ $ifNull: [`$${qtyField}`, 0] }, PROFIT_UNIT_DOC] } },
                },
            },
            { $sort: { [sortField]: -1 } },
            { $limit: cap },
            {
                $project: {
                    _id: 0,
                    product_id: "$_id",
                    product_name: 1,
                    product_brand: 1,
                    product_model: 1,
                    qty_sold: 1,
                    revenue: 1,
                    profit: 1,
                },
            },
        ]);

        const items = showProfit ? rows : rows.map(({ profit, ...rest }) => rest);
        return { metric, view, items };
    }),

    // Top-N dealers. `view`:
    //   "delivered" (default) — revenue / profit from delivered units only
    //   "booked"              — revenue / profit from all booked units
    // Due is ALWAYS computed as max(0, delivered − paid) per order — the
    // "real" cash a dealer still owes us on goods we've actually shipped.
    // It does not depend on the view toggle.
    getTopDealers: asyncHandler(async ({ from, to, limit, view = "delivered", salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }
        if (!["delivered", "booked"].includes(view)) {
            throw new BadRequestException("view must be 'delivered' or 'booked'.");
        }

        const cap = parseLimit(limit);
        const qtyField = view === "booked" ? "qty_ordered" : "qty_delivered";

        const match = buildScopedMatch({ from: fromDate, to: toDate, salesman_id });

        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    order_revenue:           reduceSumByQty(qtyField,        REDUCE_NET_UNIT_PRICE),
                    order_profit:            reduceSumByQty(qtyField,        REDUCE_PROFIT_UNIT),
                    order_revenue_delivered: reduceNetRevenueByQty("qty_delivered"),
                },
            },
            {
                $addFields: {
                    order_cash_due: {
                        $max: [0, { $subtract: ["$order_revenue_delivered", { $ifNull: ["$amount_paid", 0] }] }],
                    },
                    order_cash_advance: {
                        $max: [0, { $subtract: [{ $ifNull: ["$amount_paid", 0] }, "$order_revenue_delivered"] }],
                    },
                },
            },
            {
                $group: {
                    _id: "$dealer_id",
                    orders_count: { $sum: 1 },
                    revenue: { $sum: "$order_revenue" },
                    profit:  { $sum: "$order_profit" },
                    paid:    { $sum: { $ifNull: ["$amount_paid", 0] } },
                    due:     { $sum: "$order_cash_due" },
                    advance: { $sum: "$order_cash_advance" },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: cap },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "dealer",
                },
            },
            { $unwind: { path: "$dealer", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    dealer_id: "$_id",
                    dealer_name: "$dealer.employee_name",
                    shop_name: "$dealer.shop_name",
                    district: "$dealer.district",
                    orders_count: 1,
                    revenue: 1,
                    profit: 1,
                    paid: 1,
                    due: 1,
                    advance: 1,
                },
            },
        ]);

        const items = callerCanSeeProfit() ? rows : rows.map(({ profit, ...rest }) => rest);
        return { view, items };
    }),

    // Top-N brands. Same `view` semantics as getTopProducts.
    getTopBrands: asyncHandler(async ({ from, to, limit, metric = "qty", view = "delivered", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }
        if (!["revenue", "qty", "profit"].includes(metric)) {
            throw new BadRequestException("metric must be 'revenue', 'qty', or 'profit'.");
        }
        if (!["delivered", "booked"].includes(view)) {
            throw new BadRequestException("view must be 'delivered' or 'booked'.");
        }

        const showProfit = callerCanSeeProfit();
        if (metric === "profit" && !showProfit) {
            throw new ForbiddenException("Profit metric is not available for your role.");
        }

        const cap = parseLimit(limit);
        const qtyField = view === "booked" ? "qty_ordered" : "qty_delivered";

        const orderMatch = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });
        const scopedOrderNumbers = await Order.find(orderMatch).distinct("order_number");
        if (scopedOrderNumbers.length === 0) {
            return { metric, view, items: [] };
        }

        const sortField = metric === "qty" ? "qty_sold" : metric;

        const rows = await OrderDetails.aggregate([
            {
                $match: {
                    order_number: { $in: scopedOrderNumbers },
                    is_free: { $ne: true },
                },
            },
            {
                $group: {
                    _id: "$product_brand",
                    qty_sold: { $sum: { $ifNull: [`$${qtyField}`, 0] } },
                    revenue: { $sum: { $multiply: [{ $ifNull: [`$${qtyField}`, 0] }, NET_UNIT_PRICE] } },
                    profit:  { $sum: { $multiply: [{ $ifNull: [`$${qtyField}`, 0] }, PROFIT_UNIT_DOC] } },
                    orders: { $addToSet: "$order_number" },
                },
            },
            {
                $project: {
                    _id: 0,
                    product_brand: "$_id",
                    qty_sold: 1,
                    revenue: 1,
                    profit: 1,
                    orders_count: { $size: "$orders" },
                },
            },
            { $sort: { [sortField]: -1 } },
            { $limit: cap },
        ]);

        const items = showProfit ? rows : rows.map(({ profit, ...rest }) => rest);
        return { metric, view, items };
    }),

    // Top-N salesmen. Same `view` semantics as getTopDealers.
    getTopSalesmen: asyncHandler(async ({ from, to, limit, view = "delivered", dealer_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }
        if (!["delivered", "booked"].includes(view)) {
            throw new BadRequestException("view must be 'delivered' or 'booked'.");
        }

        const cap = parseLimit(limit);
        const qtyField = view === "booked" ? "qty_ordered" : "qty_delivered";

        const match = buildScopedMatch({ from: fromDate, to: toDate, dealer_id });

        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    order_revenue:           reduceSumByQty(qtyField,        REDUCE_NET_UNIT_PRICE),
                    order_profit:            reduceSumByQty(qtyField,        REDUCE_PROFIT_UNIT),
                    order_revenue_delivered: reduceNetRevenueByQty("qty_delivered"),
                },
            },
            {
                $addFields: {
                    order_cash_due: {
                        $max: [0, { $subtract: ["$order_revenue_delivered", { $ifNull: ["$amount_paid", 0] }] }],
                    },
                    order_cash_advance: {
                        $max: [0, { $subtract: [{ $ifNull: ["$amount_paid", 0] }, "$order_revenue_delivered"] }],
                    },
                },
            },
            {
                $group: {
                    _id: "$salesman_id",
                    orders_count: { $sum: 1 },
                    revenue: { $sum: "$order_revenue" },
                    profit:  { $sum: "$order_profit" },
                    paid:    { $sum: { $ifNull: ["$amount_paid", 0] } },
                    due:     { $sum: "$order_cash_due" },
                    advance: { $sum: "$order_cash_advance" },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: cap },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "salesman",
                },
            },
            { $unwind: { path: "$salesman", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    salesman_id: "$_id",
                    salesman_name: "$salesman.employee_name",
                    district: "$salesman.district",
                    orders_count: 1,
                    revenue: 1,
                    profit: 1,
                    paid: 1,
                    due: 1,
                    advance: 1,
                },
            },
        ]);

        const items = callerCanSeeProfit() ? rows : rows.map(({ profit, ...rest }) => rest);
        return { view, items };
    }),

    // Salesman target vs achievement, measured AFTER delivery.
    // Target   = (per-salesman target when configured) || DEFAULT_SALESMAN_TARGET_QTY.
    // Achieved = SUM(qty_delivered) across the salesman's orders (units actually shipped).
    //            Booked-but-not-delivered or cancelled units don't count. is_free lines excluded.
    // Revenue  = SUM(qty_delivered × net_unit_price) — NET delivered revenue.
    getSalesmanAchievement: asyncHandler(async ({ from, to, dealer_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const match = buildScopedMatch({ from: fromDate, to: toDate, dealer_id });

        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            { $unwind: { path: "$details", preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    "details.delivered_qty": {
                        $cond: [
                            { $ne: ["$details.is_free", true] },
                            { $ifNull: ["$details.qty_delivered", 0] },
                            0,
                        ],
                    },
                    "details.net_unit_price": NET_UNIT_PRICE_DETAILS,
                },
            },
            {
                $group: {
                    _id: "$salesman_id",
                    achieved_qty: { $sum: "$details.delivered_qty" },
                    orders_set: { $addToSet: "$order_number" },
                    revenue: {
                        $sum: { $multiply: ["$details.delivered_qty", "$details.net_unit_price"] },
                    },
                },
            },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "salesman",
                },
            },
            { $unwind: { path: "$salesman", preserveNullAndEmptyArrays: true } },
            { $sort: { achieved_qty: -1 } },
            {
                $project: {
                    _id: 0,
                    salesman_id: "$_id",
                    salesman_name: "$salesman.employee_name",
                    salesman_assigned_target: "$salesman.assignedTarget",
                    achieved_qty: 1,
                    orders_count: { $size: "$orders_set" },
                    revenue: 1,
                },
            },
        ]);

        const items = rows.map((r) => {
            const assigned = Number(r.salesman_assigned_target) || 0;
            const usesAssigned = assigned > 0;
            const target_qty = usesAssigned ? assigned : DEFAULT_SALESMAN_TARGET_QTY;

            return {
                salesman_id: r.salesman_id,
                salesman_name: r.salesman_name || "—",
                target_qty,
                target_source: usesAssigned ? "assigned" : "default",
                achieved_qty: r.achieved_qty || 0,
                achievement_pct: target_qty > 0
                    ? Number(((r.achieved_qty / target_qty) * 100).toFixed(1))
                    : 0,
                orders_count: r.orders_count || 0,
                revenue: r.revenue || 0,
            };
        });

        return {
            default_target_qty: DEFAULT_SALESMAN_TARGET_QTY,
            items,
        };
    }),

};

export default analyticsService;
