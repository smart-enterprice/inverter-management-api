// employeeValidator.js

import validator from 'validator';
import { BadRequestException, ValidationException } from '../middleware/CustomError.js';
import { ALLOWED_ROLES } from './constants.js';
import { validatePassword } from './employeeAuth.js';

export const sanitizeInput = (input) =>
    typeof input === 'string' ? validator.escape(input.trim()) : input;

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

export const validateRole = (role) => {
    if (!role || typeof role !== 'string') {
        throw new BadRequestException('Role is required and must be a string');
    }
    const normalizedRole = role.toUpperCase();

    if (!Object.values(ALLOWED_ROLES).includes(normalizedRole)) {
        throw new BadRequestException(
            `Role must be one of: ${Object.values(ALLOWED_ROLES).join(', ')}`
        );
    }
};