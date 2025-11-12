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
    `${PATH_ROUTES.AUTH_ROUTE}/signin`,
    PATH_ROUTES.LOCATION_ROUTE
];

const SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/employees-password`,
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/get/deleted-employees`
];

const ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES = [
    `${PATH_ROUTES.EMPLOYEE_ROUTE}/update/delete-employee`
];

const isRouteMatch = (url, routes) => routes.some(route => url.startsWith(route));

export const requestContextMiddleware = async (req, res, next) => {
    try {
        const { originalUrl, headers } = req;

        // Allow public routes without authentication
        if (isRouteMatch(originalUrl, PUBLIC_ROUTES)) return next();

        const authHeader = headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedException('Authorization token missing or malformed');
        }

        const token = authHeader.split(' ')[1];
        if (!token || token === 'undefined' || token === 'null') {
            throw new UnauthorizedException('Authentication failed: Token is missing or invalid');
        }

        if (!JWT_SECRET) {
            logger.error('[Auth] Missing JWT_SECRET in environment variables');
            throw new BadRequestException('JWT_SECRET is missing in environment variables');
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
            logger.info('[Auth] Token verified successfully', { path: originalUrl });
        } catch (err) {
            logger.warn('[Auth] JWT verification failed', { reason: err.message });
            throw new UnauthorizedException('Invalid or expired token');
        }

        // Token blacklisted check
        if (tokenBlacklistService.isBlacklisted(token)) {
            throw new UnauthorizedException('Token has been invalidated or session expired');
        }

        const { employee_id: employeeId, role } = decoded;
        if (!employeeId || !role) {
            throw new UnauthorizedException('Invalid token payload');
        }

        const employee = await Employee.findOne({ employee_id: employeeId, status: 'active' });
        if (!employee) {
            await employeeService.logout(token);
            throw new UnauthorizedException('User does not exist or is inactive');
        }

        // Role-based route restrictions
        if (isRouteMatch(originalUrl, SUPER_ADMIN_ONLY_ROUTES) && role !== ROLES.SUPER_ADMIN) {
            throw new UnauthorizedException('Access restricted to Super Admins only');
        }

        if (
            isRouteMatch(originalUrl, ADMIN_AND_SUPER_ADMIN_ONLY_ROUTES) &&
            !Object.values(APPROVAL_GRANTED_ROLES).includes(role)
        ) {
            throw new UnauthorizedException('Access restricted to Admins or Super Admins');
        }

        // Set context and user data
        CurrentRequestContext.run({}, () => {
            CurrentRequestContext.setEmployeeId(employeeId);
            CurrentRequestContext.setRole(role);
            CurrentRequestContext.setCurrentToken(token);

            req.user = { employeeId, role, status: employee.status };
            next();
        });

    } catch (err) {
        next(err);
    }
};