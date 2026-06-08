import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * Resolve the default local SQLite file path outside the source tree.
 * @param {{ env?: Record<string, string | undefined> }} [options] Resolution options.
 * @returns {string} Absolute SQLite database path.
 */
export function resolveDefaultSqlitePath({ env = process.env } = {}) {
    if (env.BUILDERBOT_SQLITE_PATH) {
        return path.resolve(env.BUILDERBOT_SQLITE_PATH);
    }

    return path.join(os.homedir(), '.builderbot', 'builderbot.local.sqlite');
}

/**
 * Open a local SQLite database and create its parent directory.
 * @param {{
 *   databasePath?: string,
 *   logger?: { error?: Function },
 * }} [options] Database open options.
 * @returns {Database.Database} Open better-sqlite3 database handle.
 * @throws {Error} When the database cannot be opened.
 */
export function openLocalSqliteDatabase({ databasePath = resolveDefaultSqlitePath(), logger } = {}) {
    try {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        const db = new Database(databasePath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        return db;
    } catch (error) {
        logger?.error?.(`Failed to open local SQLite database. ${error.stack}`, {});
        throw new Error('Failed to open local database.');
    }
}

/**
 * Close a SQLite database handle.
 * @param {Database.Database | null | undefined} db SQLite database handle.
 * @returns {void}
 */
export function closeLocalSqliteDatabase(db) {
    if (db?.open) {
        db.close();
    }
}

