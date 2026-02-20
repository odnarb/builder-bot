import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContextSnapshot,
  estimateAiInputTokens,
  estimateTokenCountFromText,
  shouldUseThickSnapshot,
  summarizeBlocks,
  summarizeEntities,
  summarizeInventory,
} from '../apps/api/utils/ai-context.js';

test('shouldUseThickSnapshot detects explicit thick mode and high-detail triggers', () => {
  assert.equal(shouldUseThickSnapshot({ snapshotMode: 'thick' }), true);
  assert.equal(shouldUseThickSnapshot({ triggerReason: 'build_failure' }), true);
  assert.equal(shouldUseThickSnapshot({ triggerReason: 'normal_build' }), false);
});

test('summarizeInventory keeps top items by count', () => {
  const summary = summarizeInventory([
    { name: 'dirt', count: 4 },
    { name: 'stone', count: 64 },
    { name: 'oak_planks', count: 32 },
  ], 2);

  assert.deepEqual(summary.map(item => item.name), ['stone', 'oak_planks']);
});

test('summarizeEntities sorts by nearest distance', () => {
  const summary = summarizeEntities([
    { name: 'cow', type: 'mob', distance: 8 },
    { name: 'villager', type: 'npc', distance: 2 },
  ], 2);

  assert.deepEqual(summary.map(item => item.name), ['villager', 'cow']);
});

test('summarizeBlocks sorts by count desc', () => {
  const summary = summarizeBlocks([
    { name: 'stone', count: 5 },
    { name: 'grass_block', count: 15 },
  ], 2);

  assert.deepEqual(summary.map(item => item.name), ['grass_block', 'stone']);
});

test('buildContextSnapshot emits compact snapshot and token estimate', () => {
  const context = {
    identity: { userId: 'auth0|abc', tier: 'pro' },
    bot: { position: { x: 1, y: 2, z: 3 }, health: 20, food: 18, biome: 'plains' },
    inventory: [{ name: 'stone', count: 64 }],
    nearbyEntities: [{ name: 'cow', type: 'mob', distance: 5 }],
    nearbyBlocks: [{ name: 'grass_block', count: 10 }],
  };

  const snapshot = buildContextSnapshot({
    context,
    tierPolicy: { maxInputTokensPerRequest: 8000 },
  });
  const inputEstimate = estimateAiInputTokens({
    message: 'build a tower',
    contextSnapshot: snapshot,
    tier: 'starter',
  });

  assert.equal(snapshot.mode, 'thin');
  assert.ok(Array.isArray(snapshot.inventorySummary));
  assert.ok(Array.isArray(snapshot.nearbyEntitySummary));
  assert.ok(Array.isArray(snapshot.nearbyBlockSummary));
  assert.ok(inputEstimate > 0);
});

test('estimateTokenCountFromText uses conservative approximation', () => {
  assert.equal(estimateTokenCountFromText('abcd'), 1);
  assert.equal(estimateTokenCountFromText('abcdefgh'), 2);
});
