// service/order/orderStatus.js

import { ORDER_STATUSES } from "../../utils/constants.js";

const ORDER_STATUS_PRIORITY = [
    ORDER_STATUSES.REJECTED,
    // ORDER_STATUSES.CANCELLED, // intentionally skipped as in original logic
    ORDER_STATUSES.PRODUCTION,
    ORDER_STATUSES.PACKED,
    ORDER_STATUSES.INVOICE,
    ORDER_STATUSES.SHIPPED
];

export const deriveOrderStatusFromDetails = (details = []) => {
    if (!Array.isArray(details) || details.length === 0) {
        return ORDER_STATUSES.PENDING;
    }

    // Fast path for single item
    if (details.length === 1) {
        const { status } = details[0] || {};
        return status || ORDER_STATUSES.PENDING;
    }

    // Build status set while ignoring CANCELLED
    const statusSet = new Set(
        details.map(({ status }) => status)
            .filter(status => status && status !== ORDER_STATUSES.CANCELLED)
    );

    // Resolve priority status
    for (const status of ORDER_STATUS_PRIORITY) {
        if (statusSet.has(status)) {
            return status;
        }
    }

    // Check if all delivered or completed
    const allDelivered = details.every(({ status }) =>
        status === ORDER_STATUSES.DELIVERED ||
        status === ORDER_STATUSES.COMPLETED
    );

    if (allDelivered) {
        return ORDER_STATUSES.COMPLETED;
    }

    // Check if all cancelled
    const allCancelled = details.every(
        ({ status }) => status === ORDER_STATUSES.CANCELLED
    );

    if (allCancelled) {
        return ORDER_STATUSES.CANCELLED;
    }

    // Check if all rejected
    const allRejected = details.every(
        ({ status }) => status === ORDER_STATUSES.REJECTED
    );

    if (allRejected) {
        return ORDER_STATUSES.REJECTED;
    }

    return ORDER_STATUSES.CONFIRMED;
};

export const allDetailsDelivered = (details = []) =>
    Array.isArray(details) &&
    details.length > 0 &&
    details.every(detail =>
        detail.status === ORDER_STATUSES.DELIVERED ||
        detail.status === ORDER_STATUSES.COMPLETED
    );

const ORDER_STATUS_TRANSITIONS = {
    PENDING: ["PENDING", "CONFIRMED"],
    CONFIRMED: ["PENDING", "CONFIRMED"],
    PRODUCTION: ["CONFIRMED", "PRODUCTION"],
    PACKED: ["PRODUCTION", "PACKED"],
    INVOICE: ["PACKED", "INVOICE"],
    SHIPPED: ["INVOICE", "SHIPPED"],
    DELIVERED: ["SHIPPED", "DELIVERED"],
    COMPLETED: ["DELIVERED"]
};

export const canMoveOrderToTargetStatus = (details = [], targetStatus) => {

    const allowedStatuses = ORDER_STATUS_TRANSITIONS[targetStatus];

    if (!Array.isArray(details) || !Array.isArray(allowedStatuses)) {
        return false;
    }

    return details.every(detail =>
        allowedStatuses.includes(detail.status)
    );
};

export const resolveOrderDetailStatus = ({
    qtyOrdered,
    qtyDelivered,
    packedQty,
    hasProduction,
    hasUnpacked,
    currentStatus
}) => {
    const isCancelled = qtyOrdered === 0;
    const isDelivered = qtyDelivered >= qtyOrdered;
    const isInProduction = hasProduction || hasUnpacked;
    const isPackedCandidate =
        packedQty > 0 && !hasProduction && !hasUnpacked;

    console.debug(
        "[OrderStatusEngine] resolveOrderDetailStatus", {
        input: {
            qtyOrdered,
            qtyDelivered,
            packedQty,
            hasProduction,
            hasUnpacked,
            currentStatus
        },
        checks: {
            isCancelled,
            isDelivered,
            isInProduction,
            isPackedCandidate
        }
    });

    if (isCancelled) {
        return ORDER_STATUSES.CANCELLED;
    }

    if (isDelivered) {
        return ORDER_STATUSES.DELIVERED;
    }

    // 3️⃣ Auto move from CONFIRMED
    if (currentStatus === ORDER_STATUSES.CONFIRMED) {

        if (isInProduction) {
            return ORDER_STATUSES.PRODUCTION;
        }

        if (packedQty > 0) {
            return ORDER_STATUSES.PACKED;
        }

        return ORDER_STATUSES.CONFIRMED;
    }

    if (isInProduction) {
        return ORDER_STATUSES.PRODUCTION;
    }

    if (isPackedCandidate) {
        return ORDER_STATUSES.PACKED;
    }

    return currentStatus;
};