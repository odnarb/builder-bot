import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';

import {
  handlePlayerCommand,
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

test('handlePlayerCommand uses local planner for known build prompts without AI request', async () => {
  const fetchUrls = [];
  const chats = [];
  const originalFetch = global.fetch;
  const world = new Map();
  const keyOf = (x, y, z) => `${x},${y},${z}`;

  global.fetch = async (url, options = {}) => {
    fetchUrls.push(String(url));
    assert.equal(String(url).includes('/api/ai-get-structure'), false);

    const body = JSON.parse(options.body || '{}');
    if (String(url).endsWith('/build')) {
      assert.equal(body.build.message, '3 by 2 wooden bridge');
      return {
        ok: true,
        json: async () => ({ buildId: 'local-build-1' }),
        text: async () => '{}',
        status: 200,
      };
    }

    return {
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
      status: 200,
    };
  };

  const bot = new EventEmitter();
  bot.username = 'BuilderBot';
  bot.chat = (msg) => chats.push(msg);
  bot.health = 20;
  bot.food = 20;
  bot.entities = {};
  bot.players = {};
  bot.entity = {
    position: new Vec3(0, 64, 0),
  };
  bot.pathfinder = {
    movements: {},
    setGoal: () => { },
    goto: async () => { },
    getPathTo: () => ({
      status: 'success',
      cost: 1,
      time: 1,
      visitedNodes: 1,
      generatedNodes: 1,
      path: [new Vec3(0, 64, 0)],
    }),
  };
  bot.registry = {
    itemsByName: {
      dirt: { id: 1 },
      oak_planks: { id: 2 },
    },
  };
  bot.creative = {
    clearInventory: async () => { },
    give: async () => { },
  };
  bot.inventory = {
    items: () => [{ name: 'dirt' }, { name: 'oak_planks' }],
  };
  bot.blockAt = (pos) => ({
    name: world.get(keyOf(pos.x, pos.y, pos.z)) || (pos.y <= 63 ? 'dirt' : 'air'),
    position: { x: pos.x, y: pos.y, z: pos.z },
  });
  bot.canDigBlock = () => true;
  bot.dig = async (block) => {
    world.set(keyOf(block.position.x, block.position.y, block.position.z), 'air');
  };
  bot.equip = async () => { };
  bot.lookAt = async () => { };
  bot.placeBlock = async (below, face) => {
    world.set(
      keyOf(
        below.position.x + face.x,
        below.position.y + face.y,
        below.position.z + face.z,
      ),
      'oak_planks',
    );
  };
  bot.waitForTicks = async () => { };

  try {
    await handlePlayerCommand({
      commander: { tier: 'free' },
      bot,
      message: 'build 3 by 2 wooden bridge',
      username: 'Commander',
    });

    assert.equal(fetchUrls.some((url) => url.includes('/api/ai-get-structure')), false);
    assert.equal(chats.includes('Attempting to build...'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
