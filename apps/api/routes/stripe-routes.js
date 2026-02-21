/**
 * Register Stripe checkout and confirmation routes.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerStripeRoutes(app, deps) {
    const {
        jwtCheck,
        asyncHandler,
        stripe,
        getPolicyAcceptance,
        resolveCheckoutSku,
        acceptPolicyDocuments,
        getUserById,
        recordCheckoutStarted,
        resolveTier,
        updateUserTier,
        invalidateAdminFallbackTierCache,
        recordTierUpgrade,
        setRenewalPreference,
        getRenewalPreference,
    } = deps;

    app.post('/stripe/create-checkout-session', jwtCheck, asyncHandler(async (req, res) => {
        const CHECKOUT_URL = process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173';
        const userId = req.auth?.payload?.sub;
        const existingAcceptance = userId ? getPolicyAcceptance(userId) : null;

        // Map SKU → Stripe product id
        const productMap = {
            starter_monthly: process.env.STRIPE_PRODUCT_ID_STARTER_TIER,
            pro_monthly: process.env.STRIPE_PRODUCT_ID_PRO_TIER,
            admin_monthly: process.env.STRIPE_PRODUCT_ID_ADMIN_TIER,
        };

        const { username, tier, skuCode, termsVersion, privacyVersion } = req.body || {};
        const checkoutSku = resolveCheckoutSku({ skuCode, tier });

        if (!checkoutSku || checkoutSku.tier === 'free') {
            return res.status(400).json({ error: 'Invalid SKU selection' });
        }

        const resolvedTermsVersion = termsVersion || existingAcceptance?.termsVersion;
        const resolvedPrivacyVersion = privacyVersion || existingAcceptance?.privacyVersion;
        if (!resolvedTermsVersion || !resolvedPrivacyVersion) {
            return res.status(400).json({
                error: 'Terms and privacy acceptance is required before checkout.',
            });
        }

        if (termsVersion && privacyVersion && userId) {
            acceptPolicyDocuments({
                userId,
                termsVersion,
                privacyVersion,
            });
        }

        if (!productMap[checkoutSku.code]) {
            return res.status(400).json({ error: `Missing Stripe product mapping for SKU "${checkoutSku.code}".` });
        }

        try {
            if (userId) {
                const user = await getUserById({ userId });
                await recordCheckoutStarted({
                    userId,
                    fromTier: resolveTier(user?.tier || 'free'),
                    toTier: checkoutSku.tier,
                    skuCode: checkoutSku.code,
                });
            }

            const products = await stripe.products.list({ limit: 100 });
            const product = products.data.find(p => p.id === productMap[checkoutSku.code]);
            const price = product?.default_price;

            if (!price) throw new Error('No price attached to product');

            const session = await stripe.checkout.sessions.create({
                mode: checkoutSku.kind === 'one_time' ? 'payment' : 'subscription',
                line_items: [{ price, quantity: 1 }],
                success_url: `${CHECKOUT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${CHECKOUT_URL}/checkout/cancel`,
                metadata: {
                    username,
                    tier: checkoutSku.tier,
                    skuCode: checkoutSku.code,
                    userId,
                    termsVersion: resolvedTermsVersion,
                    privacyVersion: resolvedPrivacyVersion,
                },
            });

            return res.json({ url: session.url, sku: checkoutSku });
        } catch (err) {
            console.error(`❌ Stripe session error: ${err.message}`);
            return res.status(500).json({ error: 'Could not create checkout session' });
        }
    }));

    app.post('/stripe/confirm-checkout', jwtCheck, asyncHandler(async (req, res) => {
        const { sessionId } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription'],
        });

        const metadataTier = resolveTier(session.metadata?.tier || 'free');
        const skuCode = session.metadata?.skuCode || null;
        const userId = req.auth.payload.sub;

        const termsVersion = session.metadata?.termsVersion;
        const privacyVersion = session.metadata?.privacyVersion;
        const existingAcceptance = getPolicyAcceptance(userId);
        const resolvedTermsVersion = termsVersion || existingAcceptance?.termsVersion;
        const resolvedPrivacyVersion = privacyVersion || existingAcceptance?.privacyVersion;

        if (!resolvedTermsVersion || !resolvedPrivacyVersion) {
            return res.status(400).json({
                error: 'Checkout confirmation requires terms/privacy acceptance metadata.',
            });
        }

        acceptPolicyDocuments({
            userId,
            termsVersion: resolvedTermsVersion,
            privacyVersion: resolvedPrivacyVersion,
        });

        const user = await getUserById({ userId });
        const fromTier = resolveTier(user?.tier || 'free');
        await updateUserTier({ userId: user.id, tier: metadataTier });
        invalidateAdminFallbackTierCache(userId);
        await recordTierUpgrade({
            userId,
            fromTier,
            toTier: metadataTier,
            skuCode,
        });

        if (session.subscription && typeof session.subscription === 'object') {
            const periodEndUnix = Number(session.subscription.current_period_end || 0);
            const currentPeriodEnd = periodEndUnix > 0
                ? new Date(periodEndUnix * 1000).toISOString()
                : null;
            const autoRenew = !Boolean(session.subscription.cancel_at_period_end);
            setRenewalPreference({
                userId,
                autoRenew,
                currentPeriodEnd,
            });
        }

        res.json({
            status: 'success',
            tier: metadataTier,
            skuCode,
            acceptance: getPolicyAcceptance(userId),
            renewal: getRenewalPreference(userId),
        });
    }))
}
