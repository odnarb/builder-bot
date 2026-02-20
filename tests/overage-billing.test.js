import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getOverageReport,
  getUserOverageSnapshot,
  recordOverageUsage,
  resetOverageLedger,
  supportsMeteredOverage,
} from '../apps/api/utils/overage-billing.js';

test('supportsMeteredOverage identifies metered policies', () => {
  assert.equal(supportsMeteredOverage({ overagePolicy: 'hard_cap' }), false);
  assert.equal(supportsMeteredOverage({ overagePolicy: 'basic_metered' }), true);
});

test('recordOverageUsage accumulates token overage charges', () => {
  resetOverageLedger();

  const row = recordOverageUsage({
    userKey: 'auth:user-1',
    tier: 'pro',
    inputOverageTokens: 1000,
    outputOverageTokens: 2000,
    overageRequests: 1,
  });

  assert.equal(row.overageInputTokens, 1000);
  assert.equal(row.overageOutputTokens, 2000);
  assert.equal(row.overageRequests, 1);
  assert.equal(row.overageChargeUsd > 0, true);

  const snapshot = getUserOverageSnapshot({ userKey: 'auth:user-1' });
  assert.equal(snapshot.overageOutputTokens, 2000);
  assert.equal(getOverageReport().length, 1);
});
