# Core Architecture
Date: 2026-06-07

This doc explains where code should go.

## Main Rule
Keep shared business code in `apps/core`.

Apps like `apps/api` should mostly wire things together. They should not own shared rules.

## Important Folders
- `apps/core/contracts`
  - Shared rules and config.
  - Example: tiers, SKUs, limits.
- `apps/core/logic`
  - Shared business logic.
  - Example: usage rules, validation, billing rules.
- `apps/core/db/firestore`
  - Firestore database code.
  - Used for hosted/cloud storage.
- `apps/core/db/sqlite`
  - SQLite database code.
  - Used for local open-source storage.
- `apps/core/platform`
  - Shared platform helpers.
  - Example: logger and runtime mode config.
- `apps/api/routes`
  - HTTP route code only.
  - Routes should call shared logic instead of owning business rules.

## Runtime Modes
BuilderBot is moving to two modes:

| Mode | DB | Payment |
|---|---|---|
| `local` | SQLite | Off |
| `hosted` | Firestore or hosted DB | Stripe |

Mode config lives in:

```txt
apps/core/platform/runtime-mode.js
```

## Staged Core Copies
Some apps use copied core files before tests or deploys.

The copy step is:

```bash
npm run stage:shared-core
```

This copies:

- `apps/core` to `apps/api/core`
- `apps/core` to `apps/functions/stripe-api/core`
- `apps/shared-utils` to `apps/api/shared-utils`
- `packages/prompt-parser` to `apps/api/packages/prompt-parser`

Do not edit the copied files directly.

Edit the real source first:

```txt
apps/core
packages/prompt-parser
apps/shared-utils
```

Then run:

```bash
npm run stage:shared-core
```

## Database Rules
- Firestore code belongs in `apps/core/db/firestore`.
- SQLite code belongs in `apps/core/db/sqlite`.
- Route files should not talk directly to Firestore or SQLite.
- Business logic should use small repository functions when it needs storage.
- Do not move all database code at once. Move one clear path at a time.

## API Rules
- `apps/api/index.js` should wire middleware and routes.
- `apps/api/app-context.js` should build dependencies.
- `apps/api/routes/*` should map HTTP requests to logic calls.
- `apps/api/utils/*` should only be short compatibility wrappers when needed.

## Checks
Run these before a PR:

```bash
npm run check:architecture
npm run test:api-smoke
npm test
```

