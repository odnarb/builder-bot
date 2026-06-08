import { createInMemoryRateLimiter } from '../middleware/in-memory-rate-limit.js';

/**
 * Register AI generation routes.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerAiRoutes(app, deps) {
    const {
        jwtCheck,
        asyncHandler,
        getUserById,
        resolveTier,
        resolveAiUsageKey,
        requireActiveSubscription = (_req, _res, next) => next(),
        createAiGetStructureHandler,
    } = deps;

    const handleAiGetStructure = createAiGetStructureHandler(deps);
    const aiRateLimiter = createInMemoryRateLimiter({
        windowMs: Number(process.env.AI_ROUTE_RATE_LIMIT_WINDOW_MS || 60000),
        maxRequests: Number(process.env.AI_ROUTE_RATE_LIMIT_MAX_REQUESTS || 30),
        keyPrefix: 'ai-get-structure',
    });

    app.post('/ai-get-structure', jwtCheck, requireActiveSubscription, aiRateLimiter, asyncHandler(async (req, res) => {
        const {
            message,
            context = {},
            includeSchematic = false,
        } = req.body || {};
        const authUserId = req.auth?.payload?.sub || null;
        if (!authUserId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing or invalid access token.',
            });
        }

        const user = await getUserById({ userId: authUserId });
        const rawTier = resolveTier(user?.tier || 'free');

        const usageKey = resolveAiUsageKey(req, resolveTier(rawTier));
        const result = await handleAiGetStructure({
            message,
            rawTier,
            context,
            includeSchematic,
            usageKey,
            authUserId,
        });

        if (result.headers && typeof result.headers === 'object') {
            for (const [header, value] of Object.entries(result.headers)) {
                res.set(header, String(value));
            }
        }

        return res.status(result.status).json(result.body);
    }));
}
