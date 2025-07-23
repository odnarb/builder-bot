import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';

import jwtCheck from './middleware/auth0-jwt-check.js';

import 'dotenv/config.js';

import {
    createUser,
    getUserByEmail,
    getUserById
} from './core/firestore/users.js';

const app = express();

app.use(bodyParser.json());

app.get('/user/tier', jwtCheck, async (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const user = await getUserByEmail({ email });
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
            createdAt: new Date().toISOString()
        }

        console.log(`Creating user: `, user)
        await createUser({ user });

        return res.send(200);
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

app.post('stripe/create-checkout-session', async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
            success_url: `https://${process.env.DOMAIN}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `https://${process.env.DOMAIN}/checkout/cancel`,
            metadata: { username, tier }
        });

        return res.json({ url: session.url });
    } catch (err) {
        console.error(`❌ Stripe session error: ${err.message}`);
        return res.status(500).json({ error: 'Could not create checkout session' });
    }
})

app.get('/', (req, res) => {
    res.send('✅ API is running');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };