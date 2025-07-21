import { getUserByEmail, updateUserTier } from './core/firestore/users.js';

export async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`❌ Webhook error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_email;
        const tier = session.metadata?.tier || 'starter'; // fallback if needed

        if (!email || !tier) {
            console.warn(`⚠️ Missing email or tier in metadata`);
            return res.status(400).send('Missing user metadata');
        }

        const user = await getUserByEmail({ email });
        if (!user) {
            console.warn(`❌ No user found for email ${email}`);
            return res.status(404).send('User not found');
        }

        await updateUserTier({ userId: user.id, tier });
        console.log(`✅ Updated ${email} to tier ${tier}`);
    }

    res.json({ received: true });
}
