// controller/productController.js
import asyncHandler from "express-async-handler";
import { productService } from "../service/productService.js";
import { sanitizeInput, sanitizeInputBody } from "../utils/validationUtils.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { buildResponse } from "../utils/responseUtils.js";

const productController = {
    sanitizeInputBody,

    createProduct: asyncHandler(async (req, res) => {
        const productData = await productService.createProduct(req.body);

        res.status(201).json({
            success: true,
            status: 201,
            message: "🎉 Product created successfully!",
            data: productData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    updateProduct: asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const productData = await productService.updateProduct(productId, req.body);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product updated successfully!",
            data: productData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    createOrUpdateProductStocks: asyncHandler(async (req, res) => {
        const { stock_map } = req.body;
        const productStockData = await productService.createOrUpdateProductStock(stock_map);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product updated successfully!",
            data: productStockData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getByProductId: asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const productData = await productService.getByProductId(productId);
        res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Product fetched successfully!",
            data: productData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getAllProductsByBrands: asyncHandler(async (req, res) => {

        const productData = await productService.getAllProductsByBrands(req.body);

        return res.status(200).json({
            success: true,
            status: 200,
            message: "🎉 Products retrieved successfully!",
            count: productData.length,
            data: productData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    getAll: asyncHandler(async (req, res) => {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;

        const search = sanitizeInput(req.query.search);
        const status = sanitizeInput(req.query.status);
        const type = sanitizeInput(req.query.type);

        const result = await productService.getProducts({
            page: Number(page),
            limit: Number(limit),
            search,
            type,
            status
        });

        buildResponse({
            res,
            message: "📦 Products fetched successfully",
            data: result.data,
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

    getAllActiveProducts: asyncHandler(async (req, res) => {
        const productList = await productService.getProducts({ status: "active" }); // only active
        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Active products fetched successfully",
            data: productList,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    getByBrandId: asyncHandler(async (req, res) => {
        const { brandId } = req.params;
        if (!brandId) {
            throw new BadRequestException("Brand ID is required");
        }

        const brandData = await productService.getByBrandId(brandId);
        res.status(200).json({
            success: true,
            status: 200,
            message: `📦 Brand details for ID ${brandId} fetched successfully`,
            data: brandData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getAllBrands: asyncHandler(async (req, res) => {
        const dealerId = req.query.dealerId || "all";
        const status = req.query.status || "all";

        const brandListData = await productService.getAllBrands({ dealerId, status });

        res.status(200).json({
            success: true,
            status: 200,
            message: `📦 Product Brand list fetched successfully!`,
            data: brandListData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getLowStockProducts: asyncHandler(async (req, res) => {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit) || 10, 1);
        const threshold = Math.max(parseInt(req.query.threshold) || 10, 0);

        const response = await productService.getLowStockProducts({
            page,
            limit,
            threshold
        });

        return res.status(200).json({
            success: true,
            status: 200,
            message: "⚠️ Low stock products fetched successfully",
            data: response.data,
            pagination: response.pagination,
            timestamp: new Date().toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata"
            })
        });
    }),

    createProductBrands: asyncHandler(async (req, res) => {
        if (!Array.isArray(req.body) || req.body.length === 0) {
            throw new BadRequestException("Invalid brand list.Provide a non - empty array ");
        }

        const brands = await productService.createProductBrands(req.body);

        res.status(201).json({
            success: true,
            status: 201,
            message: "✅ Product Brands created successfully!",
            data: brands,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    statusChangeByBrandName: asyncHandler(async (req, res) => {
        const { brandName } = req.params;

        const updatedBrand = await productService.statusChangeByBrandName(brandName.trim(), req.body);

        res.status(200).json({
            success: true,
            status: 200,
            message: `Brand ${brandName} status updated.`,
            data: updatedBrand,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

};

export default productController;