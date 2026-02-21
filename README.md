# Minecraft AI Agent
Natural-language Minecraft builder bot with API, Web UI, and Electron control app.

## Prerequisites
- Node.js 22+
- Java 17+ (for Paper server)
- `k.json` in repo root for local Firestore-backed API runs
- `.env` configured for API/Auth0/Stripe/OpenAI where needed

## Install
```bash
npm install
npm --prefix apps/api install
npm --prefix apps/webui install
```

## Local Run
1. Start Minecraft server:
```bash
java -Xmx2G -jar paper-1.20.4-499.jar
```
2. Start API (`http://localhost:3001`):
```bash
npm --prefix apps/api run dev
```
3. Get an Auth0 access token for local bot API calls:
```bash
npm --prefix apps/webui run dev
```
- Open `http://localhost:5173` and log in.
- In browser DevTools -> Network, open a request like `/api/user/tier`.
- Copy the `Authorization` header token (`Bearer <token>`).
- Export it in your shell:
```bash
export AUTH_TOKEN='<paste token here>'
```
- Token must be minted for audience `https://api.mcbuilderbot.com`.

4. Start bot:
```bash
npm run dev:bot
```

5. Optional CLI build prompt flow:
```bash
npm run dev -- "build a cobblestone tower" --schematic
```

Optional:
- Start Web UI (`http://localhost:5173`):
```bash
npm --prefix apps/webui run dev
```
- Start Electron app (expects Web UI on port 5173):
```bash
npm run dev:electron
```
- Start static marketing site from `apps/website` (public landing surface):
```bash
python3 -m http.server 8080 --directory apps/website
```

## Tests
```bash
npm test
```

## Ops Hardening
- Emergency guard now emits transition logs on state changes:
  - `GUARD_STATE_TRANSITION: NORMAL -> ACTIVE ...`
- Free-tier emergency throttles return stable API semantics:
  - `429` with `Retry-After` header
  - response `code: "FREE_TIER_THROTTLED_GUARD_ACTIVE"`
- Pre-scale telemetry now includes `guard_state_effective` for current guard status.
- Run deterministic normal/active/recovery shakeout:
```bash
npm --prefix apps/api run pre-scale:shakeout
```

## New API Surfaces (Monolithic Cloud Run)
- `POST /api/ai-get-structure` now returns:
  - `instructionPlan` (normalized actions schema)
  - `blocksAndTags` (legacy compatibility)
  - optional `schematic` artifact when `includeSchematic: true`
- `GET /api/admin/ops-dashboard`, `GET /api/admin/ops-alerts`
- `GET /api/admin/pre-scale-telemetry`, `GET /api/admin/performance-profile`
- `GET /api/admin/build-costs`
- `POST /api/admin/pre-scale/simulate`, `GET /api/admin/pre-scale/simulations`
- `GET /api/admin/conversion-funnel`
- `POST /api/admin/pre-scale/migrate-inmemory`
- `GET /api/admin/incidents`, `POST /api/admin/incidents/:incidentId/resolve`
- `POST /api/admin/evaluation/run`, `GET /api/admin/evaluation`
- `GET /api/admin/abuse-analytics`, `GET /api/admin/overage-report`
- `GET /api/admin/security-audits`
- `GET /api/admin/analytics/referrals`, `GET /api/admin/analytics/attribution`
- `GET /api/user/builds`, `GET /api/user/build/:buildId`
- `GET /api/config/skus` for active checkout SKU catalog (Starter/Pro/Admin monthly)
- community/policy endpoints for account linking, reactions/rewards, referrals/entitlements, phrase packs, marketplace, attribution, cancellation/refund tickets, renewal preferences, and parental controls.
