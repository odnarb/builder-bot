import { resolveTier } from '../config/tier-policy.js';

const overageLedgerByMonthAndUser = new Map();

const OVERAGE_USD_PER_1K_TOKENS = Object.freeze({
    starter: 0.0020,
    pro: 0.0025,
    admin: 0.0030,
});

/**
 * Resolve current UTC month key (`YYYY-MM`).
 * @param {Date} [now]
 * @returns {string}
 */
function getMonthKey(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Build ledger key from month and user key.
 * @param {string} month
 * @param {string} userKey
 * @returns {string}
 */
function buildLedgerKey(month, userKey) {
    return `${month}:${userKey}`;
}

/**
 * Round USD to stable reporting precision.
 * @param {number} value
 * @returns {number}
 */
function roundUsd(value) {
    return Number(value.toFixed(6));
}

/**
 * Determine whether a tier policy supports metered overage.
 * @param {{ overagePolicy?: string }} tierPolicy
 * @returns {boolean}
 */
export function supportsMeteredOverage(tierPolicy) {
    const policy = String(tierPolicy?.overagePolicy || '').toLowerCase();
    return policy === 'basic_metered' || policy === 'advanced_metered' || policy === 'metered_overage';
}

/**
 * Return overage price per 1k tokens for a tier.
 * @param {string} tier
 * @returns {number}
 */
export function getOverageRateUsdPer1k(tier) {
    const resolvedTier = resolveTier(tier);
    return OVERAGE_USD_PER_1K_TOKENS[resolvedTier] || 0;
}

/**
 * Ensure a mutable overage ledger row exists for user+month.
 * @param {{ month: string, userKey: string, tier: string }} params
 * @returns {{
 *   month: string,
 *   userKey: string,
 *   tier: string,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 *   overageRequests: number,
 *   overageChargeUsd: number,
 *   updatedAt: string | null,
 * }}
 */
function ensureOverageLedgerRow({ month, userKey, tier }) {
    const key = buildLedgerKey(month, userKey);
    if (!overageLedgerByMonthAndUser.has(key)) {
        overageLedgerByMonthAndUser.set(key, {
            month,
            userKey,
            tier,
            overageInputTokens: 0,
            overageOutputTokens: 0,
            overageRequests: 0,
            overageChargeUsd: 0,
            updatedAt: null,
        });
    }

    return overageLedgerByMonthAndUser.get(key);
}

/**
 * Record billable overage usage for a paid tier.
 * @param {{
 *   userKey: string,
 *   tier: string,
 *   inputOverageTokens?: number,
 *   outputOverageTokens?: number,
 *   overageRequests?: number,
 *   now?: Date,
 * }} params
 * @returns {{
 *   month: string,
 *   userKey: string,
 *   tier: string,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 *   overageRequests: number,
 *   overageChargeUsd: number,
 *   updatedAt: string | null,
 * }}
 */
export function recordOverageUsage({
    userKey,
    tier,
    inputOverageTokens = 0,
    outputOverageTokens = 0,
    overageRequests = 0,
    now = new Date(),
}) {
    const safeUserKey = String(userKey || '').trim();
    if (!safeUserKey) {
        throw new Error('userKey is required.');
    }

    const resolvedTier = resolveTier(tier);
    const ratePer1k = getOverageRateUsdPer1k(resolvedTier);
    if (ratePer1k <= 0) {
        throw new Error(`Tier "${resolvedTier}" does not support billable overage.`);
    }

    const safeInputOverage = Math.max(0, Number(inputOverageTokens) || 0);
    const safeOutputOverage = Math.max(0, Number(outputOverageTokens) || 0);
    const safeOverageRequests = Math.max(0, Number(overageRequests) || 0);
    const month = getMonthKey(now);
    const row = ensureOverageLedgerRow({
        month,
        userKey: safeUserKey,
        tier: resolvedTier,
    });

    row.overageInputTokens += safeInputOverage;
    row.overageOutputTokens += safeOutputOverage;
    row.overageRequests += safeOverageRequests;
    const overageTokens = safeInputOverage + safeOutputOverage;
    row.overageChargeUsd += (overageTokens / 1000) * ratePer1k;
    row.updatedAt = new Date(now).toISOString();

    return {
        ...row,
        overageChargeUsd: roundUsd(row.overageChargeUsd),
    };
}

/**
 * Return overage ledger rows for a month.
 * @param {{ month?: string, now?: Date }} [params]
 * @returns {Array<{
 *   month: string,
 *   userKey: string,
 *   tier: string,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 *   overageRequests: number,
 *   overageChargeUsd: number,
 *   updatedAt: string | null,
 * }>}
 */
export function getOverageReport(params = {}) {
    const month = typeof params.month === 'string' && params.month.trim()
        ? params.month.trim()
        : getMonthKey(params.now || new Date());

    return Array.from(overageLedgerByMonthAndUser.values())
        .filter((row) => row.month === month)
        .map((row) => ({
            ...row,
            overageChargeUsd: roundUsd(row.overageChargeUsd),
        }))
        .sort((a, b) => b.overageChargeUsd - a.overageChargeUsd);
}

/**
 * Return one user's overage snapshot for a month.
 * @param {{ userKey: string, month?: string, now?: Date }} params
 * @returns {{
 *   month: string,
 *   userKey: string,
 *   overageInputTokens: number,
 *   overageOutputTokens: number,
 *   overageRequests: number,
 *   overageChargeUsd: number,
 * } | null}
 */
export function getUserOverageSnapshot({ userKey, month, now = new Date() }) {
    const safeUserKey = String(userKey || '').trim();
    if (!safeUserKey) {
        return null;
    }

    const monthKey = typeof month === 'string' && month.trim() ? month.trim() : getMonthKey(now);
    const row = overageLedgerByMonthAndUser.get(buildLedgerKey(monthKey, safeUserKey));
    if (!row) {
        return null;
    }

    return {
        month: row.month,
        userKey: row.userKey,
        overageInputTokens: row.overageInputTokens,
        overageOutputTokens: row.overageOutputTokens,
        overageRequests: row.overageRequests,
        overageChargeUsd: roundUsd(row.overageChargeUsd),
    };
}

/**
 * Reset in-memory overage ledger. Intended for tests.
 */
export function resetOverageLedger() {
    overageLedgerByMonthAndUser.clear();
}
