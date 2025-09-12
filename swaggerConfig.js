// swaggerConfig.js
import swaggerAutogen from 'swagger-autogen';
import path from 'path';
import fs from 'fs';
import { APPLICATION_NAME, APPLICATION_URL, PORT, PATH_ROUTES } from './utils/constants.js';

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
        keywords: ['product', 'brand'],
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

const doc = {
    info: {
        title: APPLICATION_NAME,
        description: `
            #

            Welcome to the ${APPLICATION_NAME} REST API documentation. This comprehensive API provides enterprise-grade functionality for managing your business operations.

            🚀 Key Features
            - Secure Authentication - JWT-based authentication system
            - Employee Management - Complete employee lifecycle management
            - Order Processing - End-to-end order management system
            - Product Catalog - Dynamic product and inventory management
            - File Operations - Secure file uploads and search capabilities

            🔐 Authentication
            All protected endpoints require a valid JWT token in the Authorization header:
            
            Authorization: Bearer <your_jwt_token>

            📋 API Version
            - Current Version: 1.0.0
            - Base URL: \`${APPLICATION_URL || `http://localhost:${PORT}`}\`
            - API Specification: OpenAPI 3.0.0

            🛠️ Getting Started
            1. Obtain your API credentials
            2. Authenticate using the \`/auth/signin\` endpoint
            3. Include the received token in all subsequent requests
            4. Explore the available endpoints below

            *For support questions, please contact our team using the information below.*
            `.trim(),
        version: '1.0.0',
        termsOfService: `${APPLICATION_URL}/terms`,
        contact: {
            name: 'API Support Team',
            email: 'support@example.com',
            url: APPLICATION_URL
        },
        license: {
            name: 'Proprietary',
            url: `${APPLICATION_URL}/license`
        },
        "x-logo": {
            url: "https://via.placeholder.com/200x50/3498db/ffffff?text=ENTERPRISE+API",
            backgroundColor: "#FFFFFF",
            altText: "Enterprise API Logo"
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
            description: 'JWT Authorization header using the Bearer scheme. Example: "Authorization: Bearer {token}"',
            'x-bearerFormat': 'JWT'
        }
    },
    security: [{
        bearerAuth: []
    }],
    tags: [
        {
            name: 'Default',
            description: 'Default API endpoints and health checks'
        },
        {
            name: 'Authentication',
            description: 'User authentication and authorization endpoints'
        },
        {
            name: 'Employee Management',
            description: 'Employee profile and account management operations'
        },
        {
            name: 'Dealer Management',
            description: 'Dealer-specific operations and discount management'
        },
        {
            name: 'Order Management',
            description: 'Order processing, tracking, and status management'
        },
        {
            name: 'Product Management',
            description: 'Product catalog, brands, and inventory management'
        },
        {
            name: 'Public Services',
            description: 'Publicly accessible endpoints for search and file operations'
        }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT Token Authentication'
            }
        },
        responses: {
            UnauthorizedError: {
                description: 'Authentication token is missing or invalid',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', example: false },
                                message: { type: 'string', example: 'Authentication required' },
                                code: { type: 'string', example: 'UNAUTHORIZED' }
                            }
                        }
                    }
                }
            },
            ValidationError: {
                description: 'Input validation failed',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', example: false },
                                message: { type: 'string', example: 'Validation failed' },
                                errors: { 
                                    type: 'array', 
                                    items: { type: 'string' },
                                    example: ['Email is required', 'Password must be at least 8 characters']
                                }
                            }
                        }
                    }
                }
            },
            ServerError: {
                description: 'Internal server error',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean', example: false },
                                message: { type: 'string', example: 'Internal server error' },
                                code: { type: 'string', example: 'INTERNAL_ERROR' }
                            }
                        }
                    }
                }
            }
        },
        parameters: {
            AuthorizationHeader: {
                in: 'header',
                name: 'Authorization',
                description: 'JWT Authorization token',
                required: true,
                schema: {
                    type: 'string',
                    example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                }
            }
        }
    },
    "x-tagGroups": [
        {
            name: "Core Services",
            tags: ["Authentication", "Employee Management", "Order Management", "Product Management"]
        },
        {
            name: "Additional Services",
            tags: ["Dealer Management", "Public Services", "Default"]
        }
    ],
    
    "x-config": {
        theme: {
            name: "enterprise",
            primaryColor: "#2c3e50",
            secondaryColor: "#3498db"
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
        Object.entries(swaggerDoc.paths || {}).forEach(([path, methods]) => {
            const fixedPath = determinePathPrefix(path);
            fixedPaths[fixedPath] = methods;

            Object.values(methods).forEach(method => {
                for (const [routeType, config] of Object.entries(ROUTE_PREFIX_MAP)) {
                    if (config.keywords.some(keyword => path.includes(keyword))) {
                        method.tags = [config.tag];
                        break;
                    }
                }

                if (!method.tags) {
                    method.tags = ['Default'];
                }
            });
        });

        swaggerDoc.paths = fixedPaths;
        swaggerDoc.host = getHostFromUrl(APPLICATION_URL);

        if (swaggerDoc.servers) {
            delete swaggerDoc.servers;
        }

        fs.writeFileSync(outputFile, JSON.stringify(swaggerDoc, null, 2));
        console.log('✅ Swagger documentation generated successfully with proper route prefixes and tags \n');
    } catch (error) {
        console.error('❌ Error generating Swagger documentation:', error.message);
        process.exit(1);
    }
};

generateSwagger();