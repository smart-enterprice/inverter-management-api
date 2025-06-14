// orderService.js

import asyncHandler from "express-async-handler";
import { generateUniqueOrderId } from '../utils/generatorIds.js';
import {
    BadRequestException,
    ConflictException,
    ValidationException,
    NotFoundException,
    UnauthorizedException
} from '../middleware/CustomError.js';
import logger from '../utils/logger.js';
import dotenv from "dotenv";
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';

dotenv.config();

const sanitizeInput = (input) => {
    if (typeof input === 'string') {
        return validator.escape(input.trim());
    }
    return input;
};

// const mapRequestToEntity = (employeeRequest, employeeId, isUpdate = false) => {
//     const entity = {};

//     if (employeeId) entity.employee_id = employeeId;
//     if (!isUpdate) entity.status = 'active';

//     const fieldsToMap = [
//         'employee_name', 'employee_email', 'employee_phone', 'role', 'shop_name', 'district', 'town', 'brand', 'address'
//     ];

//     fieldsToMap.forEach(field => {
//         if (employeeRequest[field] !== undefined) {
//             entity[field] = sanitizeInput(employeeRequest[field]);
//         }
//     });

//     if (employeeRequest.photo !== undefined) {
//         entity.photo = employeeRequest.photo;
//     }

//     return entity;
// };

// const mapEntityToResponse = (employeeEntity) => {
//     const response = {};

//     const fieldsToMap = [
//         'employee_id', 'employee_name', 'employee_email', 'employee_phone',
//         'role', 'status', 'created_by', 'shop_name', 'photo',
//         'district', 'town', 'brand', 'address', 'created_at', 'updated_at'
//     ];

//     fieldsToMap.forEach(field => {
//         if (employeeEntity[field] !== undefined) {
//             response[field] = employeeEntity[field];
//         }
//     });

//     return response;
// };

const orderService = {

};

export { orderService, mapEntityToResponse };