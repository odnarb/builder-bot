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
  - `apps/api/routes/stripe-routes.js:153`
  - `apps/api/routes/stripe-routes.js:170`
  - `apps/api/routes/stripe-routes.js:175`
  - `apps/api/routes/stripe-routes.js:209`
- [x] Replaced process-local Stripe replay guard with shared durable idempotency claim helper.
  - `apps/core/logic/checkout-confirmation-idempotency.js:53`
  - `apps/core/db/firestore/economics-persistence.js:8`
  - `apps/api/context/static-route-deps.js:238`
  - `apps/api/routes/stripe-routes.js:209`
- [x] Reduced user-profile exposure on `/user` and `/user/:userId` and returned safe profile fields.
  - `apps/api/routes/user-routes.js:138`
  - `apps/api/routes/user-routes.js:157`
  - `apps/api/routes/user-routes.js:6`
- [x] Fixed signup identity trust (JWT subject is canonical `auth0LoginId`, optional email-claim check).
  - `apps/api/routes/user-routes.js:180`
- [x] Hardened bot WS control channel (loopback bind + token-auth handshake).
  - `apps/bot/ws-server.js:119`
  - `apps/bot/ws-server.js:135`
- [x] Added explicit WS origin allowlist enforcement for bot control channel.
  - `apps/bot/ws-server.js:35`
  - `apps/bot/ws-server.js:48`
  - `apps/bot/ws-server.js:126`
- [x] Added structured denied-auth/denied-authz security audit event middleware.
  - `apps/api/middleware/security-denied-audit.js:31`
  - `apps/api/index.js:30`
  - `apps/api/middleware/require-admin-access.js:109`
- [x] Updated web UI WS client to send Auth token during WS connect.
  - `apps/webui/src/components/WebSocketProvider.jsx:35`
- [x] Added production runtime warning when WS origin allowlist is not explicitly configured.
  - `apps/bot/ws-server.js:124`
- [x] Added/updated security regression tests.
  - `tests/ai-routes-security.test.js`
  - `tests/user-routes-security.test.js`
  - `tests/stripe-routes-security.test.js`
  - `tests/bot-ws-routing.test.js`
  - `tests/api-routes-smoke.test.js`
  - `tests/checkout-confirmation-idempotency.test.js`
  - `tests/security-denied-audit-middleware.test.js`
- [x] Completed production dependency patch upgrades for API, Stripe function, and Web UI runtime trees.
  - `apps/api/package-lock.json`
  - `apps/functions/stripe-api/package-lock.json`
  - `apps/webui/package.json`
  - `apps/webui/package-lock.json`
  - `package-lock.json` (root transitive `jws` update)
- [x] Added CI security gates for dependency audit, secret scanning, and protected-route lint checks.
  - `.github/workflows/security-gates.yml`
  - `scripts/security-audit-gate.mjs`
  - `scripts/scan-secrets.mjs`
  - `scripts/check-protected-routes.mjs`
  - `package.json` (`check:security*` scripts)
- [x] Added operations alert when persistence is configured for Firestore but runtime falls back to in-memory mode.
  - `apps/api/routes/admin-routes.js:276`
  - `apps/api/context/static-route-deps.js:230`

## Validation
- Full test suite passes after the changes:
  - `npm test`
- Targeted security tests added and passing:
  - route auth/tier trust
  - user-profile authorization boundaries
  - Stripe confirm ownership/payment/replay/idempotency handling
  - WS token + origin allowlist helper behavior
  - denied-auth/denied-authz audit event middleware behavior
- Production dependency audits (2026-02-21):
  - `npm --prefix apps/api audit --omit=dev --json` => `0` vulnerabilities.
  - `npm --prefix apps/functions/stripe-api audit --omit=dev --json` => `0` vulnerabilities.
  - `npm --prefix apps/webui audit --omit=dev --json` => `0` vulnerabilities.
  - `npm audit --omit=dev --json` (root) => `6` vulnerabilities (`high:5`, `moderate:1`), all in the `mineflayer` transitive chain.
- Security gate command validates current CI checks:
  - `npm run check:security` => pass

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
- Status: **Mitigated**.
- Implemented controls:
  - ownership check (`metadata.userId === req.auth.payload.sub`)
  - payment/completion checks
  - free-tier metadata rejection
  - durable idempotency claim backed by persistence when available
  - see `apps/api/routes/stripe-routes.js:170`, `apps/api/routes/stripe-routes.js:175`, `apps/api/routes/stripe-routes.js:181`, `apps/api/routes/stripe-routes.js:209`.
- Residual risk:
  - if persistent storage is unavailable, runtime falls back to in-memory idempotency.

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
- Status: **Mitigated**.
- Implemented controls:
  - loopback bind `127.0.0.1`.
  - token-auth check at WS connect.
  - explicit origin allowlist validation (`BOT_WS_ALLOWED_ORIGINS`, defaults to local UI origins).
  - production runtime warning when `BOT_WS_ALLOWED_ORIGINS` is not explicitly set.
  - UI now passes token.
  - see `apps/bot/ws-server.js:122`, `apps/bot/ws-server.js:126`, `apps/webui/src/components/WebSocketProvider.jsx:35`.

### Medium: Missing centralized denied authn/authz audit telemetry
- Previous risk: denied access attempts were not consistently recorded across protected routes.
- Status: **Mitigated**.
- Implemented controls:
  - centralized middleware records structured `denied_authn`/`denied_authz` events for JSON 401/403 responses.
  - admin middleware now attaches denied-reason codes for richer telemetry context.
  - see `apps/api/middleware/security-denied-audit.js:31`, `apps/api/index.js:30`, `apps/api/middleware/require-admin-access.js:109`.

### Medium: Signup endpoint trusted body-supplied identity key
- Previous risk: account pre-creation/data-pollution via forged `auth0LoginId`.
- Status: **Mitigated**.
- Implemented controls:
  - JWT subject is canonical identity.
  - email mismatch check (if email claim exists).
  - see `apps/api/routes/user-routes.js:190`.

### High: Dependency vulnerabilities (production trees)
- Current evidence (`npm audit --omit=dev`, 2026-02-21):
  - Root: 6 (`high:5`, `moderate:1`)
  - `apps/api`: 0
  - `apps/functions/stripe-api`: 0
  - `apps/webui`: 0
- Status: **Partially mitigated**.
- Implemented controls:
  - upgraded API and Stripe service trees via patch-level updates (`express`, `body-parser`, `qs`, `jws`, `raw-body` transitive paths).
  - upgraded Web UI runtime router chain (`react-router-dom`/`react-router`).
  - refreshed root lockfile transitive `jws` path to eliminate prior `jws` advisory hit.
- Residual risk:
  - remaining root findings are transitive to `mineflayer` / `minecraft-protocol` / `prismarine-auth` / `@xboxreplay/xboxlive-auth` and `ajv` in protocol tooling.
  - `npm audit` suggests a semver-major `mineflayer` downgrade path for full remediation, which requires compatibility validation before adoption.

## Updated Plan

## Phase 0 (Same Day Hotfixes)
1. Lock down `/user/plan` to prevent admin self-assignment. **Done**
2. Require auth for `/ai-get-structure` and derive tier server-side. **Done**
3. Patch `/stripe/confirm-checkout` with ownership + payment-state validation. **Done**
4. Add temporary rate limiting on AI and billing endpoints. **Done**

## Phase 1 (1-3 Days)
1. Fix IDOR endpoints (`/user`, `/user/:userId`) with self/admin checks. **Done (self-only)**
2. Fix signup identity trust (`auth0LoginId` from JWT only). **Done**
3. Harden bot WS channel (loopback bind + token handshake + origin validation). **Done**
4. Add structured security audit events for denied authorization attempts. **Done**

## Phase 2 (3-7 Days)
1. Dependency upgrade sprint across root/API/webui/stripe-api. **In progress**
   - API, Stripe function, and Web UI prod trees remediated.
   - Root transitive mineflayer-chain findings remain open.
2. Consolidate duplicate lockfiles and standardize one package manager workflow. **Open**
3. Add automated security checks in CI:
   - `npm audit --omit=dev --audit-level=high`
   - secret scanning
   - lint rule for protected route registration
   - **Done** (`.github/workflows/security-gates.yml`, `npm run check:security`)

## Remaining Actions
1. Resolve remaining root dependency findings in the mineflayer transitive chain with compatibility-tested upgrade/override strategy.
2. Reduce and eventually remove temporary root audit allowlist exceptions in `scripts/security-audit-gate.mjs` as mineflayer-chain remediation lands.
3. Roll out explicit `BOT_WS_ALLOWED_ORIGINS` values across production/staging environments (runtime warning now detects missing config).
4. Validate persistent idempotency path in staging/prod (`PRE_SCALE_PERSISTENCE_MODE=firestore`) and tune alert handling for `persistence_fallback_active`.

## Ownership Suggestions
- Backend/API team: monitor durable Stripe idempotency + denied-auth telemetry in production.
- Bot platform team: keep WS origin allowlist aligned with deployment surfaces and add WS rejection telemetry.
- Infra/DevEx: root mineflayer-chain dependency remediation strategy + CI audit allowlist reduction plan.
