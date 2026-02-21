const SUBSCRIPTION = 'subscription';

/**
 * Canonical sellable SKU catalog.
 * Baseline monthly plans only.
 */
export const SKU_CATALOG = Object.freeze({
    starter_monthly: Object.freeze({
        code: 'starter_monthly',
        name: 'Starter Monthly',
        kind: SUBSCRIPTION,
        tier: 'starter',
        billingPeriod: 'monthly',
        priceUsd: 4.99,
        description: 'Starter tier with core build automation and balanced usage limits.',
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
    admin_monthly: Object.freeze({
        code: 'admin_monthly',
        name: 'Admin Monthly',
        kind: SUBSCRIPTION,
        tier: 'admin',
        billingPeriod: 'monthly',
        priceUsd: 24.99,
        description: 'Admin tier with highest limits and priority routing.',
        capabilities: Object.freeze({
            multiUserRights: true,
            priorityInferencePool: true,
            sharedBuildLibrary: true,
            persistentWorldMemo: true,
            automationBatchJobs: true,
            adminDashboard: true,
            maxConcurrency: 8,
        }),
        active: true,
    }),
});

const DEFAULT_SKU_BY_TIER = Object.freeze({
    starter: 'starter_monthly',
    pro: 'pro_monthly',
    admin: 'admin_monthly',
});

/**
 * Return active SKU entries for API consumption.
 * @returns {Array<{
 *   code: string,
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
    return SKU_CATALOG[normalizedCode] || null;
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
