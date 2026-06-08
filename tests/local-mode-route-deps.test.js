import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildLocalUser,
    createLocalModeRouteDeps,
} from '../apps/api/context/local-mode-route-deps.js';

/**
 * Create an isolated SQLite path for local route dependency tests.
 * @returns {string} Temporary SQLite path.
 */
function createTempSqlitePath() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-local-routes-')), 'local.sqlite');
}

test('buildLocalUser returns default local user', () => {
    const user = buildLocalUser({
        runtimeModeConfig: { localDefaultTier: 'admin' },
        env: {},
    });

    assert.deepEqual(user, {
        id: 'local:default',
        auth0LoginId: 'local:default',
        email: 'local@builderbot.local',
        name: 'Local Builder',
        tier: 'admin',
        createdAt: null,
    });
});

test('buildLocalUser accepts local env overrides', () => {
    const user = buildLocalUser({
        runtimeModeConfig: { localDefaultTier: 'free' },
        env: {
            LOCAL_USER_ID: 'local:steve',
            LOCAL_USER_EMAIL: 'steve@builderbot.local',
            LOCAL_USER_NAME: 'Steve',
        },
    });

    assert.equal(user.id, 'local:steve');
    assert.equal(user.email, 'steve@builderbot.local');
    assert.equal(user.name, 'Steve');
    assert.equal(user.tier, 'free');
});

test('createLocalModeRouteDeps returns no overrides outside local mode', () => {
    const deps = createLocalModeRouteDeps({
        runtimeModeConfig: { distributionMode: 'hosted', localDefaultTier: 'admin' },
        env: {},
    });

    assert.deepEqual(deps, {});
});

test('createLocalModeRouteDeps resolves local user without cloud storage', async () => {
    const deps = createLocalModeRouteDeps({
        runtimeModeConfig: { distributionMode: 'local', localDefaultTier: 'admin' },
        env: {
            BUILDERBOT_SQLITE_PATH: createTempSqlitePath(),
        },
    });

    const userById = await deps.getUserById({ userId: 'local:default' });
    const userByEmail = await deps.getUserByEmail({ email: 'local@builderbot.local' });
    const missingUser = await deps.getUserById({ userId: 'auth|remote' });

    assert.equal(userById.tier, 'admin');
    assert.equal(userByEmail.id, 'local:default');
    assert.equal(missingUser, null);
});

test('createLocalModeRouteDeps persists local sessions and builds without cloud storage', async () => {
    const deps = createLocalModeRouteDeps({
        runtimeModeConfig: { distributionMode: 'local', localDefaultTier: 'admin' },
        env: {
            BUILDERBOT_SQLITE_PATH: createTempSqlitePath(),
        },
    });

    await deps.createUsersSession({
        userId: 'local:default',
        sessionId: 'session-1',
        sessionStart: { status: 'started' },
    });
    await deps.addLogEntryToUsersSession({
        userId: 'local:default',
        sessionId: 'session-1',
        log: { type: 'hello' },
    });

    const docRef = await deps.createUsersBuild({
        userId: 'local:default',
        build: { message: 'build a tower' },
    });
    await deps.updateUsersBuild({
        userId: 'local:default',
        buildId: docRef.id,
        build: { status: 'done' },
    });
    await deps.addStepsToUsersBuild({
        userId: 'local:default',
        buildId: docRef.id,
        steps: [{ action: 'place' }],
    });
    await deps.addLogsToUsersBuild({
        userId: 'local:default',
        buildId: docRef.id,
        logs: [{ level: 'info' }],
    });

    const builds = await deps.getUsersBuilds({ userId: 'local:default' });
    const build = await deps.getUsersBuildById({ userId: 'local:default', buildId: docRef.id });

    assert.equal(builds.length, 1);
    assert.equal(build.id, docRef.id);
    assert.equal(build.build.message, 'build a tower');
    assert.equal(build.build.status, 'done');
    assert.equal(build.steps.length, 1);
    assert.equal(build.logs.length, 1);
});
