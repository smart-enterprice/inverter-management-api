// authController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";
import xss from "xss";

import { employeeService } from "../service/employeeService.js";
import { BadRequestException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";

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

    sanitizeInput,

    signin: [
        employeeService.loginLimiter,
        sanitizeInput,
        asyncHandler(async(req, res) => {
            logger.info("Signin attempt:", {
                email: req.body.employee_email,
                ip: req.ip,
                userAgent: req.get("User-Agent")
            });

            if (!req.body || !req.body.employee_email || !req.body.password) {
                throw new BadRequestException("Email and password are required");
            }

            const loginResult = await employeeService.loginEmployee(req.body);

            const cookieOptions = {
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict"
            };

            res.cookie("jwt", loginResult.access_token, cookieOptions);

            logger.info("Signin successful:", {
                employeeId: loginResult.employee.employee_id,
                email: loginResult.employee.employee_email,
                ip: req.ip
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "🔐 Login successful! Welcome back!",
                data: {
                    employee: loginResult.employee,
                    token: loginResult.access_token,
                    expiresIn: loginResult.expiresIn
                },
                timestamp: new Date().toISOString()
            });
        })
    ],

    logout: asyncHandler(async(req, res) => {
        res.cookie("jwt", "", {
            expires: new Date(Date.now() + 10 * 1000),
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict"
        });

        logger.info("User logged out:", {
            ip: req.ip,
            userAgent: req.get("User-Agent")
        });

        return res.status(200).json({
            success: true,
            status: 200,
            message: "👋 Logged out successfully!",
            timestamp: new Date().toISOString()
        });
    })
};

export default authController;