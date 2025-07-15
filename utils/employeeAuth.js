// employeeAuth.js

import jwt from 'jsonwebtoken';
import { encryptText, decryptText } from '../utils/encryption.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from './constants.js';
import { BadRequestException } from '../middleware/CustomError.js';

export const validatePassword = (password) => {
    if (!password) throw new BadRequestException('Password is required');
    if (password.length < 8)
        throw new BadRequestException('Password must be at least 8 characters long');

    const pattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
    console.log('password : ', password);
    console.log('password match : ', !pattern.test(password));

    if (!pattern.test(password)) {
        throw new BadRequestException('Password must include lowercase, uppercase, number, and special character');
    }
};

export const hashPassword = async(password) => encryptText(password);
export const revealPassword = async(encryptedPassword) => decryptText(encryptedPassword);

export const generateToken = (employeeId, role, status) => {
    const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const iat = Math.floor(new Date(istTime).getTime() / 1000);

    return jwt.sign({ employee_id: employeeId, role, status, iat }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};