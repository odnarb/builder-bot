# Project Status
Date: 2026-06-07

This file shows the current state of the project.

## Current Focus
BuilderBot is being changed to support two modes.

| Mode | Meaning |
|---|---|
| `local` | Run BuilderBot yourself for free. |
| `hosted` | Run BuilderBot as a paid hosted app. |

Local mode should not need Stripe, Auth0, Firestore, Docker, or Google credentials when it is done.

Hosted mode should use Stripe payment checks on the backend.

## Current Plan
The active plan is here:

```txt
docs/HOSTED-BILLING-AND-LOCAL-DB-PLAN.md
```

## Done In This Branch
- Added runtime mode config.
- Added `runtimeModeConfig` to API route dependencies.
- Added hosted payment middleware.
- Added the first hosted payment gate on `/ai-get-structure`.
- Added SQLite setup under `apps/core/db/sqlite`.
- Added SQLite tests that use temp files.
- Added local auth so local mode does not need Auth0 env vars.
- Added local user/profile overrides so local mode does not hit Firestore for the default user.
- Added this `STATUS.md` file.
- Removed old production, integration, and marketing docs from active docs.

## Tests Run So Far
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

## Not Done Yet
- Build history and session routes still need SQLite-backed local storage.
- Some economics and usage code still only knows how to use Firestore or memory.
- Hosted payment checks only protect the first cost-heavy route so far.
- Full tests pass, but final PR review still needs a clean diff check.

## Next Step
Wire local data into SQLite.

Start with:

- local settings,
- local build history,
- local session/build logs.

## Guardrails
- Keep local mode easy to run.
- Keep payment checks on the backend.
- Never bypass Auth0 in hosted mode.
- Do not rewrite every database path at once.
- Do not change prices, tier names, or SKU names in this work.
- Do not save SQLite files in the repo by default.
- Keep docs honest about what works now.

## Docs Policy
Use this file for current status.

These are no longer active docs:

- production readiness checklist,
- integration test scenarios,
- marketing plan comparison.


-----

TODO:
Electron app / UI
---------------------
Full-screen mode seems busted. There's some weird offset applied when in fullscreen mode. Could be stretching the view or something and therefore the click layer is misaligned from the actual visual layer.

Make sure we can troubleshoot a local builder bot session completely. I want to be able to have you look at console logs and build logs to see what happened from end to end.