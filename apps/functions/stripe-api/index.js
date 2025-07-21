import express from 'express';
import bodyParser from 'body-parser';
import { createCheckoutSession } from './create-checkout-session.js';
import { handleWebhook } from './webhook.js';
import { getUserByEmail, getUserById } from './core/firestore/users.js';

const app = express();

// Stripe webhook requires raw body
app.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), handleWebhook);

// Normal JSON for session creation
app.use(bodyParser.json());

app.post('stripe/create-checkout-session', createCheckoutSession);

app.get('/user/tier', async (req, res) => {
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

app.get('/user', async (req, res) => {
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

app.get('/user/:userId', async (req, res) => {
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

app.get('/', (req, res) => {
    res.send('✅ Stripe API is running');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };
