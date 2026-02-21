import { resolveTier, TIER_PRICES_USD } from '../config/tier-policy.js';
import logger from './logger.js';
import {
    buildMonthlyDocId,
    readPersistentDoc,
    writePersistentDoc,
} from './economics-persistence.js';

const TIER_ORDER = Object.freeze(['free', 'starter', 'pro', 'admin']);
const INPUT_COST_PER_MILLION_TOKENS = 0.30;
const OUTPUT_COST_PER_MILLION_TOKENS = 0.60;
const DEFAULT_BREAK_EVEN_THRESHOLD_PERCENT = 35;

const INFRA_COST_PER_REQUEST_USD = Object.freeze({
    free: 0.0005,
    starter: 0.0003,
    pro: 0.00024,
    admin: 0.0002,
});

const usageMeteringTable = new Map();
const breakEvenAlertsTable = new Map();
const buildCostSnapshots = new Map();
const hydrationPromisesByMonthlyTier = new Map();

/**
 * Round a USD value for stable reporting.
 * @param {number} value
 * @returns {number}
 */
function roundUsd(value) {
    return Number(value.toFixed(6));
}

/**
 * Round percentage values for reporting.
 * @param {number} value
 * @returns {number}
 */
function roundPercent(value) {
    return Number(value.toFixed(2));
}

/**
 * Normalize an optional month key (`YYYY-MM`) to a canonical value.
 * Falls back to the current UTC month when invalid or missing.
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
 * Build a deterministic map key for monthly tier records.
 * @param {string} month
 * @param {'free' | 'starter' | 'pro' | 'admin'} tier
 * @returns {string}
 */
function buildMonthlyTierKey(month, tier) {
    return `${month}:${tier}`;
}

/**
 * Create an empty mutable monthly metering record.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 * @returns {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUserKeys: Set<string>,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }}
 */
function createMonthlyTierRecord({ month, tier }) {
    return {
        month,
        tier,
        activeUserKeys: new Set(),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        revenue: 0,
        apiCost: 0,
        infraCost: 0,
        totalCost: 0,
        grossMargin: 0,
        updatedAt: null,
    };
}

/**
 * Convert an internal metering record to API-safe JSON.
 * @param {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUserKeys: Set<string>,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }} record
 * @returns {{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUsers: number,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }}
 */
function toPublicMeteringRow(record) {
    return {
        month: record.month,
        tier: record.tier,
        activeUsers: record.activeUserKeys.size,
        requestCount: record.requestCount,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        revenue: roundUsd(record.revenue),
        apiCost: roundUsd(record.apiCost),
        infraCost: roundUsd(record.infraCost),
        totalCost: roundUsd(record.totalCost),
        grossMargin: roundUsd(record.grossMargin),
        updatedAt: record.updatedAt,
    };
}

/**
 * Hydrate one monthly tier record from persistent storage.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 */
async function hydrateMonthlyTierRecord({ month, tier }) {
    const monthlyTierKey = buildMonthlyTierKey(month, tier);
    const record = usageMeteringTable.get(monthlyTierKey);
    if (!record) {
        return;
    }

    try {
        const persisted = await readPersistentDoc({
            collection: 'marginMonthly',
            docId: buildMonthlyDocId({ month, key: tier }),
        });

        if (!persisted) {
            return;
        }

        record.activeUserKeys = new Set(
            Array.isArray(persisted.activeUserKeys)
                ? persisted.activeUserKeys.map((entry) => String(entry))
                : [],
        );
        record.requestCount = Math.max(0, Number(persisted.requestCount) || 0);
        record.inputTokens = Math.max(0, Number(persisted.inputTokens) || 0);
        record.outputTokens = Math.max(0, Number(persisted.outputTokens) || 0);
        record.revenue = Math.max(0, Number(persisted.revenue) || 0);
        record.apiCost = Math.max(0, Number(persisted.apiCost) || 0);
        record.infraCost = Math.max(0, Number(persisted.infraCost) || 0);
        record.totalCost = Math.max(0, Number(persisted.totalCost) || 0);
        record.grossMargin = Number(persisted.grossMargin) || 0;
        record.updatedAt = typeof persisted.updatedAt === 'string' ? persisted.updatedAt : null;
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Persist one monthly tier record to storage.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 */
async function persistMonthlyTierRecord({ month, tier }) {
    const monthlyTierKey = buildMonthlyTierKey(month, tier);
    const record = usageMeteringTable.get(monthlyTierKey);
    if (!record) {
        return;
    }

    try {
        await writePersistentDoc({
            collection: 'marginMonthly',
            docId: buildMonthlyDocId({ month, key: tier }),
            data: {
                month: record.month,
                tier: record.tier,
                activeUserKeys: Array.from(record.activeUserKeys),
                requestCount: record.requestCount,
                inputTokens: record.inputTokens,
                outputTokens: record.outputTokens,
                revenue: roundUsd(record.revenue),
                apiCost: roundUsd(record.apiCost),
                infraCost: roundUsd(record.infraCost),
                totalCost: roundUsd(record.totalCost),
                grossMargin: roundUsd(record.grossMargin),
                updatedAt: record.updatedAt,
            },
        });
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Ensure a mutable metering record exists for month+tier.
 * @param {{ month: string, tier: 'free' | 'starter' | 'pro' | 'admin' }} params
 * @returns {Promise<{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUserKeys: Set<string>,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }>}
 */
async function ensureMonthlyTierRecord({ month, tier }) {
    const monthlyTierKey = buildMonthlyTierKey(month, tier);

    if (!usageMeteringTable.has(monthlyTierKey)) {
        usageMeteringTable.set(monthlyTierKey, createMonthlyTierRecord({ month, tier }));
    }

    if (!hydrationPromisesByMonthlyTier.has(monthlyTierKey)) {
        hydrationPromisesByMonthlyTier.set(monthlyTierKey, hydrateMonthlyTierRecord({ month, tier }));
    }
    await hydrationPromisesByMonthlyTier.get(monthlyTierKey);

    return usageMeteringTable.get(monthlyTierKey);
}

/**
 * Return the canonical UTC month key for "now".
 * @param {Date} [now]
 * @returns {string}
 */
export function getCurrentMonthKey(now = new Date()) {
    return normalizeMonthKey(undefined, now);
}

/**
 * Record per-request usage economics into the monthly metering table.
 * @param {{
 *   userKey: string,
 *   tier: string,
 *   inputTokens: number,
 *   outputTokens: number,
 *   month?: string,
 *   now?: Date,
 * }} params
 * @returns {Promise<{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUsers: number,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }>} 
 */
export async function recordUsageMetering({
    userKey,
    tier,
    inputTokens,
    outputTokens,
    month,
    now = new Date(),
}) {
    const resolvedTier = resolveTier(tier);
    const monthKey = normalizeMonthKey(month, now);
    const safeInputTokens = Math.max(0, Number(inputTokens) || 0);
    const safeOutputTokens = Math.max(0, Number(outputTokens) || 0);
    const safeUserKey = typeof userKey === 'string' && userKey.trim().length > 0
        ? userKey.trim()
        : `unknown:${resolvedTier}`;

    const apiCost = (
        (safeInputTokens * INPUT_COST_PER_MILLION_TOKENS) +
        (safeOutputTokens * OUTPUT_COST_PER_MILLION_TOKENS)
    ) / 1_000_000;

    const infraCost = INFRA_COST_PER_REQUEST_USD[resolvedTier] || 0;
    const record = await ensureMonthlyTierRecord({ month: monthKey, tier: resolvedTier });

    if (!record.activeUserKeys.has(safeUserKey)) {
        record.activeUserKeys.add(safeUserKey);
        record.revenue += TIER_PRICES_USD[resolvedTier] || 0;
    }

    record.requestCount += 1;
    record.inputTokens += safeInputTokens;
    record.outputTokens += safeOutputTokens;
    record.apiCost += apiCost;
    record.infraCost += infraCost;
    record.totalCost = record.apiCost + record.infraCost;
    record.grossMargin = record.revenue - record.totalCost;
    record.updatedAt = new Date(now).toISOString();

    await persistMonthlyTierRecord({ month: monthKey, tier: resolvedTier });
    return toPublicMeteringRow(record);
}

/**
 * Record per-build economics details, including planner/executor token split.
 * @param {{
 *   buildId: string,
 *   userKey: string,
 *   tier: string,
 *   inputTokens: number,
 *   outputTokens: number,
 *   plannerInputTokens?: number,
 *   plannerOutputTokens?: number,
 *   executorInputTokens?: number,
 *   executorOutputTokens?: number,
 *   apiCostUsd?: number,
 *   infraCostUsd?: number,
 *   overageCostUsd?: number,
 *   month?: string,
 *   now?: Date,
 * }} params
 * @returns {Promise<{
 *   buildId: string,
 *   month: string,
 *   userKey: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   inputTokens: number,
 *   outputTokens: number,
 *   plannerInputTokens: number,
 *   plannerOutputTokens: number,
 *   executorInputTokens: number,
 *   executorOutputTokens: number,
 *   apiCostUsd: number,
 *   infraCostUsd: number,
 *   overageCostUsd: number,
 *   totalCostUsd: number,
 *   createdAt: string,
 * }>} 
 */
export async function recordBuildCostSnapshot({
    buildId,
    userKey,
    tier,
    inputTokens,
    outputTokens,
    plannerInputTokens = 0,
    plannerOutputTokens = 0,
    executorInputTokens = 0,
    executorOutputTokens = 0,
    apiCostUsd,
    infraCostUsd,
    overageCostUsd = 0,
    month,
    now = new Date(),
}) {
    const safeBuildId = String(buildId || '').trim() || `build_${Date.now()}`;
    const resolvedTier = resolveTier(tier);
    const monthKey = normalizeMonthKey(month, now);
    const safeInputTokens = Math.max(0, Number(inputTokens) || 0);
    const safeOutputTokens = Math.max(0, Number(outputTokens) || 0);
    const safePlannerInput = Math.max(0, Number(plannerInputTokens) || 0);
    const safePlannerOutput = Math.max(0, Number(plannerOutputTokens) || 0);
    const safeExecutorInput = Math.max(0, Number(executorInputTokens) || 0);
    const safeExecutorOutput = Math.max(0, Number(executorOutputTokens) || 0);

    const resolvedApiCostUsd = Number.isFinite(Number(apiCostUsd))
        ? Math.max(0, Number(apiCostUsd))
        : ((safeInputTokens * INPUT_COST_PER_MILLION_TOKENS) + (safeOutputTokens * OUTPUT_COST_PER_MILLION_TOKENS)) / 1_000_000;
    const resolvedInfraCostUsd = Number.isFinite(Number(infraCostUsd))
        ? Math.max(0, Number(infraCostUsd))
        : (INFRA_COST_PER_REQUEST_USD[resolvedTier] || 0);
    const resolvedOverageCostUsd = Math.max(0, Number(overageCostUsd) || 0);
    const createdAt = new Date(now).toISOString();

    const snapshot = {
        buildId: safeBuildId,
        month: monthKey,
        userKey: typeof userKey === 'string' && userKey.trim().length > 0 ? userKey.trim() : `unknown:${resolvedTier}`,
        tier: resolvedTier,
        inputTokens: safeInputTokens,
        outputTokens: safeOutputTokens,
        plannerInputTokens: safePlannerInput,
        plannerOutputTokens: safePlannerOutput,
        executorInputTokens: safeExecutorInput,
        executorOutputTokens: safeExecutorOutput,
        apiCostUsd: roundUsd(resolvedApiCostUsd),
        infraCostUsd: roundUsd(resolvedInfraCostUsd),
        overageCostUsd: roundUsd(resolvedOverageCostUsd),
        totalCostUsd: roundUsd(resolvedApiCostUsd + resolvedInfraCostUsd + resolvedOverageCostUsd),
        createdAt,
    };

    buildCostSnapshots.set(safeBuildId, snapshot);

    try {
        await writePersistentDoc({
            collection: 'buildEconomics',
            docId: buildMonthlyDocId({ month: monthKey, key: `${resolvedTier}:${safeBuildId}` }),
            data: snapshot,
        });
    } catch {
        // no-op fallback to in-memory state.
    }

    return snapshot;
}

/**
 * Return tracked per-build economics rows.
 * @param {{ month?: string, tier?: string, limit?: number }} [params]
 * @returns {Array<{
 *   buildId: string,
 *   month: string,
 *   userKey: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   inputTokens: number,
 *   outputTokens: number,
 *   plannerInputTokens: number,
 *   plannerOutputTokens: number,
 *   executorInputTokens: number,
 *   executorOutputTokens: number,
 *   apiCostUsd: number,
 *   infraCostUsd: number,
 *   overageCostUsd: number,
 *   totalCostUsd: number,
 *   createdAt: string,
 * }>}
 */
export function getBuildCostSnapshots(params = {}) {
    const month = normalizeMonthKey(params.month, params.now || new Date());
    const tier = typeof params.tier === 'string' ? resolveTier(params.tier) : null;
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 50));

    return Array.from(buildCostSnapshots.values())
        .filter((snapshot) => snapshot.month === month)
        .filter((snapshot) => (tier ? snapshot.tier === tier : true))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
}

/**
 * Fetch monthly usage metering rows for all tiers.
 * @param {{ month?: string, now?: Date }} [params]
 * @returns {Promise<Array<{
 *   month: string,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   activeUsers: number,
 *   requestCount: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   revenue: number,
 *   apiCost: number,
 *   infraCost: number,
 *   totalCost: number,
 *   grossMargin: number,
 *   updatedAt: string | null,
 * }>>}
 */
export async function getUsageMeteringRows(params = {}) {
    const monthKey = normalizeMonthKey(params.month, params.now);
    const rows = [];

    for (const tier of TIER_ORDER) {
        const record = await ensureMonthlyTierRecord({ month: monthKey, tier });
        rows.push(toPublicMeteringRow(record));
    }

    return rows;
}

/**
 * Build a monthly margin report grouped by tier.
 * @param {{ month?: string, thresholdPercent?: number, now?: Date }} [params]
 * @returns {Promise<{
 *   month: string,
 *   generatedAt: string,
 *   thresholdPercent: number,
 *   tiers: Array<{
 *     month: string,
 *     tier: 'free' | 'starter' | 'pro' | 'admin',
 *     activeUsers: number,
 *     requestCount: number,
 *     inputTokens: number,
 *     outputTokens: number,
 *     revenue: number,
 *     apiCost: number,
 *     infraCost: number,
 *     totalCost: number,
 *     grossMargin: number,
 *     rawProfit: number,
 *     marginPercent: number | null,
 *     belowMarginThreshold: boolean,
 *     updatedAt: string | null,
 *   }>,
 *   totals: { revenue: number, totalCost: number, rawProfit: number, marginPercent: number | null },
 * }>} 
 */
export async function getMonthlyMarginReport(params = {}) {
    const monthKey = normalizeMonthKey(params.month, params.now);
    const thresholdPercent = Number.isFinite(Number(params.thresholdPercent))
        ? Number(params.thresholdPercent)
        : DEFAULT_BREAK_EVEN_THRESHOLD_PERCENT;

    const rows = await getUsageMeteringRows({ month: monthKey, now: params.now });
    const tiers = rows.map((row) => {
        const rawProfit = row.revenue - row.totalCost;
        const marginPercent = row.revenue > 0
            ? roundPercent((rawProfit / row.revenue) * 100)
            : null;

        return {
            ...row,
            rawProfit: roundUsd(rawProfit),
            marginPercent,
            belowMarginThreshold: row.tier !== 'free' &&
                row.revenue > 0 &&
                typeof marginPercent === 'number' &&
                marginPercent < thresholdPercent,
        };
    });

    const totalRevenue = tiers.reduce((sum, row) => sum + row.revenue, 0);
    const totalCost = tiers.reduce((sum, row) => sum + row.totalCost, 0);
    const rawProfit = totalRevenue - totalCost;

    return {
        month: monthKey,
        generatedAt: new Date(params.now || new Date()).toISOString(),
        thresholdPercent,
        tiers,
        totals: {
            revenue: roundUsd(totalRevenue),
            totalCost: roundUsd(totalCost),
            rawProfit: roundUsd(rawProfit),
            marginPercent: totalRevenue > 0
                ? roundPercent((rawProfit / totalRevenue) * 100)
                : null,
        },
    };
}

/**
 * Evaluate break-even alerts and emit log warnings on threshold breaches.
 * @param {{ month?: string, thresholdPercent?: number, now?: Date }} [params]
 * @returns {Promise<{
 *   month: string,
 *   thresholdPercent: number,
 *   triggered: Array<Record<string, unknown>>,
 *   resolved: Array<Record<string, unknown>>,
 *   active: Array<Record<string, unknown>>,
 * }>} 
 */
export async function evaluateBreakEvenAlerts(params = {}) {
    const report = await getMonthlyMarginReport(params);
    const triggered = [];
    const resolved = [];

    for (const tierRow of report.tiers) {
        if (tierRow.tier === 'free') {
            continue;
        }

        const key = buildMonthlyTierKey(report.month, tierRow.tier);
        const existingAlert = breakEvenAlertsTable.get(key);

        if (tierRow.belowMarginThreshold) {
            if (!existingAlert || existingAlert.status !== 'active') {
                const alert = {
                    key,
                    status: 'active',
                    month: report.month,
                    tier: tierRow.tier,
                    thresholdPercent: report.thresholdPercent,
                    marginPercent: tierRow.marginPercent,
                    revenue: tierRow.revenue,
                    totalCost: tierRow.totalCost,
                    triggeredAt: report.generatedAt,
                    lastEvaluatedAt: report.generatedAt,
                };

                breakEvenAlertsTable.set(key, alert);
                triggered.push(alert);
                logger.warn(`Margin dropped below threshold for tier ${tierRow.tier} in ${report.month}.`, {
                    tier: tierRow.tier,
                    month: report.month,
                    thresholdPercent: report.thresholdPercent,
                    marginPercent: tierRow.marginPercent,
                    revenue: tierRow.revenue,
                    totalCost: tierRow.totalCost,
                });
            } else {
                breakEvenAlertsTable.set(key, {
                    ...existingAlert,
                    marginPercent: tierRow.marginPercent,
                    revenue: tierRow.revenue,
                    totalCost: tierRow.totalCost,
                    lastEvaluatedAt: report.generatedAt,
                });
            }

            continue;
        }

        if (existingAlert?.status === 'active') {
            const resolvedAlert = {
                ...existingAlert,
                status: 'resolved',
                resolvedAt: report.generatedAt,
                resolvedMarginPercent: tierRow.marginPercent,
                lastEvaluatedAt: report.generatedAt,
            };

            breakEvenAlertsTable.set(key, resolvedAlert);
            resolved.push(resolvedAlert);
            logger.info(`Margin recovered for tier ${tierRow.tier} in ${report.month}.`, {
                tier: tierRow.tier,
                month: report.month,
                thresholdPercent: report.thresholdPercent,
                resolvedMarginPercent: tierRow.marginPercent,
            });
        }
    }

    const active = Array.from(breakEvenAlertsTable.values())
        .filter((alert) => alert.month === report.month && alert.status === 'active');

    return {
        month: report.month,
        thresholdPercent: report.thresholdPercent,
        triggered,
        resolved,
        active,
    };
}

/**
 * Get stored break-even alerts for a month.
 * @param {{ month?: string, now?: Date }} [params]
 * @returns {{
 *   month: string,
 *   active: Array<Record<string, unknown>>,
 *   resolved: Array<Record<string, unknown>>,
 * }}
 */
export function getBreakEvenAlerts(params = {}) {
    const monthKey = normalizeMonthKey(params.month, params.now);
    const alerts = Array.from(breakEvenAlertsTable.values())
        .filter((alert) => alert.month === monthKey);

    return {
        month: monthKey,
        active: alerts.filter((alert) => alert.status === 'active'),
        resolved: alerts.filter((alert) => alert.status === 'resolved'),
    };
}

/**
 * Persist currently loaded metering rows to persistent storage.
 * @returns {Promise<number>}
 */
export async function migrateInMemoryUsageMeteringToPersistentStore() {
    let persistedRows = 0;
    for (const key of usageMeteringTable.keys()) {
        const [month, tier] = key.split(':');
        if (!month || !tier) {
            continue;
        }

        await persistMonthlyTierRecord({
            month,
            tier: resolveTier(tier),
        });
        persistedRows += 1;
    }

    return persistedRows;
}

/**
 * Reset metering and alert state for tests.
 */
export function resetUsageMeteringState() {
    usageMeteringTable.clear();
    breakEvenAlertsTable.clear();
    buildCostSnapshots.clear();
    hydrationPromisesByMonthlyTier.clear();
}
