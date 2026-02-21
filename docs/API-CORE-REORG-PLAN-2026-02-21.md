# API + Shared Core Reorganization Plan
Date: 2026-02-21
Scope: `apps/api`, `apps/core`, `apps/functions/stripe-api`, `docs/AGENTS.md`

## Implementation Status (2026-02-21)
- [x] Phase 0 baseline smoke tests added (`tests/api-routes-smoke.test.js`).
- [x] Phase 1 route extraction completed:
  - `apps/api/index.js` reduced from `2668` lines to `833` lines.
  - route registration moved into `apps/api/routes/*.js`.
- [x] Shared-core staging scripts added:
  - `scripts/stage-shared-core.mjs`
  - app script hooks in root/API/stripe package scripts.
- [x] Architecture boundary checker added:
  - `scripts/check-architecture-boundaries.mjs`
  - currently passing clean (`[check-architecture-boundaries] OK`) with Firestore allowlist aligned to shared db adapters.
- [~] Phase 2 logic extraction started:
  - `/ai-get-structure` orchestration moved into `apps/core/logic/ai-get-structure.js`.
  - `apps/api/routes/ai-routes.js` reduced from `707` lines to `42` lines as HTTP adapter only.
- [~] Phase 2 logic extraction continued:
  - moved AI runtime helper functions to `apps/core/logic/ai-runtime-helpers.js`.
  - moved emergency guard orchestration cache/evaluator to `apps/core/logic/emergency-guard-runtime.js`.
  - moved admin access auth/cache middleware to `apps/api/middleware/require-admin-access.js`.
  - `apps/api/index.js` reduced further from `833` lines to `451` lines.
- [~] API bootstrap/context split completed:
  - moved route dependency assembly into `apps/api/app-context.js`.
  - reduced `apps/api/index.js` from `451` lines to `78` lines (bootstrap + route mounting + error handlers only).
- [~] App context modularization completed:
  - split `apps/api/app-context.js` into:
    - `apps/api/context/static-route-deps.js`
    - `apps/api/context/runtime-route-deps.js`
  - reduced `apps/api/app-context.js` from `400` lines to `34` lines (composition only).
- [~] Phase 3 db-layer consolidation started:
  - moved economics persistence implementation to canonical shared db path:
    - `apps/core/db/firestore/economics-persistence.js`
  - converted `apps/api/utils/economics-persistence.js` into a thin compatibility re-export adapter.
  - updated architecture boundary allowlist to point at shared db adapter path.
- [~] Phase 4 deploy-root import cutover started:
  - switched API imports to staged in-app paths (`apps/api/core`, `apps/api/shared-utils`, `apps/api/packages/prompt-parser`).
  - `scripts/stage-shared-core.mjs` now stages shared-utils and prompt-parser by default (use `--core-only` to skip).
  - `scripts/check-architecture-boundaries.mjs` now enforces deploy-root boundaries by resolving relative imports (API + stripe function) and is currently clean.
- [ ] Remaining: deeper logic/db extraction for non-AI flows (Phases 3-5) and staged-path cleanup of compatibility adapters.

## Why This Plan Exists
Your stated goal matches the architecture guidance in `docs/AGENTS.md:237`-`docs/AGENTS.md:249`:
- routes/controllers should stay HTTP-focused,
- logic should live in a logic layer,
- Firestore access should be in a db layer,
- `index.js` should not be the system’s main business-logic container.

Current `apps/api/index.js` is `2668` lines with `65` routes (`apps/api/index.js`), and it still contains substantial orchestration/business logic in route handlers (especially `/ai-get-structure`).

## Current Drift (Audit Findings)

### 1. `apps/api/index.js` is too broad in responsibility
- Evidence:
  - `apps/api/index.js:1`-`apps/api/index.js:2668` contains bootstrapping, middleware, helper functions, route registration, heavy AI orchestration, admin policy logic, and error handling.
  - `/ai-get-structure` route starts at `apps/api/index.js:1586` and spans to `apps/api/index.js:2230`.
  - Route count by prefix is heavily concentrated:
    - `user`: 24 routes
    - `admin`: 23 routes
    - `community`: 11 routes
- Impact:
  - Hard to test route behavior independently.
  - Hard to reason about boundaries between HTTP, logic, and persistence.

### 2. Shared core usage is inconsistent across apps
- Evidence:
  - API imports shared firestore layer from `apps/core`: `apps/api/index.js:25`.
  - Stripe function imports local app core path: `apps/functions/stripe-api/index.js:5`.
  - `.gitignore` excludes app-local core mirrors: `.gitignore:143`-`.gitignore:145`.
- Impact:
  - `apps/functions/stripe-api` depends on local copied core that is not canonical and can drift.
  - Team intent (“shared core across apps”) is not enforced by structure.

### 3. Firestore access is not fully isolated to one db layer
- Evidence:
  - Shared user Firestore operations are in `apps/core/firestore/users.js`.
  - Additional Firestore persistence initialization and direct CRUD exists in `apps/api/utils/economics-persistence.js`.
- Impact:
  - Multiple persistence access styles and boundaries.
  - More difficult to apply cross-cutting DB policy and testing strategy.

### 4. Deployment packaging boundaries are ambiguous for shared code
- Evidence:
  - `apps/api/index.js` imports paths above app root:
    - `../core/firestore/users.js` (`apps/api/index.js:25`)
    - `../shared-utils/*` (`apps/api/index.js:165`-`apps/api/index.js:166`)
    - `../../packages/prompt-parser/index.js` (`apps/api/index.js:160`)
  - App deployment manifests use `source: .`:
    - `apps/api/development.yaml:7`
    - `apps/functions/stripe-api/development.yaml:7`
- Impact:
  - If deployed from app directories only, shared imports outside app root can break unless staged/copied.
  - This directly motivates a deterministic copy-on-build step.

## Target Architecture

## Canonical Shared Source of Truth
Use `apps/core` as the only canonical shared domain.

Proposed structure:
- `apps/core/db/firestore/*`
  - Firestore repositories and persistence adapters only.
- `apps/core/logic/*`
  - Business use-cases (tier changes, build orchestration, usage metering, policy decisions).
- `apps/core/contracts/*`
  - Shared policy/config/schema primitives used by multiple apps.
- `apps/core/platform/*`
  - External provider wrappers (OpenAI/Stripe) if shared behavior is needed.

Keep app-specific HTTP concerns outside core.

## API App Structure (`apps/api`)
Proposed structure:
- `apps/api/index.js`
  - Bootstrapping only (middleware wiring, route mounting, 404/error handlers).
- `apps/api/routes/*.routes.js`
  - Route maps grouped by domain (`user`, `community`, `stripe`, `ai`, `admin`, `config`).
- `apps/api/controllers/*.controller.js`
  - HTTP request/response translation and input validation.
- `apps/api/middleware/*`
  - Auth, admin checks, shared HTTP middleware.
- `apps/api/app-context.js`
  - Dependency wiring (services/repositories/logger).

## Stripe Function App Structure (`apps/functions/stripe-api`)
Proposed structure:
- `index.js` reduced to webhook route/controller wiring.
- Business and db calls imported from shared staged `core`.

## Copy-On-Build Strategy (for deployable apps)

Because app manifests use `source: .`, each deployable app should contain its runtime shared dependencies at build/stage time.

### Strategy
1. Keep canonical source in `apps/core` (and other explicit shared dirs).
2. Add a staging script that copies shared code into each app before deploy:
   - `apps/core -> apps/api/core`
   - `apps/core -> apps/functions/stripe-api/core`
   - optionally:
     - `apps/shared-utils -> apps/api/shared-utils`
     - `packages/prompt-parser -> apps/api/packages/prompt-parser`
3. Make deploy commands point at staged app directory.
4. Keep staged mirrors ignored by git (already aligned with `.gitignore` for `apps/*/core`).

### Required guardrails
- Add a CI check that fails if:
  - app imports escape deploy root without staging.
  - staged core is stale relative to canonical `apps/core`.
- Add a single script entrypoint for staging so local/dev/prod use the same mechanism.

## Phased Migration Plan

## Phase 0: Freeze Behavior and Add Safety Nets
1. Add route-level smoke tests for critical endpoints before refactor (`/ai-get-structure`, `/user/*`, `/stripe/*`, `/admin/*`).
2. Add architecture boundary checks:
   - disallow direct Firestore use from controllers/routes.
   - disallow cross-app imports in deployable apps unless sourced from staged folders.
3. Capture baseline endpoint behavior contracts (status codes, payload shapes).

Exit criteria:
- Baseline tests pass and protect against behavior regressions during extraction.

## Phase 1: Split `apps/api/index.js` into route modules
1. Create route files:
   - `routes/user.routes.js`
   - `routes/community.routes.js`
   - `routes/stripe.routes.js`
   - `routes/ai.routes.js`
   - `routes/admin.routes.js`
   - `routes/config.routes.js`
2. Move handlers from `index.js` into controller files without behavior changes.
3. Keep `index.js` limited to:
   - express init,
   - shared middleware,
   - route mounting,
   - 404 and error middleware.

Exit criteria:
- `apps/api/index.js` reduced to bootstrapping surface (target under ~350 lines).
- Route behavior unchanged.

## Phase 2: Formalize logic layer
1. Move non-HTTP orchestration out of controllers:
   - AI generation orchestration currently embedded in `/ai-get-structure`.
   - upgrade/conversion flows.
   - emergency guard evaluation orchestration.
2. Create service/use-case modules in `apps/core/logic`.
3. Controllers call logic layer and only map input/output/errors.

Exit criteria:
- Controllers contain minimal request parsing + response shaping.
- Complex business paths are unit-testable without Express.

## Phase 3: Consolidate db layer
1. Move persistence adapters under `apps/core/db/firestore`.
2. Keep one Firestore instantiation strategy and shared timestamp helpers.
3. Refactor `apps/api/utils/economics-persistence.js` into db-layer modules (or make it a thin adapter over db layer).

Exit criteria:
- No business logic file performs raw Firestore CRUD.
- All Firestore writes/reads go through shared db layer modules.

## Phase 4: Enforce shared-core staging for deploy
1. Add staging script (example: `scripts/stage-shared-core.mjs`).
2. Update app imports to local staged paths (`./core/...`) where needed.
3. Update deploy workflow to run staging first.
4. Remove/adapt any stale local-core assumptions in `apps/functions/stripe-api`.

Exit criteria:
- Clean checkout + staged build can run/deploy each app consistently.
- No hidden dependency on untracked copied files.

## Phase 5: Cleanups and hardening
1. Normalize logger usage (replace raw `console.*` in app-layer paths where appropriate).
2. Add integration tests for controller+service wiring.
3. Document architecture conventions in `README.md` and a short `docs/CORE-ARCHITECTURE.md`.

Exit criteria:
- Architecture is documented and enforceable by tests/lint checks.

## Success Metrics
- `apps/api/index.js` reduced from `2668` lines to bootstrap-only size.
- 100% of Firestore access routed through shared db layer modules.
- No deployable app requires imports outside its staged source root at deploy time.
- Shared domain logic lives in one canonical `apps/core` source tree.
- Stripe function and API both consume the same canonical core logic/db contracts.

## Recommended First Implementation Slice
1. Phase 0 tests + boundary checks.
2. Phase 1 route/controller extraction (no behavior changes).
3. Minimal staging script for `apps/core` and update `apps/functions/stripe-api` to consume staged core deterministically.

This gives immediate risk reduction while preserving current product behavior.
