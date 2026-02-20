const HIGH_DETAIL_TRIGGERS = new Set([
    'pathfinding_failure',
    'build_failure',
    'combat',
    'explicit_query',
]);

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
            distance: Number(entity?.distance || 0),
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
 * Decide whether to emit a thick snapshot based on context trigger hints.
 * @param {{snapshotMode?: string, triggerReason?: string}} context
 * @returns {boolean}
 */
export function shouldUseThickSnapshot(context = {}) {
    if (context?.snapshotMode === 'thick') {
        return true;
    }

    return HIGH_DETAIL_TRIGGERS.has(String(context?.triggerReason || '').toLowerCase());
}

/**
 * Truncate structured payload to a character budget.
 * @param {unknown} value
 * @param {number} maxChars
 * @returns {unknown}
 */
export function truncateToCharBudget(value, maxChars) {
    const json = JSON.stringify(value);
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

    const inventoryLimit = thick ? 16 : 8;
    const entitiesLimit = thick ? 16 : 8;
    const blocksLimit = thick ? 24 : 12;

    const snapshot = {
        mode: thick ? 'thick' : 'thin',
        identity: {
            userId: context?.identity?.userId || null,
            tier: context?.identity?.tier || null,
        },
        billing: {
            plan: context?.billingState?.plan || null,
            requestCount: Number(context?.usageCounters?.requestCount || 0),
        },
        bot: {
            position: context?.bot?.position || null,
            dimension: context?.bot?.dimension || null,
            biome: context?.bot?.biome || null,
            health: Number(context?.bot?.health || 0),
            food: Number(context?.bot?.food || 0),
        },
        taskState: context?.taskState || {},
        inventorySummary: summarizeInventory(context?.inventory, inventoryLimit),
        nearbyEntitySummary: summarizeEntities(context?.nearbyEntities, entitiesLimit),
        nearbyBlockSummary: summarizeBlocks(context?.nearbyBlocks, blocksLimit),
        ragSnippets: Array.isArray(context?.ragSnippets) ? context.ragSnippets.slice(0, thick ? 6 : 3) : [],
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

