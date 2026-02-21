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

const meteredTierPolicy = {
  ...tierPolicy,
  overagePolicy: 'basic_metered',
};

test('reserveUsage increments request/input and in-flight counters', async () => {
  resetUsageBuckets();
  await reserveUsage({ userKey: 'u1', estimatedInputTokens: 40, tierPolicy });
  const snapshot = await getUsageSnapshot('u1');
  assert.equal(snapshot.requestCount, 1);
  assert.equal(snapshot.inputTokens, 40);
  assert.equal(snapshot.inFlight, 1);
});

test('reserveUsage enforces concurrency and request limits', async () => {
  resetUsageBuckets();
  await reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy });

  await assert.rejects(
    () => reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy }),
    /Concurrency limit reached/,
  );

  await releaseInFlightSlot('u2');
  await reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy });
  await releaseInFlightSlot('u2');

  await assert.rejects(
    () => reserveUsage({ userKey: 'u2', estimatedInputTokens: 20, tierPolicy }),
    /Monthly request limit reached/,
  );
});

test('finalizeUsage enforces output cap and clears in-flight slot', async () => {
  resetUsageBuckets();
  await reserveUsage({ userKey: 'u3', estimatedInputTokens: 20, tierPolicy });
  await finalizeUsage({ userKey: 'u3', estimatedOutputTokens: 30, tierPolicy });

  const snapshot = await getUsageSnapshot('u3');
  assert.equal(snapshot.outputTokens, 30);
  assert.equal(snapshot.inFlight, 0);

  await reserveUsage({ userKey: 'u3', estimatedInputTokens: 10, tierPolicy });
  await assert.rejects(
    () => finalizeUsage({ userKey: 'u3', estimatedOutputTokens: 31, tierPolicy }),
    /Monthly output token limit reached/,
  );
});

test('metered tiers allow overage and track overage counters', async () => {
  resetUsageBuckets();
  const reserve1 = await reserveUsage({ userKey: 'u4', estimatedInputTokens: 90, tierPolicy: meteredTierPolicy });
  const finalize1 = await finalizeUsage({ userKey: 'u4', estimatedOutputTokens: 40, tierPolicy: meteredTierPolicy });
  const reserve2 = await reserveUsage({ userKey: 'u4', estimatedInputTokens: 30, tierPolicy: meteredTierPolicy });
  const finalize2 = await finalizeUsage({ userKey: 'u4', estimatedOutputTokens: 30, tierPolicy: meteredTierPolicy });

  assert.equal(reserve1.inputOverageTokens, 0);
  assert.equal(finalize1.outputOverageTokens, 0);
  assert.equal(reserve2.inputOverageTokens > 0, true);
  assert.equal(finalize2.outputOverageTokens > 0, true);

  const snapshot = await getUsageSnapshot('u4');
  assert.equal(snapshot.overageInputTokens > 0, true);
  assert.equal(snapshot.overageOutputTokens > 0, true);
});
