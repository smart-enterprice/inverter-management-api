// customerror
class CustomException extends Error {
    constructor(message, statusCode = 500, errors = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.errors = errors;
        this.isOperational = true;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationException extends CustomException {
    constructor(message = 'Validation failed', errors = []) {
        super(message, 422, errors);
    }
}

class BadRequestException extends CustomException {
    constructor(message = 'Bad Request', errors = null) {
        super(message, 400, errors);
    }
}

class NotFoundException extends CustomException {
    constructor(message = 'Resource not found') {
        super(message, 404);
    }
}

class UnauthorizedException extends CustomException {
    constructor(message = 'Unauthorized') {
        super(message, 401);
    }
}

class ConflictException extends CustomException {
    constructor(message = 'Conflict') {
        super(message, 409);
    }
}

class InternalServerException extends CustomException {
    constructor(message = 'Internal Server Error') {
        super(message, 500);
    }
}

export {
    CustomException,
    ValidationException,
    BadRequestException,
    NotFoundException,
    UnauthorizedException,
    ConflictException,
    InternalServerException
};