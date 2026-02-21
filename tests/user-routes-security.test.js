import assert from 'node:assert/strict';
import test from 'node:test';

import { registerUserRoutes } from '../apps/api/routes/user-routes.js';

function createBaseDeps(overrides = {}) {
  const logger = {
    error: () => {},
    info: () => {},
    warn: () => {},
  };

  return {
    jwtCheck: (req, res, next) => {
      req.auth = { payload: { sub: 'auth|alice', email: 'alice@example.com' } };
      return next();
    },
    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    getUserById: async ({ userId }) => ({ id: userId, tier: 'free', email: 'alice@example.com', name: 'Alice' }),
    getTierFeaturePolicy: () => ({}),
    resolveTier: (tier) => {
      const normalized = String(tier || 'free').toLowerCase();
      return ['free', 'starter', 'pro', 'admin'].includes(normalized) ? normalized : 'free';
    },
    getUserEntitlements: () => ({}),
    getReferralSummary: () => ({}),
    getUserOverageSnapshot: () => ({}),
    createUser: async () => true,
    nowTimestamp: () => ({ toMillis: () => Date.now() }),
    recordInstallation: () => {},
    acceptPolicyDocuments: () => {},
    recordSignupLifecycle: async () => {},
    updateUserTier: async () => {},
    invalidateAdminFallbackTierCache: () => {},
    recordTierUpgrade: async () => {},
    createUsersBuild: async () => ({ id: 'build-1' }),
    addLogEntryToUsersSession: async () => {},
    updateUsersBuild: async () => {},
    addStepsToUsersBuild: async () => {},
    addLogsToUsersBuild: async () => {},
    getUsersBuilds: async () => [],
    logger,
    getUsersBuildById: async () => null,
    getPolicyAcceptance: () => null,
    evaluateRefundEligibility: () => ({ eligible: true }),
    createSubscriptionTicket: () => ({}),
    setRenewalPreference: () => ({}),
    getRenewalPreference: () => ({}),
    setParentalControls: () => ({}),
    getParentalControls: () => ({}),
    recordAttributionEvent: () => ({}),
    createUsersSession: async () => {},
    getOpsDashboardSnapshot: () => ({ activeSessions: 0 }),
    setActiveSessions: () => {},
    updateUsersSession: async () => {},
    ...overrides,
  };
}

function createMockApp() {
  const routes = new Map();
  return {
    get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
    post: (path, ...handlers) => routes.set(`POST ${path}`, handlers),
    put: (path, ...handlers) => routes.set(`PUT ${path}`, handlers),
    routes,
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
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

async function runRouteHandlers(handlers, req, res) {
  let index = 0;
  const next = async (error) => {
    if (error) {
      throw error;
    }
    const handler = handlers[index];
    index += 1;
    if (!handler) {
      return;
    }
    await handler(req, res, next);
  };
  await next();
}

test('POST /user/plan rejects paid tier self-upgrade attempts', async () => {
  const app = createMockApp();
  let updateCalls = 0;
  const deps = createBaseDeps({
    updateUserTier: async () => {
      updateCalls += 1;
    },
  });
  registerUserRoutes(app, deps);
  const handlers = app.routes.get('POST /user/plan');
  const req = {
    body: { tier: 'admin' },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /disabled/i);
  assert.equal(updateCalls, 0);
});

test('GET /user/:userId denies cross-user profile access', async () => {
  const app = createMockApp();
  const deps = createBaseDeps();
  registerUserRoutes(app, deps);
  const handlers = app.routes.get('GET /user/:userId');
  const req = {
    body: {},
    headers: {},
    params: { userId: 'auth|bob' },
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden');
});

test('POST /user/signup ignores body auth0LoginId and binds to token subject', async () => {
  const app = createMockApp();
  let capturedUser = null;
  const deps = createBaseDeps({
    createUser: async ({ user }) => {
      capturedUser = user;
      return true;
    },
  });
  registerUserRoutes(app, deps);
  const handlers = app.routes.get('POST /user/signup');
  const req = {
    body: {
      auth0LoginId: 'auth|attacker',
      email: 'alice@example.com',
      name: 'Alice',
    },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(capturedUser.auth0LoginId, 'auth|alice');
});

test('POST /user/signup rejects request when token email mismatches body email', async () => {
  const app = createMockApp();
  const deps = createBaseDeps();
  registerUserRoutes(app, deps);
  const handlers = app.routes.get('POST /user/signup');
  const req = {
    body: {
      email: 'mallory@example.com',
      name: 'Alice',
    },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Email claim does not match/i);
});
