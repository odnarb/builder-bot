const EMERGENCY_GUARD_EVAL_CACHE_TTL_MS = Math.max(
    5000,
    Number(process.env.EMERGENCY_GUARD_CACHE_TTL_MS || 45000),
);
const DEFAULT_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS = Math.max(
    15,
    Number(process.env.FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS || 60),
);
const MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS = 3600;

/**
 * Create cached runtime orchestration for emergency margin guard evaluation.
 * @param {{
 *   getMonthlyMarginReport: (params: { now?: Date, month?: string, thresholdPercent?: number }) => Promise<Record<string, any>>,
 *   getOpsDashboardSnapshot: () => Record<string, any>,
 *   evaluateEmergencyMarginGuard: (params: {
 *     marginPercent: number | null,
 *     tokenBurnLastHourUsd: number,
 *     force?: boolean,
 *     now?: Date,
 *   }) => Promise<Record<string, any>>,
 *   getEmergencyMarginGuardState: () => Promise<Record<string, any>>,
 *   logger: { warn: Function, info: Function, error: Function },
 * }} deps
 */
export function createEmergencyGuardRuntime({
    getMonthlyMarginReport,
    getOpsDashboardSnapshot,
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    logger,
}) {
    const runtime = {
        lastEvaluatedAtMs: 0,
        lastResult: null,
        inFlightPromise: null,
    };

    /**
     * Clone JSON-safe values.
     * @template T
     * @param {T} value
     * @returns {T}
     */
    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * Resolve numeric alert value for emergency-guard alerts.
     * @param {Record<string, any>} state
     * @returns {number}
     */
    function getEmergencyGuardAlertValue(state) {
        const marginPercent = Number(state?.triggerMetrics?.marginPercent);
        if (Number.isFinite(marginPercent)) {
            return marginPercent;
        }
        return Number(state?.triggerMetrics?.tokenBurnLastHourUsd) || 0;
    }

    /**
     * Resolve `Retry-After` in seconds for free-tier emergency throttles.
     * @param {Record<string, any>} state
     * @returns {number}
     */
    function resolveFreeTierThrottleRetryAfterSeconds(state) {
        const nowMs = Date.now();
        const cooldownUntilMs = new Date(state?.cooldownUntil || 0).getTime();
        if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
            const secondsUntilCooldownEnds = Math.ceil((cooldownUntilMs - nowMs) / 1000);
            return Math.max(
                15,
                Math.min(MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS, secondsUntilCooldownEnds),
            );
        }

        return Math.max(
            15,
            Math.min(MAX_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS, DEFAULT_FREE_TIER_THROTTLE_RETRY_AFTER_SECONDS),
        );
    }

    /**
     * Evaluate the global emergency margin guard using current economics + burn metrics.
     * @param {{ force?: boolean, now?: Date }} [params]
     * @returns {Promise<{
     *   month: string | null,
     *   marginPercent: number | null,
     *   tokenBurnLastHourUsd: number,
     *   state: Record<string, any>,
     *   transition: { activated: boolean, deactivated: boolean, at: string, reasonCodes: string[] } | null,
     * }>}
     */
    async function evaluateCurrentEmergencyMarginGuard({ force = false, now = new Date() } = {}) {
        const nowDate = new Date(now);
        const nowMs = nowDate.getTime();
        if (
            !force &&
            runtime.lastResult &&
            (nowMs - runtime.lastEvaluatedAtMs) < EMERGENCY_GUARD_EVAL_CACHE_TTL_MS
        ) {
            return cloneJson(runtime.lastResult);
        }

        if (!force && runtime.inFlightPromise) {
            return runtime.inFlightPromise;
        }

        const evaluationPromise = (async () => {
            try {
                const [marginReport, opsSnapshot] = await Promise.all([
                    getMonthlyMarginReport({ now: nowDate }),
                    Promise.resolve(getOpsDashboardSnapshot()),
                ]);
                const marginPercent = typeof marginReport?.totals?.marginPercent === 'number'
                    ? marginReport.totals.marginPercent
                    : null;
                const tokenBurnLastHourUsd = Number(opsSnapshot?.tokenBurnLastHourUsd) || 0;
                const evaluation = await evaluateEmergencyMarginGuard({
                    marginPercent,
                    tokenBurnLastHourUsd,
                    force,
                    now: nowDate,
                });

                if (evaluation.transition) {
                    const from = evaluation.transition.activated ? 'NORMAL' : 'ACTIVE';
                    const to = evaluation.transition.activated ? 'ACTIVE' : 'NORMAL';
                    const reasonCodes = Array.isArray(evaluation.transition.reasonCodes) && evaluation.transition.reasonCodes.length > 0
                        ? evaluation.transition.reasonCodes
                        : ['none'];
                    const transitionLine = `GUARD_STATE_TRANSITION: ${from} -> ${to} reason=${reasonCodes.join(',')}`;
                    const transitionContext = {
                        month: marginReport.month,
                        from,
                        to,
                        reasonCodes,
                        marginPercent,
                        tokenBurnLastHourUsd,
                        cooldownUntil: evaluation.state.cooldownUntil,
                        recoveryStreak: evaluation.state.recoveryStreak,
                    };
                    if (evaluation.transition.activated) {
                        logger.warn(transitionLine, transitionContext);
                    } else {
                        logger.info(transitionLine, transitionContext);
                    }
                }

                const result = {
                    month: marginReport.month || null,
                    marginPercent,
                    tokenBurnLastHourUsd,
                    state: evaluation.state,
                    transition: evaluation.transition,
                };

                runtime.lastResult = cloneJson(result);
                runtime.lastEvaluatedAtMs = Date.now();
                return cloneJson(result);
            } catch (error) {
                logger.error(`Failed to evaluate emergency margin guard. ${error?.message || error}`, {
                    force,
                });
                const fallbackResult = {
                    month: null,
                    marginPercent: null,
                    tokenBurnLastHourUsd: Number(getOpsDashboardSnapshot().tokenBurnLastHourUsd) || 0,
                    state: await getEmergencyMarginGuardState(),
                    transition: null,
                };
                runtime.lastResult = cloneJson(fallbackResult);
                runtime.lastEvaluatedAtMs = Date.now();
                return cloneJson(fallbackResult);
            }
        })().finally(() => {
            if (runtime.inFlightPromise === evaluationPromise) {
                runtime.inFlightPromise = null;
            }
        });

        if (!force) {
            runtime.inFlightPromise = evaluationPromise;
        }

        return evaluationPromise;
    }

    return {
        evaluateCurrentEmergencyMarginGuard,
        getEmergencyGuardAlertValue,
        resolveFreeTierThrottleRetryAfterSeconds,
    };
}
