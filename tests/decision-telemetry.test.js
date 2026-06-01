import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDecisionTelemetryScope,
  getDecisionTelemetrySnapshot,
  recordBuildOutcome,
  recordPlanSource,
  resetDecisionTelemetry,
} from '../apps/bot/decision-telemetry.js';

test('decision telemetry tracks local, AI, patch, and outcome counts', () => {
  resetDecisionTelemetry();

  recordPlanSource('local');
  recordPlanSource('ai');
  recordPlanSource('ai', { isPatch: true });
  recordBuildOutcome({ source: 'local', success: true });
  recordBuildOutcome({ source: 'ai', success: false });

  assert.deepEqual(getDecisionTelemetrySnapshot(), {
    localPlanCount: 1,
    aiPlanCount: 1,
    aiPatchPlanCount: 1,
    localPlanSuccessCount: 1,
    aiPlanSuccessCount: 0,
    failedBuildCount: 1,
    totalInitialPlans: 2,
    localPlanRatio: 0.5,
  });
});

test('decision telemetry scopes per-build snapshots while preserving global counters', () => {
  resetDecisionTelemetry();

  const firstBuild = createDecisionTelemetryScope();
  firstBuild.recordPlanSource('local');
  firstBuild.recordBuildOutcome({ source: 'local', success: true });

  const secondBuild = createDecisionTelemetryScope();
  secondBuild.recordPlanSource('ai');
  secondBuild.recordPlanSource('ai', { isPatch: true });
  secondBuild.recordBuildOutcome({ source: 'ai', success: false });

  assert.deepEqual(firstBuild.getSnapshot(), {
    localPlanCount: 1,
    aiPlanCount: 0,
    aiPatchPlanCount: 0,
    localPlanSuccessCount: 1,
    aiPlanSuccessCount: 0,
    failedBuildCount: 0,
    totalInitialPlans: 1,
    localPlanRatio: 1,
  });
  assert.deepEqual(secondBuild.getSnapshot(), {
    localPlanCount: 0,
    aiPlanCount: 1,
    aiPatchPlanCount: 1,
    localPlanSuccessCount: 0,
    aiPlanSuccessCount: 0,
    failedBuildCount: 1,
    totalInitialPlans: 1,
    localPlanRatio: 0,
  });
  assert.deepEqual(getDecisionTelemetrySnapshot(), {
    localPlanCount: 1,
    aiPlanCount: 1,
    aiPatchPlanCount: 1,
    localPlanSuccessCount: 1,
    aiPlanSuccessCount: 0,
    failedBuildCount: 1,
    totalInitialPlans: 2,
    localPlanRatio: 0.5,
  });
});
