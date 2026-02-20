const usageBuckets = new Map();

/**
 * Check whether a tier policy allows metered overage.
 * @param {{ overagePolicy?: string }} tierPolicy
 * @returns {boolean}
 */
function allowsMeteredOverage(tierPolicy) {
    const policy = String(tierPolicy?.overagePolicy || '').toLowerCase();
    return policy === 'basic_metered' || policy === 'advanced_metered' || policy === 'metered_overage';
}

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
 * @returns {{
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   inFlight: number,
 *   overageRequests: number,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 * }}
 */
export function getOrCreateUsageBucket(userKey) {
    const key = buildUsageKey(userKey);

    if (!usageBuckets.has(key)) {
        usageBuckets.set(key, {
                requestCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                inFlight: 0,
                overageRequests: 0,
                overageInputTokens: 0,
                overageOutputTokens: 0,
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
 *     overagePolicy?: string,
 *   },
 * }} params
 * @returns {{ requestOverage: number, inputOverageTokens: number, outputOverageTokens: number }}
 * @throws {Error}
 */
export function reserveUsage({ userKey, estimatedInputTokens, tierPolicy }) {
    const bucket = getOrCreateUsageBucket(userKey);
    const canOverage = allowsMeteredOverage(tierPolicy);
    const maxRequestsPerMonth = Number.isFinite(Number(tierPolicy.maxRequestsPerMonth))
        ? Number(tierPolicy.maxRequestsPerMonth)
        : Number.MAX_SAFE_INTEGER;
    const maxInputTokensPerMonth = Number.isFinite(Number(tierPolicy.maxInputTokensPerMonth))
        ? Number(tierPolicy.maxInputTokensPerMonth)
        : Number.MAX_SAFE_INTEGER;

    if (bucket.inFlight >= tierPolicy.maxConcurrentRequests) {
        throw new Error(`Concurrency limit reached (${tierPolicy.maxConcurrentRequests}).`);
    }

    if (bucket.requestCount + 1 > maxRequestsPerMonth && !canOverage) {
        throw new Error('Monthly request limit reached for your tier.');
    }

    if (bucket.inputTokens + estimatedInputTokens > maxInputTokensPerMonth && !canOverage) {
        throw new Error('Monthly input token limit reached for your tier.');
    }

    const currentRequestOverage = Math.max(0, bucket.requestCount - maxRequestsPerMonth);
    const nextRequestOverage = Math.max(0, (bucket.requestCount + 1) - maxRequestsPerMonth);
    const requestOverage = Math.max(0, nextRequestOverage - currentRequestOverage);

    const safeEstimatedInputTokens = Math.max(0, Number(estimatedInputTokens) || 0);
    const currentInputOverage = Math.max(0, bucket.inputTokens - maxInputTokensPerMonth);
    const nextInputOverage = Math.max(0, (bucket.inputTokens + safeEstimatedInputTokens) - maxInputTokensPerMonth);
    const inputOverageTokens = Math.max(0, nextInputOverage - currentInputOverage);

    bucket.requestCount += 1;
    bucket.inputTokens += safeEstimatedInputTokens;
    bucket.inFlight += 1;
    bucket.overageRequests += requestOverage;
    bucket.overageInputTokens += inputOverageTokens;

    return {
        requestOverage,
        inputOverageTokens,
        outputOverageTokens: 0,
    };
}

/**
 * Finalize usage counters after model execution completes.
 * @param {{
 *   userKey: string,
 *   estimatedOutputTokens: number,
 *   tierPolicy: { maxOutputTokensPerMonth: number, overagePolicy?: string },
 * }} params
 * @returns {{ requestOverage: number, inputOverageTokens: number, outputOverageTokens: number }}
 * @throws {Error}
 */
export function finalizeUsage({ userKey, estimatedOutputTokens, tierPolicy }) {
    const bucket = getOrCreateUsageBucket(userKey);
    const canOverage = allowsMeteredOverage(tierPolicy);
    const maxOutputTokensPerMonth = Number.isFinite(Number(tierPolicy.maxOutputTokensPerMonth))
        ? Number(tierPolicy.maxOutputTokensPerMonth)
        : Number.MAX_SAFE_INTEGER;
    const safeEstimatedOutputTokens = Math.max(0, Number(estimatedOutputTokens) || 0);
    bucket.inFlight = Math.max(0, bucket.inFlight - 1);

    if (bucket.outputTokens + safeEstimatedOutputTokens > maxOutputTokensPerMonth && !canOverage) {
        throw new Error('Monthly output token limit reached for your tier.');
    }

    const currentOutputOverage = Math.max(0, bucket.outputTokens - maxOutputTokensPerMonth);
    const nextOutputOverage = Math.max(0, (bucket.outputTokens + safeEstimatedOutputTokens) - maxOutputTokensPerMonth);
    const outputOverageTokens = Math.max(0, nextOutputOverage - currentOutputOverage);

    bucket.outputTokens += safeEstimatedOutputTokens;
    bucket.overageOutputTokens += outputOverageTokens;

    return {
        requestOverage: 0,
        inputOverageTokens: 0,
        outputOverageTokens,
    };
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
 * @returns {{
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   inFlight: number,
 *   overageRequests: number,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 * }}
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
