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

import { APPROVAL_GRANTED_ROLES, ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES } from "../utils/constants.js";
import { transformOrderToResponse } from "../utils/modelMapper.js";
import { productService } from "./productService.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const validateOrderDTO = async(dto) => {
    for (const field of ORDER_REQUIRED_FIELDS) {
        if (!dto[field]) {
            throw new BadRequestException(`'${field}' is required.`);
        }
    }

    const dealer = await Employee.findOne({ employee_id: dto.dealer_id, role: ROLES.DEALER });
    if (!dealer) {
        throw new BadRequestException(`Invalid dealer ID: ${dto.dealer_id}. Dealer not found or not a dealer role.`);
    }

    if (!Array.isArray(dto.order_details) ||
        !dto.order_details.filter(detail =>
            detail &&
            Object.keys(detail).length > 0 &&
            typeof detail.product_id === "string" &&
            detail.product_id.trim() !== ""
        ).length
    ) {
        throw new BadRequestException("At least one valid order detail is required.");
    }

    dto.order_details.forEach((detail, index) => {
        if (!detail ||
            Object.keys(detail).length === 0 ||
            typeof detail.product_id !== "string" ||
            detail.product_id.trim() === ""
        ) {
            return;
        }

        for (const field of ORDER_DETAILS_REQUIRED_FIELDS) {
            if (!detail[field]) {
                throw new BadRequestException(`order_details[${index}]: '${field}' is required.`);
            }
        }

        if (typeof detail.qty_ordered !== "number" || detail.qty_ordered <= 0) {
            throw new BadRequestException(
                `order_details[${index}]: 'qty_ordered' must be a number greater than 0.`
            );
        }

        if (isNaN(Date.parse(detail.delivery_date))) {
            throw new BadRequestException(
                `order_details[${index}]: 'delivery_date' must be a valid date.`
            );
        }
    });

    return dealer;
};

export const fetchDealerAndOrderDetails = async(orders) => {
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
    createOrder: asyncHandler(async(dto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!employeeId || !employeeRole || !Object.values(ORDER_CREATOR_ROLES).includes(employeeRole.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ORDER_CREATOR_ROLES).join(', ')} are authorized to create orders.`);
        }

        const salesmanId = employeeRole === "ROLE_SALESMAN" ? employeeId : sanitizeInput(dto.salesman_id);

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

        const orderDetailsPayload = await Promise.all(dto.order_details.map(async(detail) => {
            const product = productMap.get(detail.product_id);
            if (!product) {
                throw new BadRequestException(`Product not found: ${detail.product_id}`);
            }

            const stocks = productStockMap.get(detail.product_id) || [];
            const qtyOrdered = Number(detail.qty_ordered);

            logger.info("📦 Stocks for %s: %o", detail.product_id, stocks);

            const isProductScheme = Boolean(detail.is_product_scheme);
            logger.info("is_product_scheme for %s: %s", product.product_id, isProductScheme);

            const { productionRequired, unpackedUsed } = await productService.checkAndReserveStock(
                product, stocks, qtyOrdered, employeeId, employeeRole, orderNumber
            );

            if (productionRequired > 0 || unpackedUsed > 0) {
                hasPendingProduction = true;
            }

            let unitPrice = product.price;
            let unitDiscount = 0;

            if (detail.dealer_discount_id) {
                const dealerDiscount = await DealerDiscount.findOne({
                    dealer_discount_id: sanitizeInput(detail.dealer_discount_id),
                    dealer_id: dealer.employee_id,
                    brand_name: product.brand,
                    model_name: product.model
                });

                if (dealerDiscount) {
                    unitDiscount = dealerDiscount.isPercentage() ?
                        (unitPrice * dealerDiscount.discount_value) / 100 :
                        dealerDiscount.discount_value;
                    unitPrice -= unitDiscount;
                }
            }

            const totalProductPrice = product.price * qtyOrdered;
            const totalDiscount = unitDiscount * qtyOrdered;
            const totalPrice = totalProductPrice - totalDiscount;

            if (!isProductScheme) {
                totalOrderAmount += totalProductPrice;
                totalOrderDiscount += totalDiscount;
            }

            let notes = "";
            if (productionRequired > 0) {
                notes += `Production Required: ${productionRequired} units`;
            }
            if (unpackedUsed > 0) {
                notes += (notes ? " | " : "") + `Unpacked Required for Packing: ${unpackedUsed} units`;
            }

            return {
                order_details_number: await generateUniqueOrderDetailsId(),
                order_number: orderNumber,
                product_id: product.product_id,
                product_brand: product.brand,
                product_name: product.product_name,
                product_model: product.model,
                product_type: product.product_type,
                qty_ordered: qtyOrdered,
                delivery_date: new Date(detail.delivery_date),
                notes,
                status: productionRequired > 0 || unpackedUsed > 0 ?
                    "PENDING_PRODUCTION" : "PENDING",
                unit_product_price: product.price,
                total_product_price: totalProductPrice,
                dealer_discount: unitDiscount,
                total_dealer_discount: totalDiscount,
                total_price: totalPrice,
                is_free: isProductScheme
            };
        }));

        order.status = hasPendingProduction ? "PENDING_PRODUCTION" : "PENDING";
        order.sales_target_updated = false;
        order.order_total_price = totalOrderAmount;
        order.order_total_discount = totalOrderDiscount;

        if (order.amount_paid > order.order_total_price) {
            throw new BadRequestException("Amount paid cannot exceed total order price.");
        }

        await order.save();
        logger.info(`💾 Order Saved — order_number: ${orderNumber} || total_price: ${order.order_total_price} || discount: ${order.order_total_discount} || amount_paid: ${order.amount_paid}`);

        const orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);

        logger.info(`✅ Order Created Successfully — order_number: ${orderNumber} || total_items: ${orderDetailsList.length}`);
        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async(orderNumber) => {
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const orderDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

    getAllOrders: asyncHandler(async() => {
        const orders = await Order.find().sort({ created_at: -1 });
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) =>
            transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
        );
    }),

    getByOrderStatus: asyncHandler(async(orderStatus) => {
        const orders = await Order.findByOrderStatus(orderStatus);
        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);
        return orders.map((order) =>
            transformOrderToResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
        );
    }),

    getOrdersByDateFilter: asyncHandler(async({ year, month, start_date, end_date }) => {
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

    // updateOrder: ({

    // });


    // updateOrderDetails: ({

    // });

}

export { orderService };