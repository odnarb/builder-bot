import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTierAiPolicy,
  getTierFeaturePolicy,
  getTierModelRoute,
  isInCanaryRollout,
  resolveTier,
  TIER_PRICES_USD,
} from '../apps/api/config/tier-policy.js';

test('resolveTier normalizes and falls back to free', () => {
  assert.equal(resolveTier('PRO'), 'pro');
  assert.equal(resolveTier(' unknown '), 'free');
  assert.equal(resolveTier(undefined), 'free');
});

test('getTierAiPolicy returns configured request caps', () => {
  const freePolicy = getTierAiPolicy('free');
  const adminPolicy = getTierAiPolicy('admin');

  assert.equal(freePolicy.maxInputTokensPerRequest, 4000);
  assert.equal(freePolicy.maxRequestsPerMonth, 100);
  assert.equal(adminPolicy.maxConcurrentRequests, 8);
  assert.equal(adminPolicy.maxOutputTokensPerMonth, 9000000);
});

test('tier prices reflect canonical pricing decision', () => {
  assert.equal(TIER_PRICES_USD.pro, 12.99);
  assert.equal(TIER_PRICES_USD.admin, 24.99);
});

test('getTierModelRoute returns planner and executor models', () => {
  const route = getTierModelRoute('starter');
  assert.ok(typeof route.plannerModel === 'string' && route.plannerModel.length > 0);
  assert.ok(typeof route.executorModel === 'string' && route.executorModel.length > 0);
  assert.ok(typeof route.fallbackModel === 'string' && route.fallbackModel.length > 0);
  assert.ok(route.inferencePool === 'standard' || route.inferencePool === 'priority');
});

test('getTierFeaturePolicy returns build and command block limits', () => {
  const free = getTierFeaturePolicy('free');
  const pro = getTierFeaturePolicy('pro');

  assert.equal(free.maxBlocksPerBuild, 50);
  assert.equal(free.allowCommandBlocks, false);
  assert.equal(pro.allowCommandBlocks, true);
  assert.equal(pro.maxBuildRequestsPerMonth, 5000);
});

test('isInCanaryRollout is deterministic for same usage key', () => {
  const first = isInCanaryRollout({ usageKey: 'auth:user-a', rolloutPercent: 50 });
  const second = isInCanaryRollout({ usageKey: 'auth:user-a', rolloutPercent: 50 });
  assert.equal(first, second);
});
