// service/productService.js
import asyncHandler from "express-async-handler";
import validator from "validator";
import Product from "../models/product.js";
import Stock from "../models/stock.js";
import { generateUniqueProductId, generateUniqueStockId } from "../utils/generatorIds.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";

const ALLOWED_ROLES = ['ROLE_ADMIN', 'ROLE_SUPER_ADMIN'];
const STOCK_TYPES = ['PACKED', 'UNPACKED'];
const STOCK_ACTIONS = ['ADD', 'RETURN'];

function sanitizeInput(input) {
    return typeof input === 'string' ? validator.escape(input.trim()) : input;
}

async function createProduct(dto) {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();

    if (!employee_id || !role || !ALLOWED_ROLES.includes(role)) {
        throw new UnauthorizedException("Only admins can create products.");
    }

    const requiredFields = ['brand', 'model', 'product_type', 'product_name'];
    for (const field of requiredFields) {
        if (!dto[field]) {
            throw new BadRequestException(`${field} is required`);
        }
    }

    const brand = sanitizeInput(dto.brand);
    const model = sanitizeInput(dto.model);
    const product_type = sanitizeInput(dto.product_type);
    const product_name = sanitizeInput(dto.product_name);

    const existingProduct = await Product.findOne({ brand, model, product_type });
    if (existingProduct) {
        throw new BadRequestException(
            `A product with brand "${brand}", model "${model}", and type "${product_type}" already exists.`
        );
    }

    const productId = await generateUniqueProductId();
    const cleanData = {
        product_id: productId,
        brand,
        model,
        product_type,
        product_name,
        created_by: employee_id,
        available_stock: dto.available_stock ? Number(dto.available_stock) : 0
    };

    try {
        const product = new Product(cleanData);
        await product.save();
        logger.info(`✅ Product created: ${productId}`, { productId });

        if (dto.stocks && Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            const stockMap = {
                [productId]: dto.stocks
            };
            await addProductStock(stockMap);
        }

        return product;
    } catch (err) {
        if (err.code === 11000) {
            throw new BadRequestException(`Product with product ID ${productId} already exists.`);
        }
        throw err;
    }
}

async function updateProduct(productId, dto) {
    const employee_id = CurrentRequestContext.getEmployeeId();
    if (!employee_id) {
        throw new UnauthorizedException("Login required to update products.");
    }

    const cleanData = {};
    ['brand', 'product_name', 'model', 'product_type', 'status'].forEach(key => {
        if (dto[key] !== undefined) {
            cleanData[key] = sanitizeInput(dto[key]);
        }
    });

    if (dto.available_stock !== undefined) {
        cleanData.available_stock = Number(dto.available_stock);
    }

    if (Object.keys(cleanData).length === 0) {
        throw new BadRequestException("No valid fields provided for update.");
    }

    // 💥 Check for uniqueness conflict if brand, model, and product_type are all being updated
    const needsCheck = ['brand', 'model', 'product_type'].every(key => dto[key] !== undefined);

    if (needsCheck) {
        const existingProduct = await Product.findOne({
            brand: cleanData.brand,
            model: cleanData.model,
            product_type: cleanData.product_type,
            product_id: { $ne: productId } // exclude current product
        });

        if (existingProduct) {
            throw new BadRequestException(
                `A product with brand "${cleanData.brand}", model "${cleanData.model}", and type "${cleanData.product_type}" already exists.`
            );
        }
    }

    const product = await Product.findOneAndUpdate({ product_id: productId },
        cleanData, { new: true }
    );

    if (!product) {
        throw new BadRequestException(`No product found with this product ID ${productId}`);
    }

    logger.info(`🔄 Product updated: ${productId}`, { productId });
    return product;
}

async function addProductStock(stockMap) {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();

    if (!employee_id || !role) {
        throw new UnauthorizedException("Login required to add stock.");
    }

    if (!stockMap || typeof stockMap !== "object") {
        throw new BadRequestException("Invalid stock data provided.");
    }

    const updatedStocks = [];

    for (const productId of Object.keys(stockMap)) {
        const product = await Product.findOne({ product_id: productId });
        if (!product) {
            throw new BadRequestException(`No product found with ID ${productId}`);
        }

        const stockEntries = Array.isArray(stockMap[productId]) ? stockMap[productId] : [stockMap[productId]];
        const productStocks = [];

        for (const entry of stockEntries) {
            const {
                stock,
                stock_type,
                type,
                stock_notes = ""
            } = entry;

            const action = typeof type === "string" ? type.toUpperCase() : null;

            if (!action || !STOCK_ACTIONS.includes(action)) {
                throw new BadRequestException(`Invalid stock action type: ${type}. Expected one of: ${STOCK_ACTIONS.join(", ")}`);
            }

            if (typeof stock !== "number" || stock <= 0) {
                throw new BadRequestException("Stock must be a positive number.");
            }

            const normalizedStockType = stock_type.trim().toUpperCase();
            if (!STOCK_TYPES.includes(normalizedStockType)) {
                throw new BadRequestException(`Invalid stock_type: ${stock_type}`);
            }

            const stockData = {
                stock_id: await generateUniqueStockId(),
                product_id: product.product_id,
                stock,
                add_stock: action === "ADD" ? stock : 0,
                return_stock: action === "RETURN" ? stock : 0,
                stock_type: normalizedStockType,
                stock_notes: stock_notes ||
                    `Employee: ${employee_id}; Role: ${role}; Stock: ${stock}; Stock Type: ${normalizedStockType}; Action: ${action}; Date: ${new Date().toISOString()}`,
                created_by: employee_id,
            };

            const existingStock = await Stock.findOne({
                product_id: productId,
                stock_type: normalizedStockType
            });

            if (existingStock) {
                const updatedStock = await updateExistStock(productId, stockData);
                productStocks.push(mapStockEntityToResponse(updatedStock));
            } else {
                const stockDoc = new Stock(stockData);
                await stockDoc.save();
                logger.info(`📦 Stock added: ${stockDoc.stock_id} for product: ${productId}`);
                productStocks.push(mapStockEntityToResponse(stockDoc));
            }
        }

        const allStocks = await Stock.find({ product_id: productId });
        const totalStock = allStocks.reduce((sum, s) => sum + s.stock, 0);
        product.available_stock = totalStock;
        await product.save();

        updatedStocks.push({
            product: mapEntityToResponse(product),
            stocks: productStocks
        });
    }

    return updatedStocks;
}

async function updateExistStock(productId, stockData) {
    const existingStock = await Stock.findOne({ product_id: productId, stock_type: stockData.stock_type });

    if (!existingStock) {
        throw new BadRequestException(`No existing stock found for product ID ${productId} with type ${stockData.stock_type}`);
    }

    existingStock.stock += stockData.stock;

    if (stockData.add_stock > 0) {
        existingStock.add_stock += stockData.add_stock;
    }

    if (stockData.return_stock > 0) {
        existingStock.return_stock += stockData.return_stock;
    }

    existingStock.stock_notes += `\n${stockData.stock_notes}`;

    await existingStock.save();
    logger.info(`🔁 Existing stock updated: ${existingStock.stock_id}`, {
        product_id: productId,
        stock_type: stockData.stock_type,
    });

    return existingStock;
}

async function getByProductId(productId) {
    const product = await Product.findOne({ product_id: productId });
    if (!product) {
        throw new BadRequestException(`No product found with this product ID ${productId}`);
    }
    return product;
}

async function getAllProducts(filter = {}) {
    return await Product.find(filter).sort({ created_at: -1 });
}

function mapEntityToResponse(entity) {
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
        updated_at: entity.updated_at
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
    addProductStock: asyncHandler(addProductStock)
};

export { mapEntityToResponse, mapStockEntityToResponse };