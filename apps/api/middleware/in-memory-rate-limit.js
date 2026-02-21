/**
 * Create a small in-memory sliding-window rate limiter middleware.
 * Intended for local/dev and single-process hardening, not distributed enforcement.
 *
 * @param {{
 *   windowMs: number,
 *   maxRequests: number,
 *   keyPrefix?: string,
 *   keyResolver?: (req: import('express').Request) => string,
 * }} params
 */
export function createInMemoryRateLimiter({
    windowMs,
    maxRequests,
    keyPrefix = 'rate',
    keyResolver = (req) => req.auth?.payload?.sub || req.ip || 'unknown',
}) {
    const safeWindowMs = Math.max(1000, Number(windowMs) || 60000);
    const safeMaxRequests = Math.max(1, Number(maxRequests) || 30);
    const buckets = new Map();

    return function inMemoryRateLimit(req, res, next) {
        const now = Date.now();
        const key = `${keyPrefix}:${String(keyResolver(req) || 'unknown')}`;
        const bucket = buckets.get(key) || [];
        const cutoffMs = now - safeWindowMs;

        while (bucket.length > 0 && bucket[0] <= cutoffMs) {
            bucket.shift();
        }

        if (bucket.length >= safeMaxRequests) {
            const retryAfterSeconds = Math.max(1, Math.ceil(((bucket[0] + safeWindowMs) - now) / 1000));
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests. Please retry later.',
                retryAfterSeconds,
            });
        }

        bucket.push(now);
        buckets.set(key, bucket);

        if (buckets.size > 20000) {
            for (const [entryKey, entryBucket] of buckets.entries()) {
                if (!Array.isArray(entryBucket) || entryBucket.length === 0 || entryBucket[entryBucket.length - 1] <= cutoffMs) {
                    buckets.delete(entryKey);
                }
            }
        }

        return next();
    };
}
