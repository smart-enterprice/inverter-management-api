// validations/productValidation.js

import { body } from "express-validator";
import { validateRequest } from "./orderValidation.js";

const PRODUCT_STATUS_VALUES = ["active", "inactive", "discontinued"];

export const createProductValidation = [
    body("brand")
        .isString().withMessage("brand must be a string.")
        .trim()
        .notEmpty().withMessage("brand is required."),

    body("model")
        .isString().withMessage("model must be a string.")
        .trim()
        .notEmpty().withMessage("model is required."),

    body("product_name")
        .isString().withMessage("product_name must be a string.")
        .trim()
        .notEmpty().withMessage("product_name is required.")
        .isLength({ max: 200 }).withMessage("product_name exceeds 200 characters."),

    body("product_type")
        .isString().withMessage("product_type must be a string.")
        .trim()
        .notEmpty().withMessage("product_type is required."),

    // Free text, same as product_type — users can create new categories
    // from the UI instead of being limited to a fixed list.
    body("product_category")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("product_category must be a string.")
        .trim()
        .isLength({ max: 60 }).withMessage("product_category exceeds 60 characters."),

    body("price")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("price must be a non-negative number."),

    body("cost")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("cost must be a non-negative number."),

    body("status")
        .optional({ nullable: true, checkFalsy: true })
        .isIn(PRODUCT_STATUS_VALUES)
        .withMessage(`status must be one of: ${PRODUCT_STATUS_VALUES.join(", ")}`),

    validateRequest,
];

// updateProduct accepts a partial payload — every field is optional, but if
// present must still satisfy the same constraints.
export const updateProductValidation = [
    body("brand").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty().withMessage("brand cannot be empty."),
    body("model").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty().withMessage("model cannot be empty."),
    body("product_name").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty().isLength({ max: 200 }).withMessage("product_name invalid."),
    body("product_type").optional({ nullable: true, checkFalsy: true }).isString().trim().notEmpty().withMessage("product_type cannot be empty."),

    // Free text, same as product_type — users can create new categories
    // from the UI instead of being limited to a fixed list.
    body("product_category")
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage("product_category must be a string.")
        .trim()
        .isLength({ max: 60 }).withMessage("product_category exceeds 60 characters."),

    body("price").optional({ nullable: true }).isFloat({ min: 0 }).withMessage("price must be non-negative."),
    body("cost").optional({ nullable: true }).isFloat({ min: 0 }).withMessage("cost must be non-negative."),

    body("status")
        .optional({ nullable: true, checkFalsy: true })
        .isIn(PRODUCT_STATUS_VALUES)
        .withMessage(`status must be one of: ${PRODUCT_STATUS_VALUES.join(", ")}`),

    validateRequest,
];
