// employeeService.js

import asyncHandler from "express-async-handler";
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import jwt from 'jsonwebtoken';

import employeeSchema from '../models/employees.js';
import { generateUniqueDealerDiscountId, generateUniqueEmployeeId } from '../utils/generatorIds.js';
import logger from '../utils/logger.js';
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    UnauthorizedException
} from '../middleware/CustomError.js';

import { getAuthenticatedEmployeeContext, validateDealerDiscountRequiredFields, validateEmployeeData } from '../utils/validationUtils.js';
import { mapEmployeeRequestToEntity, mapEmployeeEntityToResponse, mapDealerDiscountEntityToResponse } from '../utils/modelMapper.js';
import { hashPassword, generateToken, revealPassword, validatePassword } from '../utils/employeeAuth.js';
import {
    APPROVAL_GRANTED_ROLES,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ROLES,
    getISTDate
} from '../utils/constants.js';
import { tokenBlacklistService } from "./tokenBlacklistService.js";
import Brand from "../models/brand.js";
import DealerDiscount from "../models/dealerDiscount.js";

const checkExistingEmployee = async (email, phone, excludeId = null) => {
    const query = excludeId ? { _id: { $ne: excludeId } } : {};

    const [existingEmail, existingPhone] = await Promise.all([
        employeeSchema.findOne({ ...query, employee_email: email }),
        employeeSchema.findOne({ ...query, employee_phone: phone })
    ]);

    const errors = [];
    if (existingEmail) errors.push("📧 Email already exists.");
    if (existingPhone) errors.push("📱 Phone number already exists.");

    if (errors.length > 0) {
        throw new ConflictException(errors.join(" "));
    }
};

const findActiveEmployee = async (employeeId, includePassword = false) => {
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

async function checkIfDiscountExists(brand, model, dealerId) {
    const existingDiscount = await DealerDiscount.findOne({
        brand_name: brand.toUpperCase(),
        model_name: model.toUpperCase(),
        dealer_id: dealerId
    });

    if (existingDiscount) {
        throw new BadRequestException(`A discount for brand ${brand} and model ${model} already exists for this dealer.`);
    }
};

const employeeService = {
    defaultSuperAdminSetup: asyncHandler(async () => {
        if (!SUPER_ADMIN || !SUPER_ADMIN_PHONE || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
            throw new BadRequestException("Missing required SUPER_ADMIN environment variables.");
        }

        const existingAdmin = await employeeSchema.findOne({ employee_email: SUPER_ADMIN_EMAIL });
        if (existingAdmin) {
            if (!existingAdmin.employee_id || existingAdmin.employee_id.trim() === '') {
                const employeeId = await generateUniqueEmployeeId();
                existingAdmin.employee_id = employeeId;

                await existingAdmin.save();
                logger.info("✅ Super Admin ID was missing and has been updated.");
            } else {
                logger.info("⚠️ Super Admin already exists");
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

        logger.info("✅ Default Super Admin created successfully.");
    }),

    createEmployee: asyncHandler(async (employeeRequest, createdByEmployeeId) => {
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

    loginEmployee: asyncHandler(async (loginRequest) => {
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

    getEmployeeById: asyncHandler(async (employeeId) => {
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

    getAllEmployeeByRole: asyncHandler(async (employeeRole) => {
        if (!employeeRole) {
            throw new BadRequestException("Employee role is required");
        }

        logger.info(`Fetching employees with role: ${employeeRole}`);

        const employees = await employeeSchema.find({
            role: employeeRole,
            status: "active",
        });

        if (!employees || employees.length === 0) {
            throw new NotFoundException("No employees found for this role");
        }

        return employees.map(mapEmployeeEntityToResponse);
    }),

    getProfile: asyncHandler(async () => {
        const employeeId = CurrentRequestContext.getEmployeeId();

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

    updateEmployee: asyncHandler(async (employeeId, updateData) => {
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

    resetPassword: asyncHandler(async (updateData) => {
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

    resetPasswordById: asyncHandler(async (employeeId, updateData) => {
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

    deleteEmployee: asyncHandler(async (updateData) => {
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

        const deletionLog = `${employeeToDelete.log_note || ''} | Deletion by: ${requestingEmployee.employee_name}, Role: ${requestingEmployee.role}, Reason: ${reason}, Date: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
        employeeToDelete.status = 'deleted';
        employeeToDelete.log_note = deletionLog;

        await employeeToDelete.save();

        return mapEmployeeEntityToResponse(employeeToDelete);
    }),

    createDealerDiscount: asyncHandler(async (discountData) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        validateDealerDiscountRequiredFields(discountData);

        const brandName = discountData.brand_name.toUpperCase();
        const modelName = discountData.model_name.toUpperCase();

        const [dealer, brandRecord] = await Promise.all([
            employeeSchema.findOne({ employee_id: discountData.dealer_id, role: ROLES.DEALER, }).lean(),
            Brand.findOne({ brand_name: brandName }).lean(),
        ]);

        if (!dealer) {
            throw new BadRequestException(`Invalid dealer ID: ${discountData.dealer_id}. Dealer not found or role mismatch.`);
        }

        if (!brandRecord) {
            throw new BadRequestException(`Brand ${brandName} not found.`);
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());
        const brandStatus = brandRecord.status.toLowerCase();

        if (brandStatus === "discontinued") {
            throw new BadRequestException(
                `Cannot create discount. Brand ${brandName} is discontinued.`
            );
        }

        if (!brandModels.includes(modelName)) {
            throw new BadRequestException(
                `Model ${modelName} is not associated with brand ${brandName}.`
            );
        }

        await checkIfDiscountExists(brandName, modelName, discountData.dealer_id);

        let discountValue = null;
        if (discountData.discount_value != null) {
            const parsedValue = Number(discountData.discount_value);

            if (isNaN(parsedValue) || parsedValue < 0) {
                throw new BadRequestException("Discount value must be a positive number.");
            }

            discountValue = Math.round(parsedValue * 100) / 100;
        }

        const isPercentage = !!discountData.is_percentage;
        if (isPercentage && discountValue > 100) {
            throw new BadRequestException("Percentage discount value cannot exceed 100%.");
        }

        let description = "";
        if (typeof discountData.description === "string" && discountData.description.trim() !== "") {
            description = discountData.description.trim();
        }

        const dealerDiscountId = await generateUniqueDealerDiscountId();
        const dealerDiscount = await DealerDiscount.create({
            dealer_discount_id: dealerDiscountId,
            brand_name: brandName,
            model_name: modelName,
            dealer_id: dealer.employee_id,
            discount_value: discountValue,
            is_percentage: isPercentage,
            description,
            created_by: employeeId,
        });

        return mapDealerDiscountEntityToResponse(dealerDiscount);
    }),

    updateDealerDiscount: asyncHandler(async (discountData) => {
        const { employeeId } = getAuthenticatedEmployeeContext();

        const { dealer_discount_id, discount_value, brand_name, model_name, is_percentage, description } = discountData;

        if (!dealer_discount_id) {
            throw new BadRequestException("Dealer Discount ID is required.");
        }

        const existingDiscount = await DealerDiscount.findOne({
            dealer_discount_id,
            status: "active",
        });

        if (!existingDiscount) {
            throw new NotFoundException(`Dealer Discount with ID ${dealer_discount_id} not found.`);
        }

        if (brand_name || model_name) {
            const brandName = brand_name?.toUpperCase() || existingDiscount.brand_name.toUpperCase();
            const modelName = model_name?.toUpperCase() || existingDiscount.model_name.toUpperCase();

            const brandRecord = await Brand.findOne({ brand_name: brandName }).lean();
            if (!brandRecord) {
                throw new BadRequestException(`Brand ${brandName} not found.`);
            }

            const brandModels = brandRecord.brand_models.map((m) => m.toUpperCase());
            if (!brandModels.includes(modelName)) {
                throw new BadRequestException(
                    `Model ${modelName} is not associated with brand ${brandName}.`
                );
            }
        }

        let updatedIsPercentage = existingDiscount.is_percentage;
        if (typeof is_percentage === "boolean" && is_percentage !== existingDiscount.is_percentage) {
            updatedIsPercentage = is_percentage;
        }

        let updatedDiscountValue = existingDiscount.discount_value;
        if (discount_value !== undefined && discount_value !== existingDiscount.discount_value) {
            const parsedValue = Number(discount_value);

            if (isNaN(parsedValue) || parsedValue < 0) {
                throw new BadRequestException("Discount value must be a positive number.");
            }

            updatedDiscountValue = Math.round(parsedValue * 100) / 100;
        }

        if (updatedIsPercentage && updatedDiscountValue > 100) {
            throw new BadRequestException("Percentage discount value cannot exceed 100%.");
        }

        let updatedDescription = existingDiscount.description;
        if (typeof description === "string" && description.trim()) {
            updatedDescription = description.trim();
        }

        const updatedDiscount = await DealerDiscount.findOneAndUpdate(
            { dealer_discount_id },
            {
                $set: {
                    discount_value: updatedDiscountValue,
                    is_percentage: updatedIsPercentage,
                    description: updatedDescription,
                    updated_at: getISTDate(),
                    updated_by: employeeId,
                },
            },
            { new: true }
        );

        return mapDealerDiscountEntityToResponse(updatedDiscount);
    }),

    getDealerDiscount: asyncHandler(async (filtersData = {}, pagination) => {
        getAuthenticatedEmployeeContext();

        const page = parseInt(pagination.page, 10) || 1;
        const limit = parseInt(pagination.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const filters = {};

        if (filtersData.brand_name) {
            const brandName = filtersData.brand_name.toUpperCase();
            const brandRecord = await Brand.findOne({ brand_name: brandName });

            if (!brandRecord) {
                throw new BadRequestException(`Brand ${brandName} not found.`);
            }

            if (filtersData.model_name) {
                const modelName = filtersData.model_name.toUpperCase();
                const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());

                if (!brandModels.includes(modelName)) {
                    throw new BadRequestException(`Model ${modelName} is not associated with brand ${brandName}.`);
                }

                filters.model_name = modelName;
            }

            filters.brand_name = brandName;
        }

        if (filtersData.dealer_id) {
            const dealer = await employeeSchema.findOne({
                employee_id: filtersData.dealer_id,
                role: ROLES.DEALER
            });

            if (!dealer) {
                throw new BadRequestException(`Dealer with ID ${filtersData.dealer_id} not found or role mismatch.`);
            }

            filters.dealer_id = dealer.employee_id;
        }

        const [dealerDiscounts, total] = await Promise.all([
            DealerDiscount.find(filters)
                .skip(skip)
                .limit(limit)
                .sort({ created_at: -1 }),
            DealerDiscount.countDocuments(filters)
        ]);

        return {
            data: dealerDiscounts.map(discount => mapDealerDiscountEntityToResponse(discount)),
            pagination: {
                page,
                limit,
                total
            }
        };
    }),

    logout: asyncHandler(async (token) => {
        const decoded = jwt.decode(token);

        if (!decoded || !decoded.exp) {
            throw new UnauthorizedException('Invalid token');
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const ttl = decoded.exp - currentTime;

        if (ttl > 0) {
            tokenBlacklistService.blacklistToken(token, ttl);
        }
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