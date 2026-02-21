/**
 * Register community and growth routes.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerCommunityRoutes(app, deps) {
    const {
        jwtCheck,
        asyncHandler,
        linkCommunityAccount,
        getLinkedCommunityAccounts,
        recordBuildReaction,
        getRewardBalance,
        getReactionEvents,
        createReferralCode,
        redeemReferralCode,
        getReferralSummary,
        getUserEntitlements,
        savePhrasePack,
        getPhrasePacks,
        createMarketplaceListing,
        getMarketplaceListings,
    } = deps;

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
        const buildOwnerUserId = req.body?.buildOwnerUserId;

        if (!userId || !buildId) {
            return res.status(400).json({ error: 'userId and buildId are required' });
        }

        try {
            const result = recordBuildReaction({
                userId,
                buildId,
                reaction,
                buildOwnerUserId,
            });
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to record reaction.' });
        }
    }));

    /**
     * Return reward balance and recent reaction anti-fraud events for the user.
     */
    app.get('/community/rewards', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const limit = Number(req.query.limit);
        return res.json({
            balance: getRewardBalance(userId),
            recentReactionEvents: getReactionEvents({
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Create or return the caller's referral code.
     */
    app.post('/community/referral/code', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const code = createReferralCode({ userId });
            return res.status(201).json({ code });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to create referral code.' });
        }
    }));

    /**
     * Redeem a referral code and apply entitlement credits.
     */
    app.post('/community/referral/redeem', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const code = req.body?.code;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const redemption = redeemReferralCode({ userId, code });
            return res.json({ redemption });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to redeem referral code.' });
        }
    }));

    /**
     * Return referral summary and entitlement state for the caller.
     */
    app.get('/community/referral/summary', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        return res.json({
            summary: getReferralSummary(userId),
            entitlements: getUserEntitlements(userId),
        });
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
}
