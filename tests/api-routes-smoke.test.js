import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const apiModuleUrl = pathToFileURL(path.resolve('apps/api/index.js')).href;
const REQUIRED_ENV = {
  AUTH0_DOMAIN: 'example.auth0.com',
  AUTH0_AUDIENCE: 'https://api.example.com',
  OPENAI_API_KEY: 'test-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
};

/**
 * Import API app with required auth/provider env set for bootstrap.
 * @returns {Promise<{ app: import('express').Express }>}
 */
async function importApiApp() {
  const previous = Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = value;
  }

  try {
    return await import(`${apiModuleUrl}?cacheBust=${Date.now()}-${Math.random()}`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Start app on an ephemeral port.
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
async function startServer() {
  const { app } = await importApiApp();

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

test('GET / returns API heartbeat', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /API is running/i);
  } finally {
    await server.close();
  }
});

test('POST /ai-get-structure requires auth', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/ai-get-structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized');
  } finally {
    await server.close();
  }
});

test('GET /user/tier requires auth', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/user/tier`);

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('GET /admin/ops-dashboard requires admin auth', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/admin/ops-dashboard`);

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('read-only admin dashboard endpoints require auth', async () => {
  const server = await startServer();
  const paths = [
    '/admin/margin-alerts',
    '/admin/emergency-guard',
    '/admin/pre-scale-telemetry',
    '/admin/performance-profile',
    '/admin/pre-scale/simulations',
    '/admin/conversion-funnel',
    '/admin/analytics/attribution',
    '/admin/analytics/referrals',
  ];

  try {
    for (const path of paths) {
      const response = await fetch(`${server.baseUrl}${path}`);
      assert.equal(response.status, 401, path);
    }
  } finally {
    await server.close();
  }
});

test('GET /config/skus returns catalog shape', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/config/skus`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.skus));
  } finally {
    await server.close();
  }
});

test('GET /config/localization returns supported UI locales', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/config/localization`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.defaultLocale, 'en');
    assert.deepEqual(payload.supportedLocales, ['en', 'es', 'pt', 'fr']);
  } finally {
    await server.close();
  }
});
