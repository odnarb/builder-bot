import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBuildUsageSnapshot,
  reserveBuildQuota,
  resetBuildUsageState,
} from '../apps/api/utils/build-governor.js';

const tierFeaturePolicy = {
  maxBuildRequestsPerDay: 2,
  maxBuildRequestsPerMonth: 3,
};

test('reserveBuildQuota increments daily and monthly counters', () => {
  resetBuildUsageState();
  const now = new Date('2026-02-20T00:00:00Z');

  reserveBuildQuota({ userKey: 'auth:user-a', tierFeaturePolicy, now });
  reserveBuildQuota({ userKey: 'auth:user-a', tierFeaturePolicy, now });

  const usage = getBuildUsageSnapshot('auth:user-a', now);
  assert.equal(usage.dailyBuildRequests, 2);
  assert.equal(usage.monthlyBuildRequests, 2);
});

test('reserveBuildQuota enforces daily and monthly limits', () => {
  resetBuildUsageState();
  const now = new Date('2026-02-20T00:00:00Z');

  reserveBuildQuota({ userKey: 'auth:user-b', tierFeaturePolicy, now });
  reserveBuildQuota({ userKey: 'auth:user-b', tierFeaturePolicy, now });
  assert.throws(
    () => reserveBuildQuota({ userKey: 'auth:user-b', tierFeaturePolicy, now }),
    /Daily build limit reached/,
  );

  reserveBuildQuota({
    userKey: 'auth:user-b',
    tierFeaturePolicy,
    now: new Date('2026-02-21T00:00:00Z'),
  });
  assert.throws(
    () => reserveBuildQuota({
      userKey: 'auth:user-b',
      tierFeaturePolicy,
      now: new Date('2026-02-21T00:01:00Z'),
    }),
    /Monthly build limit reached/,
  );
});
