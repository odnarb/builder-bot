const opsMetricsState = {
    activeAiRequests: 0,
    totalAiRequests: 0,
    successfulAiRequests: 0,
    failedAiRequests: 0,
    totalInstallations: 0,
    activeSessions: 0,
    queueDepth: 0,
    queueRejectedRequests: 0,
    blockedPlans: 0,
    blockedPlacementEvents: 0,
    crashEvents: 0,
    suspiciousUsageEvents: 0,
    totalRetries: 0,
    totalLatencyMs: 0,
    tokenBurnUsd: 0,
    tokenBurnEvents: [],
    lastUpdatedAt: null,
};

/**
 * Mark the start of an AI request for operational accounting.
 * @param {{ now?: Date }} [params]
 */
export function recordAiRequestStart(params = {}) {
    opsMetricsState.activeAiRequests += 1;
    opsMetricsState.totalAiRequests += 1;
    opsMetricsState.lastUpdatedAt = new Date(params.now || new Date()).toISOString();
}

/**
 * Record one successful install / activation event.
 * @param {{ now?: Date }} [params]
 */
export function recordInstallation(params = {}) {
    opsMetricsState.totalInstallations += 1;
    opsMetricsState.lastUpdatedAt = new Date(params.now || new Date()).toISOString();
}

/**
 * Set current active session count.
 * @param {{ count: number, now?: Date }} params
 */
export function setActiveSessions({ count, now = new Date() }) {
    opsMetricsState.activeSessions = Math.max(0, Number(count) || 0);
    opsMetricsState.lastUpdatedAt = new Date(now).toISOString();
}

/**
 * Set current queue depth for AI requests.
 * @param {{ depth: number, now?: Date }} params
 */
export function setQueueDepth({ depth, now = new Date() }) {
    opsMetricsState.queueDepth = Math.max(0, Number(depth) || 0);
    opsMetricsState.lastUpdatedAt = new Date(now).toISOString();
}

/**
 * Record runtime crash events for ops alerting.
 * @param {{ now?: Date }} [params]
 */
export function recordCrash(params = {}) {
    opsMetricsState.crashEvents += 1;
    opsMetricsState.lastUpdatedAt = new Date(params.now || new Date()).toISOString();
}

/**
 * Record blocked placement count for trend monitoring.
 * @param {{ count?: number, now?: Date }} [params]
 */
export function recordBlockedPlacement(params = {}) {
    const count = Math.max(1, Number(params.count) || 1);
    opsMetricsState.blockedPlacementEvents += count;
    opsMetricsState.lastUpdatedAt = new Date(params.now || new Date()).toISOString();
}

/**
 * Record token burn for burn-spike alerting.
 * @param {{ usd: number, now?: Date }} params
 */
export function recordTokenBurn({ usd, now = new Date() }) {
    const safeUsd = Math.max(0, Number(usd) || 0);
    opsMetricsState.tokenBurnUsd += safeUsd;
    opsMetricsState.tokenBurnEvents.push({
        usd: safeUsd,
        timestamp: new Date(now).toISOString(),
    });
    if (opsMetricsState.tokenBurnEvents.length > 10000) {
        opsMetricsState.tokenBurnEvents.splice(0, opsMetricsState.tokenBurnEvents.length - 10000);
    }
    opsMetricsState.lastUpdatedAt = new Date(now).toISOString();
}

/**
 * Compute the amount of token burn within a recent window.
 * @param {number} windowMs
 * @returns {number}
 */
function getTokenBurnWindowUsd(windowMs) {
    const cutoff = Date.now() - windowMs;
    return Number(opsMetricsState.tokenBurnEvents
        .filter((event) => new Date(event.timestamp).getTime() >= cutoff)
        .reduce((sum, event) => sum + event.usd, 0)
        .toFixed(6));
}

/**
 * Mark the end of an AI request and update outcomes.
 * @param {{
 *   success: boolean,
 *   retried?: number,
 *   queueRejected?: boolean,
 *   blockedPlan?: boolean,
 *   suspiciousUsage?: boolean,
 *   latencyMs?: number,
 *   now?: Date,
 * }} params
 */
export function recordAiRequestEnd(params) {
    opsMetricsState.activeAiRequests = Math.max(0, opsMetricsState.activeAiRequests - 1);

    if (params.success) {
        opsMetricsState.successfulAiRequests += 1;
    } else {
        opsMetricsState.failedAiRequests += 1;
    }

    if (params.queueRejected) {
        opsMetricsState.queueRejectedRequests += 1;
    }

    if (params.blockedPlan) {
        opsMetricsState.blockedPlans += 1;
    }

    if (params.suspiciousUsage) {
        opsMetricsState.suspiciousUsageEvents += 1;
    }

    if (Number.isFinite(Number(params.retried)) && Number(params.retried) > 0) {
        opsMetricsState.totalRetries += Number(params.retried);
    }

    if (Number.isFinite(Number(params.latencyMs)) && Number(params.latencyMs) >= 0) {
        opsMetricsState.totalLatencyMs += Number(params.latencyMs);
    }

    opsMetricsState.lastUpdatedAt = new Date(params.now || new Date()).toISOString();
}

/**
 * Get a dashboard-ready operational snapshot.
 * @returns {{
 *   totalInstallations: number,
 *   activeSessions: number,
 *   activeAiRequests: number,
 *   queueDepth: number,
 *   totalAiRequests: number,
 *   successfulAiRequests: number,
 *   failedAiRequests: number,
 *   queueRejectedRequests: number,
 *   queueRejectRatePercent: number,
 *   blockedPlans: number,
 *   blockedPlacementEvents: number,
 *   crashEvents: number,
 *   suspiciousUsageEvents: number,
 *   totalRetries: number,
 *   tokenBurnUsd: number,
 *   tokenBurnLastHourUsd: number,
 *   averageLatencyMs: number,
 *   failureRatePercent: number,
 *   lastUpdatedAt: string | null,
 * }}
 */
export function getOpsDashboardSnapshot() {
    const completedRequests = opsMetricsState.successfulAiRequests + opsMetricsState.failedAiRequests;
    const queueRejectRatePercent = completedRequests > 0
        ? Number(((opsMetricsState.queueRejectedRequests / completedRequests) * 100).toFixed(2))
        : 0;

    return {
        totalInstallations: opsMetricsState.totalInstallations,
        activeSessions: opsMetricsState.activeSessions,
        activeAiRequests: opsMetricsState.activeAiRequests,
        queueDepth: opsMetricsState.queueDepth,
        totalAiRequests: opsMetricsState.totalAiRequests,
        successfulAiRequests: opsMetricsState.successfulAiRequests,
        failedAiRequests: opsMetricsState.failedAiRequests,
        queueRejectedRequests: opsMetricsState.queueRejectedRequests,
        queueRejectRatePercent,
        blockedPlans: opsMetricsState.blockedPlans,
        blockedPlacementEvents: opsMetricsState.blockedPlacementEvents,
        crashEvents: opsMetricsState.crashEvents,
        suspiciousUsageEvents: opsMetricsState.suspiciousUsageEvents,
        totalRetries: opsMetricsState.totalRetries,
        tokenBurnUsd: Number(opsMetricsState.tokenBurnUsd.toFixed(6)),
        tokenBurnLastHourUsd: getTokenBurnWindowUsd(60 * 60 * 1000),
        averageLatencyMs: completedRequests > 0
            ? Number((opsMetricsState.totalLatencyMs / completedRequests).toFixed(2))
            : 0,
        failureRatePercent: completedRequests > 0
            ? Number(((opsMetricsState.failedAiRequests / completedRequests) * 100).toFixed(2))
            : 0,
        lastUpdatedAt: opsMetricsState.lastUpdatedAt,
    };
}

/**
 * Evaluate operational alerts from current metrics.
 * @returns {{
 *   generatedAt: string,
 *   alerts: Array<{ level: 'warning' | 'error', code: string, message: string, value: number }>,
 * }}
 */
export function evaluateOpsAlerts() {
    const snapshot = getOpsDashboardSnapshot();
    const alerts = [];

    if (snapshot.failureRatePercent >= 20) {
        alerts.push({
            level: 'error',
            code: 'high_failure_rate',
            message: 'AI failure rate exceeds 20%.',
            value: snapshot.failureRatePercent,
        });
    }

    if (snapshot.activeAiRequests >= 20) {
        alerts.push({
            level: 'warning',
            code: 'high_active_requests',
            message: 'Active AI requests are elevated.',
            value: snapshot.activeAiRequests,
        });
    }

    if (snapshot.crashEvents >= 3) {
        alerts.push({
            level: 'error',
            code: 'crash_spike',
            message: 'Crash events exceeded baseline.',
            value: snapshot.crashEvents,
        });
    }

    if (snapshot.blockedPlacementEvents >= 20) {
        alerts.push({
            level: 'warning',
            code: 'blocked_placement_spike',
            message: 'Blocked placement events exceeded baseline.',
            value: snapshot.blockedPlacementEvents,
        });
    }

    if (snapshot.suspiciousUsageEvents >= 10) {
        alerts.push({
            level: 'warning',
            code: 'suspicious_usage_spike',
            message: 'Suspicious usage events exceeded baseline.',
            value: snapshot.suspiciousUsageEvents,
        });
    }

    if (snapshot.tokenBurnLastHourUsd >= 5) {
        alerts.push({
            level: 'warning',
            code: 'burn_spike',
            message: 'Token burn in the last hour exceeded baseline.',
            value: snapshot.tokenBurnLastHourUsd,
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        alerts,
    };
}

/**
 * Reset ops metrics state for tests.
 */
export function resetOpsMetricsState() {
    opsMetricsState.activeAiRequests = 0;
    opsMetricsState.totalAiRequests = 0;
    opsMetricsState.successfulAiRequests = 0;
    opsMetricsState.failedAiRequests = 0;
    opsMetricsState.totalInstallations = 0;
    opsMetricsState.activeSessions = 0;
    opsMetricsState.queueDepth = 0;
    opsMetricsState.queueRejectedRequests = 0;
    opsMetricsState.blockedPlans = 0;
    opsMetricsState.blockedPlacementEvents = 0;
    opsMetricsState.crashEvents = 0;
    opsMetricsState.suspiciousUsageEvents = 0;
    opsMetricsState.totalRetries = 0;
    opsMetricsState.totalLatencyMs = 0;
    opsMetricsState.tokenBurnUsd = 0;
    opsMetricsState.tokenBurnEvents.length = 0;
    opsMetricsState.lastUpdatedAt = null;
}
