// employeeController.js
import asyncHandler from "express-async-handler";
import helmet from "helmet";
import xss from "xss";

import { employeeService } from "../service/employeeService.js";
import { BadRequestException, UnauthorizedException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";
import employeeSchema from "../models/employees.js";
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import { mapEntityToResponse } from "../utils/employeeMapper.js";
import { revealPassword } from "../utils/employeeAuth.js";

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

    sanitizeInput,

    signup: [
        employeeService.createAccountLimiter,
        sanitizeInput,
        asyncHandler(async(req, res) => {
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
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
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
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],

    getProfile: [
        sanitizeInput,
        asyncHandler(async(req, res) => {
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const [employees, total] = await Promise.all([
                employeeSchema.find({ status: "active" })
                .select("-password")
                .skip(skip)
                .limit(limit)
                .sort({ created_at: -1 }),

                employeeSchema.countDocuments({ status: "active" })
            ]);

            res.status(200).json({
                success: true,
                status: 200,
                message: "Employees retrieved successfully",
                data: {
                    employees: employees.map(mapEntityToResponse),
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
            const { page, limit, skip } = getPaginationParams(req.query);

            const [employees, total] = await Promise.all([
                employeeSchema.find({ status: "active" })
                .skip(skip)
                .limit(limit)
                .sort({ created_at: -1 }),

                employeeSchema.countDocuments({ status: "active" })
            ]);

            const mappedEmployees = await Promise.all(employees.map(async(emp) => {
                if (!emp.password) {
                    throw new BadRequestException(`Missing password for employee ID: ${emp._id}`);
                }
                const decryptedPassword = await revealPassword(emp.password);
                return mapEntityToResponse(emp, decryptedPassword);
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
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
        sanitizeInput,
        asyncHandler(async(req, res) => {
            if (!req.user || !signUpRoles.includes(req.user.role)) {
                throw new UnauthorizedException(`Access denied: This action requires one of the following roles: ${signUpRoles.join(', ')}.`);
            }

            const page = parseInt(req.query.page || "1", 10);
            const limit = parseInt(req.query.limit || "10", 10);
            const skip = (page - 1) * limit;

            const [deletedEmployees, totalDeleted] = await Promise.all([
                employeeSchema
                .find({ status: "deleted" })
                .select("-password")
                .skip(skip)
                .limit(limit)
                .sort({ created_at: -1 }),
                employeeSchema.countDocuments({ status: "deleted" })
            ]);

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Deleted employees retrieved successfully",
                data: {
                    employees: deletedEmployees.map(emp => mapEntityToResponse(emp)),
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

};

export default employeeController;