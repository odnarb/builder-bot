const SUPPORTED_TIERS = ['free', 'starter', 'pro', 'admin'];

/**
 * Canonical subscription prices shown to users.
 * Keep this in sync with frontend plan rendering and Stripe product setup.
 */
export const TIER_PRICES_USD = Object.freeze({
    free: 0,
    starter: 4.99,
    pro: 12.99,
    admin: 24.99,
});

/**
 * Per-tier usage policy used by the AI build endpoint.
 * These values represent guardrails for request limits, token budgets,
 * and monthly volume controls.
 */
export const TIER_AI_POLICY = Object.freeze({
    free: Object.freeze({
        maxInputTokensPerRequest: 4000,
        maxOutputTokensPerRequest: 1200,
        maxRequestsPerMonth: 100,
        maxInputTokensPerMonth: 200000,
        maxOutputTokensPerMonth: 120000,
        maxConcurrentRequests: 1,
        overagePolicy: 'hard_cap',
    }),
    starter: Object.freeze({
        maxInputTokensPerRequest: 8000,
        maxOutputTokensPerRequest: 2200,
        maxRequestsPerMonth: 1000,
        maxInputTokensPerMonth: 1000000,
        maxOutputTokensPerMonth: 600000,
        maxConcurrentRequests: 2,
        overagePolicy: 'basic_metered',
    }),
    pro: Object.freeze({
        maxInputTokensPerRequest: 16000,
        maxOutputTokensPerRequest: 3200,
        maxRequestsPerMonth: 5000,
        maxInputTokensPerMonth: 5000000,
        maxOutputTokensPerMonth: 3000000,
        maxConcurrentRequests: 4,
        overagePolicy: 'advanced_metered',
    }),
    admin: Object.freeze({
        maxInputTokensPerRequest: 32000,
        maxOutputTokensPerRequest: 4200,
        maxRequestsPerMonth: 15000,
        maxInputTokensPerMonth: 15000000,
        maxOutputTokensPerMonth: 9000000,
        maxConcurrentRequests: 8,
        overagePolicy: 'metered_overage',
    }),
});

/**
 * Resolve an incoming tier string to a canonical supported value.
 * @param {string | undefined | null} rawTier
 * @returns {'free' | 'starter' | 'pro' | 'admin'}
 */
export function resolveTier(rawTier) {
    if (typeof rawTier !== 'string') {
        return 'free';
    }

    const normalized = rawTier.trim().toLowerCase();
    return SUPPORTED_TIERS.includes(normalized) ? normalized : 'free';
}

/**
 * Get AI policy for a tier.
 * @param {string | undefined | null} tier
 * @returns {Readonly<{
 *   maxInputTokensPerRequest: number,
 *   maxOutputTokensPerRequest: number,
 *   maxRequestsPerMonth: number,
 *   maxInputTokensPerMonth: number,
 *   maxOutputTokensPerMonth: number,
 *   maxConcurrentRequests: number,
 *   overagePolicy: string,
 * }>}
 */
export function getTierAiPolicy(tier) {
    return TIER_AI_POLICY[resolveTier(tier)];
}

/**
 * Return planner/executor model routing for the hybrid strategy.
 * Env vars can override defaults without code changes.
 * @param {string | undefined | null} tier
 * @returns {{ plannerModel: string, executorModel: string, fallbackModel: string }}
 */
export function getTierModelRoute(tier) {
    const resolvedTier = resolveTier(tier);
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'gpt-4';
    const defaultExecutor = process.env.AI_MODEL_EXECUTOR_DEFAULT || 'gpt-4o-mini';

    const routeByTier = {
        free: {
            plannerModel: process.env.AI_MODEL_PLANNER_FREE || defaultExecutor,
            executorModel: process.env.AI_MODEL_EXECUTOR_FREE || defaultExecutor,
        },
        starter: {
            plannerModel: process.env.AI_MODEL_PLANNER_STARTER || defaultExecutor,
            executorModel: process.env.AI_MODEL_EXECUTOR_STARTER || defaultExecutor,
        },
        pro: {
            plannerModel: process.env.AI_MODEL_PLANNER_PRO || 'gpt-4.1',
            executorModel: process.env.AI_MODEL_EXECUTOR_PRO || defaultExecutor,
        },
        admin: {
            plannerModel: process.env.AI_MODEL_PLANNER_ADMIN || 'gpt-4.1',
            executorModel: process.env.AI_MODEL_EXECUTOR_ADMIN || defaultExecutor,
        },
    };

    const route = routeByTier[resolvedTier];
    return { ...route, fallbackModel };
}

