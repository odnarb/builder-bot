const abuseEvents = [];

/**
 * Record an abuse or anomaly signal.
 * @param {{
 *   userKey?: string,
 *   channel: 'chat' | 'build' | 'api',
 *   signal: string,
 *   severity?: 'low' | 'medium' | 'high',
 *   metadata?: Record<string, unknown>,
 *   now?: Date,
 * }} params
 * @returns {{
 *   timestamp: string,
 *   userKey: string | null,
 *   channel: 'chat' | 'build' | 'api',
 *   signal: string,
 *   severity: 'low' | 'medium' | 'high',
 *   metadata: Record<string, unknown>,
 * }}
 */
export function recordAbuseSignal({
    userKey,
    channel,
    signal,
    severity = 'low',
    metadata = {},
    now = new Date(),
}) {
    const safeChannel = channel === 'chat' || channel === 'build' || channel === 'api'
        ? channel
        : 'api';
    const safeSeverity = severity === 'high' || severity === 'medium' ? severity : 'low';

    const event = {
        timestamp: new Date(now).toISOString(),
        userKey: typeof userKey === 'string' && userKey.trim().length > 0
            ? userKey.trim()
            : null,
        channel: safeChannel,
        signal: String(signal || 'unknown_signal'),
        severity: safeSeverity,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
    };

    abuseEvents.push(event);
    if (abuseEvents.length > 10000) {
        abuseEvents.splice(0, abuseEvents.length - 10000);
    }

    return event;
}

/**
 * Get abuse analytics summary for a window.
 * @param {{ hours?: number, limit?: number }} [params]
 * @returns {{
 *   generatedAt: string,
 *   hours: number,
 *   totalEvents: number,
 *   byChannel: Record<string, number>,
 *   bySeverity: Record<string, number>,
 *   topSignals: Array<{ signal: string, count: number }>,
 *   topUsers: Array<{ userKey: string, count: number }>,
 *   recentEvents: Array<Record<string, unknown>>,
 * }}
 */
export function getAbuseAnalytics(params = {}) {
    const hours = Math.max(1, Math.min(720, Number(params.hours) || 24));
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const windowEvents = abuseEvents.filter((event) => new Date(event.timestamp).getTime() >= cutoff);

    const byChannel = { chat: 0, build: 0, api: 0 };
    const bySeverity = { low: 0, medium: 0, high: 0 };
    const signalCounts = new Map();
    const userCounts = new Map();

    for (const event of windowEvents) {
        byChannel[event.channel] = (byChannel[event.channel] || 0) + 1;
        bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;

        signalCounts.set(event.signal, (signalCounts.get(event.signal) || 0) + 1);
        if (event.userKey) {
            userCounts.set(event.userKey, (userCounts.get(event.userKey) || 0) + 1);
        }
    }

    const topSignals = Array.from(signalCounts.entries())
        .map(([signal, count]) => ({ signal, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    const topUsers = Array.from(userCounts.entries())
        .map(([userKey, count]) => ({ userKey, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    return {
        generatedAt: new Date().toISOString(),
        hours,
        totalEvents: windowEvents.length,
        byChannel,
        bySeverity,
        topSignals,
        topUsers,
        recentEvents: windowEvents.slice(-limit).reverse(),
    };
}

/**
 * Reset abuse analytics state. Intended for tests.
 */
export function resetAbuseAnalyticsState() {
    abuseEvents.length = 0;
}
