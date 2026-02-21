import assert from 'node:assert/strict';
import test from 'node:test';

import { createSecurityDeniedAuditMiddleware } from '../apps/api/middleware/security-denied-audit.js';

function createMockResponse() {
  return {
    statusCode: 200,
    locals: {},
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createRequest(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/test',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    auth: undefined,
    get: (name) => (String(name).toLowerCase() === 'user-agent' ? 'unit-test-agent' : undefined),
    ...overrides,
  };
}

test('security denied audit middleware records denied_authn events for 401 JSON responses', () => {
  const events = [];
  const middleware = createSecurityDeniedAuditMiddleware({
    recordSecurityAuditEvent: (event) => events.push(event),
  });
  const req = createRequest({
    originalUrl: '/user/tier',
    auth: { payload: { sub: 'auth|alice' } },
  });
  const res = createMockResponse();
  res.statusCode = 401;
  res.locals.securityAuditDeniedReason = 'UnauthorizedError';

  middleware(req, res, () => {});
  res.json({
    error: 'Unauthorized',
    message: 'Missing or invalid access token.',
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'denied_authn');
  assert.equal(events[0].userKey, 'auth:auth|alice');
  assert.equal(events[0].context.statusCode, 401);
  assert.equal(events[0].context.path, '/user/tier');
  assert.equal(events[0].context.reason, 'UnauthorizedError');
});

test('security denied audit middleware records denied_authz events for 403 JSON responses', () => {
  const events = [];
  const middleware = createSecurityDeniedAuditMiddleware({
    recordSecurityAuditEvent: (event) => events.push(event),
  });
  const req = createRequest({
    originalUrl: '/admin/ops-dashboard',
  });
  const res = createMockResponse();
  res.statusCode = 403;
  res.locals.securityAuditDeniedReason = 'admin_tier_required';

  middleware(req, res, () => {});
  res.json({
    error: 'Forbidden',
    message: 'Admin access is required.',
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'denied_authz');
  assert.equal(events[0].userKey, null);
  assert.equal(events[0].context.statusCode, 403);
  assert.equal(events[0].context.path, '/admin/ops-dashboard');
  assert.equal(events[0].context.reason, 'admin_tier_required');
});

test('security denied audit middleware ignores non-auth status responses', () => {
  const events = [];
  const middleware = createSecurityDeniedAuditMiddleware({
    recordSecurityAuditEvent: (event) => events.push(event),
  });
  const req = createRequest({ originalUrl: '/config/skus' });
  const res = createMockResponse();
  res.statusCode = 200;

  middleware(req, res, () => {});
  res.json({ ok: true });

  assert.equal(events.length, 0);
});
