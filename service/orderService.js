// service/orderService.js
import asyncHandler from "express-async-handler";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import logger from "../utils/logger.js";
import Employee from "../models/employees.js";
import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";
import DealerDiscount from "../models/dealerDiscount.js";

import { generateUniqueOrderDetailsId, generateUniqueOrderId } from "../utils/generatorIds.js";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext, isValidTransition, normalizePrice, sanitizeInput } from "../utils/validationUtils.js";

import { APPROVAL_GRANTED_ROLES, getISTDate, ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES, STOCK_ACTIONS, STOCK_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, CANCELLABLE_STATUSES, ADMIN_PRIVILEGED_ROLES } from "../utils/constants.js";
import { mapOrderDetailEntityToResponse, transformOrderToResponse } from "../utils/modelMapper.js";
import { productService, saveOrUpdateStockTransaction } from "./productService.js";
import Product from "../models/product.js";
import { assertCancellable, assertRejectAllowed, assertTransitionAllowed, isValidStatus, normalizeStatus } from "../utils/orderStatusUtils.js";
import invoiceService from "./invoiceService.js";

dayjs.extend(utc);
dayjs.extend(timezone);

function deriveOrderStatusFromDetails(details = []) {
    if (!Array.isArray(details) || details.length === 0) return ORDER_STATUSES.PENDING;

    const statuses = new Set(details.map(d => d.status));

    if (statuses.has(ORDER_STATUSES.REJECTED)) return ORDER_STATUSES.REJECTED;
    if (statuses.has(ORDER_STATUSES.CANCELLED)) return ORDER_STATUSES.CANCELLED;
    if (statuses.has(ORDER_STATUSES.PRODUCTION)) return ORDER_STATUSES.PRODUCTION;
    if (statuses.has(ORDER_STATUSES.PACKED)) return ORDER_STATUSES.PACKED;
    if (statuses.has(ORDER_STATUSES.INVOICE)) return ORDER_STATUSES.INVOICE;
    if (statuses.has(ORDER_STATUSES.SHIPPED)) return ORDER_STATUSES.SHIPPED;

    // all delivered -> COMPLETED
    const allDelivered = details.length > 0 && details.every(d => d.status === ORDER_STATUSES.DELIVERED);
    if (allDelivered) return ORDER_STATUSES.COMPLETED;

    return ORDER_STATUSES.CONFIRMED;
}

function allDetailsDelivered(details = []) {
    return Array.isArray(details) && details.length > 0 && details.every(d => d.status === ORDER_STATUSES.DELIVERED);
}

function canMoveOrderToTargetStatus(details = [], targetStatus) {
    if (!Array.isArray(details)) return false;

    const allowedDetailStatusByOrderStatus = {
        PENDING: ["PENDING", "CONFIRMED"],
        CONFIRMED: ["PENDING", "CONFIRMED"],
        PRODUCTION: ["CONFIRMED", "PRODUCTION"],
        PACKED: ["PRODUCTION", "PACKED"],
        INVOICE: ["PACKED", "INVOICE"],
        SHIPPED: ["INVOICE", "SHIPPED"],
        DELIVERED: ["SHIPPED", "DELIVERED"],
        COMPLETED: ["DELIVERED"]
    };

    const allowedStatuses = allowedDetailStatusByOrderStatus[targetStatus];
    if (!allowedStatuses) return false;

    return details.every(d => allowedStatuses.includes(d.status));
}

async function persistStockReturns({ product, returns, employeeId, role, orderNumber, orderDetailsNumber }) {
    for (const { qty, type }
        of returns) {
        if (!qty || qty <= 0) continue;
        await saveOrUpdateStockTransaction({
            product,
            quantity: qty,
            action: STOCK_ACTIONS.STOCK_RETURN,
            stockType: type,
            employeeId,
            role,
            orderNumber,
            orderDetailsNumber
        });
    }
}

async function returnStockForDetail({ d, employeeId, employeeRole, orderNumber }) {
    const { PACKED = 0, UNPACKED = 0, PRODUCTION = 0 } = d.stock_usage || {};
    if (PACKED || UNPACKED || PRODUCTION) {
        await productService.returnStock({
            product_id: d.product_id,
            quantity: d.qty_ordered,
            employeeId,
            employeeRole,
            orderNumber,
            stock_usage: { PACKED, UNPACKED, PRODUCTION }
        });
    }
}

const validateOrderDTO = async (dto) => {
    for (const field of ORDER_REQUIRED_FIELDS) {
        if (!dto[field]) throw new BadRequestException(`'${field}' is required.`);
    }

    const dealer = await Employee.findOne({ employee_id: dto.dealer_id, role: ROLES.DEALER });
    if (!dealer) throw new BadRequestException(`Invalid dealer ID: ${dto.dealer_id}. Dealer not found or not a dealer role.`);

    if (!Array.isArray(dto.order_details) || dto.order_details.length === 0) {
        throw new BadRequestException('At least one valid order detail is required.');
    }

    dto.order_details.forEach((detail, idx) => {
        if (!detail || Object.keys(detail).length === 0) return;

        for (const field of ORDER_DETAILS_REQUIRED_FIELDS) {
            if (detail[field] === undefined || detail[field] === null || detail[field] === '') {
                throw new BadRequestException(`order_details[${idx}]: '${field}' is required.`);
            }
        }

        if (typeof detail.qty_ordered !== 'number' || detail.qty_ordered <= 0) {
            throw new BadRequestException(`order_details[${idx}]: 'qty_ordered' must be a number greater than 0.`);
        }

        if (isNaN(Date.parse(detail.delivery_date))) {
            throw new BadRequestException(`order_details[${idx}]: 'delivery_date' must be a valid date.`);
        }
    });

    return dealer;
};

export const fetchDealerAndOrderDetails = async (orders) => {
    const dealerIds = [...new Set(orders.map((o) => o.dealer_id))];
    const orderNumbers = orders.map((o) => o.order_number);

    const [dealers, orderDetails] = await Promise.all([
        Employee.find({ employee_id: { $in: dealerIds }, role: ROLES.DEALER }),
        OrderDetails.find({ order_number: { $in: orderNumbers } }),
    ]);

    const dealerMap = Object.fromEntries(dealers.map((d) => [d.employee_id, d]));
    const detailsMap = orderDetails.reduce((acc, d) => {
        acc[d.order_number] = acc[d.order_number] || [];
        acc[d.order_number].push(d);
        return acc;
    }, {});

    return { dealerMap, detailsMap };
};

const orderService = {
    createOrder: asyncHandler(async (dto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!employeeId || !employeeRole || !Object.values(ORDER_CREATOR_ROLES).includes(employeeRole.toUpperCase())) {
            throw new ForbiddenException(`Access denied: only users with roles ${Object.values(ORDER_CREATOR_ROLES).join(', ')} are authorized to create orders.`);
        }

        const salesmanId = employeeRole === ROLES.SALESMAN ? employeeId : sanitizeInput(dto.salesman_id);

        if ((Object.values(APPROVAL_GRANTED_ROLES).includes(employeeRole.toUpperCase())) && !salesmanId) {
            throw new BadRequestException("salesman_id is required when ADMIN or SUPER_ADMIN creates the order.");
        }

        const dealer = await validateOrderDTO(dto);
        const orderNumber = await generateUniqueOrderId();

        const order = new Order({
            order_number: orderNumber,
            dealer_id: sanitizeInput(dealer.employee_id),
            created_by: employeeId,
            salesman_id: salesmanId,
            priority: sanitizeInput(dto.priority || "LOW"),
            order_note: sanitizeInput(dto.order_note || ""),
            amount_paid: Number(dto.amount_paid) || 0,
            payment_type: (Number(dto.amount_paid) > 0) ? sanitizeInput(dto.payment_method || "CASH") : null
        });

        const productIds = dto.order_details.map((detail) => detail.product_id);
        const { productMap, productStockMap } = await productService.getProductsByIds(productIds);

        let totalOrderAmount = 0;
        let totalOrderDiscount = 0;
        let hasPendingProduction = false;

        const orderDetailsPayload = [];

        for (const detail of dto.order_details) {
            const product = productMap.get(detail.product_id);
            if (!product) throw new BadRequestException(`Product not found: ${detail.product_id}`);

            const stockDoc = productStockMap.get(detail.product_id);
            const qtyOrdered = Number(detail.qty_ordered);

            logger.info(`📦 Stocks for ${detail.product_id}, ${stockDoc}`);

            const isProductScheme = Boolean(detail.is_product_scheme);
            logger.info(`📦 Product: ${product.product_id} | is_product_scheme: ${detail.is_product_scheme} | Parsed: ${isProductScheme}`);

            const { productionRequired, packedUsed, unpackedUsed } = await productService.checkAndReserveStock(
                product, stockDoc, qtyOrdered, employeeId, employeeRole, orderNumber
            );

            if (productionRequired > 0 || unpackedUsed > 0) hasPendingProduction = true;

            const stockUsage = { PACKED: packedUsed || 0, UNPACKED: unpackedUsed || 0, PRODUCTION: productionRequired || 0 };
            const stockFlags = {
                PACKED: packedUsed || 0,
                UNPACKED: unpackedUsed || 0,
                PRODUCTION: productionRequired || 0,
                hasUnpacked: (unpackedUsed || 0) > 0,
                hasProduction: (productionRequired || 0) > 0
            };

            const unitPrice = normalizePrice(product.price) || 0;
            let unitDiscount = 0;

            if (detail.discount_price && Number(detail.discount_price) > 0) {
                unitDiscount = Number(detail.discount_price);
            } else if (detail.dealer_discount_id) {
                const dealerDiscount = await DealerDiscount.findOne({
                    dealer_discount_id: sanitizeInput(detail.dealer_discount_id),
                    dealer_id: dealer.employee_id,
                    brand_name: product.brand,
                    model_name: product.model
                });

                if (dealerDiscount) {
                    unitDiscount = dealerDiscount.is_percentage ?
                        (unitPrice * dealerDiscount.discount_value) / 100 :
                        dealerDiscount.discount_value;
                }
            }

            if (unitDiscount < 0 || isNaN(unitDiscount)) unitDiscount = 0;
            if (unitDiscount > unitPrice) unitDiscount = unitPrice;

            const totalProductPrice = unitPrice * qtyOrdered;
            const totalDiscount = unitDiscount * qtyOrdered;
            const totalPrice = totalProductPrice - totalDiscount;

            if (!isProductScheme) {
                totalOrderAmount += totalPrice;
                totalOrderDiscount += totalDiscount;
            }

            let notes = [];
            if (productionRequired > 0) notes.push(`Production Required: ${productionRequired} units`);
            if (unpackedUsed > 0) notes.push(`Unpacked Required for Packing: ${unpackedUsed} units`);

            const detailStatus = employeeRole === ROLES.SALESMAN ?
                ORDER_STATUSES.PENDING :
                (productionRequired > 0 || unpackedUsed > 0 ? ORDER_STATUSES.PRODUCTION : ORDER_STATUSES.PACKED);

            const orderDetails = {
                order_details_number: await generateUniqueOrderDetailsId(),
                order_number: orderNumber,
                product_id: product.product_id,
                product_brand: product.brand,
                product_name: product.product_name,
                product_model: product.model,
                product_type: product.product_type,
                qty_ordered: qtyOrdered,
                delivery_date: new Date(detail.delivery_date),
                notes: notes.join(' | '),
                stock_usage: stockUsage,
                stock_flags: stockFlags,
                status: detailStatus,
                unit_product_price: unitPrice,
                total_product_price: totalProductPrice,
                dealer_discount: unitDiscount,
                total_dealer_discount: totalDiscount,
                total_price: totalPrice,
                is_free: isProductScheme
            };
            orderDetailsPayload.push(orderDetails);
        }

        const orderStatus = employeeRole === ROLES.SALESMAN ? ORDER_STATUSES.PENDING : (hasPendingProduction ? ORDER_STATUSES.PRODUCTION : ORDER_STATUSES.PACKED);

        order.status = orderStatus;
        order.sales_target_updated = false;
        order.order_total_price = totalOrderAmount;
        order.order_total_discount = totalOrderDiscount;
        await order.save();

        const orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);
        logger.info(`✅ Order created successfully — Order#: ${orderNumber} | Total Items: ${orderDetailsList.length}`);

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async (orderNumber) => {
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const orderDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

    getAllOrders: asyncHandler(async ({ includeRejected = false, page = 1, limit = 10 }) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const filter = {};

        if (!includeRejected) {
            filter.status = { $ne: ORDER_STATUSES.REJECTED };
        }

        if (![ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(employeeRole)) {
            filter.created_by = employeeId;
        }

        const skip = (page - 1) * limit;

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit),

            Order.countDocuments(filter)
        ]);

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        const transformed = orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number]
            )
        );

        return { orders: transformed, total };
    }),

    getByOrderStatus: asyncHandler(async (orderStatus) => {
        if (!Object.values(ORDER_STATUSES).includes(orderStatus)) {
            throw new BadRequestException(`Invalid order status: ${orderStatus}`);
        }

        const orders = await Order.findByOrderStatus(orderStatus);
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);
        return orders.map((order) => transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number]));
    }),

    getOrdersByDateFilter: asyncHandler(async ({ year, month, start_date, end_date }) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        let startDate, endDate;

        if (year && month) {
            const safeDate = `${year}-${String(month).padStart(2, "0")}-01`;

            startDate = dayjs(safeDate).startOf("month").toDate();
            endDate = dayjs(safeDate).endOf("month").toDate();
        } else if (start_date && end_date) {
            if (!dayjs(start_date).isValid() || !dayjs(end_date).isValid()) {
                throw new BadRequestException("Invalid 'start_date' or 'end_date'. Use 'YYYY-MM-DD'.");
            }
            startDate = dayjs(start_date).toDate();
            endDate = dayjs(end_date).toDate();
        } else {
            const now = dayjs().tz("Asia/Kolkata");
            startDate = now.startOf("month").toDate();
            endDate = now.endOf("month").toDate();
        }

        logger.debug("🕒 Filtered Date Range", {
            start: dayjs(startDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            end: dayjs(endDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        });

        const filter = {
            created_at: { $gte: startDate, $lte: endDate }
        };

        // Restrict salesman
        if (![ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(employeeRole)) {
            filter.created_by = employeeId;
        }

        const orders = await Order.find(filter).sort({ created_at: -1 });
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) => transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number]));
    }),

    updateOrderDetailStatus: asyncHandler(async (orderDetailsId, updateDto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const toNumber = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
        const nowIST = getISTDate;

        /* --------------------------------------------------
           1️⃣ Fetch core entities
        -------------------------------------------------- */
        const orderDetail = await OrderDetails.findOne({ order_details_number: orderDetailsId });
        if (!orderDetail) {
            throw new BadRequestException(`No order detail found for ID: ${orderDetailsId}`);
        }

        const order = await Order.findByOrderNumber(orderDetail.order_number);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderDetail.order_number}`);
        }

        const product = await Product.findOne({ product_id: orderDetail.product_id });
        if (!product) {
            throw new BadRequestException(`No product found for ID: ${orderDetail.product_id}`);
        }

        const otherOrderDetails = await OrderDetails.find({
            order_number: order.order_number,
            order_details_number: { $ne: orderDetailsId }
        });

        /* --------------------------------------------------
           2️⃣ Stock state initialization
        -------------------------------------------------- */
        let { PACKED = 0, UNPACKED = 0, PRODUCTION = 0 } = orderDetail.stock_usage || {};
        let {
            PACKED: packedQty = 0,
            UNPACKED: unpackedQty = 0,
            PRODUCTION: productionQty = 0
        } = orderDetail.stock_flags || {};

        let returnPacked = 0;
        let returnUnpacked = 0;

        const appendNote = (text) => {
            orderDetail.notes = [orderDetail.notes, text].filter(Boolean).join(" | ");
        };

        /* --------------------------------------------------
           3️⃣ Helper validations
        -------------------------------------------------- */
        const assertAdminCancelAccess = () => {
            if (!Object.values(ADMIN_PRIVILEGED_ROLES).includes(employeeRole)) {
                throw new ForbiddenException(
                    `Access denied. Allowed roles: ${Object.values(ADMIN_PRIVILEGED_ROLES).join(", ")}`
                );
            }
        };

        const consumeStockForCancellation = (qty) => {
            let remaining = qty;

            if (productionQty > 0 && remaining > 0) {
                const used = Math.min(productionQty, remaining);
                productionQty -= used;
                PRODUCTION -= used;
                remaining -= used;
            }

            if (unpackedQty > 0 && remaining > 0) {
                const used = Math.min(unpackedQty, remaining);
                unpackedQty -= used;
                returnUnpacked += used;
                UNPACKED -= used;
                remaining -= used;
            }

            if (packedQty > 0 && remaining > 0) {
                const used = Math.min(packedQty, remaining);
                packedQty -= used;
                returnPacked += used;
                PACKED -= used;
            }
        };

        /* --------------------------------------------------
           4️⃣ Production → Unpacked → Packed transitions
        -------------------------------------------------- */
        if (updateDto.has_production_completed && productionQty > 0) {
            unpackedQty += productionQty;
            productionQty = 0;
            PRODUCTION = 0;
        }

        if (updateDto.has_unPacked_completed && unpackedQty > 0) {
            packedQty += unpackedQty;
            unpackedQty = 0;
            UNPACKED = 0;
        }

        /* --------------------------------------------------
           5️⃣ Cancellation flow
        -------------------------------------------------- */
        if (updateDto.cancel_qty !== undefined) {
            const cancelQty = toNumber(updateDto.cancel_qty);
            if (cancelQty <= 0) throw new BadRequestException("Cancel quantity must be greater than 0.");

            const remainingQty = orderDetail.qty_ordered - orderDetail.qty_delivered;
            if (cancelQty > remainingQty) {
                throw new BadRequestException("Cancel quantity exceeds remaining orderable quantity.");
            }

            assertAdminCancelAccess();
            consumeStockForCancellation(cancelQty);

            orderDetail.qty_ordered -= cancelQty;
            orderDetail.total_cancelled_qty += cancelQty;

            const unitPrice = toNumber(orderDetail.unit_product_price);
            const unitDiscount = toNumber(orderDetail.dealer_discount);

            orderDetail.total_product_price = unitPrice * orderDetail.qty_ordered;
            orderDetail.total_dealer_discount = unitDiscount * orderDetail.qty_ordered;
            orderDetail.total_price = orderDetail.total_product_price - orderDetail.total_dealer_discount;

            orderDetail.cancellation_history.push({
                cancelled_qty: cancelQty,
                cancelled_by: employeeId,
                cancelled_by_role: employeeRole,
                cancelled_at: nowIST(),
                reason: updateDto.reason_for_cancellation || "Not provided"
            });

            appendNote(`Cancelled ${cancelQty} unit(s)`);
        }

        /* --------------------------------------------------
           6️⃣ Stock return persistence
        -------------------------------------------------- */
        if (returnPacked || returnUnpacked) {
            await persistStockReturns({
                product,
                employeeId,
                role: employeeRole,
                orderNumber: order.order_number,
                orderDetailsNumber: orderDetail.order_details_number,
                returns: [
                    { qty: returnUnpacked, type: STOCK_TYPES.STOCK_UNPACKED },
                    { qty: returnPacked, type: STOCK_TYPES.STOCK_PACKED }
                ]
            });
        }

        /* --------------------------------------------------
           7️⃣ Delivery update
        -------------------------------------------------- */
        if (updateDto.delivered_qty !== undefined) {
            const deliveredQty = toNumber(updateDto.delivered_qty);
            if (deliveredQty <= 0) throw new BadRequestException("Invalid delivered quantity.");

            if (deliveredQty > (orderDetail.qty_ordered - orderDetail.qty_delivered)) {
                throw new BadRequestException("Delivered quantity exceeds remaining quantity.");
            }

            orderDetail.qty_delivered += deliveredQty;
            orderDetail.delivery_date = updateDto.delivered_date ?
                new Date(updateDto.delivered_date) :
                nowIST();

            appendNote(`Delivered ${deliveredQty} unit(s)`);
        }

        /* --------------------------------------------------
           8️⃣ Final stock flags & status
        -------------------------------------------------- */
        orderDetail.stock_flags = {
            PACKED: packedQty,
            UNPACKED: unpackedQty,
            PRODUCTION: productionQty,
            hasUnpacked: unpackedQty > 0,
            hasProduction: productionQty > 0
        };

        if (orderDetail.qty_ordered === 0) {
            orderDetail.status = ORDER_STATUSES.CANCELLED;
        } else if (orderDetail.qty_ordered === orderDetail.qty_delivered) {
            orderDetail.status = ORDER_STATUSES.DELIVERED;
            orderDetail.delivery_date = nowIST();
        } else if (orderDetail.stock_flags.hasProduction || orderDetail.stock_flags.hasUnpacked) {
            orderDetail.status = ORDER_STATUSES.PRODUCTION;
        } else if (packedQty > 0) {
            orderDetail.status = ORDER_STATUSES.PACKED;
        }

        /* --------------------------------------------------
           9️⃣ Invoice trigger (clean & correct)
        -------------------------------------------------- */
        if (orderDetail.status === ORDER_STATUSES.INVOICE) {
            const invoiceQty = toNumber(updateDto.invoice_qty);
            await invoiceService.generateOrUpdateInvoiceByOrderDetail(
                orderDetail,
                invoiceQty
            );
        }

        await orderDetail.save();

        /* --------------------------------------------------
           🔟 Recalculate order totals & status
        -------------------------------------------------- */
        const allDetails = [orderDetail, ...otherOrderDetails];

        order.order_total_price = allDetails
            .filter(d => !d.is_free)
            .reduce((sum, d) => sum + toNumber(d.total_price), 0);

        order.order_total_discount = allDetails
            .filter(d => !d.is_free)
            .reduce((sum, d) => sum + toNumber(d.total_dealer_discount), 0);

        const refreshedDetails = await OrderDetails.find({ order_number: order.order_number });

        const derivedStatus = deriveOrderStatusFromDetails(refreshedDetails);
        order.status = allDetailsDelivered(refreshedDetails) ?
            ORDER_STATUSES.COMPLETED :
            derivedStatus;

        await order.save();

        return mapOrderDetailEntityToResponse(orderDetail);
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (orderNumber, updates) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!updates || typeof updates !== "object") throw new BadRequestException("Invalid request body.");

        const {
            order_number,
            priority,
            order_note,
            status,
            amount_paid,
            payment_method,
            order_details = []
        } = updates;

        if (order_number !== orderNumber) throw new BadRequestException(`Order number mismatch: path(${orderNumber}) ≠ body(${order_number}).`);

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        if (priority && priority !== order.priority) order.priority = priority;

        if (order_note && order_note.trim()) {
            order.order_note = [order.order_note, order_note.trim()]
                .filter(Boolean)
                .join(" | ");
        }

        if (Array.isArray(order_details) && order_details.length) {
            await orderService.updateOrderDetailsBatch(order_details);
        }

        let updatedDetails = await OrderDetails.find({ order_number: orderNumber });

        if (status) {
            await orderService.applyOrderStatusChange({
                order,
                updatedDetails,
                status,
                employeeId,
                employeeRole,
                orderNumber
            });

            if (!order_details.length) {
                const next = normalizeStatus(status);
                for (const detail of updatedDetails) {
                    await orderService.updateOrderDetailStatus(detail.order_details_number, {
                        status: next
                    });
                }

                updatedDetails = await OrderDetails.find({ order_number: orderNumber });
            }

        } else {
            let derived = deriveOrderStatusFromDetails(updatedDetails);

            if (!canMoveOrderToTargetStatus(updatedDetails, derived)) {
                derived = order.status;
            }

            order.status = derived;
        }

        if (allDetailsDelivered(updatedDetails)) {
            order.status = ORDER_STATUSES.COMPLETED;
        }

        // payment update
        if (typeof amount_paid !== "undefined" && ![ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(order.status)) {
            await order.addPayment(Number(amount_paid) || 0, payment_method || "CASH");
        }

        await order.save();
        return transformOrderToResponse(order, null, updatedDetails);
    }),

    updateOrderDetailsBatch: async (orderDetails = []) => {
        if (!orderDetails.length) return;

        const ids = orderDetails.map(d => d.order_details_number);

        const existing = await OrderDetails.find({
            order_details_number: { $in: ids }
        });

        const detailMap = new Map(
            existing.map(d => [d.order_details_number, d])
        );

        for (const dto of orderDetails) {
            if (!detailMap.has(dto.order_details_number)) continue;

            await orderService.updateOrderDetailStatus(
                dto.order_details_number,
                dto
            );
        }
    },

    applyOrderStatusChange: asyncHandler(async ({
        order,
        updatedDetails,
        status,
        employeeId,
        employeeRole,
        orderNumber
    }) => {
        const next = normalizeStatus(status);
        const prev = order.status;

        if (!isValidStatus(next))
            throw new BadRequestException(`Invalid order status: ${next}`);

        if (prev === next) return;

        if ([ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED].includes(prev)) {
            throw new BadRequestException(
                `Order ${order.order_number} is already '${prev}' and cannot be updated.`
            );
        }

        if (next === ORDER_STATUSES.REJECTED) {
            assertRejectAllowed(prev);
            order.status = next;
            await order.save();
            return;
        }

        if (next === ORDER_STATUSES.CANCELLED) {
            assertCancellable(prev);
            await orderService.cancelOrderAndReturnStock({
                order,
                updatedDetails,
                employeeId,
                employeeRole,
                orderNumber
            });
            return;
        }

        if ([ORDER_STATUSES.INVOICE, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(next)) {
            if (!canMoveOrderToTargetStatus(updatedDetails, next)) {
                throw new BadRequestException(`Order cannot move to '${next}' because one or more details are not ready.`);
            }
        }

        assertTransitionAllowed(prev, next);

        order.status = next;
    }),

    cancelOrderAndReturnStock: asyncHandler(async ({
        order,
        updatedDetails,
        employeeId,
        employeeRole,
        orderNumber
    }) => {
        for (const detail of updatedDetails) {
            await returnStockForDetail({ d: detail, employeeId, employeeRole, orderNumber });
            detail.status = ORDER_STATUSES.CANCELLED;
            await detail.save();
        }

        order.order_total_discount = 0;
        order.order_total_price = 0;
        order.status = ORDER_STATUSES.CANCELLED;

        await order.save();
    }),

    updateOrderStatus: asyncHandler(async (orderNumber, newStatus) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!newStatus || typeof newStatus !== "string") throw new BadRequestException("Invalid newStatus provided.");

        const normalized = newStatus.toUpperCase();
        if (!Object.values(ORDER_STATUSES).includes(normalized)) throw new BadRequestException(`Invalid order status: ${normalized}.`);

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        const prev = order.status;

        if ([ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(prev)) {
            throw new BadRequestException(`Order ${orderNumber} is already '${prev}' and cannot be updated.`);
        }

        if (prev === normalized) {
            throw new BadRequestException(`Order already in status '${prev}'.`);
        }

        if (normalized === ORDER_STATUSES.REJECTED && prev !== ORDER_STATUSES.PENDING) {
            throw new BadRequestException("REJECTED is allowed only from PENDING.");
        }

        if (normalized === ORDER_STATUSES.CANCELLED && !CANCELLABLE_STATUSES.has(prev)) {
            throw new BadRequestException(`Cannot cancel order at '${prev}'. Cancellation allowed only before INVOICE.`);
        }

        if (!isValidTransition(previous, normalized)) {
            throw new BadRequestException(`Invalid status transition: ${previous} → ${normalized}`);
        }

        const details = await OrderDetails.find({ order_number: orderNumber });

        if ([ORDER_STATUSES.INVOICE, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(normalized)) {
            if (!canMoveOrderToTargetStatus(updatedOrderDetails, normalized)) {
                throw new BadRequestException(`Order cannot move to '${normalized}' because one or more details are not ready for that stage.`);
            }
        }

        if (normalized === ORDER_STATUSES.CONFIRMED) {
            if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(employeeRole)) {
                throw new ForbiddenException(`You are not authorized to set status to '${normalized}'.`);
            }
        }

        if ([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(normalized)) {
            for (const d of details) {
                await returnStockForDetail({ d, employeeId, employeeRole, orderNumber });
                d.status = normalized;
                await d.save();
            }
            order.order_total_price = 0;
            order.order_total_discount = 0;
        }

        order.status = allDetailsDelivered(details) ? ORDER_STATUSES.COMPLETED : normalized;

        await order.save();

        logger.info(`🔄 Order Status Updated — order_number: ${orderNumber} | ${prev} → ${order.status}`);

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const refreshedDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, refreshedDetails);
    }),

    updateOrderAndDetails: asyncHandler(async (orderNumber, payload) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!payload || typeof payload !== "object") {
            throw new BadRequestException("Invalid request body");
        }

        const {
            order_number,
            priority,
            order_note,
            status,
            amount_paid,
            payment_method,
            order_details = []
        } = payload;

        if (order_number && order_number !== orderNumber) {
            throw new BadRequestException(`Order number mismatch: path(${orderNumber}) ≠ body(${order_number})`);
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        if (priority && priority !== order.priority) {
            order.priority = priority;
        }

        if (order_note && order_note.trim()) {
            order.order_note = [order.order_note, order_note.trim()]
                .filter(Boolean)
                .join(" | ");
        }

        await orderService.updateOrderDetailsBatch(order_details);

        let updatedDetails = await OrderDetails.find({
            order_number: orderNumber
        });

        if (status) {
            await orderService.applyOrderStatusChange({
                order,
                updatedDetails,
                status,
                employeeId,
                employeeRole,
                orderNumber
            });

            // If status updated without item updates
            if (!order_details.length) {
                const normalized = normalizeStatus(status);
                for (const detail of updatedDetails) {
                    await orderService.updateOrderDetailStatus(
                        detail.order_details_number, { status: normalized }
                    );
                }

                updatedDetails = await OrderDetails.find({
                    order_number: orderNumber
                });
            }
        } else {
            // 6️⃣ Auto-derive order status
            let derived = deriveOrderStatusFromDetails(updatedDetails);

            if (!canMoveOrderToTargetStatus(updatedDetails, derived)) {
                derived = order.status;
            }

            order.status = derived;
        }

        if (allDetailsDelivered(updatedDetails)) {
            order.status = ORDER_STATUSES.COMPLETED;
        }

        if (
            typeof amount_paid !== "undefined" &&
            ![ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(order.status)
        ) {
            await order.addPayment(
                Number(amount_paid) || 0,
                payment_method || "CASH"
            );
        }

        await order.save();

        return transformOrderToResponse(order, null, updatedDetails);
    }),

};

export { orderService };