// validations/dealerDiscountValidation.js

import { body } from "express-validator";
import { validateRequest } from "./orderValidation.js";

// Shared rules for a single discount payload, factored so create + bulk-create
// share one source of truth.
const singleDiscountRules = (prefix = "") => [
    body(`${prefix}brand_name`)
        .isString().withMessage("brand_name must be a string.")
        .trim()
        .notEmpty().withMessage("brand_name is required."),

    body(`${prefix}model_name`)
        .isString().withMessage("model_name must be a string.")
        .trim()
        .notEmpty().withMessage("model_name is required."),

    body(`${prefix}dealer_id`)
        .isString().withMessage("dealer_id must be a string.")
        .trim()
        .notEmpty().withMessage("dealer_id is required."),

    body(`${prefix}discount_value`)
        .isFloat({ min: 0 }).withMessage("discount_value must be a non-negative number."),

    body(`${prefix}is_percentage`)
        .isBoolean().withMessage("is_percentage must be a boolean."),
];

export const createDealerDiscountValidation = [
    ...singleDiscountRules(),
    validateRequest,
];

export const createDealerDiscountListValidation = [
    body()
        .isArray({ min: 1 }).withMessage("Request body must be a non-empty array of dealer discounts."),
    ...singleDiscountRules("*."),
    validateRequest,
];

export const updateDealerDiscountValidation = [
    body("dealer_discount_id")
        .isString().withMessage("dealer_discount_id must be a string.")
        .trim()
        .notEmpty().withMessage("dealer_discount_id is required."),

    // All other fields optional on update — only validate type/range when present.
    body("brand_name").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty(),
    body("model_name").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty(),
    body("dealer_id").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty(),
    body("discount_value").optional({ nullable: true }).isFloat({ min: 0 }).withMessage("discount_value must be non-negative."),
    body("is_percentage").optional({ nullable: true }).isBoolean(),

    validateRequest,
];
