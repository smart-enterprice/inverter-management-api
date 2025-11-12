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
import { getAuthenticatedEmployeeContext, sanitizeInput } from "../utils/validationUtils.js";

import { APPROVAL_GRANTED_ROLES, getISTDate, ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES, STOCK_ACTIONS, STOCK_TYPES, VALID_ORDER_STATUSES, VALID_PAYMENT_STATUSES } from "../utils/constants.js";
import { mapOrderDetailEntityToResponse, transformOrderToResponse } from "../utils/modelMapper.js";
import { productService, saveOrUpdateStockTransaction } from "./productService.js";
import Product from "../models/product.js";

dayjs.extend(utc);
dayjs.extend(timezone);

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
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ORDER_CREATOR_ROLES).join(', ')} are authorized to create orders.`);
        }

        const salesmanId = employeeRole === 'ROLE_SALESMAN' ? employeeId : sanitizeInput(dto.salesman_id);

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

            logger.info('📦 Stocks for %s: %o', detail.product_id, stockDoc);

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

            if (Number.isNaN(unitDiscount) || unitDiscount < 0) unitDiscount = 0;
            if (unitDiscount > unitPrice) {
                logger.warn(`Clamping unit discount for product ${product.product_id}: unitDiscount(${unitDiscount}) > unitPrice(${unitPrice}).`);
                unitDiscount = unitPrice;
            }

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
                status: (productionRequired > 0 || unpackedUsed > 0) ? "PENDING_PRODUCTION" : "PENDING",
                unit_product_price: unitPrice,
                total_product_price: totalProductPrice,
                dealer_discount: unitDiscount,
                total_dealer_discount: totalDiscount,
                total_price: totalPrice,
                is_free: isProductScheme
            };
            orderDetailsPayload.push(orderDetails);
        }

        order.status = hasPendingProduction ? 'PENDING_PRODUCTION' : 'PENDING';
        order.sales_target_updated = false;
        order.order_total_price = totalOrderAmount;
        order.order_total_discount = totalOrderDiscount;

        // if (order.amount_paid > order.order_total_price) {
        //     // ✅ Instead of blocking the transaction, we now handle dealer’s old balance.
        //     // If a dealer already has a positive balance (advance/credit), and the current payment
        //     // exceeds the order total, the extra amount should be adjusted against that balance.
        //     // This ensures the order can still be completed, and the remaining excess is carried forward
        //     // as the dealer’s updated balance for future transactions.
        //     // throw new BadRequestException("Amount paid cannot exceed total order price.");
        // }

        await order.save();

        let orderDetailsList = [];
        if (orderDetailsPayload.length > 0) {
            orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);
        }
        logger.info(`✅ Order created successfully — Order#: ${orderNumber} | Total Items: ${orderDetailsList.length}`);

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async (orderNumber) => {
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const orderDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

    getAllOrders: asyncHandler(async () => {
        const orders = await Order.find().sort({ created_at: -1 });
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) =>
            transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
        );
    }),

    getByOrderStatus: asyncHandler(async (orderStatus) => {
        const orders = await Order.findByOrderStatus(orderStatus);
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);
        return orders.map((order) =>
            transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
        );
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

        const orders = await Order.find({
            created_at: { $gte: startDate, $lte: endDate }
        }).sort({ created_at: -1 });

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) =>
            transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
        );
    }),

    updateOrderDetailStatus: asyncHandler(async (orderDetailsId, updateDto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!employeeId || !employeeRole || !Object.values(ROLES).includes(employeeRole.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ROLES).join(", ")} are authorized to update order details.`);
        }

        const orderDetail = await OrderDetails.findOne({ order_details_number: orderDetailsId });
        if (!orderDetail) throw new BadRequestException(`No order detail found for ID: ${orderDetailsId}`);

        const product = await Product.findOne({ product_id: orderDetail.product_id });
        const order = await Order.findByOrderNumber(orderDetail.order_number);
        if (!order) throw new BadRequestException(`No order found for: ${orderDetail.order_number}`);

        const otherOrderDetails = await OrderDetails.find({
            order_number: order.order_number,
            order_details_number: { $ne: orderDetailsId }
        });

        let { PACKED, UNPACKED, PRODUCTION } = orderDetail.stock_usage;
        let {
            PACKED: packedQty,
            UNPACKED: unPackedQty,
            PRODUCTION: productionQty,
            hasUnpacked,
            hasProduction
        } = orderDetail.stock_flags;

        if (updateDto.has_production_completed && productionQty > 0) {
            unPackedQty += productionQty;
            productionQty = 0;
            hasProduction = false;
        }

        if (updateDto.has_unPacked_completed && unPackedQty > 0) {
            packedQty += unPackedQty;
            unPackedQty = 0;
            hasUnpacked = false;
        }

        let STOCK_RETURN_PACKED = 0;
        let STOCK_RETURN_UNPACKED = 0;

        if (updateDto.cancel_qty !== undefined) {
            const cancelQty = Number(updateDto.cancel_qty);

            if (cancelQty <= 0) throw new BadRequestException("Cancel quantity must be greater than 0.");
            if (cancelQty > orderDetail.qty_ordered - orderDetail.qty_delivered) {
                throw new BadRequestException("Cancel quantity exceeds remaining orderable quantity.");
            }

            orderDetail.qty_ordered -= cancelQty;
            let remainingQty = cancelQty;

            if (hasProduction && remainingQty > 0) {
                if (productionQty >= remainingQty) {
                    productionQty -= remainingQty;
                    PRODUCTION -= remainingQty;
                    remainingQty = 0;
                } else {
                    remainingQty -= productionQty;
                    PRODUCTION = 0;
                    productionQty = 0;
                }
            }

            if (hasUnpacked && remainingQty > 0) {
                if (unPackedQty >= remainingQty) {
                    unPackedQty -= remainingQty;
                    STOCK_RETURN_UNPACKED = hasProduction ? remainingQty : remainingQty + productionQty;
                    UNPACKED -= remainingQty;
                    remainingQty = 0;
                } else {
                    STOCK_RETURN_UNPACKED = hasProduction ? unPackedQty : unPackedQty + productionQty;
                    remainingQty -= unPackedQty;
                    UNPACKED = 0;
                    unPackedQty = 0;
                }
            }

            if (remainingQty > 0) {
                if (packedQty >= remainingQty) {
                    packedQty -= remainingQty;
                    STOCK_RETURN_PACKED = (!hasProduction && !hasUnpacked)
                        ? remainingQty + unPackedQty + productionQty
                        : remainingQty;
                    PACKED -= remainingQty;
                } else {
                    STOCK_RETURN_PACKED = packedQty;
                    packedQty = 0;
                    PACKED = 0;
                }
            }

            const unitPrice = orderDetail.unit_product_price;
            const unitDiscount = orderDetail.dealer_discount;

            orderDetail.total_product_price = unitPrice * orderDetail.qty_ordered;
            orderDetail.total_dealer_discount = unitDiscount * orderDetail.qty_ordered;
            orderDetail.total_price = orderDetail.total_product_price - orderDetail.total_dealer_discount;
            orderDetail.notes += ` | Cancelled ${cancelQty} units`;
        }

        if (STOCK_RETURN_UNPACKED > 0 || STOCK_RETURN_PACKED > 0) {
            const stockReturns = [
                { qty: STOCK_RETURN_UNPACKED, type: STOCK_TYPES.STOCK_UNPACKED },
                { qty: STOCK_RETURN_PACKED, type: STOCK_TYPES.STOCK_PACKED }
            ];

            for (const { qty, type } of stockReturns) {
                if (qty > 0) {
                    await saveOrUpdateStockTransaction({
                        product,
                        quantity: qty,
                        action: STOCK_ACTIONS.STOCK_RETURN,
                        stockType: type,
                        employeeId,
                        role: employeeRole,
                        orderNumber: order.order_number,
                        orderDetailsNumber: orderDetail.order_details_number
                    });
                }
            }
        }

        if (updateDto.delivered_qty !== undefined) {
            const deliveredQty = Number(updateDto.delivered_qty);

            if (isNaN(deliveredQty) || deliveredQty <= 0) {
                throw new BadRequestException("Delivered quantity must be a valid positive number.");
            }

            const deliveredDate = updateDto.delivered_date
                ? new Date(updateDto.delivered_date)
                : getISTDate();

            if (isNaN(deliveredDate.getTime())) {
                throw new BadRequestException("Invalid delivered_date format. Must be a valid date.");
            }

            orderDetail.qty_delivered += deliveredQty;
            orderDetail.delivery_date = deliveredDate;

            const formattedDate = deliveredDate.toISOString().split("T")[0];
            orderDetail.notes += ` | Delivered ${deliveredQty} unit(s) on ${formattedDate}`;
        }

        orderDetail.stock_usage = { PACKED, UNPACKED, PRODUCTION };
        orderDetail.stock_flags = {
            PACKED: packedQty,
            UNPACKED: unPackedQty,
            PRODUCTION: productionQty,
            hasUnpacked,
            hasProduction
        };

        if (updateDto.status && !hasProduction && !hasUnpacked) {
            const newStatus = updateDto.status.toUpperCase();

            if (orderDetail.status !== newStatus) {
                if (newStatus === "DELIVERED" && orderDetail.qty_ordered !== orderDetail.qty_delivered) {
                    throw new BadRequestException(
                        "Cannot mark as DELIVERED. Ordered quantity does not match delivered quantity."
                    );
                }

                orderDetail.status = newStatus;
            }
        }

        let newStatus = orderDetail.status;

        if (updateDto.status && VALID_ORDER_STATUSES.includes(updateDto.status.toUpperCase())) {
            newStatus = updateDto.status.toUpperCase();
        } else {
            if (orderDetail.qty_ordered === orderDetail.qty_delivered) {
                newStatus = "DELIVERED";
            } else if (hasProduction || hasUnpacked) {
                newStatus = "PENDING_PRODUCTION";
            }
        }

        orderDetail.status = newStatus;

        if (orderDetail.qty_ordered !== 0) {
            if (orderDetail.qty_ordered === orderDetail.qty_delivered) {
                orderDetail.status = "DELIVERED";
                orderDetail.delivery_date = getISTDate();
            } else {
                const remainingQty = orderDetail.qty_ordered - orderDetail.qty_delivered;
                const currentDate = new Date().toISOString().split("T")[0];
                orderDetail.notes = (orderDetail.notes || "") +
                    ` | Pending delivery: ${remainingQty} unit(s) as of ${currentDate}`;
            }
        }

        await orderDetail.save();

        if (updateDto.cancel_qty !== undefined) {
            const allOrderDetails = [orderDetail, ...otherOrderDetails];

            order.order_total_price = allOrderDetails
                .filter(od => !od.is_free)
                .reduce((sum, od) => sum + od.total_price, 0);

            order.order_total_discount = allOrderDetails
                .filter(od => !od.is_free)
                .reduce((sum, od) => sum + od.total_dealer_discount, 0);

            // if (order.amount_paid > order.order_total_price) {
            //     // ✅ Instead of blocking the transaction, we now handle dealer’s old balance.
            //     // If a dealer already has a positive balance (advance/credit), and the current payment
            //     // exceeds the order total, the extra amount should be adjusted against that balance.
            //     // This ensures the order can still be completed, and the remaining excess is carried forward
            //     // as the dealer’s updated balance for future transactions.
            //     // throw new BadRequestException("Amount paid cannot exceed total order price.");
            // }

            product.available_stock = await productService.calculateAvailableStock(product.product_id);
            await product.save();
        }

        return mapOrderDetailEntityToResponse(orderDetail);
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (orderNumber, updates) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!employeeId || !employeeRole || !Object.values(ROLES).includes(employeeRole.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ROLES).join(", ")} are authorized to update order details.`);
        }

        if (!updates || typeof updates !== "object") {
            throw new BadRequestException("Invalid request body.");
        }

        const {
            order_number,
            priority,
            order_note,
            status,
            amount_paid,
            payment_method,
            order_details = []
        } = updates;

        if (order_number !== orderNumber) {
            throw new BadRequestException(`Order number mismatch: path(${orderNumber}) ≠ body(${order_number}).`);
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        if (priority && priority !== order.priority) {
            order.priority = priority;
        }

        if (order_note && order_note.trim() && order_note !== order.order_note) {
            order.order_note = order_note.trim();
        }

        if (Array.isArray(order_details) && order_details.length > 0) {
            const detailIds = order_details.map(d => d.order_details_number);
            const orderDetailsList = await OrderDetails.find({ order_details_number: { $in: detailIds } });

            for (const dto of order_details) {
                const orderDetail = orderDetailsList.find(od => od.order_details_number === dto.order_details_number);
                if (orderDetail) {
                    await orderService.updateOrderDetailStatus(orderDetail.order_details_number, dto);
                }
            }
        }

        const updatedOrderDetails = await OrderDetails.find({ order_number: orderNumber });

        if (status && VALID_ORDER_STATUSES.includes(status.toUpperCase())) {
            const normalizedStatus = status.toUpperCase();

            switch (normalizedStatus) {
                case "CANCELLED":
                    const cancelledDetails = updatedOrderDetails.map(detail => ({
                        order_details_number: detail.order_details_number,
                        cancel_qty: detail.qty_ordered,
                        status: "CANCELLED",
                    }));

                    for (const dto of cancelledDetails) {
                        await orderService.updateOrderDetailStatus(dto.order_details_number, dto);
                    }

                    order.order_total_discount = 0;
                    order.order_total_price = 0;
                    order.status = "CANCELLED";
                    break;

                case "PENDING":
                    const requiresProduction = updatedOrderDetails.some(d =>
                        d.status === "PENDING_PRODUCTION"
                    );
                    order.status = requiresProduction ? "PENDING_PRODUCTION" : "PENDING";
                    break;

                case "APPROVED":
                    order.status = "APPROVED";
                    break;

                default:
                    order.status = normalizedStatus;
            }

        }

        if (typeof amount_paid !== "undefined" && (!status || status.toUpperCase() !== "CANCELLED")) {
            const paidAmount = Number(amount_paid) || 0;
            await order.addPayment(paidAmount, payment_method || "CASH");
        }

        await order.save();

        return transformOrderToResponse(order, null, updatedOrderDetails);
    }),

    updateOrderStatus: asyncHandler(async (orderNumber, newStatus) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        if (!employeeId || !employeeRole || !Object.values(ROLES).includes(employeeRole.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ROLES).join(', ')} are authorized to create orders.`);
        }

        if (["APPROVED", "CANCELLED"].includes(newStatus)) {
            if (![ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(employeeRole)) {
                throw new BadRequestException(`You are not authorized to change status to '${newStatus}'.`);
            }
        }

        if (!VALID_ORDER_STATUSES.includes(newStatus)) {
            throw new BadRequestException(`Invalid order status: ${newStatus}. Valid statuses are: ${VALID_ORDER_STATUSES.join(", ")}`);
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        const previousStatus = order.status;

        if (previousStatus === newStatus) {
            throw new BadRequestException(`Order ${orderNumber} is already in status '${previousStatus}'.`);
        }

        if (["DELIVERED", "CANCELLED"].includes(previousStatus)) {
            throw new BadRequestException(`Order ${orderNumber} is already '${previousStatus}' and cannot be updated.`);
        }

        if (newStatus === "CANCELLED") {
            const orderDetails = await OrderDetails.find({ order_number: orderNumber });

            for (const d of orderDetails) {
                const { PACKED, UNPACKED, PRODUCTION } = d.stock_usage || { PACKED: 0, UNPACKED: 0, PRODUCTION: 0 };
                await productService.returnStock({
                    product_id: d.product_id,
                    quantity: d.qty_ordered,
                    employeeId,
                    employeeRole,
                    orderNumber,
                    stock_usage: { PACKED, UNPACKED, PRODUCTION },
                });
            }
        }

        order.status = newStatus;
        await order.save();

        logger.info(`🔄 Order Status Updated — order_number: ${orderNumber} || new_status: ${newStatus}`);

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const orderDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

}

export { orderService };