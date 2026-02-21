import {
    readPersistentDoc,
    writePersistentDoc,
} from './economics-persistence.js';

const EMERGENCY_GUARD_DOC_ID = 'global';
const DEFAULT_MARGIN_THRESHOLD_PERCENT = Number(process.env.EMERGENCY_MARGIN_THRESHOLD_PERCENT || 45);
const DEFAULT_BURN_RATE_THRESHOLD_USD_PER_HOUR = Number(process.env.EMERGENCY_BURN_RATE_USD_PER_HOUR || 3);
const DEFAULT_COOLDOWN_MINUTES = Number(process.env.EMERGENCY_GUARD_COOLDOWN_MINUTES || 20);
const DEFAULT_EVALUATION_INTERVAL_MS = Number(process.env.EMERGENCY_GUARD_EVAL_INTERVAL_MS || 30000);
const DEFAULT_PERSISTENCE_SYNC_INTERVAL_MS = Number(process.env.EMERGENCY_GUARD_PERSISTENCE_SYNC_MS || 60000);
const DEFAULT_MARGIN_EXIT_BUFFER_PERCENT = Number(process.env.EMERGENCY_MARGIN_EXIT_BUFFER_PERCENT || 5);
const DEFAULT_BURN_EXIT_BUFFER_USD_PER_HOUR = Number(process.env.EMERGENCY_BURN_EXIT_BUFFER_USD_PER_HOUR || 0.75);
const DEFAULT_RECOVERY_INTERVALS_REQUIRED = Number(process.env.EMERGENCY_GUARD_RECOVERY_INTERVALS_REQUIRED || 2);
const DEFAULT_OVERRIDE_DURATION_MINUTES = Number(process.env.EMERGENCY_GUARD_OVERRIDE_MINUTES || 60);
const MIN_OVERRIDE_DURATION_MINUTES = 30;
const MAX_OVERRIDE_DURATION_MINUTES = 120;

const runtimeState = {
    hydrated: false,
    state: null,
    lastHydratedAtMs: 0,
};

/**
 * Return an ISO timestamp.
 * @param {Date | string | number | undefined} value
 * @returns {string}
 */
function toIsoString(value) {
    return new Date(value || new Date()).toISOString();
}

/**
 * Parse an ISO date string into epoch milliseconds.
 * @param {string | null | undefined} value
 * @returns {number}
 */
function toEpochMs(value) {
    if (!value) {
        return 0;
    }

    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

/**
 * Clamp a number into a bounded range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Shallow clone JSON-like state values for safe return values.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneState(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * Build the default guard state.
 * @param {Date} [now]
 * @returns {{
 *   active: boolean,
 *   reasonCodes: string[],
 *   reason: string | null,
 *   activatedAt: string | null,
 *   deactivatedAt: string | null,
 *   lastEvaluatedAt: string | null,
 *   cooldownUntil: string | null,
 *   recoveryStreak: number,
 *   throttleFreeTier: boolean,
 *   forceThinSnapshots: boolean,
 *   source: 'auto' | 'manual' | 'manual_off',
 *   triggerMetrics: {
 *     marginPercent: number | null,
 *     tokenBurnLastHourUsd: number,
 *     marginThresholdPercent: number,
 *     burnRateThresholdUsdPerHour: number,
 *     marginExitThresholdPercent: number,
 *     burnExitThresholdUsdPerHour: number,
 *     recoveryIntervalsRequired: number,
 *   },
 *   manualOverride: {
 *     mode: 'force_on' | 'force_off',
 *     reason: string | null,
 *     actor: string | null,
 *     setAt: string,
 *     expiresAt: string | null,
 *   } | null,
 * }}
 */
function createDefaultGuardState(now = new Date()) {
    const marginThresholdPercent = DEFAULT_MARGIN_THRESHOLD_PERCENT;
    const burnRateThresholdUsdPerHour = DEFAULT_BURN_RATE_THRESHOLD_USD_PER_HOUR;
    return {
        active: false,
        reasonCodes: [],
        reason: null,
        activatedAt: null,
        deactivatedAt: null,
        lastEvaluatedAt: toIsoString(now),
        cooldownUntil: null,
        recoveryStreak: 0,
        throttleFreeTier: true,
        forceThinSnapshots: true,
        source: 'auto',
        triggerMetrics: {
            marginPercent: null,
            tokenBurnLastHourUsd: 0,
            marginThresholdPercent,
            burnRateThresholdUsdPerHour,
            marginExitThresholdPercent: marginThresholdPercent + DEFAULT_MARGIN_EXIT_BUFFER_PERCENT,
            burnExitThresholdUsdPerHour: Math.max(0, burnRateThresholdUsdPerHour - DEFAULT_BURN_EXIT_BUFFER_USD_PER_HOUR),
            recoveryIntervalsRequired: DEFAULT_RECOVERY_INTERVALS_REQUIRED,
        },
        manualOverride: null,
    };
}

/**
 * Return guard fields that should trigger persistence writes when changed.
 * @param {ReturnType<typeof createDefaultGuardState>} state
 * @returns {Record<string, unknown>}
 */
function toPersistentComparableState(state) {
    return {
        active: state.active,
        reasonCodes: state.reasonCodes,
        reason: state.reason,
        activatedAt: state.activatedAt,
        deactivatedAt: state.deactivatedAt,
        cooldownUntil: state.cooldownUntil,
        recoveryStreak: state.recoveryStreak,
        throttleFreeTier: state.throttleFreeTier,
        forceThinSnapshots: state.forceThinSnapshots,
        source: state.source,
        manualOverride: state.manualOverride,
        triggerMetrics: {
            marginThresholdPercent: state.triggerMetrics.marginThresholdPercent,
            burnRateThresholdUsdPerHour: state.triggerMetrics.burnRateThresholdUsdPerHour,
            marginExitThresholdPercent: state.triggerMetrics.marginExitThresholdPercent,
            burnExitThresholdUsdPerHour: state.triggerMetrics.burnExitThresholdUsdPerHour,
            recoveryIntervalsRequired: state.triggerMetrics.recoveryIntervalsRequired,
        },
    };
}

/**
 * Determine whether persisted state should be updated.
 * @param {ReturnType<typeof createDefaultGuardState>} previous
 * @param {ReturnType<typeof createDefaultGuardState>} next
 * @returns {boolean}
 */
function hasPersistentStateChanged(previous, next) {
    return JSON.stringify(toPersistentComparableState(previous)) !== JSON.stringify(toPersistentComparableState(next));
}

/**
 * Merge persisted guard state onto defaults.
 * @param {Record<string, unknown> | null} persisted
 * @returns {ReturnType<typeof createDefaultGuardState>}
 */
function normalizePersistedGuardState(persisted) {
    const defaults = createDefaultGuardState();
    if (!persisted || typeof persisted !== 'object') {
        return defaults;
    }

    return {
        ...defaults,
        ...persisted,
        recoveryStreak: Math.max(0, Number(persisted.recoveryStreak) || 0),
        triggerMetrics: {
            ...defaults.triggerMetrics,
            ...(persisted.triggerMetrics && typeof persisted.triggerMetrics === 'object'
                ? persisted.triggerMetrics
                : {}),
        },
        manualOverride: persisted.manualOverride && typeof persisted.manualOverride === 'object'
            ? persisted.manualOverride
            : null,
    };
}

/**
 * Persist guard state to storage.
 * @param {ReturnType<typeof createDefaultGuardState>} state
 */
async function persistGuardState(state) {
    try {
        await writePersistentDoc({
            collection: 'emergencyGuard',
            docId: EMERGENCY_GUARD_DOC_ID,
            data: {
                ...state,
                updatedAt: toIsoString(),
            },
        });
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Hydrate guard state from persistence once.
 */
async function ensureHydrated({ forceRefresh = false } = {}) {
    if (runtimeState.hydrated && !forceRefresh) {
        return;
    }

    try {
        const persisted = await readPersistentDoc({
            collection: 'emergencyGuard',
            docId: EMERGENCY_GUARD_DOC_ID,
        });
        runtimeState.state = normalizePersistedGuardState(persisted);
    } catch {
        runtimeState.state = createDefaultGuardState();
    } finally {
        runtimeState.hydrated = true;
        runtimeState.lastHydratedAtMs = Date.now();
    }
}

/**
 * Return whether runtime should refresh guard state from persistence.
 * @returns {boolean}
 */
function shouldRefreshFromPersistence() {
    if (!runtimeState.hydrated) {
        return false;
    }
    return (Date.now() - runtimeState.lastHydratedAtMs) >= DEFAULT_PERSISTENCE_SYNC_INTERVAL_MS;
}

/**
 * Build human-readable reason from guard reason codes.
 * @param {string[]} reasonCodes
 * @returns {string | null}
 */
function toReasonMessage(reasonCodes) {
    if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
        return null;
    }

    if (reasonCodes.includes('manual_override')) {
        return 'Emergency guard enabled by manual override.';
    }

    if (reasonCodes.includes('cooldown')) {
        return 'Emergency guard remains active during cooldown period.';
    }

    if (reasonCodes.includes('recovery_pending')) {
        return 'Emergency guard remains active until recovery thresholds stay stable.';
    }

    if (reasonCodes.length === 2) {
        return 'Emergency guard active due to low margin and high token burn rate.';
    }

    if (reasonCodes[0] === 'margin_below_threshold') {
        return 'Emergency guard active due to low monthly margin.';
    }

    if (reasonCodes[0] === 'burn_rate_above_threshold') {
        return 'Emergency guard active due to high token burn rate.';
    }

    return 'Emergency guard active.';
}

/**
 * Return current emergency guard state without forcing a re-evaluation.
 * @returns {Promise<ReturnType<typeof createDefaultGuardState>>}
 */
export async function getEmergencyMarginGuardState() {
    await ensureHydrated({
        forceRefresh: shouldRefreshFromPersistence(),
    });
    return cloneState(runtimeState.state || createDefaultGuardState());
}

/**
 * Evaluate emergency guard status from latest margin and burn metrics.
 * @param {{
 *   marginPercent?: number | null,
 *   tokenBurnLastHourUsd?: number,
 *   marginThresholdPercent?: number,
 *   burnRateThresholdUsdPerHour?: number,
 *   marginExitBufferPercent?: number,
 *   burnExitBufferUsdPerHour?: number,
 *   recoveryIntervalsRequired?: number,
 *   now?: Date,
 *   force?: boolean,
 *   skipHydrationRefresh?: boolean,
 * }} params
 * @returns {Promise<{
 *   state: ReturnType<typeof createDefaultGuardState>,
 *   transition: { activated: boolean, deactivated: boolean, at: string, reasonCodes: string[] } | null,
 * }>}
 */
export async function evaluateEmergencyMarginGuard(params = {}) {
    await ensureHydrated({
        forceRefresh: !params.skipHydrationRefresh && shouldRefreshFromPersistence(),
    });
    const previous = runtimeState.state || createDefaultGuardState();
    const now = new Date(params.now || new Date());
    const nowIso = now.toISOString();

    const lastEvaluatedAtMs = toEpochMs(previous.lastEvaluatedAt);
    if (!params.force && lastEvaluatedAtMs > 0 && (now.getTime() - lastEvaluatedAtMs) < DEFAULT_EVALUATION_INTERVAL_MS) {
        return {
            state: cloneState(previous),
            transition: null,
        };
    }

    const marginThresholdPercent = Number.isFinite(Number(params.marginThresholdPercent))
        ? Number(params.marginThresholdPercent)
        : DEFAULT_MARGIN_THRESHOLD_PERCENT;
    const burnRateThresholdUsdPerHour = Number.isFinite(Number(params.burnRateThresholdUsdPerHour))
        ? Number(params.burnRateThresholdUsdPerHour)
        : DEFAULT_BURN_RATE_THRESHOLD_USD_PER_HOUR;
    const marginExitBufferPercent = Number.isFinite(Number(params.marginExitBufferPercent))
        ? Math.max(0, Number(params.marginExitBufferPercent))
        : DEFAULT_MARGIN_EXIT_BUFFER_PERCENT;
    const burnExitBufferUsdPerHour = Number.isFinite(Number(params.burnExitBufferUsdPerHour))
        ? Math.max(0, Number(params.burnExitBufferUsdPerHour))
        : DEFAULT_BURN_EXIT_BUFFER_USD_PER_HOUR;
    const recoveryIntervalsRequired = clamp(
        Number.isFinite(Number(params.recoveryIntervalsRequired))
            ? Number(params.recoveryIntervalsRequired)
            : DEFAULT_RECOVERY_INTERVALS_REQUIRED,
        1,
        12,
    );

    const marginExitThresholdPercent = marginThresholdPercent + marginExitBufferPercent;
    const burnExitThresholdUsdPerHour = Math.max(0, burnRateThresholdUsdPerHour - burnExitBufferUsdPerHour);

    const marginPercent = Number.isFinite(Number(params.marginPercent))
        ? Number(params.marginPercent)
        : null;
    const tokenBurnLastHourUsd = Math.max(0, Number(params.tokenBurnLastHourUsd) || 0);

    let manualOverride = previous.manualOverride;
    if (manualOverride?.expiresAt && toEpochMs(manualOverride.expiresAt) <= now.getTime()) {
        manualOverride = null;
    }

    const marginBreached = typeof marginPercent === 'number' && marginPercent < marginThresholdPercent;
    const burnBreached = tokenBurnLastHourUsd > burnRateThresholdUsdPerHour;
    const marginRecovered = typeof marginPercent === 'number' && marginPercent > marginExitThresholdPercent;
    const burnRecovered = tokenBurnLastHourUsd < burnExitThresholdUsdPerHour;
    const recoveryHealthy = marginRecovered && burnRecovered;

    const reasonCodes = [];
    let source = 'auto';
    let shouldBeActive = false;
    let recoveryStreak = 0;

    if (manualOverride?.mode === 'force_on') {
        reasonCodes.push('manual_override');
        shouldBeActive = true;
        source = 'manual';
    } else if (manualOverride?.mode === 'force_off') {
        shouldBeActive = false;
        source = 'manual_off';
    } else {
        if (marginBreached) {
            reasonCodes.push('margin_below_threshold');
        }
        if (burnBreached) {
            reasonCodes.push('burn_rate_above_threshold');
        }

        if (reasonCodes.length > 0) {
            shouldBeActive = true;
            source = 'auto';
            recoveryStreak = 0;
        } else if (previous.active && previous.source === 'auto') {
            const cooldownActive = toEpochMs(previous.cooldownUntil) > now.getTime();
            recoveryStreak = recoveryHealthy
                ? Math.min(recoveryIntervalsRequired, (Number(previous.recoveryStreak) || 0) + 1)
                : 0;
            const recoverySatisfied = recoveryStreak >= recoveryIntervalsRequired;

            if (recoverySatisfied && !cooldownActive) {
                shouldBeActive = false;
            } else {
                shouldBeActive = true;
                if (cooldownActive) {
                    reasonCodes.push('cooldown');
                }
                if (!recoverySatisfied) {
                    reasonCodes.push('recovery_pending');
                }
                source = 'auto';
            }
        }
    }

    const next = {
        ...previous,
        active: shouldBeActive,
        reasonCodes,
        reason: toReasonMessage(reasonCodes),
        lastEvaluatedAt: nowIso,
        source,
        recoveryStreak,
        throttleFreeTier: true,
        forceThinSnapshots: true,
        manualOverride,
        triggerMetrics: {
            marginPercent,
            tokenBurnLastHourUsd: Number(tokenBurnLastHourUsd.toFixed(6)),
            marginThresholdPercent,
            burnRateThresholdUsdPerHour,
            marginExitThresholdPercent,
            burnExitThresholdUsdPerHour,
            recoveryIntervalsRequired,
        },
    };

    let transition = null;
    if (previous.active !== next.active) {
        transition = {
            activated: next.active,
            deactivated: !next.active,
            at: nowIso,
            reasonCodes: [...reasonCodes],
        };
        if (next.active) {
            next.activatedAt = nowIso;
            next.deactivatedAt = null;
            next.cooldownUntil = new Date(
                now.getTime() + (DEFAULT_COOLDOWN_MINUTES * 60 * 1000),
            ).toISOString();
        } else {
            next.deactivatedAt = nowIso;
            next.cooldownUntil = null;
            next.recoveryStreak = 0;
        }
    }

    const stateChanged = hasPersistentStateChanged(previous, next);
    runtimeState.state = next;

    if (stateChanged) {
        await persistGuardState(next);
    }

    return {
        state: cloneState(next),
        transition,
    };
}

/**
 * Set or clear manual override for emergency guard.
 * @param {{
 *   mode: 'force_on' | 'force_off' | 'clear',
 *   reason?: string,
 *   actor?: string,
 *   durationMinutes?: number,
 *   now?: Date,
 * }} params
 * @returns {Promise<ReturnType<typeof createDefaultGuardState>>}
 */
export async function setEmergencyMarginGuardManualOverride({
    mode,
    reason,
    actor,
    durationMinutes,
    now = new Date(),
}) {
    await ensureHydrated({
        forceRefresh: shouldRefreshFromPersistence(),
    });
    const current = runtimeState.state || createDefaultGuardState(now);
    const safeMode = mode === 'force_on' || mode === 'force_off' || mode === 'clear'
        ? mode
        : null;

    if (!safeMode) {
        throw new Error('mode must be "force_on", "force_off", or "clear".');
    }

    if (safeMode === 'clear') {
        runtimeState.state = {
            ...current,
            manualOverride: null,
        };
    } else {
        const resolvedDurationMinutes = Number.isFinite(Number(durationMinutes))
            ? Number(durationMinutes)
            : DEFAULT_OVERRIDE_DURATION_MINUTES;
        const safeDurationMinutes = clamp(
            resolvedDurationMinutes,
            MIN_OVERRIDE_DURATION_MINUTES,
            MAX_OVERRIDE_DURATION_MINUTES,
        );

        runtimeState.state = {
            ...current,
            manualOverride: {
                mode: safeMode,
                reason: typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null,
                actor: typeof actor === 'string' && actor.trim().length > 0 ? actor.trim() : null,
                setAt: toIsoString(now),
                expiresAt: new Date(new Date(now).getTime() + (safeDurationMinutes * 60 * 1000)).toISOString(),
            },
        };
    }

    const evaluated = await evaluateEmergencyMarginGuard({
        marginPercent: runtimeState.state.triggerMetrics?.marginPercent,
        tokenBurnLastHourUsd: runtimeState.state.triggerMetrics?.tokenBurnLastHourUsd,
        force: true,
        now,
        skipHydrationRefresh: true,
    });
    return evaluated.state;
}

/**
 * Return whether free-tier requests should be throttled.
 * @param {{ tier: string, guardState: Awaited<ReturnType<typeof getEmergencyMarginGuardState>> }} params
 * @returns {boolean}
 */
export function shouldThrottleFreeTier({ tier, guardState }) {
    return resolveTierName(tier) === 'free' && Boolean(guardState?.active && guardState?.throttleFreeTier);
}

/**
 * Return whether the request should force thin snapshots.
 * @param {{ guardState: Awaited<ReturnType<typeof getEmergencyMarginGuardState>> }} params
 * @returns {boolean}
 */
export function shouldForceThinSnapshots({ guardState }) {
    return Boolean(guardState?.active && guardState?.forceThinSnapshots);
}

/**
 * Normalize arbitrary tier strings to known values.
 * @param {string} tier
 * @returns {'free' | 'starter' | 'pro' | 'admin'}
 */
function resolveTierName(tier) {
    const normalized = String(tier || '').trim().toLowerCase();
    if (normalized === 'starter' || normalized === 'pro' || normalized === 'admin') {
        return normalized;
    }
    return 'free';
}

/**
 * Reset emergency guard runtime state for tests.
 */
export function resetEmergencyMarginGuardState() {
    runtimeState.hydrated = true;
    runtimeState.state = createDefaultGuardState();
    runtimeState.lastHydratedAtMs = Date.now();
}
