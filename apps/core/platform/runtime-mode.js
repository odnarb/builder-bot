const DISTRIBUTION_MODES = new Set(['local', 'hosted']);
const PERSISTENCE_MODES = new Set(['sqlite', 'firestore', 'memory']);
const BILLING_GATE_MODES = new Set(['disabled', 'stripe']);
const LOCAL_ENTITLEMENT_MODES = new Set(['free_open_source']);
const DEFAULT_LOCAL_TIER = 'admin';

/**
 * Normalize an environment value for mode comparisons.
 * @param {unknown} value Environment value to normalize.
 * @returns {string} Trimmed lowercase value, or an empty string.
 */
function normalizeModeValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * Resolve a validated BuilderBot distribution mode.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string }} [env] Environment-like object.
 * @returns {'local' | 'hosted'} Runtime distribution mode.
 * @throws {Error} When the configured distribution mode is not supported.
 */
export function getDistributionMode(env = process.env) {
    const configuredMode = normalizeModeValue(env.BUILDERBOT_DISTRIBUTION_MODE);
    const mode = configuredMode || 'local';

    if (!DISTRIBUTION_MODES.has(mode)) {
        throw new Error('Invalid BUILDERBOT_DISTRIBUTION_MODE. Use "local" or "hosted".');
    }

    return mode;
}

/**
 * Check whether the runtime is configured for hosted SaaS usage.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string }} [env] Environment-like object.
 * @returns {boolean} True when hosted mode is active.
 * @throws {Error} When the configured distribution mode is not supported.
 */
export function isHostedMode(env = process.env) {
    return getDistributionMode(env) === 'hosted';
}

/**
 * Check whether the runtime is configured for local open-source usage.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string }} [env] Environment-like object.
 * @returns {boolean} True when local mode is active.
 * @throws {Error} When the configured distribution mode is not supported.
 */
export function isLocalMode(env = process.env) {
    return getDistributionMode(env) === 'local';
}

/**
 * Resolve the billing gate mode for the current runtime.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string, BILLING_GATE_MODE?: string }} [env] Environment-like object.
 * @returns {'disabled' | 'stripe'} Billing gate mode.
 * @throws {Error} When the configured billing gate mode is not supported.
 */
export function getBillingGateMode(env = process.env) {
    const configuredMode = normalizeModeValue(env.BILLING_GATE_MODE);
    const mode = configuredMode || (isHostedMode(env) ? 'stripe' : 'disabled');

    if (!BILLING_GATE_MODES.has(mode)) {
        throw new Error('Invalid BILLING_GATE_MODE. Use "disabled" or "stripe".');
    }

    return mode;
}

/**
 * Check whether backend billing enforcement should be enabled.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string, BILLING_GATE_MODE?: string }} [env] Environment-like object.
 * @returns {boolean} True when Stripe billing gate mode is active.
 * @throws {Error} When the configured runtime or billing mode is not supported.
 */
export function isBillingEnabled(env = process.env) {
    return getBillingGateMode(env) === 'stripe';
}

/**
 * Resolve the persistence mode for the current runtime.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string, PERSISTENCE_MODE?: string }} [env] Environment-like object.
 * @returns {'sqlite' | 'firestore' | 'memory'} Persistence mode.
 * @throws {Error} When the configured persistence mode is not supported.
 */
export function getPersistenceMode(env = process.env) {
    const configuredMode = normalizeModeValue(env.PERSISTENCE_MODE);
    const mode = configuredMode || (isHostedMode(env) ? 'firestore' : 'sqlite');

    if (!PERSISTENCE_MODES.has(mode)) {
        throw new Error('Invalid PERSISTENCE_MODE. Use "sqlite", "firestore", or "memory".');
    }

    return mode;
}

/**
 * Resolve how entitlements should be determined.
 * @param {{ BUILDERBOT_DISTRIBUTION_MODE?: string, LOCAL_ENTITLEMENT_MODE?: string }} [env] Environment-like object.
 * @returns {'free_open_source' | 'hosted_billing'} Entitlement mode.
 * @throws {Error} When the configured runtime mode is not supported.
 */
export function getEntitlementMode(env = process.env) {
    if (isHostedMode(env)) {
        return 'hosted_billing';
    }

    const mode = normalizeModeValue(env.LOCAL_ENTITLEMENT_MODE) || 'free_open_source';

    if (!LOCAL_ENTITLEMENT_MODES.has(mode)) {
        throw new Error('Invalid LOCAL_ENTITLEMENT_MODE. Use "free_open_source".');
    }

    return mode;
}

/**
 * Resolve the default tier assigned to local open-source users.
 * @param {{ LOCAL_DEFAULT_TIER?: string }} [env] Environment-like object.
 * @returns {'free' | 'starter' | 'pro' | 'admin'} Local default tier.
 * @throws {Error} When the configured local tier is not supported.
 */
export function getLocalDefaultTier(env = process.env) {
    const tier = normalizeModeValue(env.LOCAL_DEFAULT_TIER) || DEFAULT_LOCAL_TIER;
    const allowedTiers = new Set(['free', 'starter', 'pro', 'admin']);

    if (!allowedTiers.has(tier)) {
        throw new Error('Invalid LOCAL_DEFAULT_TIER. Use "free", "starter", "pro", or "admin".');
    }

    return tier;
}

/**
 * Resolve the full runtime mode summary used by app composition.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] Environment-like object.
 * @returns {{
 *   distributionMode: 'local' | 'hosted',
 *   billingGateMode: 'disabled' | 'stripe',
 *   billingEnabled: boolean,
 *   persistenceMode: 'sqlite' | 'firestore' | 'memory',
 *   entitlementMode: string,
 *   localDefaultTier: 'free' | 'starter' | 'pro' | 'admin',
 * }}
 * @throws {Error} When any configured runtime mode value is not supported.
 */
export function getRuntimeModeConfig(env = process.env) {
    return {
        distributionMode: getDistributionMode(env),
        billingGateMode: getBillingGateMode(env),
        billingEnabled: isBillingEnabled(env),
        persistenceMode: getPersistenceMode(env),
        entitlementMode: getEntitlementMode(env),
        localDefaultTier: getLocalDefaultTier(env),
    };
}
