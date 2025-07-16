// productService.js

import asyncHandler from "express-async-handler";

import Product from "../models/product.js";
import Stock from "../models/stock.js";
import Order from "../models/order.js";

import logger from "../utils/logger.js";
import { generateUniqueProductId, generateUniqueStockId } from "../utils/generatorIds.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInput, validateMainRoleAccess, validateProductRequiredFields, validateStockType, validateStockActionType } from "../utils/validationUtils.js";
import { mapProductEntityToResponse, mapStockEntityToResponse } from "../utils/modelMapper.js";
import { PRODUCT_UPDATABLE_FIELDS } from "../utils/constants.js";

async function updateExistingStock(existing, newData, action) {
    existing.stock += newData.stock;
    if (action === "ADD") existing.add_stock += newData.add_stock;
    if (action === "RETURN") existing.return_stock += newData.return_stock;
    existing.stock_notes += ` || ${newData.stock_notes}`;
    await existing.save();
    return existing;
}

async function fetchProductWithStocks(product) {
    const stocks = await Stock.find({ product_id: product.product_id });
    return mapProductEntityToResponse(product, stocks.map(mapStockEntityToResponse));
}

const productService = {
    createProduct: asyncHandler(async(dto) => {
        const { employee_id } = validateMainRoleAccess();

        validateProductRequiredFields(dto);

        const productId = await generateUniqueProductId();

        const product = new Product({
            product_id: productId,
            brand: sanitizeInput(dto.brand),
            model: sanitizeInput(dto.model),
            product_type: sanitizeInput(dto.product_type),
            product_name: sanitizeInput(dto.product_name),
            available_stock: Number(dto.available_stock || 0),
            created_by: employee_id
        });

        await product.save();
        logger.info(`✅ Product created: ${productId}`);

        if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            await productService.createOrUpdateProductStock({
                [productId]: dto.stocks
            });
        }

        return fetchProductWithStocks(product);
    }),

    updateProduct: asyncHandler(async(productId, dto) => {
        const { employee_id } = validateMainRoleAccess();
        const updates = {};

        for (const key of PRODUCT_UPDATABLE_FIELDS) {
            if (dto[key] !== undefined) {
                updates[key] = sanitizeInput(dto[key]);
            }
        }

        if (dto.available_stock !== undefined) {
            updates.available_stock = Number(dto.available_stock);
        }

        if (Object.keys(updates).length === 0) {
            throw new BadRequestException("No valid fields provided for update.");
        }

        const updated = await Product.findOneAndUpdate({ product_id: productId },
            updates, { new: true }
        );

        if (!updated) {
            throw new BadRequestException(`No product found with ID ${productId}`);
        }

        logger.info(`🔄 Product updated: ${productId}`);
        return fetchProductWithStocks(updated);
    }),

    createOrUpdateProductStock: asyncHandler(async(stockMap) => {
        const { employee_id, role } = validateMainRoleAccess();

        if (!stockMap || typeof stockMap !== "object" || Array.isArray(stockMap)) {
            throw new BadRequestException("Expected a product-wise stock object.");
        }

        const result = [];

        for (const productId of Object.keys(stockMap)) {
            const product = await Product.findOne({ product_id: productId });
            if (!product) throw new BadRequestException(`No product found with ID ${productId}`);

            const entries = Array.isArray(stockMap[productId]) ? stockMap[productId] : [stockMap[productId]];
            const stockResponses = [];

            for (const entry of entries) {
                const action = validateStockActionType(entry.type);
                const stockType = validateStockType(entry.stock_type);

                if (typeof entry.stock !== "number" || entry.stock <= 0) {
                    throw new BadRequestException("Stock must be a positive number.");
                }

                let returnReason = "";
                if (action === "RETURN") {
                    if (!entry.order_number || typeof entry.order_number !== "string") {
                        throw new BadRequestException("Order number is required for RETURN.");
                    }

                    const order = await Order.findOne({ order_number: entry.order_number });
                    if (!order) throw new BadRequestException(`No order found with number: ${entry.order_number}`);

                    returnReason = `RETURN Reason: Order #${entry.order_number}`;
                }

                const stockData = {
                    stock_id: await generateUniqueStockId(),
                    product_id: product.product_id,
                    stock: entry.stock,
                    add_stock: action === "ADD" ? entry.stock : 0,
                    return_stock: action === "RETURN" ? entry.stock : 0,
                    stock_type: stockType,
                    created_by: employee_id,
                    stock_notes: `${entry.stock_notes || ""} -- Employee: ${employee_id}; Role: ${role}; Action: ${action}; ${returnReason}; Date: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
                };

                const existing = await Stock.findOne({
                    product_id: product.product_id,
                    stock_type: stockType
                });

                const updatedStock = existing ?
                    await updateExistingStock(existing, stockData, action) :
                    await new Stock(stockData).save();

                logger.info(`${existing ? "🔁 Updated" : "📦 Created"} stock: ${stockData.stock_id}`);
                stockResponses.push(mapStockEntityToResponse(updatedStock));
            }

            const allStocks = await Stock.find({ product_id: product.product_id });
            product.available_stock = allStocks.reduce((acc, s) => acc + s.stock, 0);
            await product.save();

            result.push(mapProductEntityToResponse(product, stockResponses));
        }

        return result;
    }),

    getByProductId: asyncHandler(async(productId) => {
        const product = await Product.findOne({ product_id: productId });
        if (!product) throw new BadRequestException(`No product found with ID ${productId}`);
        return fetchProductWithStocks(product);
    }),

    getAllProducts: asyncHandler(async(filter = {}) => {
        const products = await Product.find(filter).sort({ created_at: -1 });
        const result = [];

        for (const product of products) {
            const stocks = await Stock.find({ product_id: product.product_id });
            result.push(mapProductEntityToResponse(product, stocks.map(mapStockEntityToResponse)));
        }

        return result;
    }),
}

export { productService };