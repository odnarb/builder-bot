import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runBuildCommandSingleFlight,
  isBuildCommandInFlight,
} from '../apps/bot/command-router.js';

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('runBuildCommandSingleFlight rejects overlapping builds and emits lifecycle logs', async () => {
  const chats = [];
  const lifecycleStates = [];
  const originalFetch = global.fetch;

  global.fetch = async (_url, options = {}) => {
    try {
      const parsed = JSON.parse(options.body || '{}');
      if (parsed?.log?.type === 'command_lifecycle') {
        lifecycleStates.push(parsed.log.message);
      }
    } catch {
      // ignore malformed test payloads
    }

    return {
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
      status: 200,
    };
  };

  const bot = {
    chat: (msg) => chats.push(msg),
  };

  try {
    let releaseFirst;
    const firstRunGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = runBuildCommandSingleFlight({
      bot,
      username: 'Commander',
      commandType: 'build',
      run: async () => {
        await firstRunGate;
      },
    });

    assert.equal(isBuildCommandInFlight(), true);

    const second = await runBuildCommandSingleFlight({
      bot,
      username: 'Commander',
      commandType: 'build',
      run: async () => { },
    });

    assert.equal(second, false);
    assert.equal(
      chats.includes("⏳ I'm already handling another build command. Please wait."),
      true,
    );

    releaseFirst();
    const firstResult = await first;
    assert.equal(firstResult, true);
    assert.equal(isBuildCommandInFlight(), false);

    const third = await runBuildCommandSingleFlight({
      bot,
      username: 'Commander',
      commandType: 'build',
      run: async () => { },
    });
    assert.equal(third, true);
    assert.equal(isBuildCommandInFlight(), false);

    await flushMicrotasks();
    assert.equal(lifecycleStates.includes('queued'), true);
    assert.equal(lifecycleStates.includes('started'), true);
    assert.equal(lifecycleStates.includes('rejected_busy'), true);
    assert.equal(lifecycleStates.includes('finished'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
