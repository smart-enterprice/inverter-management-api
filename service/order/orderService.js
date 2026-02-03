// service/orderService.js
import asyncHandler from "express-async-handler";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import logger from "../../utils/logger.js";
import Employee from "../../models/employees.js";
import Order from "../../models/order.js";
import OrderDetails from "../../models/orderDetails.js";
import DealerDiscount from "../../models/dealerDiscount.js";

import { generateUniqueOrderDetailsId, generateUniqueOrderId } from "../../utils/generatorIds.js";
import { BadRequestException, ForbiddenException } from "../../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext, isValidTransition, normalizePrice, sanitizeInput } from "../../utils/validationUtils.js";

import { getISTDate, ROLES, STOCK_TYPES, ORDER_STATUSES, CANCELLABLE_STATUSES, ADMIN_PRIVILEGED_ROLES } from "../../utils/constants.js";
import { mapOrderDetailEntityToResponse, transformOrderToResponse } from "../../utils/modelMapper.js";
import { productService } from "../productService.js";
import Product from "../../models/product.js";
import { assertCancellable, assertRejectAllowed, assertTransitionAllowed, isValidStatus, normalizeStatus } from "../../utils/orderStatusUtils.js";
import invoiceService from "../invoiceService.js";
import { allDetailsDelivered, canMoveOrderToTargetStatus, deriveOrderStatusFromDetails, resolveOrderDetailStatus } from "./orderStatus.js";
import { validateOrderCreator, validateOrderDTO } from "./orderValidation.js";
import { persistStockReturns, returnStockForDetail } from "./orderStock.js";
import { fetchDealerAndOrderDetails } from "./orderHelpers.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const orderService = {
    createOrder: asyncHandler(async (dto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        console.log("[CREATE_ORDER]", {
            employeeId,
            employeeRole,
            timestamp: new Date().toISOString()
        });

        validateOrderCreator(employeeId, employeeRole, dto);

        const dealer = await validateOrderDTO(dto);
        const orderNumber = await generateUniqueOrderId();

        const order = new Order({
            order_number: orderNumber,
            dealer_id: sanitizeInput(dealer.employee_id),
            created_by: employeeId,
            salesman_id: sanitizeInput(dto.salesman_id),
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

        if (dto.delivery_date != null) {
            const parsedDate = new Date(dto.delivery_date);

            if (Number.isNaN(parsedDate.getTime())) {
                throw new BadRequestException("Invalid delivery_date format");
            }

            order.promised_delivery_date = parsedDate;
        }

        await order.save();

        const orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);
        logger.info(`✅ Order created successfully — Order#: ${orderNumber} | Total Items: ${orderDetailsList.length}`);

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async (orderNumber) => {
        if (!orderNumber) {
            throw new BadRequestException("Order number is required.");
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        const [dealer, orderDetails] = await Promise.all([
            Employee.findOne({
                employee_id: order.dealer_id,
                role: ROLES.DEALER
            }),
            OrderDetails.find({ order_number: orderNumber })
        ]);

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

    getAllOrders: asyncHandler(async ({ includeRejected = false, page = 1, limit = 10 }) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const filter = {};

        if (!includeRejected) {
            filter.status = { $ne: ORDER_STATUSES.REJECTED };
        }

        // Restrict non-admin roles
        if (!ADMIN_PRIVILEGED_ROLES.includes(employeeRole)) {
            filter.created_by = employeeId;
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Order.countDocuments(filter)
        ]);

        if (!orders.length) {
            return { orders: [], total: 0 };
        }

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        const transformedOrders = orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );

        return {
            orders: transformedOrders,
            total,
            page: Number(page),
            limit: Number(limit)
        };
    }),

    getByOrderStatus: asyncHandler(async (orderStatus) => {
        if (!orderStatus || !Object.values(ORDER_STATUSES).includes(orderStatus)) {
            throw new BadRequestException(`Invalid order status: ${orderStatus}`);
        }

        const orders = await Order.findByOrderStatus(orderStatus);

        if (!orders.length) {
            return [];
        }

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );
    }),

    getOrdersByDateFilter: asyncHandler(async (query) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const { year, month, start_date, end_date } = query;

        /* --------------------------------------------------
           1️⃣ Resolve date range (IST aware)
        -------------------------------------------------- */
        let startDate;
        let endDate;

        if (year && month) {
            const base = `${year}-${String(month).padStart(2, "0")}-01`;
            startDate = dayjs(base).startOf("month").toDate();
            endDate = dayjs(base).endOf("month").toDate();

        } else if (start_date && end_date) {
            if (!dayjs(start_date).isValid() || !dayjs(end_date).isValid()) {
                throw new BadRequestException(
                    "Invalid start_date or end_date. Expected format: YYYY-MM-DD"
                );
            }

            startDate = dayjs(start_date).startOf("day").toDate();
            endDate = dayjs(end_date).endOf("day").toDate();

        } else {
            const nowIST = dayjs().tz("Asia/Kolkata");
            startDate = nowIST.startOf("month").toDate();
            endDate = nowIST.endOf("month").toDate();
        }

        /* --------------------------------------------------
           2️⃣ Build Mongo filter (EXPLICIT TYPE)
        -------------------------------------------------- */
        const filter = /** @type {Record<string, any>} */ ({
            created_at: {
                $gte: startDate,
                $lte: endDate
            }
        });

        if (!ADMIN_PRIVILEGED_ROLES.includes(employeeRole)) {
            filter.created_by = employeeId;
        }

        /* --------------------------------------------------
           3️⃣ Query
        -------------------------------------------------- */
        const orders = await Order
            .find(filter)
            .sort({ created_at: -1 });

        if (!orders.length) return [];

        /* --------------------------------------------------
           4️⃣ Attach dealer & details
        -------------------------------------------------- */
        const { dealerMap, detailsMap } =
            await fetchDealerAndOrderDetails(orders);

        return orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );
    }),

    updateOrderDetailStatus: asyncHandler(async (orderDetailsId, updateDto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        console.info("[OrderDetail][DTO][Incoming]", {
            dtoKeys: Object.keys(updateDto),
            dtoValues: updateDto
        });

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
        let {
            PACKED: packedQty = 0,
            UNPACKED: unpackedQty = 0,
            PRODUCTION: productionQty = 0
        } = orderDetail.stock_flags || {};

        let returnPacked = 0;
        let returnUnpacked = 0;

        const appendNote = (note) => {
            orderDetail.notes = [orderDetail.notes, note]
                .filter(Boolean)
                .join(" | ");
        };

        /* --------------------------------------------------
           3️⃣ Helper validations
        -------------------------------------------------- */
        const assertAdminCancelAccess = () => {
            const role = (employeeRole || "").toUpperCase();

            if (!ADMIN_PRIVILEGED_ROLES.includes(role)) {
                throw new ForbiddenException(
                    `Access denied. Your role (${role}) is not permitted. Allowed roles: ${ADMIN_PRIVILEGED_ROLES.join(", ")}.`
                );
            }
        };

        const consumeStockForCancellation = (qty) => {
            let remaining = qty;

            if (productionQty > 0 && remaining > 0) {
                const used = Math.min(productionQty, remaining);
                productionQty -= used;
                remaining -= used;
            }

            if (unpackedQty > 0 && remaining > 0) {
                const used = Math.min(unpackedQty, remaining);
                unpackedQty -= used;
                returnUnpacked += used;
                remaining -= used;
            }

            if (packedQty > 0 && remaining > 0) {
                const used = Math.min(packedQty, remaining);
                packedQty -= used;
                returnPacked += used;
                remaining -= used;
            }
        };

        /* --------------------------------------------------
           4️⃣ Production → Unpacked → Packed transitions
        -------------------------------------------------- */
        if (updateDto.has_production_completed && productionQty > 0) {
            unpackedQty += productionQty;
            productionQty = 0;
        }

        if (updateDto.has_unPacked_completed && unpackedQty > 0) {
            packedQty += unpackedQty;
            unpackedQty = 0;
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

            const remainingQty = orderDetail.qty_ordered - orderDetail.qty_delivered;
            if (deliveredQty > remainingQty) {
                throw new BadRequestException("Delivered quantity exceeds remaining quantity.");
            }

            const deliveredAt = updateDto.delivered_date ?
                new Date(updateDto.delivered_date) :
                nowIST();

            orderDetail.qty_delivered += deliveredQty;
            orderDetail.delivery_date = deliveredAt;

            appendNote(`Delivered ${deliveredQty} unit(s) on ${deliveredAt.toISOString()}`);
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

        console.info("[OrderDetail][Stock Flags Updated]", {
            orderDetailsNo: orderDetail.order_details_number,
            planned_stock_usage: orderDetail.stock_usage, // immutable
            live_stock_flags: orderDetail.stock_flags, // mutable
            computed: {
                packedQty,
                unpackedQty,
                productionQty
            }
        });

        /* --------------------------------------------------
               Resolve Order Detail Status
        -------------------------------------------------- */
        const previousStatus = orderDetail.status;

        orderDetail.status = resolveOrderDetailStatus({
            qtyOrdered: orderDetail.qty_ordered,
            qtyDelivered: orderDetail.qty_delivered,
            packedQty,
            hasProduction: orderDetail.stock_flags.hasProduction,
            hasUnpacked: orderDetail.stock_flags.hasUnpacked,
            currentStatus: orderDetail.status
        });

        console.info("[OrderDetail][Status Transition]", {
            orderDetailsNo: orderDetail.order_details_number,
            from: previousStatus,
            to: orderDetail.status
        });

        /* --------------------------------------------------
           9️⃣ Invoice trigger (clean & correct)
        -------------------------------------------------- */
        if (updateDto.status) {
            const normalized = normalizeStatus(updateDto.status);
            orderDetail.status = normalized;

            if (normalized === ORDER_STATUSES.INVOICE) {
                await invoiceService.generateOrUpdateInvoiceByOrderDetail(
                    orderDetail,
                    toNumber(updateDto.invoice_qty)
                );
            }
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

        const previousOrderStatus = order.status;

        order.status = allDetailsDelivered(refreshedDetails) ?
            ORDER_STATUSES.COMPLETED :
            deriveOrderStatusFromDetails(refreshedDetails);

        await order.save();

        console.info("[OrderDetail][Response Ready]", {
            orderDetailsNo: orderDetail.order_details_number,
            status: orderDetail.status
        });

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

        console.info("[updateOrderAndDetails][DTO][Incoming]", {
            orderNumber,
            requestedBy: {
                employeeRole
            },
            dtoKeys: Object.keys(payload),
            dtoValues: payload
        });

        const {
            order_number,
            priority,
            order_note,
            status,
            delivery_date,
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

        if (order_details.length) {
            await orderService.updateOrderDetailsBatch(order_details);
        }

        let updatedDetails = await OrderDetails.find({ order_number: orderNumber });

        if (status) {
            const normalizedStatus = normalizeStatus(status);

            // Cascade status to all order details
            await Promise.all(
                updatedDetails.map(detail =>
                    orderService.updateOrderDetailStatus(
                        detail.order_details_number, { status: normalizedStatus }
                    )
                )
            );

            // Re-fetch after cascading update
            updatedDetails = await OrderDetails.find({ order_number: orderNumber });

            await orderService.applyOrderStatusChange({
                order,
                updatedDetails,
                status: normalizedStatus,
                employeeId,
                employeeRole,
                orderNumber
            });
        } else {
            // Auto-derive order status from details
            let derivedStatus = deriveOrderStatusFromDetails(updatedDetails);

            if (!canMoveOrderToTargetStatus(updatedDetails, derivedStatus)) {
                derivedStatus = order.status;
            }

            order.status = derivedStatus;
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

        if (delivery_date != null) {
            const parsedDate = new Date(delivery_date);

            if (Number.isNaN(parsedDate.getTime())) {
                throw new BadRequestException("Invalid delivery_date format");
            }

            order.promised_delivery_date = parsedDate;
        }

        await order.save();

        return transformOrderToResponse(order, null, updatedDetails);
    }),

};

export { orderService };