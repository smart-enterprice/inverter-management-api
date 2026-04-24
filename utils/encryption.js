// encryption.util.js
import crypto from 'crypto';
import { ENCRYPTION_SECRET_KEY } from './constants.js';
import { BadRequestException } from '../middleware/CustomError.js';

const algorithm = 'aes-256-cbc';
const secretKey = crypto
    .createHash('sha256')
    .update(ENCRYPTION_SECRET_KEY)
    .digest();

export const encryptText = (plainText) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
};

export const decryptText = (encryptedString) => {
    const [ivHex, encryptedData] = encryptedString.split(':');

    if (!ivHex || !encryptedData) {
        throw new BadRequestException('Invalid encrypted string format. Expected format iv:encryptedData');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
};