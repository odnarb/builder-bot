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
    createAiRuntimeHelpers,
    FREE_TIER_THROTTLE_ERROR_CODE,
    INFRA_COST_PER_REQUEST_USD,
} from '../core/logic/ai-runtime-helpers.js';
import { createEmergencyGuardRuntime } from '../core/logic/emergency-guard-runtime.js';
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
import { createRequireAdminAccess } from './middleware/require-admin-access.js';

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

const EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE = 'DISABLE_GUARD_TEMPORARILY';
const {
    createCompletionWithFallback,
    sleep,
    buildFallbackPlan,
    parseAndValidateExecutorPlan,
    detectModerationViolation,
} = createAiRuntimeHelpers({
    openai,
    parsePrompt,
    normalizeInstructionPlan,
    optimizeInstructionPlan,
    validateInstructionPlan,
});

const {
    evaluateCurrentEmergencyMarginGuard,
    getEmergencyGuardAlertValue,
    resolveFreeTierThrottleRetryAfterSeconds,
} = createEmergencyGuardRuntime({
    getMonthlyMarginReport,
    getOpsDashboardSnapshot,
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    logger,
});

const {
    requireAdminAccess,
    invalidateAdminFallbackTierCache,
} = createRequireAdminAccess({
    asyncHandler,
    getUserById,
    resolveTier,
});

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
