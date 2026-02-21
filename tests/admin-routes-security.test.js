import assert from 'node:assert/strict';
import test from 'node:test';

import { registerAdminRoutes } from '../apps/api/routes/admin-routes.js';

function createMockApp() {
  const routes = new Map();
  return {
    get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
    post: (path, ...handlers) => routes.set(`POST ${path}`, handlers),
    routes,
  };
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

function createDeps(overrides = {}) {
  return {
    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    evaluateOpsAlerts: () => ({ alerts: [], stats: { requestCount: 0 } }),
    evaluateCurrentEmergencyMarginGuard: async () => ({ state: { active: false } }),
    getEmergencyGuardAlertValue: () => ({ active: true }),
    isPersistentEconomicsEnabled: async () => false,
    evaluateIncidentNotifications: ({ alerts }) => alerts,
    ...overrides,
  };
}

function restorePersistenceMode(originalValue) {
  if (originalValue === undefined) {
    delete process.env.PRE_SCALE_PERSISTENCE_MODE;
    return;
  }
  process.env.PRE_SCALE_PERSISTENCE_MODE = originalValue;
}

test('GET /admin/ops-alerts emits persistence fallback alert when firestore mode is configured but unavailable', async () => {
  const originalPersistenceMode = process.env.PRE_SCALE_PERSISTENCE_MODE;
  process.env.PRE_SCALE_PERSISTENCE_MODE = 'firestore';

  try {
    const app = createMockApp();
    registerAdminRoutes(app, createDeps({
      isPersistentEconomicsEnabled: async () => false,
    }));

    const handlers = app.routes.get('GET /admin/ops-alerts');
    const req = { query: {}, body: {} };
    const res = createMockResponse();

    await runRouteHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    const alertCodes = (res.body.alerts || []).map((alert) => alert.code);
    assert.ok(alertCodes.includes('persistence_fallback_active'));
  } finally {
    restorePersistenceMode(originalPersistenceMode);
  }
});

test('GET /admin/ops-alerts does not emit persistence fallback alert when persistence is active', async () => {
  const originalPersistenceMode = process.env.PRE_SCALE_PERSISTENCE_MODE;
  process.env.PRE_SCALE_PERSISTENCE_MODE = 'firestore';

  try {
    const app = createMockApp();
    registerAdminRoutes(app, createDeps({
      isPersistentEconomicsEnabled: async () => true,
    }));

    const handlers = app.routes.get('GET /admin/ops-alerts');
    const req = { query: {}, body: {} };
    const res = createMockResponse();

    await runRouteHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    const alertCodes = (res.body.alerts || []).map((alert) => alert.code);
    assert.ok(!alertCodes.includes('persistence_fallback_active'));
  } finally {
    restorePersistenceMode(originalPersistenceMode);
  }
});
