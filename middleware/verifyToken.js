import jwt from 'jsonwebtoken';
import { UnauthorizedException } from './CustomError.js';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('Authorization token missing or malformed');
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const { employee_id, role, status } = decoded;
        if (!employee_id || !role) {
            throw new UnauthorizedException('Invalid token payload.');
        }

        CurrentRequestContext.run({}, () => {
            CurrentRequestContext.setEmployeeId(employee_id);
            CurrentRequestContext.setRole(role);
            CurrentRequestContext.setCurrentToken(token);
        
            next();
        });
    } catch (err) {
        throw new UnauthorizedException('Invalid or expired token');
    }
};