import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const apiClientModuleUrl = pathToFileURL(path.resolve('apps/bot/apiClient.js')).href;
const ENV_KEYS = ['API_URL', 'AUTH_TOKEN', 'SESSION_ID'];

async function importApiClientWithEnv(overrides = {}) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    if (Object.hasOwn(overrides, key)) {
      process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  }

  try {
    return await import(`${apiClientModuleUrl}?cacheBust=${Date.now()}-${Math.random()}`);
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test('getStructureAndTagsFromAI uses API_URL constant fallback and returns model payload', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  let requestedOptions;

  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { blocksAndTags: '{"blocks":[],"tags":[]}' };
      },
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { getStructureAndTagsFromAI } = await importApiClientWithEnv({});
  const result = await getStructureAndTagsFromAI('build a house');

  assert.equal(requestedUrl, 'http://localhost:3001/api/ai-get-structure');
  assert.equal(requestedOptions.method, 'POST');
  assert.deepEqual(JSON.parse(requestedOptions.body), { message: 'build a house' });
  assert.equal(result, '{"blocks":[],"tags":[]}');
});

test('getStructureAndTagsFromAI throws for non-OK API responses', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return 'backend exploded';
    },
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { getStructureAndTagsFromAI } = await importApiClientWithEnv({});

  await assert.rejects(
    () => getStructureAndTagsFromAI('test'),
    /Generate structure failed: 500 - backend exploded/,
  );
});

test('createSession validates session payload', async () => {
  const { createSession } = await importApiClientWithEnv({});
  await assert.rejects(() => createSession({}), /Missing session/);
});

test('createUserBuild posts to session build endpoint and returns buildId', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  let requestedOptions;

  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { buildId: 'build-123' };
      },
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { createUserBuild } = await importApiClientWithEnv({
    API_URL: 'https://api.example.com',
    AUTH_TOKEN: 'test-token',
    SESSION_ID: 'session-abc',
  });

  const buildId = await createUserBuild({ build: { name: 'house' } });

  assert.equal(requestedUrl, 'https://api.example.com/api/user/session/session-abc/build');
  assert.equal(requestedOptions.method, 'POST');
  assert.deepEqual(JSON.parse(requestedOptions.body), { build: { name: 'house' } });
  assert.equal(buildId, 'build-123');
});

test('updateUserBuild validates required arguments', async () => {
  const { updateUserBuild } = await importApiClientWithEnv({});
  await assert.rejects(() => updateUserBuild({ buildId: '', build: null }), /Missing buildId or build data/);
});

test('endSession uses envVars values for URL and auth header', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  let requestedOptions;

  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { success: true };
      },
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { endSession } = await importApiClientWithEnv({});
  const response = await endSession({
    envVars: {
      API_URL: 'https://end.example.com',
      SESSION_ID: 'session-999',
      AUTH_TOKEN: 'end-token',
    },
    session: { exit_code: 0 },
  });

  assert.equal(requestedUrl, 'https://end.example.com/api/user/session/session-999');
  assert.equal(requestedOptions.method, 'PUT');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer end-token');
  assert.deepEqual(response, { success: true });
});
