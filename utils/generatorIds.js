// generatorIds.js
import Employee from '../models/employees.js';

export const generateUniqueEmployeeId = async() => {
    let employeeId;
    let exists;

    do {
        employeeId = generateEmployeeId();
        exists = await Employee.findOne({ employee_id: employeeId });
    } while (exists);

    return employeeId;
};

export const generateUniqueOrderId = async() => {
    let orderId;
    let exists;

    do {
        orderId = generateOrderId();
        // exists = await Employee.findOne({ employee_id: employeeId });
    } while (exists);

    return orderId;
};

export const generateEmployeeId = () => {
    const generateSegment = () => Math.floor(1000 + Math.random() * 9000).toString();
    return `${generateSegment()}-${generateSegment()}-${generateSegment()}`;
};

export const generateOrderId = () => {
    const generateSegment = () => Math.floor(1000 + Math.random() * 9000).toString();
    return `${generateSegment()}-${generateSegment()}-${generateSegment()}`;
};