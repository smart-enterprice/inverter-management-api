import {
    CustomException
} from '../middleware/CustomError.js';
import logger from '../utils/logger.js';

const sendError = (err, req, res) => {
    const response = {
        success: false,
        name: err.name,
        message: err.message,
        statusCode: err.statusCode || 500,
        errors: err.errors || null,
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };

    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    logger.error(`${err.name || 'Error'}: ${err.message}`, response);
    res.status(response.statusCode).json(response);
};

const handleRateLimitError = (err, req, res, next) => {
    if (err.status === 429) {
        logger.warn('Rate limit exceeded', {
            ip: req.ip,
            url: req.originalUrl
        });

        const retryAfter = (err.headers && err.headers['retry-after']) || 3600;

        return res.status(429).json({
            success: false,
            status: 429,
            message: 'Too many requests. Please try again later.',
            retryAfter,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
    }

    next(err);
};

const globalErrorHandler = (err, req, res, next) => {
    if (!(err instanceof CustomException)) {
        err = new CustomException(err.message || 'Internal Server Error', 500);
        err.stack = err.stack;
    }

    sendError(err, req, res);
};

export {
    handleRateLimitError,
    globalErrorHandler
};