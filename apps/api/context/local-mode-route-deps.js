import {
    openLocalSqliteDatabase,
    resolveDefaultSqlitePath,
} from '../core/db/sqlite/local-db.js';
import {
    runLocalSqliteMigrations,
} from '../core/db/sqlite/migrations.js';
import {
    createSqliteSettingsRepository,
} from '../core/db/sqlite/settings-repository.js';

const DEFAULT_LOCAL_USER_ID = 'local:default';
const DEFAULT_LOCAL_EMAIL = 'local@builderbot.local';
const DEFAULT_LOCAL_NAME = 'Local Builder';

/**
 * Build the local user profile used when running without hosted auth.
 * @param {{
 *   runtimeModeConfig: { localDefaultTier?: 'free' | 'starter' | 'pro' | 'admin' },
 *   env?: Record<string, string | undefined>,
 * }} params Local user options.
 * @returns {{ id: string, auth0LoginId: string, email: string, name: string, tier: string, createdAt: null }}
 */
export function buildLocalUser({ runtimeModeConfig, env = process.env }) {
    const id = String(env.LOCAL_USER_ID || DEFAULT_LOCAL_USER_ID).trim() || DEFAULT_LOCAL_USER_ID;
    const email = String(env.LOCAL_USER_EMAIL || DEFAULT_LOCAL_EMAIL).trim() || DEFAULT_LOCAL_EMAIL;
    const name = String(env.LOCAL_USER_NAME || DEFAULT_LOCAL_NAME).trim() || DEFAULT_LOCAL_NAME;

    return {
        id,
        auth0LoginId: id,
        email,
        name,
        tier: runtimeModeConfig.localDefaultTier || 'admin',
        createdAt: null,
    };
}

/**
 * Build a stable local storage key.
 * @param {Array<string>} parts Key parts.
 * @returns {string} Namespaced local storage key.
 */
function localKey(parts) {
    return ['local', ...parts.map((part) => encodeURIComponent(String(part)))].join(':');
}

/**
 * Create a local id with enough entropy for repeated dev runs.
 * @param {string} prefix ID prefix.
 * @returns {string} Local id.
 */
function createLocalId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read a JSON value from the local settings store.
 * @param {{ getSetting: Function }} repository Settings repository.
 * @param {string} key Storage key.
 * @param {unknown} fallback Fallback value.
 * @returns {Promise<unknown>} Stored value or fallback.
 */
async function getLocalValue(repository, key, fallback) {
    const value = await repository.getSetting(key);
    return value === null || value === undefined ? fallback : value;
}

/**
 * Create local SQLite-backed session and build dependency overrides.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   logger?: { error?: Function, info?: Function },
 * }} params Repository options.
 * @returns {Record<string, Function>} Route dependency overrides.
 */
function createLocalStorageDeps({ env = process.env, logger }) {
    const db = openLocalSqliteDatabase({
        databasePath: resolveDefaultSqlitePath({ env }),
        logger,
    });
    runLocalSqliteMigrations({ db, logger });
    const repository = createSqliteSettingsRepository({ db, logger });

    return {
        /**
         * Save a local bot session start record.
         * @param {{ userId: string, sessionId: string, sessionStart: Record<string, unknown> }} params Session data.
         * @returns {Promise<{ id: string }>} Saved session reference.
         */
        async createUsersSession({ userId, sessionId, sessionStart }) {
            const key = localKey(['session', userId, sessionId]);
            await repository.setSetting({
                key,
                value: {
                    id: sessionId,
                    userId,
                    ...sessionStart,
                    logs: [],
                },
            });
            return { id: sessionId };
        },

        /**
         * Merge updates into a local bot session.
         * @param {{ userId: string, sessionId: string, session: Record<string, unknown> }} params Session update.
         * @returns {Promise<{ id: string }>} Updated session reference.
         */
        async updateUsersSession({ userId, sessionId, session }) {
            const key = localKey(['session', userId, sessionId]);
            const current = await getLocalValue(repository, key, {
                id: sessionId,
                userId,
                logs: [],
            });
            await repository.setSetting({
                key,
                value: {
                    ...current,
                    ...session,
                    id: sessionId,
                    userId,
                    logs: Array.isArray(current.logs) ? current.logs : [],
                },
            });
            return { id: sessionId };
        },

        /**
         * Append a log entry to a local bot session.
         * @param {{ userId: string, sessionId: string, log: Record<string, unknown> }} params Session log data.
         * @returns {Promise<{ id: string }>} Updated session reference.
         */
        async addLogEntryToUsersSession({ userId, sessionId, log }) {
            const key = localKey(['session', userId, sessionId]);
            const current = await getLocalValue(repository, key, {
                id: sessionId,
                userId,
                logs: [],
            });
            await repository.setSetting({
                key,
                value: {
                    ...current,
                    id: sessionId,
                    userId,
                    logs: [...(Array.isArray(current.logs) ? current.logs : []), log],
                },
            });
            return { id: sessionId };
        },

        /**
         * Save a local build record.
         * @param {{ userId: string, build: Record<string, unknown> }} params Build data.
         * @returns {Promise<{ id: string }>} Saved build reference.
         */
        async createUsersBuild({ userId, build }) {
            const buildId = createLocalId('local-build');
            const buildKey = localKey(['build', userId, buildId]);
            const indexKey = localKey(['builds', userId]);
            const buildRecord = {
                id: buildId,
                userId,
                build,
                steps: [],
                logs: [],
            };
            const index = await getLocalValue(repository, indexKey, []);

            await repository.setSetting({ key: buildKey, value: buildRecord });
            await repository.setSetting({ key: indexKey, value: [buildId, ...(Array.isArray(index) ? index : [])] });

            return { id: buildId };
        },

        /**
         * Merge updates into a local build record.
         * @param {{ userId: string, buildId: string, build: Record<string, unknown> }} params Build update.
         * @returns {Promise<{ id: string }>} Updated build reference.
         */
        async updateUsersBuild({ userId, buildId, build }) {
            const key = localKey(['build', userId, buildId]);
            const current = await getLocalValue(repository, key, {
                id: buildId,
                userId,
                build: {},
                steps: [],
                logs: [],
            });
            await repository.setSetting({
                key,
                value: {
                    ...current,
                    id: buildId,
                    userId,
                    build: {
                        ...(current.build || {}),
                        ...build,
                    },
                },
            });
            return { id: buildId };
        },

        /**
         * Append build steps to a local build record.
         * @param {{ userId: string, buildId: string, steps: Array<Record<string, unknown>> }} params Build steps.
         * @returns {Promise<boolean>} True after steps are saved.
         */
        async addStepsToUsersBuild({ userId, buildId, steps }) {
            const key = localKey(['build', userId, buildId]);
            const current = await getLocalValue(repository, key, {
                id: buildId,
                userId,
                build: {},
                steps: [],
                logs: [],
            });
            await repository.setSetting({
                key,
                value: {
                    ...current,
                    steps: [
                        ...(Array.isArray(current.steps) ? current.steps : []),
                        ...(Array.isArray(steps) ? steps : []),
                    ],
                },
            });
            return true;
        },

        /**
         * Append build logs to a local build record.
         * @param {{ userId: string, buildId: string, logs: Array<Record<string, unknown>> }} params Build logs.
         * @returns {Promise<boolean>} True after logs are saved.
         */
        async addLogsToUsersBuild({ userId, buildId, logs }) {
            const key = localKey(['build', userId, buildId]);
            const current = await getLocalValue(repository, key, {
                id: buildId,
                userId,
                build: {},
                steps: [],
                logs: [],
            });
            await repository.setSetting({
                key,
                value: {
                    ...current,
                    logs: [
                        ...(Array.isArray(current.logs) ? current.logs : []),
                        ...(Array.isArray(logs) ? logs : []),
                    ],
                },
            });
            return true;
        },

        /**
         * Return recent local builds for a user.
         * @param {{ userId: string, limit?: number }} params Build query.
         * @returns {Promise<Array<Record<string, unknown>>>} Local build rows.
         */
        async getUsersBuilds({ userId, limit = 20 }) {
            const index = await getLocalValue(repository, localKey(['builds', userId]), []);
            const ids = Array.isArray(index) ? index.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))) : [];
            const builds = await Promise.all(ids.map((buildId) => repository.getSetting(localKey(['build', userId, buildId]))));
            return builds.filter(Boolean);
        },

        /**
         * Return one local build for a user.
         * @param {{ userId: string, buildId: string }} params Build lookup.
         * @returns {Promise<Record<string, unknown> | null>} Local build or null.
         */
        async getUsersBuildById({ userId, buildId }) {
            return repository.getSetting(localKey(['build', userId, buildId]));
        },
    };
}

/**
 * Build local-mode route dependency overrides.
 * @param {{
 *   runtimeModeConfig: { distributionMode?: string, localDefaultTier?: 'free' | 'starter' | 'pro' | 'admin' },
 *   env?: Record<string, string | undefined>,
 *   logger?: { error?: Function, info?: Function },
 * }} params Local dependency options.
 * @returns {Record<string, Function>} Route dependency overrides.
 */
export function createLocalModeRouteDeps({ runtimeModeConfig, env = process.env, logger }) {
    if (runtimeModeConfig?.distributionMode !== 'local') {
        return {};
    }

    const localUser = buildLocalUser({ runtimeModeConfig, env });
    const localStorageDeps = createLocalStorageDeps({ env, logger });

    return {
        ...localStorageDeps,

        /**
         * Return the local user for local IDs.
         * @param {{ userId: string }} params User lookup.
         * @returns {Promise<Record<string, unknown> | null>} Local user or null.
         */
        async getUserById({ userId }) {
            return String(userId || '') === localUser.id ? { ...localUser } : null;
        },

        /**
         * Return the local user for the configured local email.
         * @param {{ email: string }} params User lookup.
         * @returns {Promise<Record<string, unknown> | null>} Local user or null.
         */
        async getUserByEmail({ email }) {
            return String(email || '').trim().toLowerCase() === localUser.email.toLowerCase()
                ? { ...localUser }
                : null;
        },

        /**
         * Return the local user without creating cloud records.
         * @returns {Promise<Record<string, unknown>>} Local user.
         */
        async createUser() {
            return { ...localUser };
        },

        /**
         * Return an updated local user shape without writing to cloud storage.
         * @param {{ userId: string, tier: string }} params Tier update.
         * @returns {Promise<Record<string, unknown> | null>} Updated local user or null.
         */
        async updateUserTier({ userId, tier }) {
            if (String(userId || '') !== localUser.id) {
                return null;
            }

            return {
                ...localUser,
                tier,
            };
        },
    };
}
