// employeeController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";
import xss from "xss";

import {
    employeeService,
    mapEntityToResponse
} from "../service/employeeService.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import employeeSchema from "../models/employees.js";

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

const employeeController = {
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

    signup: [
        employeeService.createAccountLimiter,
        sanitizeInput,
        asyncHandler(async(req, res) => {
            console.log(`token role : ${req.user.role}`);
            if (!req.user || req.user.role !== 'ROLE_ADMIN') {
                throw new UnauthorizedException("Access denied: Only administrators are authorized to perform this action.");
            }

            logger.info("Signup attempt:", {
                email: req.body.employee_email,
                role: req.body.role,
                ip: req.ip,
                userAgent: req.get("User-Agent")
            });

            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Request body is required");
            }

            const newEmployee = await employeeService.createEmployee(req.body);

            return res.status(201).json({
                success: true,
                status: 201,
                message: "🎉 Account created successfully! Welcome aboard!",
                data: newEmployee,
                timestamp: new Date().toISOString()
            });
        })
    ],

    getProfile: [
        sanitizeInput,
        asyncHandler(async(req, res) => {
            const { employeeId } = req.params;

            if (!employeeId) {
                throw new BadRequestException("Employee ID is required");
            }

            const employee = await employeeService.getEmployeeById(employeeId);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Employee profile retrieved successfully",
                data: employee,
                timestamp: new Date().toISOString()
            });
        })
    ],

    updateProfile: [
        sanitizeInput,
        asyncHandler(async(req, res) => {
            const { employeeId } = req.params;

            if (!employeeId) {
                throw new BadRequestException("Employee ID is required");
            }

            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Update data is required");
            }

            logger.info("Profile update attempt:", {
                employeeId,
                updatedFields: Object.keys(req.body),
                ip: req.ip
            });

            const updatedEmployee = await employeeService.updateEmployee(employeeId, req.body);

            logger.info("Profile updated successfully:", {
                employeeId,
                ip: req.ip
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "✅ Profile updated successfully!",
                data: updatedEmployee,
                timestamp: new Date().toISOString()
            });
        })
    ],

    getAllEmployees: [
        sanitizeInput,
        asyncHandler(async(req, res) => {
            const page = parseInt(req.query.page || "1", 10);
            const limit = parseInt(req.query.limit || "10", 10);
            const skip = (page - 1) * limit;

            const employees = await employeeSchema
                .find({ status: "active" })
                .select("-password")
                .skip(skip)
                .limit(limit)
                .sort({ created_at: -1 });

            const total = await employeeSchema.countDocuments({ status: "active" });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Employees retrieved successfully",
                data: {
                    employees: employees.map(emp => mapEntityToResponse(emp)),
                    pagination: {
                        page,
                        limit,
                        total,
                        pages: Math.ceil(total / limit)
                    }
                },
                timestamp: new Date().toISOString()
            });
        })
    ]
};

export default employeeController;