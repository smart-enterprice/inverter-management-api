import { BadRequestException } from "../middleware/CustomError.js";
import { ALLOWED_TRANSITIONS, CANCELLABLE_STATUSES, ORDER_STATUSES } from "./constants.js";

export const normalizeStatus = (s) => String(s || "").trim().toUpperCase();

export const isValidStatus = (s) => Object.values(ORDER_STATUSES).includes(s);

export const isValidTransition = (from, to) => {
    if (!from || !to) return false;
    return (ALLOWED_TRANSITIONS[from] || []).includes(to);
};

export const assertValidStatus = (s) => {
    if (!isValidStatus(s)) throw new BadRequestException(`Invalid order status: ${s}`);
};

export const assertTransitionAllowed = (from, to) => {
    if (!isValidTransition(from, to)) {
        throw new BadRequestException(`Invalid order status transition: ${from} → ${to}`);
    }
};

export const assertRejectAllowed = (from) => {
    if (from !== ORDER_STATUSES.PENDING) {
        throw new BadRequestException("REJECTED is only allowed from PENDING.");
    }
};

export const assertCancellable = (from) => {
    if (!CANCELLABLE_STATUSES.has(from)) {
        throw new BadRequestException(`Cannot cancel order at status '${from}'. Cancellation allowed only before INVOICE.`);
    }
};