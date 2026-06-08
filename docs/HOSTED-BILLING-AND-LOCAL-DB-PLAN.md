# Hosted Billing and Local DB Plan
Date: 2026-06-07

## Goal
BuilderBot should work in two ways:

- `local`: anyone can download it and run it for free.
- `hosted`: the hosted version can ask users to pay with Stripe.

The backend must enforce payment rules. React can show the checkout screen, but React must not be the only thing stopping unpaid hosted users.

## Current Status
Status: In progress

Done so far:

- Added `apps/core/platform/runtime-mode.js`.
- Added tests for runtime mode.
- Added `runtimeModeConfig` to API route dependencies.
- Added hosted payment middleware: `apps/api/middleware/require-active-subscription.js`.
- Added the first hosted payment gate on `/ai-get-structure`.
- Added local SQLite files under `apps/core/db/sqlite/`.
- Added local auth middleware so local mode does not need Auth0 env vars.
- Added local user route overrides so local mode can read the default local user without Firestore.
- Focused local auth, route, SQLite, architecture, route-security, and secret checks pass.
- Full `npm test` passes after updating API smoke tests to check hosted auth behavior in hosted mode.
- Added `STATUS.md`.
- Removed old production-readiness, integration-scenario, and marketing-plan docs from active docs.

Focused tests run so far:

```bash
node --test tests/runtime-mode.test.js
node --test tests/api-app-context-wiring.test.js
node --test tests/require-active-subscription.test.js
node --test tests/ai-routes-security.test.js
node --test tests/sqlite-local-db.test.js
node --test tests/runtime-jwt-check.test.js
node --test tests/local-mode-route-deps.test.js
npm run check:architecture
npm run check:routes-security
npm run check:secrets
npm test
```

## Runtime Modes
Use one main switch:

```bash
BUILDERBOT_DISTRIBUTION_MODE=local
# or
BUILDERBOT_DISTRIBUTION_MODE=hosted
```

Mode behavior:

| Mode | Payment | Auth | Data |
|---|---|---|---|
| `local` | Off | Local identity | SQLite |
| `hosted` | Stripe | Hosted auth | Firestore or hosted DB |

## Local Mode
Local mode should be easy to run.

It should not need:

- Stripe,
- Auth0,
- Firestore,
- Docker,
- Google Cloud credentials.

Local mode should:

- create or use a local user,
- avoid Auth0 completely,
- save settings and build history to SQLite,
- default to a local tier,
- keep using the same tier policy code paths.

Recommended local default:

```bash
LOCAL_ENTITLEMENT_MODE=free_open_source
LOCAL_DEFAULT_TIER=admin
```

## Hosted Mode
Hosted mode should protect cost-heavy actions.

Use:

```bash
BUILDERBOT_DISTRIBUTION_MODE=hosted
BILLING_GATE_MODE=stripe
```

If a hosted user has not paid, protected routes should return:

```json
{
  "code": "SUBSCRIPTION_REQUIRED",
  "message": "Choose a plan to continue."
}
```

Use HTTP `402` for this.

These routes must stay open so users can pay:

- health checks,
- login/auth callbacks,
- Stripe checkout creation,
- Stripe checkout confirmation or webhooks,
- SKU config,
- public static pages.

## Local Database
Use SQLite for local data.

Why:

- it works offline,
- it is one file,
- it does not need a cloud account,
- it does not need Docker,
- it works well for Electron and local Node.js apps.

Current package choice:

- `better-sqlite3`

The repository methods should still look async. That keeps route and logic code stable if the SQLite internals change later.

Default local DB path should be outside the repo, such as:

```txt
~/.builderbot/builderbot.local.sqlite
```

## Persistence Switch
Use one switch:

```bash
PERSISTENCE_MODE=sqlite
# or
PERSISTENCE_MODE=firestore
# or
PERSISTENCE_MODE=memory
```

Defaults:

- `local` should use `sqlite`,
- `hosted` should use `firestore`,
- tests can use `memory` or temp SQLite files.

## First SQLite Tables
Start small.

Tables:

- `users`
- `entitlements`
- `builds`
- `usage_monthly`
- `settings`
- `idempotency_claims`

This is enough for:

- local user data,
- local settings,
- local build history,
- local usage tracking,
- Stripe confirmation replay protection.

## Implementation Order
1. Runtime mode config.
2. Hosted payment gate.
3. SQLite setup and migrations.
4. Local identity/auth path.
5. Local user/settings/build-history storage.
6. Move economics and idempotency storage carefully.
7. Update README only after local mode really works.

## Next Code Slice
Build local SQLite route storage next.

Start with:

- settings,
- build history,
- session/build logs.

Local auth is now started. Local mode can add `local:default` to API requests without Auth0.

## Tests To Keep
Unit tests:

- mode parsing,
- invalid mode errors,
- local defaults,
- hosted defaults.

Route tests:

- hosted unpaid user gets `402`,
- hosted paid user continues,
- local mode bypasses Stripe,
- local mode does not need Auth0 env vars,
- hosted mode still requires Auth0,
- checkout routes still work.

SQLite tests:

- migrations run once,
- JSON settings round trip,
- duplicate idempotency claims are blocked,
- temp DB files do not write into the repo.

Before PR:

```bash
npm test
npm run check:architecture
npm run check:routes-security
npm run check:secrets
```

## Guardrails
- Do not make Stripe env vars decide the app mode.
- Do not put payment checks only in React.
- Do not require cloud services in local mode.
- Do not bypass Auth0 in hosted mode.
- Do not rewrite all Firestore code in one PR.
- Do not change plan prices or SKU names in this work.
- Do not expose stack traces or local file paths to users.
- Do not store SQLite files in the repo by default.
- Do not edit staged core copies directly.

## Done Means
This work is done when:

- a fresh local checkout can run without Stripe, Auth0, Firestore, Docker, or Google credentials,
- local settings and build history survive an API restart,
- hosted mode blocks unpaid protected use,
- hosted checkout still works,
- tier limits still come from the main tier policy,
- full checks pass.
