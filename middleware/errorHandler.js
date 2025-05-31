// errorhandler.js

// import STATUS_CODES from '../utils/constants.js';

// const errorHandler = (err, req, res, next) => {
//     const statusCode = res.statusCode && res.statusCode !== 200 ?
//         res.statusCode :
//         STATUS_CODES.INTERNAL_SERVER_ERROR;

//     res.status(statusCode);

//     switch (statusCode) {
//         case STATUS_CODES.BAD_REQUEST:
//             res.json({
//                 title: "Bad Request",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.VALIDATION_ERROR:
//             res.json({
//                 title: "Validation Error",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.UNAUTHORIZED:
//             res.json({
//                 title: "Unauthorized",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.FORBIDDEN:
//             res.json({
//                 title: "Forbidden",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.NOT_FOUND:
//             res.json({
//                 title: "Not Found",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.CONFLICT:
//             res.json({
//                 title: "Conflict",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.TOO_MANY_REQUESTS:
//             res.json({
//                 title: "Too Many Requests",
//                 message: err.message,
//             });
//             break;

//         case STATUS_CODES.INTERNAL_SERVER_ERROR:
//         default:
//             res.json({
//                 title: "Internal Server Error",
//                 message: err.message,
//             });
//             break;
//     }
// };

// export default errorHandler;

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
        timestamp: new Date().toISOString()
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
            timestamp: new Date().toISOString(),
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