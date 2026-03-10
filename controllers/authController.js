// authController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";

import { employeeService } from "../service/employeeService.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";
import Employee from "../models/employees.js";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import { JWT_SECRET } from "../utils/constants.js";
import { tokenBlacklistService } from "../service/tokenBlacklistService.js";

const authController = {
    employeeSecurityMiddleware: [
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                },
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        })
    ],

    sanitizeInputBody,

    signin: [
        employeeService.loginLimiter,
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            if (!req.body || !req.body.employee_email || !req.body.password) {
                throw new BadRequestException("Email and password are required");
            }

            const loginResult = await employeeService.loginEmployee(req.body);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "🔐 Login successful! Welcome back!",
                data: {
                    employee: loginResult.employee,
                    token: loginResult.access_token,
                    expiresIn: loginResult.expiresIn
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    logout: [
        asyncHandler(async (req, res) => {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new UnauthorizedException('No token provided or format is invalid');
            }

            const token = authHeader.split(' ')[1];
            await employeeService.logout(token);

            return res.status(200).json({
                success: true,
                message: '✅ Successfully logged out',
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    checkTokenActive: [
        asyncHandler(async (req, res) => {
            const authHeader = req.headers.authorization;
            let isActive = true;

            try {
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    throw new BadRequestException("Missing token");
                }

                const token = authHeader.split(" ")[1];
                if (!token || token === "null" || token === "undefined") {
                    throw new BadRequestException("Invalid token");
                }

                const decoded = jwt.verify(token, JWT_SECRET);
                logger.debug("[AUTH] JWT verified");

                const { employee_id } = decoded;
                if (!employee_id) {
                    throw new BadRequestException("Invalid payload");
                }

                if (tokenBlacklistService.isBlacklisted(token)) {
                    throw new BadRequestException("Blacklisted token");
                }

                const employee = await Employee.findOne({
                    employee_id,
                    status: "active",
                });

                if (!employee) {
                    throw new BadRequestException("Inactive user");
                }

                logger.info("[AUTH] Token is active");
            } catch (err) {
                isActive = false;
                logger.error("[AUTH] Token validation failed", {
                    reason: err.message
                });
            }

            return res.status(200).json({
                success: true,
                active: isActive,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ]
};

export default authController;