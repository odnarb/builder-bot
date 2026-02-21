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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();

app.use(bodyParser.json());

const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const optionalJwtCheck = (req, res, next) => {
    if (!req.headers?.authorization) {
        return next();
    }

    return jwtCheck(req, res, next);
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

app.get('/user/tier', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth.payload.sub;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const user = await getUserById({ userId });

        if (!user) {
            return res.json({ tier: 'pending', exists: false });
        }

        return res.json({ tier: user.tier || 'free' });
    } catch (err) {
        console.error(`❌ Failed to fetch tier for ${userId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

/**
 * Return enforced feature policy for the authenticated user's tier.
 */
app.get('/user/features', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const user = await getUserById({ userId });
        const tier = resolveTier(user?.tier || 'free');
        return res.json({
            tier,
            features: getTierFeaturePolicy(tier),
        });
    } catch (error) {
        logger.error(`Failed to fetch user feature policy for ${userId}. ${error.stack}`, {
            userId,
        });
        return res.status(500).json({ error: 'Failed to fetch user feature policy.' });
    }
}));

/**
 * Return entitlement balances for authenticated user.
 */
app.get('/user/entitlements', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({
        entitlements: getUserEntitlements(userId),
        referral: getReferralSummary(userId),
    });
}));

/**
 * Return authenticated user's metered overage snapshot.
 */
app.get('/user/overage', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const tier = resolveTier((await getUserById({ userId }))?.tier || 'free');
    const usageKey = `auth:${userId}`;
    return res.json({
        tier,
        overage: getUserOverageSnapshot({ userKey: usageKey }),
    });
}));

/**
 * Return active sellable SKU catalog.
 */
app.get('/config/skus', asyncHandler(async (req, res) => {
    return res.json({
        skus: getSkuCatalog(),
    });
}));

app.get('/user', jwtCheck, asyncHandler(async (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const user = await getUserByEmail({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ user });
    } catch (err) {
        console.error(`❌ Failed to fetch user with email ${email}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.get('/user/:userId', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.params.userId

    try {
        const user = await getUserById({ userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ user });
    } catch (err) {
        console.error(`❌ Failed to fetch user with id ${userId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/user/signup', jwtCheck, asyncHandler(async (req, res) => {
    const {
        email,
        name,
        auth0LoginId,
        picture,
        termsVersion,
        privacyVersion,
    } = req.body

    try {
        const userId = req.auth?.payload?.sub || auth0LoginId;
        const user = {
            email,
            name,
            auth0LoginId,
            picture, tier: 'pending',
            createdAt: nowTimestamp()
        }

        const created = await createUser({ user });
        if (created) {
            recordInstallation();
        }

        if (termsVersion || privacyVersion) {
            acceptPolicyDocuments({
                userId,
                termsVersion,
                privacyVersion,
            });
        }

        if (userId) {
            await recordSignupLifecycle({
                userId,
                tier: 'free',
            });
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to create user with id ${auth0LoginId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/user/plan', jwtCheck, asyncHandler(async (req, res) => {
    try {
        const { tier } = req.body;
        const userId = req.auth.payload.sub;
        const user = await getUserById({ userId });
        const fromTier = resolveTier(user?.tier || 'free');

        if (!['free', 'starter', 'pro', 'admin'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier selected' });
        }

        await updateUserTier({ userId, tier });
        invalidateAdminFallbackTierCache(userId);
        if (fromTier !== tier) {
            await recordTierUpgrade({
                userId,
                fromTier,
                toTier: tier,
                skuCode: `${tier}_manual`,
            });
        }

        res.json({ status: 'updated', tier });
    } catch (err) {
        console.error('❌ Tier update failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/user/session/:sessionId/build', jwtCheck, asyncHandler(async (req, res) => {
    const { build } = req.body
    const userId = req.auth.payload.sub
    const sessionId = req.params.sessionId;

    if (!userId || !sessionId || !build) {
        return res.status(400).json({ error: 'Missing userId, sessionId, or build' });
    }

    try {
        const newBuild = {
            ...build,
            createdAt: nowTimestamp()
        }
        const docRef = await createUsersBuild({ userId, build: newBuild });

        //add the log entry
        const log = {
            type: "creating_build",
            data: {
                buildId: docRef.id,
                ...build
            },
            timestamp: nowTimestamp()
        };
        await addLogEntryToUsersSession({ userId, sessionId, log });

        return res.status(200).json({ buildId: docRef.id });
    } catch (err) {
        console.error(`❌ Failed to create user build for userId ${userId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.put('/user/session/:sessionId/build/:buildId', jwtCheck, asyncHandler(async (req, res) => {
    const { build } = req.body
    const userId = req.auth.payload.sub
    const buildId = req.params.buildId;
    const sessionId = req.params.sessionId;

    if (!userId || !build || !buildId || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, buildId, sessionId, or build' });
    }

    try {
        const log = {
            type: "updating_build",
            data: {
                buildId,
                ...build
            },
            timestamp: nowTimestamp()
        };
        await addLogEntryToUsersSession({ userId, sessionId, log });

        await updateUsersBuild({ userId, buildId, build });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to update user build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/user/session/:sessionId/build/:buildId/steps', jwtCheck, asyncHandler(async (req, res) => {
    const { steps } = req.body
    const userId = req.auth.payload.sub
    const buildId = req.params.buildId;
    const sessionId = req.params.sessionId;

    if (!userId || !steps || !buildId || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, buildId, sessionId, or steps' });
    }

    try {
        const log = {
            type: "saving_build_steps",
            data: {
                buildId,
                steps: steps.length
            },
            timestamp: nowTimestamp()
        };
        await addLogEntryToUsersSession({ userId, sessionId, log });
        await addStepsToUsersBuild({ userId, buildId, steps });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to add steps to user's build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/user/session/:sessionId/build/:buildId/logs', jwtCheck, asyncHandler(async (req, res) => {
    const { logs } = req.body
    const userId = req.auth.payload.sub
    const buildId = req.params.buildId;
    const sessionId = req.params.sessionId;

    if (!userId || !logs || !buildId || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, buildId, sessionId, or logs' });
    }

    try {
        const log = {
            type: "saving_build_logs",
            data: {
                buildId,
                logs: logs.length
            },
            timestamp: nowTimestamp()
        };
        await addLogEntryToUsersSession({ userId, sessionId, log });
        await addLogsToUsersBuild({ userId, buildId, logs });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to add logs to user's build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

/**
 * Return recent build history for the authenticated user.
 * Query params:
 * - limit (optional): max rows (1-100), default 20.
 */
app.get('/user/builds', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const limit = Number(req.query.limit);

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const builds = await getUsersBuilds({
            userId,
            limit: Number.isFinite(limit) ? limit : 20,
        });
        return res.json({ builds });
    } catch (error) {
        logger.error(`Failed to fetch build history for user ${userId}. ${error.stack}`, {
            userId,
            limit,
        });
        return res.status(500).json({ error: 'Failed to fetch build history. Please try again.' });
    }
}));

/**
 * Return one build record for the authenticated user.
 */
app.get('/user/build/:buildId', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const buildId = req.params.buildId;

    if (!userId || !buildId) {
        return res.status(400).json({ error: 'userId and buildId are required' });
    }

    try {
        const build = await getUsersBuildById({ userId, buildId });
        if (!build) {
            return res.status(404).json({ error: 'Build not found' });
        }

        return res.json({ build });
    } catch (error) {
        logger.error(`Failed to fetch build ${buildId} for user ${userId}. ${error.stack}`, {
            userId,
            buildId,
        });
        return res.status(500).json({ error: 'Failed to fetch build. Please try again.' });
    }
}));

/**
 * Link a user account to CurseForge or Modrinth for sharing workflows.
 */
app.post('/community/link', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { platform, handle } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const link = linkCommunityAccount({ userId, platform, handle });
        return res.json({ link });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to link account.' });
    }
}));

/**
 * Return linked community accounts for the authenticated user.
 */
app.get('/community/link', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({ links: getLinkedCommunityAccounts(userId) });
}));

/**
 * Record a like/upvote event with one-vote-per-user anti-fraud baseline.
 */
app.post('/community/build/:buildId/reaction', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const buildId = req.params.buildId;
    const reaction = req.body?.reaction;
    const buildOwnerUserId = req.body?.buildOwnerUserId;

    if (!userId || !buildId) {
        return res.status(400).json({ error: 'userId and buildId are required' });
    }

    try {
        const result = recordBuildReaction({
            userId,
            buildId,
            reaction,
            buildOwnerUserId,
        });
        return res.json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to record reaction.' });
    }
}));

/**
 * Return reward balance and recent reaction anti-fraud events for the user.
 */
app.get('/community/rewards', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const limit = Number(req.query.limit);
    return res.json({
        balance: getRewardBalance(userId),
        recentReactionEvents: getReactionEvents({
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Create or return the caller's referral code.
 */
app.post('/community/referral/code', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const code = createReferralCode({ userId });
        return res.status(201).json({ code });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create referral code.' });
    }
}));

/**
 * Redeem a referral code and apply entitlement credits.
 */
app.post('/community/referral/redeem', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const code = req.body?.code;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const redemption = redeemReferralCode({ userId, code });
        return res.json({ redemption });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to redeem referral code.' });
    }
}));

/**
 * Return referral summary and entitlement state for the caller.
 */
app.get('/community/referral/summary', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({
        summary: getReferralSummary(userId),
        entitlements: getUserEntitlements(userId),
    });
}));

/**
 * Create a reusable phrase pack / personality preset.
 */
app.post('/community/phrase-pack', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { name, phrases } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const pack = savePhrasePack({ userId, name, phrases });
        return res.status(201).json({ pack });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to save phrase pack.' });
    }
}));

/**
 * Return phrase packs for the authenticated user.
 */
app.get('/community/phrase-packs', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({ packs: getPhrasePacks(userId) });
}));

/**
 * Create marketplace listing for build/template sharing.
 */
app.post('/community/marketplace/listing', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { title, description, priceUsd, buildId } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const listing = createMarketplaceListing({
            userId,
            title,
            description,
            priceUsd,
            buildId,
        });
        return res.status(201).json({ listing });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create listing.' });
    }
}));

/**
 * Return public marketplace listings.
 */
app.get('/community/marketplace/listings', asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit);
    return res.json({
        listings: getMarketplaceListings({
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Store Terms/Privacy acceptance for authenticated user.
 */
app.post('/user/policy/accept', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { termsVersion, privacyVersion } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const acceptance = acceptPolicyDocuments({
            userId,
            termsVersion,
            privacyVersion,
        });
        return res.json({ acceptance });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to record policy acceptance.' });
    }
}));

/**
 * Return current Terms/Privacy acceptance state.
 */
app.get('/user/policy/acceptance', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({ acceptance: getPolicyAcceptance(userId) });
}));

/**
 * Submit cancellation/refund workflow ticket.
 */
app.post('/user/subscription/ticket', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const {
        type,
        reason,
        purchasedAt,
        usagePercent,
        previousRefundCount,
    } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        let refundEligibility = null;
        if (String(type || '').toLowerCase() === 'refund') {
            refundEligibility = evaluateRefundEligibility({
                purchasedAt,
                usagePercent,
                previousRefundCount,
            });

            if (!refundEligibility.eligible) {
                return res.status(422).json({
                    error: refundEligibility.reason,
                    refundEligibility,
                });
            }
        }

        const ticket = createSubscriptionTicket({ userId, type, reason });
        if (String(type || '').toLowerCase() === 'cancel') {
            setRenewalPreference({ userId, autoRenew: false });
        }

        return res.status(201).json({ ticket, refundEligibility });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create ticket.' });
    }
}));

/**
 * Return renewal preference for authenticated user.
 */
app.get('/user/subscription/renewal', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({
        renewal: getRenewalPreference(userId),
    });
}));

/**
 * Update renewal preference for authenticated user.
 */
app.put('/user/subscription/renewal', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { autoRenew, currentPeriodEnd } = req.body || {};
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const renewal = setRenewalPreference({
            userId,
            autoRenew,
            currentPeriodEnd,
        });
        return res.json({ renewal });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to update renewal preference.' });
    }
}));

/**
 * Set parental controls and moderation preferences for authenticated user.
 */
app.put('/user/parental-controls', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { strictMode, blockedTopics } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const controls = setParentalControls({
        userId,
        strictMode,
        blockedTopics,
    });
    return res.json({ controls });
}));

/**
 * Return parental controls for authenticated user.
 */
app.get('/user/parental-controls', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    return res.json({ controls: getParentalControls(userId) });
}));

/**
 * Track campaign attribution metadata.
 */
app.post('/analytics/attribution', jwtCheck, asyncHandler(async (req, res) => {
    const userId = req.auth?.payload?.sub;
    const { source, campaign, medium } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const event = recordAttributionEvent({
        userId,
        source,
        campaign,
        medium,
    });
    return res.status(201).json({ event });
}));

app.post('/user/session/:sessionId', jwtCheck, asyncHandler(async (req, res) => {
    const { session } = req.body
    const userId = req.auth.payload.sub
    const sessionId = req.params.sessionId;

    if (!userId || !session || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, sessionId, or session' });
    }

    const sessionStart = {
        ...session,
        createdAt: nowTimestamp()
    }

    try {
        await createUsersSession({ userId, sessionId, sessionStart });
        const snapshot = getOpsDashboardSnapshot();
        setActiveSessions({ count: snapshot.activeSessions + 1 });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to create session for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.put('/user/session/:sessionId', jwtCheck, asyncHandler(async (req, res) => {
    const { session } = req.body
    const userId = req.auth.payload.sub
    const sessionId = req.params.sessionId;

    if (!userId || !session || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, sessionId, or session' });
    }

    const sessionWithTimestamp = {
        ...session,
        updatedAt: nowTimestamp()
    }

    try {
        await updateUsersSession({ userId, sessionId, session: sessionWithTimestamp });
        if (session?.status === 'ended' || session?.status === 'stopped' || session?.exit_code !== undefined) {
            const snapshot = getOpsDashboardSnapshot();
            setActiveSessions({ count: Math.max(0, snapshot.activeSessions - 1) });
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to create session for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/user/session/:sessionId/log', jwtCheck, asyncHandler(async (req, res) => {
    const { log } = req.body
    const userId = req.auth.payload.sub
    const sessionId = req.params.sessionId;

    if (!userId || !log || !sessionId) {
        return res.status(400).json({ error: 'Missing userId, sessionId, or log' });
    }

    const logWithTime = { ...log, timestamp: nowTimestamp() };

    try {
        await addLogEntryToUsersSession({ userId, sessionId, log: logWithTime });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to add log entry for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/stripe/create-checkout-session', jwtCheck, asyncHandler(async (req, res) => {
    const CHECKOUT_URL = process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173';
    const userId = req.auth?.payload?.sub;
    const existingAcceptance = userId ? getPolicyAcceptance(userId) : null;

    // Map SKU → Stripe product id
    const productMap = {
        starter_monthly: process.env.STRIPE_PRODUCT_ID_STARTER_TIER,
        pro_monthly: process.env.STRIPE_PRODUCT_ID_PRO_TIER,
        admin_monthly: process.env.STRIPE_PRODUCT_ID_ADMIN_TIER,
    };

    const { username, tier, skuCode, termsVersion, privacyVersion } = req.body || {};
    const checkoutSku = resolveCheckoutSku({ skuCode, tier });

    if (!checkoutSku || checkoutSku.tier === 'free') {
        return res.status(400).json({ error: 'Invalid SKU selection' });
    }

    const resolvedTermsVersion = termsVersion || existingAcceptance?.termsVersion;
    const resolvedPrivacyVersion = privacyVersion || existingAcceptance?.privacyVersion;
    if (!resolvedTermsVersion || !resolvedPrivacyVersion) {
        return res.status(400).json({
            error: 'Terms and privacy acceptance is required before checkout.',
        });
    }

    if (termsVersion && privacyVersion && userId) {
        acceptPolicyDocuments({
            userId,
            termsVersion,
            privacyVersion,
        });
    }

    if (!productMap[checkoutSku.code]) {
        return res.status(400).json({ error: `Missing Stripe product mapping for SKU "${checkoutSku.code}".` });
    }

    try {
        if (userId) {
            const user = await getUserById({ userId });
            await recordCheckoutStarted({
                userId,
                fromTier: resolveTier(user?.tier || 'free'),
                toTier: checkoutSku.tier,
                skuCode: checkoutSku.code,
            });
        }

        const products = await stripe.products.list({ limit: 100 });
        const product = products.data.find(p => p.id === productMap[checkoutSku.code]);
        const price = product?.default_price;

        if (!price) throw new Error('No price attached to product');

        const session = await stripe.checkout.sessions.create({
            mode: checkoutSku.kind === 'one_time' ? 'payment' : 'subscription',
            line_items: [{ price, quantity: 1 }],
            success_url: `${CHECKOUT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${CHECKOUT_URL}/checkout/cancel`,
            metadata: {
                username,
                tier: checkoutSku.tier,
                skuCode: checkoutSku.code,
                userId,
                termsVersion: resolvedTermsVersion,
                privacyVersion: resolvedPrivacyVersion,
            },
        });

        return res.json({ url: session.url, sku: checkoutSku });
    } catch (err) {
        console.error(`❌ Stripe session error: ${err.message}`);
        return res.status(500).json({ error: 'Could not create checkout session' });
    }
}))

app.post('/stripe/confirm-checkout', jwtCheck, asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription'],
    });

    const metadataTier = resolveTier(session.metadata?.tier || 'free');
    const skuCode = session.metadata?.skuCode || null;
    const userId = req.auth.payload.sub;

    const termsVersion = session.metadata?.termsVersion;
    const privacyVersion = session.metadata?.privacyVersion;
    const existingAcceptance = getPolicyAcceptance(userId);
    const resolvedTermsVersion = termsVersion || existingAcceptance?.termsVersion;
    const resolvedPrivacyVersion = privacyVersion || existingAcceptance?.privacyVersion;

    if (!resolvedTermsVersion || !resolvedPrivacyVersion) {
        return res.status(400).json({
            error: 'Checkout confirmation requires terms/privacy acceptance metadata.',
        });
    }

    acceptPolicyDocuments({
        userId,
        termsVersion: resolvedTermsVersion,
        privacyVersion: resolvedPrivacyVersion,
    });

    const user = await getUserById({ userId });
    const fromTier = resolveTier(user?.tier || 'free');
    await updateUserTier({ userId: user.id, tier: metadataTier });
    invalidateAdminFallbackTierCache(userId);
    await recordTierUpgrade({
        userId,
        fromTier,
        toTier: metadataTier,
        skuCode,
    });

    if (session.subscription && typeof session.subscription === 'object') {
        const periodEndUnix = Number(session.subscription.current_period_end || 0);
        const currentPeriodEnd = periodEndUnix > 0
            ? new Date(periodEndUnix * 1000).toISOString()
            : null;
        const autoRenew = !Boolean(session.subscription.cancel_at_period_end);
        setRenewalPreference({
            userId,
            autoRenew,
            currentPeriodEnd,
        });
    }

    res.json({
        status: 'success',
        tier: metadataTier,
        skuCode,
        acceptance: getPolicyAcceptance(userId),
        renewal: getRenewalPreference(userId),
    });
}))

app.post('/ai-get-structure', optionalJwtCheck, asyncHandler(async (req, res) => {
    const requestStartedAtMs = Date.now();
    const { message, tier: rawTier, context = {}, includeSchematic = false } = req.body || {};

    if (typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' });
    }

    const authUserId = req.auth?.payload?.sub || null;
    const moderationViolation = detectModerationViolation(message);
    let tier = 'free';
    if (authUserId) {
        const user = getUserById(authUserId);
        tier = resolveTier(user?.tier);
    } else if (rawTier && resolveTier(rawTier) !== 'free') {
        recordSecurityAuditEvent({
            type: 'tier_override_ignored',
            severity: 'info',
            userKey: resolveAiUsageKey(req, 'free'),
            tier: 'free',
            message: 'Unauthenticated tier override ignored on /ai-get-structure.',
            context: {
                requestedTier: resolveTier(rawTier),
            },
        });
    }

    const tierPolicy = getTierAiPolicy(tier);
    const tierFeaturePolicy = getTierFeaturePolicy(tier);
    const modelRoute = getTierModelRoute(tier);
    const usageKey = resolveAiUsageKey(req, tier);
    const canaryVariantEnabled = isInCanaryRollout({ usageKey });
    await recordPreScaleRequestStart({
        userKey: usageKey,
        tier,
    });
    recordAbuseSignal({
        userKey: usageKey,
        channel: 'build',
        signal: 'build_request',
        severity: 'low',
        metadata: { tier },
    });
    const contextPreparationStartedAtMs = Date.now();
    const emergencyGuardEvaluation = await evaluateCurrentEmergencyMarginGuard();
    const emergencyGuardState = emergencyGuardEvaluation.state;

    if (shouldThrottleFreeTier({ tier, guardState: emergencyGuardState })) {
        const retryAfterSeconds = resolveFreeTierThrottleRetryAfterSeconds(emergencyGuardState);
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: true,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'api',
            signal: 'emergency_guard_free_tier_throttle',
            severity: 'medium',
            metadata: {
                tier,
                reasonCodes: emergencyGuardState.reasonCodes,
            },
        });
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            code: FREE_TIER_THROTTLE_ERROR_CODE,
            error: 'Free tier is temporarily throttled due to emergency capacity protection. Upgrade to Starter, Pro, or Admin for continued access.',
            retryAfterSeconds,
            upgradeSuggested: true,
            emergencyGuard: {
                active: emergencyGuardState.active,
                reason: emergencyGuardState.reason,
                reasonCodes: emergencyGuardState.reasonCodes,
            },
        });
    }

    if (!tierFeaturePolicy.allowBuilds) {
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: false,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        return res.status(403).json({
            error: `Build generation is not available for tier "${tier}".`,
        });
    }

    if (moderationViolation) {
        recordSecurityAuditEvent({
            type: 'moderation_block',
            severity: 'warning',
            userKey: usageKey,
            tier,
            message: 'Prompt blocked by moderation filter.',
            context: {
                moderationViolation,
            },
        });
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'chat',
            signal: 'moderation_block',
            severity: 'high',
            metadata: { moderationViolation },
        });
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: false,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        return res.status(400).json({
            error: 'Prompt could not be processed due to safety policy.',
        });
    }

    recordAiRequestStart();
    setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
    try {
        reserveBuildQuota({
            userKey: usageKey,
            tierFeaturePolicy,
        });
    } catch (quotaError) {
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'build',
            signal: 'build_quota_rejected',
            severity: 'medium',
            metadata: { tier },
        });
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: true,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        recordAiRequestEnd({
            success: false,
            queueRejected: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
        return res.status(429).json({ error: quotaError.message });
    }

    const {
        contextForSnapshot,
        diagnostics: contextDiagnostics,
    } = prepareContextForSnapshot({
        usageKey,
        context,
        forceThinSnapshot: shouldForceThinSnapshots({ guardState: emergencyGuardState }),
    });
    const contextSnapshot = buildContextSnapshot({
        context: contextForSnapshot,
        tierPolicy,
    });
    const estimatedInputTokens = estimateAiInputTokens({
        message,
        contextSnapshot,
        tier,
    });

    if (estimatedInputTokens > tierPolicy.maxInputTokensPerRequest) {
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'api',
            signal: 'request_input_too_large',
            severity: 'medium',
            metadata: { estimatedInputTokens, tier },
        });
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: true,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        recordAiRequestEnd({
            success: false,
            blockedPlan: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
        return res.status(400).json({
            error: `Input too large for tier "${tier}". Reduce prompt/context size.`,
        });
    }

    let usageReserved = false;
    let usageFinalized = false;
    let executorAttempts = 0;
    let planValidationHadFailures = false;
    let overageReservation = { requestOverage: 0, inputOverageTokens: 0, outputOverageTokens: 0 };
    let overageFinalization = { requestOverage: 0, inputOverageTokens: 0, outputOverageTokens: 0 };
    let overageLedger = null;
    let suspiciousUsage = false;
    let queueWaitMs = 0;
    let plannerInputTokens = 0;
    let plannerOutputTokens = 0;
    let plannerDurationMs = 0;
    let executorInputTokens = 0;
    let executorOutputTokens = 0;
    let executorDurationMs = 0;
    let executorActionCount = 0;

    try {
        overageReservation = await reserveUsage({
            userKey: usageKey,
            estimatedInputTokens,
            tierPolicy,
        });
        queueWaitMs = Date.now() - contextPreparationStartedAtMs;
        setQueueDepth({ depth: (await getUsageSnapshot(usageKey)).inFlight });
        usageReserved = true;
    } catch (usageError) {
        const concurrencyRejected = /concurrency limit reached/i.test(String(usageError?.message || ''));
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'api',
            signal: 'usage_quota_rejected',
            severity: 'medium',
            metadata: { tier },
        });
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: true,
            concurrencyRejected,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs: Date.now() - contextPreparationStartedAtMs,
        });
        recordAiRequestEnd({
            success: false,
            queueRejected: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
        return res.status(429).json({ error: usageError.message });
    }

    try {
        const plannerSystemPrompt = `You are a Minecraft structure planner.
Output JSON only with keys:
{
  "intent": string,
  "constraints": { "maxBlocks": number, "allowCommandBlocks": boolean, "notes": string[] },
  "materials": string[],
  "phases": string[],
  "targetStyleTags": string[]
}
Keep concise and executable.
${canaryVariantEnabled ? 'Prefer explicit movement risk notes and compact deterministic phases.' : ''}`;
        const plannerUserPayload = JSON.stringify({
            tier,
            prompt: message,
            context: contextSnapshot,
        });
        const plannerRequestStartedAtMs = Date.now();
        const plannerCompletion = await createCompletionWithFallback({
            primaryModel: modelRoute.plannerModel,
            fallbackModel: modelRoute.fallbackModel,
            messages: [
                {
                    role: 'system',
                    content: plannerSystemPrompt,
                },
                {
                    role: 'user',
                    content: plannerUserPayload,
                },
            ],
            maxTokens: Math.min(900, tierPolicy.maxOutputTokensPerRequest),
        });
        plannerDurationMs = Date.now() - plannerRequestStartedAtMs;
        plannerInputTokens = estimateTokenCountFromText(plannerSystemPrompt) + estimateTokenCountFromText(plannerUserPayload);
        plannerOutputTokens = estimateTokenCountFromText(plannerCompletion.text);

        const maxExecutorAttempts = (
            contextDiagnostics.triggerReason === 'pathfinding_failure' ||
            contextDiagnostics.triggerReason === 'build_failure'
        )
            ? 3
            : 2;
        const executorSystemPrompt = `You are a Minecraft building assistant.
Generate ONLY raw JSON in this shape:
{
  "actions": [
    { "type": "move_to", "x": 0, "y": 64, "z": 0 },
    { "type": "place_block", "x": 0, "y": 0, "z": 0, "block": "minecraft:oak_planks" }
  ],
  "tags": ["house", "wood"]
}
Rules:
- Relative coordinates only.
- Keep movement minimal and avoid micro-step loops.
- Prefer placement actions; movement should be coarse navigation only.
- No markdown or explanations.
- No illegal blocks.
- Do not exceed tier constraints in planner notes.
${canaryVariantEnabled ? '- Add one explicit high-level safety tag in `tags`.' : ''}`;

        let finalPlan = null;
        let finalValidation = null;
        let executorCompletion = null;

        for (let attempt = 1; attempt <= maxExecutorAttempts; attempt += 1) {
            executorAttempts = attempt;
            const executorUserPayload = JSON.stringify({
                prompt: message,
                tier,
                context: contextSnapshot,
                plan: plannerCompletion.text,
                previousValidationError: finalValidation?.errors?.[0]?.message || null,
                attempt,
                maxExecutorAttempts,
            });
            const executorRequestStartedAtMs = Date.now();
            executorCompletion = await createCompletionWithFallback({
                primaryModel: modelRoute.executorModel,
                fallbackModel: modelRoute.fallbackModel,
                messages: [
                    {
                        role: 'system',
                        content: executorSystemPrompt,
                    },
                    {
                        role: 'user',
                        content: executorUserPayload,
                    },
                ],
                maxTokens: tierPolicy.maxOutputTokensPerRequest,
            });
            executorDurationMs += Date.now() - executorRequestStartedAtMs;
            executorInputTokens += estimateTokenCountFromText(executorSystemPrompt) + estimateTokenCountFromText(executorUserPayload);
            executorOutputTokens += estimateTokenCountFromText(executorCompletion.text);

            try {
                const result = parseAndValidateExecutorPlan({
                    rawExecutorText: executorCompletion.text,
                    tier,
                    tierFeaturePolicy,
                });

                finalValidation = result.validation;

                if (finalValidation.valid) {
                    finalPlan = result.normalizedPlan;
                    break;
                }

                planValidationHadFailures = true;
                recordBlockedPlacement({
                    count: Math.max(1, finalValidation.errors?.length || 1),
                });
                recordAbuseSignal({
                    userKey: usageKey,
                    channel: 'build',
                    signal: 'plan_validation_failed',
                    severity: 'medium',
                    metadata: {
                        tier,
                        errorCount: finalValidation.errors?.length || 0,
                    },
                });
                for (const auditEvent of finalValidation.audits) {
                    recordSecurityAuditEvent({
                        type: auditEvent.type,
                        severity: auditEvent.severity === 'error' ? 'error' : 'warning',
                        userKey: usageKey,
                        tier,
                        message: auditEvent.message,
                        context: auditEvent.context,
                    });
                }

                if (attempt < maxExecutorAttempts) {
                    await sleep(120 * attempt);
                }
            } catch (parseError) {
                planValidationHadFailures = true;
                recordAbuseSignal({
                    userKey: usageKey,
                    channel: 'build',
                    signal: 'executor_json_parse_failed',
                    severity: 'medium',
                    metadata: { tier },
                });
                if (attempt < maxExecutorAttempts) {
                    await sleep(120 * attempt);
                    continue;
                }
                throw parseError;
            }
        }

        let fallbackPlanUsed = false;
        if (!finalPlan) {
            const fallbackPlan = buildFallbackPlan(message);
            const fallbackValidation = validateInstructionPlan({
                planPayload: fallbackPlan,
                tier,
                tierFeaturePolicy,
            });

            if (!fallbackValidation.valid) {
                throw new Error(fallbackValidation.errors[0]?.message || 'Failed to build a valid instruction plan.');
            }

            finalPlan = fallbackPlan;
            finalValidation = fallbackValidation;
            fallbackPlanUsed = true;
        }
        executorActionCount = Array.isArray(finalPlan?.actions) ? finalPlan.actions.length : 0;

        const legacyBlocksAndTags = toLegacyBlocksAndTags(finalPlan);
        const normalizedBlocksAndTags = JSON.stringify(legacyBlocksAndTags);
        const estimatedOutputTokens = estimateTokenCountFromText(normalizedBlocksAndTags);

        try {
            overageFinalization = await finalizeUsage({
                userKey: usageKey,
                estimatedOutputTokens,
                tierPolicy,
            });
            usageFinalized = true;
            setQueueDepth({ depth: (await getUsageSnapshot(usageKey)).inFlight });
        } catch (usageError) {
            recordAbuseSignal({
                userKey: usageKey,
                channel: 'api',
                signal: 'usage_output_rejected',
                severity: 'medium',
                metadata: { tier },
            });
            await recordPreScaleRequestFailure({
                userKey: usageKey,
                tier,
                capHit: true,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs,
            });
            recordAiRequestEnd({
                success: false,
                queueRejected: true,
                latencyMs: Date.now() - requestStartedAtMs,
                retried: Math.max(0, executorAttempts - 1),
                blockedPlan: planValidationHadFailures,
            });
            setQueueDepth({ depth: (await getUsageSnapshot(usageKey)).inFlight });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
            return res.status(429).json({ error: usageError.message });
        }

        const totalOverageInputTokens = overageReservation.inputOverageTokens + overageFinalization.inputOverageTokens;
        const totalOverageOutputTokens = overageReservation.outputOverageTokens + overageFinalization.outputOverageTokens;
        const totalOverageRequests = overageReservation.requestOverage + overageFinalization.requestOverage;
        if (supportsMeteredOverage(tierPolicy) && (
            totalOverageInputTokens > 0 ||
            totalOverageOutputTokens > 0 ||
            totalOverageRequests > 0
        )) {
            overageLedger = recordOverageUsage({
                userKey: usageKey,
                tier,
                inputOverageTokens: totalOverageInputTokens,
                outputOverageTokens: totalOverageOutputTokens,
                overageRequests: totalOverageRequests,
            });
            suspiciousUsage = totalOverageInputTokens + totalOverageOutputTokens >= 200000;
            recordAbuseSignal({
                userKey: usageKey,
                channel: 'api',
                signal: 'metered_overage_usage',
                severity: suspiciousUsage ? 'high' : 'medium',
                metadata: {
                    tier,
                    totalOverageInputTokens,
                    totalOverageOutputTokens,
                    totalOverageRequests,
                },
            });
        }

        const metering = await recordUsageMetering({
            userKey: usageKey,
            tier,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
        });
        const estimatedTokenBurnUsd = (
            (estimatedInputTokens * 0.30) +
            (estimatedOutputTokens * 0.60)
        ) / 1_000_000;
        recordTokenBurn({ usd: estimatedTokenBurnUsd });
        const overageCostUsd = ((totalOverageInputTokens + totalOverageOutputTokens) / 1000) * getOverageRateUsdPer1k(tier);
        const infraCostUsd = INFRA_COST_PER_REQUEST_USD[tier] || 0;
        const totalCostUsd = estimatedTokenBurnUsd + infraCostUsd + overageCostUsd;
        const buildId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const contextInjectionTokens = estimateTokenCountFromText(JSON.stringify(contextSnapshot || {}));
        const contextBaselineTokens = estimateTokenCountFromText(JSON.stringify(contextForSnapshot || {}));
        await recordBuildCostSnapshot({
            buildId,
            month: metering.month,
            userKey: usageKey,
            tier,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
            plannerInputTokens,
            plannerOutputTokens,
            executorInputTokens,
            executorOutputTokens,
            apiCostUsd: estimatedTokenBurnUsd,
            infraCostUsd,
            overageCostUsd,
        });
        await recordPreScaleBuildSuccess({
            userKey: usageKey,
            tier,
            month: metering.month,
            plannerInputTokens,
            plannerOutputTokens,
            executorInputTokens,
            executorOutputTokens,
            contextInjectionTokens,
            contextBaselineTokens,
            snapshotMode: contextDiagnostics.snapshotMode,
            overageUsed: totalOverageInputTokens + totalOverageOutputTokens + totalOverageRequests > 0,
            totalCostUsd,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs,
            plannerModel: plannerCompletion.modelUsed,
            plannerDurationMs,
            executorActions: executorActionCount,
            executorDurationMs,
        });
        if (req.auth?.payload?.sub) {
            await recordFeatureUsageSignal({
                userId: req.auth.payload.sub,
                tier,
                feature: 'build_generation',
            });
        }

        const marginAlerts = await evaluateBreakEvenAlerts({ month: metering.month });
        const schematic = includeSchematic === true
            ? exportInstructionPlanToSchematic({
                name: `${tier}-build-${Date.now()}`,
                plan: finalPlan,
            })
            : null;

        recordAiRequestEnd({
            success: true,
            retried: Math.max(0, executorAttempts - 1),
            latencyMs: Date.now() - requestStartedAtMs,
            blockedPlan: planValidationHadFailures,
            suspiciousUsage,
        });
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });

        return res.json({
            blocksAndTags: normalizedBlocksAndTags,
            instructionPlan: finalPlan,
            ...(schematic ? { schematic } : {}),
            meta: {
                tier,
                modelRoute: {
                    planner: plannerCompletion.modelUsed,
                    executor: executorCompletion.modelUsed,
                    inferencePool: modelRoute.inferencePool,
                },
                fallbackUsed: plannerCompletion.fallbackUsed || executorCompletion.fallbackUsed,
                fallbackPlanUsed,
                canaryVariantEnabled,
                executorAttempts,
                estimatedInputTokens,
                estimatedOutputTokens,
                buildId,
                tokenSplit: {
                    plannerInputTokens,
                    plannerOutputTokens,
                    executorInputTokens,
                    executorOutputTokens,
                },
                usage: await getUsageSnapshot(usageKey),
                buildUsage: getBuildUsageSnapshot(usageKey),
                metering,
                overage: overageLedger,
                validation: {
                    stats: finalValidation.stats,
                    warnings: finalValidation.warnings,
                },
                marginAlertsTriggered: marginAlerts.triggered.length,
                contextDiagnostics,
                emergencyGuard: {
                    active: emergencyGuardState.active,
                    reason: emergencyGuardState.reason,
                    reasonCodes: emergencyGuardState.reasonCodes,
                    source: emergencyGuardState.source,
                    throttleFreeTier: emergencyGuardState.throttleFreeTier,
                    forceThinSnapshots: emergencyGuardState.forceThinSnapshots,
                    lastEvaluatedAt: emergencyGuardState.lastEvaluatedAt,
                },
            },
        });
    } catch (err) {
        if (usageReserved && !usageFinalized) {
            await releaseInFlightSlot(usageKey);
            setQueueDepth({ depth: (await getUsageSnapshot(usageKey)).inFlight });
        }
        await recordPreScaleRequestFailure({
            userKey: usageKey,
            tier,
            capHit: false,
            concurrencyRejected: false,
            latencyMs: Date.now() - requestStartedAtMs,
            queueWaitMs,
        });
        recordBuildFailure({ userKey: usageKey });
        recordCrash();
        recordAbuseSignal({
            userKey: usageKey,
            channel: 'api',
            signal: 'ai_request_failed',
            severity: 'high',
            metadata: { tier },
        });
        recordAiRequestEnd({
            success: false,
            retried: Math.max(0, executorAttempts - 1),
            latencyMs: Date.now() - requestStartedAtMs,
            blockedPlan: planValidationHadFailures,
            suspiciousUsage,
        });
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
        logger.error(`Failed to generate structure for tier ${tier}. ${(err && err.stack) || err}`, {
            tier,
            usageKey,
            estimatedInputTokens,
            contextDiagnostics,
            executorAttempts,
            planValidationHadFailures,
        });
        return res.status(500).json({ error: 'Failed to generate structure. Please try again.' });
    }
}));

/**
 * Lock all admin routes with JWT auth + admin authorization.
 */
app.use('/admin', jwtCheck, requireAdminAccess);

/**
 * Return per-tier usage metering rows for a month.
 * Query params:
 * - month (optional): `YYYY-MM`, defaults to current UTC month.
 */
app.get('/admin/usage-metering', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const rows = await getUsageMeteringRows({ month });
    const resolvedMonth = rows[0]?.month || month || null;
    return res.json({ month: resolvedMonth, rows });
}));

/**
 * Return monthly margin report grouped by tier.
 * Query params:
 * - month (optional): `YYYY-MM`, defaults to current UTC month.
 * - thresholdPercent (optional): break-even alert threshold.
 */
app.get('/admin/margin-report', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const thresholdPercent = Number(req.query.thresholdPercent);

    const report = await getMonthlyMarginReport({
        month,
        thresholdPercent: Number.isFinite(thresholdPercent) ? thresholdPercent : undefined,
    });

    return res.json(report);
}));

/**
 * Return stored break-even alerts for a month.
 * Query params:
 * - month (optional): `YYYY-MM`, defaults to current UTC month.
 */
app.get('/admin/margin-alerts', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    return res.json(getBreakEvenAlerts({ month }));
}));

/**
 * Return pre-scale economics and usage telemetry dashboard.
 */
app.get('/admin/pre-scale-telemetry', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const marginRows = await getUsageMeteringRows({ month });
    const marginByTier = Object.fromEntries(
        marginRows.map((row) => [row.tier, { revenue: row.revenue, totalCost: row.totalCost }]),
    );
    const [dashboard, emergencyGuard] = await Promise.all([
        getPreScaleTelemetryDashboard({
            month,
            marginByTier,
        }),
        evaluateCurrentEmergencyMarginGuard(),
    ]);

    return res.json({
        ...dashboard,
        guard_state_effective: {
            active: emergencyGuard.state.active,
            source: emergencyGuard.state.source,
            reason: emergencyGuard.state.reason,
            reasonCodes: emergencyGuard.state.reasonCodes,
            throttleFreeTier: emergencyGuard.state.throttleFreeTier,
            forceThinSnapshots: emergencyGuard.state.forceThinSnapshots,
            cooldownUntil: emergencyGuard.state.cooldownUntil,
            recoveryStreak: emergencyGuard.state.recoveryStreak,
            lastEvaluatedAt: emergencyGuard.state.lastEvaluatedAt,
        },
    });
}));

/**
 * Return latency and performance profile metrics for pre-scale readiness.
 */
app.get('/admin/performance-profile', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    return res.json(await getPreScalePerformanceProfile({ month }));
}));

/**
 * Return tracked per-build cost snapshots.
 */
app.get('/admin/build-costs', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;
    const limit = Number(req.query.limit);
    return res.json({
        month: month || null,
        rows: getBuildCostSnapshots({
            month,
            tier,
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Return conversion funnel and upgrade instrumentation summary.
 */
app.get('/admin/conversion-funnel', asyncHandler(async (req, res) => {
    const days = Number(req.query.days);
    return res.json(getConversionFunnelReport({
        days: Number.isFinite(days) ? days : undefined,
    }));
}));

/**
 * Execute a synthetic stress/abuse simulation suite.
 */
app.post('/admin/pre-scale/simulate', asyncHandler(async (req, res) => {
    const {
        seed,
        concurrentUsers,
        requestsPerUser,
        tiers,
    } = req.body || {};
    const emergencyGuard = await evaluateCurrentEmergencyMarginGuard();

    return res.json(runPreScaleSimulation({
        seed,
        concurrentUsers,
        requestsPerUser,
        tiers,
        guardState: emergencyGuard.state,
    }));
}));

/**
 * Return recent synthetic stress/abuse simulation runs.
 */
app.get('/admin/pre-scale/simulations', asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit);
    return res.json({
        runs: getPreScaleSimulationRuns({
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Persist existing in-memory economics/telemetry rows to persistent storage.
 */
app.post('/admin/pre-scale/migrate-inmemory', asyncHandler(async (req, res) => {
    const usageRows = await migrateInMemoryUsageBucketsToPersistentStore();
    const marginRows = await migrateInMemoryUsageMeteringToPersistentStore();
    const telemetryRows = await migrateInMemoryPreScaleTelemetryToPersistentStore();

    return res.json({
        migrated: {
            usageRows,
            marginRows,
            telemetryRows,
        },
    });
}));

/**
 * Return monolithic operations dashboard metrics.
 */
app.get('/admin/ops-dashboard', asyncHandler(async (req, res) => {
    return res.json(getOpsDashboardSnapshot());
}));

/**
 * Return current emergency margin guard state.
 */
app.get('/admin/emergency-guard', asyncHandler(async (req, res) => {
    const evaluation = await evaluateCurrentEmergencyMarginGuard({ force: true });
    return res.json(evaluation);
}));

/**
 * Set, clear, or time-box emergency margin guard manual override.
 */
app.post('/admin/emergency-guard/override', asyncHandler(async (req, res) => {
    const {
        mode,
        reason,
        actor,
        durationMinutes,
        confirmationCode,
    } = req.body || {};
    const adminUserId = req.auth?.payload?.sub || null;
    const resolvedActor = typeof actor === 'string' && actor.trim().length > 0
        ? actor.trim()
        : adminUserId;

    if (mode === 'force_off' && confirmationCode !== EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE) {
        return res.status(400).json({
            error: `force_off requires explicit confirmationCode="${EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE}".`,
        });
    }

    try {
        const nextState = await setEmergencyMarginGuardManualOverride({
            mode,
            reason,
            actor: resolvedActor,
            durationMinutes,
        });
        recordSecurityAuditEvent({
            type: 'emergency_guard_override',
            severity: mode === 'force_off' ? 'warning' : 'info',
            userKey: adminUserId || 'admin:unknown',
            tier: 'admin',
            message: `Emergency guard override ${String(mode || 'unknown')} by ${resolvedActor || 'unknown-admin'}.`,
            context: {
                mode,
                reason: typeof reason === 'string' ? reason : null,
                durationMinutes: Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : null,
                expiresAt: nextState.manualOverride?.expiresAt || null,
                confirmationCodeAccepted: mode === 'force_off',
            },
        });
    } catch (error) {
        return res.status(400).json({
            error: error.message || 'Invalid emergency guard override request.',
        });
    }

    const evaluation = await evaluateCurrentEmergencyMarginGuard({ force: true });
    return res.json(evaluation);
}));

/**
 * Return operations alerts derived from request/failure metrics.
 */
app.get('/admin/ops-alerts', asyncHandler(async (req, res) => {
    const evaluation = evaluateOpsAlerts();
    const emergencyGuard = await evaluateCurrentEmergencyMarginGuard();
    const alerts = [...evaluation.alerts];

    if (emergencyGuard.state.active) {
        alerts.push({
            level: 'error',
            code: 'emergency_margin_guard_active',
            message: emergencyGuard.state.reason || 'Emergency margin guard is active.',
            value: getEmergencyGuardAlertValue(emergencyGuard.state),
        });
    }

    const incidents = evaluateIncidentNotifications({ alerts });
    return res.json({
        ...evaluation,
        alerts,
        incidents,
        emergencyGuard,
    });
}));

/**
 * Return security audit trail events.
 * Query params:
 * - type (optional)
 * - severity (optional): info|warning|error
 * - limit (optional): 1-500
 */
app.get('/admin/security-audits', asyncHandler(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const limit = Number(req.query.limit);

    return res.json({
        events: getSecurityAuditEvents({
            type,
            severity: severity === 'info' || severity === 'warning' || severity === 'error'
                ? severity
                : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Return campaign attribution events for growth analytics.
 */
app.get('/admin/analytics/attribution', asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit);
    return res.json({
        events: getAttributionEvents({
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Return referral redemption events for admin analytics.
 */
app.get('/admin/analytics/referrals', asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit);
    return res.json({
        events: getReferralEvents({
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
    });
}));

/**
 * Return overage billing report.
 */
app.get('/admin/overage-report', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    return res.json({
        month: month || null,
        rows: getOverageReport({ month }),
    });
}));

/**
 * Return abuse analytics summary for chat/build/api patterns.
 */
app.get('/admin/abuse-analytics', asyncHandler(async (req, res) => {
    const hours = Number(req.query.hours);
    const limit = Number(req.query.limit);
    return res.json(getAbuseAnalytics({
        hours: Number.isFinite(hours) ? hours : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
    }));
}));

/**
 * Record an evaluation harness run for regression tracking.
 */
app.post('/admin/evaluation/run', asyncHandler(async (req, res) => {
    const {
        suite,
        modelVariant,
        qualityScore,
        latencyScore,
        safetyScore,
        notes,
    } = req.body || {};

    try {
        const run = recordEvaluationRun({
            suite,
            modelVariant,
            qualityScore,
            latencyScore,
            safetyScore,
            notes,
        });
        return res.status(201).json({ run });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to record evaluation run.' });
    }
}));

/**
 * Return evaluation harness report and regression summary.
 */
app.get('/admin/evaluation', asyncHandler(async (req, res) => {
    const suite = typeof req.query.suite === 'string' ? req.query.suite : undefined;
    const limit = Number(req.query.limit);
    return res.json(getEvaluationReport({
        suite,
        limit: Number.isFinite(limit) ? limit : undefined,
    }));
}));

/**
 * Return tracked incidents and associated playbooks.
 */
app.get('/admin/incidents', asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Number(req.query.limit);
    return res.json({
        incidents: getIncidents({
            status: status === 'active' || status === 'resolved' ? status : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
        }),
        playbooks: getIncidentPlaybooks(),
    });
}));

/**
 * Resolve a tracked incident by id.
 */
app.post('/admin/incidents/:incidentId/resolve', asyncHandler(async (req, res) => {
    const incidentId = req.params.incidentId;
    const resolved = resolveIncident({ incidentId });
    if (!resolved) {
        return res.status(404).json({ error: 'Incident not found.' });
    }
    return res.json({ incident: resolved });
}));

/**
 * Return currently enabled UI localization targets.
 */
app.get('/config/localization', asyncHandler(async (req, res) => {
    return res.json({
        supportedLocales: ['en', 'es', 'pt', 'fr'],
        defaultLocale: 'en',
    });
}));

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
