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
 * Feature policy for build/chat gating and server-side safety checks.
 */
export const TIER_FEATURE_POLICY = Object.freeze({
    free: Object.freeze({
        allowBuilds: true,
        allowChatControl: true,
        allowCommandBlocks: false,
        maxBlocksPerBuild: 50,
        maxBuildVolume: 4000,
        maxBuildRequestsPerDay: 12,
        maxBuildRequestsPerMonth: 100,
    }),
    starter: Object.freeze({
        allowBuilds: true,
        allowChatControl: true,
        allowCommandBlocks: false,
        maxBlocksPerBuild: 500,
        maxBuildVolume: 12000,
        maxBuildRequestsPerDay: 80,
        maxBuildRequestsPerMonth: 1000,
    }),
    pro: Object.freeze({
        allowBuilds: true,
        allowChatControl: true,
        allowCommandBlocks: true,
        maxBlocksPerBuild: 2000,
        maxBuildVolume: 35000,
        maxBuildRequestsPerDay: 300,
        maxBuildRequestsPerMonth: 5000,
    }),
    admin: Object.freeze({
        allowBuilds: true,
        allowChatControl: true,
        allowCommandBlocks: true,
        maxBlocksPerBuild: 6000,
        maxBuildVolume: 95000,
        maxBuildRequestsPerDay: 900,
        maxBuildRequestsPerMonth: 15000,
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
 * Get feature policy for a tier.
 * @param {string | undefined | null} tier
 * @returns {Readonly<{
 *   allowBuilds: boolean,
 *   allowChatControl: boolean,
 *   allowCommandBlocks: boolean,
 *   maxBlocksPerBuild: number,
 *   maxBuildVolume: number,
 *   maxBuildRequestsPerDay: number,
 *   maxBuildRequestsPerMonth: number,
 * }>}
 */
export function getTierFeaturePolicy(tier) {
    return TIER_FEATURE_POLICY[resolveTier(tier)];
}

/**
 * Compute deterministic canary enrollment for prompt/model experiments.
 * @param {{ usageKey: string, rolloutPercent?: number }} params
 * @returns {boolean}
 */
export function isInCanaryRollout({ usageKey, rolloutPercent = Number(process.env.AI_CANARY_PERCENT || 0) }) {
    const safeUsageKey = typeof usageKey === 'string' ? usageKey : 'unknown-user';
    const clampedPercent = Math.max(0, Math.min(100, Number(rolloutPercent) || 0));
    if (clampedPercent === 0) {
        return false;
    }

    let hash = 0;
    for (let i = 0; i < safeUsageKey.length; i += 1) {
        hash = ((hash << 5) - hash) + safeUsageKey.charCodeAt(i);
        hash |= 0;
    }

    const normalized = Math.abs(hash % 100);
    return normalized < clampedPercent;
}

/**
 * Return planner/executor model routing for the hybrid strategy.
 * Env vars can override defaults without code changes.
 * @param {string | undefined | null} tier
 * @returns {{ plannerModel: string, executorModel: string, fallbackModel: string, inferencePool: 'standard' | 'priority' }}
 */
export function getTierModelRoute(tier) {
    const resolvedTier = resolveTier(tier);
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'gpt-4';
    const defaultExecutor = process.env.AI_MODEL_EXECUTOR_DEFAULT || 'gpt-4o-mini';

    const routeByTier = {
        free: {
            plannerModel: process.env.AI_MODEL_PLANNER_FREE || defaultExecutor,
            executorModel: process.env.AI_MODEL_EXECUTOR_FREE || defaultExecutor,
            inferencePool: 'standard',
        },
        starter: {
            plannerModel: process.env.AI_MODEL_PLANNER_STARTER || defaultExecutor,
            executorModel: process.env.AI_MODEL_EXECUTOR_STARTER || defaultExecutor,
            inferencePool: 'standard',
        },
        pro: {
            plannerModel: process.env.AI_MODEL_PLANNER_PRO || 'gpt-4.1',
            executorModel: process.env.AI_MODEL_EXECUTOR_PRO || defaultExecutor,
            inferencePool: 'priority',
        },
        admin: {
            plannerModel: process.env.AI_MODEL_PLANNER_ADMIN || 'gpt-4.1',
            executorModel: process.env.AI_MODEL_EXECUTOR_ADMIN || defaultExecutor,
            inferencePool: 'priority',
        },
    };

    const route = routeByTier[resolvedTier];
    return { ...route, fallbackModel };
}
