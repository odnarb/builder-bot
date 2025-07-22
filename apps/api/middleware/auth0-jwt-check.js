// middleware/auth0-jwt-check.js
import 'dotenv/config.js';

import { auth } from 'express-oauth2-jwt-bearer';

export default auth({
    audience: [process.env.AUTH0_AUDIENCE], // matches your Auth0 API identifier
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`
});