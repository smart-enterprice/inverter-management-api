import Employee from "../../models/employees.js";
import OrderDetails from "../../models/orderDetails.js";
import { ORDER_STATUSES, ROLES, getISTDate } from "../../utils/constants.js";
import { round } from "../../utils/validationUtils.js";
import { NOTIFIABLE_TARGET_STATUSES } from "./orderStatus.js";

export const fetchDealerAndOrderDetails = async (orders = []) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        return { dealerMap: {}, detailsMap: {} };
    }

    const dealerIds = [...new Set(orders.map(o => o.dealer_id))];
    const orderNumbers = orders.map(o => o.order_number);

    const [dealers, orderDetails] = await Promise.all([
        Employee.find({
            employee_id: { $in: dealerIds },
            role: ROLES.DEALER
        }).lean(),

        OrderDetails.find({
            order_number: { $in: orderNumbers }
        }).lean()
    ]);

    const dealerMap = dealers.reduce((map, dealer) => {
        map[dealer.employee_id] = dealer;
        return map;
    }, {});

    const detailsMap = orderDetails.reduce((map, detail) => {
        if (!map[detail.order_number]) {
            map[detail.order_number] = [];
        }
        map[detail.order_number].push(detail);
        return map;
    }, {});

    return { dealerMap, detailsMap };
};

export const toNumberSafe = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const appendOrderNote = (orderDetail, note) => {
    orderDetail.notes = [orderDetail.notes, note].filter(Boolean).join(" | ");
};

// total_price / total_product_price / total_dealer_discount on order-details
// are the "remaining-to-bill" balance, not the originally-booked total.
// Balance qty = ordered − delivered − cancelled.
export const recalculateOrderDetailPricing = (detail) => {
    const qtyOrdered = toNumberSafe(detail.qty_ordered);
    const qtyDelivered = toNumberSafe(detail.qty_delivered);
    const qtyCancelled = toNumberSafe(detail.total_cancelled_qty);
    const unitPrice = toNumberSafe(detail.unit_product_price);
    const unitDiscount = toNumberSafe(detail.dealer_discount);

    const balanceQty = Math.max(0, qtyOrdered - qtyDelivered - qtyCancelled);

    detail.total_product_price = round(unitPrice * balanceQty);
    detail.total_dealer_discount = round(unitDiscount * balanceQty);
    detail.total_price = round(detail.total_product_price - detail.total_dealer_discount);
};

// Mark the entire remaining (non-delivered, non-cancelled) qty of an
// order-detail as cancelled. Mirrors the per-qty cancel path used in
// updateOrderDetailStatus so analytics, audit trail, and pricing stay
// consistent when an order is cancelled/rejected as a whole.
//
// Returns the qty that was cancelled (0 if nothing was left to cancel).
export const cancelRemainingQtyForDetail = (
    detail,
    { employeeId, employeeRole, reason } = {}
) => {
    const qtyOrdered = toNumberSafe(detail.qty_ordered);
    const qtyDelivered = toNumberSafe(detail.qty_delivered);
    const qtyAlreadyCancelled = toNumberSafe(detail.total_cancelled_qty);

    const remaining = Math.max(0, qtyOrdered - qtyDelivered - qtyAlreadyCancelled);
    if (remaining <= 0) return 0;

    detail.total_cancelled_qty = qtyAlreadyCancelled + remaining;

    detail.cancellation_history = detail.cancellation_history || [];
    detail.cancellation_history.push({
        cancelled_qty: remaining,
        cancelled_by: employeeId || "SYSTEM",
        cancelled_by_role: employeeRole || "SYSTEM",
        cancelled_at: getISTDate(),
        reason: reason || "Order cancelled",
    });

    recalculateOrderDetailPricing(detail);

    return remaining;
};

export const buildDateRange = (startDate, endDate) => {
    if (!startDate && !endDate) return undefined;

    const range = {};

    if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        range.$gte = start;
    }

    if (endDate || startDate) {
        const end = new Date(endDate || startDate);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }

    return range;
};

// fire notification as non-blocking operation
export const fireNotification = (promise) => {
    Promise.resolve(promise).catch((err) =>
        logger.error("[Notification] Background dispatch failed:", err.message)
    );
};

// Returns true when the status transition should emit a notification.
export const shouldNotifyStatusChange = (prevStatus, newStatus) => {
    return prevStatus !== newStatus && NOTIFIABLE_TARGET_STATUSES.has(newStatus);
};