const blacklist = new Map();

function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, expireAt] of blacklist.entries()) {
        if (expireAt <= now) {
            blacklist.delete(token);
        }
    }
}

setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

export const tokenBlacklistService = {
    blacklistToken: (token, expiresInSeconds) => {
        const expireAt = Date.now() + expiresInSeconds * 1000;
        blacklist.set(token, expireAt);
    },

    isBlacklisted: (token) => {
        const expireAt = blacklist.get(token);
        if (!expireAt) return false;
        if (Date.now() > expireAt) {
            blacklist.delete(token);
            return false;
        }
        return true;
    }
};