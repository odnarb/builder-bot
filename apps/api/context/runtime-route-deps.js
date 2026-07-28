import Stripe from 'stripe';
import { OpenAI } from 'openai';

import { createRequireAdminAccess } from '../middleware/require-admin-access.js';
import { createRequireActiveSubscription } from '../middleware/require-active-subscription.js';
import { createRuntimeJwtCheck } from '../middleware/runtime-jwt-check.js';
import { createLocalModeRouteDeps } from './local-mode-route-deps.js';

import {
    createAiRuntimeHelpers,
    FREE_TIER_THROTTLE_ERROR_CODE,
    INFRA_COST_PER_REQUEST_USD,
} from '../core/logic/ai-runtime-helpers.js';
import { createEmergencyGuardRuntime } from '../core/logic/emergency-guard-runtime.js';
import { parsePrompt } from '../packages/prompt-parser/index.js';
import {
    normalizeInstructionPlan,
    optimizeInstructionPlan,
} from '../shared-utils/instruction-schema.js';
import { getRuntimeModeConfig } from '../core/platform/runtime-mode.js';

/**
 * Resolve a stable per-user usage key for monthly token budgeting.
 * Falls back to anonymous keys when auth is not present.
 * Never trusts caller-supplied identity headers.
 * @param {import('express').Request} req
 * @param {'free' | 'starter' | 'pro' | 'admin'} tier
 * @returns {string}
 */
function resolveAiUsageKey(req, tier) {
    const authUserId = req.auth?.payload?.sub;
    if (authUserId) {
        return `auth:${authUserId}`;
    }

    return `anon:${tier}:${req.ip || 'unknown-ip'}`;
}

/**
 * Build runtime (provider/middleware/factory) route dependencies.
 * @param {{ staticRouteDeps: Record<string, any> }} params
 * @returns {{
 *   jwtCheck: Function,
 *   requireAdminAccess: Function,
 *   asyncHandler: Function,
 *   runtimeRouteDeps: Record<string, any>,
 * }} Runtime dependencies used to compose the API.
 * @throws {Error} When runtime configuration, local storage, or an enabled provider cannot initialize.
 */
export function createRuntimeRouteDeps({ staticRouteDeps }) {
    const runtimeModeConfig = getRuntimeModeConfig();
    const jwtCheck = createRuntimeJwtCheck({ runtimeModeConfig });
    const localModeRouteDeps = createLocalModeRouteDeps({
        runtimeModeConfig,
        logger: staticRouteDeps.logger,
    });
    const userDeps = {
        getUserById: localModeRouteDeps.getUserById || staticRouteDeps.getUserById,
        getUserByEmail: localModeRouteDeps.getUserByEmail || staticRouteDeps.getUserByEmail,
        createUser: localModeRouteDeps.createUser || staticRouteDeps.createUser,
        updateUserTier: localModeRouteDeps.updateUserTier || staticRouteDeps.updateUserTier,
    };

    const stripe = runtimeModeConfig.billingEnabled
        ? new Stripe(process.env.STRIPE_SECRET_KEY, {
            apiVersion: '2024-04-10',
        })
        : null;
    const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
    const openai = openaiApiKey
        ? new OpenAI({ apiKey: openaiApiKey })
        : null;

    const asyncHandler = fn => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

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
        validateInstructionPlan: staticRouteDeps.validateInstructionPlan,
    });

    const {
        evaluateCurrentEmergencyMarginGuard,
        getEmergencyGuardAlertValue,
        resolveFreeTierThrottleRetryAfterSeconds,
    } = createEmergencyGuardRuntime({
        getMonthlyMarginReport: staticRouteDeps.getMonthlyMarginReport,
        getOpsDashboardSnapshot: staticRouteDeps.getOpsDashboardSnapshot,
        evaluateEmergencyMarginGuard: staticRouteDeps.evaluateEmergencyMarginGuard,
        getEmergencyMarginGuardState: staticRouteDeps.getEmergencyMarginGuardState,
        logger: staticRouteDeps.logger,
    });

    const {
        requireAdminAccess,
        invalidateAdminFallbackTierCache,
    } = createRequireAdminAccess({
        asyncHandler,
        getUserById: userDeps.getUserById,
        resolveTier: staticRouteDeps.resolveTier,
    });

    const requireActiveSubscription = createRequireActiveSubscription({
        asyncHandler,
        getUserById: userDeps.getUserById,
        resolveTier: staticRouteDeps.resolveTier,
        runtimeModeConfig,
        logger: staticRouteDeps.logger,
    });

    return {
        jwtCheck,
        requireAdminAccess,
        asyncHandler,
        runtimeRouteDeps: {
            stripe,
            jwtCheck,
            asyncHandler,
            resolveAiUsageKey,
            createCompletionWithFallback,
            sleep,
            buildFallbackPlan,
            parseAndValidateExecutorPlan,
            evaluateCurrentEmergencyMarginGuard,
            getEmergencyGuardAlertValue,
            resolveFreeTierThrottleRetryAfterSeconds,
            detectModerationViolation,
            invalidateAdminFallbackTierCache,
            requireAdminAccess,
            requireActiveSubscription,
            runtimeModeConfig,
            ...localModeRouteDeps,
            ...userDeps,
            FREE_TIER_THROTTLE_ERROR_CODE,
            INFRA_COST_PER_REQUEST_USD,
        },
    };
}
