// service/order/orderStock.js

import { ORDER_STATUSES, STOCK_ACTIONS } from "../../utils/constants.js";
import { productService, saveOrUpdateStockTransaction } from "../productService.js";

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
    const { PACKED = 0, UNPACKED = 0, PRODUCTION = 0 } =
        detail.stock_usage || {};

    if (PACKED || UNPACKED || PRODUCTION) {
        await productService.returnStock({
            product_id: detail.product_id,
            quantity: detail.qty_ordered,
            employeeId,
            employeeRole,
            orderNumber,
            stock_usage: { PACKED, UNPACKED, PRODUCTION }
        });
    }

    detail.status = ORDER_STATUSES.CANCELLED;
};