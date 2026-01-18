// service/order/orderValidation.js

import { BadRequestException, ForbiddenException } from "../../middleware/CustomError.js";
import Employee from "../../models/employees.js";
import { APPROVAL_GRANTED_ROLES, ORDER_CREATOR_ROLES, ORDER_DETAILS_REQUIRED_FIELDS, ORDER_REQUIRED_FIELDS, ROLES } from "../../utils/constants.js";
import { sanitizeInput } from "../../utils/validationUtils.js";

export const validateOrderCreator = ({ employeeId, employeeRole, dto }) => {
    if (!employeeId ||
        !employeeRole ||
        !Object.values(ORDER_CREATOR_ROLES).includes(employeeRole.toUpperCase())
    ) {
        throw new ForbiddenException(
            `Access denied: only ${Object.values(ORDER_CREATOR_ROLES).join(", ")} can create orders.`
        );
    }

    if (
        Object.values(APPROVAL_GRANTED_ROLES).includes(employeeRole.toUpperCase()) &&
        !dto.salesman_id
    ) {
        throw new BadRequestException(
            "salesman_id is required when ADMIN or SUPER_ADMIN creates the order."
        );
    }
};

export const validateOrderDTO = async (dto) => {
    for (const field of ORDER_REQUIRED_FIELDS) {
        if (!dto[field]) {
            throw new BadRequestException(`'${field}' is required.`);
        }
    }

    const dealer = await Employee.findOne({
        employee_id: sanitizeInput(dto.dealer_id),
        role: ROLES.DEALER
    });

    if (!dealer) {
        throw new BadRequestException(
            `Invalid dealer ID: ${dto.dealer_id}. Dealer not found.`
        );
    }

    if (!Array.isArray(dto.order_details) || !dto.order_details.length) {
        throw new BadRequestException("At least one order detail is required.");
    }

    dto.order_details.forEach((detail, idx) => {
        ORDER_DETAILS_REQUIRED_FIELDS.forEach((field) => {
            if (detail[field] === undefined || detail[field] === "") {
                throw new BadRequestException(
                    `order_details[${idx}]: '${field}' is required.`
                );
            }
        });

        if (detail.qty_ordered <= 0) {
            throw new BadRequestException(
                `order_details[${idx}]: qty_ordered must be > 0`
            );
        }

        if (isNaN(Date.parse(detail.delivery_date))) {
            throw new BadRequestException(
                `order_details[${idx}]: invalid delivery_date`
            );
        }
    });

    return dealer;
};