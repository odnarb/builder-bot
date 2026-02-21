import { staticRouteDeps } from './context/static-route-deps.js';
import { createRuntimeRouteDeps } from './context/runtime-route-deps.js';

/**
 * Build all app/runtime dependencies used by route modules.
 * @returns {{
 *   routeDeps: Record<string, any>,
 *   jwtCheck: Function,
 *   requireAdminAccess: Function,
 *   asyncHandler: Function,
 * }}
 */
export function createAppContext() {
    const {
        jwtCheck,
        requireAdminAccess,
        asyncHandler,
        runtimeRouteDeps,
    } = createRuntimeRouteDeps({
        staticRouteDeps,
    });

    const routeDeps = {
        ...staticRouteDeps,
        ...runtimeRouteDeps,
    };

    return {
        routeDeps,
        jwtCheck,
        requireAdminAccess,
        asyncHandler,
    };
}
