const SUBSCRIPTION = 'subscription';
const ONE_TIME = 'one_time';

/**
 * Canonical sellable SKU catalog.
 * Includes active monthly, annual, and one-time SKUs.
 */
export const SKU_CATALOG = Object.freeze({
    lite_monthly: Object.freeze({
        code: 'lite_monthly',
        legacyCodes: ['starter_monthly'],
        name: 'Lite Monthly',
        kind: SUBSCRIPTION,
        tier: 'starter',
        billingPeriod: 'monthly',
        priceUsd: 4.99,
        description: 'Lite tier with core build automation and balanced usage limits.',
        capabilities: Object.freeze({
            multiUserRights: false,
            priorityInferencePool: false,
            sharedBuildLibrary: false,
            persistentWorldMemo: true,
            automationBatchJobs: false,
            adminDashboard: false,
        }),
        active: true,
    }),
    starter_monthly: Object.freeze({
        code: 'starter_monthly',
        name: 'Starter Monthly (Legacy Alias)',
        kind: SUBSCRIPTION,
        tier: 'starter',
        billingPeriod: 'monthly',
        priceUsd: 4.99,
        description: 'Legacy alias for Lite Monthly checkout compatibility.',
        capabilities: Object.freeze({
            multiUserRights: false,
            priorityInferencePool: false,
            sharedBuildLibrary: false,
            persistentWorldMemo: true,
            automationBatchJobs: false,
            adminDashboard: false,
        }),
        active: false,
    }),
    pro_monthly: Object.freeze({
        code: 'pro_monthly',
        name: 'Pro Monthly',
        kind: SUBSCRIPTION,
        tier: 'pro',
        billingPeriod: 'monthly',
        priceUsd: 12.99,
        description: 'Pro tier with advanced AI routing and higher concurrency.',
        capabilities: Object.freeze({
            multiUserRights: false,
            priorityInferencePool: true,
            sharedBuildLibrary: true,
            persistentWorldMemo: true,
            automationBatchJobs: false,
            adminDashboard: false,
        }),
        active: true,
    }),
    pro_annual: Object.freeze({
        code: 'pro_annual',
        name: 'Pro Annual',
        kind: SUBSCRIPTION,
        tier: 'pro',
        billingPeriod: 'annual',
        priceUsd: 129.99,
        description: 'Annual Pro plan with discounted pricing for committed builders.',
        capabilities: Object.freeze({
            multiUserRights: false,
            priorityInferencePool: true,
            sharedBuildLibrary: true,
            persistentWorldMemo: true,
            automationBatchJobs: false,
            adminDashboard: false,
        }),
        active: true,
    }),
    server_license_monthly: Object.freeze({
        code: 'server_license_monthly',
        name: 'Server License Monthly',
        kind: SUBSCRIPTION,
        tier: 'admin',
        billingPeriod: 'monthly',
        priceUsd: 49.99,
        description: 'Infrastructure-grade server license for multi-user and automation workloads.',
        capabilities: Object.freeze({
            multiUserRights: true,
            priorityInferencePool: true,
            sharedBuildLibrary: true,
            persistentWorldMemo: true,
            automationBatchJobs: true,
            adminDashboard: true,
            maxConcurrency: 16,
        }),
        active: true,
    }),
    mega_build_pass: Object.freeze({
        code: 'mega_build_pass',
        name: 'Mega Build Pass',
        kind: ONE_TIME,
        tier: 'pro',
        billingPeriod: 'one_time',
        priceUsd: 19.99,
        description: 'One-time unlock for oversized/expedited mega build jobs.',
        capabilities: Object.freeze({
            megaBuildQuotaBoost: true,
            priorityInferencePool: true,
        }),
        active: true,
    }),
});

const DEFAULT_SKU_BY_TIER = Object.freeze({
    starter: 'lite_monthly',
    pro: 'pro_monthly',
    admin: 'server_license_monthly',
});

/**
 * Return active SKU entries for API consumption.
 * @returns {Array<{
 *   code: string,
 *   legacyCodes?: string[],
 *   name: string,
 *   kind: 'subscription' | 'one_time',
 *   tier: string,
 *   billingPeriod: string,
 *   priceUsd: number,
 *   description: string,
 *   capabilities: Record<string, unknown>,
 *   active: boolean,
 * }>}
 */
export function getSkuCatalog() {
    return Object.values(SKU_CATALOG)
        .filter((sku) => sku.active)
        .sort((a, b) => a.priceUsd - b.priceUsd);
}

/**
 * Resolve a SKU by catalog code.
 * @param {string | undefined | null} code
 * @returns {typeof SKU_CATALOG[keyof typeof SKU_CATALOG] | null}
 */
export function getSkuByCode(code) {
    if (typeof code !== 'string' || code.trim().length === 0) {
        return null;
    }

    const normalizedCode = code.trim();
    if (SKU_CATALOG[normalizedCode] && SKU_CATALOG[normalizedCode].active) {
        return SKU_CATALOG[normalizedCode];
    }

    const matchingAlias = Object.values(SKU_CATALOG)
        .find((sku) => sku.active && Array.isArray(sku.legacyCodes) && sku.legacyCodes.includes(normalizedCode));

    return matchingAlias || SKU_CATALOG[normalizedCode] || null;
}

/**
 * Resolve checkout SKU from either explicit code or legacy tier input.
 * @param {{
 *   skuCode?: string,
 *   tier?: string,
 * }} params
 * @returns {typeof SKU_CATALOG[keyof typeof SKU_CATALOG] | null}
 */
export function resolveCheckoutSku({ skuCode, tier }) {
    const explicitSku = getSkuByCode(skuCode);
    if (explicitSku) {
        return explicitSku;
    }

    const normalizedTier = typeof tier === 'string' ? tier.trim().toLowerCase() : '';
    const mappedCode = DEFAULT_SKU_BY_TIER[normalizedTier];
    return mappedCode ? getSkuByCode(mappedCode) : null;
}
