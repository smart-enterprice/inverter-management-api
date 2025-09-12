// middleware/requestContextMiddleware.js

import jwt from 'jsonwebtoken';
import Employee from '../models/employees.js';
import { UnauthorizedException, BadRequestException } from './CustomError.js';
import { tokenBlacklistService } from '../service/tokenBlacklistService.js';
import { employeeService } from '../service/employeeService.js';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';
import logger from '../utils/logger.js';
import {
    PATH_ROUTES,
    ROLES,
    JWT_SECRET,
    APPROVAL_GRANTED_ROLES,
} from '../utils/constants.js';

const PUBLIC_ROUTES = [
    '/',
    '/health',
    '/favicon.ico',
    `${PATH_ROUTES.AUTH_ROUTE}/signin`
];

const SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/employees-password`,
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/deleted-employees`
];

const ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/update/delete-employee`
];

const isMatch = (url, routes) => routes.some((route) => url.startsWith(route));

export const requestContextMiddleware = async (req, res, next) => {
    const { originalUrl, headers } = req;

    if (isMatch(originalUrl, PUBLIC_ROUTES)) {
        return next();
    }

    const authHeader = headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next(new UnauthorizedException("Authorization token missing or malformed"));
    }

    logger.info(`[Auth] JWT_SECRET original path : ${originalUrl}`, {
        method: req.method,
        headers: {
            authorization: authHeader ? "present" : "missing"
        }
    });

    const token = authHeader.split(" ")[1];
    if (!token || token === 'undefined' || token === 'null') {
        return next(new UnauthorizedException('Authentication failed: Token is missing or invalid.'));
    }

    if (!JWT_SECRET) {
        logger.error('[Auth] JWT_SECRET is not defined in environment.');
        return next(new BadRequestException('JWT_SECRET is missing in environment variables'));
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
        logger.info('[Auth] Token verified successfully.');
    } catch (err) {
        logger.warn('[Auth] JWT verification failed:', err.message);
        return next(new UnauthorizedException('Invalid or expired token'));
    }

    if (tokenBlacklistService.isBlacklisted(token)) {
        return next(new UnauthorizedException('Token has been invalidated or session expired'));
    }

    const { employee_id: employeeId, role } = decoded;

    if (!employeeId || !role) {
        return next(new UnauthorizedException('Invalid token payload'));
    }

    const employee = await Employee.findOne({ employee_id: employeeId, status: 'active' });
    if (!employee) {
        await employeeService.logout(token);
        return next(new UnauthorizedException('User does not exist or is inactive.'));
    }

    if (isMatch(originalUrl, SUPER_ADMIN_ONLY_ROUTES) && role !== ROLES.SUPER_ADMIN) {
        return next(new UnauthorizedException("Access restricted to Super Admins only"));
    }

    if (isMatch(originalUrl, ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES) && !Object.values(APPROVAL_GRANTED_ROLES).includes(role)) {
        return next(new UnauthorizedException("Access restricted to Admins or Super Admins"));
    }

    CurrentRequestContext.run({}, () => {
        CurrentRequestContext.setEmployeeId(employeeId);
        CurrentRequestContext.setRole(role);
        CurrentRequestContext.setCurrentToken(token);

        req.user = { employeeId, role, status: employee.status };
        next();
    });
};