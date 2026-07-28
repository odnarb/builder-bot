import assert from 'node:assert/strict';
import test from 'node:test';

import { registerStripeRoutes } from '../apps/api/routes/stripe-routes.js';

function createDeps(overrides = {}) {
  const claimedSessions = new Set();
  const stripeSession = {
    id: 'cs_test_123',
    status: 'complete',
    mode: 'subscription',
    payment_status: 'paid',
    metadata: {
      userId: 'auth|alice',
      tier: 'pro',
      skuCode: 'pro_monthly',
      termsVersion: '2026-02',
      privacyVersion: '2026-02',
    },
    subscription: {
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      cancel_at_period_end: false,
    },
  };

  return {
    jwtCheck: (req, res, next) => {
      req.auth = { payload: { sub: 'auth|alice' } };
      return next();
    },
    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    stripe: {
      products: {
        list: async () => ({ data: [] }),
      },
      checkout: {
        sessions: {
          create: async () => ({ url: 'https://example.test/checkout' }),
          retrieve: async () => ({ ...stripeSession }),
        },
      },
    },
    getPolicyAcceptance: () => ({ termsVersion: '2026-02', privacyVersion: '2026-02' }),
    resolveCheckoutSku: () => ({ code: 'pro_monthly', tier: 'pro', kind: 'subscription' }),
    acceptPolicyDocuments: () => {},
    getUserById: async ({ userId }) => ({ id: userId, tier: 'free' }),
    recordCheckoutStarted: async () => {},
    resolveTier: (tier) => {
      const normalized = String(tier || 'free').toLowerCase();
      return ['free', 'starter', 'pro', 'admin'].includes(normalized) ? normalized : 'free';
    },
    updateUserTier: async () => {},
    invalidateAdminFallbackTierCache: () => {},
    recordTierUpgrade: async () => {},
    setRenewalPreference: () => {},
    getRenewalPreference: () => ({}),
    claimCheckoutConfirmationSession: async ({ sessionId }) => {
      const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
      if (!normalizedSessionId) {
        return false;
      }
      if (claimedSessions.has(normalizedSessionId)) {
        return false;
      }
      claimedSessions.add(normalizedSessionId);
      return true;
    },
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
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
    set(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
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

test('Stripe routes are omitted when billing has no provider', () => {
  const app = createMockApp();

  registerStripeRoutes(app, createDeps({ stripe: null }));

  assert.equal(app.routes.size, 0);
});

test('POST /stripe/confirm-checkout rejects session ownership mismatch', async () => {
  const app = createMockApp();
  let updateCalls = 0;
  const deps = createDeps({
    stripe: {
      checkout: {
        sessions: {
          retrieve: async () => ({
            status: 'complete',
            mode: 'payment',
            payment_status: 'paid',
            metadata: {
              userId: 'auth|someone-else',
              tier: 'pro',
              termsVersion: '2026-02',
              privacyVersion: '2026-02',
            },
          }),
        },
      },
    },
    updateUserTier: async () => {
      updateCalls += 1;
    },
  });
  registerStripeRoutes(app, deps);
  const handlers = app.routes.get('POST /stripe/confirm-checkout');
  const req = {
    body: { sessionId: 'cs_wrong_owner' },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /does not belong/i);
  assert.equal(updateCalls, 0);
});

test('POST /stripe/confirm-checkout rejects unpaid checkout sessions', async () => {
  const app = createMockApp();
  let updateCalls = 0;
  const deps = createDeps({
    stripe: {
      checkout: {
        sessions: {
          retrieve: async () => ({
            status: 'open',
            mode: 'payment',
            payment_status: 'unpaid',
            metadata: {
              userId: 'auth|alice',
              tier: 'starter',
              termsVersion: '2026-02',
              privacyVersion: '2026-02',
            },
          }),
        },
      },
    },
    updateUserTier: async () => {
      updateCalls += 1;
    },
  });
  registerStripeRoutes(app, deps);
  const handlers = app.routes.get('POST /stripe/confirm-checkout');
  const req = {
    body: { sessionId: 'cs_unpaid' },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /not completed|not settled/i);
  assert.equal(updateCalls, 0);
});

test('POST /stripe/confirm-checkout blocks replay after successful confirmation', async () => {
  const app = createMockApp();
  let updateCalls = 0;
  const deps = createDeps({
    updateUserTier: async () => {
      updateCalls += 1;
    },
  });
  registerStripeRoutes(app, deps);
  const handlers = app.routes.get('POST /stripe/confirm-checkout');

  const firstReq = {
    body: { sessionId: 'cs_replay_guard' },
    headers: {},
  };
  const firstRes = createMockResponse();
  await runRouteHandlers(handlers, firstReq, firstRes);
  assert.equal(firstRes.statusCode, 200);
  assert.equal(firstRes.body.status, 'success');
  assert.equal(updateCalls, 1);

  const secondReq = {
    body: { sessionId: 'cs_replay_guard' },
    headers: {},
  };
  const secondRes = createMockResponse();
  await runRouteHandlers(handlers, secondReq, secondRes);
  assert.equal(secondRes.statusCode, 409);
  assert.match(secondRes.body.error, /already been processed/i);
  assert.equal(updateCalls, 1);
});

test('POST /stripe/confirm-checkout rejects when confirmation idempotency claim is denied', async () => {
  const app = createMockApp();
  let updateCalls = 0;
  const deps = createDeps({
    claimCheckoutConfirmationSession: async () => false,
    updateUserTier: async () => {
      updateCalls += 1;
    },
  });
  registerStripeRoutes(app, deps);
  const handlers = app.routes.get('POST /stripe/confirm-checkout');
  const req = {
    body: { sessionId: 'cs_already_processed_elsewhere' },
    headers: {},
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /already been processed/i);
  assert.equal(updateCalls, 0);
});
