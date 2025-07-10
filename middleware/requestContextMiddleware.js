// middleware/requestContextMiddleware.js
import jwt from 'jsonwebtoken';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import { UnauthorizedException } from './CustomError.js';
import { tokenBlacklistService } from '../service/tokenBlacklistService.js';
import { PATH_ROUTES } from '../utils/constants.js';

const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_PATHS = [PATH_ROUTES.AUTH_ROUTE + '/signin'];

export const requestContextMiddleware = (req, res, next) => {
    // console.log(`[Auth Middleware] Checking if ${req.path} is in public paths: ${JSON.stringify(PUBLIC_PATHS)}`);
    if (PUBLIC_PATHS.includes(req.path)) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new UnauthorizedException('Authorization token missing or malformed'));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const isBlacklisted = tokenBlacklistService.isBlacklisted(token);
        if (isBlacklisted) {
            return next(new UnauthorizedException('Your session has expired or the token was invalidated.'));
        }

        const { employee_id: employeeId, role, status } = decoded;

        CurrentRequestContext.run({}, () => {
            CurrentRequestContext.setEmployeeId(employeeId);
            CurrentRequestContext.setRole(role);
            CurrentRequestContext.setCurrentToken(token);

            req.user = { employeeId, role, status };

            console.log('✅ Async context set:', {
                employeeId: CurrentRequestContext.getEmployeeId(),
                role: CurrentRequestContext.getRole()
            });

            next();
        });

    } catch (err) {
        console.error('JWT verification error:', err.message);
        return next(new UnauthorizedException('Invalid or expired token'));
    }
};