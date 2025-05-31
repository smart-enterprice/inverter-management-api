// employeeservice.js

import asyncHandler from "express-async-handler";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import employeeSchema from '../models/employees.js';
import { generateUniqueEmployeeId } from '../utils/generatorIds.js';
import {
    BadRequestException,
    ConflictException,
    ValidationException,
    NotFoundException,
    UnauthorizedException
} from '../middleware/CustomError.js';
import logger from '../utils/logger.js';
import dotenv from "dotenv";

dotenv.config();

const ALLOWED_ROLES = ['ROLE_ADMIN', 'ROLE_SUPERVISOR', 'ROLE_MANAGER'];
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

const sanitizeInput = (input) => {
    if (typeof input === 'string') {
        return validator.escape(input.trim());
    }
    return input;
};

const validateEmployeeData = (employeeRequest, isUpdate = false) => {
    const errors = [];

    if (!isUpdate || employeeRequest.employee_name !== undefined) {
        if (!employeeRequest.employee_name || employeeRequest.employee_name.trim().length < 2) {
            errors.push({ field: 'employee_name', message: 'Name must be at least 2 characters long' });
        }
        if (employeeRequest.employee_name && employeeRequest.employee_name.length > 150) {
            errors.push({ field: 'employee_name', message: 'Name cannot exceed 150 characters' });
        }
    }

    if (!isUpdate || employeeRequest.employee_email !== undefined) {
        if (!employeeRequest.employee_email) {
            errors.push({ field: 'employee_email', message: 'Email is required' });
        } else if (!validator.isEmail(employeeRequest.employee_email)) {
            errors.push({ field: 'employee_email', message: 'Please provide a valid email address' });
        }
    }

    if (!isUpdate || employeeRequest.password !== undefined) {
        if (!employeeRequest.password) {
            errors.push({ field: 'password', message: 'Password is required' });
        } else {
            if (employeeRequest.password.length < 9) {
                errors.push({ field: 'password', message: 'Password must be at least 8 characters long' });
            }
            if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(employeeRequest.password)) {
                errors.push({
                    field: 'password',
                    message: 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
                });
            }
        }
    }

    if (!isUpdate || employeeRequest.employee_phone !== undefined) {
        if (!employeeRequest.employee_phone) {
            errors.push({ field: 'employee_phone', message: 'Phone number is required' });
        } else if (!validator.isMobilePhone(employeeRequest.employee_phone, 'any', { strictMode: false })) {
            errors.push({ field: 'employee_phone', message: 'Please provide a valid phone number' });
        }
    }

    if (!isUpdate || employeeRequest.role !== undefined) {
        if (!employeeRequest.role) {
            errors.push({ field: 'role', message: 'Role is required' });
        } else if (!ALLOWED_ROLES.includes(employeeRequest.role.toUpperCase())) {
            errors.push({
                field: 'role',
                message: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`
            });
        }
    }

    if (errors.length > 0) {
        throw new ValidationException('Validation failed', errors);
    }
};

const checkExistingEmployee = async(email, phone, excludeId = null) => {
    const query = excludeId ? { _id: { $ne: excludeId } } : {};

    const [existingEmail, existingPhone] = await Promise.all([
        employeeSchema.findOne({...query, employee_email: email }),
        employeeSchema.findOne({...query, employee_phone: phone })
    ]);

    if (existingEmail) {
        throw new ConflictException('📧 Email already exists. Please use a different email.');
    }

    if (existingPhone) {
        throw new ConflictException('📱 Phone number already exists. Please use a different phone number.');
    }
};

const hashPassword = async(password) => {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
};

const generateToken = (employeeId, role, status) => {
    return jwt.sign({
            employee_id: employeeId,
            role,
            status,
            iat: Math.floor(Date.now() / 1000)
        },
        JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
    );
};

const mapRequestToEntity = (employeeRequest, employeeId, isUpdate = false) => {
    const entity = {};

    if (employeeId) entity.employee_id = employeeId;
    if (!isUpdate) entity.status = 'active';

    const fieldsToMap = [
        'employee_name', 'employee_email', 'employee_phone', 'role',
        'created_by', 'shop_name', 'district', 'town', 'brand', 'address'
    ];

    fieldsToMap.forEach(field => {
        if (employeeRequest[field] !== undefined) {
            entity[field] = sanitizeInput(employeeRequest[field]);
        }
    });

    if (employeeRequest.photo !== undefined) {
        entity.photo = employeeRequest.photo;
    }

    return entity;
};

const mapEntityToResponse = (employeeEntity) => {
    const response = {};

    const fieldsToMap = [
        'employee_id', 'employee_name', 'employee_email', 'employee_phone',
        'role', 'status', 'created_by', 'shop_name', 'photo',
        'district', 'town', 'brand', 'address', 'created_at', 'updated_at'
    ];

    fieldsToMap.forEach(field => {
        if (employeeEntity[field] !== undefined) {
            response[field] = employeeEntity[field];
        }
    });

    return response;
};

const employeeService = {
    createEmployee: asyncHandler(async(employeeRequest) => {
        validateEmployeeData(employeeRequest);
        await checkExistingEmployee(employeeRequest.employee_email, employeeRequest.employee_phone);

        const employeeId = await generateUniqueEmployeeId();
        logger.info(`Generated Employee ID: ${employeeId}`);

        const hashedPassword = await hashPassword(employeeRequest.password);

        const employeeData = mapRequestToEntity(employeeRequest, employeeId);
        employeeData.password = hashedPassword;

        const newEmployee = new employeeSchema(employeeData);
        await newEmployee.save();

        logger.info(`Employee created: ${employeeId}`);
        return mapEntityToResponse(newEmployee);
    }),

    loginEmployee: asyncHandler(async(loginRequest) => {
        const { employee_email, password } = loginRequest;

        if (!employee_email || !password) {
            throw new BadRequestException('Email and password are required');
        }

        if (!validator.isEmail(employee_email)) {
            throw new BadRequestException('Please provide a valid email address');
        }

        const employee = await employeeSchema.findOne({
            employee_email: employee_email,
            status: 'active'
        }).select('+password');

        if (!employee) {
            logger.warn(`Failed login attempt for email: ${employee_email}`);
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(password, employee.password);
        if (!isPasswordValid) {
            logger.warn(`Invalid password for: ${employee.employee_id}`);
            throw new UnauthorizedException('Invalid credentials');
        }

        const token = generateToken(employee.employee_id, employee.role, employee.status);
        logger.info(`Employee logged in: ${employee.employee_id}`);

        return {
            employee: mapEntityToResponse(employee),
            access_token: token,
            expiresIn: JWT_EXPIRES_IN
        };
    }),

    getEmployeeById: asyncHandler(async(employeeId) => {
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        const employee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        return mapEntityToResponse(employee);
    }),

    updateEmployee: asyncHandler(async(employeeId, updateData) => {
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        validateEmployeeData(updateData, true);

        const existingEmployee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!existingEmployee) {
            throw new NotFoundException('Employee not found');
        }

        if (updateData.employee_email || updateData.employee_phone) {
            await checkExistingEmployee(
                updateData.employee_email || existingEmployee.employee_email,
                updateData.employee_phone || existingEmployee.employee_phone,
                existingEmployee._id
            );
        }

        if (updateData.password) {
            updateData.password = await hashPassword(updateData.password);
        }

        const mappedData = mapRequestToEntity(updateData, null, true);
        mappedData.updated_at = new Date();

        const updatedEmployee = await employeeSchema.findOneAndUpdate({ employee_id: employeeId },
            mappedData, { new: true, runValidators: true }
        );

        logger.info(`Employee updated: ${employeeId}`);
        return mapEntityToResponse(updatedEmployee);
    }),

    validateEmployeeRole: (role) => {
        if (!role || typeof role !== 'string') {
            throw new BadRequestException('Role is required and must be a string');
        }
        if (!ALLOWED_ROLES.includes(role.toUpperCase())) {
            throw new BadRequestException(`Role must be one of: ${ALLOWED_ROLES.join(', ')}`);
        }
    },

    createAccountLimiter: rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        message: {
            success: false,
            message: 'Too many account creation attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    }),

    loginLimiter: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: {
            success: false,
            message: 'Too many login attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    })
};

export { employeeService, mapEntityToResponse };