import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();

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
