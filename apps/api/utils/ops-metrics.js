const opsMetricsState = {
    activeAiRequests: 0,
    totalAiRequests: 0,
    successfulAiRequests: 0,
    failedAiRequests: 0,
    queueRejectedRequests: 0,
    blockedPlans: 0,
    suspiciousUsageEvents: 0,
    totalRetries: 0,
    totalLatencyMs: 0,
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
 *   activeAiRequests: number,
 *   totalAiRequests: number,
 *   successfulAiRequests: number,
 *   failedAiRequests: number,
 *   queueRejectedRequests: number,
 *   blockedPlans: number,
 *   suspiciousUsageEvents: number,
 *   totalRetries: number,
 *   averageLatencyMs: number,
 *   failureRatePercent: number,
 *   lastUpdatedAt: string | null,
 * }}
 */
export function getOpsDashboardSnapshot() {
    const completedRequests = opsMetricsState.successfulAiRequests + opsMetricsState.failedAiRequests;
    return {
        activeAiRequests: opsMetricsState.activeAiRequests,
        totalAiRequests: opsMetricsState.totalAiRequests,
        successfulAiRequests: opsMetricsState.successfulAiRequests,
        failedAiRequests: opsMetricsState.failedAiRequests,
        queueRejectedRequests: opsMetricsState.queueRejectedRequests,
        blockedPlans: opsMetricsState.blockedPlans,
        suspiciousUsageEvents: opsMetricsState.suspiciousUsageEvents,
        totalRetries: opsMetricsState.totalRetries,
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

    if (snapshot.suspiciousUsageEvents >= 10) {
        alerts.push({
            level: 'warning',
            code: 'suspicious_usage_spike',
            message: 'Suspicious usage events exceeded baseline.',
            value: snapshot.suspiciousUsageEvents,
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
    opsMetricsState.queueRejectedRequests = 0;
    opsMetricsState.blockedPlans = 0;
    opsMetricsState.suspiciousUsageEvents = 0;
    opsMetricsState.totalRetries = 0;
    opsMetricsState.totalLatencyMs = 0;
    opsMetricsState.lastUpdatedAt = null;
}
