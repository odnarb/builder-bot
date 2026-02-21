# Security Audit and Remediation Plan
Date: 2026-02-21  
Scope audited: `apps/api`, `apps/functions/stripe-api`, `apps/bot`, `apps/webui`, root dependencies

## Audit Method
- Dependency audit: `npm audit --json` in root + app packages (prod and full trees).
- Static code review: authn/authz flows, billing flows, input trust boundaries, local control channels.

## Findings (Ordered by Severity)

### Critical: Authenticated users can self-upgrade to admin tier
- Evidence:
  - `apps/api/index.js:806` accepts arbitrary `tier` from request body.
  - `apps/api/index.js:813` allowlist includes `'admin'`.
  - `apps/api/index.js:817` writes requested tier directly via `updateUserTier`.
- Impact:
  - Any authenticated user can set their own tier to admin and unlock protected capabilities.
- Remediation:
  - Remove direct tier mutation for paid tiers from `/user/plan`.
  - Restrict `/user/plan` to `free` only (or deprecate endpoint).
  - Require admin-only path for manual tier override with explicit audit logging.

### Critical: AI generation endpoint is unauthenticated and client-tier-controlled
- Evidence:
  - `apps/api/index.js:1586` exposes `POST /ai-get-structure` without `jwtCheck`.
  - `apps/api/index.js:1588` accepts `tier` from request body.
  - `apps/api/index.js:1595` resolves tier from user input and enforces policy against that value.
  - `apps/api/index.js:195` + `apps/api/index.js:197` trust `x-user-id` header when unauthenticated.
- Impact:
  - Unauthenticated callers can consume expensive AI capacity and emulate higher tiers.
  - Cost abuse risk and throttling bypass patterns.
- Remediation:
  - Require JWT for `/ai-get-structure` in production.
  - Derive tier from authenticated user record only; ignore client-provided tier.
  - Remove `x-user-id` fallback for unauthenticated usage keys.
  - Add per-user and per-IP rate limits with strict quotas.

### Critical: Checkout confirmation trusts unverified Stripe session state/ownership
- Evidence:
  - `apps/api/index.js:1526` accepts user-supplied `sessionId`.
  - `apps/api/index.js:1531` + `apps/api/index.js:1555` apply tier directly from session metadata.
  - No checks for payment status or metadata ownership before tier update.
- Impact:
  - Tier elevation may occur without verified payment and/or for mismatched session ownership.
- Remediation:
  - Validate session ownership: metadata `userId` must equal `req.auth.payload.sub`.
  - Validate billing state before tier grant (`paid`/active subscription checks).
  - Prefer webhook-driven tier updates as source of truth; make confirm endpoint read-only status sync.
  - Record idempotent “session consumed” state to block replay.

### High: User data exposure via IDOR-style lookup endpoints
- Evidence:
  - `apps/api/index.js:724` exposes `GET /user?email=...` for any authenticated user.
  - `apps/api/index.js:743` exposes `GET /user/:userId` without self/admin ownership checks.
- Impact:
  - Authenticated users can enumerate or fetch other users' profile data.
- Remediation:
  - Restrict to self access (`req.auth.payload.sub`) unless caller is admin.
  - Remove broad email lookup endpoint from non-admin surface.
  - Add explicit field-level allowlist for returned user data.

### High: Bot control WebSocket lacks authentication and network binding hardening
- Evidence:
  - `apps/bot/ws-server.js:11` creates `WebSocketServer({ port: 3002 })` (no auth, default host binding).
  - `apps/bot/ws-server.js:16` accepts and executes command messages from any connected client.
- Impact:
  - Any reachable client can issue bot movement/build actions.
- Remediation:
  - Bind WS server to loopback (`127.0.0.1`) by default.
  - Require signed auth token during handshake and verify identity.
  - Enforce origin checks and per-connection command authorization.

### Medium: Signup endpoint trusts body-supplied identity key
- Evidence:
  - `apps/api/index.js:763` accepts `auth0LoginId` from request body.
  - `apps/api/core/firestore/users.js:15` uses `user.auth0LoginId` as document key.
- Impact:
  - Malicious users can create records keyed to other Auth0 IDs (account pre-creation/data pollution risk).
- Remediation:
  - Ignore body `auth0LoginId`; set from verified JWT subject only.
  - Validate request email against token claim when available.

### High: Dependency vulnerabilities (production trees)
- Evidence (from `npm audit --omit=dev`):
  - Root: 7 (`high:6`, `moderate:1`) including `mineflayer` chain, `axios`, `jws`.
  - `apps/api`: 4 high (`express`, `body-parser`, `jws`, `qs`).
  - `apps/functions/stripe-api`: 4 high (same set).
  - `apps/webui`: 2 (`react-router` high, `react-router-dom` moderate).
- Remediation:
  - Upgrade direct deps first (`express`, `body-parser`, `react-router-dom`, `vite` path where applicable).
  - For `mineflayer` chain issues without clean patch path, document compensating controls and track upstream fixes.
  - Add CI gate for `npm audit --omit=dev --audit-level=high`.

## Remediation Plan

## Phase 0 (Same Day Hotfixes)
1. Lock down `/user/plan` to prevent admin self-assignment.
2. Require auth for `/ai-get-structure` and derive tier server-side.
3. Patch `/stripe/confirm-checkout` with ownership + payment-state validation.
4. Add temporary rate limiting on AI and billing endpoints.

Exit criteria:
- No unauthenticated AI build requests accepted in production.
- Non-admin user cannot set `tier=admin` via API.
- Checkout confirm cannot grant tier without validated paid/owned session.

## Phase 1 (1-3 Days)
1. Fix IDOR endpoints (`/user`, `/user/:userId`) with self/admin checks.
2. Fix signup identity trust (`auth0LoginId` from JWT only).
3. Harden bot WS channel (loopback bind + token handshake + origin validation).
4. Add structured security audit events for denied authorization attempts.

Exit criteria:
- Authorization tests cover self/admin access for all user profile endpoints.
- WS command channel rejects unauthorized clients.

## Phase 2 (3-7 Days)
1. Dependency upgrade sprint across root/API/webui/stripe-api.
2. Consolidate duplicate lockfiles and standardize one package manager workflow.
3. Add automated security checks in CI:
   - `npm audit --omit=dev --audit-level=high`
   - secret scanning
   - lint rule for protected route registration

Exit criteria:
- High/critical dependency findings reduced to accepted risk register items only.
- CI fails on new critical auth/billing regressions.

## Verification and Tests to Add
- API integration tests:
  - reject non-admin `POST /user/plan` for `tier=admin`
  - reject unauthenticated `POST /ai-get-structure`
  - reject `/stripe/confirm-checkout` when session owner/payment state invalid
  - enforce self-only access for `/user` and `/user/:userId`
- Bot integration tests:
  - reject unauthorized WS command attempts
  - accept authorized local control flow

## Ownership Suggestions
- Backend/API team: authz + billing flow hotfixes (Phase 0/1).
- Bot platform team: WS auth/binding hardening (Phase 1).
- Infra/DevEx: dependency + CI gates (Phase 2).
