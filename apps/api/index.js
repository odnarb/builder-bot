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
    updateUsersBuild,
    updateUsersSession,
    updateUserTier
} from './core/firestore/users.js';
import { Timestamp } from '@google-cloud/firestore';
import {
    getTierAiPolicy,
    getTierFeaturePolicy,
    getTierModelRoute,
    isInCanaryRollout,
    resolveTier,
} from './config/tier-policy.js';
import {
    buildContextSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    prepareContextForSnapshot,
} from './utils/ai-context.js';
import {
    finalizeUsage,
    getUsageSnapshot,
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
    getBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    recordUsageMetering,
} from './utils/margin-metering.js';
import {
    getSecurityAuditEvents,
    recordSecurityAuditEvent,
} from './utils/security-audit.js';
import {
    evaluateOpsAlerts,
    getOpsDashboardSnapshot,
    recordAiRequestEnd,
    recordAiRequestStart,
} from './utils/ops-metrics.js';
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
    linkCommunityAccount,
    recordAttributionEvent,
    recordBuildReaction,
    savePhrasePack,
    setParentalControls,
} from './utils/platform-features.js';
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
    const { email, name, auth0LoginId, picture } = req.body

    try {
        const user = {
            email,
            name,
            auth0LoginId,
            picture, tier: 'pending',
            createdAt: Timestamp.now()
        }

        await createUser({ user });

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

        if (!['free', 'starter', 'pro', 'admin'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier selected' });
        }

        await updateUserTier({ userId, tier });

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
            createdAt: Timestamp.now()
        }
        const docRef = await createUsersBuild({ userId, build: newBuild });

        //add the log entry
        const log = {
            type: "creating_build",
            data: {
                buildId: docRef.id,
                ...build
            },
            timestamp: Timestamp.now()
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
            timestamp: Timestamp.now()
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
            timestamp: Timestamp.now()
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
            timestamp: Timestamp.now()
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

    if (!userId || !buildId) {
        return res.status(400).json({ error: 'userId and buildId are required' });
    }

    try {
        const result = recordBuildReaction({ userId, buildId, reaction });
        return res.json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to record reaction.' });
    }
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
    const { type, reason } = req.body || {};

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        const ticket = createSubscriptionTicket({ userId, type, reason });
        return res.status(201).json({ ticket });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create ticket.' });
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
        createdAt: Timestamp.now()
    }

    try {
        await createUsersSession({ userId, sessionId, sessionStart });

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
        updatedAt: Timestamp.now()
    }

    try {
        await updateUsersSession({ userId, sessionId, session: sessionWithTimestamp });

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

    const logWithTime = { ...log, timestamp: Timestamp.now() };

    try {
        await addLogEntryToUsersSession({ userId, sessionId, log: logWithTime });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(`❌ Failed to add log entry for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
}));

app.post('/stripe/create-checkout-session', asyncHandler(async (req, res) => {
    const CHECKOUT_URL = process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173';

    // Map tier → Stripe product
    const productMap = {
        starter: process.env.STRIPE_PRODUCT_ID_STARTER_TIER,
        pro: process.env.STRIPE_PRODUCT_ID_PRO_TIER,
        admin: process.env.STRIPE_PRODUCT_ID_ADMIN_TIER
    };

    const { username, tier } = req.body;

    if (!productMap[tier]) {
        return res.status(400).json({ error: 'Invalid tier selection' });
    }

    try {
        const products = await stripe.products.list({ limit: 100 });
        const product = products.data.find(p => p.id === productMap[tier]);
        const price = product?.default_price;

        if (!price) throw new Error('No price attached to product');

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price, quantity: 1 }],
            success_url: `${CHECKOUT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${CHECKOUT_URL}/checkout/cancel`,
            metadata: { username, tier }
        });

        return res.json({ url: session.url });
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

    const customerEmail = session.customer_email;
    const productId = session.subscription.plan.product;

    // Map Stripe price IDs to tiers
    const tier = {
        [process.env.STRIPE_PRODUCT_ID_STARTER_TIER]: 'starter',
        [process.env.STRIPE_PRODUCT_ID_PRO_TIER]: 'pro',
        [process.env.STRIPE_PRODUCT_ID_ADMIN_TIER]: 'admin',
    }[productId] || 'free';

    console.log(`Updating user tier customerEmail: `, customerEmail)
    console.log(`Updating user tier: `, req.auth.payload.sub)
    console.log(`Updating user tier: `, tier)

    const user = await getUserById({ userId: req.auth.payload.sub });

    await updateUserTier({ userId: user.id, tier });

    res.json({ status: 'success', tier });
}))

app.post('/ai-get-structure', asyncHandler(async (req, res) => {
    const requestStartedAtMs = Date.now();
    const { message, tier: rawTier, context = {}, includeSchematic = false } = req.body || {};

    if (typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' });
    }

    const moderationViolation = detectModerationViolation(message);
    const tier = resolveTier(rawTier);
    const tierPolicy = getTierAiPolicy(tier);
    const tierFeaturePolicy = getTierFeaturePolicy(tier);
    const modelRoute = getTierModelRoute(tier);
    const usageKey = resolveAiUsageKey(req, tier);
    const canaryVariantEnabled = isInCanaryRollout({ usageKey });

    if (!tierFeaturePolicy.allowBuilds) {
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
        return res.status(400).json({
            error: 'Prompt could not be processed due to safety policy.',
        });
    }

    recordAiRequestStart();
    try {
        reserveBuildQuota({
            userKey: usageKey,
            tierFeaturePolicy,
        });
    } catch (quotaError) {
        recordAiRequestEnd({
            success: false,
            queueRejected: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        return res.status(429).json({ error: quotaError.message });
    }

    const {
        contextForSnapshot,
        diagnostics: contextDiagnostics,
    } = prepareContextForSnapshot({
        usageKey,
        context,
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
        recordAiRequestEnd({
            success: false,
            blockedPlan: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        return res.status(400).json({
            error: `Input too large for tier "${tier}". Reduce prompt/context size.`,
        });
    }

    let usageReserved = false;
    let usageFinalized = false;
    let executorAttempts = 0;
    let planValidationHadFailures = false;

    try {
        reserveUsage({
            userKey: usageKey,
            estimatedInputTokens,
            tierPolicy,
        });
        usageReserved = true;
    } catch (usageError) {
        recordAiRequestEnd({
            success: false,
            queueRejected: true,
            latencyMs: Date.now() - requestStartedAtMs,
        });
        return res.status(429).json({ error: usageError.message });
    }

    try {
        const plannerCompletion = await createCompletionWithFallback({
            primaryModel: modelRoute.plannerModel,
            fallbackModel: modelRoute.fallbackModel,
            messages: [
                {
                    role: 'system',
                    content: `You are a Minecraft structure planner.
Output JSON only with keys:
{
  "intent": string,
  "constraints": { "maxBlocks": number, "allowCommandBlocks": boolean, "notes": string[] },
  "materials": string[],
  "phases": string[],
  "targetStyleTags": string[]
}
Keep concise and executable.
${canaryVariantEnabled ? 'Prefer explicit movement risk notes and compact deterministic phases.' : ''}`,
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        tier,
                        prompt: message,
                        context: contextSnapshot,
                    }),
                },
            ],
            maxTokens: Math.min(900, tierPolicy.maxOutputTokensPerRequest),
        });

        const maxExecutorAttempts = (
            contextDiagnostics.triggerReason === 'pathfinding_failure' ||
            contextDiagnostics.triggerReason === 'build_failure'
        )
            ? 3
            : 2;

        let finalPlan = null;
        let finalValidation = null;
        let executorCompletion = null;

        for (let attempt = 1; attempt <= maxExecutorAttempts; attempt += 1) {
            executorAttempts = attempt;
            executorCompletion = await createCompletionWithFallback({
                primaryModel: modelRoute.executorModel,
                fallbackModel: modelRoute.fallbackModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a Minecraft building assistant.
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
${canaryVariantEnabled ? '- Add one explicit high-level safety tag in `tags`.' : ''}`,
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            prompt: message,
                            tier,
                            context: contextSnapshot,
                            plan: plannerCompletion.text,
                            previousValidationError: finalValidation?.errors?.[0]?.message || null,
                            attempt,
                            maxExecutorAttempts,
                        }),
                    },
                ],
                maxTokens: tierPolicy.maxOutputTokensPerRequest,
            });

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

        const legacyBlocksAndTags = toLegacyBlocksAndTags(finalPlan);
        const normalizedBlocksAndTags = JSON.stringify(legacyBlocksAndTags);
        const estimatedOutputTokens = estimateTokenCountFromText(normalizedBlocksAndTags);

        try {
            finalizeUsage({
                userKey: usageKey,
                estimatedOutputTokens,
                tierPolicy,
            });
            usageFinalized = true;
        } catch (usageError) {
            recordAiRequestEnd({
                success: false,
                queueRejected: true,
                latencyMs: Date.now() - requestStartedAtMs,
                retried: Math.max(0, executorAttempts - 1),
                blockedPlan: planValidationHadFailures,
            });
            return res.status(429).json({ error: usageError.message });
        }

        const metering = recordUsageMetering({
            userKey: usageKey,
            tier,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
        });

        const marginAlerts = evaluateBreakEvenAlerts({ month: metering.month });
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
        });

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
                usage: getUsageSnapshot(usageKey),
                buildUsage: getBuildUsageSnapshot(usageKey),
                metering,
                validation: {
                    stats: finalValidation.stats,
                    warnings: finalValidation.warnings,
                },
                marginAlertsTriggered: marginAlerts.triggered.length,
                contextDiagnostics,
            },
        });
    } catch (err) {
        if (usageReserved && !usageFinalized) {
            releaseInFlightSlot(usageKey);
        }
        recordBuildFailure({ userKey: usageKey });
        recordAiRequestEnd({
            success: false,
            retried: Math.max(0, executorAttempts - 1),
            latencyMs: Date.now() - requestStartedAtMs,
            blockedPlan: planValidationHadFailures,
        });
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
 * Return per-tier usage metering rows for a month.
 * Query params:
 * - month (optional): `YYYY-MM`, defaults to current UTC month.
 */
app.get('/admin/usage-metering', asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const rows = getUsageMeteringRows({ month });
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

    const report = getMonthlyMarginReport({
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
 * Return monolithic operations dashboard metrics.
 */
app.get('/admin/ops-dashboard', asyncHandler(async (req, res) => {
    return res.json(getOpsDashboardSnapshot());
}));

/**
 * Return operations alerts derived from request/failure metrics.
 */
app.get('/admin/ops-alerts', asyncHandler(async (req, res) => {
    return res.json(evaluateOpsAlerts());
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
    console.error('💥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };
