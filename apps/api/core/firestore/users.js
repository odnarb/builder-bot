import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();

export async function getUserByEmail({ email }) {
    const snaps = await db.collection('users')
        .where('email', '==', email)
        .get()

    if (snaps.empty) return null;

    const snap = snaps[0]

    return { ...snap.data(), id: snap.id }
}

export async function updateUserTier({ userId, tier }) {
    return db.collection('users').doc(userId).update({ tier })
}
