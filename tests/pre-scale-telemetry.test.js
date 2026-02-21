import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPreScalePerformanceProfile,
  getPreScaleTelemetryDashboard,
  recordPreScaleBuildSuccess,
  recordPreScaleRequestFailure,
  recordPreScaleRequestStart,
  resetPreScaleTelemetryState,
} from '../apps/api/utils/pre-scale-telemetry.js';

test('pre-scale telemetry aggregates dashboard and performance metrics', async () => {
  resetPreScaleTelemetryState();

  await recordPreScaleRequestStart({ userKey: 'auth:user-a', tier: 'pro', month: '2026-02' });
  await recordPreScaleRequestFailure({
    userKey: 'auth:user-a',
    tier: 'pro',
    capHit: true,
    concurrencyRejected: true,
    latencyMs: 500,
    queueWaitMs: 40,
    month: '2026-02',
  });
  await recordPreScaleBuildSuccess({
    userKey: 'auth:user-a',
    tier: 'pro',
    plannerInputTokens: 800,
    plannerOutputTokens: 200,
    executorInputTokens: 1800,
    executorOutputTokens: 600,
    contextInjectionTokens: 900,
    contextBaselineTokens: 1400,
    snapshotMode: 'thick',
    overageUsed: true,
    totalCostUsd: 0.012,
    latencyMs: 620,
    queueWaitMs: 30,
    plannerModel: 'gpt-4.1',
    plannerDurationMs: 300,
    executorActions: 18,
    executorDurationMs: 450,
    month: '2026-02',
  });

  const dashboard = await getPreScaleTelemetryDashboard({
    month: '2026-02',
    marginByTier: {
      pro: {
        revenue: 12.99,
        totalCost: 4.5,
      },
    },
  });

  const proRow = dashboard.tiers.find((row) => row.tier === 'pro');
  assert.equal(proRow.totalRequests, 1);
  assert.equal(proRow.successfulBuilds, 1);
  assert.equal(proRow.capHitRatePercent > 0, true);
  assert.equal(proRow.overageFrequencyPercent > 0, true);
  assert.equal(proRow.deltaCompressionSavingsPercent > 0, true);

  const profile = await getPreScalePerformanceProfile({ month: '2026-02' });
  const profilePro = profile.tiers.find((row) => row.tier === 'pro');
  assert.equal(profilePro.p95LatencyMs > 0, true);
  assert.equal(profile.plannerColdStartMsByTier.pro > 0, true);
});
