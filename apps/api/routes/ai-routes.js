/**
 * Register AI generation routes.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerAiRoutes(app, deps) {
    const {
        asyncHandler,
        resolveTier,
        resolveAiUsageKey,
        createAiGetStructureHandler,
    } = deps;

    const handleAiGetStructure = createAiGetStructureHandler(deps);

    app.post('/ai-get-structure', asyncHandler(async (req, res) => {
        const {
            message,
            tier: rawTier,
            context = {},
            includeSchematic = false,
        } = req.body || {};

        const usageKey = resolveAiUsageKey(req, resolveTier(rawTier));
        const result = await handleAiGetStructure({
            message,
            rawTier,
            context,
            includeSchematic,
            usageKey,
            authUserId: req.auth?.payload?.sub || null,
        });

        if (result.headers && typeof result.headers === 'object') {
            for (const [header, value] of Object.entries(result.headers)) {
                res.set(header, String(value));
            }
        }

        return res.status(result.status).json(result.body);
    }));
}
