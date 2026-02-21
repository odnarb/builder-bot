const buildUsageBuckets = new Map();

/**
 * Build a UTC date key in `YYYY-MM-DD` format.
 * @param {Date} [now]
 * @returns {string}
 */
export function getCurrentDayKey(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Build a UTC month key in `YYYY-MM` format.
 * @param {Date} [now]
 * @returns {string}
 */
export function getCurrentMonthKey(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Get or initialize per-user build usage counters.
 * Counters reset automatically when UTC day/month rolls over.
 * @param {string} userKey
 * @param {Date} [now]
 * @returns {{
 *   dayKey: string,
 *   monthKey: string,
 *   dailyBuildRequests: number,
 *   monthlyBuildRequests: number,
 *   buildFailures: number,
 *   lastRequestAt: string | null,
 * }}
 */
export function getOrCreateBuildUsageBucket(userKey, now = new Date()) {
    const dayKey = getCurrentDayKey(now);
    const monthKey = getCurrentMonthKey(now);
    const safeUserKey = typeof userKey === 'string' && userKey.trim().length > 0
        ? userKey.trim()
        : 'unknown-user';

    if (!buildUsageBuckets.has(safeUserKey)) {
        buildUsageBuckets.set(safeUserKey, {
            dayKey,
            monthKey,
            dailyBuildRequests: 0,
            monthlyBuildRequests: 0,
            buildFailures: 0,
            lastRequestAt: null,
        });
    }

    const bucket = buildUsageBuckets.get(safeUserKey);

    if (bucket.dayKey !== dayKey) {
        bucket.dayKey = dayKey;
        bucket.dailyBuildRequests = 0;
    }

    if (bucket.monthKey !== monthKey) {
        bucket.monthKey = monthKey;
        bucket.monthlyBuildRequests = 0;
        bucket.buildFailures = 0;
    }

    return bucket;
}

/**
 * Reserve build-frequency quota for a single build-generation request.
 * @param {{
 *   userKey: string,
 *   tierFeaturePolicy: {
 *     maxBuildRequestsPerDay: number,
 *     maxBuildRequestsPerMonth: number,
 *   },
 *   now?: Date,
 * }} params
 * @throws {Error}
 */
export function reserveBuildQuota({ userKey, tierFeaturePolicy, now = new Date() }) {
    const bucket = getOrCreateBuildUsageBucket(userKey, now);
    const maxBuildRequestsPerDay = Number(tierFeaturePolicy?.maxBuildRequestsPerDay || 0);
    const maxBuildRequestsPerMonth = Number(tierFeaturePolicy?.maxBuildRequestsPerMonth || 0);

    if (bucket.dailyBuildRequests + 1 > maxBuildRequestsPerDay) {
        throw new Error('Daily build limit reached for your tier.');
    }

    if (bucket.monthlyBuildRequests + 1 > maxBuildRequestsPerMonth) {
        throw new Error('Monthly build limit reached for your tier.');
    }

    bucket.dailyBuildRequests += 1;
    bucket.monthlyBuildRequests += 1;
    bucket.lastRequestAt = new Date(now).toISOString();
}

/**
 * Increment failure counts for a user's build request.
 * @param {{ userKey: string, now?: Date }} params
 */
export function recordBuildFailure({ userKey, now = new Date() }) {
    const bucket = getOrCreateBuildUsageBucket(userKey, now);
    bucket.buildFailures += 1;
}

/**
 * Get read-only usage counters for diagnostics.
 * @param {string} userKey
 * @param {Date} [now]
 * @returns {{
 *   dayKey: string,
 *   monthKey: string,
 *   dailyBuildRequests: number,
 *   monthlyBuildRequests: number,
 *   buildFailures: number,
 *   lastRequestAt: string | null,
 * }}
 */
export function getBuildUsageSnapshot(userKey, now = new Date()) {
    return { ...getOrCreateBuildUsageBucket(userKey, now) };
}

/**
 * Reset in-memory build usage counters. Intended for tests.
 */
export function resetBuildUsageState() {
    buildUsageBuckets.clear();
}
