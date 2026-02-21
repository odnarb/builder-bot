import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const appContextModuleUrl = pathToFileURL(path.resolve('apps/api/app-context.js')).href;
const REQUIRED_ENV = {
  OPENAI_API_KEY: 'test-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
  AUTH0_DOMAIN: 'example.auth0.com',
  AUTH0_AUDIENCE: 'https://api.example.com',
};

test('createAppContext wires route deps and middleware factories', async () => {
  const previous = Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = value;
  }

  try {
    const { createAppContext } = await import(`${appContextModuleUrl}?cacheBust=${Date.now()}-${Math.random()}`);
    const context = createAppContext();

    assert.equal(typeof context.asyncHandler, 'function');
    assert.equal(typeof context.jwtCheck, 'function');
    assert.equal(typeof context.requireAdminAccess, 'function');

    assert.equal(typeof context.routeDeps.resolveTier, 'function');
    assert.equal(typeof context.routeDeps.getTierAiPolicy, 'function');
    assert.equal(typeof context.routeDeps.recordUsageMetering, 'function');
    assert.equal(typeof context.routeDeps.evaluateCurrentEmergencyMarginGuard, 'function');
    assert.equal(typeof context.routeDeps.createAiGetStructureHandler, 'function');
    assert.equal(typeof context.routeDeps.claimCheckoutConfirmationSession, 'function');
    assert.equal(typeof context.routeDeps.logger?.info, 'function');
    assert.equal(context.routeDeps.FREE_TIER_THROTTLE_ERROR_CODE, 'FREE_TIER_THROTTLED_GUARD_ACTIVE');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
