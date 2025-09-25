// productService.js

import asyncHandler from "express-async-handler";

import Employee from "../models/employees.js";
import Product from "../models/product.js";
import Stock from "../models/stock.js";
import StockHistory from "../models/stockHistory.js";
import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";
import Brand from "../models/brand.js";

import logger from "../utils/logger.js";
import { generateUniqueBrandId, generateUniqueProductId, generateUniqueStockId, generateUniqueStockHistoryId } from "../utils/generatorIds.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInput, validateMainRoleAccess, validateProductRequiredFields, validateStockType, validateStockActionType, getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import { mapProductBrandEntityToResponse, mapProductEntityToResponse, mapStockEntityToResponse } from "../utils/modelMapper.js";
import { PRODUCT_UPDATABLE_FIELDS, STOCK_TYPES, STOCK_ACTIONS, STATUS } from "../utils/constants.js";

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

export async function calculateAvailableStock(productId) {
    try {
        const available = await Stock.getAvailableStockByProductId(productId, logger);

        logger.info(`📊 Stock Calculation → Product = ${productId}, AVAILABLE STOCK = ${available}`);

        return available;
    } catch (error) {
        logger.error(`❌ Failed to calculate stock for product ${productId}: ${error.message}`);
        throw new BadRequestException(error.message);
    }
}

export async function saveOrUpdateStockTransaction({
    product,
    quantity,
    action,
    stockType,
    employeeId,
    role,
    orderNumber = null,
    orderDetailsNumber = null,
    stockNotes = "",
    productionRequired = 0
}) {
    if (!product || !product.product_id) {
        throw new BadRequestException("Product information is required for stock transaction.");
    }

    if (quantity <= 0) {
        throw new BadRequestException("Quantity must be greater than 0 for stock transaction.");
    }

    let returnReason = "";
    if (action === STOCK_ACTIONS.STOCK_RETURN) {
        if (!orderNumber || typeof orderNumber !== "string") {
            throw new BadRequestException("Order number is required for RETURN.");
        }

        const order = await Order.findOne({ order_number: orderNumber });
        if (!order) {
            throw new BadRequestException(`No order found with number: ${orderNumber}`);
        }

        const orderDetailsQuery = { order_number: orderNumber, product_id: product.product_id };
        if (orderDetailsNumber) orderDetailsQuery.order_details_number = orderDetailsNumber;

        const orderDetails = await OrderDetails.find(orderDetailsQuery);
        if (!orderDetails || orderDetails.length === 0) {
            throw new BadRequestException(
                `No order details found for product ${product.product_id} in order ${orderNumber}`
            );
        }

        const detailNumbers = orderDetails.map(od => od.order_details_number).join(", ");
        returnReason = `RETURN: Order #${order.order_number}; Order Details [${detailNumbers}]; Returned Qty: ${quantity}`;
    }

    const productionNote = productionRequired > 0 ? ` | Production Required: ${productionRequired}` : "";
    const newNote = `${action} ${orderNumber ? `(Order:${orderNumber})` : ""}${productionNote} -- Employee:${employeeId}; Role:${role}; ${returnReason}; Date:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
    const combinedNotes = stockNotes ? `${stockNotes} || ${newNote}` : newNote;

    const stock = await Stock.findOne({ product_id: product.product_id });

    let previousPacked = stock?.packed_stock || 0;
    let previousUnpacked = stock?.unpacked_stock || 0;
    let newPacked = previousPacked;
    let newUnpacked = previousUnpacked;

    if ([STOCK_ACTIONS.STOCK_RETURN, STOCK_ACTIONS.STOCK_ADD].includes(action)) {
        if (stockType === STOCK_TYPES.STOCK_PACKED) newPacked += quantity;
        if (stockType === STOCK_TYPES.STOCK_UNPACKED) newUnpacked += quantity;
    }

    const previousTotal = previousPacked + previousUnpacked;
    const newTotal = newPacked + newUnpacked;

    let stockRecord;
    if (stock) {
        stock.packed_stock = newPacked;
        stock.unpacked_stock = newUnpacked;
        stock.stock = newTotal;
        stock.updated_at = new Date();
        await stock.save();

        stockRecord = stock;
        logger.info(`🔁 Updated Stock → Product:${product.product_id}, Total:${newTotal}`);
    } else {
        const stockData = {
            stock_id: await generateUniqueStockId(),
            product_id: product.product_id,
            packed_stock: newPacked,
            unpacked_stock: newUnpacked,
            stock: newTotal,
            created_by: employeeId
        };

        stockRecord = await new Stock(stockData).save();
        logger.info(`📦 Created Stock → Product:${product.product_id}, Total:${newTotal}`);
    }

    const previousStock = stockType === STOCK_TYPES.STOCK_PACKED ? previousPacked : previousUnpacked;
    const newStock = stockType === STOCK_TYPES.STOCK_PACKED ? newPacked : newUnpacked;

    await logStockHistory({
        productId: product.product_id,
        orderNumber,
        action,
        stockType,
        quantity,
        previousStock,
        newStock,
        notes: combinedNotes,
        employeeId
    });

    return stockRecord;
}

async function logStockHistory({
    productId,
    orderNumber,
    action,
    stockType,
    quantity,
    previousStock,
    newStock,
    notes,
    employeeId
}) {
    if (quantity <= 0) return;

    const historyId = await generateUniqueStockHistoryId();

    await StockHistory.create({
        stock_history_id: historyId,
        product_id: productId,
        order_number: orderNumber,
        action,
        stock_type: stockType,
        quantity,
        previous_stock: previousStock,
        new_stock: newStock,
        notes,
        created_by: employeeId
    });
    logger.info(`📝 StockHistory Logged → Product:${productId}, Action:${action}, Type:${stockType}, Qty:${quantity}`);
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

        const brandStatus = brandRecord.status?.toLowerCase();
        switch (brandStatus) {
            case "inactive":
                throw new BadRequestException(`Brand "${dto.brand}" is inactive. Please activate the brand before creating a product.`);
            case "discontinued":
                throw new BadRequestException(`Cannot create product. Brand "${dto.brand}" is discontinued.`);
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());
        if (!brandModels.includes(modelInput)) {
            throw new BadRequestException(`Model ${dto.model} is not associated with brand ${dto.brand}.`);
        }

        await checkIfProductExists(brandInput, modelInput);

        let price = null;
        if (dto.product_price != null) {
            const parsedPrice = Number(dto.product_price);
            if (isNaN(parsedPrice) || parsedPrice < 0) {
                throw new BadRequestException("Product price must be a valid non-negative number.");
            }
            price = Number(parsedPrice.toFixed(2)); // round to 2 decimals
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
        logger.info(`✅ Product created → ID: ${productId}, Brand: ${brandInput}, Model: ${modelInput}`);

        if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            await productService.createOrUpdateProductStock({ [productId]: dto.stocks });

            product.available_stock = await calculateAvailableStock(product.product_id);
            await product.save();
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
            let latestStock = null;

            for (const entry of entries) {
                const action = validateStockActionType(entry.type);
                const stockType = validateStockType(entry.stock_type);

                if (typeof entry.stock !== "number" || entry.stock <= 0) {
                    throw new BadRequestException("Stock must be a positive number.");
                }

                latestStock = await saveOrUpdateStockTransaction({
                    product,
                    quantity: entry.stock,
                    action,
                    stockType,
                    employeeId: employee_id,
                    role,
                    orderNumber: entry.order_number || null,
                    stockNotes: entry.stock_notes
                });
            }

            product.available_stock = await calculateAvailableStock(product.product_id);
            await product.save();

            result.push(mapProductEntityToResponse(product, latestStock));
        }

        return result;
    }),

    getByProductId: asyncHandler(async (productId) => {
        const product = await Product.findOne({ product_id: productId });
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
            productStockMap.set(s.product_id, {
                stock_id: s.stock_id,
                packed_stock: s.packed_stock,
                unpacked_stock: s.unpacked_stock,
                total_stock: s.stock
            });
            productAvailableStockMap.set(s.product_id, s.stock);
        });

        return { productMap, productStockMap, productAvailableStockMap };
    }),

    getAllProductsByBrands: asyncHandler(async (dto) => {
        const { employee_id } = validateMainRoleAccess();

        if (!Array.isArray(dto.brands) || dto.brands.length === 0) {
            throw new BadRequestException("At least one brand must be provided.");
        }

        const requestedBrands = dto.brands.map((b) =>
            sanitizeInput(b).toUpperCase()
        );

        const activeBrands = await Brand.find({
            brand_name: { $in: requestedBrands },
            status: "active",
        });

        if (!activeBrands.length) {
            throw new BadRequestException(`No active brands found for [${brandInputs.join(", ")}]`);
        }

        const validBrandNames = activeBrands.map((b) =>
            sanitizeInput(b.brand_name).toUpperCase()
        );

        const products = await Product.find({
            brand: { $in: validBrandNames },
            status: "active",
        }).sort({ created_at: -1 });

        if (!products.length) {
            throw new BadRequestException(`No products found for active brands: [${brandInputs.join(", ")}]`);
        }

        const productsWithStock = await Promise.all(
            products.map((p) => fetchProductWithStocks(p))
        );
        return productsWithStock;
    }),

    checkAndReserveStock: asyncHandler(async (product, stock, requiredQty, employeeId, role, orderNumber) => {
        if (requiredQty <= 0) {
            throw new BadRequestException("Ordered quantity must be greater than 0.");
        }

        let packedUsed = 0, unpackedUsed = 0, productionRequired = 0;
        let remainingQty = requiredQty;

        const previousPacked = stock.packed_stock;
        const previousUnPacked = stock.unpacked_stock;

        if (stock.packed_stock > 0) {
            const used = Math.min(stock.packed_stock, remainingQty);
            stock.packed_stock -= used;
            packedUsed = used;
            remainingQty -= used;
        }

        if (remainingQty > 0 && stock.unpacked_stock > 0) {
            const used = Math.min(stock.unpacked_stock, remainingQty);
            stock.unpacked_stock -= used;
            unpackedUsed = used;
            remainingQty -= used;
        }

        if (remainingQty > 0) {
            productionRequired = remainingQty;
        }

        stock.stock = stock.packed_stock + stock.unpacked_stock;
        await stock.save();

        const dateNow = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

        await logStockHistory({
            productId: product.product_id,
            orderNumber,
            action: STOCK_ACTIONS.STOCK_SALE,
            stockType: STOCK_TYPES.STOCK_PACKED,
            quantity: packedUsed,
            previousStock: previousPacked,
            newStock: stock.packed_stock,
            notes: `Sale of PACKED stock for Order #${orderNumber}, Product #${product.product_id}, Qty:${packedUsed}, Date:${dateNow}`,
            employeeId
        });

        await logStockHistory({
            productId: product.product_id,
            orderNumber,
            action: STOCK_ACTIONS.STOCK_SALE,
            stockType: STOCK_TYPES.STOCK_UNPACKED,
            quantity: unpackedUsed,
            previousStock: previousUnPacked,
            newStock: stock.unpacked_stock,
            notes: `Sale of UNPACKED stock for Order #${orderNumber}, Product #${product.product_id}, Qty:${unpackedUsed}, Date:${dateNow}`,
            employeeId
        });

        product.available_stock = await calculateAvailableStock(product.product_id);
        await product.save();

        const availableStockUsed = packedUsed + unpackedUsed;

        logger.info(`✅ Stock updated → Product:${product.product_id}, Packed:${packedUsed}, Unpacked:${unpackedUsed}, ProductionRequired:${productionRequired}`);

        return { availableStockUsed, productionRequired, packedUsed, unpackedUsed };
    }),

    getAllBrands: asyncHandler(async () => {
        const productBrands = await Brand.find().sort({ created_at: -1 });
        return productBrands.map(mapProductBrandEntityToResponse);
    }),

    getActiveBrands: asyncHandler(async () => {
        const productBrands = await Brand.find({ status: "active" })
            .sort({ created_at: -1 });
        return productBrands.map(mapProductBrandEntityToResponse);
    }),

    getByBrandId: asyncHandler(async (brandId) => {
        const productBrand = await Brand.findOne({ brand_id: brandId }).lean();
        if (!productBrand) {
            throw new BadRequestException(`No product brand found with ID ${brandId}`);
        }

        return mapProductBrandEntityToResponse(productBrand);
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
        if (typeof description === "string" && description.trim() !== "") {
            descriptionNote = description;
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

    returnStock: asyncHandler(async (product_id, quantity, employeeId, employeeRole, orderNumber) => {
        if (!product_id || !quantity || quantity <= 0) {
            throw new BadRequestException("Invalid product ID or quantity to return.");
        }

        const product = await Product.findOne({ product_id });
        if (!product) {
            throw new BadRequestException(`Product not found: ${product_id}`);
        }

        await saveOrUpdateStockTransaction({
            product,
            quantity: quantity,
            action: STOCK_ACTIONS.STOCK_RETURN,
            employeeId,
            role,
            orderNumber
        });

        return product;
    }),

}

export { productService };