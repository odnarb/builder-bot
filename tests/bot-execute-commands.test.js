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
