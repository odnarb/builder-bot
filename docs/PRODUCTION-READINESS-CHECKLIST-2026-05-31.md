# Production Readiness Checklist
Date: 2026-05-31

Use this before treating the app as production-ready.

## Required Environment
- `OPENAI_API_KEY`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER_BASE_URL`
- `AUTH_TOKEN` for local bot runs
- `API_URL`
- `SESSION_ID`
- `COMMANDER_UUID`
- `USER_ID`
- `BOT_WS_AUTH_TOKEN`
- `BOT_WS_ALLOWED_ORIGINS`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRODUCT_ID_STARTER_TIER`
- `STRIPE_PRODUCT_ID_PRO_TIER`
- `STRIPE_PRODUCT_ID_ADMIN_TIER`
- `CHECKOUT_URL`
- `GOOGLE_APPLICATION_CREDENTIALS` or equivalent cloud identity for Firestore persistence

## Optional Model Overrides
- `AI_MODEL_FALLBACK`
- `AI_MODEL_EXECUTOR_DEFAULT`
- `AI_MODEL_PLANNER_FREE`
- `AI_MODEL_PLANNER_STARTER`
- `AI_MODEL_PLANNER_PRO`
- `AI_MODEL_PLANNER_ADMIN`
- `AI_MODEL_EXECUTOR_FREE`
- `AI_MODEL_EXECUTOR_STARTER`
- `AI_MODEL_EXECUTOR_PRO`
- `AI_MODEL_EXECUTOR_ADMIN`
- `AI_CANARY_PERCENT`

## Preflight Commands
- `npm test`
- `npm run check:architecture`
- `npm run check:routes-security`
- `npm run check:secrets`
- `npm run check:security-audit`

## Runtime Checks
- Auth0 JWT audience and issuer match API config.
- `/api/ai-get-structure` rejects unauthenticated requests.
- `/admin/*` rejects non-admin users.
- Stripe checkout creates sessions for Starter, Pro, and Admin SKUs.
- Stripe checkout confirmation is idempotent.
- Firestore persistence is active or fallback mode is clearly visible in ops alerts.
- Bot WebSocket accepts only configured origins and auth token.
- Electron launch path passes API/Auth0/session env vars to the bot.

## Manual Smoke Tests
- Build a local deterministic template: `build 8 by 2 wooden bridge`.
- Build an AI fallback prompt: `build a small fantasy garden gazebo`.
- Hit a tier block limit and verify rejection.
- Try command-block placement as Free/Starter and verify denial/audit.
- Try command-block placement as Pro/Admin in a controlled test world.
- Confirm build history appears in the dashboard.
- Confirm admin ops alerts and margin reports load from API.

## Release Decisions Required
- Confirm final legal Terms/Privacy policy copy and versions.
- Confirm production Stripe product IDs and pricing.
- Confirm whether Admin UI is required before launch or API-only admin endpoints are acceptable.
- Confirm whether external incident notifications are required before launch.
