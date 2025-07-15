// employeeMapper.js

import { sanitizeInput } from './employeeValidator.js';

const FIELDS = [
    'employee_name', 'employee_email', 'employee_phone', 'role',
    'shop_name', 'district', 'town', 'brand', 'address', 'photo'
];

const RESPONSE_FIELDS = [
    'employee_id', 'employee_name', 'employee_email', 'employee_phone',
    'role', 'status', 'created_by', 'shop_name', 'photo',
    'district', 'town', 'brand', 'address', 'created_at', 'updated_at', 'log_note'
];

export const mapRequestToEntity = (data, employeeId, isUpdate = false) => {
    const entity = {};

    if (employeeId) entity.employee_id = employeeId;
    if (!isUpdate) entity.status = 'active';

    FIELDS.forEach(field => {
        if (data[field] !== undefined) {
            entity[field] = sanitizeInput(data[field]);
        }
    });

    return entity;
};

export const mapEntityToResponse = (entity, password = null) => {
    const response = {};

    RESPONSE_FIELDS.forEach(field => {
        if (entity[field] !== undefined) {
            response[field] = entity[field];
        }
    });

    if (password !== null) {
        response.password = password;
    }

    return response;
};