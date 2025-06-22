// service/orderService.js
import asyncHandler from "express-async-handler";
import validator from "validator";
import logger from "../utils/logger.js";
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";
import Employee from "../models/employees.js";
import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";
import { generateUniqueOrderDetailsId, generateUniqueOrderId } from "../utils/generatorIds.js";

const ALLOWED_ROLES = ['ROLE_ADMIN', 'ROLE_SUPER_ADMIN', 'ROLE_SALESMAN'];

function sanitize(value) {
    return typeof value === 'string' ? validator.escape(value.trim()) : value;
}

function mapOrderResponse(order, dealer, orderDetailsList = []) {
    const response = {};

    if (order) {
        response.order = {
            order_number: order.order_number,
            dealer_id: order.dealer_id,
            priority: order.priority,
            order_note: order.order_note,
            status: order.status,
            delivery_date: order.delivery_date,
            created_by: order.created_by,
            created_at: order.created_at,
            updated_at: order.updated_at
        };
    }

    if (dealer) {
        response.dealer = {
            employee_id: dealer.employee_id,
            employee_name: dealer.employee_name,
            employee_email: dealer.employee_email,
            employee_phone: dealer.employee_phone,
            shop_name: dealer.shop_name,
            district: dealer.district,
            town: dealer.town,
            brand: dealer.brand,
            address: dealer.address,
            status: dealer.status,
            created_at: dealer.created_at,
            updated_at: dealer.updated_at
        };
    }

    if (Array.isArray(orderDetailsList) && orderDetailsList.length > 0) {
        response.order_details = orderDetailsList.map(detail => ({
            order_details_number: detail.order_details_number,
            product_id: detail.product_id,
            product_brand: detail.product_brand,
            product_name: detail.product_name,
            product_model: detail.product_model,
            product_type: detail.product_type,
            qty_ordered: detail.qty_ordered,
            qty_delivered: detail.qty_delivered,
            delivery_date: detail.delivery_date,
            status: detail.status,
            created_at: detail.created_at,
            updated_at: detail.updated_at
        }));
    }

    return response;
}

async function createOrder(dto) {
    const employeeId = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();

    if (!employeeId || !role || !ALLOWED_ROLES.includes(role)) {
        throw new UnauthorizedException("Only admins or salesmen can create orders.");
    }

    const requiredFields = ['dealer_id', 'priority', 'order_details'];
    for (const field of requiredFields) {
        if (!dto[field]) {
            throw new BadRequestException(`❌ '${field}' is required.`);
        }
    }

    const dealer = await Employee.findOne({ employee_id: dto.dealer_id, role: 'ROLE_DEALER' });
    if (!dealer) {
        throw new BadRequestException(`❌ Invalid dealer ID: ${dto.dealer_id}. Dealer not found or not a dealer role.`);
    }

    if (!Array.isArray(dto.order_details) || dto.order_details.length === 0) {
        throw new BadRequestException("❌ 'order_details' must be a non-empty array.");
    }

    for (const [index, detail] of dto.order_details.entries()) {
        const requiredDetailFields = ['product_id', 'product_brand', 'product_name', 'product_model', 'product_type', 'qty_ordered', 'delivery_date'];
        for (const field of requiredDetailFields) {
            if (!detail[field]) {
                throw new BadRequestException(`❌ order_details[${index}]: '${field}' is required.`);
            }
        }

        if (typeof detail.qty_ordered !== 'number' || detail.qty_ordered <= 0) {
            throw new BadRequestException(`❌ order_details[${index}]: 'qty_ordered' must be a number greater than 0.`);
        }

        if (isNaN(Date.parse(detail.delivery_date))) {
            throw new BadRequestException(`❌ order_details[${index}]: 'delivery_date' must be a valid date.`);
        }
    }

    const orderNumber = await generateUniqueOrderId();
    const order = new Order({
        order_number: orderNumber,
        dealer_id: sanitize(dealer.employee_id),
        created_by: employeeId,
        priority: sanitize(dto.priority),
        order_note: sanitize(dto.order_note || "")
    });

    await order.save();
    logger.info(`✅ Order created: ${orderNumber}`, { orderNumber });

    const orderDetailsList = await Promise.all(dto.order_details.map(async detail => {
        const orderDetail = new OrderDetails({
            order_details_number: await generateUniqueOrderDetailsId(),
            order_number: orderNumber,
            product_id: sanitize(detail.product_id),
            product_brand: sanitize(detail.product_brand),
            product_name: sanitize(detail.product_name),
            product_model: sanitize(detail.product_model),
            product_type: sanitize(detail.product_type),
            qty_ordered: Number(detail.qty_ordered),
            delivery_date: new Date(detail.delivery_date)
        });
        return await orderDetail.save();
    }));

    return mapOrderResponse(order, dealer, orderDetailsList);
}

async function getByOrderId(orderNumber) {
    const order = await Order.findOne({ order_number: orderNumber });
    if (!order) {
        throw new BadRequestException(`❌ No order found for: ${orderNumber}`);
    }

    const dealer = await Employee.findOne({ employee_id: order.dealer_id });
    const orderDetails = await OrderDetails.find({ order_number: orderNumber });

    return mapOrderResponse(order, dealer, orderDetails);
}

async function getAllOrders() {
    const orders = await Order.find().sort({ created_at: -1 });

    const dealerIds = [...new Set(orders.map(o => o.dealer_id))];
    const orderNumbers = orders.map(o => o.order_number);

    const dealers = await Employee.find({ employee_id: { $in: dealerIds }, role: 'ROLE_DEALER' });
    const orderDetails = await OrderDetails.find({ order_number: { $in: orderNumbers } });

    const dealerMap = Object.fromEntries(dealers.map(d => [d.employee_id, d]));
    const detailsMap = orderDetails.reduce((acc, d) => {
        acc[d.order_number] = acc[d.order_number] || [];
        acc[d.order_number].push(d);
        return acc;
    }, {});

    return orders.map(order =>
        mapOrderResponse(order, dealerMap[order.dealer_id], detailsMap[order.order_number])
    );
}

export const orderService = {
    createOrder: asyncHandler(createOrder),
    getByOrderId: asyncHandler(getByOrderId),
    getAllOrders: asyncHandler(getAllOrders)
};