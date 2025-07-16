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

import { ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES } from "../utils/constants.js";
import { transformOrderToResponse } from "../utils/modelMapper.js";

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

const fetchDealerAndOrderDetails = async(orders) => {
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
        const { employeeId, role } = getAuthenticatedEmployeeContext();

        if (!employeeId || !role || !Object.values(ORDER_CREATOR_ROLES).includes(role.toUpperCase())) {
            throw new UnauthorizedException(`Access denied: only users with roles ${Object.values(ORDER_CREATOR_ROLES).join(', ')} are authorized to create orders.`);
        }

        const dealer = await validateOrderDTO(dto);
        const orderNumber = await generateUniqueOrderId();

        const order = new Order({
            order_number: orderNumber,
            dealer_id: sanitizeInput(dealer.employee_id),
            created_by: employeeId,
            priority: sanitizeInput(dto.priority),
            order_note: sanitizeInput(dto.order_note || ""),
        });

        await order.save();
        logger.info(`✅Order created: ${ orderNumber }`, { orderNumber });

        const orderDetailsList = await Promise.all(
            dto.order_details.map(async(detail) => {
                const orderDetail = new OrderDetails({
                    order_details_number: await generateUniqueOrderDetailsId(),
                    order_number: orderNumber,
                    product_id: sanitizeInput(detail.product_id),
                    product_brand: sanitizeInput(detail.product_brand),
                    product_name: sanitizeInput(detail.product_name),
                    product_model: sanitizeInput(detail.product_model),
                    product_type: sanitizeInput(detail.product_type),
                    qty_ordered: Number(detail.qty_ordered),
                    delivery_date: new Date(detail.delivery_date)
                });

                return await orderDetail.save();
            })
        );

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async(orderNumber) => {
        const order = await Order.findOne({ order_number: orderNumber });
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