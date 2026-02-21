const PERSISTENCE_COLLECTIONS = Object.freeze({
    usageMonthly: 'pre_scale_usage_monthly',
    marginMonthly: 'pre_scale_margin_monthly',
    buildEconomics: 'pre_scale_build_economics',
    telemetryMonthly: 'pre_scale_telemetry_monthly',
    conversionEvents: 'pre_scale_conversion_events',
});

const runtime = {
    firestoreDbPromise: null,
    firestoreDisabledReason: null,
    warningEmitted: false,
};

/**
 * Determine whether runtime should attempt Firestore-backed persistence.
 * Defaults to disabled in test contexts.
 * @returns {boolean}
 */
function shouldUseFirestorePersistence() {
    const mode = String(process.env.PRE_SCALE_PERSISTENCE_MODE || '').trim().toLowerCase();
    if (mode === 'memory' || mode === 'disabled') {
        return false;
    }
    if (mode === 'firestore') {
        return true;
    }

    const runningNodeTests = process.argv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT);
    if (process.env.NODE_ENV === 'test' || runningNodeTests) {
        return false;
    }

    return Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.K_SERVICE,
    );
}

/**
 * Emit a warning exactly once when persistence cannot initialize.
 * @param {string} reason
 */
function warnOnce(reason) {
    if (runtime.warningEmitted) {
        return;
    }

    runtime.warningEmitted = true;
    // eslint-disable-next-line no-console
    console.warn(`[pre-scale-persistence] ${reason}. Falling back to in-memory state.`);
}

/**
 * Encode arbitrary values into Firestore-safe doc-id fragments.
 * @param {string} raw
 * @returns {string}
 */
function toDocIdFragment(raw) {
    return Buffer.from(String(raw || ''), 'utf8').toString('base64url');
}

/**
 * Build a stable monthly doc id from month + logical key.
 * @param {{ month: string, key: string }} params
 * @returns {string}
 */
export function buildMonthlyDocId({ month, key }) {
    return `${month}__${toDocIdFragment(key)}`;
}

/**
 * Build a stable event doc id with a timestamp prefix for query locality.
 * @param {{ month: string, key: string, now?: Date }} params
 * @returns {string}
 */
export function buildEventDocId({ month, key, now = new Date() }) {
    return `${month}__${new Date(now).toISOString()}__${toDocIdFragment(key)}`;
}

/**
 * Initialize and return Firestore DB when available.
 * @returns {Promise<import('@google-cloud/firestore').Firestore | null>}
 */
async function getFirestoreDb() {
    if (!shouldUseFirestorePersistence()) {
        return null;
    }

    if (!runtime.firestoreDbPromise) {
        runtime.firestoreDbPromise = (async () => {
            try {
                const firestoreModule = await import('@google-cloud/firestore');
                const FirestoreCtor = firestoreModule?.Firestore;
                if (!FirestoreCtor) {
                    runtime.firestoreDisabledReason = 'Firestore module loaded without constructor';
                    warnOnce(runtime.firestoreDisabledReason);
                    return null;
                }

                return new FirestoreCtor();
            } catch (error) {
                runtime.firestoreDisabledReason = error?.message || 'Failed to initialize Firestore';
                warnOnce(runtime.firestoreDisabledReason);
                return null;
            }
        })();
    }

    return runtime.firestoreDbPromise;
}

/**
 * Return whether persistent economics storage is active.
 * @returns {Promise<boolean>}
 */
export async function isPersistentEconomicsEnabled() {
    const db = await getFirestoreDb();
    return Boolean(db);
}

/**
 * Load a doc from one of the persistence collections.
 * @param {{ collection: keyof typeof PERSISTENCE_COLLECTIONS, docId: string }} params
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readPersistentDoc({ collection, docId }) {
    const db = await getFirestoreDb();
    if (!db) {
        return null;
    }

    const collectionName = PERSISTENCE_COLLECTIONS[collection];
    if (!collectionName) {
        throw new Error(`Unknown persistence collection "${collection}".`);
    }

    const snapshot = await db.collection(collectionName).doc(docId).get();
    if (!snapshot.exists) {
        return null;
    }

    return snapshot.data() || null;
}

/**
 * Save one doc into a persistence collection with merge semantics.
 * @param {{
 *   collection: keyof typeof PERSISTENCE_COLLECTIONS,
 *   docId: string,
 *   data: Record<string, unknown>,
 * }} params
 */
export async function writePersistentDoc({ collection, docId, data }) {
    const db = await getFirestoreDb();
    if (!db) {
        return;
    }

    const collectionName = PERSISTENCE_COLLECTIONS[collection];
    if (!collectionName) {
        throw new Error(`Unknown persistence collection "${collection}".`);
    }

    await db.collection(collectionName).doc(docId).set(data, { merge: true });
}

/**
 * Store a one-off event row in a persistence collection.
 * @param {{
 *   collection: keyof typeof PERSISTENCE_COLLECTIONS,
 *   docId: string,
 *   data: Record<string, unknown>,
 * }} params
 */
export async function createPersistentDoc({ collection, docId, data }) {
    const db = await getFirestoreDb();
    if (!db) {
        return;
    }

    const collectionName = PERSISTENCE_COLLECTIONS[collection];
    if (!collectionName) {
        throw new Error(`Unknown persistence collection "${collection}".`);
    }

    await db.collection(collectionName).doc(docId).create(data);
}
