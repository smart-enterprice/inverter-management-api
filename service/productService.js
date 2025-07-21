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
import { PRODUCT_UPDATABLE_FIELDS, STOCK_TYPES, STOCK_ACTIONS } from "../utils/constants.js";

async function fetchProductWithStocks(product) {
    const stocks = await Stock.find({ product_id: product.product_id });
    return mapProductEntityToResponse(product, stocks.map(mapStockEntityToResponse));
}

async function calculateAvailableStock(productId) {
    const allStocks = await Stock.find({ product_id: productId });

    const sumByType = (type) =>
        allStocks.filter((s) => s.stock_type === type)
            .reduce((total, s) => total + s.stock, 0);

    const packed = sumByType(STOCK_TYPES.STOCK_PACKED);
    const unpacked = sumByType(STOCK_TYPES.STOCK_UNPACKED);
    const sale = sumByType(STOCK_TYPES.STOCK_SALE);
    const other = sumByType(STOCK_TYPES.STOCK_OTHER);

    const available = (packed + unpacked) - (sale + other);
    logger.info(`📊 Stock Calculation → Product:${productId}, PACKED=${packed}, UNPACKED=${unpacked}, SALE=${sale}, OTHER=${other}, AVAILABLE=${available}`);
    return available;
}

async function saveOrUpdateStockTransaction({
    product,
    quantity,
    action,
    stockType,
    employeeId,
    role,
    orderNumber = null,
    stockNotes = "",
    productionRequired = 0
}) {
    if (!product || !product.product_id)
        throw new BadRequestException("❌ Product information is required for stock transaction.");

    let returnReason = "";
    if (action === STOCK_ACTIONS.STOCK_RETURN) {
        if (!orderNumber || typeof orderNumber !== "string") {
            throw new BadRequestException("Order number is required for RETURN.");
        }
        const order = await Order.findOne({ order_number: orderNumber });
        if (!order) throw new BadRequestException(`❌ No order found with number: ${orderNumber}`);
        returnReason = `RETURN Reason: Order #${order.order_number}`;
    }

    const productionNote = productionRequired > 0 ? ` | Production Required: ${productionRequired}` : "";
    const newNote =`${action} for ${orderNumber ? `Order:${orderNumber}` : ""}${productionNote} -- Employee:${employeeId}; Role:${role}; Action:${action}; ${returnReason}; Date:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
    const combinedNotes = stockNotes ? `${stockNotes} || ${newNote}` : newNote;

    const query = { product_id: product.product_id, stock_type: stockType || action };
    if (orderNumber) query.order_number = orderNumber;

    const existingStock = await Stock.findOne(query);

    if (existingStock) {
        existingStock.stock += quantity;
        if (action === STOCK_ACTIONS.STOCK_ADD) existingStock.add_stock += quantity;
        if (action === STOCK_ACTIONS.STOCK_RETURN) existingStock.return_stock += quantity;
        if ([STOCK_ACTIONS.STOCK_SALE, STOCK_ACTIONS.STOCK_OTHER].includes(action)) {
            existingStock.other_stock += quantity;
        }
        existingStock.stock_notes += ` || ${newNote}`;

        await existingStock.save();
        logger.info(`🔁 Updated ${action} Stock → Product:${product.product_id}, Qty:${existingStock.stock}`);
        return existingStock;
    }

    const stockData = {
        stock_id: await generateUniqueStockId(),
        product_id: product.product_id,
        stock: quantity,
        add_stock: action === STOCK_ACTIONS.STOCK_ADD ? quantity : 0,
        return_stock: action === STOCK_ACTIONS.STOCK_RETURN ? quantity : 0,
        other_stock: [STOCK_ACTIONS.STOCK_SALE, STOCK_ACTIONS.STOCK_OTHER].includes(action) ? quantity : 0,
        stock_type: stockType || action,
        stock_action: action,
        created_by: employeeId,
        order_number: orderNumber,
        stock_notes: combinedNotes
    };

    const newStock = await new Stock(stockData).save();
    logger.info(`📦 Created ${action} Stock → Product:${product.product_id}, Qty:${quantity}`);
    return newStock;
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
        logger.info(`Product created: ${productId}`);

        if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            await productService.createOrUpdateProductStock({ [productId]: dto.stocks });
        }

        return fetchProductWithStocks(product);
    }),

    updateProduct: asyncHandler(async(productId, dto) => {
        const { employee_id } = validateMainRoleAccess();
        const updates = {};

        for (const key of PRODUCT_UPDATABLE_FIELDS) {
            if (dto[key] !== undefined) updates[key] = sanitizeInput(dto[key]);
        }

        if (dto.available_stock !== undefined) updates.available_stock = Number(dto.available_stock);
        if (!Object.keys(updates).length) throw new BadRequestException("No valid fields provided for update.");

        const updated = await Product.findOneAndUpdate({ product_id: productId }, updates, { new: true });
        if (!updated) throw new BadRequestException(`No product found with ID ${productId}`);

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

                const savedStock = await saveOrUpdateStockTransaction({
                    product,
                    quantity: entry.stock,
                    action,
                    stockType,
                    employeeId: employee_id,
                    role,
                    orderNumber: entry.order_number || null,
                    stockNotes: entry.stock_notes
                });
                stockResponses.push(mapStockEntityToResponse(savedStock));
            }

            product.available_stock = await calculateAvailableStock(product.product_id);
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

    getProductsByIds: asyncHandler(async (productIds) => {
        if (!Array.isArray(productIds) || productIds.length === 0) {
            throw new BadRequestException("Product IDs must be a non-empty array.");
        }

        const [products, stocks] = await Promise.all([
            Product.find({ product_id: { $in: productIds } }),
            Stock.find({ product_id: { $in: productIds } })
        ]);

        if (!products.length) {
            throw new BadRequestException(`No products found for IDs: ${productIds.join(", ")}`);
        }

        const productMap = new Map();
        const productStockMap = new Map();

        products.forEach((p) => productMap.set(p.product_id, p));
        stocks.forEach((s) => {
            if (!productStockMap.has(s.product_id)) productStockMap.set(s.product_id, []);
            const stockArray = productStockMap.get(s.product_id);
            if (!stockArray.find((existing) => existing.stock_id === s.stock_id)) {
                stockArray.push(s);
            }
        });

        return { productMap, productStockMap };
    }),

    checkAndReserveStock: asyncHandler(async (product, stocks, requiredQty, employeeId, role, orderNumber) => {
        if (requiredQty <= 0) throw new BadRequestException("❌ Ordered quantity must be greater than 0.");

        let packedUsed = 0, unpackedUsed = 0, productionRequired = 0;
        let remainingQty = requiredQty;

        const packedStocks = stocks.filter((s) => s.stock_type === STOCK_TYPES.STOCK_PACKED).sort((a, b) => b.stock - a.stock);
        const unpackedStocks = stocks.filter((s) => s.stock_type === STOCK_TYPES.STOCK_UNPACKED).sort((a, b) => b.stock - a.stock);

        for (const stk of packedStocks) {
            if (remainingQty <= 0) break;
            const used = Math.min(stk.stock, remainingQty);
            stk.stock -= used;
            packedUsed += used;
            remainingQty -= used;
            await stk.save();
        }

        for (const stk of unpackedStocks) {
            if (remainingQty <= 0) break;
            const used = Math.min(stk.stock, remainingQty);
            stk.stock -= used;
            unpackedUsed += used;
            remainingQty -= used;
            await stk.save();
        }

        const availableStockUsed = packedUsed + unpackedUsed;
        if (remainingQty > 0) productionRequired = remainingQty;

        if (availableStockUsed > 0 || productionRequired > 0) {
            await saveOrUpdateStockTransaction({
                product,
                quantity: availableStockUsed,
                action: STOCK_ACTIONS.STOCK_SALE,
                employeeId,
                role,
                orderNumber,
                productionRequired
            });
        }

        product.available_stock = await calculateAvailableStock(product.product_id);
        await product.save();

        logger.info(`✅ Stock updated → Product:${product.product_id}, Packed:${packedUsed}, Unpacked:${unpackedUsed}, ProductionRequired:${productionRequired}`);
        return { availableStockUsed, productionRequired, packedUsed, unpackedUsed };
    }),

}

export { productService };

