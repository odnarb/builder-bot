const MIGRATIONS = Object.freeze([
    {
        id: 1,
        name: 'initial_local_tables',
        sql: `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT,
                display_name TEXT,
                tier TEXT NOT NULL DEFAULT 'free',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entitlements (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tier TEXT NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                current_period_end TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_entitlements_user_id
                ON entitlements(user_id);

            CREATE TABLE IF NOT EXISTS builds (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                plan_source TEXT,
                block_count INTEGER NOT NULL DEFAULT 0,
                result_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_builds_user_created
                ON builds(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS usage_monthly (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                month_key TEXT NOT NULL,
                request_count INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS idempotency_claims (
                key TEXT NOT NULL,
                scope TEXT NOT NULL,
                status TEXT NOT NULL,
                result_json TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (key, scope)
            );
        `,
    },
]);

/**
 * Ensure the migrations bookkeeping table exists.
 * @param {import('better-sqlite3').Database} db SQLite database handle.
 * @returns {void}
 */
function ensureMigrationTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
    `);
}

/**
 * Return whether a migration has already been applied.
 * @param {import('better-sqlite3').Database} db SQLite database handle.
 * @param {number} migrationId Migration identifier.
 * @returns {boolean} True when the migration is already recorded.
 */
function hasMigration(db, migrationId) {
    const row = db
        .prepare('SELECT id FROM schema_migrations WHERE id = ?')
        .get(migrationId);
    return Boolean(row);
}

/**
 * Run local SQLite migrations exactly once.
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   logger?: { error?: Function },
 * }} params Migration dependencies.
 * @returns {{ applied: Array<{ id: number, name: string }> }} Applied migration summary.
 * @throws {Error} When migrations fail.
 */
export function runLocalSqliteMigrations({ db, logger }) {
    try {
        ensureMigrationTable(db);
        const applied = [];

        for (const migration of MIGRATIONS) {
            if (hasMigration(db, migration.id)) {
                continue;
            }

            const applyMigration = db.transaction(() => {
                db.exec(migration.sql);
                db.prepare(`
                    INSERT INTO schema_migrations (id, name, applied_at)
                    VALUES (?, ?, ?)
                `).run(migration.id, migration.name, new Date().toISOString());
            });

            applyMigration();
            applied.push({ id: migration.id, name: migration.name });
        }

        return { applied };
    } catch (error) {
        logger?.error?.(`Failed to run local SQLite migrations. ${error.stack}`, {});
        throw new Error('Failed to initialize local database schema.');
    }
}

