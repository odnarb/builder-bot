import express from 'express';
import bodyParser from 'body-parser';

import 'dotenv/config.js';

import { createAppContext } from './app-context.js';
import { registerUserRoutes } from './routes/user-routes.js';
import { registerCommunityRoutes } from './routes/community-routes.js';
import { registerStripeRoutes } from './routes/stripe-routes.js';
import { registerAiRoutes } from './routes/ai-routes.js';
import { registerAdminRoutes } from './routes/admin-routes.js';
import { registerConfigRoutes } from './routes/config-routes.js';

const app = express();
app.use(bodyParser.json());

const {
    routeDeps,
    jwtCheck,
    requireAdminAccess,
    asyncHandler,
} = createAppContext();
const { logger } = routeDeps;

// rewrite urls from /api to /
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) {
            req.url = req.url.replace(/^\/api/, '');
        }
        next();
    });
}

registerUserRoutes(app, routeDeps);
registerConfigRoutes(app, routeDeps);
registerCommunityRoutes(app, routeDeps);
registerStripeRoutes(app, routeDeps);
registerAiRoutes(app, routeDeps);

/**
 * Lock all admin routes with JWT auth + admin authorization.
 */
app.use('/admin', jwtCheck, requireAdminAccess);
registerAdminRoutes(app, routeDeps);

app.get('/', asyncHandler(async (req, res) => {
    res.send('✅ API is running');
}));

app.use(asyncHandler(async (req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
    });
}));

// Global error handler
app.use((err, req, res, next) => {
    const status = Number(err?.status || err?.statusCode || 0);
    if (status === 401 || err?.name === 'UnauthorizedError' || err?.name === 'InvalidTokenError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: err?.message || 'Missing or invalid access token.',
        });
    }

    if (status === 403 || err?.name === 'InsufficientScopeError') {
        return res.status(403).json({
            error: 'Forbidden',
            message: err?.message || 'Insufficient permissions.',
        });
    }

    logger.error('Unhandled API error', {
        status: status || 500,
        method: req.method,
        path: req.originalUrl,
        error: err?.stack || String(err),
    });
    res.status(500).json({ error: 'Internal server error' });
});

export { app };
