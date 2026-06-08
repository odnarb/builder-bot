import assert from 'node:assert/strict';
import test from 'node:test';

import { registerAiRoutes } from '../apps/api/routes/ai-routes.js';

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

function createAsyncHandler() {
  return (fn) => (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

test('POST /ai-get-structure rejects unauthenticated requests', async () => {
  const app = createMockApp();
  const deps = {
    jwtCheck: (req, res, next) => res.status(401).json({ error: 'Unauthorized' }),
    asyncHandler: createAsyncHandler(),
    getUserById: async () => ({ id: 'auth|test-user', tier: 'free' }),
    resolveTier: (tier) => String(tier || 'free').toLowerCase(),
    resolveAiUsageKey: () => 'auth:ignored',
    createAiGetStructureHandler: () => async () => ({ status: 200, body: { ok: true } }),
  };
  registerAiRoutes(app, deps);
  const handlers = app.routes.get('POST /ai-get-structure');
  const req = {
    body: { message: 'build a tower' },
    headers: {},
    ip: '127.0.0.1',
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('POST /ai-get-structure ignores caller tier and uses persisted user tier', async () => {
  const app = createMockApp();
  let capturedParams = null;
  const deps = {
    jwtCheck: (req, res, next) => {
      req.auth = { payload: { sub: 'auth|alice' } };
      return next();
    },
    asyncHandler: createAsyncHandler(),
    getUserById: async ({ userId }) => ({ id: userId, tier: 'free' }),
    resolveTier: (tier) => {
      const normalized = String(tier || 'free').toLowerCase();
      return ['free', 'starter', 'pro', 'admin'].includes(normalized) ? normalized : 'free';
    },
    resolveAiUsageKey: (req, tier) => `auth:${req.auth?.payload?.sub}:${tier}`,
    createAiGetStructureHandler: () => async (params) => {
      capturedParams = params;
      return { status: 200, body: { ok: true } };
    },
  };
  registerAiRoutes(app, deps);
  const handlers = app.routes.get('POST /ai-get-structure');
  const req = {
    body: {
      message: 'build a castle',
      tier: 'admin',
    },
    headers: { authorization: 'Bearer test' },
    ip: '127.0.0.1',
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(capturedParams.rawTier, 'free');
  assert.equal(capturedParams.usageKey, 'auth:auth|alice:free');
  assert.equal(capturedParams.authUserId, 'auth|alice');
});

test('POST /ai-get-structure applies active subscription gate before AI handler', async () => {
  const app = createMockApp();
  let aiHandlerCalled = false;
  const deps = {
    jwtCheck: (req, res, next) => {
      req.auth = { payload: { sub: 'auth|free-hosted-user' } };
      return next();
    },
    requireActiveSubscription: (_req, res) => res.status(402).json({
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Choose a plan to continue.',
    }),
    asyncHandler: createAsyncHandler(),
    getUserById: async ({ userId }) => ({ id: userId, tier: 'free' }),
    resolveTier: (tier) => String(tier || 'free').toLowerCase(),
    resolveAiUsageKey: () => 'auth:ignored',
    createAiGetStructureHandler: () => async () => {
      aiHandlerCalled = true;
      return { status: 200, body: { ok: true } };
    },
  };
  registerAiRoutes(app, deps);
  const handlers = app.routes.get('POST /ai-get-structure');
  const req = {
    body: { message: 'build a hosted tower' },
    headers: { authorization: 'Bearer test' },
    ip: '127.0.0.1',
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, 'SUBSCRIPTION_REQUIRED');
  assert.equal(aiHandlerCalled, false);
});

test('POST /ai-get-structure keeps persisted tier on patch-replan requests', async () => {
  const app = createMockApp();
  let capturedParams = null;
  const deps = {
    jwtCheck: (req, _res, next) => {
      req.auth = { payload: { sub: 'auth|builder' } };
      return next();
    },
    asyncHandler: createAsyncHandler(),
    getUserById: async ({ userId }) => ({ id: userId, tier: 'free' }),
    resolveTier: (tier) => {
      const normalized = String(tier || 'free').toLowerCase();
      return ['free', 'starter', 'pro', 'admin'].includes(normalized) ? normalized : 'free';
    },
    resolveAiUsageKey: (req, tier) => `auth:${req.auth?.payload?.sub}:${tier}`,
    createAiGetStructureHandler: () => async (params) => {
      capturedParams = params;
      return { status: 200, body: { ok: true } };
    },
  };
  registerAiRoutes(app, deps);
  const handlers = app.routes.get('POST /ai-get-structure');
  const req = {
    body: {
      message: 'build patch plan',
      tier: 'admin',
      context: {
        triggerReason: 'build_failure',
        identity: { tier: 'admin' },
        taskState: {
          patchPlan: { mode: 'patch_replan', replanAttempt: 2 },
        },
      },
    },
    headers: { authorization: 'Bearer test' },
    ip: '127.0.0.1',
  };
  const res = createMockResponse();

  await runRouteHandlers(handlers, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(capturedParams.rawTier, 'free');
  assert.equal(capturedParams.usageKey, 'auth:auth|builder:free');
  assert.equal(capturedParams.authUserId, 'auth|builder');
});
