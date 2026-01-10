// swaggerConfig.js

import swaggerAutogen from 'swagger-autogen';
import path from 'path';
import fs from 'fs';
import { APPLICATION_NAME, APPLICATION_URL, PORT, PATH_ROUTES, ROLES } from './utils/constants.js';

const outputFile = path.resolve('./swagger-output.json');
const endpointsFiles = [
    path.resolve('./server.js'),
    path.resolve('./routes/**/*.js'),
];

const ROUTE_PREFIX_MAP = {
    AUTH: {
        keywords: ['signin', 'logout'],
        prefix: PATH_ROUTES.AUTH_ROUTE,
        tag: 'Authentication'
    },
    EMPLOYEE: {
        keywords: ['signup', 'employee', 'profile', 'reset-password'],
        prefix: PATH_ROUTES.EMPLOYEE_ROUTE,
        tag: 'Employee Management'
    },
    DEALER: {
        keywords: ['dealer'],
        prefix: PATH_ROUTES.EMPLOYEE_ROUTE,
        tag: 'Dealer Management'
    },
    ORDER: {
        keywords: ['order', 'date-filter'],
        prefix: PATH_ROUTES.ORDER_ROUTE,
        tag: 'Order Management'
    },
    PRODUCT: {
        keywords: ['product', 'brand', 'getAllProductsByBrand', 'get/all'],
        prefix: PATH_ROUTES.PRODUCT_ROUTE,
        tag: 'Product Management'
    },
    PUBLIC: {
        keywords: ['search', 'upload'],
        prefix: PATH_ROUTES.BASIC_ROUTE,
        tag: 'Public Services'
    },
    DEFAULT: {
        keywords: ['/', 'health'],
        prefix: '',
        tag: 'Default'
    }
};

const getHostFromUrl = (url) => {
    try {
        if (!url) return `localhost:${PORT || 3000}`;
        return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    } catch (error) {
        return `localhost:${PORT || 3000}`;
    }
};

const determinePathPrefix = (originalPath) => {
    if (originalPath === '/' || originalPath === '/health') {
        return originalPath;
    }

    for (const [routeType, config] of Object.entries(ROUTE_PREFIX_MAP)) {
        if (config.keywords.some(keyword => originalPath.includes(keyword))) {
            return config.prefix + originalPath;
        }
    }

    return PATH_ROUTES.BASIC_ROUTE + originalPath;
};

const REQUEST_BODY_PATTERNS = {
    '/logout': { type: 'object', properties: {} },
    '/{employeeid}': { type: 'object', properties: { name: { type: 'string' } } },
    '/dealer/get-discounts': { type: 'object', properties: {} },
    'signin': {
        type: 'object',
        required: ['employee_email', 'password'],
        properties: {
            employee_email: { type: 'string', format: 'email', example: 'admin@enterprise.com' },
            password: { type: 'string', example: 'your_password' }
        }
    },
    'signup': {
        type: 'object',
        required: ['employee_name', 'employee_email', 'employee_phone', 'password', 'role'],
        properties: {
            employee_name: { type: 'string', example: 'John Doe' },
            employee_email: { type: 'string', format: 'email', example: 'john.doe@company.com' },
            password: { type: 'string', example: 'securePassword123' },
            role: { type: 'string', enum: Object.values(ROLES), example: ROLES.SUPER_ADMIN },
            employee_phone: { type: 'string', example: '+912345678900' },
            address: { type: 'string', example: '123 Main St' },
            shop_name: { type: 'string', example: 'ABC Electronics' },
            district: { type: 'string', example: 'Central' },
            town: { type: 'string', example: 'Springfield' },
            brand: { type: 'string', example: 'InverterX' },
            photo: { type: 'string', format: 'uri', example: 'https://example.com/photo.jpg' }
        }
    },
    'reset-password': {
        type: 'object',
        required: ['password'],
        properties: {
            current_password: { type: 'string', example: 'oldPassword123' },
            password: { type: 'string', example: 'newSecurePassword456' }
        }
    },
    "/dealer/create-discount": {
        "type": "object",
        "required": ["brand_name", "model_name", "dealer_id", "discount_value", "is_percentage"],
        "properties": {
            "brand_name": { "type": "string", "example": "InverterX" },
            "model_name": { "type": "string", "example": "Model-123" },
            "dealer_id": { "type": "string", "example": "DLR001" },
            "discount_value": { "type": "number", "example": 10 },
            "is_percentage": { "type": "boolean", "example": true },
            "description": { "type": "string", "example": "Summer discount" }
        },
        "example": {
            "brand_name": "InverterX",
            "model_name": "Model-123",
            "dealer_id": "DLR001",
            "discount_value": 10,
            "is_percentage": true,
            "description": "Summer discount"
        }
    },
    "/dealer/create-discounts": {
        "post": {
            "summary": "Create dealer discounts",
            "requestBody": {
                "required": true,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "array",
                            "items": {
                                type: 'object',
                                properties: {}
                            }
                        }
                    }
                }
            },
            "responses": {
                "200": {
                    "description": "Dealer discounts created successfully"
                },
                "400": {
                    "description": "Invalid input"
                }
            }
        }
    },
    'product': {
        type: 'object',
        properties: {
            name: { type: 'string', example: 'Solar Inverter 5000W' },
            description: { type: 'string', example: 'High efficiency solar inverter' },
            price: { type: 'number', example: 899.99 },
            stockQuantity: { type: 'number', example: 50 },
            brand: { type: 'string', example: 'SolarTech' }
        }
    },
    'brand': {
        type: 'object',
        required: ['name'],
        properties: {
            name: { type: 'string', example: 'SolarTech' },
            description: { type: 'string', example: 'Premium solar technology brand' }
        }
    },
    'order': {
        type: 'object',
        properties: {
            status: { type: 'string', example: 'shipped' },
            trackingNumber: { type: 'string', example: 'TRK123456789' },
            notes: { type: 'string', example: 'Order shipped via FedEx' },
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        productId: { type: 'string' },
                        quantity: { type: 'number' },
                        price: { type: 'number' }
                    }
                }
            }
        }
    },
    'upload': {
        type: 'object',
        required: ['files'],
        properties: {
            files: {
                type: 'array',
                items: {
                    type: 'string',
                    format: 'binary'
                }
            }
        }
    },
    'update': {
        type: 'object',
        properties: {
            // Generic update fields will be detected based on path
        }
    },
    'create': {
        type: 'object',
        properties: {
            // Generic create fields
        }
    }
};

const detectRequestBodySchema = (path, method) => {
    const lowerPath = path.toLowerCase();

    for (const [pattern, schema] of Object.entries(REQUEST_BODY_PATTERNS)) {
        if (lowerPath.includes(pattern.toLowerCase())) {
            return { ...schema };
        }
    }

    if (lowerPath.includes('/dealer/create-discounts') && ['post', 'put'].includes(method.toLowerCase())) {
        const discountProperties = {
            brand_name: { type: 'string', example: 'ENTERPRISES' },
            model_name: { type: 'string', example: 'WL 9865' },
            dealer_id: { type: 'string', example: 'KoYpkqUnuh' },
            discount_value: { type: 'number', example: 80.0 },
            is_percentage: { type: 'boolean', example: true },
            description: { type: 'string', example: '' }
        };

        return {
            type: 'array',
            items: {
                type: 'object',
                required: Object.keys(discountProperties),
                properties: discountProperties
            }
        };
    }
    return null;
};

const determineContentType = (path) => {
    const lowerPath = path.toLowerCase();

    if (lowerPath.includes('upload')) {
        return 'multipart/form-data';
    }

    return 'application/json';
};

const enhanceMethodWithRequestBody = (path, method, methodData) => {
    if (method === 'post' || method === 'put') {
        const schema = detectRequestBodySchema(path, method);
        const contentType = determineContentType(path);

        if (schema) {
            methodData.requestBody = {
                required: true,
                content: {
                    [contentType]: {
                        schema: schema
                    }
                }
            };
        }
    }

    return methodData;
};

const enhanceMethodWithResponses = (path, method, methodData) => {
    if (!methodData.responses) {
        methodData.responses = {};
    }

    const commonResponses = {
        '200': { description: 'Success' },
        '400': { description: 'Bad Request' },
        '401': { description: 'Unauthorized' },
        '500': { description: 'Internal Server Error' }
    };

    Object.assign(methodData.responses, commonResponses);

    return methodData;
};

const doc = {
    info: {
        title: `${APPLICATION_NAME} - Inverter Management System`,
        description: `
            #

            Welcome to the ${APPLICATION_NAME} - a comprehensive enterprise-grade API for managing inverter systems, employee operations, order processing, and product management.
            
            📖 Overview

            This API provides a complete solution for inverter management systems, including:

            - 🔐 Authentication & Authorization - Secure JWT-based user management
            - 👥 Employee Management - Complete staff lifecycle management
            - 📦 Order Processing - End-to-end order management system
            - 🔧 Product Catalog - Inverter and product inventory management
            - 📊 Dealer Management - Dealer-specific operations and discounts
            - 📁 File Operations - Secure file uploads and search functionality

            🚀 Quick Start

            #1. Authentication
            \`\`\`bash
            POST /api/v1/auth/signin
            Content-Type: application/json

            {
            "email": "admin@enterprise.com",
            "password": "your_password"
            }
            \`\`\`

            #2. Use Protected Endpoints
            \`\`\`bash
            GET /api/v1/employees
            Authorization: Bearer <your_jwt_token>
            \`\`\`

            🔗 API Resources

            - Base URL: \`${APPLICATION_URL || `http://localhost:${PORT}`}\`
            - API Documentation: \`/api-docs\` (this page)
            - Health Check: \`/health\`

            🛠️ Development

            This API is built with:
            - Node.js - Runtime environment
            - Express.js - Web framework
            - MongoDB - Database
            - JWT - Authentication
            - Swagger/OpenAPI - Documentation

            📋 Version Information

            - API Version: 1.0.0
            - Specification: OpenAPI 3.0.0
            - Last Updated: ${new Date().toLocaleDateString()}

            *For technical support and contributions, please visit our ${APPLICATION_URL} or contact our support team.*
            `.trim(),
        version: '1.0.0',
        contact: {
            name: 'Smart Enterprise Support',
            email: 'support@smart-enterprice.com',
            url: APPLICATION_URL,
        },
        license: {
            name: 'MIT License',
            url: 'https://opensource.org/licenses/MIT'
        }
    },
    host: getHostFromUrl(APPLICATION_URL),
    basePath: '/',
    schemes: APPLICATION_URL && APPLICATION_URL.startsWith('https') ? ['https', 'http'] : ['http'],
    consumes: ['application/json', 'multipart/form-data'],
    produces: ['application/json'],
    securityDefinitions: {
        bearerAuth: {
            type: 'apiKey',
            name: 'Authorization',
            in: 'header',
            description: 'JWT Authorization header using the Bearer scheme. Example: "Authorization: Bearer {token}"'
        }
    },
    security: [{
        bearerAuth: []
    }],
    tags: Object.values(ROUTE_PREFIX_MAP).map(config => ({
        name: config.tag,
        description: `${config.tag} endpoints`
    })),
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            }
        },
        responses: {
            UnauthorizedError: {
                description: 'Authentication token is missing or invalid'
            },
            ValidationError: {
                description: 'Input validation failed'
            }
        }
    }
};

const swagger = swaggerAutogen({
    autoHeaders: true,
    autoQuery: true,
    autoBody: true,
    openapi: '3.0.0',
    language: 'en-US',
    disableLogs: false,
    overwrite: true
});

const generateSwagger = async () => {
    try {
        await swagger(outputFile, endpointsFiles, doc);

        const swaggerDoc = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

        const fixedPaths = {};
        Object.entries(swaggerDoc.paths || {}).forEach(([originalPath, methods]) => {
            const fixedPath = determinePathPrefix(originalPath);

            // Process each method in the path
            Object.entries(methods).forEach(([method, methodData]) => {
                // Enhance with request body
                methods[method] = enhanceMethodWithRequestBody(originalPath, method, methodData);

                // Enhance with responses
                methods[method] = enhanceMethodWithResponses(originalPath, method, methodData);

                // Set tags based on route mapping
                for (const [routeType, config] of Object.entries(ROUTE_PREFIX_MAP)) {
                    if (config.keywords.some(keyword => originalPath.includes(keyword))) {
                        methods[method].tags = [config.tag];
                        break;
                    }
                }

                if (!methods[method].tags) {
                    methods[method].tags = ['Default'];
                }

                // Ensure summary and description exist
                if (!methods[method].summary) {
                    methods[method].summary = `${method.toUpperCase()} ${fixedPath}`;
                }
                if (!methods[method].description) {
                    methods[method].description = `Endpoint for ${method.toUpperCase()} operations on ${fixedPath}`;
                }
            });

            fixedPaths[fixedPath] = methods;
        });

        swaggerDoc.paths = fixedPaths;
        swaggerDoc.host = getHostFromUrl(APPLICATION_URL);

        if (swaggerDoc.servers) {
            delete swaggerDoc.servers;
        }

        fs.writeFileSync(outputFile, JSON.stringify(swaggerDoc, null, 2));
        console.log('📋 Endpoints processed:', Object.keys(swaggerDoc.paths).length);
        console.log('✅ Swagger documentation generated successfully with proper route prefixes and tags \n');
    } catch (error) {
        console.error('❌ Error generating Swagger documentation:', error.message);
        process.exit(1);
    }
};

generateSwagger();