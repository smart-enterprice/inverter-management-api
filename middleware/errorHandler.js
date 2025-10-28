import {
    CustomException
} from '../middleware/CustomError.js';
import { ENVIRONMENT } from '../utils/constants.js';
import logger from '../utils/logger.js';

const sendErrorResponse = (err, req, res) => {
    const response = {
        success: false,
        name: err.name || 'Error',
        message: err.message || 'Internal Server Error',
        statusCode: err.statusCode || 500,
        errors: err.errors || null,
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    if (ENVIRONMENT === 'development' && err.stack) {
        response.stack = err.stack;
    }

    logger.error(`${response.name}: ${response.message}`, {
        path: req.originalUrl,
        method: req.method,
        statusCode: response.statusCode,
        stack: err.stack,
    });
    res.status(response.statusCode).json(response);
};

export const handleRateLimitError = (err, req, res, next) => {
    const retryAfter = 3600; // default 1 hour

    logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.originalUrl,
    });

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
