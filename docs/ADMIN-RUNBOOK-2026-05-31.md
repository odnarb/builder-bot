# Admin Runbook
Date: 2026-05-31

Use this as the operator checklist for pre-scale and production-like runs.

## Bootstrap

1. Configure environment from `docs/PRODUCTION-READINESS-CHECKLIST-2026-05-31.md`.
2. Run preflight checks:
   - `npm test`
   - `npm run check:architecture`
   - `npm run check:routes-security`
   - `npm run check:secrets`
   - `npm run check:security-audit`
3. Start API, Web UI, and bot/Electron runtime with matching Auth0 audience, issuer, and API URL.
4. Confirm `/api/config/skus` and `/api/config/localization` respond without auth.
5. Confirm `/api/admin/ops-dashboard` rejects unauthenticated requests.

## Admin Dashboard Checks

Use the admin-tier Web UI panel first. If debugging directly, call these endpoints with an admin JWT:

- `GET /api/admin/ops-dashboard`
- `GET /api/admin/ops-alerts`
- `GET /api/admin/margin-report`
- `GET /api/admin/incidents`
- `GET /api/admin/abuse-analytics`
- `GET /api/admin/security-audits`
- `GET /api/admin/overage-report`
- `GET /api/admin/pre-scale-telemetry`

## Incident Triage

1. Check `GET /api/admin/ops-alerts`.
2. If alerts include `persistence_fallback_active`, confirm Firestore credentials or cloud identity.
3. If alerts include high failure rate, inspect recent build history and decision failure digests.
4. If alerts include token burn or emergency margin guard, inspect `GET /api/admin/margin-report` and `GET /api/admin/emergency-guard`.
5. Resolve tracked incidents through `POST /api/admin/incidents/:incidentId/resolve` once the cause is handled.

## Emergency Margin Guard

Use manual override only when the economics state is clearly wrong or launch-critical.

- Inspect: `GET /api/admin/emergency-guard`
- Force on/off: `POST /api/admin/emergency-guard/override`
- `force_off` requires the confirmation code enforced by the API.

## Build Failure Triage

1. Open dashboard build history.
2. Check source:
   - `local` means deterministic parser/planner generated the initial plan.
   - `ai` means the prompt fell back to model planning.
3. Check attempts, replans, and failure reason.
4. For repeated local failures, run the matching scenario in `docs/INTEGRATION-TEST-SCENARIOS-2026-05-31.md`.
5. For repeated AI failures, inspect validator errors, tier limits, and prompt safety/moderation logs.

## Launch Decisions

These are not engineering blockers, but they are launch blockers if the product requires them:

- Final Terms and Privacy copy/version.
- External incident notification provider: Slack, email, PagerDuty, or Opsgenie.
- Redstone scripting and teleport command safety policy.
- Whether API-first admin/community workflows are acceptable for launch.
