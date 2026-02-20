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
    updateUsersBuild,
    updateUsersSession,
    updateUserTier
} from './core/firestore/users.js';
import { Timestamp } from '@google-cloud/firestore';
import {
    getTierAiPolicy,
    getTierModelRoute,
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
    evaluateBreakEvenAlerts,
    getBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    recordUsageMetering,
} from './utils/margin-metering.js';
import logger from './utils/logger.js';

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
 * Parse and validate the executor response payload.
 * @param {string} raw
 * @returns {{ blocks: Array<unknown>, tags: Array<unknown> }}
 * @throws {Error}
 */
function parseBlocksAndTags(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.blocks) || !Array.isArray(parsed.tags)) {
        throw new Error('Invalid AI response format');
    }

    return parsed;
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

        if (!['free', 'starter', 'pro'].includes(tier)) {
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
    const { message, tier: rawTier, context = {} } = req.body || {};

    if (typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' });
    }

    const tier = resolveTier(rawTier);
    const tierPolicy = getTierAiPolicy(tier);
    const modelRoute = getTierModelRoute(tier);
    const usageKey = resolveAiUsageKey(req, tier);
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
        return res.status(400).json({
            error: `Input too large for tier "${tier}". Reduce prompt/context size.`,
        });
    }

    try {
        reserveUsage({
            userKey: usageKey,
            estimatedInputTokens,
            tierPolicy,
        });
    } catch (usageError) {
        return res.status(429).json({ error: usageError.message });
    }

    let usageFinalized = false;

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
Keep concise and executable.`,
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

        const executorCompletion = await createCompletionWithFallback({
            primaryModel: modelRoute.executorModel,
            fallbackModel: modelRoute.fallbackModel,
            messages: [
                {
                    role: 'system',
                    content: `You are a Minecraft building assistant.
Generate ONLY raw JSON in this shape:
{
  "blocks": [
    { "x": 0, "y": 0, "z": 0, "block": "minecraft:oak_planks" }
  ],
  "tags": ["house", "wood"]
}
Rules:
- Relative coordinates only.
- No markdown or explanations.
- No air blocks.
- Do not exceed tier constraints in planner notes.`,
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        prompt: message,
                        tier,
                        context: contextSnapshot,
                        plan: plannerCompletion.text,
                    }),
                },
            ],
            maxTokens: tierPolicy.maxOutputTokensPerRequest,
        });

        const parsed = parseBlocksAndTags(executorCompletion.text);
        const normalizedBlocksAndTags = JSON.stringify(parsed);
        const estimatedOutputTokens = estimateTokenCountFromText(normalizedBlocksAndTags);

        try {
            finalizeUsage({
                userKey: usageKey,
                estimatedOutputTokens,
                tierPolicy,
            });
            usageFinalized = true;
        } catch (usageError) {
            return res.status(429).json({ error: usageError.message });
        }

        const metering = recordUsageMetering({
            userKey: usageKey,
            tier,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
        });

        const marginAlerts = evaluateBreakEvenAlerts({ month: metering.month });

        return res.json({
            blocksAndTags: normalizedBlocksAndTags,
            meta: {
                tier,
                modelRoute: {
                    planner: plannerCompletion.modelUsed,
                    executor: executorCompletion.modelUsed,
                },
                fallbackUsed: plannerCompletion.fallbackUsed || executorCompletion.fallbackUsed,
                estimatedInputTokens,
                estimatedOutputTokens,
                usage: getUsageSnapshot(usageKey),
                metering,
                marginAlertsTriggered: marginAlerts.triggered.length,
                contextDiagnostics,
            },
        });
    } catch (err) {
        if (!usageFinalized) {
            releaseInFlightSlot(usageKey);
        }
        logger.error(`Failed to generate structure for tier ${tier}. ${(err && err.stack) || err}`, {
            tier,
            usageKey,
            estimatedInputTokens,
            contextDiagnostics,
        });
        return res.status(500).json({ error: 'Failed to generate structure' });
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
