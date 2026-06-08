import { auth } from 'express-oauth2-jwt-bearer';

const DEFAULT_LOCAL_USER_ID = 'local:default';
const DEFAULT_LOCAL_EMAIL = 'local@builderbot.local';

/**
 * Read a required auth environment value.
 * @param {Record<string, string | undefined>} env Environment-like object.
 * @param {string} key Environment key.
 * @returns {string} Trimmed environment value.
 * @throws {Error} When the value is missing.
 */
function requireAuthEnv(env, key) {
    const value = String(env[key] || '').trim();
    if (!value) {
        throw new Error(`Missing required auth env "${key}".`);
    }
    return value;
}

/**
 * Build Auth0 JWT middleware for hosted mode.
 * @param {{ env?: Record<string, string | undefined> }} [options] Auth options.
 * @returns {Function} Express middleware.
 * @throws {Error} When hosted auth env values are missing.
 */
export function createAuth0JwtCheck({ env = process.env } = {}) {
    const auth0Domain = requireAuthEnv(env, 'AUTH0_DOMAIN')
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
    const auth0Audience = requireAuthEnv(env, 'AUTH0_AUDIENCE');

    return auth({
        issuerBaseURL: `https://${auth0Domain}`,
        audience: auth0Audience,
        tokenSigningAlg: 'RS256',
    });
}

/**
 * Build local auth middleware for free local mode.
 * @param {{ env?: Record<string, string | undefined> }} [options] Auth options.
 * @returns {Function} Express middleware.
 */
export function createLocalJwtCheck({ env = process.env } = {}) {
    const localUserId = String(env.LOCAL_USER_ID || DEFAULT_LOCAL_USER_ID).trim() || DEFAULT_LOCAL_USER_ID;
    const localEmail = String(env.LOCAL_USER_EMAIL || DEFAULT_LOCAL_EMAIL).trim() || DEFAULT_LOCAL_EMAIL;

    return (req, _res, next) => {
        req.auth = {
            payload: {
                sub: localUserId,
                email: localEmail,
            },
        };
        return next();
    };
}

/**
 * Build the correct auth middleware for the current runtime mode.
 * @param {{
 *   runtimeModeConfig: { distributionMode?: string },
 *   env?: Record<string, string | undefined>,
 * }} params Runtime auth dependencies.
 * @returns {Function} Express middleware.
 * @throws {Error} When hosted mode is configured without Auth0 env values.
 */
export function createRuntimeJwtCheck({ runtimeModeConfig, env = process.env }) {
    if (runtimeModeConfig?.distributionMode === 'hosted') {
        return createAuth0JwtCheck({ env });
    }

    return createLocalJwtCheck({ env });
}

