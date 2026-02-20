import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeUsage,
  getUsageSnapshot,
  releaseInFlightSlot,
  reserveUsage,
  resetUsageBuckets,
} from '../apps/api/utils/token-governor.js';

const tierPolicy = {
  maxRequestsPerMonth: 2,
  maxInputTokensPerMonth: 100,
  maxOutputTokensPerMonth: 60,
  maxConcurrentRequests: 1,
};

test('reserveUsage increments request/input and in-flight counters', () => {
  resetUsageBuckets();
  reserveUsage({ userKey: 'u1', estimatedInputTokens: 40, tierPolicy });
  const snapshot = getUsageSnapshot('u1');
  assert.equal(snapshot.requestCount, 1);
  assert.equal(snapshot.inputTokens, 40);
  assert.equal(snapshot.inFlight, 1);
});

test('reserveUsage enforces concurrency and request limits', () => {
  resetUsageBuckets();
  reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy });

  assert.throws(
    () => reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy }),
    /Concurrency limit reached/,
  );

  releaseInFlightSlot('u2');
  reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy });
  releaseInFlightSlot('u2');

  assert.throws(
    () => reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy }),
    /Monthly request limit reached/,
  );
});

test('finalizeUsage enforces output cap and clears in-flight slot', () => {
  resetUsageBuckets();
  reserveUsage({ userKey: 'u3', estimatedInputTokens: 20, tierPolicy });
  finalizeUsage({ userKey: 'u3', estimatedOutputTokens: 30, tierPolicy });

  const snapshot = getUsageSnapshot('u3');
  assert.equal(snapshot.outputTokens, 30);
  assert.equal(snapshot.inFlight, 0);

  reserveUsage({ userKey: 'u3', estimatedInputTokens: 10, tierPolicy });
  assert.throws(
    () => finalizeUsage({ userKey: 'u3', estimatedOutputTokens: 31, tierPolicy }),
    /Monthly output token limit reached/,
  );
});
