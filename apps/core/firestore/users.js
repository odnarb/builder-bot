import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();

/**
 * Return a Firestore Timestamp from the same package instance backing `db`.
 * This avoids cross-package Timestamp instance mismatches.
 * @returns {import('@google-cloud/firestore').Timestamp}
 */
export function nowTimestamp() {
    return Firestore.Timestamp.now();
}

export async function createUser({ user }) {
    const userRef = db.collection('users').doc(user.auth0LoginId);
    const doc = await userRef.get();

    if (!doc.exists) {
        // 🆕 First time signup
        console.log(`Adding new user: ${user.auth0LoginId}`)
        return userRef.set(user);
    }
}

export async function getUserByEmail({ email }) {
    const snaps = await db.collection('users')
        .where('email', '==', email)
        .get()

    if (snaps.empty) return null;

    const snap = snaps.docs[0]

    return { ...snap.data(), id: snap.id }
}

export async function getUserById({ userId }) {
    const snap = await db.collection('users').doc(userId).get()

    if (!snap.exists) return null;

    return { ...snap.data(), id: snap.id }
}

export async function updateUserTier({ userId, tier }) {
    return db.collection('users').doc(userId).update({ tier })
}

export async function createUsersBuild({ userId, build }) {
    return db.collection('users').doc(userId)
        .collection('builds')
        .add({ build })
}

export async function updateUsersBuild({ userId, buildId, build }) {
    return db.collection('users').doc(userId)
        .collection('builds').doc(buildId)
        .set(build, { merge: true })
}

export async function addStepsToUsersBuild({ userId, buildId, steps }) {
    //loop through steps and commit batches to the db
    let batch = db.batch();
    let writeCount = 0;

    for (let i = 0; i < steps.length; i++) {

        const stepRef = db.collection('users').doc(userId)
            .collection('builds').doc(buildId)
            .collection('steps').doc();

        batch.set(stepRef, steps[i]);
        writeCount++;

        if (writeCount === 500) {
            await batch.commit();
            batch = db.batch(); // reset for next chunk
            writeCount = 0;
        }
    }

    // Only commit the final batch if it has writes
    if (writeCount > 0) {
        await batch.commit();
    }

    return true;
}

export async function addLogsToUsersBuild({ userId, buildId, logs }) {
    //loop through logs and commit batches to the db
    let batch = db.batch();
    let writeCount = 0;

    for (let i = 0; i < logs.length; i++) {

        const stepRef = db.collection('users').doc(userId)
            .collection('builds').doc(buildId)
            .collection('log').doc();

        batch.set(stepRef, logs[i]);
        writeCount++;

        if (writeCount === 500) {
            await batch.commit();
            batch = db.batch(); // reset for next chunk
            writeCount = 0;
        }
    }

    // Only commit the final batch if it has writes
    if (writeCount > 0) {
        await batch.commit();
    }

    return true;
}

export async function createUsersSession({ userId, sessionId, sessionStart }) {
    return db.collection('users').doc(userId)
        .collection('sessions').doc(sessionId)
        .set(sessionStart)
}

export async function updateUsersSession({ userId, sessionId, session }) {
    return db.collection('users').doc(userId)
        .collection('sessions').doc(sessionId)
        .set(session, { merge: true })
}

export async function addLogEntryToUsersSession({ userId, sessionId, log }) {
    return db.collection('users').doc(userId)
        .collection('sessions').doc(sessionId)
        .collection('logs')
        .add(log)
}

/**
 * Fetch recent builds for a user.
 * @param {{ userId: string, limit?: number }} params
 * @returns {Promise<Array<{ id: string, build: Record<string, unknown> }>>}
 * @throws {Error}
 */
export async function getUsersBuilds({ userId, limit = 20 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const snapshot = await db.collection('users').doc(userId)
        .collection('builds')
        .limit(safeLimit)
        .get();

    const rows = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    }));

    rows.sort((a, b) => {
        const aMillis = Number(a?.build?.createdAt?.toMillis?.() || 0);
        const bMillis = Number(b?.build?.createdAt?.toMillis?.() || 0);
        return bMillis - aMillis;
    });

    return rows;
}

/**
 * Fetch a single build by id for a user.
 * @param {{ userId: string, buildId: string }} params
 * @returns {Promise<{ id: string, build: Record<string, unknown> } | null>}
 * @throws {Error}
 */
export async function getUsersBuildById({ userId, buildId }) {
    const doc = await db.collection('users').doc(userId)
        .collection('builds')
        .doc(buildId)
        .get();

    if (!doc.exists) {
        return null;
    }

    return {
        id: doc.id,
        ...doc.data(),
    };
}
