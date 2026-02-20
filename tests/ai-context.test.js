import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContextDelta,
  buildContextSnapshot,
  estimateAiInputTokens,
  estimateTokenCountFromText,
  prepareContextForSnapshot,
  resetAiContextState,
  shouldUseThickSnapshot,
  summarizeBlocks,
  summarizeEntities,
  summarizeInventory,
} from '../apps/api/utils/ai-context.js';

test('shouldUseThickSnapshot detects explicit thick mode and high-detail triggers', () => {
  assert.equal(shouldUseThickSnapshot({ snapshotMode: 'thick' }), true);
  assert.equal(shouldUseThickSnapshot({ triggerReason: 'build_failure' }), true);
  assert.equal(shouldUseThickSnapshot({ taskState: { buildCritical: true } }), true);
  assert.equal(shouldUseThickSnapshot({ bot: { inCombat: true } }), true);
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

test('buildContextDelta returns only changed keys', () => {
  const delta = buildContextDelta({
    previousContext: {
      bot: { health: 20, food: 18 },
      inventory: [{ name: 'stone', count: 64 }],
    },
    nextContext: {
      bot: { health: 18, food: 18 },
      inventory: [{ name: 'stone', count: 64 }],
      taskState: { task: 'build' },
    },
  });

  assert.equal(delta.hasChanges, true);
  assert.deepEqual(delta.changedKeys, ['bot', 'taskState']);
  assert.equal(delta.truncated, false);
});

test('prepareContextForSnapshot applies trigger path, memo caching, and delta updates', () => {
  resetAiContextState();
  const usageKey = 'auth:user-a';
  const baseContext = {
    identity: { userId: 'auth0|abc', tier: 'pro' },
    bot: { position: { x: 1, y: 2, z: 3 }, health: 20, food: 18, biome: 'plains' },
    inventory: [{ name: 'stone', count: 64 }],
    nearbyEntities: [{ name: 'cow', type: 'mob', distance: 5 }],
    nearbyBlocks: [{ name: 'grass_block', count: 10 }],
    taskState: { task: 'build' },
  };

  const first = prepareContextForSnapshot({
    usageKey,
    context: baseContext,
    now: new Date('2026-02-20T00:00:00Z'),
  });
  assert.equal(first.diagnostics.snapshotMode, 'thin');
  assert.equal(first.diagnostics.worldMemoRefreshed, true);
  assert.equal(first.contextForSnapshot.delta.hasChanges, true);

  const second = prepareContextForSnapshot({
    usageKey,
    context: baseContext,
    now: new Date('2026-02-20T00:00:20Z'),
  });
  assert.equal(second.diagnostics.worldMemoRefreshed, false);
  assert.equal(second.contextForSnapshot.delta.hasChanges, false);

  const third = prepareContextForSnapshot({
    usageKey,
    context: {
      ...baseContext,
      bot: { ...baseContext.bot, health: 17 },
    },
    now: new Date('2026-02-20T00:01:10Z'),
  });
  assert.equal(third.diagnostics.worldMemoRefreshed, true);
  assert.equal(third.contextForSnapshot.delta.hasChanges, true);
  assert.ok(third.contextForSnapshot.delta.changedKeys.includes('bot'));
});

test('prepareContextForSnapshot promotes to thick mode on build-critical trigger', () => {
  resetAiContextState();
  const result = prepareContextForSnapshot({
    usageKey: 'auth:user-b',
    context: {
      taskState: { buildCritical: true },
    },
  });

  assert.equal(result.diagnostics.snapshotMode, 'thick');
  assert.equal(result.diagnostics.triggerReason, 'build_critical');
});

test('buildContextSnapshot uses delta-only mode for thin snapshots with memo + delta', () => {
  resetAiContextState();
  const usageKey = 'auth:user-c';
  const context = {
    identity: { userId: 'auth0|xyz', tier: 'starter' },
    bot: { position: { x: 1, y: 2, z: 3 }, health: 20, food: 19 },
    inventory: [{ name: 'oak_planks', count: 32 }],
  };

  prepareContextForSnapshot({
    usageKey,
    context,
    now: new Date('2026-02-20T00:00:00Z'),
  });

  const second = prepareContextForSnapshot({
    usageKey,
    context,
    now: new Date('2026-02-20T00:00:10Z'),
  });

  const snapshot = buildContextSnapshot({
    context: second.contextForSnapshot,
    tierPolicy: { maxInputTokensPerRequest: 8000 },
  });

  assert.equal(snapshot.mode, 'thin');
  assert.equal(snapshot.deltaOnly, true);
  assert.equal(snapshot.inventorySummary.length, 0);
  assert.ok(snapshot.worldMemo);
});

test('estimateTokenCountFromText uses conservative approximation', () => {
  assert.equal(estimateTokenCountFromText('abcd'), 1);
  assert.equal(estimateTokenCountFromText('abcdefgh'), 2);
});
