import { resolveTier } from '../config/tier-policy.js';
import {
    buildMonthlyDocId,
    readPersistentDoc,
    writePersistentDoc,
} from './economics-persistence.js';

const SUPPORTED_TIERS = Object.freeze(['free', 'starter', 'pro', 'admin']);
const telemetryRows = new Map();
const telemetryHydrationPromises = new Map();

const latencySamplesByTier = new Map();
const queueWaitSamplesByTier = new Map();
const memorySamplesByTier = new Map();
const plannerFirstCallLatencyByModel = new Map();
const plannerCallCountByModel = new Map();
const plannerColdStartLatencyByTier = new Map();

const MAX_SAMPLES_PER_TIER = 5000;

/**
 * Round to a fixed decimal precision.
 * @param {number} value
 * @param {number} places
 * @returns {number}
 */
function round(value, places = 2) {
    return Number(Number(value || 0).toFixed(places));
}

/**
 * Resolve canonical month key (`YYYY-MM`).
 * @param {string | undefined} month
 * @param {Date} [now]
 * @returns {string}
 */
function normalizeMonthKey(month, now = new Date()) {
    if (typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month.trim())) {
        return month.trim();
    }

    const year = now.getUTCFullYear();
    const monthPart = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${monthPart}`;
}

/**
 * Build an internal row key for month+tier rows.
 * @param {string} month
 * @param {'free' | 'starter' | 'pro' | 'admin'} tier
 * @returns {string}
 */
function buildMonthlyTierKey(month, tier) {
    return `${month}:${tier}`;
}

/**
 * Push a numeric sample into a bounded array.
 * @param {Map<string, number[]>} sampleMap
 * @param {string} key
 * @param {number} value
 */
function pushBoundedSample(sampleMap, key, value) {
    const safeValue = Number(value);
    if (!Number.isFinite(safeValue) || safeValue < 0) {
        return;
    }

    if (!sampleMap.has(key)) {
        sampleMap.set(key, []);
    }

    const samples = sampleMap.get(key);
    samples.push(safeValue);
    if (samples.length > MAX_SAMPLES_PER_TIER) {
        samples.splice(0, samples.length - MAX_SAMPLES_PER_TIER);
    }
}

/**
 * Compute percentile from numeric samples.
 * @param {number[]} samples
 * @param {number} percentile
 * @returns {number}
 */
function percentile(samples, percentile) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return 0;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return round(sorted[rank], 2);
}

/**
 * Build a default mutable telemetry row.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 * @returns {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUserKeys: Set<string>,
 *   totalRequests: number,
 *   successfulBuilds: number,
 *   failedRequests: number,
 *   capHits: number,
 *   overageEvents: number,
 *   concurrencyRejections: number,
 *   plannerInputTokens: number,
 *   plannerOutputTokens: number,
 *   executorInputTokens: number,
 *   executorOutputTokens: number,
 *   contextInjectionTokens: number,
 *   contextBaselineTokens: number,
 *   thickSnapshots: number,
 *   totalCostUsd: number,
 *   totalLatencyMs: number,
 *   totalQueueWaitMs: number,
 *   totalExecutorActions: number,
 *   totalExecutorDurationMs: number,
 *   peakHeapUsedMb: number,
 *   peakRssMb: number,
 *   updatedAt: string | null,
 * }}
 */
function createTelemetryRow({ month, tier }) {
    return {
        month,
        tier,
        activeUserKeys: new Set(),
        totalRequests: 0,
        successfulBuilds: 0,
        failedRequests: 0,
        capHits: 0,
        overageEvents: 0,
        concurrencyRejections: 0,
        plannerInputTokens: 0,
        plannerOutputTokens: 0,
        executorInputTokens: 0,
        executorOutputTokens: 0,
        contextInjectionTokens: 0,
        contextBaselineTokens: 0,
        thickSnapshots: 0,
        totalCostUsd: 0,
        totalLatencyMs: 0,
        totalQueueWaitMs: 0,
        totalExecutorActions: 0,
        totalExecutorDurationMs: 0,
        peakHeapUsedMb: 0,
        peakRssMb: 0,
        updatedAt: null,
    };
}

/**
 * Convert one telemetry row into API-facing metrics.
 * @param {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUserKeys: Set<string>,
 *   totalRequests: number,
 *   successfulBuilds: number,
 *   failedRequests: number,
 *   capHits: number,
 *   overageEvents: number,
 *   concurrencyRejections: number,
 *   plannerInputTokens: number,
 *   plannerOutputTokens: number,
 *   executorInputTokens: number,
 *   executorOutputTokens: number,
 *   contextInjectionTokens: number,
 *   contextBaselineTokens: number,
 *   thickSnapshots: number,
 *   totalCostUsd: number,
 *   totalLatencyMs: number,
 *   totalQueueWaitMs: number,
 *   totalExecutorActions: number,
 *   totalExecutorDurationMs: number,
 *   peakHeapUsedMb: number,
 *   peakRssMb: number,
 *   updatedAt: string | null,
 * }} row
 * @returns {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUsers: number,
 *   totalRequests: number,
 *   successfulBuilds: number,
 *   failedRequests: number,
 *   avgPlannerTokensPerBuild: number,
 *   avgExecutorTokensPerBuild: number,
 *   avgContextInjectionTokens: number,
 *   thickSnapshotTriggerFrequencyPercent: number,
 *   deltaCompressionSavingsPercent: number,
 *   capHitRatePercent: number,
 *   overageFrequencyPercent: number,
 *   concurrencyRejectionRatePercent: number,
 *   avgCostPerActiveUserUsd: number,
 *   avgLatencyMs: number,
 *   avgQueueWaitMs: number,
 *   executorThroughputActionsPerSecond: number,
 *   peakHeapUsedMb: number,
 *   peakRssMb: number,
 *   updatedAt: string | null,
 * }}
 */
function toPublicTelemetryRow(row) {
    const successfulBuilds = Math.max(0, row.successfulBuilds);
    const totalRequests = Math.max(0, row.totalRequests);
    const activeUsers = row.activeUserKeys.size;
    const plannerTotalTokens = row.plannerInputTokens + row.plannerOutputTokens;
    const executorTotalTokens = row.executorInputTokens + row.executorOutputTokens;
    const baselineTokens = Math.max(0, row.contextBaselineTokens);
    const compressedTokens = Math.max(0, row.contextInjectionTokens);

    return {
        month: row.month,
        tier: row.tier,
        activeUsers,
        totalRequests,
        successfulBuilds,
        failedRequests: row.failedRequests,
        avgPlannerTokensPerBuild: successfulBuilds > 0 ? round(plannerTotalTokens / successfulBuilds, 2) : 0,
        avgExecutorTokensPerBuild: successfulBuilds > 0 ? round(executorTotalTokens / successfulBuilds, 2) : 0,
        avgContextInjectionTokens: successfulBuilds > 0 ? round(row.contextInjectionTokens / successfulBuilds, 2) : 0,
        thickSnapshotTriggerFrequencyPercent: successfulBuilds > 0 ? round((row.thickSnapshots / successfulBuilds) * 100, 2) : 0,
        deltaCompressionSavingsPercent: baselineTokens > 0
            ? round(((baselineTokens - compressedTokens) / baselineTokens) * 100, 2)
            : 0,
        capHitRatePercent: totalRequests > 0 ? round((row.capHits / totalRequests) * 100, 2) : 0,
        overageFrequencyPercent: successfulBuilds > 0 ? round((row.overageEvents / successfulBuilds) * 100, 2) : 0,
        concurrencyRejectionRatePercent: totalRequests > 0 ? round((row.concurrencyRejections / totalRequests) * 100, 2) : 0,
        avgCostPerActiveUserUsd: activeUsers > 0 ? round(row.totalCostUsd / activeUsers, 6) : 0,
        avgLatencyMs: successfulBuilds > 0 ? round(row.totalLatencyMs / successfulBuilds, 2) : 0,
        avgQueueWaitMs: successfulBuilds > 0 ? round(row.totalQueueWaitMs / successfulBuilds, 2) : 0,
        executorThroughputActionsPerSecond: row.totalExecutorDurationMs > 0
            ? round(row.totalExecutorActions / (row.totalExecutorDurationMs / 1000), 2)
            : 0,
        peakHeapUsedMb: round(row.peakHeapUsedMb, 2),
        peakRssMb: round(row.peakRssMb, 2),
        updatedAt: row.updatedAt,
    };
}

/**
 * Hydrate one telemetry row from persistent storage.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 */
async function hydrateTelemetryRow({ month, tier }) {
    const key = buildMonthlyTierKey(month, tier);
    const row = telemetryRows.get(key);
    if (!row) {
        return;
    }

    try {
        const persisted = await readPersistentDoc({
            collection: 'telemetryMonthly',
            docId: buildMonthlyDocId({ month, key: tier }),
        });

        if (!persisted) {
            return;
        }

        row.activeUserKeys = new Set(
            Array.isArray(persisted.activeUserKeys)
                ? persisted.activeUserKeys.map((entry) => String(entry))
                : [],
        );
        row.totalRequests = Math.max(0, Number(persisted.totalRequests) || 0);
        row.successfulBuilds = Math.max(0, Number(persisted.successfulBuilds) || 0);
        row.failedRequests = Math.max(0, Number(persisted.failedRequests) || 0);
        row.capHits = Math.max(0, Number(persisted.capHits) || 0);
        row.overageEvents = Math.max(0, Number(persisted.overageEvents) || 0);
        row.concurrencyRejections = Math.max(0, Number(persisted.concurrencyRejections) || 0);
        row.plannerInputTokens = Math.max(0, Number(persisted.plannerInputTokens) || 0);
        row.plannerOutputTokens = Math.max(0, Number(persisted.plannerOutputTokens) || 0);
        row.executorInputTokens = Math.max(0, Number(persisted.executorInputTokens) || 0);
        row.executorOutputTokens = Math.max(0, Number(persisted.executorOutputTokens) || 0);
        row.contextInjectionTokens = Math.max(0, Number(persisted.contextInjectionTokens) || 0);
        row.contextBaselineTokens = Math.max(0, Number(persisted.contextBaselineTokens) || 0);
        row.thickSnapshots = Math.max(0, Number(persisted.thickSnapshots) || 0);
        row.totalCostUsd = Math.max(0, Number(persisted.totalCostUsd) || 0);
        row.totalLatencyMs = Math.max(0, Number(persisted.totalLatencyMs) || 0);
        row.totalQueueWaitMs = Math.max(0, Number(persisted.totalQueueWaitMs) || 0);
        row.totalExecutorActions = Math.max(0, Number(persisted.totalExecutorActions) || 0);
        row.totalExecutorDurationMs = Math.max(0, Number(persisted.totalExecutorDurationMs) || 0);
        row.peakHeapUsedMb = Math.max(0, Number(persisted.peakHeapUsedMb) || 0);
        row.peakRssMb = Math.max(0, Number(persisted.peakRssMb) || 0);
        row.updatedAt = typeof persisted.updatedAt === 'string' ? persisted.updatedAt : null;
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Persist one telemetry row to storage.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 */
async function persistTelemetryRow({ month, tier }) {
    const key = buildMonthlyTierKey(month, tier);
    const row = telemetryRows.get(key);
    if (!row) {
        return;
    }

    try {
        await writePersistentDoc({
            collection: 'telemetryMonthly',
            docId: buildMonthlyDocId({ month, key: tier }),
            data: {
                month,
                tier,
                activeUserKeys: Array.from(row.activeUserKeys),
                totalRequests: row.totalRequests,
                successfulBuilds: row.successfulBuilds,
                failedRequests: row.failedRequests,
                capHits: row.capHits,
                overageEvents: row.overageEvents,
                concurrencyRejections: row.concurrencyRejections,
                plannerInputTokens: row.plannerInputTokens,
                plannerOutputTokens: row.plannerOutputTokens,
                executorInputTokens: row.executorInputTokens,
                executorOutputTokens: row.executorOutputTokens,
                contextInjectionTokens: row.contextInjectionTokens,
                contextBaselineTokens: row.contextBaselineTokens,
                thickSnapshots: row.thickSnapshots,
                totalCostUsd: round(row.totalCostUsd, 6),
                totalLatencyMs: row.totalLatencyMs,
                totalQueueWaitMs: row.totalQueueWaitMs,
                totalExecutorActions: row.totalExecutorActions,
                totalExecutorDurationMs: row.totalExecutorDurationMs,
                peakHeapUsedMb: round(row.peakHeapUsedMb, 2),
                peakRssMb: round(row.peakRssMb, 2),
                updatedAt: row.updatedAt,
            },
        });
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Ensure a telemetry row exists and is hydrated for month+tier.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 * @returns {Promise<ReturnType<typeof createTelemetryRow>>}
 */
async function getOrCreateTelemetryRow({ month, tier }) {
    const key = buildMonthlyTierKey(month, tier);
    if (!telemetryRows.has(key)) {
        telemetryRows.set(key, createTelemetryRow({ month, tier }));
    }

    if (!telemetryHydrationPromises.has(key)) {
        telemetryHydrationPromises.set(key, hydrateTelemetryRow({ month, tier }));
    }
    await telemetryHydrationPromises.get(key);

    return telemetryRows.get(key);
}

/**
 * Capture memory profile sample and update row peaks.
 * @param {ReturnType<typeof createTelemetryRow>} row
 * @param {'free' | 'starter' | 'pro' | 'admin'} tier
 */
function captureMemorySample(row, tier) {
    const memoryUsage = process.memoryUsage();
    const heapUsedMb = memoryUsage.heapUsed / (1024 * 1024);
    const rssMb = memoryUsage.rss / (1024 * 1024);

    row.peakHeapUsedMb = Math.max(row.peakHeapUsedMb, heapUsedMb);
    row.peakRssMb = Math.max(row.peakRssMb, rssMb);

    pushBoundedSample(memorySamplesByTier, tier, heapUsedMb);
}

/**
 * Track start of an AI request for pre-scale telemetry rates.
 * @param {{ userKey: string, tier: string, month?: string, now?: Date }} params
 */
export async function recordPreScaleRequestStart({ userKey, tier, month, now = new Date() }) {
    const resolvedTier = resolveTier(tier);
    const monthKey = normalizeMonthKey(month, now);
    const row = await getOrCreateTelemetryRow({ month: monthKey, tier: resolvedTier });

    row.totalRequests += 1;
    if (typeof userKey === 'string' && userKey.trim().length > 0) {
        row.activeUserKeys.add(userKey.trim());
    }
    row.updatedAt = new Date(now).toISOString();

    await persistTelemetryRow({ month: monthKey, tier: resolvedTier });
}

/**
 * Track failed request outcomes (cap hit, concurrency rejection, etc).
 * @param {{
 *   userKey: string,
 *   tier: string,
 *   capHit?: boolean,
 *   concurrencyRejected?: boolean,
 *   latencyMs?: number,
 *   queueWaitMs?: number,
 *   month?: string,
 *   now?: Date,
 * }} params
 */
export async function recordPreScaleRequestFailure({
    userKey,
    tier,
    capHit = false,
    concurrencyRejected = false,
    latencyMs = 0,
    queueWaitMs = 0,
    month,
    now = new Date(),
}) {
    const resolvedTier = resolveTier(tier);
    const monthKey = normalizeMonthKey(month, now);
    const row = await getOrCreateTelemetryRow({ month: monthKey, tier: resolvedTier });

    row.failedRequests += 1;
    row.capHits += capHit ? 1 : 0;
    row.concurrencyRejections += concurrencyRejected ? 1 : 0;
    row.updatedAt = new Date(now).toISOString();

    if (Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0) {
        row.totalLatencyMs += Number(latencyMs);
        pushBoundedSample(latencySamplesByTier, resolvedTier, Number(latencyMs));
    }
    if (Number.isFinite(Number(queueWaitMs)) && Number(queueWaitMs) >= 0) {
        row.totalQueueWaitMs += Number(queueWaitMs);
        pushBoundedSample(queueWaitSamplesByTier, resolvedTier, Number(queueWaitMs));
    }

    captureMemorySample(row, resolvedTier);

    if (typeof userKey === 'string' && userKey.trim().length > 0) {
        row.activeUserKeys.add(userKey.trim());
    }

    await persistTelemetryRow({ month: monthKey, tier: resolvedTier });
}

/**
 * Track successful build telemetry including token split and context diagnostics.
 * @param {{
 *   userKey: string,
 *   tier: string,
 *   plannerInputTokens: number,
 *   plannerOutputTokens: number,
 *   executorInputTokens: number,
 *   executorOutputTokens: number,
 *   contextInjectionTokens: number,
 *   contextBaselineTokens: number,
 *   snapshotMode: 'thin' | 'thick',
 *   overageUsed?: boolean,
 *   totalCostUsd?: number,
 *   latencyMs?: number,
 *   queueWaitMs?: number,
 *   plannerModel?: string,
 *   plannerDurationMs?: number,
 *   executorActions?: number,
 *   executorDurationMs?: number,
 *   month?: string,
 *   now?: Date,
 * }} params
 */
export async function recordPreScaleBuildSuccess({
    userKey,
    tier,
    plannerInputTokens,
    plannerOutputTokens,
    executorInputTokens,
    executorOutputTokens,
    contextInjectionTokens,
    contextBaselineTokens,
    snapshotMode,
    overageUsed = false,
    totalCostUsd = 0,
    latencyMs = 0,
    queueWaitMs = 0,
    plannerModel,
    plannerDurationMs = 0,
    executorActions = 0,
    executorDurationMs = 0,
    month,
    now = new Date(),
}) {
    const resolvedTier = resolveTier(tier);
    const monthKey = normalizeMonthKey(month, now);
    const row = await getOrCreateTelemetryRow({ month: monthKey, tier: resolvedTier });

    row.successfulBuilds += 1;
    row.plannerInputTokens += Math.max(0, Number(plannerInputTokens) || 0);
    row.plannerOutputTokens += Math.max(0, Number(plannerOutputTokens) || 0);
    row.executorInputTokens += Math.max(0, Number(executorInputTokens) || 0);
    row.executorOutputTokens += Math.max(0, Number(executorOutputTokens) || 0);
    row.contextInjectionTokens += Math.max(0, Number(contextInjectionTokens) || 0);
    row.contextBaselineTokens += Math.max(0, Number(contextBaselineTokens) || 0);
    row.thickSnapshots += snapshotMode === 'thick' ? 1 : 0;
    row.overageEvents += overageUsed ? 1 : 0;
    row.totalCostUsd += Math.max(0, Number(totalCostUsd) || 0);
    row.totalExecutorActions += Math.max(0, Number(executorActions) || 0);
    row.totalExecutorDurationMs += Math.max(0, Number(executorDurationMs) || 0);
    row.updatedAt = new Date(now).toISOString();

    if (typeof userKey === 'string' && userKey.trim().length > 0) {
        row.activeUserKeys.add(userKey.trim());
    }

    if (Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0) {
        row.totalLatencyMs += Number(latencyMs);
        pushBoundedSample(latencySamplesByTier, resolvedTier, Number(latencyMs));
    }

    if (Number.isFinite(Number(queueWaitMs)) && Number(queueWaitMs) >= 0) {
        row.totalQueueWaitMs += Number(queueWaitMs);
        pushBoundedSample(queueWaitSamplesByTier, resolvedTier, Number(queueWaitMs));
    }

    if (plannerModel && Number.isFinite(Number(plannerDurationMs)) && Number(plannerDurationMs) >= 0) {
        const safePlannerModel = String(plannerModel);
        const callCount = (plannerCallCountByModel.get(safePlannerModel) || 0) + 1;
        plannerCallCountByModel.set(safePlannerModel, callCount);
        if (callCount === 1) {
            plannerFirstCallLatencyByModel.set(safePlannerModel, Number(plannerDurationMs));
            plannerColdStartLatencyByTier.set(resolvedTier, Number(plannerDurationMs));
        }
    }

    captureMemorySample(row, resolvedTier);
    await persistTelemetryRow({ month: monthKey, tier: resolvedTier });
}

/**
 * Return consolidated pre-scale telemetry dashboard rows.
 * @param {{ month?: string, now?: Date, marginByTier?: Record<string, { revenue: number, totalCost: number }> }} [params]
 * @returns {Promise<{
 *   month: string,
 *   generatedAt: string,
 *   tiers: Array<Record<string, unknown>>,
 * }>} 
 */
export async function getPreScaleTelemetryDashboard(params = {}) {
    const month = normalizeMonthKey(params.month, params.now || new Date());
    const marginByTier = params.marginByTier && typeof params.marginByTier === 'object'
        ? params.marginByTier
        : {};

    const tiers = [];
    for (const tier of SUPPORTED_TIERS) {
        const row = await getOrCreateTelemetryRow({ month, tier });
        const publicRow = toPublicTelemetryRow(row);
        const revenueCost = marginByTier[tier] || { revenue: 0, totalCost: 0 };
        tiers.push({
            ...publicRow,
            revenueUsd: round(Number(revenueCost.revenue) || 0, 6),
            costUsd: round(Number(revenueCost.totalCost) || 0, 6),
        });
    }

    return {
        month,
        generatedAt: new Date(params.now || new Date()).toISOString(),
        tiers,
    };
}

/**
 * Return latency/performance profiling view requested in pre-scale phase.
 * @param {{ month?: string, now?: Date }} [params]
 * @returns {Promise<{
 *   month: string,
 *   generatedAt: string,
 *   tiers: Array<Record<string, unknown>>,
 *   plannerColdStartMsByTier: Record<string, number>,
 * }>} 
 */
export async function getPreScalePerformanceProfile(params = {}) {
    const month = normalizeMonthKey(params.month, params.now || new Date());
    const tiers = [];

    for (const tier of SUPPORTED_TIERS) {
        const row = await getOrCreateTelemetryRow({ month, tier });
        const latencySamples = latencySamplesByTier.get(tier) || [];
        const queueWaitSamples = queueWaitSamplesByTier.get(tier) || [];
        const heapSamples = memorySamplesByTier.get(tier) || [];

        tiers.push({
            tier,
            p50LatencyMs: percentile(latencySamples, 50),
            p95LatencyMs: percentile(latencySamples, 95),
            p99LatencyMs: percentile(latencySamples, 99),
            avgLatencyMs: row.successfulBuilds > 0 ? round(row.totalLatencyMs / row.successfulBuilds, 2) : 0,
            queueWaitP95Ms: percentile(queueWaitSamples, 95),
            queueWaitAvgMs: row.successfulBuilds > 0 ? round(row.totalQueueWaitMs / row.successfulBuilds, 2) : 0,
            executorThroughputActionsPerSecond: row.totalExecutorDurationMs > 0
                ? round(row.totalExecutorActions / (row.totalExecutorDurationMs / 1000), 2)
                : 0,
            peakHeapUsedMb: round(row.peakHeapUsedMb, 2),
            peakRssMb: round(row.peakRssMb, 2),
            sampledHeapP95Mb: percentile(heapSamples, 95),
            requestCount: row.totalRequests,
        });
    }

    return {
        month,
        generatedAt: new Date(params.now || new Date()).toISOString(),
        tiers,
        plannerColdStartMsByTier: Object.fromEntries(plannerColdStartLatencyByTier.entries()),
    };
}

/**
 * Persist all loaded telemetry rows to backing storage.
 * @returns {Promise<number>}
 */
export async function migrateInMemoryPreScaleTelemetryToPersistentStore() {
    let persistedRows = 0;
    for (const key of telemetryRows.keys()) {
        const [month, tier] = key.split(':');
        if (!month || !tier) {
            continue;
        }

        await persistTelemetryRow({ month, tier: resolveTier(tier) });
        persistedRows += 1;
    }

    return persistedRows;
}

/**
 * Reset telemetry state. Intended for tests.
 */
export function resetPreScaleTelemetryState() {
    telemetryRows.clear();
    telemetryHydrationPromises.clear();
    latencySamplesByTier.clear();
    queueWaitSamplesByTier.clear();
    memorySamplesByTier.clear();
    plannerFirstCallLatencyByModel.clear();
    plannerCallCountByModel.clear();
    plannerColdStartLatencyByTier.clear();
}
