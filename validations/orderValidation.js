// validations/orderValidation.js
// Request-boundary validation for order endpoints. Catches malformed input
// (negative qty, missing required fields, wrong types) before business logic.

import { body, validationResult } from "express-validator";
import { ValidationException } from "../middleware/CustomError.js";

const PRIORITY_VALUES = ["HIGH", "MEDIUM", "LOW"];

export const validateRequest = (req, _res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    throw new ValidationException(
        "Validation failed",
        result.array().map((error) => ({
            field: error.path,
            message: error.msg,
        }))
    );
};

export const createOrderValidation = [
    body("dealer_id")
        .isString().withMessage("dealer_id must be a string.")
        .trim()
        .notEmpty().withMessage("dealer_id is required."),

    body("salesman_id")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("salesman_id must be a string.")
        .trim(),

    body("priority")
        .optional({ nullable: true, checkFalsy: true })
        .isIn(PRIORITY_VALUES)
        .withMessage(`priority must be one of: ${PRIORITY_VALUES.join(", ")}`),

    body("order_note")
        .optional({ nullable: true })
        .isString().withMessage("order_note must be a string.")
        .isLength({ max: 2000 }).withMessage("order_note exceeds 2000 characters."),

    body("delivery_date")
        .optional({ nullable: true, checkFalsy: true })
        .isISO8601().withMessage("delivery_date must be a valid ISO 8601 date."),

    body("amount_paid")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("amount_paid must be a non-negative number."),

    body("payment_method")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("payment_method must be a string.")
        .trim()
        .isLength({ max: 50 }).withMessage("payment_method exceeds 50 characters."),

    body("order_details")
        .isArray({ min: 1 }).withMessage("order_details must be a non-empty array."),

    body("order_details.*.product_id")
        .isString().withMessage("order_details[*].product_id must be a string.")
        .trim()
        .notEmpty().withMessage("order_details[*].product_id is required."),

    body("order_details.*.qty_ordered")
        .isInt({ min: 1 }).withMessage("order_details[*].qty_ordered must be a positive integer."),

    body("order_details.*.delivery_date")
        .isISO8601().withMessage("order_details[*].delivery_date must be a valid ISO 8601 date."),

    body("order_details.*.is_product_scheme")
        .optional({ nullable: true })
        .isBoolean().withMessage("order_details[*].is_product_scheme must be a boolean."),

    body("order_details.*.discount_price")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("order_details[*].discount_price must be a non-negative number."),

    body("order_details.*.dealer_discount_id")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("order_details[*].dealer_discount_id must be a string.")
        .trim(),

    validateRequest,
];

// Validates the payload for POST /order-details/:orderNumber/items.
// Body must contain `order_details` — same per-item rules as createOrder,
// but the order-level fields (dealer_id, priority, etc.) aren't accepted
// here because the parent order already has them.
export const addItemsToOrderValidation = [
    body("order_details")
        .isArray({ min: 1 }).withMessage("order_details must be a non-empty array."),

    body("order_details.*.product_id")
        .isString().withMessage("order_details[*].product_id must be a string.")
        .trim()
        .notEmpty().withMessage("order_details[*].product_id is required."),

    body("order_details.*.qty_ordered")
        .isInt({ min: 1 }).withMessage("order_details[*].qty_ordered must be a positive integer."),

    body("order_details.*.delivery_date")
        .isISO8601().withMessage("order_details[*].delivery_date must be a valid ISO 8601 date."),

    body("order_details.*.is_product_scheme")
        .optional({ nullable: true })
        .isBoolean().withMessage("order_details[*].is_product_scheme must be a boolean."),

    body("order_details.*.discount_price")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("order_details[*].discount_price must be a non-negative number."),

    body("order_details.*.dealer_discount_id")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("order_details[*].dealer_discount_id must be a string.")
        .trim(),

    validateRequest,
];
