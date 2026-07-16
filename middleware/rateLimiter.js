import rateLimit from "express-rate-limit";
import { handleRateLimitError } from "./errorHandler.js";

// Default keyGenerator (req.ip) is used on purpose: with `trust proxy` set,
// Express resolves the real client IP, while reading x-forwarded-for directly
// would let clients spoof arbitrary keys and bypass the limiter.
export const notificationRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many notification requests. Please try again later.",
    },
    handler: handleRateLimitError,
});
