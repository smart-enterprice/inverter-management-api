// controllers/orderController.js

import asyncHandler from "express-async-handler";
import xss from "xss";

import { orderService } from "../service/orderService.js";
import logger from "../utils/logger.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";

const orderController = {
    sanitizeInputBody,
    createOrder: asyncHandler(async (req, res) => {
        const orderData = await orderService.createOrder(req.body);

        res.status(201).json({
            success: true,
            status: 201,
            message: "🎉 Order created successfully!",
            data: orderData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getByOrderId: asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const orderData = await orderService.getByOrderId(orderId);

        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Order fetched successfully!",
            data: orderData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getAll: asyncHandler(async (req, res) => {
        const orders = await orderService.getAllOrders();

        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Order list fetched successfully!",
            data: orders,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getByOrderStatus: asyncHandler(async (req, res) => {
        const { orderStatus } = req.params;
        const orderData = await orderService.getByOrderStatus(orderStatus);

        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Order fetched successfully!",
            data: orderData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    fetchOrdersByDateFilter: asyncHandler(async (req, res) => {
        const { year, month, start_date, end_date } = req.query;

        const orders = await orderService.getOrdersByDateFilter({
            year,
            month,
            start_date,
            end_date
        });

        res.status(200).json({
            success: true,
            count: orders.length,
            data: orders,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    updateOrderDetailStatus: asyncHandler(async (req, res) => {
        const { orderDetailsId } = req.params;
        const updateDto = req.body;

        const updatedOrderDetail = await orderService.updateOrderDetailStatus(orderDetailsId, updateDto);

        res.status(200).json({
            success: true,
            message: `✅ Order detail ${orderDetailsId} updated successfully.`,
            data: updatedOrderDetail,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (req, res) => {
        const { orderNumber } = req.params;
        const updates = req.body;

        const result = await orderService.updateMultipleOrderDetailsStatus(orderNumber, updates);

        res.status(200).json({
            success: true,
            message: `Order ${orderNumber} details updated successfully.`,
            count: updatedOrderDetails.length,
            data: updatedOrderDetails,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
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
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      });
    }),
    */
};

export default orderController;