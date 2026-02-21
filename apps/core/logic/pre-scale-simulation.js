import { getTierAiPolicy, resolveTier } from '../contracts/tier-policy.js';
import { shouldForceThinSnapshots, shouldThrottleFreeTier } from './emergency-margin-guard.js';

const recentSimulationRuns = [];

/**
 * Create deterministic pseudo-random number generator.
 * @param {number} seed
 * @returns {() => number}
 */
function createRng(seed) {
    let state = Math.max(1, Number(seed) || Date.now()) % 2147483647;
    return () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
    };
}

/**
 * Clamp a number into a range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Build simulation scenario definitions for stress and abuse patterns.
 * @param {{ concurrentUsers: number, requestsPerUser: number }} params
 * @returns {Array<{ name: string, users: number, requestsPerUser: number, abuseMultiplier: number, failureBias: number, retryBias: number }>}
 */
function buildScenarios({ concurrentUsers, requestsPerUser }) {
    return [
        {
            name: 'baseline_concurrency_100_plus',
            users: Math.max(100, concurrentUsers),
            requestsPerUser,
            abuseMultiplier: 1,
            failureBias: 0.03,
            retryBias: 0.1,
        },
        {
            name: 'max_cap_users',
            users: Math.max(20, Math.floor(concurrentUsers * 0.35)),
            requestsPerUser: Math.max(5, Math.floor(requestsPerUser * 1.3)),
            abuseMultiplier: 1.25,
            failureBias: 0.06,
            retryBias: 0.3,
        },
        {
            name: 'rapid_build_loops',
            users: Math.max(40, Math.floor(concurrentUsers * 0.45)),
            requestsPerUser: Math.max(12, Math.floor(requestsPerUser * 1.8)),
            abuseMultiplier: 1.4,
            failureBias: 0.08,
            retryBias: 0.45,
        },
        {
            name: 'thick_snapshot_spam',
            users: Math.max(30, Math.floor(concurrentUsers * 0.3)),
            requestsPerUser: Math.max(10, Math.floor(requestsPerUser * 1.5)),
            abuseMultiplier: 1.5,
            failureBias: 0.09,
            retryBias: 0.5,
        },
        {
            name: 'command_block_abuse_attempts',
            users: Math.max(15, Math.floor(concurrentUsers * 0.2)),
            requestsPerUser: Math.max(8, Math.floor(requestsPerUser * 1.2)),
            abuseMultiplier: 1.2,
            failureBias: 0.12,
            retryBias: 0.35,
        },
        {
            name: 'overage_abuse_patterns',
            users: Math.max(20, Math.floor(concurrentUsers * 0.25)),
            requestsPerUser: Math.max(12, Math.floor(requestsPerUser * 1.6)),
            abuseMultiplier: 1.8,
            failureBias: 0.07,
            retryBias: 0.4,
        },
    ];
}

/**
 * Simulate latency and token burn for one virtual request.
 * @param {{
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   scenario: { abuseMultiplier: number, failureBias: number, retryBias: number },
 *   rng: () => number,
 *   guardState?: Record<string, any> | null,
 * }} params
 * @returns {{
 *   latencyMs: number,
 *   retries: number,
 *   failed: boolean,
 *   queueRejected: boolean,
 *   tokenBurnUsd: number,
 *   freeTierThrottled: boolean,
 *   forcedThinSnapshot: boolean,
 * }}
 */
function simulateRequest({ tier, scenario, rng, guardState = null }) {
    const freeTierThrottled = shouldThrottleFreeTier({ tier, guardState });
    const forcedThinSnapshot = shouldForceThinSnapshots({ guardState });

    if (freeTierThrottled) {
        return {
            latencyMs: 45 + Math.floor(rng() * 40),
            retries: 0,
            failed: false,
            queueRejected: true,
            tokenBurnUsd: 0,
            freeTierThrottled: true,
            forcedThinSnapshot,
        };
    }

    const tierPolicy = getTierAiPolicy(tier);
    const normalizedConcurrency = clamp(tierPolicy.maxConcurrentRequests / 8, 0.125, 1);

    const baseLatencyByTier = {
        free: 950,
        starter: 780,
        pro: 620,
        admin: 520,
    };

    const jitter = (rng() - 0.5) * 300;
    const abusePenalty = (scenario.abuseMultiplier - 1) * 400 * rng();
    const latencyMs = Math.max(120, baseLatencyByTier[tier] + jitter + abusePenalty);

    const retries = rng() < scenario.retryBias
        ? Math.floor(rng() * 3) + 1
        : 0;

    const queueRejectedProbability = clamp((1 - normalizedConcurrency) * scenario.abuseMultiplier * 0.35, 0, 0.95);
    const queueRejected = rng() < queueRejectedProbability;

    const failureProbability = clamp(scenario.failureBias + (queueRejected ? 0.2 : 0) + (retries * 0.04), 0, 0.95);
    const failed = rng() < failureProbability;

    const tokenLoadByTier = {
        free: 2500,
        starter: 4500,
        pro: 7600,
        admin: 11000,
    };
    const thinSnapshotSavingsMultiplier = forcedThinSnapshot ? 0.72 : 1;
    const requestTokens = tokenLoadByTier[tier] * scenario.abuseMultiplier * (1 + retries * 0.25) * thinSnapshotSavingsMultiplier;
    const tokenBurnUsd = ((requestTokens * 0.30) + (requestTokens * 0.55)) / 1_000_000;

    return {
        latencyMs,
        retries,
        failed,
        queueRejected,
        tokenBurnUsd,
        freeTierThrottled: false,
        forcedThinSnapshot,
    };
}

/**
 * Compute percentile from sample array.
 * @param {number[]} samples
 * @param {number} pct
 * @returns {number}
 */
function percentile(samples, pct) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return 0;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
    return Number(sorted[index].toFixed(2));
}

/**
 * Run a synthetic pre-scale stress and abuse simulation suite.
 * @param {{
 *   seed?: number,
 *   concurrentUsers?: number,
 *   requestsPerUser?: number,
 *   tiers?: string[],
 *   guardState?: Record<string, any> | null,
 * }} [params]
 * @returns {{
 *   generatedAt: string,
 *   seed: number,
 *   totals: {
 *     requests: number,
 *     failures: number,
 *     failureRatePercent: number,
 *     retries: number,
 *     queueRejections: number,
 *     queueRejectionRatePercent: number,
 *     tokenBurnUsd: number,
 *     freeTierThrottles: number,
 *     forcedThinSnapshots: number,
 *     guardActive: boolean,
 *     latencyP50Ms: number,
 *     latencyP95Ms: number,
 *     latencyP99Ms: number,
 *     peakQueueDepth: number,
 *   },
 *   scenarios: Array<Record<string, unknown>>,
 * }}
 */
export function runPreScaleSimulation(params = {}) {
    const seed = Number.isFinite(Number(params.seed)) ? Number(params.seed) : Date.now();
    const rng = createRng(seed);
    const concurrentUsers = Math.max(20, Math.min(1000, Number(params.concurrentUsers) || 140));
    const requestsPerUser = Math.max(1, Math.min(100, Number(params.requestsPerUser) || 10));
    const tiers = Array.isArray(params.tiers) && params.tiers.length > 0
        ? params.tiers.map((tier) => resolveTier(tier))
        : ['free', 'starter', 'pro', 'admin'];
    const guardState = params.guardState && typeof params.guardState === 'object'
        ? params.guardState
        : null;

    const scenarios = buildScenarios({ concurrentUsers, requestsPerUser });
    const allLatencies = [];

    let totalRequests = 0;
    let totalFailures = 0;
    let totalRetries = 0;
    let totalQueueRejections = 0;
    let totalTokenBurnUsd = 0;
    let totalFreeTierThrottles = 0;
    let totalForcedThinSnapshots = 0;
    let peakQueueDepth = 0;

    const scenarioRows = [];

    for (const scenario of scenarios) {
        let scenarioRequests = 0;
        let scenarioFailures = 0;
        let scenarioRetries = 0;
        let scenarioQueueRejections = 0;
        let scenarioTokenBurnUsd = 0;
        let scenarioFreeTierThrottles = 0;
        let scenarioForcedThinSnapshots = 0;
        const scenarioLatencies = [];

        for (let userIndex = 0; userIndex < scenario.users; userIndex += 1) {
            const simulatedQueueDepth = Math.floor((scenario.users / 4) * scenario.abuseMultiplier * rng());
            peakQueueDepth = Math.max(peakQueueDepth, simulatedQueueDepth);

            for (let requestIndex = 0; requestIndex < scenario.requestsPerUser; requestIndex += 1) {
                const tier = tiers[(userIndex + requestIndex) % tiers.length];
                const result = simulateRequest({ tier, scenario, rng, guardState });

                scenarioRequests += 1;
                scenarioFailures += result.failed ? 1 : 0;
                scenarioRetries += result.retries;
                scenarioQueueRejections += result.queueRejected ? 1 : 0;
                scenarioTokenBurnUsd += result.tokenBurnUsd;
                scenarioFreeTierThrottles += result.freeTierThrottled ? 1 : 0;
                scenarioForcedThinSnapshots += result.forcedThinSnapshot ? 1 : 0;
                scenarioLatencies.push(result.latencyMs);
                allLatencies.push(result.latencyMs);
            }
        }

        totalRequests += scenarioRequests;
        totalFailures += scenarioFailures;
        totalRetries += scenarioRetries;
        totalQueueRejections += scenarioQueueRejections;
        totalTokenBurnUsd += scenarioTokenBurnUsd;
        totalFreeTierThrottles += scenarioFreeTierThrottles;
        totalForcedThinSnapshots += scenarioForcedThinSnapshots;

        scenarioRows.push({
            name: scenario.name,
            users: scenario.users,
            requestsPerUser: scenario.requestsPerUser,
            requests: scenarioRequests,
            failures: scenarioFailures,
            failureRatePercent: scenarioRequests > 0
                ? Number(((scenarioFailures / scenarioRequests) * 100).toFixed(2))
                : 0,
            retries: scenarioRetries,
            queueRejections: scenarioQueueRejections,
            queueRejectionRatePercent: scenarioRequests > 0
                ? Number(((scenarioQueueRejections / scenarioRequests) * 100).toFixed(2))
                : 0,
            tokenBurnUsd: Number(scenarioTokenBurnUsd.toFixed(4)),
            freeTierThrottles: scenarioFreeTierThrottles,
            forcedThinSnapshots: scenarioForcedThinSnapshots,
            latencyP95Ms: percentile(scenarioLatencies, 95),
        });
    }

    const run = {
        generatedAt: new Date().toISOString(),
        seed,
        totals: {
            requests: totalRequests,
            failures: totalFailures,
            failureRatePercent: totalRequests > 0
                ? Number(((totalFailures / totalRequests) * 100).toFixed(2))
                : 0,
            retries: totalRetries,
            queueRejections: totalQueueRejections,
            queueRejectionRatePercent: totalRequests > 0
                ? Number(((totalQueueRejections / totalRequests) * 100).toFixed(2))
                : 0,
            tokenBurnUsd: Number(totalTokenBurnUsd.toFixed(4)),
            freeTierThrottles: totalFreeTierThrottles,
            forcedThinSnapshots: totalForcedThinSnapshots,
            guardActive: Boolean(guardState?.active),
            latencyP50Ms: percentile(allLatencies, 50),
            latencyP95Ms: percentile(allLatencies, 95),
            latencyP99Ms: percentile(allLatencies, 99),
            peakQueueDepth,
        },
        scenarios: scenarioRows,
    };

    recentSimulationRuns.push(run);
    if (recentSimulationRuns.length > 50) {
        recentSimulationRuns.splice(0, recentSimulationRuns.length - 50);
    }

    return run;
}

/**
 * Return recent simulation run summaries.
 * @param {{ limit?: number }} [params]
 * @returns {Array<Record<string, unknown>>}
 */
export function getPreScaleSimulationRuns(params = {}) {
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    return recentSimulationRuns.slice(-limit).reverse();
}

/**
 * Reset simulation history. Intended for tests.
 */
export function resetPreScaleSimulationRuns() {
    recentSimulationRuns.length = 0;
}
