# Core Architecture Conventions
Date: 2026-02-21

## Goals
- Keep deployable apps (`apps/api`, `apps/functions/*`) HTTP/runtime focused.
- Keep shared business + persistence logic in canonical `apps/core`.
- Enforce deploy-root safety (no hidden imports outside staged app source).

## Canonical Source Layout
- `apps/core/contracts/*`
  - Shared policy/config contracts (tiers, SKUs, constants).
- `apps/core/db/firestore/*`
  - Firestore persistence adapters only.
- `apps/core/logic/*`
  - Shared business logic and stateful in-memory domain modules.
- `apps/core/platform/*`
  - Shared platform abstractions (logger/provider helpers).

## App Layout Expectations
- `apps/api/index.js`
  - Express bootstrap, middleware wiring, route mounts, 404/error handlers only.
- `apps/api/app-context.js`
  - Composition root that assembles dependencies for route modules.
- `apps/api/routes/*`
  - HTTP adapters only (request/response mapping).
- `apps/api/utils/*`
  - Compatibility adapters only during migration (`export * from ../core/...`).

## Staging Model
Deployable apps use staged local mirrors before run/deploy:
- `apps/core -> apps/api/core`
- `apps/core -> apps/functions/stripe-api/core`
- `apps/shared-utils -> apps/api/shared-utils`
- `packages/prompt-parser -> apps/api/packages/prompt-parser`

Command:
```bash
npm run stage:shared-core
```

`npm test` and `npm run test:api-smoke` run staging first.

## Boundary Rules
Validated by `scripts/check-architecture-boundaries.mjs`:
- Only approved DB adapters may import `@google-cloud/firestore` directly.
- Deployable apps cannot import files outside their own source roots.

## Migration Rule
When moving logic from `apps/api/utils/*` to `apps/core/*`:
1. Move implementation into `apps/core` (canonical).
2. Replace API util file with thin re-export adapter.
3. Keep route/controller behavior unchanged.
4. Re-run:
```bash
npm run check:architecture
npm run test:api-smoke
npm test
```
