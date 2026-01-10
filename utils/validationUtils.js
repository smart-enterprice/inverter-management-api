// validationUtils.js

import validator from 'validator';

import { BadRequestException, ValidationException, UnauthorizedException, ForbiddenException } from '../middleware/CustomError.js';
import { ADMIN_PRIVILEGED_ROLES, STOCK_ACTIONS, STOCK_TYPES, ROLES, PRODUCT_REQUIRED_FIELDS, DEALER_DISCOUNT_REQUIRED_FIELDS, ALLOWED_TRANSITIONS, } from './constants.js';
import { validatePassword } from './employeeAuth.js';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';

export const sanitizeInput = (input) =>
    typeof input === 'string' ? validator.escape(input.trim()) : input;

export const sanitizeInputBody = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                if (key === "photo") {
                    continue;
                }
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
        else if (!Object.values(ROLES).includes(role.toUpperCase()))
            errors.push({ field: 'role', message: `Allowed roles: ${Object.values(ROLES).join(', ')}` });
    }

    if (errors.length > 0) throw new ValidationException('Validation failed', errors);
};

export const validateMainRoleAccess = () => {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const role = CurrentRequestContext.getRole();

    if (!employee_id || !role || !Object.values(ADMIN_PRIVILEGED_ROLES).includes(role.toUpperCase())) {
        throw new ForbiddenException(`You do not have permission to perform this action. Allowed roles: ${Object.values(ADMIN_PRIVILEGED_ROLES).join(', ')}`);
    }
    return { employee_id, role };
};

export const getAuthenticatedEmployeeContext = () => {
    const employeeId = CurrentRequestContext.getEmployeeId();
    const employee_role = CurrentRequestContext.getRole();
    const employeeRole = (employee_role || "").toUpperCase();

    console.log(`roles : ${employeeId} :: ${employeeRole}`);

    if (!employeeId || !employeeRole || !Object.values(ROLES).includes(employeeRole)) {
        throw new ForbiddenException(`Access denied: only users with roles ${Object.values(ROLES).join(", ")} are authorized.`);
    }

    return { employeeId, employeeRole };
};

export const validateStockActionType = (action) => {
    const type = typeof action === "string" ? action.toUpperCase() : null;
    if (!Object.values(STOCK_ACTIONS).includes(type)) {
        throw new BadRequestException(`Invalid stock action: ${action}. Allowed: ${Object.values(STOCK_ACTIONS).join(', ')}`);
    }
    return type;
};

export const validateStockType = (stockType) => {
    const type = typeof stockType === "string" ? stockType.trim().toUpperCase() : null;
    if (!Object.values(STOCK_TYPES).includes(type)) {
        throw new BadRequestException(`Invalid stock_type: ${stockType}. Allowed: ${Object.values(STOCK_TYPES).join(", ")}`);
    }
    return type;
};

export const validateProductRequiredFields = (dto) => {
    for (const field of PRODUCT_REQUIRED_FIELDS) {
        if (!dto[field]) throw new BadRequestException(`${field} is required`);
    }
};

export const validateDealerDiscountRequiredFields = (dto) => {
    for (const field of DEALER_DISCOUNT_REQUIRED_FIELDS) {
        if (dto[field] === null || dto[field] === undefined) throw new BadRequestException(`${field} is required`);
    }
};

export const isValidTransition = (from, to) => {
    if (from === to) return false;
    const allowed = ALLOWED_TRANSITIONS[from] || [];
    return allowed.includes(to);
};

export const isRoleAllowedForApproval = (role) => {
    if (!role) return false;
    return ADMIN_PRIVILEGED_ROLES.includes(role.toUpperCase());
};

export function normalizePrice(value) {
    if (value === undefined || value === null) return undefined;

    const num = Number(value);

    if (!Number.isFinite(num) || num < 0) return undefined;

    return Math.round(num * 100) / 100;
}