import express from 'express';
import bodyParser from 'body-parser';
import { createCheckoutSession } from './create-checkout-session.js';
import { handleWebhook } from './stripe/webhook.js';

const app = express();

// Stripe webhook requires raw body
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), handleWebhook);

// Normal JSON for session creation
app.use(bodyParser.json());
app.post('/create-checkout-session', createCheckoutSession);

app.get('/', (req, res) => {
    res.send('✅ Stripe API is running');
});

export { app };
