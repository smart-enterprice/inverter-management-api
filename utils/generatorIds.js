// generatorIds.js
import Brand from '../models/brand.js';
import DealerDiscount from '../models/dealerDiscount.js';
import Employee from '../models/employees.js';
import Order from '../models/order.js';
import OrderDetails from '../models/orderDetails.js';
import Product from '../models/product.js';
import Stock from '../models/stock.js';
import { v4 as uuidv4 } from 'uuid';
import StockHistory from '../models/stockHistory.js';

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

export const generateUniqueEmployeeId = async () => {
    let id;
    let exists;

    do {
        id = generateRandomString(10);
        exists = await Employee.findOne({ employee_id: id });
    } while (exists);

    return id;
};

export const generateUniqueProductId = async () => {
    let id;
    let exists;

    do {
        id = generateRandomString(16);
        exists = await Product.findOne({ product_id: id });
    } while (exists);

    return id;
};

export const generateUniqueStockId = async () => {
    let id;
    let exists;

    do {
        id = generateRandomString(20);
        exists = await Stock.findOne({ stock_id: id });
    } while (exists);

    return id;
};

export const generateUniqueStockHistoryId = async () => {
    let id;
    let exists;

    do {
        id = generateRandomString(20);
        exists = await StockHistory.findOne({ stock_history_id: id });
    } while (exists);

    return id;
};

export const generateUniqueOrderId = async () => {
    let order_number;
    let exists;

    do {
        order_number = generateSegmentedOrderId();
        exists = await Order.findByOrderNumber(order_number);
    } while (exists);

    return order_number;
};

export const generateUniqueOrderDetailsId = async () => {
    let order__details_number;
    let exists;

    do {
        order__details_number = generateSegmentedOrderId();
        exists = await OrderDetails.findOne({ order_details_number: order__details_number });
    } while (exists);

    return order__details_number;
};

export const generateUniqueBrandId = async () => {
    let brand_id;
    let exists;

    do {
        brand_id = `BRAND_${uuidv4().split("-")[0].toUpperCase()}`;
        exists = await Brand.findOne({ brand_id: brand_id });
    } while (exists);

    return brand_id;
};

export const generateUniqueDealerDiscountId = async () => {
    let discount_id;
    let exists;

    do {
        discount_id = `DISCOUNT_${uuidv4().split("-")[0].toUpperCase()}`;
        exists = await DealerDiscount.findOne({ dealer_discount_id: discount_id });
    } while (exists);

    return discount_id;
};

export const generateUniqueInvoiceId = async () => {
    let invoice_id;
    let exists;

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    do {
        const randomPart = Math.floor(1000 + Math.random() * 9000);
        invoice_id = `INV-${datePart}-${randomPart}`;
        exists = await Invoice.findOne({ invoice_id });
    } while (exists);

    return invoice_id;
};