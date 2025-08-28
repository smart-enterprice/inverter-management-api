// employeeController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";
import xss from "xss";

import { employeeService } from "../service/employeeService.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import employeeSchema from "../models/employees.js";
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import { mapEmployeeEntityToResponse } from "../utils/modelMapper.js";
import { revealPassword } from "../utils/employeeAuth.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";
import { ROLES } from "../utils/constants.js";

const getPaginationParams = (query) => {
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "10", 10);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// get employeeId token -> const loggedInEmployeeId = req.user.employee_id;
const signUpRoles = ['ROLE_SUPER_ADMIN', 'ROLE_ADMIN'];

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

    sanitizeInputBody,

    signup: [
        employeeService.createAccountLimiter,
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            if (!req.user || !signUpRoles.includes(req.user.role)) {
                throw new UnauthorizedException(`Access denied: This action requires one of the following roles: ${signUpRoles.join(', ')}.`);
            }

            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Request body is required");
            }

            const createdByEmployeeId = CurrentRequestContext.getEmployeeId();
            const newEmployee = await employeeService.createEmployee(req.body, createdByEmployeeId);

            return res.status(201).json({
                success: true,
                status: 201,
                message: "🎉 Account created successfully! Welcome aboard!",
                data: newEmployee,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getProfileByEmployeeId: [
        asyncHandler(async (req, res) => {
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
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    updateProfile: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            const { employeeId } = req.params;

            if (!employeeId) {
                throw new BadRequestException("Employee ID is required");
            }

            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Update data is required");
            }

            const updatedEmployee = await employeeService.updateEmployee(employeeId, req.body);

            logger.info("Profile updated successfully: ", employeeId);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "✅ Profile updated successfully!",
                data: updatedEmployee,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getProfile: [
        asyncHandler(async (req, res) => {
            const employee = await employeeService.getProfile();

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Employee profile retrieved successfully",
                data: employee,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getAllEmployees: [
        asyncHandler(async (req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const filter = {
                status: "active",
                role: { $ne: ROLES.DEALER }
            };

            const [employees, total] = await Promise.all([
                employeeSchema.find(filter)
                    .select("-password")
                    .skip(skip)
                    .limit(limit)
                    .sort({ created_at: -1 }),

                employeeSchema.countDocuments(filter)
            ]);

            res.status(200).json({
                success: true,
                status: 200,
                message: "Employees retrieved successfully",
                data: {
                    employees: employees.map(mapEmployeeEntityToResponse),
                    pagination: page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getAllDealerEmployees: [
        asyncHandler(async (req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const filter = {
                status: "active",
                role: ROLES.DEALER,
            };

            const [employees, total] = await Promise.all([
                employeeSchema.find(filter)
                    .select("-password")
                    .skip(skip)
                    .limit(limit)
                    .sort({ created_at: -1 }),

                employeeSchema.countDocuments(filter)
            ]);

            res.status(200).json({
                success: true,
                status: 200,
                message: "Dealer employees retrieved successfully",
                data: {
                    employees: employees.map(mapEmployeeEntityToResponse),
                    pagination: page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getAllEmployeesWithPassword: [
        asyncHandler(async (req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const [employees, total] = await Promise.all([
                employeeSchema.find({ status: "active" })
                    .skip(skip)
                    .limit(limit)
                    .sort({ created_at: -1 }),

                employeeSchema.countDocuments({ status: "active" })
            ]);

            const mappedEmployees = await Promise.all(employees.map(async (emp) => {
                if (!emp.password) {
                    throw new BadRequestException(`Missing password for employee ID: ${emp._id}`);
                }
                const decryptedPassword = await revealPassword(emp.password);
                return mapEmployeeEntityToResponse(emp, decryptedPassword);
            }));

            res.status(200).json({
                success: true,
                status: 200,
                message: "Employees with passwords retrieved successfully",
                data: {
                    employees: mappedEmployees,
                    pagination: page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    resetPassword: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            const employee = await employeeService.resetPassword(req.body);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Employee profile retrieved successfully",
                data: employee,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    resetPasswordById: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            const { employeeId } = req.params;

            if (!employeeId) {
                throw new BadRequestException("Employee ID is required");
            }

            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Reset password data is required");
            }

            const employee = await employeeService.resetPasswordById(employeeId, req.body);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Employee profile retrieved successfully",
                data: employee,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    deleteEmployee: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            const { employeeId } = req.body;

            if (!employeeId) {
                throw new BadRequestException('Employee ID is required');
            }

            const deletedEmployee = await employeeService.deleteEmployee(req.body);

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Employee deleted successfully',
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });

        })
    ],

    getAllDeletedEmployees: [
        asyncHandler(async (req, res) => {
            if (!req.user || !signUpRoles.includes(req.user.role)) {
                throw new UnauthorizedException(`Access denied: This action requires one of the following roles: ${signUpRoles.join(', ')}.`);
            }

            const page = parseInt(req.query.page || "1", 10);
            const limit = parseInt(req.query.limit || "10", 10);
            const skip = (page - 1) * limit;

            const filter = { status: "deleted", role: { $ne: ROLES.DEALER } };

            const [deletedEmployees, totalDeleted] = await Promise.all([
                employeeSchema.find(filter)
                    .select("-password")
                    .skip(skip)
                    .limit(limit)
                    .sort({ created_at: -1 }),

                employeeSchema.countDocuments(filter)
            ]);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Deleted employees retrieved successfully",
                data: {
                    employees: deletedEmployees.map(emp => mapEmployeeEntityToResponse(emp)),
                    pagination: {
                        page,
                        limit,
                        total: totalDeleted,
                        pages: Math.ceil(totalDeleted / limit)
                    }
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getAllDeletedDealerEmployees: [
        asyncHandler(async (req, res) => {
            if (!req.user || !signUpRoles.includes(req.user.role)) {
                throw new UnauthorizedException(`Access denied: This action requires one of the following roles: ${signUpRoles.join(', ')}.`);
            }

            const page = parseInt(req.query.page || "1", 10);
            const limit = parseInt(req.query.limit || "10", 10);
            const skip = (page - 1) * limit;

            const filter = { status: "deleted", role: ROLES.DEALER };

            const [deletedEmployees, totalDeleted] = await Promise.all([
                employeeSchema
                    .find(filter)
                    .select("-password")
                    .skip(skip)
                    .limit(limit)
                    .sort({ created_at: -1 }),

                employeeSchema.countDocuments(filter)
            ]);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Deleted dealer employees retrieved successfully",
                data: {
                    employees: deletedEmployees.map(mapEmployeeEntityToResponse),
                    pagination: {
                        page,
                        limit,
                        total: totalDeleted,
                        pages: Math.ceil(totalDeleted / limit),
                    },
                },
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    createDealerDiscount: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            if (!req.body || Object.keys(req.body).length === 0) {
                throw new BadRequestException("Request body is required");
            }

            const dealerDiscountData = await employeeService.createDealerDiscount(req.body);
            return res.status(200).json({
                success: true,
                status: 200,
                message: "🎉 Dealer Discount created successfully!",
                data: dealerDiscountData,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    createDealerDiscountList: [
        sanitizeInputBody,
        asyncHandler(async (req, res) => {
            if (!Array.isArray(req.body) || req.body.length === 0) {
                throw new BadRequestException("Request body must be a non-empty array of dealer discounts.");
            }

            const createdDiscounts = await Promise.all(
                req.body.map(discountData => employeeService.createDealerDiscount(discountData))
            );

            return res.status(200).json({
                success: true,
                status: 200,
                message: "🎉 Dealer discounts created successfully!",
                data: createdDiscounts,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getDealerDiscount: [
        asyncHandler(async (req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const dealerDiscountData = await employeeService.getDealerDiscount(req.body || {}, { page, limit });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "✅ Dealer discounts fetched successfully!",
                data: dealerDiscountData.data,
                pagination: dealerDiscountData.pagination,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

};

export default employeeController;