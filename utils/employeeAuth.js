// employeeAuth.js

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { decryptText } from '../utils/encryption.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from './constants.js';
import { BadRequestException } from '../middleware/CustomError.js';

const BCRYPT_SALT_ROUNDS = 10;

export const validatePassword = (password) => {
    if (!password) throw new BadRequestException('Password is required');
    if (password.length < 8)
        throw new BadRequestException('Password must be at least 8 characters long');

    const pattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

    if (!pattern.test(password)) {
        throw new BadRequestException('Password must include lowercase, uppercase, number, and special character');
    }
};

export const hashPassword = async (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

// Legacy passwords were stored as reversible AES ("iv:ciphertext" hex). Detect
// them so login can verify via decryption once, then upgrade to bcrypt.
export const isLegacyEncryptedPassword = (stored) =>
    typeof stored === 'string' && /^[0-9a-f]{32}:[0-9a-f]+$/i.test(stored);

export const comparePassword = async (plainPassword, storedPassword) => {
    if (!plainPassword || !storedPassword) return false;

    if (isLegacyEncryptedPassword(storedPassword)) {
        try {
            return plainPassword === decryptText(storedPassword);
        } catch {
            return false;
        }
    }

    return bcrypt.compare(plainPassword, storedPassword);
};

export const generateToken = (employeeId, role, status) => {
    return jwt.sign({ employee_id: employeeId, role, status },
        JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
    );
};
