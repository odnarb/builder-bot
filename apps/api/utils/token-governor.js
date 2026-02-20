const usageBuckets = new Map();

/**
 * Build a stable usage-bucket key for monthly accounting.
 * @param {string} userKey
 * @returns {string}
 */
function buildUsageKey(userKey) {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${month}:${userKey}`;
}

/**
 * Get or initialize monthly usage counters for a user key.
 * @param {string} userKey
 * @returns {{ requestCount: number, inputTokens: number, outputTokens: number, inFlight: number }}
 */
export function getOrCreateUsageBucket(userKey) {
    const key = buildUsageKey(userKey);

    if (!usageBuckets.has(key)) {
        usageBuckets.set(key, {
            requestCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            inFlight: 0,
        });
    }

    return usageBuckets.get(key);
}

/**
 * Reserve request budget before model execution.
 * Throws when a tier limit would be exceeded.
 * @param {{
 *   userKey: string,
 *   estimatedInputTokens: number,
 *   tierPolicy: {
 *     maxRequestsPerMonth: number,
 *     maxInputTokensPerMonth: number,
 *     maxConcurrentRequests: number,
 *   },
 * }} params
 * @throws {Error}
 */
export function reserveUsage({ userKey, estimatedInputTokens, tierPolicy }) {
    const bucket = getOrCreateUsageBucket(userKey);

    if (bucket.inFlight >= tierPolicy.maxConcurrentRequests) {
        throw new Error(`Concurrency limit reached (${tierPolicy.maxConcurrentRequests}).`);
    }

    if (bucket.requestCount + 1 > tierPolicy.maxRequestsPerMonth) {
        throw new Error('Monthly request limit reached for your tier.');
    }

    if (bucket.inputTokens + estimatedInputTokens > tierPolicy.maxInputTokensPerMonth) {
        throw new Error('Monthly input token limit reached for your tier.');
    }

    bucket.requestCount += 1;
    bucket.inputTokens += estimatedInputTokens;
    bucket.inFlight += 1;
}

/**
 * Finalize usage counters after model execution completes.
 * @param {{
 *   userKey: string,
 *   estimatedOutputTokens: number,
 *   tierPolicy: { maxOutputTokensPerMonth: number },
 * }} params
 * @throws {Error}
 */
export function finalizeUsage({ userKey, estimatedOutputTokens, tierPolicy }) {
    const bucket = getOrCreateUsageBucket(userKey);
    bucket.inFlight = Math.max(0, bucket.inFlight - 1);

    if (bucket.outputTokens + estimatedOutputTokens > tierPolicy.maxOutputTokensPerMonth) {
        throw new Error('Monthly output token limit reached for your tier.');
    }

    bucket.outputTokens += estimatedOutputTokens;
}

/**
 * Release an in-flight slot when an error occurs before finalizeUsage.
 * @param {string} userKey
 */
export function releaseInFlightSlot(userKey) {
    const bucket = getOrCreateUsageBucket(userKey);
    bucket.inFlight = Math.max(0, bucket.inFlight - 1);
}

/**
 * Export current counters for diagnostics/testing.
 * @param {string} userKey
 * @returns {{ requestCount: number, inputTokens: number, outputTokens: number, inFlight: number }}
 */
export function getUsageSnapshot(userKey) {
    return { ...getOrCreateUsageBucket(userKey) };
}

/**
 * Reset all usage counters. Intended for tests.
 */
export function resetUsageBuckets() {
    usageBuckets.clear();
}

