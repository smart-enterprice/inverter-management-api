// employeeValidator.js

import validator from 'validator';
import { BadRequestException, ValidationException } from '../middleware/CustomError.js';
import { ALLOWED_ROLES, APPROVAL_ROLES, MAIN_ROLES, STOCK_ACTIONS, STOCK_TYPES } from './constants.js';
import { validatePassword } from './employeeAuth.js';

export const sanitizeInput = (input) =>
    typeof input === 'string' ? validator.escape(input.trim()) : input;

export const sanitizeInputBody = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitizeInput(req.body[key]);
            }
        }
    }
    next();
};

export const validateEmployeeData = (data, isUpdate = false) => {
    const errors = [];
    const { employee_name, employee_email, password, employee_phone, role } = data;

    if (!isUpdate || employee_name !== undefined) {
        if (!employee_name || employee_name.trim().length < 2)
            errors.push({ field: 'employee_name', message: 'Name must be at least 2 characters' });
        if (employee_name && employee_name.length > 500)
            errors.push({ field: 'employee_name', message: 'Name cannot exceed 500 characters' });
    }

    if (!isUpdate || employee_email !== undefined) {
        if (!employee_email)
            errors.push({ field: 'employee_email', message: 'Email is required' });
        else if (!validator.isEmail(employee_email))
            errors.push({ field: 'employee_email', message: 'Invalid email address' });
    }

    if (!isUpdate && password !== undefined) {
        if (!password) {
            errors.push({ field: 'password', message: 'Password is required' });
        } else {
            try {
                validatePassword(password);
            } catch (err) {
                errors.push({ field: 'password', message: err.message });
            }
        }
    }

    if (!isUpdate || employee_phone !== undefined) {
        if (!employee_phone)
            errors.push({ field: 'employee_phone', message: 'Phone number is required' });
        else if (!validator.isMobilePhone(employee_phone))
            errors.push({ field: 'employee_phone', message: 'Invalid phone number' });
    }

    if (!isUpdate || role !== undefined) {
        if (!role)
            errors.push({ field: 'role', message: 'Role is required' });
        else if (!Object.values(ALLOWED_ROLES).includes(role.toUpperCase()))
            errors.push({ field: 'role', message: `Allowed roles: ${Object.values(ALLOWED_ROLES).join(', ')}` });
    }

    if (errors.length) throw new ValidationException('Validation failed', errors);
};

export const validateRole = () => {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();
    if (!employee_id || !role || !Object.values(MAIN_ROLES).includes(role.toUpperCase())) {
        throw new UnauthorizedException(`You do not have permission to perform this action. Allowed roles: ${Object.values(MAIN_ROLES).join(', ')}`);
    }
    return { employee_id, role };
};

export const validateStockAction = action => {
    const type = typeof action === "string" ? action.toUpperCase() : null;
    if (!Object.values(STOCK_ACTIONS).includes(type.toUpperCase())) {
        throw new BadRequestException(`Invalid stock action: ${action}. Allowed: ${Object.values(STOCK_ACTIONS).join(', ')}`);
    }
    return type;
};

export const normalizeStockType = stock_type => {
    const type = typeof stock_type === "string" ? stock_type.trim().toUpperCase() : null;
    if (!Object.values(STOCK_TYPES).includes(type.toUpperCase())) {
        throw new BadRequestException(`Invalid stock_type: ${stock_type}. Allowed: ${Object.values(STOCK_TYPES).join(", ")}`);
    }
    return type;
};