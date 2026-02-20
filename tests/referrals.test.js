import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReferralCode,
  getReferralSummary,
  getUserEntitlements,
  redeemReferralCode,
  resetReferralState,
} from '../apps/api/utils/referrals.js';

test('referral redemption grants entitlements to both users', () => {
  resetReferralState();

  const referrer = createReferralCode({ userId: 'auth:owner' });
  const redemption = redeemReferralCode({
    userId: 'auth:new-user',
    code: referrer.code,
  });

  assert.equal(redemption.ownerUserId, 'auth:owner');
  assert.equal(getUserEntitlements('auth:owner')[0].value, 1);
  assert.equal(getUserEntitlements('auth:new-user')[0].value, 1);
  assert.equal(getReferralSummary('auth:owner').totalReferredUsers, 1);
});

test('referral code cannot be redeemed twice by same user', () => {
  resetReferralState();

  const referrer = createReferralCode({ userId: 'auth:owner' });
  redeemReferralCode({
    userId: 'auth:new-user',
    code: referrer.code,
  });

  assert.throws(
    () => redeemReferralCode({ userId: 'auth:new-user', code: referrer.code }),
    /already redeemed/,
  );
});
