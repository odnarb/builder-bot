const incidents = [];

const PLAYBOOKS = Object.freeze({
    high_failure_rate: Object.freeze({
        title: 'High Failure Rate',
        priority: 'p1',
        steps: [
            'Check OpenAI model health and recent deployment changes.',
            'Inspect request validation errors and fallback-plan usage spikes.',
            'Rollback canary prompt/model variant if failure trend started recently.',
        ],
    }),
    crash_spike: Object.freeze({
        title: 'Crash Spike',
        priority: 'p1',
        steps: [
            'Inspect runtime logs for uncaught exceptions and memory pressure.',
            'Disable non-critical traffic paths and stabilize service.',
            'Prepare hotfix and communicate ETA to admins.',
        ],
    }),
    blocked_placement_spike: Object.freeze({
        title: 'Blocked Placement Spike',
        priority: 'p2',
        steps: [
            'Review validator rejection reasons and affected tiers.',
            'Confirm no policy regression in allowed block set.',
            'Patch planner prompt constraints and rerun evaluation harness.',
        ],
    }),
    suspicious_usage_spike: Object.freeze({
        title: 'Suspicious Usage Spike',
        priority: 'p2',
        steps: [
            'Identify top offending usage keys and request fingerprints.',
            'Apply temporary throttles and monitor repeat attempts.',
            'Escalate to abuse review if concentrated attack behavior persists.',
        ],
    }),
    burn_spike: Object.freeze({
        title: 'Token Burn Spike',
        priority: 'p1',
        steps: [
            'Review per-tier token usage and overage acceleration.',
            'Check for prompt loops, retries, or misrouted high-cost models.',
            'Tighten caps temporarily and alert finance ops.',
        ],
    }),
});

/**
 * Return known incident response playbooks.
 * @returns {Record<string, { title: string, priority: string, steps: string[] }>}
 */
export function getIncidentPlaybooks() {
    return PLAYBOOKS;
}

/**
 * Upsert incident notifications from operational alerts.
 * Creates one active incident per alert code.
 * @param {{
 *   alerts: Array<{ code: string, level: string, message: string, value?: number }>,
 *   now?: Date,
 * }} params
 * @returns {Array<{
 *   id: string,
 *   status: 'active' | 'resolved',
 *   code: string,
 *   level: string,
 *   message: string,
 *   value: number | null,
 *   playbook: { title: string, priority: string, steps: string[] } | null,
 *   firstDetectedAt: string,
 *   lastDetectedAt: string,
 *   resolvedAt: string | null,
 * }>}
 */
export function evaluateIncidentNotifications({ alerts, now = new Date() }) {
    const timestamp = new Date(now).toISOString();
    const safeAlerts = Array.isArray(alerts) ? alerts : [];

    for (const alert of safeAlerts) {
        const existing = incidents.find((incident) => incident.code === alert.code && incident.status === 'active');
        if (existing) {
            existing.lastDetectedAt = timestamp;
            existing.message = String(alert.message || existing.message);
            existing.value = Number.isFinite(Number(alert.value)) ? Number(alert.value) : existing.value;
            existing.level = String(alert.level || existing.level);
            continue;
        }

        incidents.push({
            id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: 'active',
            code: String(alert.code || 'unknown_alert'),
            level: String(alert.level || 'warning'),
            message: String(alert.message || 'Operational incident detected.'),
            value: Number.isFinite(Number(alert.value)) ? Number(alert.value) : null,
            playbook: PLAYBOOKS[String(alert.code || '')] || null,
            firstDetectedAt: timestamp,
            lastDetectedAt: timestamp,
            resolvedAt: null,
        });
    }

    return incidents.slice().reverse();
}

/**
 * Mark an incident as resolved.
 * @param {{ incidentId: string, now?: Date }} params
 * @returns {{
 *   id: string,
 *   status: 'active' | 'resolved',
 *   resolvedAt: string | null,
 * } | null}
 */
export function resolveIncident({ incidentId, now = new Date() }) {
    const target = incidents.find((incident) => incident.id === incidentId);
    if (!target) {
        return null;
    }

    target.status = 'resolved';
    target.resolvedAt = new Date(now).toISOString();
    return {
        id: target.id,
        status: target.status,
        resolvedAt: target.resolvedAt,
    };
}

/**
 * Return incident notifications.
 * @param {{ status?: 'active' | 'resolved', limit?: number }} [params]
 * @returns {Array<Record<string, unknown>>}
 */
export function getIncidents(params = {}) {
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    let rows = incidents.slice().reverse();

    if (params.status === 'active' || params.status === 'resolved') {
        rows = rows.filter((row) => row.status === params.status);
    }

    return rows.slice(0, limit);
}

/**
 * Reset incident state. Intended for tests.
 */
export function resetIncidentState() {
    incidents.length = 0;
}
