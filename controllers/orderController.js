// controllers/orderController.js

import asyncHandler from "express-async-handler";
import xss from "xss";

import { orderService } from "../service/orderService.js";
import logger from "../utils/logger.js";

const sanitizeInput = (req, res, next) => {
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === "string") {
                req.body[key] = xss(req.body[key]);
            }
        }
    }
    next();
};

const orderController = {
    sanitizeInput,
    createOrder: asyncHandler(async(req, res) => {
        const orderData = await orderService.createOrder(req.body);

        res.status(201).json({
            success: true,
            status: 201,
            message: "🎉 Order created successfully!",
            data: orderData,
            timestamp: new Date().toISOString()
        });
    }),

    getByOrderId: asyncHandler(async(req, res) => {
        const { orderId } = req.params;
        const orderData = await orderService.getByOrderId(orderId);

        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Order fetched successfully!",
            data: orderData,
            timestamp: new Date().toISOString()
        });
    }),

    getAll: asyncHandler(async(req, res) => {
        const orders = await orderService.getAllOrders();

        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Order list fetched successfully!",
            data: orders,
            timestamp: new Date().toISOString()
        });
    }),

    // You can uncomment and implement updateOrder if needed in the future
    /*
    updateOrder: asyncHandler(async (req, res) => {
      const { orderId } = req.params;
      const updatedOrder = await orderService.updateOrder(orderId, req.body);

      res.status(200).json({
        success: true,
        status: 200,
        message: "✅ Order updated successfully!",
        data: updatedOrder,
        timestamp: new Date().toISOString()
      });
    }),
    */
};

export default orderController;