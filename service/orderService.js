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
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext, isValidTransition, sanitizeInput } from "../utils/validationUtils.js";

import { APPROVAL_GRANTED_ROLES, getISTDate, ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES, STOCK_ACTIONS, STOCK_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, CANCELLABLE_STATUSES } from "../utils/constants.js";
import { mapOrderDetailEntityToResponse, transformOrderToResponse } from "../utils/modelMapper.js";
import { productService, saveOrUpdateStockTransaction } from "./productService.js";
import Product from "../models/product.js";

dayjs.extend(utc);
dayjs.extend(timezone);

function ensureAuthenticatedRole(employeeId, employeeRole) {
    const upper = (employeeRole || "").toUpperCase();
    if (!employeeId || !upper || !Object.values(ROLES).includes(upper)) {
        throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ROLES).join(", ")} are authorized.`);
    }
    return upper;
}

function deriveOrderStatusFromDetails(details = []) {
    if (!Array.isArray(details) || details.length === 0) return ORDER_STATUSES.PENDING;

    const statuses = new Set(details.map(d => d.status));

    if (statuses.has(ORDER_STATUSES.CANCELLED)) return ORDER_STATUSES.CANCELLED;
    if (statuses.has(ORDER_STATUSES.REJECTED)) return ORDER_STATUSES.REJECTED;
    if (statuses.has(ORDER_STATUSES.PRODUCTION)) return ORDER_STATUSES.PRODUCTION;
    if (statuses.has(ORDER_STATUSES.PACKING)) return ORDER_STATUSES.PACKING;
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

function canMoveOrderToInvoice(details = []) {
    if (!Array.isArray(details)) return false;
    return !details.some(d => [ORDER_STATUSES.PRODUCTION, ORDER_STATUSES.PACKING].includes(d.status));
}

async function persistStockReturns({ product, returns, employeeId, role, orderNumber, orderDetailsNumber }) {
    for (const { qty, type } of returns) {
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
        const upperRole = employeeRole?.toUpperCase();

        if (!employeeId || !employeeRole || !Object.values(ORDER_CREATOR_ROLES).includes(employeeRole.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ORDER_CREATOR_ROLES).join(', ')} are authorized to create orders.`);
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

            const unitPrice = Number(product.price || 0);
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
                    unitDiscount = dealerDiscount.is_percentage
                        ? (unitPrice * dealerDiscount.discount_value) / 100
                        : dealerDiscount.discount_value;
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

            const detailStatus = upperRole === ROLES.SALESMAN
                ? ORDER_STATUSES.PENDING
                : (productionRequired > 0 || unpackedUsed > 0 ? ORDER_STATUSES.PRODUCTION : ORDER_STATUSES.PACKING);

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

        const orderStatus = upperRole === ROLES.SALESMAN ? ORDER_STATUSES.PENDING : (hasPendingProduction ? ORDER_STATUSES.PRODUCTION : ORDER_STATUSES.PACKING);

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
        const filter = {};

        if (!includeRejected) {
            filter.status = { $ne: ORDER_STATUSES.REJECTED };
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

        const orders = await Order.find({ created_at: { $gte: startDate, $lte: endDate } }).sort({ created_at: -1 });
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) => transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number]));
    }),

    updateOrderDetailStatus: asyncHandler(async (orderDetailsId, updateDto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const upperRole = ensureAuthenticatedRole(employeeId, employeeRole);

        const orderDetail = await OrderDetails.findOne({ order_details_number: orderDetailsId });
        if (!orderDetail) throw new BadRequestException(`No order detail found for ID: ${orderDetailsId}`);

        const order = await Order.findByOrderNumber(orderDetail.order_number);
        if (!order) throw new BadRequestException(`No order found for: ${orderDetail.order_number}`);

        const product = await Product.findOne({ product_id: orderDetail.product_id });
        if (!product) throw new BadRequestException(`No product found for ID: ${orderDetail.product_id}`);

        const otherOrderDetails = await OrderDetails.find({
            order_number: order.order_number,
            order_details_number: { $ne: orderDetailsId }
        });

        let { PACKED = 0, UNPACKED = 0, PRODUCTION = 0 } = orderDetail.stock_usage || {};
        let {
            PACKED: packedQty = 0,
            UNPACKED: unPackedQty = 0,
            PRODUCTION: productionQty = 0
        } = orderDetail.stock_flags || {};

        const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const appendNote = (text) => { orderDetail.notes = (orderDetail.notes || "") + ` | ${text}`; };

        if (updateDto.has_production_completed && productionQty > 0) {
            unPackedQty += productionQty;
            productionQty = 0;
            PRODUCTION = 0;
        }

        if (updateDto.has_unPacked_completed && unPackedQty > 0) {
            packedQty += unPackedQty;
            unPackedQty = 0;
            UNPACKED = 0;
        }

        let STOCK_RETURN_PACKED = 0;
        let STOCK_RETURN_UNPACKED = 0;

        if (typeof updateDto.cancel_qty !== "undefined") {
            const cancelQty = safeNumber(updateDto.cancel_qty);

            if (cancelQty <= 0) throw new BadRequestException("Cancel quantity must be greater than 0.");
            if (cancelQty > orderDetail.qty_ordered - orderDetail.qty_delivered) {
                throw new BadRequestException("Cancel quantity exceeds remaining orderable quantity.");
            }

            orderDetail.qty_ordered -= cancelQty;
            let remaining = cancelQty;

            // consume production
            if (productionQty > 0 && remaining > 0) {
                const used = Math.min(productionQty, remaining);
                productionQty -= used;
                PRODUCTION = Math.max(0, PRODUCTION - used);
                remaining -= used;
            }

            // consume unpacked
            if (unPackedQty > 0 && remaining > 0) {
                const used = Math.min(unPackedQty, remaining);
                unPackedQty -= used;
                STOCK_RETURN_UNPACKED += used;
                UNPACKED = Math.max(0, UNPACKED - used);
                remaining -= used;
            }

            // consume packed
            if (remaining > 0) {
                const used = Math.min(packedQty, remaining);
                packedQty -= used;
                STOCK_RETURN_PACKED += used;
                PACKED = Math.max(0, PACKED - used);
                remaining -= used;
            }

            const unitPrice = safeNumber(orderDetail.unit_product_price);
            const unitDiscount = safeNumber(orderDetail.dealer_discount);
            orderDetail.total_product_price = unitPrice * orderDetail.qty_ordered;
            orderDetail.total_dealer_discount = unitDiscount * orderDetail.qty_ordered;
            orderDetail.total_price = orderDetail.total_product_price - orderDetail.total_dealer_discount;
            appendNote(`Cancelled ${cancelQty} units`);
        }

        if (STOCK_RETURN_UNPACKED > 0 || STOCK_RETURN_PACKED > 0) {
            await persistStockReturns({
                product,
                returns: [
                    { qty: STOCK_RETURN_UNPACKED, type: STOCK_TYPES.STOCK_UNPACKED },
                    { qty: STOCK_RETURN_PACKED, type: STOCK_TYPES.STOCK_PACKED }
                ],
                employeeId,
                role: upperRole,
                orderNumber: order.order_number,
                orderDetailsNumber: orderDetail.order_details_number
            });
        }

        if (typeof updateDto.delivered_qty !== "undefined") {
            const deliveredQty = safeNumber(updateDto.delivered_qty);
            if (deliveredQty <= 0) throw new BadRequestException("Delivered quantity must be a valid positive number.");

            if (deliveredQty > (orderDetail.qty_ordered - orderDetail.qty_delivered)) {
                throw new BadRequestException("Delivered quantity exceeds remaining undelivered quantity.");
            }

            const deliveredDate = updateDto.delivered_date ? new Date(updateDto.delivered_date) : getISTDate();
            if (isNaN(deliveredDate.getTime())) throw new BadRequestException("Invalid delivered_date format. Must be a valid date.");

            orderDetail.qty_delivered = (orderDetail.qty_delivered || 0) + deliveredQty;
            orderDetail.delivery_date = deliveredDate;
            appendNote(`Delivered ${deliveredQty} unit(s) on ${deliveredDate.toISOString().split("T")[0]}`);
        }

        orderDetail.stock_flags = {
            PACKED: packedQty,
            UNPACKED: unPackedQty,
            PRODUCTION: productionQty,
            hasUnpacked: !!unPackedQty,
            hasProduction: !!productionQty
        };

        if (updateDto.status) {
            const requested = String(updateDto.status).toUpperCase();
            if (!Object.values(ORDER_STATUSES).includes(requested)) throw new BadRequestException(`Invalid status: ${requested}`);

            if ((orderDetail.stock_flags.hasProduction || orderDetail.stock_flags.hasUnpacked) && requested !== ORDER_STATUSES.CANCELLED) {
                throw new BadRequestException("Cannot manually change item status while production or unpacked stock remains.");
            }

            if (!isValidTransition(orderDetail.status, requested) && requested !== ORDER_STATUSES.CANCELLED) {
                if (!(requested === ORDER_STATUSES.DELIVERED && orderDetail.qty_ordered === orderDetail.qty_delivered)) {
                    throw new BadRequestException(`Invalid status transition for order detail: ${orderDetail.status} → ${requested}`);
                }
            } else {
                orderDetail.status = requested;
            }
        } else {
            if (packedQty > 0 && unPackedQty === 0 && productionQty === 0) {
                if (isValidTransition(orderDetail.status, ORDER_STATUSES.PACKING) || orderDetail.status === ORDER_STATUSES.PACKING) {
                    orderDetail.status = ORDER_STATUSES.PACKING;
                }
            }
        }

        if (orderDetail.qty_ordered === 0 && orderDetail.qty_delivered === 0) {
            orderDetail.status = ORDER_STATUSES.CANCELLED;
        }
        else if (orderDetail.qty_ordered === orderDetail.qty_delivered) {
            orderDetail.status = ORDER_STATUSES.DELIVERED;
            orderDetail.delivery_date = getISTDate();
        } else if (orderDetail.stock_flags.hasProduction || orderDetail.stock_flags.hasUnpacked) {
            orderDetail.status = ORDER_STATUSES.PRODUCTION;
        } else if (packedQty > 0) {
            orderDetail.status = ORDER_STATUSES.PACKING;
        } else if (!orderDetail.status) {
            orderDetail.status = ORDER_STATUSES.PENDING;
        }

        if (orderDetail.qty_ordered !== 0 && orderDetail.qty_ordered !== orderDetail.qty_delivered) {
            const remainingQty = orderDetail.qty_ordered - orderDetail.qty_delivered;
            const today = new Date().toISOString().split("T")[0];
            const note = `Pending delivery: ${remainingQty} unit(s) as of ${today}`;
            if (!orderDetail.notes?.includes(note)) {
                appendNote(note);
            }
        }

        await orderDetail.save();

        if (typeof updateDto.cancel_qty !== "undefined") {
            const allOrderDetails = [orderDetail, ...otherOrderDetails];
            order.order_total_price = allOrderDetails.filter(od => !od.is_free).reduce((s, od) => s + (od.total_price || 0), 0);
            order.order_total_discount = allOrderDetails.filter(od => !od.is_free).reduce((s, od) => s + (od.total_dealer_discount || 0), 0);

            product.available_stock = await productService.calculateAvailableStock(product.product_id);
            await product.save();
            await order.save();
        }

        const updatedDetails = await OrderDetails.find({ order_number: order.order_number });
        let derivedOrderStatus = deriveOrderStatusFromDetails(updatedDetails);

        if ([ORDER_STATUSES.INVOICE, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(derivedOrderStatus)) {
            if (!canMoveOrderToInvoice(updatedDetails)) {
                derivedOrderStatus = deriveOrderStatusFromDetails(updatedDetails); // keeps PRODUCTION/PACKING priority
            }
        }

        if (allDetailsDelivered(updatedDetails)) {
            order.status = ORDER_STATUSES.COMPLETED;
        } else {
            order.status = derivedOrderStatus;
        }

        await order.save();

        // if (order.amount_paid > order.order_total_price) {
        //     // ✅ Instead of blocking the transaction, we now handle dealer’s old balance.
        //     // If a dealer already has a positive balance (advance/credit), and the current payment
        //     // exceeds the order total, the extra amount should be adjusted against that balance.
        //     // This ensures the order can still be completed, and the remaining excess is carried forward
        //     // as the dealer’s updated balance for future transactions.
        //     // throw new BadRequestException("Amount paid cannot exceed total order price.");
        // }

        return mapOrderDetailEntityToResponse(orderDetail);
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (orderNumber, updates) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        ensureAuthenticatedRole(employeeId, employeeRole);

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
        if (order_note && order_note.trim() && order_note !== order.order_note) {
            order.order_note = [order.order_note, order_note.trim()].filter(Boolean).join(' | ');
        }

        if (Array.isArray(order_details) && order_details.length > 0) {
            const detailIds = order_details.map(d => d.order_details_number);
            const orderDetailsList = await OrderDetails.find({ order_details_number: { $in: detailIds } });
            const orderDetailMap = Object.fromEntries(orderDetailsList.map(od => [od.order_details_number, od]));

            for (const dto of order_details) {
                const od = orderDetailMap[dto.order_details_number];
                if (od) await orderService.updateOrderDetailStatus(od.order_details_number, dto);
            }
        }

        const updatedOrderDetails = await OrderDetails.find({ order_number: orderNumber });

        if (status) {
            const normalized = String(status).toUpperCase();
            if (!Object.values(ORDER_STATUSES).includes(normalized)) throw new BadRequestException(`Invalid order status: ${normalized}`);

            const prev = order.status;

            if (prev === normalized) {
                logger.info(`Order ${orderNumber} is already in status '${prev}'. No update needed.`);
            } else if ([ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED].includes(prev)) {
                throw new BadRequestException(`Order ${orderNumber} is already '${prev}' and cannot be updated.`);
            } else if (normalized === ORDER_STATUSES.REJECTED) {
                if (prev !== ORDER_STATUSES.PENDING) throw new BadRequestException("REJECTED is only allowed from PENDING.");
                order.status = ORDER_STATUSES.REJECTED;
                await order.save();
                return transformOrderToResponse(order, null, updatedOrderDetails);
            } else if (normalized === ORDER_STATUSES.CANCELLED) {
                if (!CANCELLABLE_STATUSES.has(prev)) throw new BadRequestException(`Cannot cancel order at status '${prev}'. Cancellation allowed only before INVOICE.`);
                for (const d of updatedOrderDetails) {
                    await returnStockForDetail({ d, employeeId, employeeRole, orderNumber });
                    d.status = ORDER_STATUSES.CANCELLED;
                    await d.save();
                }
                order.order_total_discount = 0;
                order.order_total_price = 0;
                order.status = ORDER_STATUSES.CANCELLED;
                await order.save();
                return transformOrderToResponse(order, null, updatedOrderDetails);
            } else {
                // disallow moving to INVOICE+ if any detail is PRODUCTION/PACKING
                if ([ORDER_STATUSES.INVOICE, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(normalized)) {
                    if (!canMoveOrderToInvoice(updatedOrderDetails)) {
                        throw new BadRequestException(`Cannot move order to '${normalized}' while one or more details are in PRODUCTION or PACKING.`);
                    }
                }
                if (!isValidTransition(prev, normalized)) throw new BadRequestException(`Invalid order status transition: ${prev} → ${normalized}`);
                order.status = normalized;
            }
        } else {
            let derived = deriveOrderStatusFromDetails(updatedOrderDetails);
            if (derived === ORDER_STATUSES.INVOICE && !canMoveOrderToInvoice(updatedOrderDetails)) {
                derived = deriveOrderStatusFromDetails(updatedOrderDetails); // remain PRODUCTION/PACKING
            }
            order.status = derived;
        }

        if (allDetailsDelivered(updatedOrderDetails)) order.status = ORDER_STATUSES.COMPLETED;

        if (typeof amount_paid !== "undefined" && order.status !== ORDER_STATUSES.CANCELLED && order.status !== ORDER_STATUSES.REJECTED) {
            const paidAmount = Number(amount_paid) || 0;
            await order.addPayment(paidAmount, payment_method || "CASH");
        }

        await order.save();
        return transformOrderToResponse(order, null, updatedOrderDetails);
    }),

    updateOrderStatus: asyncHandler(async (orderNumber, newStatus) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const upperRole = ensureAuthenticatedRole(employeeId, employeeRole);

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
            if (!canMoveOrderToInvoice(details)) {
                throw new BadRequestException(
                    `Cannot move order to '${normalized}' because one or more items are still in PRODUCTION or PACKING.`
                );
            }
        }

        if (normalized === ORDER_STATUSES.CONFIRMED) {
            if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(upperRole)) {
                throw new BadRequestException(`You are not authorized to set status to '${normalized}'.`);
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

        if (allDetailsDelivered(details)) {
            order.status = ORDER_STATUSES.COMPLETED;
        } else {
            order.status = normalized;
        }

        await order.save();

        logger.info(`🔄 Order Status Updated — order_number: ${orderNumber} | ${prev} → ${order.status}`);

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const refreshedDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, refreshedDetails);
    }),

}

export { orderService };