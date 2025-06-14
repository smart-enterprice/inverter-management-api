// service/productService.js

import asyncHandler from "express-async-handler";
import validator from "validator";
import Product from "../models/product.js";
import { generateUniqueProductId } from "../utils/generatorIds.js";
import {
    BadRequestException,
    UnauthorizedException
} from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";

const ALLOWED_ROLES = ['ROLE_ADMIN', 'ROLE_SUPER_ADMIN'];

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

    // 💥 Uniqueness Check
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

export const productService = {
    createProduct: asyncHandler(createProduct),
    updateProduct: asyncHandler(updateProduct),
    getByProductId: asyncHandler(getByProductId),
    getAllProducts: asyncHandler(getAllProducts)
};

export { mapEntityToResponse };