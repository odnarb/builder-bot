/**
 * Register user/account/session routes.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerUserRoutes(app, deps) {
    const {
        jwtCheck,
        asyncHandler,
        getUserById,
        getTierFeaturePolicy,
        resolveTier,
        getUserEntitlements,
        getReferralSummary,
        getUserOverageSnapshot,
        getUserByEmail,
        createUser,
        nowTimestamp,
        recordInstallation,
        acceptPolicyDocuments,
        recordSignupLifecycle,
        updateUserTier,
        invalidateAdminFallbackTierCache,
        recordTierUpgrade,
        createUsersBuild,
        addLogEntryToUsersSession,
        updateUsersBuild,
        addStepsToUsersBuild,
        addLogsToUsersBuild,
        getUsersBuilds,
        logger,
        getUsersBuildById,
        getPolicyAcceptance,
        evaluateRefundEligibility,
        createSubscriptionTicket,
        setRenewalPreference,
        getRenewalPreference,
        setParentalControls,
        getParentalControls,
        recordAttributionEvent,
        createUsersSession,
        getOpsDashboardSnapshot,
        setActiveSessions,
        updateUsersSession,
    } = deps;

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
            logger.error(`❌ Failed to fetch tier for ${userId}: ${err.stack}`);
            res.status(500).json({ error: 'Internal error' });
        }
    }));

    /**
     * Return enforced feature policy for the authenticated user's tier.
     */
    app.get('/user/features', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const user = await getUserById({ userId });
            const tier = resolveTier(user?.tier || 'free');
            return res.json({
                tier,
                features: getTierFeaturePolicy(tier),
            });
        } catch (error) {
            logger.error(`Failed to fetch user feature policy for ${userId}. ${error.stack}`, {
                userId,
            });
            return res.status(500).json({ error: 'Failed to fetch user feature policy.' });
        }
    }));

    /**
     * Return entitlement balances for authenticated user.
     */
    app.get('/user/entitlements', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        return res.json({
            entitlements: getUserEntitlements(userId),
            referral: getReferralSummary(userId),
        });
    }));

    /**
     * Return authenticated user's metered overage snapshot.
     */
    app.get('/user/overage', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const tier = resolveTier((await getUserById({ userId }))?.tier || 'free');
        const usageKey = `auth:${userId}`;
        return res.json({
            tier,
            overage: getUserOverageSnapshot({ userKey: usageKey }),
        });
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
            logger.error(`❌ Failed to fetch user with email ${email}: ${err.stack}`);
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
            logger.error(`❌ Failed to fetch user with id ${userId}: ${err.stack}`);
            res.status(500).json({ error: 'Internal error' });
        }
    }));

    app.post('/user/signup', jwtCheck, asyncHandler(async (req, res) => {
        const {
            email,
            name,
            auth0LoginId,
            picture,
            termsVersion,
            privacyVersion,
        } = req.body

        try {
            const userId = req.auth?.payload?.sub || auth0LoginId;
            const user = {
                email,
                name,
                auth0LoginId,
                picture, tier: 'pending',
                createdAt: nowTimestamp()
            }

            const created = await createUser({ user });
            if (created) {
                recordInstallation();
            }

            if (termsVersion || privacyVersion) {
                acceptPolicyDocuments({
                    userId,
                    termsVersion,
                    privacyVersion,
                });
            }

            if (userId) {
                await recordSignupLifecycle({
                    userId,
                    tier: 'free',
                });
            }

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to create user with id ${auth0LoginId}: ${err.stack}`);
            res.status(500).json({ error: 'Internal error' });
        }
    }));

    app.post('/user/plan', jwtCheck, asyncHandler(async (req, res) => {
        try {
            const { tier } = req.body;
            const userId = req.auth.payload.sub;
            const user = await getUserById({ userId });
            const fromTier = resolveTier(user?.tier || 'free');

            if (!['free', 'starter', 'pro', 'admin'].includes(tier)) {
                return res.status(400).json({ error: 'Invalid tier selected' });
            }

            await updateUserTier({ userId, tier });
            invalidateAdminFallbackTierCache(userId);
            if (fromTier !== tier) {
                await recordTierUpgrade({
                    userId,
                    fromTier,
                    toTier: tier,
                    skuCode: `${tier}_manual`,
                });
            }

            res.json({ status: 'updated', tier });
        } catch (err) {
            logger.error('❌ Tier update failed:', err);
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
                createdAt: nowTimestamp()
            }
            const docRef = await createUsersBuild({ userId, build: newBuild });

            //add the log entry
            const log = {
                type: "creating_build",
                data: {
                    buildId: docRef.id,
                    ...build
                },
                timestamp: nowTimestamp()
            };
            await addLogEntryToUsersSession({ userId, sessionId, log });

            return res.status(200).json({ buildId: docRef.id });
        } catch (err) {
            logger.error(`❌ Failed to create user build for userId ${userId}: ${err.stack}`);
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
                timestamp: nowTimestamp()
            };
            await addLogEntryToUsersSession({ userId, sessionId, log });

            await updateUsersBuild({ userId, buildId, build });

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to update user build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
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
                timestamp: nowTimestamp()
            };
            await addLogEntryToUsersSession({ userId, sessionId, log });
            await addStepsToUsersBuild({ userId, buildId, steps });

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to add steps to user's build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
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
                timestamp: nowTimestamp()
            };
            await addLogEntryToUsersSession({ userId, sessionId, log });
            await addLogsToUsersBuild({ userId, buildId, logs });

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to add logs to user's build for userId ${userId} and buildId ${buildId}: ${err.stack}`);
            res.status(500).json({ error: 'Internal error' });
        }
    }));

    /**
     * Return recent build history for the authenticated user.
     * Query params:
     * - limit (optional): max rows (1-100), default 20.
     */
    app.get('/user/builds', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const limit = Number(req.query.limit);

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const builds = await getUsersBuilds({
                userId,
                limit: Number.isFinite(limit) ? limit : 20,
            });
            return res.json({ builds });
        } catch (error) {
            logger.error(`Failed to fetch build history for user ${userId}. ${error.stack}`, {
                userId,
                limit,
            });
            return res.status(500).json({ error: 'Failed to fetch build history. Please try again.' });
        }
    }));

    /**
     * Return one build record for the authenticated user.
     */
    app.get('/user/build/:buildId', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const buildId = req.params.buildId;

        if (!userId || !buildId) {
            return res.status(400).json({ error: 'userId and buildId are required' });
        }

        try {
            const build = await getUsersBuildById({ userId, buildId });
            if (!build) {
                return res.status(404).json({ error: 'Build not found' });
            }

            return res.json({ build });
        } catch (error) {
            logger.error(`Failed to fetch build ${buildId} for user ${userId}. ${error.stack}`, {
                userId,
                buildId,
            });
            return res.status(500).json({ error: 'Failed to fetch build. Please try again.' });
        }
    }));

    /**
     * Store Terms/Privacy acceptance for authenticated user.
     */
    app.post('/user/policy/accept', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const { termsVersion, privacyVersion } = req.body || {};

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const acceptance = acceptPolicyDocuments({
                userId,
                termsVersion,
                privacyVersion,
            });
            return res.json({ acceptance });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to record policy acceptance.' });
        }
    }));

    /**
     * Return current Terms/Privacy acceptance state.
     */
    app.get('/user/policy/acceptance', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        return res.json({ acceptance: getPolicyAcceptance(userId) });
    }));

    /**
     * Submit cancellation/refund workflow ticket.
     */
    app.post('/user/subscription/ticket', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const {
            type,
            reason,
            purchasedAt,
            usagePercent,
            previousRefundCount,
        } = req.body || {};

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            let refundEligibility = null;
            if (String(type || '').toLowerCase() === 'refund') {
                refundEligibility = evaluateRefundEligibility({
                    purchasedAt,
                    usagePercent,
                    previousRefundCount,
                });

                if (!refundEligibility.eligible) {
                    return res.status(422).json({
                        error: refundEligibility.reason,
                        refundEligibility,
                    });
                }
            }

            const ticket = createSubscriptionTicket({ userId, type, reason });
            if (String(type || '').toLowerCase() === 'cancel') {
                setRenewalPreference({ userId, autoRenew: false });
            }

            return res.status(201).json({ ticket, refundEligibility });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to create ticket.' });
        }
    }));

    /**
     * Return renewal preference for authenticated user.
     */
    app.get('/user/subscription/renewal', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        return res.json({
            renewal: getRenewalPreference(userId),
        });
    }));

    /**
     * Update renewal preference for authenticated user.
     */
    app.put('/user/subscription/renewal', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const { autoRenew, currentPeriodEnd } = req.body || {};
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        try {
            const renewal = setRenewalPreference({
                userId,
                autoRenew,
                currentPeriodEnd,
            });
            return res.json({ renewal });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to update renewal preference.' });
        }
    }));

    /**
     * Set parental controls and moderation preferences for authenticated user.
     */
    app.put('/user/parental-controls', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const { strictMode, blockedTopics } = req.body || {};

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const controls = setParentalControls({
            userId,
            strictMode,
            blockedTopics,
        });
        return res.json({ controls });
    }));

    /**
     * Return parental controls for authenticated user.
     */
    app.get('/user/parental-controls', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        return res.json({ controls: getParentalControls(userId) });
    }));

    /**
     * Track campaign attribution metadata.
     */
    app.post('/analytics/attribution', jwtCheck, asyncHandler(async (req, res) => {
        const userId = req.auth?.payload?.sub;
        const { source, campaign, medium } = req.body || {};

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const event = recordAttributionEvent({
            userId,
            source,
            campaign,
            medium,
        });
        return res.status(201).json({ event });
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
            createdAt: nowTimestamp()
        }

        try {
            await createUsersSession({ userId, sessionId, sessionStart });
            const snapshot = getOpsDashboardSnapshot();
            setActiveSessions({ count: snapshot.activeSessions + 1 });

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to create session for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
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
            updatedAt: nowTimestamp()
        }

        try {
            await updateUsersSession({ userId, sessionId, session: sessionWithTimestamp });
            if (session?.status === 'ended' || session?.status === 'stopped' || session?.exit_code !== undefined) {
                const snapshot = getOpsDashboardSnapshot();
                setActiveSessions({ count: Math.max(0, snapshot.activeSessions - 1) });
            }

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to create session for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
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

        const logWithTime = { ...log, timestamp: nowTimestamp() };

        try {
            await addLogEntryToUsersSession({ userId, sessionId, log: logWithTime });

            return res.status(200).json({ success: true });
        } catch (err) {
            logger.error(`❌ Failed to add log entry for userId ${userId} and sessionId ${sessionId}: ${err.stack}`);
            res.status(500).json({ error: 'Internal error' });
        }
    }));
}
