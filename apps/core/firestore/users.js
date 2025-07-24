import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();

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

export async function addstepsToUsersBuild({ userId, buildId, steps }) {
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

export async function createUsersSession({ userId, sessionId, sessionStart }) {
    return db.collection('users').doc(userId)
        .collection('sessions').doc(sessionId)
        .set(sessionStart)
}

export async function addLogEntryToUsersSession({ userId, sessionId, log }) {
    return db.collection('users').doc(userId)
        .collection('sessions').doc(sessionId)
        .collection('logs')
        .add(log)
}
