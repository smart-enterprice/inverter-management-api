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
    }
};

export { STATUS_CODES, PATH_ROUTES };