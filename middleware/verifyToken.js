import jwt from 'jsonwebtoken';
import { UnauthorizedException } from './CustomError.js';
import Employee from '../models/employees.js';
import { employeeService } from '../service/employeeService.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const verifyToken = async (req, res, next) => {
    console.log('[Auth] Verifying authorization header...');

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('[Auth] Missing or malformed token.');
        throw new UnauthorizedException('Authorization token missing or malformed');
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const { employee_id, role, status } = decoded;
        if (!employee_id || !role) {
            throw new UnauthorizedException('Invalid token payload.');
        }

        const employee = await Employee.findOne({ employee_id, status: 'active' });
        if (!employee) {
            await employeeService.logout(token);
            throw new UnauthorizedException('User does not exist or is inactive.');
        }

        req.user = {
            employee_id,
            role,
            status
        };

        console.log('[Auth] Authentication passed. Attaching user to request.');
        next();
    } catch (err) {
        console.warn('[Auth Error]:', err.message);
        throw new UnauthorizedException('Invalid or expired token');
    }
};