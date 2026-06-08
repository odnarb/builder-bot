import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createLocalJwtCheck,
    createRuntimeJwtCheck,
} from '../apps/api/middleware/runtime-jwt-check.js';

function createMockResponse() {
    return {};
}

async function runMiddleware(middleware, req = {}) {
    let nextCalled = false;
    await middleware(req, createMockResponse(), (error) => {
        if (error) {
            throw error;
        }
        nextCalled = true;
    });
    return { req, nextCalled };
}

test('local jwt check injects default local user', async () => {
    const middleware = createLocalJwtCheck({ env: {} });
    const { req, nextCalled } = await runMiddleware(middleware);

    assert.equal(nextCalled, true);
    assert.equal(req.auth.payload.sub, 'local:default');
    assert.equal(req.auth.payload.email, 'local@builderbot.local');
});

test('local jwt check accepts configured local user', async () => {
    const middleware = createLocalJwtCheck({
        env: {
            LOCAL_USER_ID: 'local:brandon',
            LOCAL_USER_EMAIL: 'brandon@builderbot.local',
        },
    });
    const { req } = await runMiddleware(middleware);

    assert.equal(req.auth.payload.sub, 'local:brandon');
    assert.equal(req.auth.payload.email, 'brandon@builderbot.local');
});

test('runtime jwt check uses local auth without Auth0 env in local mode', async () => {
    const middleware = createRuntimeJwtCheck({
        runtimeModeConfig: { distributionMode: 'local' },
        env: {},
    });
    const { req, nextCalled } = await runMiddleware(middleware);

    assert.equal(nextCalled, true);
    assert.equal(req.auth.payload.sub, 'local:default');
});

test('runtime jwt check requires Auth0 env in hosted mode', () => {
    assert.throws(
        () => createRuntimeJwtCheck({
            runtimeModeConfig: { distributionMode: 'hosted' },
            env: {},
        }),
        /Missing required auth env "AUTH0_DOMAIN"/,
    );
});

test('runtime jwt check creates hosted auth when Auth0 env exists', () => {
    const middleware = createRuntimeJwtCheck({
        runtimeModeConfig: { distributionMode: 'hosted' },
        env: {
            AUTH0_DOMAIN: 'example.auth0.com',
            AUTH0_AUDIENCE: 'https://api.example.com',
        },
    });

    assert.equal(typeof middleware, 'function');
});

