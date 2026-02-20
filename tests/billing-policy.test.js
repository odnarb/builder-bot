import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRefundEligibility,
  getRenewalPreference,
  resetBillingPolicyState,
  setRenewalPreference,
} from '../apps/api/utils/billing-policy.js';

test('refund policy rejects requests outside policy windows', () => {
  const evaluation = evaluateRefundEligibility({
    purchasedAt: '2025-01-01T00:00:00.000Z',
    now: new Date('2025-02-01T00:00:00.000Z'),
    usagePercent: 5,
  });

  assert.equal(evaluation.eligible, false);
  assert.equal(evaluation.reason.includes('window'), true);
});

test('renewal preference can be updated and retrieved', () => {
  resetBillingPolicyState();

  setRenewalPreference({
    userId: 'auth:user-2',
    autoRenew: false,
    currentPeriodEnd: '2026-03-01T00:00:00.000Z',
  });

  const renewal = getRenewalPreference('auth:user-2');
  assert.equal(renewal.autoRenew, false);
  assert.equal(typeof renewal.currentPeriodEnd, 'string');
});
