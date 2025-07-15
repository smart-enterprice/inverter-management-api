import dotenv from 'dotenv';
dotenv.config();

const STATUS_CODES = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
};

const PATH_ROUTES = {
    BASIC_ROUTE: "/api/v1",

    get EMPLOYEE_ROUTE() {
        return `${this.BASIC_ROUTE}/employees`;
    },
    get AUTH_ROUTE() {
        return `${this.BASIC_ROUTE}/auth`;
    },
    get ORDER_ROUTE() {
        return `${this.BASIC_ROUTE}/order-details`;
    },
    get PRODUCT_ROUTE() {
        return `${this.BASIC_ROUTE}/product-details`;
    }
};

export { STATUS_CODES, PATH_ROUTES };

export const {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ENCRYPTION_SECRET_KEY
} = process.env;

export const ALLOWED_ROLES = {
    SUPER_ADMIN: 'ROLE_SUPER_ADMIN',
    ADMIN: 'ROLE_ADMIN',
    SUPERVISOR: 'ROLE_SUPERVISOR',
    MANAGER: 'ROLE_MANAGER',
    SALESMAN: 'ROLE_SALESMAN',
    PRODUCTION: 'ROLE_PRODUCTION',
    PACKING: 'ROLE_PACKING',
    ACCOUNTS: 'ROLE_ACCOUNTS',
    DELIVERY: 'ROLE_DELIVERY',
    DEALER: 'ROLE_DEALER'
};

export const APPROVAL_ROLES = {
    SUPER_ADMIN: 'ROLE_SUPER_ADMIN',
    ADMIN: 'ROLE_ADMIN',
};