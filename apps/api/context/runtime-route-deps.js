import Stripe from 'stripe';
import { OpenAI } from 'openai';

import jwtCheck from '../middleware/auth0-jwt-check.js';
import { createRequireAdminAccess } from '../middleware/require-admin-access.js';

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
 * Build runtime (provider/middleware/factory) route dependencies.
 * @param {{ staticRouteDeps: Record<string, any> }} params
 */
export function createRuntimeRouteDeps({ staticRouteDeps }) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2024-04-10',
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        getUserById: staticRouteDeps.getUserById,
        resolveTier: staticRouteDeps.resolveTier,
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
            FREE_TIER_THROTTLE_ERROR_CODE,
            INFRA_COST_PER_REQUEST_USD,
        },
    };
}
