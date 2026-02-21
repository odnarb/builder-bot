import {
    buildMonthlyDocId,
    readPersistentDoc,
    writePersistentDoc,
} from '../db/firestore/economics-persistence.js';

const usageBuckets = new Map();
const hydrationPromisesByBucket = new Map();
let migrationCompleted = false;

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
function normalizeUserKey(userKey) {
    return typeof userKey === 'string' && userKey.trim().length > 0
        ? userKey.trim()
        : 'unknown-user';
}

/**
 * Build a stable usage-bucket key for monthly accounting.
 * @param {string} userKey
 * @param {Date} [now]
 * @returns {string}
 */
function buildUsageKey(userKey, now = new Date()) {
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${month}:${normalizeUserKey(userKey)}`;
}

/**
 * Parse a usage bucket key into month and user key parts.
 * @param {string} usageBucketKey
 * @returns {{ month: string, userKey: string } | null}
 */
function parseUsageBucketKey(usageBucketKey) {
    const [month, ...rest] = String(usageBucketKey || '').split(':');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || rest.length === 0) {
        return null;
    }

    return {
        month,
        userKey: rest.join(':'),
    };
}

/**
 * Build default mutable usage bucket shape.
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
function createDefaultBucket() {
    return {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        inFlight: 0,
        overageRequests: 0,
        overageInputTokens: 0,
        overageOutputTokens: 0,
    };
}

/**
 * Read one persisted usage bucket and merge it into in-memory state.
 * @param {{ usageBucketKey: string }} params
 */
async function hydrateBucketFromPersistence({ usageBucketKey }) {
    const parsed = parseUsageBucketKey(usageBucketKey);
    if (!parsed) {
        return;
    }

    let persisted = null;
    try {
        const docId = buildMonthlyDocId({ month: parsed.month, key: parsed.userKey });
        persisted = await readPersistentDoc({
            collection: 'usageMonthly',
            docId,
        });
    } catch {
        return;
    }

    if (!persisted) {
        return;
    }

    const bucket = usageBuckets.get(usageBucketKey);
    if (!bucket) {
        return;
    }

    bucket.requestCount = Math.max(0, Number(persisted.requestCount) || 0);
    bucket.inputTokens = Math.max(0, Number(persisted.inputTokens) || 0);
    bucket.outputTokens = Math.max(0, Number(persisted.outputTokens) || 0);
    bucket.inFlight = Math.max(0, Number(persisted.inFlight) || 0);
    bucket.overageRequests = Math.max(0, Number(persisted.overageRequests) || 0);
    bucket.overageInputTokens = Math.max(0, Number(persisted.overageInputTokens) || 0);
    bucket.overageOutputTokens = Math.max(0, Number(persisted.overageOutputTokens) || 0);
}

/**
 * Persist one usage bucket row to storage.
 * @param {{ usageBucketKey: string }} params
 */
async function persistBucket({ usageBucketKey }) {
    const parsed = parseUsageBucketKey(usageBucketKey);
    if (!parsed) {
        return;
    }

    const bucket = usageBuckets.get(usageBucketKey);
    if (!bucket) {
        return;
    }

    try {
        const docId = buildMonthlyDocId({ month: parsed.month, key: parsed.userKey });
        await writePersistentDoc({
            collection: 'usageMonthly',
            docId,
            data: {
                month: parsed.month,
                userKey: parsed.userKey,
                requestCount: bucket.requestCount,
                inputTokens: bucket.inputTokens,
                outputTokens: bucket.outputTokens,
                inFlight: bucket.inFlight,
                overageRequests: bucket.overageRequests,
                overageInputTokens: bucket.overageInputTokens,
                overageOutputTokens: bucket.overageOutputTokens,
                updatedAt: new Date().toISOString(),
            },
        });
    } catch {
        // no-op: keep request path healthy even when persistence is unavailable.
    }
}

/**
 * Migrate currently loaded in-memory buckets into persistent storage.
 * Safe to call repeatedly; no-op when no buckets are present.
 * @returns {Promise<number>}
 */
export async function migrateInMemoryUsageBucketsToPersistentStore() {
    const keys = Array.from(usageBuckets.keys());
    if (keys.length === 0) {
        migrationCompleted = true;
        return 0;
    }

    let persistedRows = 0;
    for (const usageBucketKey of keys) {
        await persistBucket({ usageBucketKey });
        persistedRows += 1;
    }

    migrationCompleted = true;
    return persistedRows;
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
export async function getOrCreateUsageBucket(userKey, now = new Date()) {
    const key = buildUsageKey(userKey, now);

    if (!usageBuckets.has(key)) {
        usageBuckets.set(key, createDefaultBucket());
    }

    if (!hydrationPromisesByBucket.has(key)) {
        hydrationPromisesByBucket.set(key, hydrateBucketFromPersistence({ usageBucketKey: key }));
    }
    await hydrationPromisesByBucket.get(key);

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
export async function reserveUsage({ userKey, estimatedInputTokens, tierPolicy, now = new Date() }) {
    const bucket = await getOrCreateUsageBucket(userKey, now);
    const usageBucketKey = buildUsageKey(userKey, now);
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
    await persistBucket({ usageBucketKey });

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
export async function finalizeUsage({ userKey, estimatedOutputTokens, tierPolicy, now = new Date() }) {
    const bucket = await getOrCreateUsageBucket(userKey, now);
    const usageBucketKey = buildUsageKey(userKey, now);
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
    await persistBucket({ usageBucketKey });

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
export async function releaseInFlightSlot(userKey, now = new Date()) {
    const bucket = await getOrCreateUsageBucket(userKey, now);
    const usageBucketKey = buildUsageKey(userKey, now);
    bucket.inFlight = Math.max(0, bucket.inFlight - 1);
    await persistBucket({ usageBucketKey });
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
export async function getUsageSnapshot(userKey, now = new Date()) {
    return { ...(await getOrCreateUsageBucket(userKey, now)) };
}

/**
 * Reset all usage counters. Intended for tests.
 */
export function resetUsageBuckets() {
    usageBuckets.clear();
    hydrationPromisesByBucket.clear();
    migrationCompleted = false;
}
