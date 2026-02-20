import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateOpsAlerts,
  getOpsDashboardSnapshot,
  recordAiRequestEnd,
  recordAiRequestStart,
  recordBlockedPlacement,
  recordCrash,
  recordTokenBurn,
  setQueueDepth,
  resetOpsMetricsState,
} from '../apps/api/utils/ops-metrics.js';

test('ops metrics track request lifecycle and latency', () => {
  resetOpsMetricsState();

  recordAiRequestStart();
  recordAiRequestEnd({ success: true, retried: 1, latencyMs: 120 });
  recordAiRequestStart();
  recordAiRequestEnd({ success: false, queueRejected: true, blockedPlan: true, suspiciousUsage: true, latencyMs: 80 });

  const snapshot = getOpsDashboardSnapshot();
  assert.equal(snapshot.activeAiRequests, 0);
  assert.equal(snapshot.totalAiRequests, 2);
  assert.equal(snapshot.successfulAiRequests, 1);
  assert.equal(snapshot.failedAiRequests, 1);
  assert.equal(snapshot.queueRejectedRequests, 1);
  assert.equal(snapshot.blockedPlans, 1);
  assert.equal(snapshot.suspiciousUsageEvents, 1);
  assert.equal(snapshot.totalRetries, 1);
  assert.equal(snapshot.averageLatencyMs, 100);
  assert.equal(snapshot.failureRatePercent, 50);
});

test('evaluateOpsAlerts emits alert for high failure rate', () => {
  resetOpsMetricsState();

  recordAiRequestStart();
  recordAiRequestEnd({ success: false, latencyMs: 10 });
  recordAiRequestStart();
  recordAiRequestEnd({ success: false, latencyMs: 10 });

  const evaluation = evaluateOpsAlerts();
  assert.equal(evaluation.alerts.some((alert) => alert.code === 'high_failure_rate'), true);
});

test('evaluateOpsAlerts emits crash, blocked placement, and burn alerts', () => {
  resetOpsMetricsState();
  recordCrash();
  recordCrash();
  recordCrash();
  recordBlockedPlacement({ count: 25 });
  recordTokenBurn({ usd: 6 });
  setQueueDepth({ depth: 4 });

  const snapshot = getOpsDashboardSnapshot();
  assert.equal(snapshot.queueDepth, 4);

  const evaluation = evaluateOpsAlerts();
  assert.equal(evaluation.alerts.some((alert) => alert.code === 'crash_spike'), true);
  assert.equal(evaluation.alerts.some((alert) => alert.code === 'blocked_placement_spike'), true);
  assert.equal(evaluation.alerts.some((alert) => alert.code === 'burn_spike'), true);
});
