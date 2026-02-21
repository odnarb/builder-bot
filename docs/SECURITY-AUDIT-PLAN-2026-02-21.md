# Security Audit and Remediation Plan
Date: 2026-02-21  
Last updated: 2026-02-21  
Scope audited: `apps/api`, `apps/functions/stripe-api`, `apps/bot`, `apps/webui`, root dependencies

## Audit Method
- Dependency audit: `npm audit --json` in root + app packages (prod and full trees).
- Static code review: authn/authz flows, billing flows, input trust boundaries, local control channels.

## Implementation Status (2026-02-21)
- [x] Locked down direct tier escalation via `POST /user/plan` (paid/admin self-assignment blocked).
  - `apps/api/routes/user-routes.js:237`
- [x] Secured `POST /ai-get-structure` behind JWT auth and server-side tier resolution.
  - `apps/api/routes/ai-routes.js:25`
  - `apps/api/routes/ai-routes.js:39`
- [x] Removed caller header trust (`x-user-id`) from AI usage key identity path.
  - `apps/api/context/runtime-route-deps.js:27`
- [x] Added temporary in-memory rate limiting middleware and applied it to AI + Stripe endpoints.
  - `apps/api/middleware/in-memory-rate-limit.js:1`
  - `apps/api/routes/ai-routes.js:19`
  - `apps/api/routes/stripe-routes.js:51`
- [x] Hardened `POST /stripe/confirm-checkout` with ownership, payment-state, and replay checks.
  - `apps/api/routes/stripe-routes.js:140`
  - `apps/api/routes/stripe-routes.js:157`
  - `apps/api/routes/stripe-routes.js:165`
  - `apps/api/routes/stripe-routes.js:149`
- [x] Reduced user-profile exposure on `/user` and `/user/:userId` and returned safe profile fields.
  - `apps/api/routes/user-routes.js:138`
  - `apps/api/routes/user-routes.js:157`
  - `apps/api/routes/user-routes.js:6`
- [x] Fixed signup identity trust (JWT subject is canonical `auth0LoginId`, optional email-claim check).
  - `apps/api/routes/user-routes.js:180`
- [x] Hardened bot WS control channel (loopback bind + token-auth handshake).
  - `apps/bot/ws-server.js:61`
  - `apps/bot/ws-server.js:66`
- [x] Updated web UI WS client to send Auth token during WS connect.
  - `apps/webui/src/components/WebSocketProvider.jsx:35`
- [x] Added/updated security regression tests.
  - `tests/ai-routes-security.test.js`
  - `tests/user-routes-security.test.js`
  - `tests/stripe-routes-security.test.js`
  - `tests/bot-ws-routing.test.js`
  - `tests/api-routes-smoke.test.js`

## Validation
- Full test suite passes after the changes:
  - `npm test`
- Targeted security tests added and passing:
  - route auth/tier trust
  - user-profile authorization boundaries
  - Stripe confirm ownership/payment/replay handling
  - WS token auth helper behavior

## Findings and Current Status

### Critical: Authenticated users can self-upgrade to admin tier
- Previous risk: `POST /user/plan` accepted privileged tier assignments.
- Status: **Mitigated**.
- Implemented controls:
  - paid tier direct mutation disabled; endpoint only allows safe free-tier direct update.
  - see `apps/api/routes/user-routes.js:244`.

### Critical: AI generation endpoint unauthenticated and client-tier-controlled
- Previous risk: unauthenticated use + caller-selected tier for policy/cost path.
- Status: **Mitigated**.
- Implemented controls:
  - route requires JWT.
  - tier derived from persisted user record.
  - no identity derivation from caller-supplied header fallback.
  - see `apps/api/routes/ai-routes.js:25` and `apps/api/context/runtime-route-deps.js:27`.

### Critical: Checkout confirmation trusted unverified session/ownership/payment state
- Previous risk: possible tier elevation via unverified Stripe session confirmation flow.
- Status: **Partially mitigated (materially reduced)**.
- Implemented controls:
  - ownership check (`metadata.userId === req.auth.payload.sub`)
  - payment/completion checks
  - free-tier metadata rejection
  - in-memory replay protection
  - see `apps/api/routes/stripe-routes.js:157`, `apps/api/routes/stripe-routes.js:165`, `apps/api/routes/stripe-routes.js:171`, `apps/api/routes/stripe-routes.js:149`.
- Residual risk:
  - replay protection is process-local (`Set`) and not durable across instances/restarts.

### High: User data exposure via IDOR-style lookup endpoints
- Previous risk: broad lookup and cross-user fetches.
- Status: **Mitigated**.
- Implemented controls:
  - `/user` now returns authenticated user only.
  - `/user/:userId` now enforces self-only access.
  - response is allowlisted via safe profile mapper.
  - see `apps/api/routes/user-routes.js:138`, `apps/api/routes/user-routes.js:157`.

### High: Bot control WebSocket lacked authentication and binding hardening
- Previous risk: reachable clients could send control commands.
- Status: **Partially mitigated**.
- Implemented controls:
  - loopback bind `127.0.0.1`.
  - token-auth check at WS connect.
  - UI now passes token.
  - see `apps/bot/ws-server.js:64`, `apps/bot/ws-server.js:67`, `apps/webui/src/components/WebSocketProvider.jsx:35`.
- Residual risk:
  - explicit WS origin allowlist enforcement is not yet implemented.

### Medium: Signup endpoint trusted body-supplied identity key
- Previous risk: account pre-creation/data-pollution via forged `auth0LoginId`.
- Status: **Mitigated**.
- Implemented controls:
  - JWT subject is canonical identity.
  - email mismatch check (if email claim exists).
  - see `apps/api/routes/user-routes.js:190`.

### High: Dependency vulnerabilities (production trees)
- Previous evidence (`npm audit --omit=dev`):
  - Root: 7 (`high:6`, `moderate:1`)
  - `apps/api`: 4 high
  - `apps/functions/stripe-api`: 4 high
  - `apps/webui`: 2
- Status: **Open**.
- Notes:
  - code-path hardening completed; dependency upgrade campaign remains pending.

## Updated Plan

## Phase 0 (Same Day Hotfixes)
1. Lock down `/user/plan` to prevent admin self-assignment. **Done**
2. Require auth for `/ai-get-structure` and derive tier server-side. **Done**
3. Patch `/stripe/confirm-checkout` with ownership + payment-state validation. **Done**
4. Add temporary rate limiting on AI and billing endpoints. **Done**

## Phase 1 (1-3 Days)
1. Fix IDOR endpoints (`/user`, `/user/:userId`) with self/admin checks. **Done (self-only)**
2. Fix signup identity trust (`auth0LoginId` from JWT only). **Done**
3. Harden bot WS channel (loopback bind + token handshake + origin validation). **Partially done**
4. Add structured security audit events for denied authorization attempts. **Open**

## Phase 2 (3-7 Days)
1. Dependency upgrade sprint across root/API/webui/stripe-api. **Open**
2. Consolidate duplicate lockfiles and standardize one package manager workflow. **Open**
3. Add automated security checks in CI:
   - `npm audit --omit=dev --audit-level=high`
   - secret scanning
   - lint rule for protected route registration
   - **Open**

## Remaining Actions
1. Replace in-memory Stripe replay guard with durable idempotency storage.
2. Add explicit WS origin allowlist checks in bot server.
3. Add denied-auth/denied-authz structured security audit events across protected routes.
4. Complete dependency upgrades and CI security gating rollout.

## Ownership Suggestions
- Backend/API team: complete durable Stripe idempotency + audit-event instrumentation.
- Bot platform team: WS origin allowlist + additional WS telemetry.
- Infra/DevEx: dependency upgrades and CI security gates.
