/**
 * Parse stored JSON result payloads.
 * @param {string | null} raw Raw JSON string.
 * @returns {unknown | null} Parsed value, or null.
 */
function parseResultJson(raw) {
    if (!raw) {
        return null;
    }

    return JSON.parse(raw);
}

/**
 * Create a SQLite-backed idempotency repository.
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   logger?: { error?: Function },
 * }} params Repository dependencies.
 * @returns {{
 *   claim: (params: { key: string, scope: string, status?: string, result?: unknown, expiresAt?: string | null }) => Promise<{ claimed: boolean, existing?: Record<string, unknown> }>,
 *   complete: (params: { key: string, scope: string, result?: unknown }) => Promise<void>,
 *   getClaim: (params: { key: string, scope: string }) => Promise<Record<string, unknown> | null>,
 * }} Idempotency repository.
 * @throws {Error} When required dependencies are missing.
 */
export function createSqliteIdempotencyRepository({ db, logger }) {
    if (!db) {
        throw new Error('createSqliteIdempotencyRepository requires db.');
    }

    /**
     * Read one idempotency claim.
     * @param {{ key: string, scope: string }} params Claim lookup.
     * @returns {Record<string, unknown> | null} Claim row or null.
     */
    function readClaim({ key, scope }) {
        const row = db
            .prepare(`
                SELECT key, scope, status, result_json, expires_at, created_at
                FROM idempotency_claims
                WHERE key = ? AND scope = ?
            `)
            .get(key, scope);

        if (!row) {
            return null;
        }

        return {
            key: row.key,
            scope: row.scope,
            status: row.status,
            result: parseResultJson(row.result_json),
            expiresAt: row.expires_at,
            createdAt: row.created_at,
        };
    }

    return {
        /**
         * Attempt to claim an idempotency key.
         * @param {{ key: string, scope: string, status?: string, result?: unknown, expiresAt?: string | null }} params Claim payload.
         * @returns {Promise<{ claimed: boolean, existing?: Record<string, unknown> }>} Claim result.
         * @throws {Error} When the claim cannot be saved.
         */
        async claim({ key, scope, status = 'processing', result = null, expiresAt = null }) {
            const safeKey = String(key || '').trim();
            const safeScope = String(scope || '').trim();
            if (!safeKey || !safeScope) {
                throw new Error('Idempotency key and scope are required.');
            }

            try {
                const existing = readClaim({ key: safeKey, scope: safeScope });
                if (existing) {
                    return { claimed: false, existing };
                }

                db.prepare(`
                    INSERT INTO idempotency_claims (key, scope, status, result_json, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    safeKey,
                    safeScope,
                    status,
                    JSON.stringify(result),
                    expiresAt,
                    new Date().toISOString(),
                );

                return { claimed: true };
            } catch (error) {
                logger?.error?.(`Failed to claim local idempotency key. ${error.stack}`, {
                    key: safeKey,
                    scope: safeScope,
                });
                throw new Error('Failed to claim idempotency key.');
            }
        },

        /**
         * Mark an idempotency claim as completed.
         * @param {{ key: string, scope: string, result?: unknown }} params Completion payload.
         * @returns {Promise<void>}
         * @throws {Error} When the claim cannot be completed.
         */
        async complete({ key, scope, result = null }) {
            const safeKey = String(key || '').trim();
            const safeScope = String(scope || '').trim();

            try {
                db.prepare(`
                    UPDATE idempotency_claims
                    SET status = 'completed',
                        result_json = ?
                    WHERE key = ? AND scope = ?
                `).run(JSON.stringify(result), safeKey, safeScope);
            } catch (error) {
                logger?.error?.(`Failed to complete local idempotency key. ${error.stack}`, {
                    key: safeKey,
                    scope: safeScope,
                });
                throw new Error('Failed to complete idempotency key.');
            }
        },

        /**
         * Get one idempotency claim.
         * @param {{ key: string, scope: string }} params Claim lookup.
         * @returns {Promise<Record<string, unknown> | null>} Claim row or null.
         * @throws {Error} When the claim cannot be read.
         */
        async getClaim({ key, scope }) {
            const safeKey = String(key || '').trim();
            const safeScope = String(scope || '').trim();

            try {
                return readClaim({ key: safeKey, scope: safeScope });
            } catch (error) {
                logger?.error?.(`Failed to read local idempotency key. ${error.stack}`, {
                    key: safeKey,
                    scope: safeScope,
                });
                throw new Error('Failed to read idempotency key.');
            }
        },
    };
}

