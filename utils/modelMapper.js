// modelMapper.js

import { sanitizeInput } from './validationUtils.js';

const EMPLOYEE_INPUT_FIELDS = [
    'employee_name', 'employee_email', 'employee_phone', 'role',
    'shop_name', 'district', 'town', 'brand', 'address', 'photo'
];

const EMPLOYEE_RESPONSE_FIELDS = [
    'employee_id', 'employee_name', 'employee_email', 'employee_phone',
    'role', 'status', 'created_by', 'shop_name', 'photo',
    'district', 'town', 'brand', 'address', 'created_at', 'updated_at', 'log_note'
];

const PRODUCT_RESPONSE_FIELDS = [
    'product_id', 'product_name', 'model', 'product_type',
    'available_stock', 'price', 'status', 'created_by', 'brand',
    'created_at', 'updated_at', 'log_note'
];

const PRODUCT_BRAND_RESPONSE_FIELDS = [
    'brand_id', 'brand_name', 'brand_models', 'deleted_brand_models', 'description',
    'status', 'created_by', 'created_at', 'updated_at'
];

const STOCK_RESPONSE_FIELDS = [
    'stock_id', 'product_id', 'stock', 'add_stock', 'return_stock',
    'stock_action', 'stock_type', 'stock_notes', 'created_by', 'order_number',
    'created_at', 'updated_at'
];

const ORDER_RESPONSE_FIELDS = [
    'order_number', 'dealer_id', 'priority', 'order_note', 'status', 'salesman_id',
    'delivery_date', 'promised_delivery_date', 'created_by', 'order_total_price',
    'order_total_discount', 'payment_status', 'payment_type', 'amount_paid',
    'amount_due', 'last_payment_date', 'sales_target_updated', 'created_at', 'updated_at'
];

const ORDER_DETAILS_RESPONSE_FIELDS = [
    'order_number', 'order_details_number', 'product_id', 'product_brand', 'product_name',
    'product_model', 'product_type', 'qty_ordered', 'qty_delivered', 'delivery_date', 'notes',
    'unit_product_price', 'total_product_price', 'is_free', 'dealer_discount',
    'stock_usage', 'stock_flags', 'total_dealer_discount', 'total_price', 'status',
    'created_at', 'updated_at'
];

const DEALER_DISCOUNT_RESPONSE_FIELDS = [
    'dealer_discount_id', 'brand_name', 'model_name', 'dealer_id',
    'discount_value', 'is_percentage', 'description', 'status',
    'created_by', 'created_at', 'updated_at'
];

export const mapEmployeeRequestToEntity = (data, employeeId = null, isUpdate = false) => {
    const entity = {};

    if (employeeId) entity.employee_id = employeeId;
    if (!isUpdate) entity.status = 'active';

    EMPLOYEE_INPUT_FIELDS.forEach(field => {
        if (data[field] !== undefined) {
            entity[field] = sanitizeInput(data[field]);
        }
    });

    return entity;
};

export const mapEmployeeEntityToResponse = (entity, password = null) => {
    const response = {};

    EMPLOYEE_RESPONSE_FIELDS.forEach(field => {
        if (entity[field] !== undefined) {
            response[field] = entity[field];
        }
    });

    if (password !== null) {
        response.password = password;
    }

    return response;
};

export const mapProductEntityToResponse = (product, stocks = []) => {
    const response = {};

    PRODUCT_RESPONSE_FIELDS.forEach(field => {
        if (product[field] !== undefined) {
            response[field] = product[field];
        }
    });

    response.stocks = stocks;

    return response;
};

export const mapStockEntityToResponse = (stock) => {
    const response = {};

    STOCK_RESPONSE_FIELDS.forEach(field => {
        if (stock[field] !== undefined) {
            response[field] = stock[field];
        }
    });

    return response;
};

export const transformOrderToResponse = (order, dealer, orderDetailsList = []) => {
    if (!order) return { order: null };

    const orderData = {};

    ORDER_RESPONSE_FIELDS.forEach((field) => {
        if (order[field] !== undefined) {
            orderData[field] = order[field];
        }
    });

    const dealerData = {};
    if (dealer) {
        EMPLOYEE_RESPONSE_FIELDS.forEach((field) => {
            if (dealer[field] !== undefined) {
                dealerData[field] = dealer[field];
            }
        });
    }

    orderData.dealer = dealerData;

    orderData.order_details = orderDetailsList.map((detail) => {
        const orderDetailData = {};
        ORDER_DETAILS_RESPONSE_FIELDS.forEach((field) => {
            if (detail[field] !== undefined) {
                orderDetailData[field] = detail[field];
            }
        });
        return orderDetailData;
    });

    return { order: orderData };
};

export const mapProductBrandEntityToResponse = (brand) => {
    const response = {};

    PRODUCT_BRAND_RESPONSE_FIELDS.forEach(field => {
        if (brand[field] !== undefined) {
            response[field] = brand[field];
        }
    });

    return response;
};

export const mapDealerDiscountEntityToResponse = (discount) => {
    const response = {};

    DEALER_DISCOUNT_RESPONSE_FIELDS.forEach(field => {
        if (discount[field] !== undefined) {
            response[field] = discount[field];
        }
    });

    return response;
};