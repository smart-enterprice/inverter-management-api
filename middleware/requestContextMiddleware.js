// middleware/requestContextMiddleware.js

import jwt from 'jsonwebtoken';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import { UnauthorizedException } from './CustomError.js';
import { tokenBlacklistService } from '../service/tokenBlacklistService.js';
import { PATH_ROUTES, ROLES, JWT_SECRET, APPROVAL_GRANTED_ROLES } from '../utils/constants.js';

const PUBLIC_ROUTES = [
    `${PATH_ROUTES.AUTH_ROUTE}/signin`
];

const SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/employees-password`,
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/deleted-employees`
];

const ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/update/delete-employee`
];

// console.log(`[Auth Middleware] Checking if ${req.path} is in public paths: ${JSON.stringify(PUBLIC_PATHS)}`);
const isPublicRoute = (path) => PUBLIC_ROUTES.includes(path);


const isSuperAdminOnlyRoute = (path) => SUPER_ADMIN_ONLY_ROUTES.includes(path);
const isAdminOrSuperAdminRoute = (path) => ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES.includes(path);

export const requestContextMiddleware = (req, res, next) => {
    const { path, headers } = req;

    if (isPublicRoute(path)) return next();

    const authHeader = headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new UnauthorizedException('Authorization token missing or malformed'));
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        console.error('[Auth Middleware] JWT verification failed:', err.message);
        return next(new UnauthorizedException('Invalid or expired token'));
    }

    if (tokenBlacklistService.isBlacklisted(token)) {
        return next(new UnauthorizedException('Token has been invalidated or session expired'));
    }

    const { employee_id: employeeId, role, status } = decoded;

    // Role-based access checks
    if (isSuperAdminOnlyRoute(path) && role !== ROLES.SUPER_ADMIN) {
        return next(new UnauthorizedException('Access restricted to Super Admins only'));
    }

    if (isAdminOrSuperAdminRoute(path) && !Object.values(APPROVAL_GRANTED_ROLES).includes(role)) {
        return next(new UnauthorizedException('Access restricted to Admins or Super Admins'));
    }

    // Set request-scoped context
    CurrentRequestContext.run({}, () => {
        CurrentRequestContext.setEmployeeId(employeeId);
        CurrentRequestContext.setRole(role);
        CurrentRequestContext.setCurrentToken(token);

        req.user = { employeeId, role, status };
        next();
    });
};