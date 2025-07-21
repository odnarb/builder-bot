import express from 'express';
import bodyParser from 'body-parser';

const app = express();

// Normal JSON for session creation
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('✅ API is running');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('🔥 Uncaught error:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
});

export { app };