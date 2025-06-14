import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import hpp from "hpp";
import dotenv from "dotenv";

import logger, { securityLogger, apiLogger } from "./utils/logger.js";
import { handleRateLimitError, globalErrorHandler } from "./middleware/errorHandler.js";
import employeeRoute from "./routes/employeeRoute.js";
import authRoute from "./routes/authRoute.js";
import orderRoute from "./routes/orderRoute.js";
import { STATUS_CODES, PATH_ROUTES } from "./utils/constants.js";
import { NotFoundException } from "./middleware/CustomError.js";
import { requestContextMiddleware } from './middleware/requestContextMiddleware.js';

import { connectToDatabase, closeDatabaseConnection } from "./config/dbConfig.js";
import { employeeService } from "./service/employeeService.js";

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
});

dotenv.config();

const app = express();

app.set("trust proxy", 1);

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: {
        success: false,
        message: "Too many requests from this IP. Please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: handleRateLimitError,
});

const corsOptions = {
    origin: function(origin, callback) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS ?
            process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : ["http://localhost:3000"];

        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            securityLogger.warn("CORS violation attempt", { origin });
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(requestContextMiddleware);
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(cookieParser());
app.use(compression());
app.use(hpp());
app.use(globalLimiter);

app.use((req, res, next) => {
    apiLogger.info(`Incoming ${req.method} request to ${req.originalUrl}`);
    next();
});

const requiredEnvVars = ["MONGO_URL", "JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    logger.error("Missing required environment variables", { missingEnvVars });
    process.exit(1);
}

const PORT = process.env.PORT || 3000;

const startServer = async() => {
    try {
        await connectToDatabase();

        const server = app.listen(PORT, () => {
            employeeService.defaultSuperAdminSetup();

            logger.info(`Server started on port ${PORT}`, {
                environment: process.env.NODE_ENV || "development",
            });
        });

        // Graceful shutdown
        const gracefulShutdown = (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            server.close(async() => {
                await closeDatabaseConnection();
                process.exit(0);
            });
        };

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    } catch (error) {
        logger.error('Error starting server:', error);
        process.exit(1);
    }
};

startServer();

// Routes
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "👋 Welcome to Smart Enterprice",
        version: "1.0.0",
        status: "operational",
        timestamp: new Date().toISOString(),
    });
});

// Health check endpoint
app.get("/health", async(req, res) => {
    let dbStatus = "unknown";
    let dbName = "unknown";

    if (globalThis && globalThis.mongoose && globalThis.mongoose.connection) {
        const state = globalThis.mongoose.connection.readyState;
        const mongooseConnectionState = {
            0: "disconnected",
            1: "connected",
            2: "connecting",
            3: "disconnecting"
        };
        dbStatus = mongooseConnectionState[state] || "unknown";
        dbName = globalThis.mongoose.connection.name || "unknown";
    }

    res.status(200).json({
        success: true,
        message: "🩺 Health check OK",
        service: "Smart Enterprice",
        environment: process.env.NODE_ENV || "development",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        db: {
            status: dbStatus,
            name: dbName
        }
    });
});

app.use(PATH_ROUTES.AUTH_ROUTE, authRoute);
app.use(PATH_ROUTES.EMPLOYEE_ROUTE, employeeRoute);
app.use(PATH_ROUTES.PRODUCT_ROUTE, employeeRoute);
app.use(PATH_ROUTES.ORDER_ROUTE, orderRoute);

app.use((req, res, next) => {
    next(new NotFoundException(`Endpoint '${req.method} ${req.originalUrl}' not found.`));
});

app.use(handleRateLimitError);
app.use(globalErrorHandler);