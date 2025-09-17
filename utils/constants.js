import dotenv from 'dotenv';
dotenv.config();

export const STATUS_CODES = {
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

export const PATH_ROUTES = {
    BASIC_ROUTE: '/api/v1',

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

export const {
    PORT,
    APPLICATION_NAME,
    APPLICATION_URL,
    ENVIRONMENT,
    MONGO_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ENCRYPTION_SECRET_KEY,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
    S3_BUCKET_NAME,
    ALLOWED_ORIGINS,
    LOG_LEVEL,
} = process.env;

export const ROLES = {
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

export const APPROVAL_GRANTED_ROLES = {
    SUPER_ADMIN: ROLES.SUPER_ADMIN,
    ADMIN: ROLES.ADMIN,
};

export const ADMIN_PRIVILEGED_ROLES = {
    SUPER_ADMIN: ROLES.SUPER_ADMIN,
    ADMIN: ROLES.ADMIN,
    MANAGER: ROLES.MANAGER,
};

export const ORDER_CREATOR_ROLES = {
    SUPER_ADMIN: ROLES.SUPER_ADMIN,
    ADMIN: ROLES.ADMIN,
    SALESMAN: ROLES.SALESMAN,
};

export const STOCK_ACTIONS = {
    STOCK_ADD: 'ADD',
    STOCK_RETURN: 'RETURN',
    STOCK_SALE: 'SALE',
};

export const STOCK_TYPES = {
    STOCK_PACKED: 'PACKED',
    STOCK_UNPACKED: 'UNPACKED'
};

export const PRODUCT_REQUIRED_FIELDS = ["brand", "model", "product_type", "product_name"];
export const PRODUCT_UPDATABLE_FIELDS = [...PRODUCT_REQUIRED_FIELDS, "status"];

export const ORDER_REQUIRED_FIELDS = ["dealer_id", "priority", "order_details"];
export const ORDER_DETAILS_REQUIRED_FIELDS = ["product_id", "product_brand", "product_name", "product_model", "product_type", "qty_ordered", "delivery_date",];

export const DEALER_DISCOUNT_REQUIRED_FIELDS = ["brand_name", "model_name", "dealer_id", "discount_value", "is_percentage"];

export const STATUS = ["active", "inactive", "discontinued"];

export const VALID_ORDER_STATUSES = ["PENDING", "APPROVED", "CANCELLED", "IN_PROGRESS", "DELIVERED", "PENDING_PRODUCTION"];
export const VALID_PAYMENT_STATUSES = ["PENDING", "PARTIALLY_PAID", "PAID", "FAILED", "REFUNDED"];

export const getISTDate = () => {
    const now = new Date();
    const istOffset = 330;
    return new Date(now.getTime() + istOffset * 60 * 1000);
};