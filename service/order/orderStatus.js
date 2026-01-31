// service/order/orderStatus.js

import { ORDER_STATUSES } from "../../utils/constants.js";

export const deriveOrderStatusFromDetails = (details = []) => {
    if (!details.length) return ORDER_STATUSES.PENDING;

    const statuses = new Set(details.map(d => d.status));

    if (statuses.has(ORDER_STATUSES.REJECTED)) return ORDER_STATUSES.REJECTED;
    if (statuses.has(ORDER_STATUSES.CANCELLED)) return ORDER_STATUSES.CANCELLED;
    if (statuses.has(ORDER_STATUSES.PRODUCTION)) return ORDER_STATUSES.PRODUCTION;
    if (statuses.has(ORDER_STATUSES.PACKED)) return ORDER_STATUSES.PACKED;
    if (statuses.has(ORDER_STATUSES.INVOICE)) return ORDER_STATUSES.INVOICE;
    if (statuses.has(ORDER_STATUSES.SHIPPED)) return ORDER_STATUSES.SHIPPED;

    const allDelivered =
        details.length &&
        details.every(d => d.status === ORDER_STATUSES.DELIVERED);

    return allDelivered ?
        ORDER_STATUSES.COMPLETED :
        ORDER_STATUSES.CONFIRMED;
};

export const allDetailsDelivered = (details = []) =>
    details.length &&
    details.every(d => d.status === ORDER_STATUSES.DELIVERED);

export const canMoveOrderToTargetStatus = (details, targetStatus) => {
    const map = {
        PENDING: ["PENDING", "CONFIRMED"],
        CONFIRMED: ["PENDING", "CONFIRMED"],
        PRODUCTION: ["CONFIRMED", "PRODUCTION"],
        PACKED: ["PRODUCTION", "PACKED"],
        INVOICE: ["PACKED", "INVOICE"],
        SHIPPED: ["INVOICE", "SHIPPED"],
        DELIVERED: ["SHIPPED", "DELIVERED"],
        COMPLETED: ["DELIVERED"]
    };

    const allowedStatuses = map[targetStatus];
    return Array.isArray(allowedStatuses) &&
        details.every(d => allowedStatuses.includes(d.status));
};

export const resolveOrderDetailStatus = ({
    qtyOrdered,
    qtyDelivered,
    packedQty,
    hasProduction,
    hasUnpacked,
    currentStatus
}) => {
    if (qtyOrdered === 0) {
        return ORDER_STATUSES.CANCELLED;
    }
    if (qtyDelivered >= qtyOrdered) {
        return ORDER_STATUSES.DELIVERED;
    }
    if (hasProduction || hasUnpacked) {
        return ORDER_STATUSES.PRODUCTION;
    }
    if (packedQty > 0 && currentStatus === ORDER_STATUSES.CONFIRMED) {
        return ORDER_STATUSES.PACKED;
    }

    return currentStatus;
};