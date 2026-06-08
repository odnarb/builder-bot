import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

/**
 * Create an isolated SQLite path for app context tests.
 * @returns {string} Temporary SQLite path.
 */
function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-app-context-')), 'local.sqlite');
}

test('createAppContext wires route deps and middleware factories', async () => {
  const previous = Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((key) => [key, process.env[key]]),
  );
  previous.BUILDERBOT_SQLITE_PATH = process.env.BUILDERBOT_SQLITE_PATH;

  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = value;
  }
  process.env.BUILDERBOT_SQLITE_PATH = createTempSqlitePath();

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
    assert.equal(typeof context.routeDeps.requireActiveSubscription, 'function');
    assert.equal(typeof context.routeDeps.logger?.info, 'function');
    assert.deepEqual(context.routeDeps.runtimeModeConfig, {
      distributionMode: 'local',
      billingGateMode: 'disabled',
      billingEnabled: false,
      persistenceMode: 'sqlite',
      entitlementMode: 'free_open_source',
      localDefaultTier: 'admin',
    });
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

test('createAppContext defaults jwtCheck to local auth without Auth0 env', async () => {
  const envKeys = ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'AUTH0_DOMAIN', 'AUTH0_AUDIENCE'];
  const previous = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  previous.BUILDERBOT_SQLITE_PATH = process.env.BUILDERBOT_SQLITE_PATH;

  process.env.OPENAI_API_KEY = 'test-key';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  delete process.env.AUTH0_DOMAIN;
  delete process.env.AUTH0_AUDIENCE;
  delete process.env.BUILDERBOT_DISTRIBUTION_MODE;
  process.env.BUILDERBOT_SQLITE_PATH = createTempSqlitePath();

  try {
    const { createAppContext } = await import(`${appContextModuleUrl}?cacheBust=${Date.now()}-${Math.random()}`);
    const context = createAppContext();
    const req = {};
    let nextCalled = false;

    await context.jwtCheck(req, {}, (error) => {
      if (error) {
        throw error;
      }
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.payload.sub, 'local:default');
    assert.equal(req.auth.payload.email, 'local@builderbot.local');

    const localUser = await context.routeDeps.getUserById({ userId: 'local:default' });
    assert.equal(localUser.tier, 'admin');
    assert.equal(localUser.email, 'local@builderbot.local');

    await context.routeDeps.createUsersSession({
      userId: 'local:default',
      sessionId: 'context-session-1',
      sessionStart: { status: 'started' },
    });
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
