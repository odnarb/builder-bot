import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimCheckoutConfirmationSession,
  resetCheckoutConfirmationIdempotencyState,
} from '../apps/core/logic/checkout-confirmation-idempotency.js';

test('claimCheckoutConfirmationSession enforces one-time processing in memory fallback mode', async () => {
  resetCheckoutConfirmationIdempotencyState();

  const first = await claimCheckoutConfirmationSession({
    sessionId: 'cs_test_replay_protection',
    userId: 'auth|alice',
  });
  const second = await claimCheckoutConfirmationSession({
    sessionId: 'cs_test_replay_protection',
    userId: 'auth|alice',
  });

  assert.equal(first, true);
  assert.equal(second, false);
});

test('claimCheckoutConfirmationSession rejects empty session ids', async () => {
  resetCheckoutConfirmationIdempotencyState();

  const claimed = await claimCheckoutConfirmationSession({
    sessionId: '   ',
    userId: 'auth|alice',
  });

  assert.equal(claimed, false);
});
