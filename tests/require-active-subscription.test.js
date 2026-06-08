import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequireActiveSubscription } from '../apps/api/middleware/require-active-subscription.js';

function createAsyncHandler() {
    return (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function createMockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

async function runMiddleware(middleware, req, res) {
    let nextCalled = false;
    await middleware(req, res, (error) => {
        if (error) {
            throw error;
        }
        nextCalled = true;
    });
    return nextCalled;
}

test('requireActiveSubscription bypasses gate when billing is disabled', async () => {
    const middleware = createRequireActiveSubscription({
        asyncHandler: createAsyncHandler(),
        getUserById: async () => {
            throw new Error('should not fetch user');
        },
        resolveTier: () => 'free',
        runtimeModeConfig: { billingEnabled: false },
    });
    const req = {};
    const res = createMockResponse();

    const nextCalled = await runMiddleware(middleware, req, res);

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test('requireActiveSubscription requires auth subject when hosted billing is enabled', async () => {
    const middleware = createRequireActiveSubscription({
        asyncHandler: createAsyncHandler(),
        getUserById: async () => null,
        resolveTier: () => 'free',
        runtimeModeConfig: { billingEnabled: true },
    });
    const req = {};
    const res = createMockResponse();

    const nextCalled = await runMiddleware(middleware, req, res);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'AUTHENTICATION_REQUIRED');
});

test('requireActiveSubscription blocks hosted free tier users', async () => {
    const warnings = [];
    const middleware = createRequireActiveSubscription({
        asyncHandler: createAsyncHandler(),
        getUserById: async ({ userId }) => ({ id: userId, tier: 'free' }),
        resolveTier: (tier) => tier,
        runtimeModeConfig: { billingEnabled: true },
        logger: {
            warn: (message, context) => warnings.push({ message, context }),
        },
    });
    const req = { auth: { payload: { sub: 'auth|free-user' } } };
    const res = createMockResponse();

    const nextCalled = await runMiddleware(middleware, req, res);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.code, 'SUBSCRIPTION_REQUIRED');
    assert.equal(warnings.length, 1);
});

test('requireActiveSubscription allows hosted paid tier users', async () => {
    const middleware = createRequireActiveSubscription({
        asyncHandler: createAsyncHandler(),
        getUserById: async ({ userId }) => ({ id: userId, tier: 'starter' }),
        resolveTier: (tier) => tier,
        runtimeModeConfig: { billingEnabled: true },
    });
    const req = { auth: { payload: { sub: 'auth|paid-user' } } };
    const res = createMockResponse();

    const nextCalled = await runMiddleware(middleware, req, res);

    assert.equal(nextCalled, true);
    assert.equal(req.builderBotEntitlement.tier, 'starter');
});

test('requireActiveSubscription returns safe error when entitlement lookup fails', async () => {
    const errors = [];
    const middleware = createRequireActiveSubscription({
        asyncHandler: createAsyncHandler(),
        getUserById: async () => {
            throw new Error('database unavailable');
        },
        resolveTier: (tier) => tier,
        runtimeModeConfig: { billingEnabled: true },
        logger: {
            error: (message, context) => errors.push({ message, context }),
        },
    });
    const req = { auth: { payload: { sub: 'auth|lookup-failure' } } };
    const res = createMockResponse();

    const nextCalled = await runMiddleware(middleware, req, res);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'SUBSCRIPTION_CHECK_FAILED');
    assert.equal(res.body.message, 'Failed to verify subscription. Please try again.');
    assert.equal(errors.length, 1);
});

