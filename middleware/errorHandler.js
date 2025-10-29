import {
    CustomException
} from '../middleware/CustomError.js';
import { ENVIRONMENT } from '../utils/constants.js';
import logger from '../utils/logger.js';

const sendErrorResponse = (error, req, res) => {
    const response = {
        success: false,
        name: error.name || 'Error',
        message: error.message || 'Internal Server Error',
        statusCode: error.statusCode || 500,
        errors: error.errors || null,
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    if (ENVIRONMENT === 'development' && error.stack) {
        response.stack = error.stack;
    }

    logger.error(`${response.name}: ${response.message}`, {
        method: req.method,
        path: req.originalUrl,
        statusCode: response.statusCode,
        stack: error.stack,
    });

    res.status(response.statusCode).json(response);
};

export const handleRateLimitError = (req, res, next, options) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, url: req.originalUrl });

    const retryAfter = options?.standardHeaders
        ? res.getHeader('Retry-After') || 3600
        : 3600;

    res.status(429).json({
        success: false,
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
        retryAfter,
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    });
};

export const globalErrorHandler = (err, req, res, next) => {
    let error = err;

    if (!(error instanceof CustomException)) {
        const message = error.message || 'Internal Server Error';
        const statusCode = error.statusCode || 500;
        error = new CustomException(message, statusCode);
        error.stack = err.stack;
    }

    sendErrorResponse(error, req, res);
};
