/**
 * Register config endpoints.
 * @param {import('express').Express} app
 * @param {Record<string, any>} deps
 */
export function registerConfigRoutes(app, deps) {
    const {
        asyncHandler,
        getSkuCatalog,
    } = deps;

    /**
     * Return active sellable SKU catalog.
     */
    app.get('/config/skus', asyncHandler(async (req, res) => {
        return res.json({
            skus: getSkuCatalog(),
        });
    }));

    /**
     * Return currently enabled UI localization targets.
     */
    app.get('/config/localization', asyncHandler(async (req, res) => {
        return res.json({
            supportedLocales: ['en', 'es', 'pt', 'fr'],
            defaultLocale: 'en',
        });
    }));
}
