// generatorIds.js
import Employee from '../models/employees.js';
import Order from '../models/order.js';
import OrderDetails from '../models/orderDetails.js';
import Product from '../models/product.js';
import Stock from '../models/stock.js';

const generateRandomString = (length) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const generateSegmentedOrderId = () => {
    const segment = () => Math.floor(1000 + Math.random() * 9000).toString();
    return `${segment()}-${segment()}-${segment()}`;
};

export const generateUniqueEmployeeId = async() => {
    let id;
    let exists;

    do {
        id = generateRandomString(10);
        exists = await Employee.findOne({ employee_id: id });
    } while (exists);

    return id;
};

export const generateUniqueProductId = async() => {
    let id;
    let exists;

    do {
        id = generateRandomString(16);
        exists = await Product.findOne({ product_id: id });
    } while (exists);

    return id;
};

export const generateUniqueStockId = async() => {
    let id;
    let exists;

    do {
        id = generateRandomString(20);
        exists = await Stock.findOne({ stock_id: id });
    } while (exists);

    return id;
};

export const generateUniqueOrderId = async() => {
    let order_number;
    let exists;

    do {
        order_number = generateSegmentedOrderId();
        exists = await Order.findOne({ order_number: order_number });
    } while (exists);

    return order_number;
};

export const generateUniqueOrderDetailsId = async() => {
    let order__details_number;
    let exists;

    do {
        order__details_number = generateSegmentedOrderId();
        exists = await OrderDetails.findOne({ order_details_number: order__details_number });
    } while (exists);

    return order__details_number;
};