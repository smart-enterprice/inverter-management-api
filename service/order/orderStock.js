// service/order/orderStock.js

import { BadRequestException } from "../../middleware/CustomError.js";
import Product from "../../models/product.js";
import { ORDER_STATUSES, STOCK_ACTIONS } from "../../utils/constants.js";
import { productService, saveOrUpdateStockTransaction } from "../productService.js";

export const normalizeStock = (source = {}) => ({
    PACKED: source.PACKED ?? 0,
    UNPACKED: source.UNPACKED ?? 0,
    PRODUCTION: source.PRODUCTION ?? 0
});

export const initializeStockState = (orderDetail) => {
    const {
        PACKED = 0,
        UNPACKED = 0,
        PRODUCTION = 0
    } = orderDetail.stock_flags || {};

    return { PACKED, UNPACKED, PRODUCTION };
};

export const applyProductionTransitions = (stock, dto) => {
    let { PACKED, UNPACKED, PRODUCTION } = stock;

    if (dto.has_production_completed && PRODUCTION > 0) {
        UNPACKED += PRODUCTION;
        PRODUCTION = 0;
    }

    if (dto.has_unPacked_completed && UNPACKED > 0) {
        PACKED += UNPACKED;
        UNPACKED = 0;
    }

    return { PACKED, UNPACKED, PRODUCTION };
};

export const consumeStockForCancellation = ({ qty, stock }) => {
    let remaining = qty;

    const consume = (available, shouldReturn = false) => {
        const used = Math.min(available, remaining);
        remaining -= used;

        return {
            left: available - used,
            returned: shouldReturn ? used : 0
        };
    };

    const production = consume(stock.PRODUCTION);
    const unpacked = consume(stock.UNPACKED, true);
    const packed = consume(stock.PACKED, true);

    return {
        stockState: {
            PACKED: packed.left,
            UNPACKED: unpacked.left,
            PRODUCTION: production.left
        },
        returns: [
            { qty: unpacked.returned, type: STOCK_TYPES.STOCK_UNPACKED },
            { qty: packed.returned, type: STOCK_TYPES.STOCK_PACKED }
        ].filter(r => r.qty > 0)
    };
};

export const updateStockFlags = (orderDetail, stock) => {
    orderDetail.stock_flags = {
        ...stock,
        hasUnpacked: stock.UNPACKED > 0,
        hasProduction: stock.PRODUCTION > 0
    };
};

export const persistStockReturns = async ({
    product,
    returns,
    employeeId,
    role,
    orderNumber,
    orderDetailsNumber
}) => {
    for (const { qty, type }
        of returns) {
        if (qty > 0) {
            await saveOrUpdateStockTransaction({
                product,
                quantity: qty,
                action: STOCK_ACTIONS.STOCK_RETURN,
                stockType: type,
                employeeId,
                role,
                orderNumber,
                orderDetailsNumber
            });
        }
    }
};

export const returnStockForDetail = async ({
    detail,
    employeeId,
    employeeRole,
    orderNumber
}) => {
    const {
        order_details_number,
        product_id,
        qty_ordered,
        stock_usage,
        stock_flags
    } = detail;

    if (!product_id || !qty_ordered) {
        throw new BadRequestException("Invalid order detail payload");
    }

    const product = await Product.findOne({ product_id });
    if (!product) {
        throw new BadRequestException(`Product not found: ${product_id}`);
    }

    const usage = normalizeStock(stock_usage);
    const flags = normalizeStock(stock_flags);

    const effectiveStock = usage.PRODUCTION > 0 ? flags : usage;

    const stockEntries = [
        { type: STOCK_TYPES.STOCK_PACKED, quantity: effectiveStock.PACKED },
        { type: STOCK_TYPES.STOCK_UNPACKED, quantity: effectiveStock.UNPACKED },
        { type: STOCK_TYPES.STOCK_PRODUCTION, quantity: effectiveStock.PRODUCTION }
    ].filter(entry => entry.quantity > 0);

    if (!stockEntries.length) {
        detail.status = ORDER_STATUSES.CANCELLED;
        return;
    }

    await Promise.all(
        stockEntries.map(({ type, quantity }) =>
            saveOrUpdateStockTransaction({
                product,
                quantity,
                action: STOCK_ACTIONS.STOCK_RETURN,
                stockType: type,
                employeeId,
                role: employeeRole,
                orderNumber,
                order_details_number,
                stockNotes: "Order cancelled - stock returned",
                productionRequired: type === STOCK_TYPES.PRODUCTION ? quantity : 0
            })
        )
    );

    detail.status = ORDER_STATUSES.CANCELLED;
};