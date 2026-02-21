import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import { OpenAI } from 'openai';

import jwtCheck from './middleware/auth0-jwt-check.js';

import 'dotenv/config.js';

import {
    addLogEntryToUsersSession,
    addLogsToUsersBuild,
    addStepsToUsersBuild,
    createUser,
    createUsersBuild,
    createUsersSession,
    getUserByEmail,
    getUserById,
    getUsersBuildById,
    getUsersBuilds,
    nowTimestamp,
    updateUsersBuild,
    updateUsersSession,
    updateUserTier
} from '../core/firestore/users.js';
import { createAiGetStructureHandler } from '../core/logic/ai-get-structure.js';
import {
    getTierAiPolicy,
    getTierFeaturePolicy,
    getTierModelRoute,
    isInCanaryRollout,
    resolveTier,
} from './config/tier-policy.js';
import {
    getSkuCatalog,
    resolveCheckoutSku,
} from './config/sku-catalog.js';
import {
    buildContextSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    prepareContextForSnapshot,
} from './utils/ai-context.js';
import {
    finalizeUsage,
    getUsageSnapshot,
    migrateInMemoryUsageBucketsToPersistentStore,
    releaseInFlightSlot,
    reserveUsage,
} from './utils/token-governor.js';
import {
    getBuildUsageSnapshot,
    recordBuildFailure,
    reserveBuildQuota,
} from './utils/build-governor.js';
import { validateInstructionPlan } from './utils/build-validator.js';
import {
    evaluateBreakEvenAlerts,
    getBuildCostSnapshots,
    getBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    migrateInMemoryUsageMeteringToPersistentStore,
    recordBuildCostSnapshot,
    recordUsageMetering,
} from './utils/margin-metering.js';
import {
    getPreScalePerformanceProfile,
    getPreScaleTelemetryDashboard,
    migrateInMemoryPreScaleTelemetryToPersistentStore,
    recordPreScaleBuildSuccess,
    recordPreScaleRequestFailure,
    recordPreScaleRequestStart,
} from './utils/pre-scale-telemetry.js';
import {
    getPreScaleSimulationRuns,
    runPreScaleSimulation,
} from './utils/pre-scale-simulation.js';
import {
    getConversionFunnelReport,
    recordCheckoutStarted,
    recordFeatureUsageSignal,
    recordSignupLifecycle,
    recordTierUpgrade,
} from './utils/conversion-funnel.js';
import {
    getSecurityAuditEvents,
    recordSecurityAuditEvent,
} from './utils/security-audit.js';
import {
    evaluateOpsAlerts,
    getOpsDashboardSnapshot,
    recordAiRequestEnd,
    recordAiRequestStart,
    recordBlockedPlacement,
    recordCrash,
    recordInstallation,
    recordTokenBurn,
    setActiveSessions,
    setQueueDepth,
} from './utils/ops-metrics.js';
import {
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    setEmergencyMarginGuardManualOverride,
    shouldForceThinSnapshots,
    shouldThrottleFreeTier,
} from './utils/emergency-margin-guard.js';
import {
    acceptPolicyDocuments,
    createMarketplaceListing,
    createSubscriptionTicket,
    getAttributionEvents,
    getLinkedCommunityAccounts,
    getMarketplaceListings,
    getParentalControls,
    getPhrasePacks,
    getPolicyAcceptance,
    getReactionEvents,
    getRewardBalance,
    linkCommunityAccount,
    recordAttributionEvent,
    recordBuildReaction,
    savePhrasePack,
    setParentalControls,
} from './utils/platform-features.js';
import {
    createReferralCode,
    getReferralEvents,
    getReferralSummary,
    getUserEntitlements,
    redeemReferralCode,
} from './utils/referrals.js';
import {
    getOverageRateUsdPer1k,
    getOverageReport,
    getUserOverageSnapshot,
    recordOverageUsage,
    supportsMeteredOverage,
} from './utils/overage-billing.js';
import {
    evaluateIncidentNotifications,
    getIncidentPlaybooks,
    getIncidents,
    resolveIncident,
} from './utils/incident-manager.js';
import {
    getEvaluationReport,
    recordEvaluationRun,
} from './utils/evaluation-harness.js';
import {
    getAbuseAnalytics,
    recordAbuseSignal,
} from './utils/abuse-analytics.js';
import {
    evaluateRefundEligibility,
    getRenewalPreference,
    setRenewalPreference,
} from './utils/billing-policy.js';
import logger from './utils/logger.js';
import { parsePrompt } from '../../packages/prompt-parser/index.js';
import {
    normalizeInstructionPlan,
    optimizeInstructionPlan,
    toLegacyBlocksAndTags,
} from '../shared-utils/instruction-schema.js';
import { exportInstructionPlanToSchematic } from '../shared-utils/schematic-export.js';
import { registerUserRoutes } from './routes/user-routes.js';
import { registerCommunityRoutes } from './routes/community-routes.js';
import { registerStripeRoutes } from './routes/stripe-routes.js';
import { registerAiRoutes } from './routes/ai-routes.js';
import { registerAdminRoutes } from './routes/admin-routes.js';
import { registerConfigRoutes } from './routes/config-routes.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();

app.use(bodyParser.json());

const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Resolve a stable per-user usage key for monthly token budgeting.
 * Falls back to anonymous keys when auth is not present.
 * @param {import('express').Request} req
 * @param {'free' | 'starter' | 'pro' | 'admin'} tier
 * @returns {string}
 */
function resolveAiUsageKey(req, tier) {
    const authUserId = req.auth?.payload?.sub;
    if (authUserId) {
        return `auth:${authUserId}`;
    }

    const headerUserId = req.headers['x-user-id'];
    if (typeof headerUserId === 'string' && headerUserId.trim().length > 0) {
        return `header:${headerUserId}`;
    }

    return `anon:${tier}:${req.ip || 'unknown-ip'}`;
}

/**
 * Execute a chat completion with automatic fallback model retry.
 * @param {{
 *   primaryModel: string,
 *   fallbackModel: string,
 *   messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }>,
 *   maxTokens?: number,
 * }} params
 * @returns {Promise<{ text: string, modelUsed: string, fallbackUsed: boolean }>}
 * @throws {Error}
 */
async function createCompletionWithFallback({ primaryModel, fallbackModel, messages, maxTokens }) {
    const callModel = async (model) => openai.chat.completions.create({
        model,
        messages,
        ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
    });

    try {
        const chat = await callModel(primaryModel);
        return {
            text: chat.choices?.[0]?.message?.content?.trim() || '',
            modelUsed: primaryModel,
            fallbackUsed: false,
        };
    } catch (primaryError) {
        if (primaryModel === fallbackModel) {
            throw primaryError;
        }

        const fallbackChat = await callModel(fallbackModel);
        return {
            text: fallbackChat.choices?.[0]?.message?.content?.trim() || '',
            modelUsed: fallbackModel,
            fallbackUsed: true,
        };
    }
}

/**
 * Delay execution for retry backoff.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build fallback instruction plan from the deterministic prompt parser.
 * @param {string} prompt
 * @returns {{ schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] }}
 */
function buildFallbackPlan(prompt) {
    const fallbackBlocks = parsePrompt(prompt)
        .map((block) => ({
            type: 'place_block',
            x: Number(block.x || 0),
            y: Number(block.y || 0),
            z: Number(block.z || 0),
            block: String(block.block || 'stone').startsWith('minecraft:')
                ? String(block.block)
                : `minecraft:${String(block.block || 'stone')}`,
        }));

    return {
        schemaVersion: '1.0',
        actions: fallbackBlocks,
        tags: ['fallback'],
    };
}

/**
 * Parse executor output into normalized plan and validate policy constraints.
 * @param {{
 *   rawExecutorText: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   tierFeaturePolicy: ReturnType<typeof getTierFeaturePolicy>,
 * }} params
 * @returns {{
 *   normalizedPlan: { schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] },
 *   validation: ReturnType<typeof validateInstructionPlan>,
 * }}
 * @throws {Error}
 */
function parseAndValidateExecutorPlan({ rawExecutorText, tier, tierFeaturePolicy }) {
    let parsed;
    try {
        parsed = JSON.parse(rawExecutorText);
    } catch {
        throw new Error('Executor response was not valid JSON.');
    }

    const normalizedPlan = optimizeInstructionPlan(normalizeInstructionPlan(parsed));
    const validation = validateInstructionPlan({
        planPayload: normalizedPlan,
        tier,
        tierFeaturePolicy,
    });

    return { normalizedPlan, validation };
}

const MODERATION_BLOCKLIST = Object.freeze([
    'self harm',
    'kill yourself',
    'sexual content involving minors',
    'terrorism',
    'hate crime',
]);

const INFRA_COST_PER_REQUEST_USD = Object.freeze({
    free: 0.0005,
    starter: 0.0003,
    pro: 0.00024,
    admin: 0.0002,
});
const EMERGENCY_GUARD_EVAL_CACHE_TTL_MS = Math.max(
    5000,
    Number(process.env.EMERGENCY_GUARD_CACHE_TTL_MS || 45000),
);
const ADMIN_TIER_FALLBACK_CACHE_TTL_MS = Math.max(
    30000,
    Math.min(120000, Number(process.env.ADMIN_TIER_FALLBACK_CACHE_TTL_MS || 60000)),
);
const FREE_TIER_THROTTLE_ERROR_CODE = 'FREE_TIER_THROTTLED_GUARD_ACTIVE';
const DEFAULT_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS = Math.max(
    15,
    Number(process.env.FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS || 60),
);
const MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS = 3600;
const EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE = 'DISABLE_GUARD_TEMPORARILY';
const ADMIN_SCOPE_TOKENS = Object.freeze(['admin', 'admin:all', 'read:admin', 'write:admin', 'ops:admin']);
const ADMIN_ROLE_CLAIM_KEYS = Object.freeze(
    [
        process.env.AUTH0_ADMIN_ROLE_CLAIM,
        'https://minecraft-ai-agent/roles',
        'roles',
    ].filter(Boolean),
);
const emergencyGuardEvaluationRuntime = {
    lastEvaluatedAtMs: 0,
    lastResult: null,
    inFlightPromise: null,
};
const adminFallbackTierCache = new Map();

/**
 * Basic moderation filter for user prompts.
 * @param {string} prompt
 * @returns {string | null}
 */
function detectModerationViolation(prompt) {
    const lower = String(prompt || '').toLowerCase();
    for (const blockedPhrase of MODERATION_BLOCKLIST) {
        if (lower.includes(blockedPhrase)) {
            return blockedPhrase;
        }
    }
    return null;
}

/**
 * Clone JSON-safe values.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

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
 * Resolve `Retry-After` in seconds for free-tier emergency throttles.
 * @param {Awaited<ReturnType<typeof getEmergencyMarginGuardState>>} state
 * @returns {number}
 */
function resolveFreeTierThrottleRetryAfterSeconds(state) {
    const nowMs = Date.now();
    const cooldownUntilMs = new Date(state?.cooldownUntil || 0).getTime();
    if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
        const secondsUntilCooldownEnds = Math.ceil((cooldownUntilMs - nowMs) / 1000);
        return Math.max(
            15,
            Math.min(MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS, secondsUntilCooldownEnds),
        );
    }

    return Math.max(
        15,
        Math.min(MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS, DEFAULT_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS),
    );
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

/**
 * Resolve numeric alert value for emergency-guard alerts.
 * @param {Awaited<ReturnType<typeof getEmergencyMarginGuardState>>} state
 * @returns {number}
 */
function getEmergencyGuardAlertValue(state) {
    const marginPercent = Number(state?.triggerMetrics?.marginPercent);
    if (Number.isFinite(marginPercent)) {
        return marginPercent;
    }
    return Number(state?.triggerMetrics?.tokenBurnLastHourUsd) || 0;
}

/**
 * Evaluate the global emergency margin guard using current economics + burn metrics.
 * @param {{ force?: boolean, now?: Date }} [params]
 * @returns {Promise<{
 *   month: string | null,
 *   marginPercent: number | null,
 *   tokenBurnLastHourUsd: number,
 *   state: Awaited<ReturnType<typeof getEmergencyMarginGuardState>>,
 *   transition: { activated: boolean, deactivated: boolean, at: string, reasonCodes: string[] } | null,
 * }>}
 */
async function evaluateCurrentEmergencyMarginGuard({ force = false, now = new Date() } = {}) {
    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();
    if (
        !force &&
        emergencyGuardEvaluationRuntime.lastResult &&
        (nowMs - emergencyGuardEvaluationRuntime.lastEvaluatedAtMs) < EMERGENCY_GUARD_EVAL_CACHE_TTL_MS
    ) {
        return cloneJson(emergencyGuardEvaluationRuntime.lastResult);
    }

    if (!force && emergencyGuardEvaluationRuntime.inFlightPromise) {
        return emergencyGuardEvaluationRuntime.inFlightPromise;
    }

    const evaluationPromise = (async () => {
        try {
            const [marginReport, opsSnapshot] = await Promise.all([
                getMonthlyMarginReport({ now: nowDate }),
                Promise.resolve(getOpsDashboardSnapshot()),
            ]);
            const marginPercent = typeof marginReport?.totals?.marginPercent === 'number'
                ? marginReport.totals.marginPercent
                : null;
            const tokenBurnLastHourUsd = Number(opsSnapshot?.tokenBurnLastHourUsd) || 0;
            const evaluation = await evaluateEmergencyMarginGuard({
                marginPercent,
                tokenBurnLastHourUsd,
                force,
                now: nowDate,
            });

            if (evaluation.transition) {
                const from = evaluation.transition.activated ? 'NORMAL' : 'ACTIVE';
                const to = evaluation.transition.activated ? 'ACTIVE' : 'NORMAL';
                const reasonCodes = Array.isArray(evaluation.transition.reasonCodes) && evaluation.transition.reasonCodes.length > 0
                    ? evaluation.transition.reasonCodes
                    : ['none'];
                const transitionLine = `GUARD_STATE_TRANSITION: ${from} -> ${to} reason=${reasonCodes.join(',')}`;
                const transitionContext = {
                    month: marginReport.month,
                    from,
                    to,
                    reasonCodes,
                    marginPercent,
                    tokenBurnLastHourUsd,
                    cooldownUntil: evaluation.state.cooldownUntil,
                    recoveryStreak: evaluation.state.recoveryStreak,
                };
                if (evaluation.transition.activated) {
                    logger.warn(transitionLine, transitionContext);
                } else {
                    logger.info(transitionLine, transitionContext);
                }
            }

            const result = {
                month: marginReport.month || null,
                marginPercent,
                tokenBurnLastHourUsd,
                state: evaluation.state,
                transition: evaluation.transition,
            };

            emergencyGuardEvaluationRuntime.lastResult = cloneJson(result);
            emergencyGuardEvaluationRuntime.lastEvaluatedAtMs = Date.now();
            return cloneJson(result);
        } catch (error) {
            logger.error(`Failed to evaluate emergency margin guard. ${error?.message || error}`, {
                force,
            });
            const fallbackResult = {
                month: null,
                marginPercent: null,
                tokenBurnLastHourUsd: Number(getOpsDashboardSnapshot().tokenBurnLastHourUsd) || 0,
                state: await getEmergencyMarginGuardState(),
                transition: null,
            };
            emergencyGuardEvaluationRuntime.lastResult = cloneJson(fallbackResult);
            emergencyGuardEvaluationRuntime.lastEvaluatedAtMs = Date.now();
            return cloneJson(fallbackResult);
        }
    })().finally(() => {
        if (emergencyGuardEvaluationRuntime.inFlightPromise === evaluationPromise) {
            emergencyGuardEvaluationRuntime.inFlightPromise = null;
        }
    });

    if (!force) {
        emergencyGuardEvaluationRuntime.inFlightPromise = evaluationPromise;
    }

    return evaluationPromise;
}

//rewrite urls from /api to /
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) {
            req.url = req.url.replace(/^\/api/, '');
        }
        next();
    })
}


const routeDeps = {
    stripe,
    jwtCheck,
    asyncHandler,

    // shared db + config
    nowTimestamp,
    getUserById,
    getUserByEmail,
    createUser,
    createUsersBuild,
    updateUsersBuild,
    addStepsToUsersBuild,
    addLogsToUsersBuild,
    createUsersSession,
    updateUsersSession,
    addLogEntryToUsersSession,
    getUsersBuilds,
    getUsersBuildById,
    updateUserTier,
    getTierFeaturePolicy,
    getTierAiPolicy,
    getTierModelRoute,
    resolveTier,
    isInCanaryRollout,
    getSkuCatalog,
    resolveCheckoutSku,

    // ai/context/token flows
    buildContextSnapshot,
    prepareContextForSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    reserveUsage,
    finalizeUsage,
    releaseInFlightSlot,
    getUsageSnapshot,
    reserveBuildQuota,
    getBuildUsageSnapshot,
    recordBuildFailure,
    validateInstructionPlan,
    toLegacyBlocksAndTags,
    exportInstructionPlanToSchematic,

    // economics + telemetry + ops
    recordUsageMetering,
    getUsageMeteringRows,
    getMonthlyMarginReport,
    getBreakEvenAlerts,
    evaluateBreakEvenAlerts,
    recordBuildCostSnapshot,
    getBuildCostSnapshots,
    migrateInMemoryUsageMeteringToPersistentStore,
    recordPreScaleRequestStart,
    recordPreScaleRequestFailure,
    recordPreScaleBuildSuccess,
    getPreScaleTelemetryDashboard,
    getPreScalePerformanceProfile,
    migrateInMemoryPreScaleTelemetryToPersistentStore,
    runPreScaleSimulation,
    getPreScaleSimulationRuns,
    recordCheckoutStarted,
    recordFeatureUsageSignal,
    recordSignupLifecycle,
    recordTierUpgrade,
    evaluateOpsAlerts,
    getOpsDashboardSnapshot,
    setActiveSessions,
    setQueueDepth,
    recordAiRequestStart,
    recordAiRequestEnd,
    recordBlockedPlacement,
    recordCrash,
    recordInstallation,
    recordTokenBurn,

    // guard + security + policy
    evaluateCurrentEmergencyMarginGuard,
    shouldThrottleFreeTier,
    shouldForceThinSnapshots,
    setEmergencyMarginGuardManualOverride,
    getEmergencyGuardAlertValue,
    resolveFreeTierThrottleRetryAfterSeconds,
    detectModerationViolation,
    recordSecurityAuditEvent,
    getSecurityAuditEvents,
    recordAbuseSignal,
    getAbuseAnalytics,
    evaluateIncidentNotifications,
    getIncidents,
    resolveIncident,
    getIncidentPlaybooks,
    evaluateRefundEligibility,
    getRenewalPreference,
    setRenewalPreference,

    // community platform/revenue
    getPolicyAcceptance,
    acceptPolicyDocuments,
    linkCommunityAccount,
    getLinkedCommunityAccounts,
    recordBuildReaction,
    getRewardBalance,
    getReactionEvents,
    savePhrasePack,
    getPhrasePacks,
    createMarketplaceListing,
    getMarketplaceListings,
    createSubscriptionTicket,
    setParentalControls,
    getParentalControls,
    recordAttributionEvent,
    getAttributionEvents,
    createReferralCode,
    redeemReferralCode,
    getReferralSummary,
    getUserEntitlements,
    getReferralEvents,
    getOverageRateUsdPer1k,
    supportsMeteredOverage,
    recordOverageUsage,
    getUserOverageSnapshot,
    getOverageReport,
    recordEvaluationRun,
    getEvaluationReport,

    // local helpers/constants from this module
    resolveAiUsageKey,
    createCompletionWithFallback,
    sleep,
    buildFallbackPlan,
    parseAndValidateExecutorPlan,
    createAiGetStructureHandler,
    invalidateAdminFallbackTierCache,
    requireAdminAccess,
    FREE_TIER_THROTTLE_ERROR_CODE,
    INFRA_COST_PER_REQUEST_USD,
    EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE,

    // migration + logger
    migrateInMemoryUsageBucketsToPersistentStore,
    logger,
};

registerUserRoutes(app, routeDeps);
registerConfigRoutes(app, routeDeps);
registerCommunityRoutes(app, routeDeps);
registerStripeRoutes(app, routeDeps);
registerAiRoutes(app, routeDeps);

/**
 * Lock all admin routes with JWT auth + admin authorization.
 */
app.use('/admin', jwtCheck, requireAdminAccess);
registerAdminRoutes(app, routeDeps);

app.get('/', asyncHandler(async (req, res) => {
    res.send('✅ API is running');
}));
app.use(asyncHandler(async (req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
    });
}));

// Global error handler
app.use((err, req, res, next) => {
    const status = Number(err?.status || err?.statusCode || 0);
    if (status === 401 || err?.name === 'UnauthorizedError' || err?.name === 'InvalidTokenError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: err?.message || 'Missing or invalid access token.',
        });
    }

    if (status === 403 || err?.name === 'InsufficientScopeError') {
        return res.status(403).json({
            error: 'Forbidden',
            message: err?.message || 'Insufficient permissions.',
        });
    }

    console.error('💥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };
