import asyncHandler from "express-async-handler";
import validator from "validator";

import Product from "../models/product.js";
import Stock from "../models/stock.js";
import Order from "../models/order.js";

import { generateUniqueProductId, generateUniqueStockId } from "../utils/generatorIds.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";

const ALLOWED_ROLES = ["ROLE_ADMIN", "ROLE_SUPER_ADMIN"];
const STOCK_TYPES = ["PACKED", "UNPACKED"];
const STOCK_ACTIONS = ["ADD", "RETURN"];
const REQUIRED_PRODUCT_FIELDS = ["brand", "model", "product_type", "product_name"];

const sanitizeInput = input =>
    typeof input === "string" ? validator.escape(input.trim()) : input;

const validateRole = () => {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();
    if (!employee_id || !role || !ALLOWED_ROLES.includes(role)) {
        throw new UnauthorizedException("Only admins can perform this action.");
    }
    return { employee_id, role };
};

const validateStockAction = action => {
    const type = typeof action === "string" ? action.toUpperCase() : null;
    if (!STOCK_ACTIONS.includes(type)) {
        throw new BadRequestException(`Invalid stock action: ${action}. Allowed: ${STOCK_ACTIONS.join(", ")}`);
    }
    return type;
};

const normalizeStockType = stock_type => {
    const type = typeof stock_type === "string" ? stock_type.trim().toUpperCase() : null;
    if (!STOCK_TYPES.includes(type)) {
        throw new BadRequestException(`Invalid stock_type: ${stock_type}. Allowed: ${STOCK_TYPES.join(", ")}`);
    }
    return type;
};

const fetchProductWithStocks = async product => {
    const stocks = await Stock.find({ product_id: product.product_id });
    return mapEntityToResponse(product, stocks.map(mapStockEntityToResponse));
};

async function createProduct(dto) {
    const { employee_id, role } = validateRole();

    for (const field of REQUIRED_PRODUCT_FIELDS) {
        if (!dto[field]) throw new BadRequestException(`${field} is required`);
    }

    const cleanData = {
        brand: sanitizeInput(dto.brand),
        model: sanitizeInput(dto.model),
        product_type: sanitizeInput(dto.product_type),
        product_name: sanitizeInput(dto.product_name),
        available_stock: dto.available_stock ? Number(dto.available_stock) : 0,
        created_by: employee_id,
        product_id: await generateUniqueProductId(),
    };

    const product = new Product(cleanData);
    await product.save();
    logger.info(`✅ Product created: ${cleanData.product_id}`, { productId: cleanData.product_id });

    if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
        console.log('dto stock : ', dto.stock);
        console.log('product id  : ', cleanData.product_id);

        await createOrUpdateProductStock({
            [cleanData.product_id]: dto.stocks
        });
    }

    return await fetchProductWithStocks(product);
}

async function updateProduct(productId, dto) {
    const employee_id = CurrentRequestContext.getEmployeeId();
    if (!employee_id) throw new UnauthorizedException("Login required to update products.");

    const updateFields = ["brand", "product_name", "model", "product_type", "status"];
    const cleanData = {};

    updateFields.forEach(key => {
        if (dto[key] !== undefined) cleanData[key] = sanitizeInput(dto[key]);
    });

    if (dto.available_stock !== undefined) {
        cleanData.available_stock = Number(dto.available_stock);
    }

    if (Object.keys(cleanData).length === 0) {
        throw new BadRequestException("No valid fields provided for update.");
    }

    const updated = await Product.findOneAndUpdate({ product_id: productId }, cleanData, { new: true });
    if (!updated) throw new BadRequestException(`No product found with ID ${productId}`);

    logger.info(`🔄 Product updated: ${productId}`, { productId });

    return await fetchProductWithStocks(updated);
}

async function createOrUpdateProductStock(stockMap) {
    const { employee_id, role } = validateRole();

    console.log('stock map: ', stockMap);

    if (!stockMap || typeof stockMap !== "object" || Array.isArray(stockMap)) {
        throw new BadRequestException("Expected a product-wise stock object.");
    }

    const result = [];

    console.log('starting map');
    for (const productId of Object.keys(stockMap)) {
        console.log('product id 3 : ', productId);
        const product = await Product.findOne({ product_id: productId });
        if (!product) throw new BadRequestException(`No product found with ID ${productId}`);

        const entries = Array.isArray(stockMap[productId]) ? stockMap[productId] : [stockMap[productId]];
        const stockResponses = [];

        for (const entry of entries) {
            const action = validateStockAction(entry.type);
            const normalizedStockType = normalizeStockType(entry.stock_type);

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
                stock_type: normalizedStockType,
                created_by: employee_id,
                stock_notes: `${entry.stock_notes || ""} -- Employee: ${employee_id}; Role: ${role}; Action: ${action}; ${returnReason}; Date: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            };

            const existing = await Stock.findOne({
                product_id: product.product_id,
                stock_type: normalizedStockType
            });

            const updatedStock = existing ?
                await updateExistStock(existing, stockData, action) :
                await new Stock(stockData).save();

            logger.info(`${existing ? "🔁 Updated" : "📦 Created"} stock: ${stockData.stock_id}`, { productId });
            stockResponses.push(mapStockEntityToResponse(updatedStock));
        }

        const allStocks = await Stock.find({ product_id: product.product_id, });
        product.available_stock = allStocks.reduce((acc, s) => acc + s.stock, 0);
        await product.save();

        result.push(mapEntityToResponse(product, stockResponses));
    }

    return result;
}

async function updateExistStock(existing, newData, action) {
    existing.stock += newData.stock;
    if (action === "ADD") existing.add_stock += newData.add_stock;
    if (action === "RETURN") existing.return_stock += newData.return_stock;
    existing.stock_notes += ` || ${newData.stock_notes}`;
    await existing.save();
    return existing;
}

async function getByProductId(productId) {
    const product = await Product.findOne({ product_id: productId });
    if (!product) throw new BadRequestException(`No product found with ID ${productId}`);
    return await fetchProductWithStocks(product);
}

async function getAllProducts(filter = {}) {
    const products = await Product.find(filter).sort({ created_at: -1 });
    const results = [];

    for (const product of products) {
        const stocks = await Stock.find({ product_id: product.product_id });
        results.push(mapEntityToResponse(product, stocks.map(mapStockEntityToResponse)));
    }

    return results;
}

function mapEntityToResponse(entity, stocks = []) {
    return {
        product_id: entity.product_id,
        brand: entity.brand,
        product_name: entity.product_name,
        model: entity.model,
        product_type: entity.product_type,
        status: entity.status,
        available_stock: entity.available_stock,
        created_by: entity.created_by,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
        stocks
    };
}

function mapStockEntityToResponse(entity) {
    return {
        stock_id: entity.stock_id,
        product_id: entity.product_id,
        stock: entity.stock,
        add_stock: entity.add_stock,
        return_stock: entity.return_stock,
        stock_type: entity.stock_type,
        stock_notes: entity.stock_notes,
        created_by: entity.created_by,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
    };
}

export const productService = {
    createProduct: asyncHandler(createProduct),
    updateProduct: asyncHandler(updateProduct),
    getByProductId: asyncHandler(getByProductId),
    getAllProducts: asyncHandler(getAllProducts),
    createOrUpdateProductStock: asyncHandler(createOrUpdateProductStock),
};

export { mapEntityToResponse, mapStockEntityToResponse };