const HIGH_DETAIL_TRIGGERS = new Set([
    'pathfinding_failure',
    'build_failure',
    'combat',
    'build_critical',
    'explicit_query',
]);

const DELTA_KEYS = Object.freeze([
    'identity',
    'billingState',
    'bot',
    'taskState',
    'inventory',
    'nearbyEntities',
    'nearbyBlocks',
    'ragSnippets',
    'usageCounters',
]);

const MIN_WORLD_MEMO_REFRESH_MS = 30_000;
const MAX_WORLD_MEMO_REFRESH_MS = 120_000;
const DEFAULT_WORLD_MEMO_REFRESH_MS = 60_000;

const contextStateCache = new Map();

/**
 * Estimate token count from text using a conservative character-to-token ratio.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCountFromText(text) {
    if (!text) {
        return 0;
    }

    return Math.ceil(String(text).length / 4);
}

/**
 * Estimate token count for an arbitrary JSON-serializable value.
 * @param {unknown} value
 * @returns {number}
 */
export function estimateTokenCountFromValue(value) {
    try {
        return estimateTokenCountFromText(JSON.stringify(value));
    } catch {
        return estimateTokenCountFromText(String(value));
    }
}

/**
 * Clamp a number into a bounded range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Quantize numeric values for deterministic context payloads.
 * @param {unknown} value
 * @param {number} decimals
 * @returns {number}
 */
function quantize(value, decimals = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return 0;
    }

    return Number(num.toFixed(decimals));
}

/**
 * Deep-sort object keys to keep serialization deterministic.
 * @param {unknown} value
 * @returns {unknown}
 */
function deepSortKeys(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => deepSortKeys(entry));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = deepSortKeys(value[key]);
    }
    return sorted;
}

/**
 * Serialize data in a stable way for equality checks.
 * @param {unknown} value
 * @returns {string}
 */
function stableSerialize(value) {
    try {
        return JSON.stringify(deepSortKeys(value));
    } catch {
        return String(value);
    }
}

/**
 * Clone JSON-like data for cache safety.
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneJsonLike(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

/**
 * Normalize bot state into a compact deterministic shape.
 * @param {Record<string, unknown> | undefined} botState
 * @returns {{
 *   position: { x: number, y: number, z: number } | null,
 *   dimension: string | null,
 *   biome: string | null,
 *   health: number,
 *   food: number,
 *   inCombat: boolean,
 * }}
 */
export function normalizeBotState(botState) {
    const rawPosition = botState?.position;
    const hasPosition = rawPosition && typeof rawPosition === 'object';

    return {
        position: hasPosition
            ? {
                x: quantize(rawPosition.x, 1),
                y: quantize(rawPosition.y, 1),
                z: quantize(rawPosition.z, 1),
            }
            : null,
        dimension: typeof botState?.dimension === 'string' ? botState.dimension : null,
        biome: typeof botState?.biome === 'string' ? botState.biome : null,
        health: quantize(botState?.health, 1),
        food: quantize(botState?.food, 1),
        inCombat: Boolean(botState?.inCombat),
    };
}

/**
 * Pick the highest-value inventory items and normalize shape.
 * @param {Array<{name?: string, count?: number, durabilityUsed?: number, durability?: number}>} items
 * @param {number} maxItems
 * @returns {Array<{name: string, count: number, durabilityUsed?: number, durability?: number}>}
 */
export function summarizeInventory(items = [], maxItems = 8) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map((item) => ({
            name: String(item?.name || 'unknown'),
            count: Number(item?.count || 0),
            durabilityUsed: Number(item?.durabilityUsed || 0),
            durability: Number(item?.durability || 0),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, maxItems);
}

/**
 * Summarize nearby entities into compact records.
 * @param {Array<{name?: string, type?: string, distance?: number}>} entities
 * @param {number} maxEntities
 * @returns {Array<{name: string, type: string, distance: number}>}
 */
export function summarizeEntities(entities = [], maxEntities = 8) {
    if (!Array.isArray(entities)) {
        return [];
    }

    return entities
        .map((entity) => ({
            name: String(entity?.name || 'unknown'),
            type: String(entity?.type || 'unknown'),
            distance: quantize(entity?.distance, 2),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxEntities);
}

/**
 * Summarize nearby blocks by frequency.
 * @param {Array<{name?: string, count?: number}>} blocks
 * @param {number} maxBlocks
 * @returns {Array<{name: string, count: number}>}
 */
export function summarizeBlocks(blocks = [], maxBlocks = 12) {
    if (!Array.isArray(blocks)) {
        return [];
    }

    return blocks
        .map((block) => ({
            name: String(block?.name || 'unknown'),
            count: Number(block?.count || 0),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, maxBlocks);
}

/**
 * Resolve the canonical high-detail trigger reason for snapshot mode.
 * @param {Record<string, any>} context
 * @returns {'pathfinding_failure' | 'build_failure' | 'combat' | 'build_critical' | 'explicit_query' | null}
 */
export function resolveThickSnapshotTrigger(context = {}) {
    const normalizedReason = String(context?.triggerReason || '').trim().toLowerCase();
    if (HIGH_DETAIL_TRIGGERS.has(normalizedReason)) {
        return normalizedReason;
    }

    if (
        context?.snapshotMode === 'thick' ||
        context?.explicitHighDetail === true ||
        context?.requestHighDetail === true
    ) {
        return 'explicit_query';
    }

    if (context?.taskState?.pathfindingFailure || context?.taskState?.pathFailed) {
        return 'pathfinding_failure';
    }

    if (context?.taskState?.buildFailure || context?.taskState?.failed) {
        return 'build_failure';
    }

    if (
        context?.bot?.inCombat ||
        context?.combat?.active ||
        context?.combatState?.inCombat
    ) {
        return 'combat';
    }

    if (context?.taskState?.buildCritical || context?.taskState?.phase === 'critical') {
        return 'build_critical';
    }

    return null;
}

/**
 * Decide whether to emit a thick snapshot based on context trigger hints.
 * @param {{snapshotMode?: string, triggerReason?: string}} context
 * @returns {boolean}
 */
export function shouldUseThickSnapshot(context = {}) {
    return context?.snapshotMode === 'thick' || resolveThickSnapshotTrigger(context) !== null;
}

/**
 * Build normalized trigger hints for context snapshot generation.
 * @param {Record<string, any>} context
 * @returns {Record<string, any>}
 */
export function withSnapshotHints(context = {}) {
    const triggerReason = resolveThickSnapshotTrigger(context);
    return {
        ...context,
        snapshotMode: triggerReason ? 'thick' : 'thin',
        triggerReason,
    };
}

/**
 * Reduce a top-level context key into a stable delta-comparison value.
 * @param {string} key
 * @param {Record<string, any>} context
 * @returns {unknown}
 */
function toComparableDeltaValue(key, context) {
    switch (key) {
        case 'identity':
            return {
                userId: context?.identity?.userId || null,
                tier: context?.identity?.tier || null,
            };
        case 'billingState':
            return {
                plan: context?.billingState?.plan || null,
            };
        case 'bot':
            return normalizeBotState(context?.bot || {});
        case 'taskState':
            return truncateToCharBudget(context?.taskState || {}, 600);
        case 'inventory':
            return summarizeInventory(context?.inventory, 8);
        case 'nearbyEntities':
            return summarizeEntities(context?.nearbyEntities, 8);
        case 'nearbyBlocks':
            return summarizeBlocks(context?.nearbyBlocks, 12);
        case 'ragSnippets':
            return Array.isArray(context?.ragSnippets)
                ? context.ragSnippets.slice(0, 3)
                : [];
        case 'usageCounters':
            return {
                requestCount: Number(context?.usageCounters?.requestCount || 0),
            };
        default:
            return undefined;
    }
}

/**
 * Build the canonical comparable context used for delta encoding.
 * @param {Record<string, any> | null | undefined} context
 * @returns {Record<string, unknown>}
 */
export function toComparableDeltaContext(context = {}) {
    const comparable = {};

    for (const key of DELTA_KEYS) {
        const value = toComparableDeltaValue(key, context || {});
        if (typeof value !== 'undefined') {
            comparable[key] = value;
        }
    }

    return deepSortKeys(comparable);
}

/**
 * Build a compact delta payload that includes only changed keys.
 * @param {{
 *   previousContext?: Record<string, any> | null,
 *   nextContext?: Record<string, any> | null,
 *   maxChanges?: number,
 * }} params
 * @returns {{
 *   hasChanges: boolean,
 *   changedKeys: string[],
 *   removedKeys: string[],
 *   changes: Record<string, unknown>,
 *   truncated: boolean,
 * }}
 */
export function buildContextDelta({ previousContext = null, nextContext = null, maxChanges = 6 }) {
    const previous = toComparableDeltaContext(previousContext || {});
    const next = toComparableDeltaContext(nextContext || {});
    const allKeys = new Set([
        ...Object.keys(previous),
        ...Object.keys(next),
    ]);

    const fullChanges = [];
    for (const key of Array.from(allKeys).sort()) {
        const inPrevious = Object.prototype.hasOwnProperty.call(previous, key);
        const inNext = Object.prototype.hasOwnProperty.call(next, key);

        if (!inNext && inPrevious) {
            fullChanges.push({ key, removed: true });
            continue;
        }

        if (inNext && !inPrevious) {
            fullChanges.push({ key, value: next[key], removed: false });
            continue;
        }

        if (stableSerialize(previous[key]) !== stableSerialize(next[key])) {
            fullChanges.push({ key, value: next[key], removed: false });
        }
    }

    const safeMaxChanges = Math.max(1, Number(maxChanges) || 1);
    const limitedChanges = fullChanges.slice(0, safeMaxChanges);
    const changedKeys = limitedChanges.map((change) => change.key);
    const removedKeys = limitedChanges
        .filter((change) => change.removed)
        .map((change) => change.key);
    const changes = {};

    for (const change of limitedChanges) {
        if (!change.removed) {
            changes[change.key] = change.value;
        }
    }

    return {
        hasChanges: changedKeys.length > 0,
        changedKeys,
        removedKeys,
        changes,
        truncated: fullChanges.length > safeMaxChanges,
    };
}

/**
 * Build a world memo snapshot used as a reusable context baseline.
 * @param {{ context?: Record<string, any>, now?: Date }} params
 * @returns {{
 *   refreshedAt: string,
 *   bot: ReturnType<typeof normalizeBotState>,
 *   taskState: unknown,
 *   inventorySummary: ReturnType<typeof summarizeInventory>,
 *   nearbyEntitySummary: ReturnType<typeof summarizeEntities>,
 *   nearbyBlockSummary: ReturnType<typeof summarizeBlocks>,
 *   ragSnippets: Array<unknown>,
 * }}
 */
export function buildWorldMemo({ context = {}, now = new Date() }) {
    return {
        refreshedAt: new Date(now).toISOString(),
        bot: normalizeBotState(context?.bot || {}),
        taskState: truncateToCharBudget(context?.taskState || {}, 900),
        inventorySummary: summarizeInventory(context?.inventory, 12),
        nearbyEntitySummary: summarizeEntities(context?.nearbyEntities, 12),
        nearbyBlockSummary: summarizeBlocks(context?.nearbyBlocks, 16),
        ragSnippets: Array.isArray(context?.ragSnippets) ? context.ragSnippets.slice(0, 4) : [],
    };
}

/**
 * Get or initialize mutable per-user context state.
 * @param {string} usageKey
 * @returns {{
 *   usageKey: string,
 *   lastComparableContext: Record<string, unknown> | null,
 *   worldMemo: ReturnType<typeof buildWorldMemo> | null,
 *   worldMemoUpdatedAtMs: number,
 *   lastSeenAtMs: number,
 * }}
 */
function getOrCreateContextState(usageKey) {
    if (!contextStateCache.has(usageKey)) {
        contextStateCache.set(usageKey, {
            usageKey,
            lastComparableContext: null,
            worldMemo: null,
            worldMemoUpdatedAtMs: 0,
            lastSeenAtMs: 0,
        });
    }

    return contextStateCache.get(usageKey);
}

/**
 * Build context payload inputs for snapshot generation:
 * - resolve thick/thin trigger path
 * - compute delta from prior request
 * - refresh world memo cache on interval
 * @param {{
 *   usageKey: string,
 *   context?: Record<string, any>,
 *   now?: Date,
 *   refreshIntervalMs?: number,
 * }} params
 * @returns {{
 *   contextForSnapshot: Record<string, unknown>,
 *   diagnostics: {
 *     snapshotMode: 'thin' | 'thick',
 *     triggerReason: string | null,
 *     worldMemoRefreshed: boolean,
 *     refreshIntervalMs: number,
 *     deltaChangedKeys: string[],
 *     deltaTruncated: boolean,
 *   },
 * }}
 */
export function prepareContextForSnapshot({
    usageKey,
    context = {},
    now = new Date(),
    refreshIntervalMs = DEFAULT_WORLD_MEMO_REFRESH_MS,
}) {
    const safeUsageKey = typeof usageKey === 'string' && usageKey.trim().length > 0
        ? usageKey.trim()
        : 'unknown-user';
    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();
    const state = getOrCreateContextState(safeUsageKey);
    const hintedContext = withSnapshotHints(context);
    const comparableContext = toComparableDeltaContext(hintedContext);
    const safeRefreshIntervalMs = clamp(
        Number(refreshIntervalMs) || DEFAULT_WORLD_MEMO_REFRESH_MS,
        MIN_WORLD_MEMO_REFRESH_MS,
        MAX_WORLD_MEMO_REFRESH_MS,
    );

    let worldMemoRefreshed = false;
    if (
        !state.worldMemo ||
        nowMs - state.worldMemoUpdatedAtMs >= safeRefreshIntervalMs
    ) {
        state.worldMemo = buildWorldMemo({ context: hintedContext, now: nowDate });
        state.worldMemoUpdatedAtMs = nowMs;
        worldMemoRefreshed = true;
    }

    const maxDeltaChanges = hintedContext.snapshotMode === 'thick' ? 12 : 6;
    const delta = buildContextDelta({
        previousContext: state.lastComparableContext,
        nextContext: comparableContext,
        maxChanges: maxDeltaChanges,
    });

    state.lastComparableContext = cloneJsonLike(comparableContext);
    state.lastSeenAtMs = nowMs;

    return {
        contextForSnapshot: {
            ...hintedContext,
            worldMemo: state.worldMemo,
            delta,
        },
        diagnostics: {
            snapshotMode: hintedContext.snapshotMode,
            triggerReason: hintedContext.triggerReason,
            worldMemoRefreshed,
            refreshIntervalMs: safeRefreshIntervalMs,
            deltaChangedKeys: delta.changedKeys,
            deltaTruncated: delta.truncated,
        },
    };
}

/**
 * Truncate structured payload to a character budget.
 * @param {unknown} value
 * @param {number} maxChars
 * @returns {unknown}
 */
export function truncateToCharBudget(value, maxChars) {
    let json = '';

    try {
        json = JSON.stringify(value);
    } catch {
        json = String(value);
    }

    if (json.length <= maxChars) {
        return value;
    }

    return {
        truncated: true,
        preview: json.slice(0, maxChars),
        originalChars: json.length,
        maxChars,
    };
}

/**
 * Build a compact world-context snapshot suitable for AI prompt injection.
 * @param {{
 *   context?: Record<string, any>,
 *   tierPolicy: { maxInputTokensPerRequest: number },
 * }} params
 * @returns {Record<string, unknown>}
 */
export function buildContextSnapshot({ context = {}, tierPolicy }) {
    const thick = shouldUseThickSnapshot(context);
    const maxContextTokens = Math.floor((tierPolicy?.maxInputTokensPerRequest || 4000) * 0.45);
    const maxContextChars = maxContextTokens * 4;

    const hasWorldMemo = Boolean(context?.worldMemo);
    const hasDelta = Boolean(context?.delta && typeof context.delta === 'object');
    const deltaOnly = !thick && hasWorldMemo && hasDelta;

    const inventoryLimit = thick ? 16 : (deltaOnly ? 0 : 8);
    const entitiesLimit = thick ? 16 : (deltaOnly ? 0 : 8);
    const blocksLimit = thick ? 24 : (deltaOnly ? 0 : 12);

    const snapshot = {
        mode: thick ? 'thick' : 'thin',
        deltaOnly,
        triggerReason: context?.triggerReason || null,
        identity: {
            userId: context?.identity?.userId || null,
            tier: context?.identity?.tier || null,
        },
        billing: {
            plan: context?.billingState?.plan || null,
            requestCount: Number(context?.usageCounters?.requestCount || 0),
        },
        bot: normalizeBotState(context?.bot || {}),
        taskState: truncateToCharBudget(context?.taskState || {}, deltaOnly ? 350 : 1200),
        inventorySummary: inventoryLimit > 0
            ? summarizeInventory(context?.inventory, inventoryLimit)
            : [],
        nearbyEntitySummary: entitiesLimit > 0
            ? summarizeEntities(context?.nearbyEntities, entitiesLimit)
            : [],
        nearbyBlockSummary: blocksLimit > 0
            ? summarizeBlocks(context?.nearbyBlocks, blocksLimit)
            : [],
        ragSnippets: deltaOnly
            ? []
            : (Array.isArray(context?.ragSnippets) ? context.ragSnippets.slice(0, thick ? 6 : 3) : []),
        worldMemo: context?.worldMemo || null,
        delta: context?.delta || null,
    };

    return truncateToCharBudget(snapshot, maxContextChars);
}

/**
 * Compute approximate total input tokens for AI call payload.
 * @param {{
 *   message: string,
 *   contextSnapshot: unknown,
 *   tier: string,
 * }} params
 * @returns {number}
 */
export function estimateAiInputTokens({ message, contextSnapshot, tier }) {
    return estimateTokenCountFromValue({
        message,
        context: contextSnapshot,
        tier,
    });
}

/**
 * Reset in-memory context state cache. Intended for tests.
 */
export function resetAiContextState() {
    contextStateCache.clear();
}
