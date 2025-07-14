// controller/productController.js
import asyncHandler from "express-async-handler";
import xss from "xss";
import { productService, mapEntityToResponse } from "../service/productService.js";
import logger from "../utils/logger.js";

function sanitizeInput(req, res, next) {
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === "string") {
                req.body[key] = xss(req.body[key]);
            }
        }
    }
    next();
}

const productController = {
    sanitizeInput,
    createProduct: asyncHandler(async(req, res) => {
        const productData = await productService.createProduct(req.body);
        res.status(201).json({
            success: true,
            status: 201,
            message: "🎉 Product created successfully!",
            data: productData,
            timestamp: new Date().toISOString()
        });
    }),

    updateProduct: asyncHandler(async(req, res) => {
        const { productId } = req.params;
        const productData = await productService.updateProduct(productId, req.body);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product updated successfully!",
            data: productData,
            timestamp: new Date().toISOString()
        });
    }),

    createOrUpdateProductStocks: asyncHandler(async(req, res) => {
        const { stock_map } = req.body;
        const productStockData = await productService.createOrUpdateProductStock(stock_map);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product updated successfully!",
            data: productStockData,
            timestamp: new Date().toISOString()
        });
    }),

    getByProductId: asyncHandler(async(req, res) => {
        const { productId } = req.params;
        const productData = await productService.getByProductId(productId);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product fetched successfully!",
            data: productData,
            timestamp: new Date().toISOString()
        });
    }),

    getAll: asyncHandler(async(req, res) => {
        const productList = await productService.getAllProducts();
        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Product list fetched successfully!",
            data: productList,
            timestamp: new Date().toISOString()
        });
    }),
};

export default productController;