const ADMIN_SCOPE_TOKENS = Object.freeze(['admin', 'admin:all', 'read:admin', 'write:admin', 'ops:admin']);
const ADMIN_ROLE_CLAIM_KEYS = Object.freeze(
    [
        process.env.AUTH0_ADMIN_ROLE_CLAIM,
        'https://minecraft-ai-agent/roles',
        'roles',
    ].filter(Boolean),
);
const ADMIN_TIER_FALLBACK_CACHE_TTL_MS = Math.max(
    30000,
    Math.min(120000, Number(process.env.ADMIN_TIER_FALLBACK_CACHE_TTL_MS || 60000)),
);

/**
 * Build admin-access middleware with fallback tier caching.
 * @param {{
 *   asyncHandler: (fn: Function) => Function,
 *   getUserById: (params: { userId: string }) => Promise<Record<string, any> | null>,
 *   resolveTier: (tier: any) => 'free' | 'starter' | 'pro' | 'admin',
 * }} deps
 */
export function createRequireAdminAccess({ asyncHandler, getUserById, resolveTier }) {
    const adminFallbackTierCache = new Map();

    /**
     * Resolve cached fallback tier for admin authorization.
     * @param {string} userId
     * @returns {'free' | 'starter' | 'pro' | 'admin' | null}
     */
    function getCachedAdminFallbackTier(userId) {
        const entry = adminFallbackTierCache.get(userId);
        if (!entry) {
            return null;
        }

        if (entry.expiresAtMs <= Date.now()) {
            adminFallbackTierCache.delete(userId);
            return null;
        }

        return entry.tier;
    }

    /**
     * Cache fallback tier for admin authorization.
     * @param {{ userId: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
     */
    function setCachedAdminFallbackTier({ userId, tier }) {
        adminFallbackTierCache.set(userId, {
            tier,
            expiresAtMs: Date.now() + ADMIN_TIER_FALLBACK_CACHE_TTL_MS,
        });
    }

    /**
     * Invalidate cached fallback tier for one user.
     * @param {string | undefined | null} userId
     */
    function invalidateAdminFallbackTierCache(userId) {
        if (typeof userId === 'string' && userId.trim().length > 0) {
            adminFallbackTierCache.delete(userId);
        }
    }

    /**
     * Return whether JWT claims indicate admin access.
     * @param {Record<string, any> | undefined} payload
     * @returns {boolean}
     */
    function hasAdminClaims(payload) {
        if (!payload || typeof payload !== 'object') {
            return false;
        }

        for (const claimKey of ADMIN_ROLE_CLAIM_KEYS) {
            const claimValue = payload[claimKey];
            if (Array.isArray(claimValue) && claimValue.some((entry) => String(entry || '').toLowerCase() === 'admin')) {
                return true;
            }
        }

        if (Array.isArray(payload.permissions)) {
            const permissions = payload.permissions.map((entry) => String(entry || '').toLowerCase());
            if (permissions.some((entry) => ADMIN_SCOPE_TOKENS.includes(entry))) {
                return true;
            }
        }

        if (typeof payload.scope === 'string') {
            const scopes = payload.scope
                .split(/\s+/)
                .map((entry) => entry.trim().toLowerCase())
                .filter((entry) => entry.length > 0);
            if (scopes.some((entry) => ADMIN_SCOPE_TOKENS.includes(entry))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Require admin access for /admin routes.
     */
    const requireAdminAccess = asyncHandler(async (req, res, next) => {
        const authPayload = req.auth?.payload;
        const userId = authPayload?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication is required for admin access.' });
        }

        if (hasAdminClaims(authPayload)) {
            return next();
        }

        const cachedFallbackTier = getCachedAdminFallbackTier(userId);
        if (cachedFallbackTier === 'admin') {
            return next();
        }
        if (cachedFallbackTier && cachedFallbackTier !== 'admin') {
            return res.status(403).json({ error: 'Admin access is required.' });
        }

        const user = await getUserById({ userId });
        const fallbackTier = resolveTier(user?.tier || 'free');
        setCachedAdminFallbackTier({
            userId,
            tier: fallbackTier,
        });
        if (fallbackTier !== 'admin') {
            return res.status(403).json({ error: 'Admin access is required.' });
        }

        return next();
    });

    return {
        requireAdminAccess,
        invalidateAdminFallbackTierCache,
    };
}
