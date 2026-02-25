// controllers/orderController.js

import asyncHandler from "express-async-handler";
import { buildResponse } from "../utils/responseUtils.js";
import { orderService } from "../service/order/orderService.js";
import { sanitizeInput } from "../utils/validationUtils.js";

const orderController = {
    createOrder: asyncHandler(async (req, res) => {
        const data = await orderService.createOrder(req.body);
        buildResponse({
            res,
            status: 201,
            message: "🎉 Order created successfully!",
            data
        });
    }),

    getByOrderId: asyncHandler(async (req, res) => {
        const data = await orderService.getByOrderId(req.params.orderId);
        buildResponse({
            res,
            message: "✅ Order fetched successfully!",
            data
        });
    }),

    getAll: asyncHandler(async (req, res) => {
        const includeRejected = req.query.includeRejected === "true";
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;

        const status = sanitizeInput(req.query.status);
        const priority = sanitizeInput(req.query.priority);
        const search = sanitizeInput(req.query.search);

        const dealer = sanitizeInput(req.query.dealer);

        const result = await orderService.getAllOrders({
            includeRejected,
            page,
            limit,
            status,
            priority,
            search,
            dealer
        });

        buildResponse({
            res,
            message: "Order list fetched successfully",
            data: result.orders,
            extra: {
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / result.limit)
                }
            }
        });
    }),

    getByOrderStatus: asyncHandler(async (req, res) => {
        const data =
            await orderService.getByOrderStatus(req.params.orderStatus);

        buildResponse({
            res,
            message: "✅ Order fetched successfully!",
            data
        });
    }),

    fetchOrdersByDateFilter: asyncHandler(async (req, res) => {
        const data =
            await orderService.getOrdersByDateFilter(req.query);

        buildResponse({
            res,
            message: "Orders fetched successfully",
            data,
            extra: { count: data.length }
        });
    }),

    updateOrderDetailStatus: asyncHandler(async (req, res) => {
        const data =
            await orderService.updateOrderDetailStatus(
                req.params.orderDetailsId,
                req.body
            );

        buildResponse({
            res,
            message: `✅ Order detail ${req.params.orderDetailsId} updated successfully.`,
            data
        });
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (req, res) => {
        const data =
            await orderService.updateMultipleOrderDetailsStatus(
                req.params.orderNumber,
                req.body
            );

        buildResponse({
            res,
            message: `✅ Order ${req.params.orderNumber} details updated successfully.`,
            data
        });
    }),

    updateOrderStatus: asyncHandler(async (req, res) => {
        const { orderNumber } = req.params;
        const { status } = req.body;

        const updatedOrder = await orderService.updateOrderStatus(orderNumber, status);

        res.status(200).json({
            success: true,
            message: `✅ Order ${orderNumber} status updated successfully.`,
            data: updatedOrder,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    updateOrderStatusUnified: asyncHandler(async (req, res) => {
        const data =
            await orderService.updateOrderAndDetails(
                req.params.orderNumber,
                req.body
            );

        buildResponse({
            res,
            message: `✅ Order ${req.params.orderNumber} updated successfully.`,
            data
        });
    })

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