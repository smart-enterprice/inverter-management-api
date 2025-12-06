import { ALLOWED_TRANSITIONS, CANCELLABLE_STATUSES, ORDER_STATUSES } from "./constants.js";

export const normalizeStatus = (status) =>
    String(status || "").trim().toUpperCase();

export const isValidStatus = (status) =>
    Object.values(ORDER_STATUSES).includes(status);

export const isValidTransition = (from, to) =>
    (ALLOWED_TRANSITIONS[from] || []).includes(to);

export const assertTransition = (from, to) => {
    if (!isValidTransition(from, to)) {
        throw new BadRequestException(`Invalid order status transition: ${from} → ${to}`);
    }
};

export const assertRejectAllowed = (from) => {
    if (from !== ORDER_STATUSES.PENDING) { throw new BadRequestException("REJECTED can only be set from PENDING."); }
};

export const assertCancellable = (from) => {
    if (!CANCELLABLE_STATUSES.has(from)) {
        throw new BadRequestException(`Cannot cancel order at status '${from}'. Cancellation allowed only before INVOICE.`);
    }
};