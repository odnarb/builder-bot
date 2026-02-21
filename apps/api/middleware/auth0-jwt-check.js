// middleware/auth0-jwt-check.js
import 'dotenv/config.js';

import { auth } from 'express-oauth2-jwt-bearer';

/**
 * Require non-empty env values for auth hardening.
 * @param {string} key
 * @returns {string}
 */
function requireEnv(key) {
    const value = String(process.env[key] || '').trim();
    if (!value) {
        throw new Error(`Missing required auth env "${key}".`);
    }
    return value;
}

const auth0Domain = requireEnv('AUTH0_DOMAIN')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
const auth0Audience = requireEnv('AUTH0_AUDIENCE');

export default auth({
    issuerBaseURL: `https://${auth0Domain}`,
    audience: auth0Audience,
    tokenSigningAlg: 'RS256',
});
