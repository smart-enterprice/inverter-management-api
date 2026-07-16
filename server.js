// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import hpp from "hpp";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import swaggerUi from "swagger-ui-express";
import chalk from "chalk";

import logger, { apiLogger } from "./utils/logger.js";
import { handleRateLimitError, globalErrorHandler } from "./middleware/errorHandler.js";
import { initializeFirebase } from "./config/firebaseConfig.js";

import employeeRoute from "./routes/employeeRoute.js";
import authRoute from "./routes/authRoute.js";
import orderRoute from "./routes/orderRoute.js";
import productRoute from "./routes/productRoute.js";
import publicRoute from "./routes/publicRoute.js";
import locationRoute from "./routes/locationRoute.js";
import companyRoute from "./routes/companyAddressRoute.js";
import invoiceRoute from "./routes/invoiceRoute.js";
import bulkImportRoute from "./routes/bulkImportRoute.js";
import notificationRoute from "./routes/notificationRoute.js";
import analyticsRoute from "./routes/analyticsRoute.js";

import { PATH_ROUTES, APPLICATION_NAME, ENVIRONMENT, PORT, APPLICATION_URL, ALLOWED_ORIGINS } from "./utils/constants.js";

import { NotFoundException } from "./middleware/CustomError.js";
import { requestContextMiddleware } from "./middleware/requestContextMiddleware.js";
import { connectToDatabase, closeDatabaseConnection } from "./config/dbConfig.js";
import { employeeService } from "./service/employeeService.js";

const hyperlink = (text, url) =>
    `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;

const app = express();
const port = PORT || 3000;

app.set("trust proxy", 1);

// NOTE: keyGenerator intentionally uses req.ip only. With `trust proxy` set,
// Express resolves the real client IP; reading x-forwarded-for directly lets
// clients spoof arbitrary keys and bypass the limiter.
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,    // 1 minute
    max: 500,                   // 500 requests per minute

    standardHeaders: true,
    legacyHeaders: false,

    skip: (req) => {
        const p = req.path;
        return (
            p === "/health" ||
            p === "/metrics" ||
            p === "/favicon.ico" ||
            p.startsWith(PATH_ROUTES.NOTIFICATION_ROUTE)    // has its own route-level limiter
        );
    },

    message: {
        success: false,
        message: "Too many requests, please try again after 10 minutes."
    },

    handler: handleRateLimitError,
});

// Auth endpoints (signin/logout/token-active) do JWT + DB work per call —
// keep them on a tighter per-IP budget. Signin additionally has loginLimiter.
const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,    // 1 minute window
    max: 30,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many auth requests. Please try again later.",
    },
    handler: handleRateLimitError,
});

// Matches genuine local dev origins only (e.g. http://localhost:5173).
// Substring checks like origin.includes('localhost') are bypassable via
// domains such as https://localhost.attacker.com.
const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const corsOptions = {
    origin(origin, callback) {
        const allowedOrigins = ALLOWED_ORIGINS ?
            ALLOWED_ORIGINS.split(',').map(o => o.trim()) : ['http://localhost:5173'];

        allowedOrigins.push('https://editor.swagger.io');

        // No Origin header: non-browser clients (mobile app, curl, server-to-server)
        if (!origin || LOCAL_DEV_ORIGIN.test(origin)) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        logger.warn(`[CORS] Origin blocked: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
    optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.use(helmet());
// File uploads go through multer (multipart), so JSON bodies stay small.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());
app.use(compression());
app.use(hpp());

app.use(globalLimiter);

app.use(requestContextMiddleware);

app.use((req, res, next) => {
    apiLogger.info(`Incoming ${req.method} request to ${req.originalUrl}`);
    next();
});

// swagger
const swaggerFile = path.resolve("./swagger-output.json");
if (fs.existsSync(swaggerFile)) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerFile, "utf8"));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

const requiredEnvVars = ["MONGO_URL", "JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    logger.error("Missing required environment variables", { missingEnvVars });
    process.exit(1);
}

// Routes
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: `👋 Welcome to ${APPLICATION_NAME}`,
        version: "1.0.0",
        status: "operational",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    });
});

// Ignore favicon requests to prevent NotFoundException spam
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health check endpoint
app.get("/health", async (req, res) => {
    const state = mongoose.connection?.readyState ?? 0;
    const dbStatus = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting"
    }[state] ?? "unknown";

    res.status(200).json({
        success: true,
        message: "🩺 Health check OK",
        service: APPLICATION_NAME,
        environment: ENVIRONMENT ?? "development",
        version: "1.0.0",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        db: {
            status: dbStatus,
            name: mongoose.connection?.name ?? "unknown",
        },
    });
});

app.use(PATH_ROUTES.AUTH_ROUTE, authLimiter, authRoute);
app.use(PATH_ROUTES.LOCATION_ROUTE, locationRoute);
app.use(PATH_ROUTES.BASIC_ROUTE, publicRoute);

app.use(PATH_ROUTES.EMPLOYEE_ROUTE, employeeRoute);
app.use(PATH_ROUTES.PRODUCT_ROUTE, productRoute);
app.use(PATH_ROUTES.ORDER_ROUTE, orderRoute);

app.use(PATH_ROUTES.INVOICE_ROUTE, invoiceRoute);

app.use(PATH_ROUTES.COMPANY_ROUTE, companyRoute);

app.use(PATH_ROUTES.BULK_IMPORT_ROUTE, bulkImportRoute);

app.use(PATH_ROUTES.NOTIFICATION_ROUTE, notificationRoute);
app.use(PATH_ROUTES.ANALYTICS_ROUTE, analyticsRoute);

// 404 catch-all
app.use((req, _res, next) => {
    next(new NotFoundException(`Endpoint '${req.method} ${req.originalUrl}' not found.`));
});

app.use(globalErrorHandler);

// SERVER START
const startServer = async () => {
    try {
        await connectToDatabase();

        initializeFirebase();

        const server = app.listen(port, () => {
            employeeService.defaultSuperAdminSetup();

            const url = APPLICATION_URL ?? `http://localhost:${port}`;
            logger.info(`${chalk.green("🚀 Server running:")} ${chalk.blueBright(hyperlink(APPLICATION_NAME, url))}`);
        });

        const gracefulShutdown = (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
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

// PROCESS ERROR GUARDS
process.on("unhandledRejection", (reason) => {
    if (reason?.isOperational) {
        logger.warn(`Operational rejection: ${reason.message}`);
    } else {
        logger.error("Unhandled Rejection:", reason);
        process.exit(1);
    }
});

process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception:", err);
    process.exit(1);
});