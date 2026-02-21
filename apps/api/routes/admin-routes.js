/**
 * Register admin-only routes.
 * Admin auth middleware should be applied before calling this.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerAdminRoutes(app, deps) {
    const {
        asyncHandler,
        getUsageMeteringRows,
        getMonthlyMarginReport,
        getBreakEvenAlerts,
        getPreScaleTelemetryDashboard,
        evaluateCurrentEmergencyMarginGuard,
        getPreScalePerformanceProfile,
        getBuildCostSnapshots,
        getConversionFunnelReport,
        runPreScaleSimulation,
        getPreScaleSimulationRuns,
        migrateInMemoryUsageBucketsToPersistentStore,
        migrateInMemoryUsageMeteringToPersistentStore,
        migrateInMemoryPreScaleTelemetryToPersistentStore,
        getOpsDashboardSnapshot,
        setEmergencyMarginGuardManualOverride,
        recordSecurityAuditEvent,
        EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE,
        evaluateOpsAlerts,
        getEmergencyGuardAlertValue,
        isPersistentEconomicsEnabled,
        evaluateIncidentNotifications,
        getSecurityAuditEvents,
        getAttributionEvents,
        getReferralEvents,
        getOverageReport,
        getAbuseAnalytics,
        recordEvaluationRun,
        getEvaluationReport,
        getIncidents,
        getIncidentPlaybooks,
        resolveIncident,
    } = deps;

    /**
     * Return per-tier usage metering rows for a month.
     * Query params:
     * - month (optional): `YYYY-MM`, defaults to current UTC month.
     */
    app.get('/admin/usage-metering', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        const rows = await getUsageMeteringRows({ month });
        const resolvedMonth = rows[0]?.month || month || null;
        return res.json({ month: resolvedMonth, rows });
    }));

    /**
     * Return monthly margin report grouped by tier.
     * Query params:
     * - month (optional): `YYYY-MM`, defaults to current UTC month.
     * - thresholdPercent (optional): break-even alert threshold.
     */
    app.get('/admin/margin-report', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        const thresholdPercent = Number(req.query.thresholdPercent);

        const report = await getMonthlyMarginReport({
            month,
            thresholdPercent: Number.isFinite(thresholdPercent) ? thresholdPercent : undefined,
        });

        return res.json(report);
    }));

    /**
     * Return stored break-even alerts for a month.
     * Query params:
     * - month (optional): `YYYY-MM`, defaults to current UTC month.
     */
    app.get('/admin/margin-alerts', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        return res.json(getBreakEvenAlerts({ month }));
    }));

    /**
     * Return pre-scale economics and usage telemetry dashboard.
     */
    app.get('/admin/pre-scale-telemetry', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        const marginRows = await getUsageMeteringRows({ month });
        const marginByTier = Object.fromEntries(
            marginRows.map((row) => [row.tier, { revenue: row.revenue, totalCost: row.totalCost }]),
        );
        const [dashboard, emergencyGuard] = await Promise.all([
            getPreScaleTelemetryDashboard({
                month,
                marginByTier,
            }),
            evaluateCurrentEmergencyMarginGuard(),
        ]);

        return res.json({
            ...dashboard,
            guard_state_effective: {
                active: emergencyGuard.state.active,
                source: emergencyGuard.state.source,
                reason: emergencyGuard.state.reason,
                reasonCodes: emergencyGuard.state.reasonCodes,
                throttleFreeTier: emergencyGuard.state.throttleFreeTier,
                forceThinSnapshots: emergencyGuard.state.forceThinSnapshots,
                cooldownUntil: emergencyGuard.state.cooldownUntil,
                recoveryStreak: emergencyGuard.state.recoveryStreak,
                lastEvaluatedAt: emergencyGuard.state.lastEvaluatedAt,
            },
        });
    }));

    /**
     * Return latency and performance profile metrics for pre-scale readiness.
     */
    app.get('/admin/performance-profile', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        return res.json(await getPreScalePerformanceProfile({ month }));
    }));

    /**
     * Return tracked per-build cost snapshots.
     */
    app.get('/admin/build-costs', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;
        const limit = Number(req.query.limit);
        return res.json({
            month: month || null,
            rows: getBuildCostSnapshots({
                month,
                tier,
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Return conversion funnel and upgrade instrumentation summary.
     */
    app.get('/admin/conversion-funnel', asyncHandler(async (req, res) => {
        const days = Number(req.query.days);
        return res.json(getConversionFunnelReport({
            days: Number.isFinite(days) ? days : undefined,
        }));
    }));

    /**
     * Execute a synthetic stress/abuse simulation suite.
     */
    app.post('/admin/pre-scale/simulate', asyncHandler(async (req, res) => {
        const {
            seed,
            concurrentUsers,
            requestsPerUser,
            tiers,
        } = req.body || {};
        const emergencyGuard = await evaluateCurrentEmergencyMarginGuard();

        return res.json(runPreScaleSimulation({
            seed,
            concurrentUsers,
            requestsPerUser,
            tiers,
            guardState: emergencyGuard.state,
        }));
    }));

    /**
     * Return recent synthetic stress/abuse simulation runs.
     */
    app.get('/admin/pre-scale/simulations', asyncHandler(async (req, res) => {
        const limit = Number(req.query.limit);
        return res.json({
            runs: getPreScaleSimulationRuns({
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Persist existing in-memory economics/telemetry rows to persistent storage.
     */
    app.post('/admin/pre-scale/migrate-inmemory', asyncHandler(async (req, res) => {
        const usageRows = await migrateInMemoryUsageBucketsToPersistentStore();
        const marginRows = await migrateInMemoryUsageMeteringToPersistentStore();
        const telemetryRows = await migrateInMemoryPreScaleTelemetryToPersistentStore();

        return res.json({
            migrated: {
                usageRows,
                marginRows,
                telemetryRows,
            },
        });
    }));

    /**
     * Return monolithic operations dashboard metrics.
     */
    app.get('/admin/ops-dashboard', asyncHandler(async (req, res) => {
        return res.json(getOpsDashboardSnapshot());
    }));

    /**
     * Return current emergency margin guard state.
     */
    app.get('/admin/emergency-guard', asyncHandler(async (req, res) => {
        const evaluation = await evaluateCurrentEmergencyMarginGuard({ force: true });
        return res.json(evaluation);
    }));

    /**
     * Set, clear, or time-box emergency margin guard manual override.
     */
    app.post('/admin/emergency-guard/override', asyncHandler(async (req, res) => {
        const {
            mode,
            reason,
            actor,
            durationMinutes,
            confirmationCode,
        } = req.body || {};
        const adminUserId = req.auth?.payload?.sub || null;
        const resolvedActor = typeof actor === 'string' && actor.trim().length > 0
            ? actor.trim()
            : adminUserId;

        if (mode === 'force_off' && confirmationCode !== EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE) {
            return res.status(400).json({
                error: `force_off requires explicit confirmationCode="${EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE}".`,
            });
        }

        try {
            const nextState = await setEmergencyMarginGuardManualOverride({
                mode,
                reason,
                actor: resolvedActor,
                durationMinutes,
            });
            recordSecurityAuditEvent({
                type: 'emergency_guard_override',
                severity: mode === 'force_off' ? 'warning' : 'info',
                userKey: adminUserId || 'admin:unknown',
                tier: 'admin',
                message: `Emergency guard override ${String(mode || 'unknown')} by ${resolvedActor || 'unknown-admin'}.`,
                context: {
                    mode,
                    reason: typeof reason === 'string' ? reason : null,
                    durationMinutes: Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : null,
                    expiresAt: nextState.manualOverride?.expiresAt || null,
                    confirmationCodeAccepted: mode === 'force_off',
                },
            });
        } catch (error) {
            return res.status(400).json({
                error: error.message || 'Invalid emergency guard override request.',
            });
        }

        const evaluation = await evaluateCurrentEmergencyMarginGuard({ force: true });
        return res.json(evaluation);
    }));

    /**
     * Return operations alerts derived from request/failure metrics.
     */
    app.get('/admin/ops-alerts', asyncHandler(async (req, res) => {
        const evaluation = evaluateOpsAlerts();
        const emergencyGuard = await evaluateCurrentEmergencyMarginGuard();
        const configuredPersistenceMode = String(process.env.PRE_SCALE_PERSISTENCE_MODE || '').trim().toLowerCase();
        const persistentEconomicsEnabled = await isPersistentEconomicsEnabled().catch(() => false);
        const alerts = [...evaluation.alerts];

        if (emergencyGuard.state.active) {
            alerts.push({
                level: 'error',
                code: 'emergency_margin_guard_active',
                message: emergencyGuard.state.reason || 'Emergency margin guard is active.',
                value: getEmergencyGuardAlertValue(emergencyGuard.state),
            });
        }

        if (configuredPersistenceMode === 'firestore' && !persistentEconomicsEnabled) {
            alerts.push({
                level: 'warning',
                code: 'persistence_fallback_active',
                message: 'PRE_SCALE_PERSISTENCE_MODE=firestore but persistent economics is unavailable; runtime is using in-memory fallback.',
                value: {
                    configuredMode: configuredPersistenceMode,
                    persistentEconomicsEnabled,
                },
            });
        }

        const incidents = evaluateIncidentNotifications({ alerts });
        return res.json({
            ...evaluation,
            alerts,
            incidents,
            emergencyGuard,
        });
    }));

    /**
     * Return security audit trail events.
     * Query params:
     * - type (optional)
     * - severity (optional): info|warning|error
     * - limit (optional): 1-500
     */
    app.get('/admin/security-audits', asyncHandler(async (req, res) => {
        const type = typeof req.query.type === 'string' ? req.query.type : undefined;
        const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
        const limit = Number(req.query.limit);

        return res.json({
            events: getSecurityAuditEvents({
                type,
                severity: severity === 'info' || severity === 'warning' || severity === 'error'
                    ? severity
                    : undefined,
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Return campaign attribution events for growth analytics.
     */
    app.get('/admin/analytics/attribution', asyncHandler(async (req, res) => {
        const limit = Number(req.query.limit);
        return res.json({
            events: getAttributionEvents({
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Return referral redemption events for admin analytics.
     */
    app.get('/admin/analytics/referrals', asyncHandler(async (req, res) => {
        const limit = Number(req.query.limit);
        return res.json({
            events: getReferralEvents({
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
        });
    }));

    /**
     * Return overage billing report.
     */
    app.get('/admin/overage-report', asyncHandler(async (req, res) => {
        const month = typeof req.query.month === 'string' ? req.query.month : undefined;
        return res.json({
            month: month || null,
            rows: getOverageReport({ month }),
        });
    }));

    /**
     * Return abuse analytics summary for chat/build/api patterns.
     */
    app.get('/admin/abuse-analytics', asyncHandler(async (req, res) => {
        const hours = Number(req.query.hours);
        const limit = Number(req.query.limit);
        return res.json(getAbuseAnalytics({
            hours: Number.isFinite(hours) ? hours : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
        }));
    }));

    /**
     * Record an evaluation harness run for regression tracking.
     */
    app.post('/admin/evaluation/run', asyncHandler(async (req, res) => {
        const {
            suite,
            modelVariant,
            qualityScore,
            latencyScore,
            safetyScore,
            notes,
        } = req.body || {};

        try {
            const run = recordEvaluationRun({
                suite,
                modelVariant,
                qualityScore,
                latencyScore,
                safetyScore,
                notes,
            });
            return res.status(201).json({ run });
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Failed to record evaluation run.' });
        }
    }));

    /**
     * Return evaluation harness report and regression summary.
     */
    app.get('/admin/evaluation', asyncHandler(async (req, res) => {
        const suite = typeof req.query.suite === 'string' ? req.query.suite : undefined;
        const limit = Number(req.query.limit);
        return res.json(getEvaluationReport({
            suite,
            limit: Number.isFinite(limit) ? limit : undefined,
        }));
    }));

    /**
     * Return tracked incidents and associated playbooks.
     */
    app.get('/admin/incidents', asyncHandler(async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const limit = Number(req.query.limit);
        return res.json({
            incidents: getIncidents({
                status: status === 'active' || status === 'resolved' ? status : undefined,
                limit: Number.isFinite(limit) ? limit : undefined,
            }),
            playbooks: getIncidentPlaybooks(),
        });
    }));

    /**
     * Resolve a tracked incident by id.
     */
    app.post('/admin/incidents/:incidentId/resolve', asyncHandler(async (req, res) => {
        const incidentId = req.params.incidentId;
        const resolved = resolveIncident({ incidentId });
        if (!resolved) {
            return res.status(404).json({ error: 'Incident not found.' });
        }
        return res.json({ incident: resolved });
    }));
}
