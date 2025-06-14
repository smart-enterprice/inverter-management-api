// middleware/requestContextMiddleware.js
import jwt from 'jsonwebtoken';
import { CurrentRequestContext, asyncLocalStorage } from '../utils/CurrentRequestContext.js';
import { UnauthorizedException } from './CustomError.js';
import { tokenBlacklistService } from '../service/tokenBlacklistService.js';
import { PATH_ROUTES } from '../utils/constants.js';

const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_PATHS = [PATH_ROUTES.AUTH_ROUTE + '/signin'];

export const requestContextMiddleware = async(req, res, next) => {
    try {
        // console.log(`[Auth Middleware] Checking if ${req.path} is in public paths: ${JSON.stringify(PUBLIC_PATHS)}`);
        if (PUBLIC_PATHS.includes(req.path)) {
            return next();
        }

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Authorization token missing or malformed');
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const isBlacklisted = tokenBlacklistService.isBlacklisted(token);
        if (isBlacklisted) {
            throw new UnauthorizedException('Your session has expired or the token was invalidated. Please log in again.');
        }

        const { employee_id: employeeId, role, status } = decoded;
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