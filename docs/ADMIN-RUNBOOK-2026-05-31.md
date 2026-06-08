# Admin Runbook
Date: 2026-06-07

Use this when checking admin tools or debugging a broken run.

Read `STATUS.md` first. It shows what is done and what is still missing.

## Start Here
1. Check the current mode in `STATUS.md`.
2. Run the main checks:

```bash
npm test
npm run check:architecture
npm run check:routes-security
npm run check:secrets
```

3. Start the API, Web UI, and bot/Electron app.
4. Check that public config routes work.
5. Check that admin routes reject users who are not admins.

## Useful Admin Routes
Use the admin screen first when possible.

If you need to call the API directly, these routes are useful:

- `GET /api/admin/ops-dashboard`
- `GET /api/admin/ops-alerts`
- `GET /api/admin/margin-report`
- `GET /api/admin/incidents`
- `GET /api/admin/abuse-analytics`
- `GET /api/admin/security-audits`
- `GET /api/admin/overage-report`
- `GET /api/admin/pre-scale-telemetry`

## If Alerts Show Up
1. Open `GET /api/admin/ops-alerts`.
2. If persistence fallback is active, check Firestore or hosted DB setup.
3. If builds are failing, check recent build history.
4. If token cost is high, check margin and emergency guard routes.
5. Resolve incidents only after the cause is fixed.

Resolve route:

```txt
POST /api/admin/incidents/:incidentId/resolve
```

## Emergency Margin Guard
This guard helps protect hosted costs.

Use override only when you know the data is wrong or you need a short emergency change.

Routes:

- `GET /api/admin/emergency-guard`
- `POST /api/admin/emergency-guard/override`

## Build Failure Checks
1. Open build history.
2. Check the build source:
   - `local` means local code made the first plan.
   - `ai` means AI made the first plan.
3. Check attempts, replans, and the failure reason.
4. Try the smallest prompt that causes the same bug.
5. Add a focused test for the bug.

## Decisions Still Needed
These are product choices, not code bugs:

- final Terms and Privacy copy,
- external incident alerts, like Slack or email,
- redstone and teleport command safety rules,
- how polished admin and community screens must be before launch.

