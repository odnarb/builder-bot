import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTierAiPolicy,
  getTierModelRoute,
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
});
