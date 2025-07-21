// /api/create-checkout-session.js
import 'dotenv/config.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map tier → Stripe product
const productMap = {
    starter: process.env.STRIPE_PRODUCT_ID_STARTER_TIER,
    pro: process.env.STRIPE_PRODUCT_ID_PRO_TIER,
    admin: process.env.STRIPE_PRODUCT_ID_ADMIN_TIER
};

export async function createCheckoutSession(req, res) {
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
}
