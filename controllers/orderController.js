// orderController.js
import asyncHandler from "express-async-handler";
import { orderService, mapEntityToResponse } from "../service/orderService.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import orderSchema from "../models/order.js";
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';

const sanitizeInput = (req, res, next) => {
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === "string") {
                req.body[key] = xss(req.body[key]);
            }
        }
    }
    next();
};

// get employeeId token -> const loggedInEmployeeId = req.user.employee_id;
const signUpRoles = ['ROLE_SUPER_ADMIN', 'ROLE_ADMIN'];

const orderController = {
    sanitizeInput
};

export default orderController;