import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInstructionPlanStats,
  isCommandBlock,
  normalizeInstructionPlan,
  optimizeInstructionPlan,
  toLegacyBlocksAndTags,
} from '../apps/shared-utils/instruction-schema.js';

test('normalizeInstructionPlan supports legacy blocks payload with mixed actions', () => {
  const plan = normalizeInstructionPlan({
    blocks: [
      { x: 0, y: 0, z: 0, block: 'oak_planks' },
      { type: 'move_to', x: 3, y: 2, z: -1 },
      { x: 1, y: 0, z: 0, block: 'minecraft:stone' },
    ],
    tags: ['house'],
  });

  assert.equal(plan.schemaVersion, '1.0');
  assert.equal(plan.actions.length, 3);
  assert.equal(plan.actions[0].type, 'place_block');
  assert.equal(plan.actions[0].block, 'minecraft:oak_planks');
  assert.equal(plan.actions[1].type, 'move_to');
  assert.equal(plan.tags[0], 'house');
});

test('optimizeInstructionPlan collapses adjacent move actions', () => {
  const plan = normalizeInstructionPlan({
    actions: [
      { type: 'move_to', x: 1, y: 2, z: 3 },
      { type: 'move_to', x: 9, y: 9, z: 9 },
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'stone' },
    ],
  });

  const optimized = optimizeInstructionPlan(plan);
  assert.equal(optimized.actions.length, 2);
  assert.deepEqual(optimized.actions[0], { type: 'move_to', x: 9, y: 9, z: 9 });
});

test('toLegacyBlocksAndTags keeps backward-compatible shape', () => {
  const plan = normalizeInstructionPlan({
    actions: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'stone' },
      { type: 'stop' },
    ],
    tags: ['demo'],
  });
  const legacy = toLegacyBlocksAndTags(plan);

  assert.equal(Array.isArray(legacy.blocks), true);
  assert.equal(legacy.blocks[0].block, 'minecraft:stone');
  assert.equal(legacy.blocks[1].type, 'stop');
  assert.deepEqual(legacy.tags, ['demo']);
});

test('getInstructionPlanStats returns action counts', () => {
  const plan = normalizeInstructionPlan({
    actions: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'stone' },
      { type: 'move_to', x: 1, y: 2, z: 3 },
      { type: 'follow', target: 'Commander', distance: 2 },
      { type: 'stop' },
    ],
  });
  const stats = getInstructionPlanStats(plan);

  assert.equal(stats.actionCount, 4);
  assert.equal(stats.placeBlockCount, 1);
  assert.equal(stats.moveCount, 1);
  assert.equal(stats.followCount, 1);
  assert.equal(stats.stopCount, 1);
});

test('isCommandBlock identifies command block variants', () => {
  assert.equal(isCommandBlock('minecraft:command_block'), true);
  assert.equal(isCommandBlock('repeating_command_block'), true);
  assert.equal(isCommandBlock('minecraft:stone'), false);
});

test('normalizeInstructionPlan rejects unsupported action types', () => {
  assert.throws(
    () => normalizeInstructionPlan({ actions: [{ type: 'teleport', x: 0, y: 0, z: 0 }] }),
    /Unsupported action type/,
  );
});
