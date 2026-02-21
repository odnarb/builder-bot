import {
    createPersistentDoc,
    isPersistentEconomicsEnabled,
} from '../db/firestore/economics-persistence.js';

const processedCheckoutSessions = new Set();
const MAX_IN_MEMORY_PROCESSED_SESSIONS = 20000;

/**
 * Build a Firestore-safe doc id fragment.
 * @param {string} raw
 * @returns {string}
 */
function toDocIdFragment(raw) {
    return Buffer.from(String(raw || ''), 'utf8').toString('base64url');
}

/**
 * Keep in-memory replay state bounded.
 * @param {string} sessionId
 */
function rememberProcessedSession(sessionId) {
    processedCheckoutSessions.add(sessionId);
    while (processedCheckoutSessions.size > MAX_IN_MEMORY_PROCESSED_SESSIONS) {
        const oldest = processedCheckoutSessions.values().next().value;
        if (!oldest) {
            break;
        }
        processedCheckoutSessions.delete(oldest);
    }
}

/**
 * Detect "already exists" errors from persistent create operations.
 * @param {unknown} error
 * @returns {boolean}
 */
function isAlreadyExistsError(error) {
    const code = Number(error?.code);
    if (code === 6 || code === 409) {
        return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return message.includes('already exists');
}

/**
 * Attempt to claim a Stripe checkout confirmation session exactly once.
 * Returns false when session was already processed.
 * @param {{ sessionId: string, userId?: string | null, now?: Date }} params
 * @returns {Promise<boolean>}
 */
export async function claimCheckoutConfirmationSession({
    sessionId,
    userId = null,
    now = new Date(),
}) {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
        return false;
    }

    if (processedCheckoutSessions.has(normalizedSessionId)) {
        return false;
    }

    const persistentModeEnabled = await isPersistentEconomicsEnabled().catch(() => false);
    if (!persistentModeEnabled) {
        rememberProcessedSession(normalizedSessionId);
        return true;
    }

    try {
        await createPersistentDoc({
            collection: 'checkoutConfirmations',
            docId: toDocIdFragment(normalizedSessionId),
            data: {
                sessionId: normalizedSessionId,
                userId: typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : null,
                claimedAt: new Date(now).toISOString(),
            },
        });
    } catch (error) {
        if (isAlreadyExistsError(error)) {
            rememberProcessedSession(normalizedSessionId);
            return false;
        }

        // Fail open to in-memory idempotency if persistence is unavailable at runtime.
        rememberProcessedSession(normalizedSessionId);
        return true;
    }

    rememberProcessedSession(normalizedSessionId);
    return true;
}

/**
 * Reset idempotency runtime state. Intended for tests.
 */
export function resetCheckoutConfirmationIdempotencyState() {
    processedCheckoutSessions.clear();
}
