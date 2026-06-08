/**
 * Parse a JSON value from SQLite storage.
 * @param {string | null} raw Raw JSON string.
 * @returns {unknown} Parsed value.
 * @throws {Error} When the stored JSON cannot be parsed.
 */
function parseStoredJson(raw) {
    if (raw === null || raw === undefined) {
        return null;
    }

    return JSON.parse(raw);
}

/**
 * Create a SQLite-backed settings repository.
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   logger?: { error?: Function },
 * }} params Repository dependencies.
 * @returns {{
 *   getSetting: (key: string) => Promise<unknown | null>,
 *   setSetting: (params: { key: string, value: unknown }) => Promise<{ key: string, value: unknown, updatedAt: string }>,
 *   deleteSetting: (key: string) => Promise<void>,
 * }} Settings repository.
 * @throws {Error} When required dependencies are missing.
 */
export function createSqliteSettingsRepository({ db, logger }) {
    if (!db) {
        throw new Error('createSqliteSettingsRepository requires db.');
    }

    return {
        /**
         * Get one setting value by key.
         * @param {string} key Setting key.
         * @returns {Promise<unknown | null>} Stored setting value, or null when missing.
         * @throws {Error} When the setting cannot be read.
         */
        async getSetting(key) {
            try {
                const row = db
                    .prepare('SELECT value_json FROM settings WHERE key = ?')
                    .get(String(key));
                return row ? parseStoredJson(row.value_json) : null;
            } catch (error) {
                logger?.error?.(`Failed to read local setting. ${error.stack}`, { key: String(key) });
                throw new Error('Failed to read local setting.');
            }
        },

        /**
         * Save one setting value with replace semantics.
         * @param {{ key: string, value: unknown }} params Setting payload.
         * @returns {Promise<{ key: string, value: unknown, updatedAt: string }>} Saved setting.
         * @throws {Error} When the setting cannot be saved.
         */
        async setSetting({ key, value }) {
            const safeKey = String(key || '').trim();
            if (!safeKey) {
                throw new Error('Setting key is required.');
            }

            try {
                const updatedAt = new Date().toISOString();
                db.prepare(`
                    INSERT INTO settings (key, value_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                `).run(safeKey, JSON.stringify(value), updatedAt);

                return { key: safeKey, value, updatedAt };
            } catch (error) {
                logger?.error?.(`Failed to save local setting. ${error.stack}`, { key: safeKey });
                throw new Error('Failed to save local setting.');
            }
        },

        /**
         * Delete one setting value by key.
         * @param {string} key Setting key.
         * @returns {Promise<void>}
         * @throws {Error} When the setting cannot be deleted.
         */
        async deleteSetting(key) {
            try {
                db.prepare('DELETE FROM settings WHERE key = ?').run(String(key));
            } catch (error) {
                logger?.error?.(`Failed to delete local setting. ${error.stack}`, { key: String(key) });
                throw new Error('Failed to delete local setting.');
            }
        },
    };
}

