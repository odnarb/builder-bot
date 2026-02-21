import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPreScaleSimulationRuns,
  resetPreScaleSimulationRuns,
  runPreScaleSimulation,
} from '../apps/api/utils/pre-scale-simulation.js';

test('pre-scale simulation produces stress metrics and stores run history', () => {
  resetPreScaleSimulationRuns();

  const run = runPreScaleSimulation({
    seed: 42,
    concurrentUsers: 120,
    requestsPerUser: 6,
  });

  assert.equal(run.totals.requests > 0, true);
  assert.equal(run.totals.latencyP95Ms >= run.totals.latencyP50Ms, true);
  assert.equal(run.totals.queueRejections >= 0, true);
  assert.equal(run.scenarios.length >= 6, true);

  const runs = getPreScaleSimulationRuns({ limit: 1 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].seed, 42);
});
