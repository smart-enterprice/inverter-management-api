import jwt from 'jsonwebtoken';
import { UnauthorizedException } from './CustomError.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    console.log("weirjbgjdsjbfmnvedf");
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('Authorization token missing or malformed');
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = {
            employee_id: decoded.employee_id,
            role: decoded.role,
            status: decoded.status
        };

        next();
    } catch (err) {
        throw new UnauthorizedException('Invalid or expired token');
    }
};