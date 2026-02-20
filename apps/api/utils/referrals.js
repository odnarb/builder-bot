const referralOwnerByCode = new Map();
const referralCodeByUser = new Map();
const referralRedemptionByUser = new Map();
const referralEvents = [];
const entitlementsByUser = new Map();

const MAX_REFERRAL_REDEMPTIONS_PER_CODE = 5000;

const REFERRAL_BONUS_RULES = Object.freeze({
    referrer: Object.freeze({
        creditKey: 'referral_build_credits',
        creditAmount: 1,
    }),
    referredUser: Object.freeze({
        creditKey: 'welcome_build_credits',
        creditAmount: 1,
    }),
});

/**
 * Build a deterministic referral code from user id.
 * @param {string} userId
 * @returns {string}
 */
function buildReferralCode(userId) {
    const seed = String(userId || 'user').replace(/[^a-z0-9]/gi, '').toUpperCase();
    const suffix = seed.slice(-6).padStart(6, 'X');
    return `BB-${suffix}`;
}

/**
 * Ensure a mutable entitlement ledger exists for a user.
 * @param {string} userId
 * @returns {Map<string, number>}
 */
function ensureEntitlements(userId) {
    if (!entitlementsByUser.has(userId)) {
        entitlementsByUser.set(userId, new Map());
    }
    return entitlementsByUser.get(userId);
}

/**
 * Add entitlement credits to a user.
 * @param {{ userId: string, entitlementKey: string, amount: number }} params
 * @returns {{ entitlementKey: string, total: number }}
 */
function grantEntitlementCredits({ userId, entitlementKey, amount }) {
    const ledger = ensureEntitlements(userId);
    const current = Number(ledger.get(entitlementKey) || 0);
    const next = Math.max(0, current + Math.max(0, Number(amount) || 0));
    ledger.set(entitlementKey, next);
    return {
        entitlementKey,
        total: next,
    };
}

/**
 * Create or return a stable referral code for a user.
 * @param {{ userId: string, now?: Date }} params
 * @returns {{ userId: string, code: string, createdAt: string }}
 */
export function createReferralCode({ userId, now = new Date() }) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        throw new Error('userId is required.');
    }

    if (referralCodeByUser.has(safeUserId)) {
        return {
            userId: safeUserId,
            code: referralCodeByUser.get(safeUserId),
            createdAt: new Date(now).toISOString(),
        };
    }

    let code = buildReferralCode(safeUserId);
    let iteration = 0;
    while (referralOwnerByCode.has(code) && referralOwnerByCode.get(code) !== safeUserId) {
        iteration += 1;
        code = `${buildReferralCode(safeUserId)}-${iteration}`;
    }

    referralCodeByUser.set(safeUserId, code);
    referralOwnerByCode.set(code, safeUserId);

    return {
        userId: safeUserId,
        code,
        createdAt: new Date(now).toISOString(),
    };
}

/**
 * Redeem a referral code and apply entitlement bonuses.
 * @param {{ userId: string, code: string, now?: Date }} params
 * @returns {{
 *   code: string,
 *   ownerUserId: string,
 *   redeemedByUserId: string,
 *   redeemedAt: string,
 *   referrerEntitlement: { entitlementKey: string, total: number },
 *   referredUserEntitlement: { entitlementKey: string, total: number },
 * }}
 */
export function redeemReferralCode({ userId, code, now = new Date() }) {
    const safeUserId = String(userId || '').trim();
    const safeCode = String(code || '').trim().toUpperCase();

    if (!safeUserId || !safeCode) {
        throw new Error('userId and code are required.');
    }

    const ownerUserId = referralOwnerByCode.get(safeCode);
    if (!ownerUserId) {
        throw new Error('Referral code not found.');
    }

    if (ownerUserId === safeUserId) {
        throw new Error('You cannot redeem your own referral code.');
    }

    if (referralRedemptionByUser.has(safeUserId)) {
        throw new Error('Referral code already redeemed for this user.');
    }

    const redemptionsForCode = referralEvents.filter((event) => event.code === safeCode).length;
    if (redemptionsForCode >= MAX_REFERRAL_REDEMPTIONS_PER_CODE) {
        throw new Error('Referral code redemption limit reached.');
    }

    const event = {
        code: safeCode,
        ownerUserId,
        redeemedByUserId: safeUserId,
        redeemedAt: new Date(now).toISOString(),
    };
    referralEvents.push(event);
    referralRedemptionByUser.set(safeUserId, safeCode);

    const referrerEntitlement = grantEntitlementCredits({
        userId: ownerUserId,
        entitlementKey: REFERRAL_BONUS_RULES.referrer.creditKey,
        amount: REFERRAL_BONUS_RULES.referrer.creditAmount,
    });

    const referredUserEntitlement = grantEntitlementCredits({
        userId: safeUserId,
        entitlementKey: REFERRAL_BONUS_RULES.referredUser.creditKey,
        amount: REFERRAL_BONUS_RULES.referredUser.creditAmount,
    });

    return {
        ...event,
        referrerEntitlement,
        referredUserEntitlement,
    };
}

/**
 * Return entitlement balances for a user.
 * @param {string} userId
 * @returns {Array<{ key: string, value: number }>}
 */
export function getUserEntitlements(userId) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId || !entitlementsByUser.has(safeUserId)) {
        return [];
    }

    return Array.from(entitlementsByUser.get(safeUserId).entries())
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Return referral summary for a specific user.
 * @param {string} userId
 * @returns {{
 *   code: string | null,
 *   totalReferredUsers: number,
 *   redeemedCode: string | null,
 *   entitlements: Array<{ key: string, value: number }>,
 * }}
 */
export function getReferralSummary(userId) {
    const safeUserId = String(userId || '').trim();
    const code = referralCodeByUser.get(safeUserId) || null;
    const totalReferredUsers = code
        ? referralEvents.filter((event) => event.code === code).length
        : 0;

    return {
        code,
        totalReferredUsers,
        redeemedCode: referralRedemptionByUser.get(safeUserId) || null,
        entitlements: getUserEntitlements(safeUserId),
    };
}

/**
 * Return latest referral redemption events.
 * @param {{ limit?: number }} [params]
 * @returns {Array<{ code: string, ownerUserId: string, redeemedByUserId: string, redeemedAt: string }>}
 */
export function getReferralEvents(params = {}) {
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    return referralEvents.slice(-limit).reverse();
}

/**
 * Reset in-memory referral state. Intended for tests.
 */
export function resetReferralState() {
    referralOwnerByCode.clear();
    referralCodeByUser.clear();
    referralRedemptionByUser.clear();
    referralEvents.length = 0;
    entitlementsByUser.clear();
}
