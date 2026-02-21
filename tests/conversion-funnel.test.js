import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getConversionFunnelReport,
  recordCheckoutStarted,
  recordFeatureUsageSignal,
  recordSignupLifecycle,
  recordTierUpgrade,
  resetConversionFunnelState,
} from '../apps/api/utils/conversion-funnel.js';

test('conversion funnel tracks staged upgrades and feature usage snapshots', async () => {
  resetConversionFunnelState();

  await recordSignupLifecycle({ userId: 'auth:user-a', now: new Date('2026-02-01T00:00:00Z') });
  await recordFeatureUsageSignal({ userId: 'auth:user-a', tier: 'free', feature: 'build_generation', now: new Date('2026-02-01T01:00:00Z') });
  await recordCheckoutStarted({ userId: 'auth:user-a', fromTier: 'free', toTier: 'starter', skuCode: 'starter_monthly', now: new Date('2026-02-02T00:00:00Z') });
  await recordTierUpgrade({ userId: 'auth:user-a', fromTier: 'free', toTier: 'starter', skuCode: 'starter_monthly', now: new Date('2026-02-02T01:00:00Z') });
  await recordTierUpgrade({ userId: 'auth:user-a', fromTier: 'starter', toTier: 'pro', skuCode: 'pro_monthly', now: new Date('2026-02-10T01:00:00Z') });
  await recordTierUpgrade({ userId: 'auth:user-a', fromTier: 'pro', toTier: 'admin', skuCode: 'admin_monthly', now: new Date('2026-02-15T01:00:00Z') });

  const report = getConversionFunnelReport({ days: 365, now: new Date('2026-02-20T00:00:00Z') });

  assert.equal(report.users.freeUsers, 1);
  assert.equal(report.users.starterUsers, 1);
  assert.equal(report.users.proUsers, 1);
  assert.equal(report.users.adminUsers, 1);
  assert.equal(report.conversionPercentages.freeToStarter, 100);
  assert.equal(report.conversionPercentages.starterToPro, 100);
  assert.equal(report.conversionPercentages.proToAdmin, 100);
  assert.equal(report.topFeaturesBeforeUpgrade.some((row) => row.feature === 'build_generation'), true);
});
