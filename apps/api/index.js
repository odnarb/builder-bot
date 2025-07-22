import express from 'express';
import bodyParser from 'body-parser';

import jwtCheck from './middleware/auth0-jwt-check.js';

import {
    createUser,
    getUserByEmail,
    getUserById
} from './core/firestore/users.js';

const app = express();

// Normal JSON for session creation
app.use(bodyParser.json());

app.get('/user/tier', jwtCheck, async (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const user = await getUserByEmail({ email });
        if (!user) {
            return res.json({ tier: 'pending', exists: false });
        }

        return res.json({ tier: user.tier || 'free' });
    } catch (err) {
        console.error(`❌ Failed to fetch tier for ${email}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/user', jwtCheck, async (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const user = await getUserByEmail({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ user });
    } catch (err) {
        console.error(`❌ Failed to fetch user with email ${email}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/user/:userId', jwtCheck, async (req, res) => {
    const userId = req.params.userId

    try {
        const user = await getUserById({ userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ user });
    } catch (err) {
        console.error(`❌ Failed to fetch user with id ${userId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.post('/user/signup', jwtCheck, async (req, res) => {
    const { email, name, auth0LoginId, picture } = req.body

    try {
        const user = { email, name, auth0LoginId, picture }

        console.log(`Creating user: `, user)
        await createUser({ user });

        return res.send(200);
    } catch (err) {
        console.error(`❌ Failed to create user with id ${auth0LoginId}: ${err.stack}`);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/', (req, res) => {
    res.send('✅ API is running');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };