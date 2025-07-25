import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import { OpenAI } from 'openai';

import jwtCheck from './middleware/auth0-jwt-check.js';

import 'dotenv/config.js';

import {
    addLogEntryToUsersSession,
    addStepsToUsersBuild,
    createUser,
    createUsersBuild,
    createUsersSession,
    getUserByEmail,
    getUserById,
    updateUsersBuild,
    updateUserTier
} from './core/firestore/users.js';
import { Timestamp } from '@google-cloud/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();

app.use(bodyParser.json());

//rewrite urls from /api to /
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) {
            req.url = req.url.replace(/^\/api/, '');
        }
        next();
    })
}

app.get('/user/tier', jwtCheck, async (req, res) => {
    const email = req.query.email;
    const userId = req.query.userId;

    if (!email && !userId) {
        return res.status(400).json({ error: 'email or userId is required' });
    }

    let user

    try {
        if (email) {
            user = await getUserByEmail({ email });
        } else {
            user = await getUserById({ userId });
        }

        if (!user) {
            return res.json({ tier: 'pending', exists: false });
        }

        return res.json({ tier: user.tier || 'free' });
    } catch (err) {
        console.error(`❌ Failed to fetch tier for ${email}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/user', jwtCheck, async (req, res) => {
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
});

app.get('/user/:userId', jwtCheck, async (req, res) => {
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
});

app.post('/user/signup', jwtCheck, async (req, res) => {
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
});

app.post('/user/plan', jwtCheck, async (req, res) => {
    try {
        const { tier } = req.body;
        const userId = req.auth.payload.sub;

        if (!['free', 'starter', 'pro'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier selected' });
        }

        await db.collection('users').doc(userId).set(
            { tier },
            { merge: true } // ✅ Only update tier field
        );

        res.json({ status: 'updated', tier });
    } catch (err) {
        console.error('❌ Tier update failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/user/build', jwtCheck, async (req, res) => {
    const { build } = req.body
    const userId = req.auth?.sub;

    if (!userId || !build) {
        return res.status(400).json({ error: 'Missing userId or build' });
    }

    try {
        const newBuild = {
            ...build,
            createdAt: Timestamp.now()
        }
        const docRef = await createUsersBuild({ build: newBuild });

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

        return res.send(200).json({ buildId: docRef.id });
    } catch (err) {
        console.error(`❌ Failed to create user build for userId ${userId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.put('/user/build/:buildId', jwtCheck, async (req, res) => {
    const { build } = req.body
    const userId = req.auth?.sub;
    const buildId = req.params.buildId;

    if (!userId || !build || !buildId) {
        return res.status(400).json({ error: 'Missing userId, buildId, or build' });
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
});

app.post('/user/build/:buildId/steps', jwtCheck, async (req, res) => {
    const { steps } = req.body
    const userId = req.auth?.sub;
    const buildId = req.params.buildId;

    if (!userId || !steps || !buildId) {
        return res.status(400).json({ error: 'Missing userId, buildId, or steps' });
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
});

app.post('/user/build/:buildId/logs', jwtCheck, async (req, res) => {
    const { logs } = req.body
    const userId = req.auth?.sub;
    const buildId = req.params.buildId;

    if (!userId || !logs || !buildId) {
        return res.status(400).json({ error: 'Missing userId, buildId, or logs' });
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
});

app.post('/user/session/:sessionId', jwtCheck, async (req, res) => {
    const { session } = req.body
    const userId = req.auth?.sub;
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
});

app.post('/user/session/:sessionId/log', jwtCheck, async (req, res) => {
    const { log } = req.body
    const userId = req.auth?.sub;
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
});

app.post('/stripe/create-checkout-session', async (req, res) => {
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
})

app.post('/stripe/confirm-checkout', jwtCheck, async (req, res) => {
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
})

app.post('/ai-get-structure', async (req, res) => {
    const { message } = req.body;

    try {
        const chat = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: `You are a Minecraft building assistant. Given a natural language prompt, output two things:
                        1. A JSON array of block placements to construct the requested structure.
                        2. A JSON array of string tags that describe the structure (e.g., "house", "modern", "roof", "glass", "farm", "castle").

                        Rules:
                        - All positions must be relative to origin (0,0,0).
                        - Output ONLY raw JSON. Do NOT include explanations, markdown, or commentary.
                        - Output format:
                        {
                        "blocks": [ 
                            { "x": 0, "y": 0, "z": 0, "block": "minecraft:oak_planks" },
                            ...
                        ],
                        "tags": ["house", "wood", "roof", "modern"]
                        }

                        - Do NOT include air blocks or blocks below the foundation.
                        - Assume a flat foundation exists; only place blocks *on top* of other blocks or the foundation.
                        - All structures must be family-friendly (suitable for young children).
                        - Sort blocks from lowest Y to highest Y to optimize motion.

                        Assume a roof is required unless the prompt clearly says otherwise.`,
                },
                {
                    role: 'user',
                    content: message,
                },
            ],
        });

        const blocksAndTags = chat.choices[0].message.content.trim();
        res.json({ blocksAndTags });
    } catch (err) {
        console.error('❌ AI structure error:', err);
        res.status(500).json({ error: 'Failed to generate structure' });
    }
});


app.get('/', (req, res) => {
    res.send('✅ API is running');
});

app.use((req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };