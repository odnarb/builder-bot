import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDecisionTierPolicy } from '../apps/bot/decision-tier-policy.js';

test('resolveDecisionTierPolicy returns bounded free-tier budgets', () => {
  const policy = resolveDecisionTierPolicy('free');

  assert.equal(policy.tier, 'free');
  assert.equal(policy.maxScanRadius > 0, true);
  assert.equal(policy.maxAnchorCandidates >= 1, true);
  assert.equal(policy.maxPrepEdits <= 50, true);
  assert.equal(policy.maxPrepVolume <= 4000, true);
  assert.equal(policy.pathfinderTickTimeoutMs <= 50, true);
});

test('resolveDecisionTierPolicy clamps unsupported tiers to free', () => {
  const policy = resolveDecisionTierPolicy('vip-ultra');
  assert.equal(policy.tier, 'free');
});

test('resolveDecisionTierPolicy preserves higher admin budgets', () => {
  const policy = resolveDecisionTierPolicy('admin');
  assert.equal(policy.tier, 'admin');
  assert.equal(policy.maxScanRadius >= 16, true);
  assert.equal(policy.maxReplanAttempts >= 3, true);
  assert.equal(policy.allowAggressiveRecovery, true);
});
