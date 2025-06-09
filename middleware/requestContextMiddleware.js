// middleware/requestContextMiddleware.js
import jwt from 'jsonwebtoken';
import { CurrentRequestContext, asyncLocalStorage } from '../utils/CurrentRequestContext.js';
import { UnauthorizedException } from './CustomError.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const requestContextMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Authorization token missing or malformed');
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const employeeId = decoded.employee_id;
        const role = decoded.role;
        const status = decoded.status;

        req.user = { employeeId, role, status };

        const context = {
            tenant: req.headers['x-tenant-id'] || null,
            employeeId,
            role,
            status,
            token
        };

        asyncLocalStorage.run(context, () => {
            next();
        });

    } catch (err) {
        console.error('JWT verification error:', err.message);
        throw new UnauthorizedException('Invalid or expired token');
    }
};
