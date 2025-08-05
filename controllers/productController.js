// controller/productController.js
import asyncHandler from "express-async-handler";
import xss from "xss";
import { productService } from "../service/productService.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";
import { BadRequestException } from "../middleware/CustomError.js";

const productController = {
    sanitizeInputBody,

    createProduct: asyncHandler(async(req, res) => {
        const productData = await productService.createProduct(req.body);
        res.status(201).json({
            success: true,
            status: 201,
            message: "🎉 Product created successfully!",
            data: productData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
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
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
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
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
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
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getAll: asyncHandler(async(req, res) => {
        const productList = await productService.getAllProducts();
        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Product list fetched successfully!",
            data: productList,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    getAllBrands: asyncHandler(async(req, res) => {
        const brandListData = await productService.getAllBrands();
        res.status(200).json({
            success: true,
            status: 200,
            message: "📦 Product Brand list fetched successfully!",
            data: brandListData,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }),

    createProductBrands: asyncHandler(async(req, res) => {
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