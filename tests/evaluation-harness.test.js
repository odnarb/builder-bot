import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getEvaluationReport,
  recordEvaluationRun,
  resetEvaluationState,
} from '../apps/api/utils/evaluation-harness.js';

test('evaluation harness records run and computes regression', () => {
  resetEvaluationState();

  const baseline = recordEvaluationRun({
    suite: 'core-builds',
    modelVariant: 'baseline',
    qualityScore: 90,
    latencyScore: 80,
    safetyScore: 95,
  });
  const candidate = recordEvaluationRun({
    suite: 'core-builds',
    modelVariant: 'candidate',
    qualityScore: 84,
    latencyScore: 72,
    safetyScore: 90,
  });

  assert.equal(baseline.regressionDelta, null);
  assert.equal(typeof candidate.regressionDelta, 'number');
  assert.equal(getEvaluationReport({ suite: 'core-builds' }).summary.totalRuns, 2);
});
