// authController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";
import xss from "xss";

import jwt from 'jsonwebtoken';

import { employeeService } from "../service/employeeService.js";
import { BadRequestException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import { tokenBlacklistService } from "../service/tokenBlacklistService.js";


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
                timestamp: new Date().toISOString()
            });
        })
    ],

    logout: [
        asyncHandler(async(req, res) => {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new UnauthorizedException('No token provided or format is invalid');
            }

            const token = authHeader.split(' ')[1];
            const decoded = jwt.decode(token);

            if (!decoded || !decoded.exp) {
                throw new UnauthorizedException('Invalid token');
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const ttl = decoded.exp - currentTime;

            if (ttl > 0) {
                tokenBlacklistService.blacklistToken(token, ttl);
            }

            return res.status(200).json({
                success: true,
                message: '✅ Successfully logged out',
                timestamp: new Date().toISOString()
            });
        })
    ]

};

export default authController;