import express from 'express';
import bodyParser from 'body-parser';
import { createCheckoutSession } from './create-checkout-session.js';
import { handleWebhook } from './webhook.js';

const app = express();

// Stripe webhook requires raw body
app.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), handleWebhook);

// Normal JSON for session creation
app.use(bodyParser.json());

app.post('stripe/create-checkout-session', createCheckoutSession);

app.get('/', (req, res) => {
    res.send('✅ Stripe API is running');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };
