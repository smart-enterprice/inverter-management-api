// employeeservice.js

import asyncHandler from "express-async-handler";
import rateLimit from 'express-rate-limit';
import validator from 'validator';

import employeeSchema from '../models/employees.js';
import { generateUniqueEmployeeId } from '../utils/generatorIds.js';
import logger from '../utils/logger.js';
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    UnauthorizedException
} from '../middleware/CustomError.js';

import { validateEmployeeData } from '../utils/validationUtils.js';
import { mapEmployeeRequestToEntity, mapEmployeeEntityToResponse } from '../utils/modelMapper.js';
import { hashPassword, generateToken, revealPassword, validatePassword } from '../utils/employeeAuth.js';
import {
    APPROVAL_GRANTED_ROLES,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ROLES
} from '../utils/constants.js';

const checkExistingEmployee = async(email, phone, excludeId = null) => {
    const query = excludeId ? { _id: { $ne: excludeId } } : {};

    const [existingEmail, existingPhone] = await Promise.all([
        employeeSchema.findOne({...query, employee_email: email }),
        employeeSchema.findOne({...query, employee_phone: phone })
    ]);

    const errors = [];
    if (existingEmail) errors.push("📧 Email already exists.");
    if (existingPhone) errors.push("📱 Phone number already exists.");

    if (errors.length > 0) {
        throw new ConflictException(errors.join(" "));
    }
};

const findActiveEmployee = async(employeeId, includePassword = false) => {
    const query = employeeSchema.findOne({ employee_id: employeeId, status: 'active' });
    if (includePassword) query.select('+password');

    const employee = await query;
    if (!employee) {
        logger.warn(`No active employee for ID: ${employeeId}`);
        throw new BadRequestException('');
    }

    return employee;
};

async function verifyCurrentPassword(employee, currentPassword) {
    try {
        const decryptedPassword = await revealPassword(employee.password);
        if (currentPassword !== decryptedPassword) {
            logger.warn(`Invalid current password for: ${employee.employee_email}`);
            throw new UnauthorizedException('Invalid credentials');
        }
    } catch (error) {
        logger.error(`Password decryption failed for ID: ${employee.employee_email}`, error);
        throw new BadRequestException('Password decryption error');
    }
}

async function updateEmployeePassword(employee, newPassword, updatedBy, role, reason) {
    const hashedPassword = await hashPassword(newPassword);
    employee.password = hashedPassword;

    const timeStamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    employee.log_note = `${employee.log_note || ''} | Password reset by: ${updatedBy}, Role: ${role}, Reason: ${reason}, Date: ${timeStamp}`;

    await employee.save();
}

const employeeService = {
    defaultSuperAdminSetup: asyncHandler(async() => {
        if (!SUPER_ADMIN || !SUPER_ADMIN_PHONE || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
            throw new Error("❌ Missing required SUPER_ADMIN environment variables.");
        }

        const existingAdmin = await employeeSchema.findOne({ employee_email: SUPER_ADMIN_EMAIL });
        if (existingAdmin) {
            if (!existingAdmin.employee_id || existingAdmin.employee_id.trim() === '') {
                const employeeId = await generateUniqueEmployeeId();
                existingAdmin.employee_id = employeeId;

                await existingAdmin.save();
                console.log("✅ Super Admin ID was missing and has been updated.");
            } else {
                console.log("⚠️ Super Admin already exists");
            }
            return;
        }

        const employeeId = await generateUniqueEmployeeId();

        const hashedPassword = await hashPassword(SUPER_ADMIN_PASSWORD);

        const superAdmin = new employeeSchema({
            employee_id: employeeId,
            employee_name: SUPER_ADMIN,
            employee_email: SUPER_ADMIN_EMAIL,
            employee_phone: SUPER_ADMIN_PHONE,
            password: hashedPassword,
            role: ROLES.SUPER_ADMIN,
            status: 'active',
            created_by: 'APPLICATION',
        });

        await superAdmin.save();

        console.log("✅ Default Super Admin created successfully.");
    }),

    createEmployee: asyncHandler(async(employeeRequest, createdByEmployeeId) => {
        if (!createdByEmployeeId) {
            throw new UnauthorizedException('You are not authorized to create an employee.');
        }

        validateEmployeeData(employeeRequest);
        await checkExistingEmployee(employeeRequest.employee_email, employeeRequest.employee_phone);

        const employeeId = await generateUniqueEmployeeId();
        logger.info(`Generated Employee ID: ${employeeId}`);

        const hashedPassword = await hashPassword(employeeRequest.password);

        const employeeData = mapEmployeeRequestToEntity(employeeRequest, employeeId);
        employeeData.password = hashedPassword;

        logger.info(`Created Employee ID: ${createdByEmployeeId}`);
        employeeData.created_by = createdByEmployeeId;

        const newEmployee = new employeeSchema(employeeData);
        await newEmployee.save();

        logger.info(`Employee created: ${employeeId}`);
        return mapEmployeeEntityToResponse(newEmployee);
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

        let decryptedPassword;
        try {
            decryptedPassword = await revealPassword(employee.password);
        } catch (error) {
            logger.error(`Password decryption failed for ID: ${employee.employee_email}`, error);
            throw new BadRequestException("Password decryption error");
        }

        if (password !== decryptedPassword) {
            logger.warn(`Invalid password attempt for: ${employee.employee_email}`);
            throw new UnauthorizedException("Invalid credentials");
        }

        const token = generateToken(employee.employee_id, employee.role, employee.status);
        logger.info(`Employee logged in: ${employee.employee_id}`);

        return {
            employee: mapEmployeeEntityToResponse(employee),
            access_token: token,
            expiresIn: JWT_EXPIRES_IN
        };
    }),

    getEmployeeById: asyncHandler(async(employeeId) => {
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }
        logger.info(`Employee ${employeeId}`);

        const employee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        return mapEmployeeEntityToResponse(employee);
    }),

    getProfile: asyncHandler(async() => {
        const employeeId = CurrentRequestContext.getEmployeeId();
        const role = CurrentRequestContext.getRole();

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

        return mapEmployeeEntityToResponse(employee);
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

        const mappedData = mapEmployeeRequestToEntity(updateData, employeeId, true);
        mappedData.updated_at = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

        const updatedEmployee = await employeeSchema.findOneAndUpdate({ employee_id: employeeId },
            mappedData, { new: true, runValidators: true }
        );

        logger.info(`Employee updated: ${employeeId}`);
        return mapEmployeeEntityToResponse(updatedEmployee);
    }),

    resetPassword: asyncHandler(async(updateData) => {
        const employeeId = CurrentRequestContext.getEmployeeId();

        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        logger.info(`Password reset (self) initiated by Employee ID: ${employeeId}`);

        const employee = await findActiveEmployee(employeeId, true);
        await verifyCurrentPassword(employee, updateData.current_password);
        validatePassword(updateData.password);

        await updateEmployeePassword(employee, updateData.password, employee.employee_name, employee.role, 'update password for own');

        logger.info(`Password reset (self) successful for Employee ID: ${employee.employee_id}`);
        return mapEmployeeEntityToResponse(employee);
    }),

    resetPasswordById: asyncHandler(async(employeeId, updateData) => {
        const requesterId = CurrentRequestContext.getEmployeeId();

        if (!requesterId || !employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        logger.info(`Password reset (admin) initiated by Employee ID: ${requesterId} for target ID: ${employeeId}`);

        const targetEmployee = await findActiveEmployee(employeeId, true);
        validatePassword(updateData.password);

        const requestingEmployee = await findActiveEmployee(requesterId);
        await updateEmployeePassword(targetEmployee, updateData.password, requestingEmployee.employee_name, requestingEmployee.role, `admin reset password`);

        logger.info(`Password reset (admin) successful for Employee ID: ${targetEmployee.employee_id}`);
        return mapEmployeeEntityToResponse(targetEmployee);
    }),

    deleteEmployee: asyncHandler(async(updateData) => {
        const { employeeId, reason } = updateData;

        if (!employeeId) {
            throw new BadRequestException('Employee ID is required for deletion');
        }

        const requestedById = CurrentRequestContext.getEmployeeId();
        logger.info(`Employee ${employeeId}`);

        logger.info(`Delete request initiated by Employee ID: ${requestedById} for target ID: ${employeeId}`);

        const requestingEmployee = await employeeSchema.findOne({
            employee_id: requestedById,
            status: 'active'
        });

        if (!requestingEmployee) {
            throw new NotFoundException('Requesting employee not found or inactive');
        }

        if (!Object.values(APPROVAL_GRANTED_ROLES).includes(requestingEmployee.role.toUpperCase())) {
            throw new BadRequestException('Unauthorized: You do not have permission to delete employees');
        }

        const employeeToDelete = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employeeToDelete) {
            throw new NotFoundException('Target employee not found or already deleted');
        }

        const deletionLog = `${ employeeToDelete.log_note || '' } | Deletion by: ${ requestingEmployee.employee_name }, Role: ${ requestingEmployee.role }, Reason: ${ reason }, Date: ${ new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) }`;
        employeeToDelete.status = 'deleted';
        employeeToDelete.log_note = deletionLog;

        await employeeToDelete.save();

        return mapEmployeeEntityToResponse(employeeToDelete);
    }),

    createAccountLimiter: rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 50,
        message: {
            success: false,
            message: 'Too many account creation attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    }),

    loginLimiter: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 25,
        message: {
            success: false,
            message: 'Too many login attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    })
};

export { employeeService };