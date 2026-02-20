const securityAuditEvents = [];
const MAX_STORED_SECURITY_EVENTS = 5000;

/**
 * Record a security or policy audit event.
 * @param {{
 *   type: string,
 *   severity?: 'info' | 'warning' | 'error',
 *   userKey?: string,
 *   tier?: string,
 *   message: string,
 *   context?: Record<string, unknown>,
 *   now?: Date,
 * }} event
 * @returns {{
 *   timestamp: string,
 *   type: string,
 *   severity: 'info' | 'warning' | 'error',
 *   userKey: string | null,
 *   tier: string | null,
 *   message: string,
 *   context: Record<string, unknown>,
 * }}
 */
export function recordSecurityAuditEvent(event) {
    const entry = {
        timestamp: new Date(event?.now || new Date()).toISOString(),
        type: String(event?.type || 'unknown'),
        severity: event?.severity === 'error'
            ? 'error'
            : (event?.severity === 'info' ? 'info' : 'warning'),
        userKey: typeof event?.userKey === 'string' ? event.userKey : null,
        tier: typeof event?.tier === 'string' ? event.tier : null,
        message: String(event?.message || 'Security audit event'),
        context: event?.context && typeof event.context === 'object' ? event.context : {},
    };

    securityAuditEvents.push(entry);
    if (securityAuditEvents.length > MAX_STORED_SECURITY_EVENTS) {
        securityAuditEvents.splice(0, securityAuditEvents.length - MAX_STORED_SECURITY_EVENTS);
    }

    return entry;
}

/**
 * Query audit events with optional filters.
 * @param {{
 *   type?: string,
 *   severity?: 'info' | 'warning' | 'error',
 *   limit?: number,
 * }} [filters]
 * @returns {Array<{
 *   timestamp: string,
 *   type: string,
 *   severity: 'info' | 'warning' | 'error',
 *   userKey: string | null,
 *   tier: string | null,
 *   message: string,
 *   context: Record<string, unknown>,
 * }>}
 */
export function getSecurityAuditEvents(filters = {}) {
    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 100));
    let events = securityAuditEvents;

    if (typeof filters.type === 'string' && filters.type.trim().length > 0) {
        const wantedType = filters.type.trim();
        events = events.filter((event) => event.type === wantedType);
    }

    if (filters.severity === 'info' || filters.severity === 'warning' || filters.severity === 'error') {
        events = events.filter((event) => event.severity === filters.severity);
    }

    return events.slice(-limit).reverse();
}

/**
 * Reset audit events table. Intended for tests.
 */
export function resetSecurityAuditEvents() {
    securityAuditEvents.length = 0;
}
