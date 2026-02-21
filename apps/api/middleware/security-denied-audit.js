const DENIED_AUTH_EVENT_TYPES = Object.freeze({
    401: 'denied_authn',
    403: 'denied_authz',
});

/**
 * Extract one concise message from a JSON response payload.
 * @param {unknown} payload
 * @returns {string | null}
 */
function extractDeniedMessage(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const error = typeof payload.error === 'string' ? payload.error.trim() : '';
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const combined = `${error}${error && message ? ': ' : ''}${message}`.trim();
    if (!combined) {
        return null;
    }

    return combined.slice(0, 240);
}

/**
 * Build middleware that records structured audit events for denied auth responses.
 * @param {{ recordSecurityAuditEvent: (event: Record<string, unknown>) => void }} deps
 * @returns {import('express').RequestHandler}
 */
export function createSecurityDeniedAuditMiddleware({ recordSecurityAuditEvent }) {
    if (typeof recordSecurityAuditEvent !== 'function') {
        throw new Error('recordSecurityAuditEvent dependency is required.');
    }

    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            const statusCode = Number(res.statusCode || 0);
            const deniedType = DENIED_AUTH_EVENT_TYPES[statusCode];

            if (deniedType && !res.locals.securityAuditDeniedEventRecorded) {
                const authUserId = req.auth?.payload?.sub || null;
                const fallbackMessage = statusCode === 401
                    ? 'Unauthorized request denied.'
                    : 'Forbidden request denied.';
                const deniedReason = typeof res.locals.securityAuditDeniedReason === 'string'
                    ? res.locals.securityAuditDeniedReason
                    : null;

                recordSecurityAuditEvent({
                    type: deniedType,
                    severity: 'warning',
                    userKey: authUserId ? `auth:${authUserId}` : null,
                    message: extractDeniedMessage(payload) || fallbackMessage,
                    context: {
                        statusCode,
                        method: req.method,
                        path: req.originalUrl,
                        ip: req.ip || req.socket?.remoteAddress || null,
                        userAgent: req.get('user-agent') || null,
                        reason: deniedReason,
                    },
                });
                res.locals.securityAuditDeniedEventRecorded = true;
            }

            return originalJson(payload);
        };

        next();
    };
}
