const renewalStateByUser = new Map();

const REFUND_POLICY = Object.freeze({
    windowDays: 14,
    maxUsagePercent: 20,
});

/**
 * Evaluate refund eligibility based on renewal/refund policy.
 * @param {{
 *   purchasedAt: Date | string,
 *   now?: Date,
 *   usagePercent?: number,
 *   previousRefundCount?: number,
 * }} params
 * @returns {{
 *   eligible: boolean,
 *   reason: string,
 *   policy: { windowDays: number, maxUsagePercent: number },
 *   daysSincePurchase: number,
 *   usagePercent: number,
 * }}
 */
export function evaluateRefundEligibility({
    purchasedAt,
    now = new Date(),
    usagePercent = 0,
    previousRefundCount = 0,
}) {
    const purchaseDate = new Date(purchasedAt || 0);
    if (Number.isNaN(purchaseDate.getTime())) {
        throw new Error('purchasedAt must be a valid date.');
    }

    const daysSincePurchase = Math.max(0, Math.floor((new Date(now).getTime() - purchaseDate.getTime()) / 86400000));
    const safeUsagePercent = Math.max(0, Number(usagePercent) || 0);
    const safePreviousRefundCount = Math.max(0, Number(previousRefundCount) || 0);

    if (safePreviousRefundCount > 0) {
        return {
            eligible: false,
            reason: 'Refund already used for this subscription period.',
            policy: REFUND_POLICY,
            daysSincePurchase,
            usagePercent: safeUsagePercent,
        };
    }

    if (daysSincePurchase > REFUND_POLICY.windowDays) {
        return {
            eligible: false,
            reason: `Refund window exceeded (${REFUND_POLICY.windowDays} days).`,
            policy: REFUND_POLICY,
            daysSincePurchase,
            usagePercent: safeUsagePercent,
        };
    }

    if (safeUsagePercent > REFUND_POLICY.maxUsagePercent) {
        return {
            eligible: false,
            reason: `Usage exceeded ${REFUND_POLICY.maxUsagePercent}% threshold.`,
            policy: REFUND_POLICY,
            daysSincePurchase,
            usagePercent: safeUsagePercent,
        };
    }

    return {
        eligible: true,
        reason: 'Eligible for refund under policy.',
        policy: REFUND_POLICY,
        daysSincePurchase,
        usagePercent: safeUsagePercent,
    };
}

/**
 * Update renewal preference for a user.
 * @param {{
 *   userId: string,
 *   autoRenew: boolean,
 *   currentPeriodEnd?: string | Date | null,
 *   now?: Date,
 * }} params
 * @returns {{
 *   userId: string,
 *   autoRenew: boolean,
 *   currentPeriodEnd: string | null,
 *   updatedAt: string,
 * }}
 */
export function setRenewalPreference({
    userId,
    autoRenew,
    currentPeriodEnd = null,
    now = new Date(),
}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        throw new Error('userId is required.');
    }

    const normalizedPeriodEnd = currentPeriodEnd
        ? new Date(currentPeriodEnd).toISOString()
        : null;

    const state = {
        userId: safeUserId,
        autoRenew: Boolean(autoRenew),
        currentPeriodEnd: normalizedPeriodEnd,
        updatedAt: new Date(now).toISOString(),
    };
    renewalStateByUser.set(safeUserId, state);
    return state;
}

/**
 * Get renewal preference state for a user.
 * @param {string} userId
 * @returns {{ userId: string, autoRenew: boolean, currentPeriodEnd: string | null, updatedAt: string } | null}
 */
export function getRenewalPreference(userId) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        return null;
    }
    return renewalStateByUser.get(safeUserId) || null;
}

/**
 * Reset billing-policy state. Intended for tests.
 */
export function resetBillingPolicyState() {
    renewalStateByUser.clear();
}
