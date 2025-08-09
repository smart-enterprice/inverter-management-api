// productService.js

import asyncHandler from "express-async-handler";

import Employee from '../models/employees.js';
import Product from "../models/product.js";
import Stock from "../models/stock.js";
import Order from "../models/order.js";

import logger from "../utils/logger.js";
import { generateUniqueBrandId, generateUniqueProductId, generateUniqueStockId } from "../utils/generatorIds.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInput, validateMainRoleAccess, validateProductRequiredFields, validateStockType, validateStockActionType, getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import { mapProductBrandEntityToResponse, mapProductEntityToResponse, mapStockEntityToResponse } from "../utils/modelMapper.js";
import { PRODUCT_UPDATABLE_FIELDS, STOCK_TYPES, STOCK_ACTIONS, STATUS } from "../utils/constants.js";
import Brand from "../models/brand.js";

async function fetchProductWithStocks(product) {
    const stocks = await Stock.find({ product_id: product.product_id });
    return mapProductEntityToResponse(product, stocks.map(mapStockEntityToResponse));
}

async function checkIfProductExists(brand, model) {
    const existingProduct = await Product.findOne({ brand: brand.toUpperCase(), model: model.toUpperCase() });

    if (existingProduct) {
        throw new BadRequestException(`Product with brand ${brand} and model ${model} already exists.`);
    }
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
    const newNote = `${action} for ${orderNumber ? `Order:${orderNumber}` : ""}${productionNote} -- Employee:${employeeId}; Role:${role}; Action:${action}; ${returnReason}; Date:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
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
    createProduct: asyncHandler(async (dto) => {
        const { employee_id } = validateMainRoleAccess();
        validateProductRequiredFields(dto);

        const brandInput = sanitizeInput(dto.brand).toUpperCase();
        const modelInput = sanitizeInput(dto.model).toUpperCase();

        const brandRecord = await Brand.findOne({ brand_name: brandInput });
        if (!brandRecord) {
            throw new BadRequestException(`Brand ${dto.brand} does not exist.`);
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());
        const brandStatus = brandRecord.status.toLowerCase();

        if (brandStatus === 'inactive') {
            throw new BadRequestException(`Brand ${dto.brand} is inactive. Please activate the brand to create a product.`);
        } else if (brandStatus === 'discontinued') {
            throw new BadRequestException(`Cannot create product. Brand ${dto.brand} is discontinued.`);
        }

        if (!brandModels.includes(modelInput)) {
            throw new BadRequestException(`Model ${dto.model} is not associated with brand ${dto.brand}.`);
        }

        await checkIfProductExists(brandInput, modelInput);

        let price = null;
        if (dto.product_price != null) {
            const parsedPrice = Number(dto.product_price);
            if (isNaN(parsedPrice) || parsedPrice < 0) {
                throw new BadRequestException('Product price must be a positive number.');
            }
            price = Math.round(parsedPrice * 100) / 100;
        }

        const productId = await generateUniqueProductId();
        const product = new Product({
            product_id: productId,
            brand: brandInput,
            model: modelInput,
            product_type: sanitizeInput(dto.product_type),
            product_name: sanitizeInput(dto.product_name),
            available_stock: Number(dto.available_stock || 0),
            price,
            created_by: employee_id
        });

        await product.save();
        logger.info(`Product created: ${productId}`);

        if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            await productService.createOrUpdateProductStock({ [productId]: dto.stocks });
        }

        return fetchProductWithStocks(product);
    }),

    updateProduct: asyncHandler(async (productId, dto) => {
        const { employee_id } = validateMainRoleAccess();

        const requestingEmployee = await Employee.findOne({ employee_id: employee_id, status: 'active' });
        if (!requestingEmployee) {
            throw new BadRequestException(`Requesting employee not found or inactive: ${employee_id}`);
        }

        const product = await Product.findOne({ product_id: productId });
        if (!product) {
            throw new BadRequestException(`No product found with ID ${productId}.`);
        }

        logger.info(`📦 Product updates: ${JSON.stringify(product, null, 2)}`);

        const updates = {};
        for (const key of PRODUCT_UPDATABLE_FIELDS) {
            if (['brand', 'model'].includes(key)) {
                continue;
            }

            if (dto[key] !== undefined) {
                const sanitized = sanitizeInput(dto[key]);
                if (product[key] !== sanitized) {
                    updates[key] = sanitized;
                }
            }
        }

        if (dto.product_price !== undefined) {
            const parsedPrice = Number(dto.product_price);
            if (isNaN(parsedPrice) || parsedPrice < 0) {
                throw new BadRequestException('Product price must be a positive number.');
            }
            const roundedPrice = Math.round(parsedPrice * 100) / 100;
            if (product.price == null || product.price !== roundedPrice) {
                updates.price = roundedPrice;
            }
        }

        if (dto.status !== undefined) {
            const normalizedStatus = sanitizeInput(dto.status).toLowerCase();
            if (!STATUS.includes(normalizedStatus)) {
                throw new BadRequestException("Status must be one of: " + STATUS.join(', '));
            }

            const previousStatus = product.status;
            if (normalizedStatus !== previousStatus) {
                updates.status = normalizedStatus;

                if (['inactive', 'discontinued'].includes(normalizedStatus)) {
                    const reason = sanitizeInput(dto.status_reason || 'No reason provided');
                    const timestampIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', });

                    const logEntry = `Product status changed by: ${requestingEmployee.employee_name} (Role: ${requestingEmployee.role}) | From: ${previousStatus} → ${normalizedStatus} | Reason: ${reason} | Date: ${timestampIST}`;
                    updates.log_note = product.log_note
                        ? `${product.log_note} \n${logEntry}`
                        : logEntry;
                } else if (['active'].includes(normalizedStatus)) {
                    const brand = await Brand.findOne({ brand_name: product.brand });
                    if (!brand || brand.status !== 'active') {
                        throw new BadRequestException(`Cannot activate product because the associated brand ${product.brand} is inactive or does not exist.`);
                    }
                }
            }
        }

        if (!Object.keys(updates).length) return fetchProductWithStocks(product);

        updates.available_stock = await calculateAvailableStock(productId);

        const updated = await Product.findOneAndUpdate({ product_id: productId }, { $set: updates }, { new: true });
        if (!updated) throw new BadRequestException(`Failed to update product with ID ${productId}.`);

        logger.info(`🔄 Product updated: ${productId} by employee ${employee_id}`);
        return fetchProductWithStocks(updated);
    }),

    createOrUpdateProductStock: asyncHandler(async (stockMap) => {
        const { employee_id, role } = validateMainRoleAccess();

        if (!stockMap || typeof stockMap !== "object" || Array.isArray(stockMap)) {
            throw new BadRequestException("Expected a product-wise stock object.");
        }

        const result = [];

        for (const productId of Object.keys(stockMap)) {
            const product = await Product.getActiveProductById(productId);
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

    getByProductId: asyncHandler(async (productId) => {
        const product = await Product.getActiveProductById(productId);
        if (!product) throw new BadRequestException(`No product found with ID ${productId}`);
        return fetchProductWithStocks(product);
    }),

    getAllActiveProducts: asyncHandler(async (filter = {}) => {
        const products = await Product.getActiveProducts(filter);
        const result = [];

        for (const product of products) {
            const stocks = await Stock.find({ product_id: product.product_id });
            result.push(mapProductEntityToResponse(product, stocks.map(mapStockEntityToResponse)));
        }

        return result;
    }),

    getAllProducts: asyncHandler(async (filter = {}) => {
        const products = await Product.getAllProducts(filter);
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
        const productAvailableStockMap = new Map();

        products.forEach((p) => productMap.set(p.product_id, p));

        stocks.forEach((s) => {
            if (!productStockMap.has(s.product_id)) productStockMap.set(s.product_id, []);
            const stockArray = productStockMap.get(s.product_id);
            if (!stockArray.find((existing) => existing.stock_id === s.stock_id)) {
                stockArray.push(s);
            }
        });

        for (const p of products) {
            const availableStock = await calculateAvailableStock(p.product_id);
            productAvailableStockMap.set(p.product_id, availableStock);
        }

        return { productMap, productStockMap, productAvailableStockMap };
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

    getAllBrands: asyncHandler(async () => {
        const productBrands = await Brand.find().sort({ created_at: -1 });

        const result = productBrands.map((brand) =>
            mapProductBrandEntityToResponse(brand)
        );

        return result;
    }),

    createProductBrands: asyncHandler(async (brandsData) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const brandDocs = [];

        for (const brand of brandsData) {
            const brand_name = brand.brand_name?.toUpperCase().trim();
            if (!brand_name) {
                throw new BadRequestException("Brand name is missing or invalid.");
            }

            const existingBrand = await Brand.findOne({ brand_name: brand_name });
            if (existingBrand) {
                throw new BadRequestException(`Brand ${brand_name} already exists.`);
            }

            const brand_models = [...new Set(
                brand.brand_models.map((model) => model.trim().toUpperCase())
            )];

            const brandDoc = new Brand({
                brand_id: await generateUniqueBrandId(),
                brand_name,
                brand_models,
                description: brand.description?.trim() || "",
                created_by: employeeId
            });

            brandDocs.push(brandDoc);
        }

        await Brand.insertMany(brandDocs);
        return brandDocs.map((brand) =>
            mapProductBrandEntityToResponse(brand)
        );
    }),

    statusChangeByBrandName: asyncHandler(async (brandName, bodyData) => {
        const {
            status,
            brand_models = [],
            brand_name = brandName,
            brand_models_update = {},
            delete_models = [],
            description = ""
        } = bodyData;

        const normalizedStatus = status.trim().toLowerCase();
        const normalizedBrandName = brandName.trim().toUpperCase();
        const newBrandName = brand_name?.trim().toUpperCase();

        if (!normalizedBrandName || typeof normalizedBrandName !== 'string' || !normalizedBrandName.trim()) {
            throw new BadRequestException("Brand name parameter is missing or invalid.");
        }

        if (!normalizedStatus || !STATUS.includes(normalizedStatus)) {
            throw new BadRequestException("Status must be one of: " + STATUS.join(', '));
        }

        const brand = await Brand.findOne({ brand_name: normalizedBrandName });
        if (!brand) {
            throw new BadRequestException(`Brand ${normalizedBrandName} not found.`);
        }

        let updatedModelsSet = new Set(brand.brand_models.map(m => m.toUpperCase()));
        if (Array.isArray(brand_models) && brand_models.length > 0) {
            brand_models.forEach(model => updatedModelsSet.add(model.trim().toUpperCase()));
        }

        if (brand_models_update && typeof brand_models_update === 'object') {
            for (const [oldModel, newModel] of Object.entries(brand_models_update)) {
                const oldM = oldModel.trim().toUpperCase();
                const newM = newModel.trim().toUpperCase();
                if (updatedModelsSet.has(oldM)) {
                    updatedModelsSet.delete(oldM);
                    updatedModelsSet.add(newM);

                    await Product.updateMany(
                        { brand: normalizedBrandName, model: oldM },
                        { $set: { model: newM } }
                    );
                }
            }
        }

        let deletedModelsList = brand.deleted_brand_models || [];
        if (Array.isArray(delete_models) && delete_models.length > 0) {
            for (const model of delete_models) {
                const mUpper = model.trim().toUpperCase();
                if (updatedModelsSet.has(mUpper)) {
                    updatedModelsSet.delete(mUpper);
                    deletedModelsList.push(mUpper);
                }
            }
        }

        let descriptionNote = brand.description || "";
        if (description) {
            descriptionNote = descriptionNote
                ? `${descriptionNote},${description}`
                : `${description}`;
        }

        const mergedBrandModels = Array.from(updatedModelsSet);

        const updateTimestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const brandStatusChanged = brand.status.toLowerCase() !== normalizedStatus;

        let updateBrandFields = {
            brand_models: mergedBrandModels,
            deleted_brand_models: deletedModelsList,
            description: descriptionNote,
            updated_at: updateTimestamp
        };

        if (brandStatusChanged) {
            const products = await Product.find({ brand: normalizedBrandName }, { product_id: 1 }).lean();
            const productIds = products.map(p => p.product_id);

            if (['active', 'inactive'].includes(normalizedStatus)) {
                updateBrandFields.status = normalizedStatus;

                await Product.updateMany(
                    { product_id: { $in: productIds } },
                    { $set: { status: normalizedStatus, updated_at: updateTimestamp } }
                );
            } else if (normalizedStatus === 'discontinued') {
                const { productAvailableStockMap } = await productService.getProductsByIds(productIds);
                const discontinuedIds = productIds.filter(id => productAvailableStockMap.get(id) <= 0);
                if (!discontinuedIds.length) {
                    throw new BadRequestException("Cannot discontinue brand. Products still have stock.");
                }

                await Product.updateMany(
                    { product_id: { $in: discontinuedIds } },
                    { $set: { status: 'discontinued', updated_at: updateTimestamp } }
                );

                if (productIds.length === discontinuedIds.length) {
                    updateBrandFields.status = normalizedStatus;
                }
            }
        }

        if (newBrandName && newBrandName !== normalizedBrandName) {
            updateBrandFields.brand_name = newBrandName;

            await Product.updateMany(
                { brand: normalizedBrandName },
                { $set: { brand: newBrandName } }
            );
        }

        await Brand.updateOne(
            { brand_name: normalizedBrandName },
            { $set: updateBrandFields }
        );

        logger.info(`✅ Brand Updated:
            ➤ Old Brand Name: ${normalizedBrandName}
            ➤ New Brand Name: ${newBrandName || normalizedBrandName}
            ➤ Status Change: ${brand.status} → ${normalizedStatus}
            ➤ Models: [${mergedBrandModels.join(', ')}]
            ➤ Deleted Models: [${deletedModelsList.join(', ')}]
            ➤ Timestamp: ${updateTimestamp}
        `);

        const updatedBrand = await Brand.findOne({ brand_name: newBrandName || normalizedBrandName });
        return mapProductBrandEntityToResponse(updatedBrand);
    }),

}

export { productService };