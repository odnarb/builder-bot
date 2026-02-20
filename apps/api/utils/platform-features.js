const linkedAccountsByUser = new Map();
const buildReactionTable = new Map();
const phrasePacksByUser = new Map();
const marketplaceListings = [];
const policyStateByUser = new Map();
const subscriptionTickets = [];
const parentalControlsByUser = new Map();
const attributionEvents = [];

/**
 * Link a community platform account for a user.
 * @param {{ userId: string, platform: 'curseforge' | 'modrinth', handle: string, now?: Date }} params
 * @returns {{ userId: string, platform: string, handle: string, linkedAt: string }}
 */
export function linkCommunityAccount({ userId, platform, handle, now = new Date() }) {
    const safePlatform = String(platform || '').toLowerCase();
    if (!['curseforge', 'modrinth'].includes(safePlatform)) {
        throw new Error('Unsupported platform.');
    }

    const safeHandle = String(handle || '').trim();
    if (!safeHandle) {
        throw new Error('Account handle is required.');
    }

    if (!linkedAccountsByUser.has(userId)) {
        linkedAccountsByUser.set(userId, {});
    }

    const linkRecord = {
        userId,
        platform: safePlatform,
        handle: safeHandle,
        linkedAt: new Date(now).toISOString(),
    };
    linkedAccountsByUser.get(userId)[safePlatform] = linkRecord;
    return linkRecord;
}

/**
 * Get linked community accounts for a user.
 * @param {string} userId
 * @returns {{ curseforge?: Record<string, unknown>, modrinth?: Record<string, unknown> }}
 */
export function getLinkedCommunityAccounts(userId) {
    return linkedAccountsByUser.get(userId) || {};
}

/**
 * Record one upvote/like reaction per user and build.
 * Duplicate reactions are ignored for anti-fraud baseline protection.
 * @param {{
 *   userId: string,
 *   buildId: string,
 *   reaction: 'like' | 'upvote',
 *   now?: Date,
 * }} params
 * @returns {{ buildId: string, reactionCount: number, deduplicated: boolean }}
 */
export function recordBuildReaction({ userId, buildId, reaction, now = new Date() }) {
    const safeReaction = String(reaction || '').toLowerCase();
    if (!['like', 'upvote'].includes(safeReaction)) {
        throw new Error('Unsupported reaction type.');
    }

    const key = `${buildId}:${safeReaction}`;
    if (!buildReactionTable.has(key)) {
        buildReactionTable.set(key, {
            users: new Set(),
            events: [],
        });
    }

    const row = buildReactionTable.get(key);
    const deduplicated = row.users.has(userId);
    if (!deduplicated) {
        row.users.add(userId);
        row.events.push({
            userId,
            buildId,
            reaction: safeReaction,
            timestamp: new Date(now).toISOString(),
        });
    }

    return {
        buildId,
        reactionCount: row.users.size,
        deduplicated,
    };
}

/**
 * Save a custom phrase pack for a user.
 * @param {{
 *   userId: string,
 *   name: string,
 *   phrases: string[],
 *   now?: Date,
 * }} params
 * @returns {{ id: string, name: string, phrases: string[], createdAt: string }}
 */
export function savePhrasePack({ userId, name, phrases, now = new Date() }) {
    const safeName = String(name || '').trim();
    const safePhrases = Array.isArray(phrases)
        ? phrases.map((phrase) => String(phrase).trim()).filter(Boolean).slice(0, 50)
        : [];

    if (!safeName || safePhrases.length === 0) {
        throw new Error('Phrase pack requires a name and at least one phrase.');
    }

    const pack = {
        id: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: safeName,
        phrases: safePhrases,
        createdAt: new Date(now).toISOString(),
    };

    if (!phrasePacksByUser.has(userId)) {
        phrasePacksByUser.set(userId, []);
    }
    phrasePacksByUser.get(userId).push(pack);
    return pack;
}

/**
 * List a user's phrase packs.
 * @param {string} userId
 * @returns {Array<{ id: string, name: string, phrases: string[], createdAt: string }>}
 */
export function getPhrasePacks(userId) {
    return phrasePacksByUser.get(userId) || [];
}

/**
 * Create a marketplace listing for a build template.
 * @param {{
 *   userId: string,
 *   title: string,
 *   description?: string,
 *   priceUsd?: number,
 *   buildId?: string,
 *   now?: Date,
 * }} params
 * @returns {{ id: string, userId: string, title: string, description: string, priceUsd: number, buildId: string | null, createdAt: string }}
 */
export function createMarketplaceListing({ userId, title, description = '', priceUsd = 0, buildId = null, now = new Date() }) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) {
        throw new Error('Marketplace listing title is required.');
    }

    const safePrice = Math.max(0, Number(priceUsd) || 0);
    const listing = {
        id: `listing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        title: safeTitle,
        description: String(description || '').trim(),
        priceUsd: Number(safePrice.toFixed(2)),
        buildId: typeof buildId === 'string' ? buildId : null,
        createdAt: new Date(now).toISOString(),
    };

    marketplaceListings.push(listing);
    return listing;
}

/**
 * Return recent marketplace listings.
 * @param {{ limit?: number }} [params]
 * @returns {Array<Record<string, unknown>>}
 */
export function getMarketplaceListings(params = {}) {
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
    return marketplaceListings.slice(-limit).reverse();
}

/**
 * Record terms/privacy acceptance for a user.
 * @param {{ userId: string, termsVersion: string, privacyVersion: string, now?: Date }} params
 * @returns {{ acceptedAt: string, termsVersion: string, privacyVersion: string }}
 */
export function acceptPolicyDocuments({ userId, termsVersion, privacyVersion, now = new Date() }) {
    const acceptance = {
        acceptedAt: new Date(now).toISOString(),
        termsVersion: String(termsVersion || '').trim(),
        privacyVersion: String(privacyVersion || '').trim(),
    };

    if (!acceptance.termsVersion || !acceptance.privacyVersion) {
        throw new Error('termsVersion and privacyVersion are required.');
    }

    policyStateByUser.set(userId, acceptance);
    return acceptance;
}

/**
 * Get stored policy acceptance state for a user.
 * @param {string} userId
 * @returns {{ acceptedAt: string, termsVersion: string, privacyVersion: string } | null}
 */
export function getPolicyAcceptance(userId) {
    return policyStateByUser.get(userId) || null;
}

/**
 * Submit a subscription cancellation or refund workflow ticket.
 * @param {{
 *   userId: string,
 *   type: 'cancel' | 'refund',
 *   reason: string,
 *   now?: Date,
 * }} params
 * @returns {{ id: string, userId: string, type: 'cancel' | 'refund', reason: string, status: 'open', createdAt: string }}
 */
export function createSubscriptionTicket({ userId, type, reason, now = new Date() }) {
    const safeType = String(type || '').toLowerCase();
    if (!['cancel', 'refund'].includes(safeType)) {
        throw new Error('Ticket type must be "cancel" or "refund".');
    }

    const safeReason = String(reason || '').trim();
    if (!safeReason) {
        throw new Error('Ticket reason is required.');
    }

    const ticket = {
        id: `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        type: safeType,
        reason: safeReason,
        status: 'open',
        createdAt: new Date(now).toISOString(),
    };

    subscriptionTickets.push(ticket);
    return ticket;
}

/**
 * Set parental-control moderation preferences for a user.
 * @param {{
 *   userId: string,
 *   strictMode: boolean,
 *   blockedTopics?: string[],
 *   now?: Date,
 * }} params
 * @returns {{ strictMode: boolean, blockedTopics: string[], updatedAt: string }}
 */
export function setParentalControls({ userId, strictMode, blockedTopics = [], now = new Date() }) {
    const controls = {
        strictMode: Boolean(strictMode),
        blockedTopics: Array.isArray(blockedTopics)
            ? blockedTopics.map((topic) => String(topic).trim()).filter(Boolean).slice(0, 50)
            : [],
        updatedAt: new Date(now).toISOString(),
    };

    parentalControlsByUser.set(userId, controls);
    return controls;
}

/**
 * Get parental-control preferences for a user.
 * @param {string} userId
 * @returns {{ strictMode: boolean, blockedTopics: string[], updatedAt: string } | null}
 */
export function getParentalControls(userId) {
    return parentalControlsByUser.get(userId) || null;
}

/**
 * Record campaign attribution metadata.
 * @param {{
 *   userId: string,
 *   source: string,
 *   campaign?: string,
 *   medium?: string,
 *   now?: Date,
 * }} params
 * @returns {{ userId: string, source: string, campaign: string | null, medium: string | null, timestamp: string }}
 */
export function recordAttributionEvent({ userId, source, campaign = null, medium = null, now = new Date() }) {
    const event = {
        userId,
        source: String(source || '').trim() || 'unknown',
        campaign: campaign ? String(campaign).trim() : null,
        medium: medium ? String(medium).trim() : null,
        timestamp: new Date(now).toISOString(),
    };
    attributionEvents.push(event);
    return event;
}

/**
 * Return recent attribution events.
 * @param {{ limit?: number }} [params]
 * @returns {Array<Record<string, unknown>>}
 */
export function getAttributionEvents(params = {}) {
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    return attributionEvents.slice(-limit).reverse();
}

/**
 * Reset in-memory platform feature state. Intended for tests.
 */
export function resetPlatformFeaturesState() {
    linkedAccountsByUser.clear();
    buildReactionTable.clear();
    phrasePacksByUser.clear();
    marketplaceListings.length = 0;
    policyStateByUser.clear();
    subscriptionTickets.length = 0;
    parentalControlsByUser.clear();
    attributionEvents.length = 0;
}
