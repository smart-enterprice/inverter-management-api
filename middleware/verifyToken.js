import jwt from 'jsonwebtoken';
import { UnauthorizedException } from './CustomError.js';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import { JWT_SECRET } from '../utils/constants.js';

const jwt_secret = JWT_SECRET;

const extractToken = (req) => {
    const authHeader = req.headers.authorization;

    // ✅ Check Authorization header
    if (authHeader?.startsWith("Bearer ")) {
        return authHeader.split(" ")[1];
    }

    // ⚠️ Header exists but malformed
    if (authHeader) {
        throw new UnauthorizedException(
            "Authorization header malformed. Expected 'Bearer <token>'"
        );
    }

    // ✅ Fallback for SSE (query param)
    if (req.query?.token) {
        return req.query.token;
    }

    // ⚠️ No token found
    return null;
};

export const verifyToken = async (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
        throw new UnauthorizedException('Authorization token missing or malformed');
    }

    try {
        const decoded = jwt.verify(token, jwt_secret);

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