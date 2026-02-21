import {
    buildEventDocId,
    writePersistentDoc,
} from '../db/firestore/economics-persistence.js';

const conversionEvents = [];
const userLifecycleState = new Map();

/**
 * Resolve canonical month key (`YYYY-MM`).
 * @param {Date} [now]
 * @returns {string}
 */
function getMonthKey(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Normalize tier naming for funnel analytics.
 * @param {string | undefined | null} tier
 * @returns {'free' | 'starter' | 'pro' | 'admin'}
 */
function normalizeFunnelTier(tier) {
    const normalized = String(tier || '').trim().toLowerCase();
    if (normalized === 'starter') {
        return 'starter';
    }
    if (normalized === 'pro') {
        return 'pro';
    }
    if (normalized === 'admin') {
        return 'admin';
    }
    return 'free';
}

/**
 * Get or initialize mutable lifecycle state for a user.
 * @param {string} userId
 * @returns {{
 *   userId: string,
 *   firstSeenAt: string,
 *   currentTier: 'free' | 'starter' | 'pro' | 'admin',
 *   featureUsage: Record<string, number>,
 * }}
 */
function getOrCreateLifecycleState(userId) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        throw new Error('userId is required.');
    }

    if (!userLifecycleState.has(safeUserId)) {
        userLifecycleState.set(safeUserId, {
            userId: safeUserId,
            firstSeenAt: new Date().toISOString(),
            currentTier: 'free',
            featureUsage: {},
        });
    }

    return userLifecycleState.get(safeUserId);
}

/**
 * Persist one conversion event row.
 * @param {Record<string, unknown>} event
 */
async function persistConversionEvent(event) {
    try {
        const month = String(event.month || getMonthKey(new Date()));
        const eventId = String(event.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        await writePersistentDoc({
            collection: 'conversionEvents',
            docId: buildEventDocId({ month, key: eventId, now: new Date(event.timestamp || Date.now()) }),
            data: event,
        });
    } catch {
        // no-op fallback to in-memory state.
    }
}

/**
 * Record one conversion/funnel event.
 * @param {{
 *   userId: string,
 *   type: string,
 *   fromTier?: string,
 *   toTier?: string,
 *   skuCode?: string | null,
 *   metadata?: Record<string, unknown>,
 *   now?: Date,
 * }} params
 * @returns {Promise<Record<string, unknown>>}
 */
export async function recordConversionEvent({
    userId,
    type,
    fromTier,
    toTier,
    skuCode = null,
    metadata = {},
    now = new Date(),
}) {
    const lifecycle = getOrCreateLifecycleState(userId);
    const timestamp = new Date(now).toISOString();
    const event = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        month: getMonthKey(now),
        timestamp,
        userId: lifecycle.userId,
        type: String(type || 'unknown').trim() || 'unknown',
        fromTier: normalizeFunnelTier(fromTier || lifecycle.currentTier),
        toTier: normalizeFunnelTier(toTier || lifecycle.currentTier),
        skuCode: skuCode ? String(skuCode) : null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
    };

    conversionEvents.push(event);
    if (conversionEvents.length > 50000) {
        conversionEvents.splice(0, conversionEvents.length - 50000);
    }

    await persistConversionEvent(event);
    return event;
}

/**
 * Record one feature usage signal for later "before upgrade" analysis.
 * @param {{ userId: string, tier: string, feature: string, now?: Date }} params
 * @returns {Promise<void>}
 */
export async function recordFeatureUsageSignal({ userId, tier, feature, now = new Date() }) {
    const lifecycle = getOrCreateLifecycleState(userId);
    const safeFeature = String(feature || '').trim();
    if (!safeFeature) {
        return;
    }

    lifecycle.featureUsage[safeFeature] = Math.max(0, Number(lifecycle.featureUsage[safeFeature] || 0)) + 1;
    lifecycle.currentTier = normalizeFunnelTier(tier || lifecycle.currentTier);

    await recordConversionEvent({
        userId,
        type: 'feature_usage',
        fromTier: lifecycle.currentTier,
        toTier: lifecycle.currentTier,
        metadata: {
            feature: safeFeature,
            count: lifecycle.featureUsage[safeFeature],
        },
        now,
    });
}

/**
 * Track signup lifecycle start for funnel denominator calculations.
 * @param {{ userId: string, tier?: string, now?: Date }} params
 */
export async function recordSignupLifecycle({ userId, tier = 'free', now = new Date() }) {
    const lifecycle = getOrCreateLifecycleState(userId);
    lifecycle.firstSeenAt = new Date(now).toISOString();
    lifecycle.currentTier = normalizeFunnelTier(tier);

    await recordConversionEvent({
        userId,
        type: 'signup',
        fromTier: 'free',
        toTier: lifecycle.currentTier,
        now,
    });
}

/**
 * Track checkout session start for funnel timing.
 * @param {{ userId: string, fromTier: string, toTier: string, skuCode?: string | null, now?: Date }} params
 */
export async function recordCheckoutStarted({ userId, fromTier, toTier, skuCode = null, now = new Date() }) {
    await recordConversionEvent({
        userId,
        type: 'checkout_started',
        fromTier,
        toTier,
        skuCode,
        now,
    });
}

/**
 * Track completed tier transition and attach feature-usage snapshot from pre-upgrade behavior.
 * @param {{ userId: string, fromTier: string, toTier: string, skuCode?: string | null, now?: Date }} params
 */
export async function recordTierUpgrade({ userId, fromTier, toTier, skuCode = null, now = new Date() }) {
    const lifecycle = getOrCreateLifecycleState(userId);
    const nextTier = normalizeFunnelTier(toTier);
    const previousTier = normalizeFunnelTier(fromTier || lifecycle.currentTier);
    const featuresBeforeUpgrade = { ...lifecycle.featureUsage };

    await recordConversionEvent({
        userId,
        type: 'tier_upgrade',
        fromTier: previousTier,
        toTier: nextTier,
        skuCode,
        metadata: {
            featuresBeforeUpgrade,
            firstSeenAt: lifecycle.firstSeenAt,
        },
        now,
    });

    lifecycle.currentTier = nextTier;
}

/**
 * Build conversion funnel summary report.
 * @param {{ days?: number, now?: Date }} [params]
 * @returns {{
 *   generatedAt: string,
 *   days: number,
 *   users: {
 *     freeUsers: number,
 *     starterUsers: number,
 *     proUsers: number,
 *     adminUsers: number,
 *   },
 *   conversionPercentages: {
 *     freeToStarter: number,
 *     starterToPro: number,
 *     proToAdmin: number,
 *   },
 *   upgradeTimeToConversionHours: number,
 *   topFeaturesBeforeUpgrade: Array<{ feature: string, count: number }>,
 * }}
 */
export function getConversionFunnelReport(params = {}) {
    const days = Math.max(1, Math.min(365, Number(params.days) || 90));
    const now = new Date(params.now || new Date());
    const cutoffMs = now.getTime() - (days * 24 * 60 * 60 * 1000);

    const windowEvents = conversionEvents.filter((event) => new Date(event.timestamp).getTime() >= cutoffMs);
    const usersByTier = {
        freeUsers: new Set(),
        starterUsers: new Set(),
        proUsers: new Set(),
        adminUsers: new Set(),
    };

    const usersStartedFree = new Set();
    const usersFreeToStarter = new Set();
    const usersStarterToPro = new Set();
    const usersProToAdmin = new Set();

    const firstSignupByUser = new Map();
    const firstPaidByUser = new Map();
    const featureCounts = new Map();

    for (const event of windowEvents) {
        const userId = String(event.userId || '');
        if (!userId) {
            continue;
        }

        if (event.type === 'signup') {
            usersStartedFree.add(userId);
            usersByTier.freeUsers.add(userId);
            if (!firstSignupByUser.has(userId)) {
                firstSignupByUser.set(userId, new Date(event.timestamp).getTime());
            }
        }

        if (event.type === 'tier_upgrade') {
            const fromTier = normalizeFunnelTier(event.fromTier);
            const toTier = normalizeFunnelTier(event.toTier);

            if (toTier === 'starter') {
                usersByTier.starterUsers.add(userId);
            }
            if (toTier === 'pro') {
                usersByTier.proUsers.add(userId);
            }
            if (toTier === 'admin') {
                usersByTier.adminUsers.add(userId);
            }

            if (fromTier === 'free' && toTier === 'starter') {
                usersFreeToStarter.add(userId);
            }
            if (fromTier === 'starter' && toTier === 'pro') {
                usersStarterToPro.add(userId);
            }
            if (fromTier === 'pro' && toTier === 'admin') {
                usersProToAdmin.add(userId);
            }

            if (!firstPaidByUser.has(userId) && (toTier === 'starter' || toTier === 'pro' || toTier === 'admin')) {
                firstPaidByUser.set(userId, new Date(event.timestamp).getTime());
            }

            const features = event.metadata?.featuresBeforeUpgrade;
            if (features && typeof features === 'object') {
                for (const [feature, rawCount] of Object.entries(features)) {
                    const count = Math.max(0, Number(rawCount) || 0);
                    if (count <= 0) {
                        continue;
                    }
                    featureCounts.set(feature, (featureCounts.get(feature) || 0) + count);
                }
            }
        }

        if (event.type === 'checkout_started') {
            const toTier = normalizeFunnelTier(event.toTier);
            if (toTier === 'starter') {
                usersByTier.starterUsers.add(userId);
            }
            if (toTier === 'pro') {
                usersByTier.proUsers.add(userId);
            }
            if (toTier === 'admin') {
                usersByTier.adminUsers.add(userId);
            }
        }
    }

    const upgradeDurationsHours = [];
    for (const [userId, paidAtMs] of firstPaidByUser.entries()) {
        const signupAtMs = firstSignupByUser.get(userId);
        if (!signupAtMs || paidAtMs < signupAtMs) {
            continue;
        }

        upgradeDurationsHours.push((paidAtMs - signupAtMs) / (1000 * 60 * 60));
    }

    const topFeaturesBeforeUpgrade = Array.from(featureCounts.entries())
        .map(([feature, count]) => ({ feature, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    const freeUsersCount = usersStartedFree.size;
    const starterUsersCount = usersByTier.starterUsers.size;
    const proUsersCount = usersByTier.proUsers.size;

    return {
        generatedAt: now.toISOString(),
        days,
        users: {
            freeUsers: freeUsersCount,
            starterUsers: starterUsersCount,
            proUsers: proUsersCount,
            adminUsers: usersByTier.adminUsers.size,
        },
        conversionPercentages: {
            freeToStarter: freeUsersCount > 0 ? Number(((usersFreeToStarter.size / freeUsersCount) * 100).toFixed(2)) : 0,
            starterToPro: starterUsersCount > 0 ? Number(((usersStarterToPro.size / starterUsersCount) * 100).toFixed(2)) : 0,
            proToAdmin: proUsersCount > 0 ? Number(((usersProToAdmin.size / proUsersCount) * 100).toFixed(2)) : 0,
        },
        upgradeTimeToConversionHours: upgradeDurationsHours.length > 0
            ? Number((upgradeDurationsHours.reduce((sum, hours) => sum + hours, 0) / upgradeDurationsHours.length).toFixed(2))
            : 0,
        topFeaturesBeforeUpgrade,
    };
}

/**
 * Reset conversion funnel state for tests.
 */
export function resetConversionFunnelState() {
    conversionEvents.length = 0;
    userLifecycleState.clear();
}
