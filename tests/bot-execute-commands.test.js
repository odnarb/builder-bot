import assert from 'node:assert/strict';
import test from 'node:test';

import { executeCommands } from '../apps/bot/execute-commands.js';

test('executeCommands treats already-correct blocks as success', async () => {
  const chats = [];
  const bot = {
    chat: (text) => chats.push(text),
    pathfinder: {
      setGoal: () => { },
      goto: async () => { },
    },
    blockAt: () => ({ name: 'stone' }),
    inventory: {
      items: () => [],
    },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => { },
    lookAt: async () => { },
    placeBlock: async () => { },
  };

  const result = await executeCommands({
    bot,
    commands: [{ x: 0, y: 64, z: 0, block: 'minecraft:stone' }],
  });

  assert.equal(result.success, true);
  assert.equal(chats.includes('📐 Build complete!'), true);
});

test('executeCommands reports partial failures when placements fail', async () => {
  const chats = [];
  const bot = {
    chat: (text) => chats.push(text),
    pathfinder: {
      setGoal: () => { },
      goto: async () => { },
    },
    blockAt: (pos) => {
      if (pos.y === 63) {
        return { name: 'stone' };
      }
      return { name: 'air' };
    },
    inventory: {
      items: () => [],
    },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => { },
    lookAt: async () => { },
    placeBlock: async () => { },
  };

  const result = await executeCommands({
    bot,
    commands: [{ x: 0, y: 64, z: 0, block: 'minecraft:stone' }],
  });

  assert.equal(result.success, false);
  assert.equal(
    chats.includes('⚠️ Build finished with some errors. Check logs for details.'),
    true,
  );
});

test('executeCommands runs mixed move/place/stop flow and preserves action order', async () => {
  const setGoalCalls = [];
  const operationOrder = [];
  const chats = [];

  const bot = {
    chat: (text) => chats.push(text),
    once: (eventName, cb) => {
      if (eventName === 'goal_reached') {
        setImmediate(cb);
      }
    },
    players: {
      Commander: { entity: { id: 'commander-entity' } },
    },
    pathfinder: {
      setGoal: (goal, dynamic) => {
        setGoalCalls.push({ goal, dynamic: Boolean(dynamic) });
      },
      goto: async () => {
        operationOrder.push('goto');
      },
    },
    blockAt: (pos) => {
      if (pos.y === 63) {
        return { name: 'stone' };
      }
      return { name: 'air' };
    },
    inventory: {
      items: () => [{ name: 'dirt' }],
    },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => {
      operationOrder.push('equip');
    },
    lookAt: async () => {
      operationOrder.push('lookAt');
    },
    placeBlock: async () => {
      operationOrder.push('placeBlock');
    },
  };

  const result = await executeCommands({
    bot,
    username: 'Commander',
    commands: [
      { type: 'move_to', x: 1, y: 64, z: 1 },
      { x: 0, y: 64, z: 0, block: 'minecraft:dirt' },
      { type: 'stop' },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(chats.includes('📐 Build complete!'), true);
  assert.equal(setGoalCalls.length >= 2, true);
  assert.equal(operationOrder.includes('placeBlock'), true);
  assert.equal(operationOrder.indexOf('equip') < operationOrder.indexOf('placeBlock'), true);
});

test('executeCommands follow action resolves "commander" alias to runtime username', async () => {
  const setGoalCalls = [];
  const bot = {
    chat: () => { },
    players: {
      Alice: {
        entity: {
          id: 'alice-entity',
          position: { x: 0, y: 64, z: 0 },
        },
      },
    },
    pathfinder: {
      setGoal: (goal, dynamic) => {
        setGoalCalls.push({ goal, dynamic: Boolean(dynamic) });
      },
      goto: async () => { },
    },
    once: () => { },
    blockAt: () => ({ name: 'air' }),
    inventory: { items: () => [] },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => { },
    lookAt: async () => { },
    placeBlock: async () => { },
  };

  const result = await executeCommands({
    bot,
    username: 'Alice',
    commands: [
      { type: 'follow', target: 'commander', distance: 4 },
      { type: 'stop' },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(setGoalCalls.length, 2);
  assert.equal(setGoalCalls[0].dynamic, true);
});

test('executeCommands flatten_area clears headroom and places fill blocks', async () => {
  const chats = [];
  const world = new Map();
  const keyOf = (x, y, z) => `${x},${y},${z}`;
  const setBlock = (x, y, z, name) => world.set(keyOf(x, y, z), name);
  const getBlock = (x, y, z) => world.get(keyOf(x, y, z)) || 'air';

  for (let x = 0; x < 2; x += 1) {
    for (let z = 0; z < 2; z += 1) {
      setBlock(x, 63, z, 'stone');
      setBlock(x, 65, z, 'stone');
    }
  }

  const bot = {
    chat: (text) => chats.push(text),
    pathfinder: {
      setGoal: () => { },
      goto: async () => { },
    },
    blockAt: (pos) => ({
      name: getBlock(pos.x, pos.y, pos.z),
      position: { x: pos.x, y: pos.y, z: pos.z },
    }),
    canDigBlock: () => true,
    dig: async (block) => {
      setBlock(block.position.x, block.position.y, block.position.z, 'air');
    },
    inventory: {
      items: () => [{ name: 'dirt' }],
    },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => { },
    lookAt: async () => { },
    placeBlock: async (below, face) => {
      setBlock(
        below.position.x + face.x,
        below.position.y + face.y,
        below.position.z + face.z,
        'dirt',
      );
    },
  };

  const result = await executeCommands({
    bot,
    commands: [{
      type: 'flatten_area',
      x: 0,
      y: 64,
      z: 0,
      width: 2,
      length: 2,
      targetY: 64,
      fillBlock: 'minecraft:dirt',
    }],
    decisionPolicy: {
      maxPrepEdits: 32,
    },
  });

  assert.equal(result.success, true);
  assert.equal(getBlock(0, 65, 0), 'air');
  assert.equal(getBlock(0, 64, 0), 'dirt');
  assert.equal(getBlock(1, 64, 1), 'dirt');
  assert.equal(chats.includes('📐 Build complete!'), true);
});

test('executeCommands clear_volume respects tier prep edit caps', async () => {
  const chats = [];
  const keyOf = (x, y, z) => `${x},${y},${z}`;
  const world = new Map();
  const setBlock = (x, y, z, name) => world.set(keyOf(x, y, z), name);
  const getBlock = (x, y, z) => world.get(keyOf(x, y, z)) || 'air';

  for (let x = 0; x < 3; x += 1) {
    for (let y = 64; y < 67; y += 1) {
      for (let z = 0; z < 3; z += 1) {
        setBlock(x, y, z, 'stone');
      }
    }
  }

  const bot = {
    chat: (text) => chats.push(text),
    pathfinder: {
      setGoal: () => { },
      goto: async () => { },
    },
    blockAt: (pos) => ({
      name: getBlock(pos.x, pos.y, pos.z),
      position: { x: pos.x, y: pos.y, z: pos.z },
    }),
    canDigBlock: () => true,
    dig: async (block) => {
      setBlock(block.position.x, block.position.y, block.position.z, 'air');
    },
    inventory: {
      items: () => [],
    },
    entity: {
      position: {
        floored: () => ({ equals: () => false }),
        distanceTo: () => 0,
      },
    },
    equip: async () => { },
    lookAt: async () => { },
    placeBlock: async () => { },
  };

  const result = await executeCommands({
    bot,
    commands: [{
      type: 'clear_volume',
      x: 0,
      y: 64,
      z: 0,
      width: 3,
      height: 3,
      length: 3,
    }],
    decisionPolicy: {
      maxPrepEdits: 5,
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.logs.some((entry) => entry.code === 'ERR_PREP_LIMIT'), true);
  assert.equal(chats.includes('⚠️ Build finished with some errors. Check logs for details.'), true);
});
