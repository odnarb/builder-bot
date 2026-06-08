import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    closeLocalSqliteDatabase,
    openLocalSqliteDatabase,
    resolveDefaultSqlitePath,
} from '../apps/core/db/sqlite/local-db.js';
import { runLocalSqliteMigrations } from '../apps/core/db/sqlite/migrations.js';
import { createSqliteIdempotencyRepository } from '../apps/core/db/sqlite/idempotency-repository.js';
import { createSqliteSettingsRepository } from '../apps/core/db/sqlite/settings-repository.js';

/**
 * Create an isolated temporary SQLite database for one test.
 * @returns {{ db: import('better-sqlite3').Database, tempDir: string, databasePath: string }}
 */
function createTempDatabase() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-sqlite-test-'));
    const databasePath = path.join(tempDir, 'local.sqlite');
    const db = openLocalSqliteDatabase({ databasePath });
    runLocalSqliteMigrations({ db });
    return { db, tempDir, databasePath };
}

test('resolveDefaultSqlitePath keeps local DB outside the repo by default', () => {
    const defaultPath = resolveDefaultSqlitePath({ env: {} });

    assert.equal(path.isAbsolute(defaultPath), true);
    assert.equal(defaultPath.includes('.builderbot'), true);
    assert.equal(defaultPath.startsWith(process.cwd()), false);
});

test('local SQLite migrations create tables exactly once', () => {
    const { db, tempDir } = createTempDatabase();
    try {
        const secondRun = runLocalSqliteMigrations({ db });
        const rows = db.prepare('SELECT id, name FROM schema_migrations ORDER BY id').all();

        assert.deepEqual(secondRun, { applied: [] });
        assert.deepEqual(rows, [{ id: 1, name: 'initial_local_tables' }]);
    } finally {
        closeLocalSqliteDatabase(db);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('SQLite settings repository round-trips JSON values', async () => {
    const { db, tempDir } = createTempDatabase();
    try {
        const settings = createSqliteSettingsRepository({ db });
        const value = {
            theme: 'dark',
            flags: ['local', 'open-source'],
            nested: { enabled: true },
        };

        const saved = await settings.setSetting({ key: 'workspace', value });
        const loaded = await settings.getSetting('workspace');

        assert.equal(saved.key, 'workspace');
        assert.deepEqual(loaded, value);

        await settings.deleteSetting('workspace');
        assert.equal(await settings.getSetting('workspace'), null);
    } finally {
        closeLocalSqliteDatabase(db);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('SQLite idempotency repository rejects duplicate claims and preserves result', async () => {
    const { db, tempDir } = createTempDatabase();
    try {
        const idempotency = createSqliteIdempotencyRepository({ db });
        const firstClaim = await idempotency.claim({
            key: 'checkout-session-123',
            scope: 'stripe-confirmation',
        });
        await idempotency.complete({
            key: 'checkout-session-123',
            scope: 'stripe-confirmation',
            result: { tier: 'starter' },
        });
        const secondClaim = await idempotency.claim({
            key: 'checkout-session-123',
            scope: 'stripe-confirmation',
        });

        assert.deepEqual(firstClaim, { claimed: true });
        assert.equal(secondClaim.claimed, false);
        assert.equal(secondClaim.existing.status, 'completed');
        assert.deepEqual(secondClaim.existing.result, { tier: 'starter' });
    } finally {
        closeLocalSqliteDatabase(db);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

