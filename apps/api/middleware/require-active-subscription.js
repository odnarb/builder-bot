const PAID_TIERS = new Set(['starter', 'pro', 'admin']);

/**
 * Create middleware that requires a paid entitlement when hosted billing is enabled.
 * @param {{
 *   asyncHandler: (fn: Function) => Function,
 *   getUserById: (params: { userId: string }) => Promise<Record<string, any> | null>,
 *   resolveTier: (tier: any) => 'free' | 'starter' | 'pro' | 'admin',
 *   runtimeModeConfig: { billingEnabled?: boolean },
 *   logger?: { warn?: Function, error?: Function },
 * }} deps Runtime dependencies.
 * @returns {Function} Express middleware.
 * @throws {Error} When required dependencies are missing.
 */
export function createRequireActiveSubscription({
    asyncHandler,
    getUserById,
    resolveTier,
    runtimeModeConfig,
    logger,
}) {
    if (typeof asyncHandler !== 'function') {
        throw new Error('createRequireActiveSubscription requires asyncHandler.');
    }
    if (typeof getUserById !== 'function') {
        throw new Error('createRequireActiveSubscription requires getUserById.');
    }
    if (typeof resolveTier !== 'function') {
        throw new Error('createRequireActiveSubscription requires resolveTier.');
    }

    return asyncHandler(async (req, res, next) => {
        if (!runtimeModeConfig?.billingEnabled) {
            return next();
        }

        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(401).json({
                code: 'AUTHENTICATION_REQUIRED',
                message: 'Sign in to continue.',
            });
        }

        let user;
        try {
            user = await getUserById({ userId });
        } catch (error) {
            logger?.error?.(`Failed to resolve subscription state for user ${userId}. ${error.stack}`, { userId });
            return res.status(500).json({
                code: 'SUBSCRIPTION_CHECK_FAILED',
                message: 'Failed to verify subscription. Please try again.',
            });
        }

        const tier = resolveTier(user?.tier || 'free');
        if (!PAID_TIERS.has(tier)) {
            logger?.warn?.(`Blocked hosted request for unpaid user ${userId}.`, { userId, tier });
            return res.status(402).json({
                code: 'SUBSCRIPTION_REQUIRED',
                message: 'Choose a plan to continue.',
            });
        }

        req.builderBotEntitlement = {
            userId,
            tier,
            source: 'hosted_billing',
        };

        return next();
    });
}

