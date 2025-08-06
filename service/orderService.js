// service/orderService.js

import asyncHandler from "express-async-handler";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import logger from "../utils/logger.js";
import Employee from "../models/employees.js";
import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";

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

    if (!Array.isArray(dto.order_details) || dto.order_details.length === 0) {
        throw new BadRequestException("'order_details' must be a non-empty array.");
    }

    dto.order_details.forEach((detail, index) => {
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
        const order = await new Order({
            order_number: orderNumber,
            dealer_id: sanitizeInput(dealer.employee_id),
            created_by: employeeId,
            salesman_id: salesmanId,
            priority: sanitizeInput(dto.priority || "LOW"),
            order_note: sanitizeInput(dto.order_note || ""),
        }).save();

        const productIds = dto.order_details.map(detail => detail.product_id);
        const { productMap, productStockMap } = await productService.getProductsByIds(productIds);

        const orderDetailsPayload = await Promise.all(
            dto.order_details.map(async(detail) => {
                const product = productMap.get(detail.product_id);
                const stocks = productStockMap.get(detail.product_id) || [];

                if (!product) {
                    throw new BadRequestException(`Product not found: ${detail.product_id}`);
                }

                logger.info("📦 Stocks for", detail.product_id, stocks);

                const { productionRequired } = await productService.checkAndReserveStock(product, stocks, Number(detail.qty_ordered), employeeId, employeeRole);

                const notes = productionRequired > 0 ? ` | Production Required: ${productionRequired} stock`  : "";
                return {
                    order_details_number: await generateUniqueOrderDetailsId(),
                    order_number: orderNumber,
                    product_id: product.product_id,
                    product_brand: product.brand,
                    product_name: product.product_name,
                    product_model: product.model,
                    product_type: product.product_type,
                    qty_ordered: Number(detail.qty_ordered),
                    delivery_date: new Date(detail.delivery_date),
                    notes: notes,
                    status: productionRequired > 0 ? "PENDING_PRODUCTION" : "PENDING"
                };
            })
        );

        const orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);

        order.sales_target_updated = false;
        await order.save();
        logger.info(`✅Order created: ${ orderNumber }`, { orderNumber });

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async(orderNumber) => {
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${ orderNumber }`);
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

    getByOrderStatus: asyncHandler(async (orderStatus) => {
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
}

export { orderService };