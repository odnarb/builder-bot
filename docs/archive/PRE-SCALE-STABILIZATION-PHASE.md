# Pre-Scale Stabilization Phase
## Minecraft AI Agent – Execution Order Plan

Last updated: **2026-02-21**
Execution status: **Implementation pass completed in-code where feasible in this repository**

Purpose: Stabilize economics, reliability, and operational visibility before aggressive marketing or scale push.

---

## Status Summary (2026-02-21)
- [x] Phase 1: Persistent Economics & Usage Integrity (P0)
- [x] Phase 2: Real-World Telemetry & Visibility (P0)
- [x] Phase 3: Stress & Abuse Hardening (P0)
- [x] Phase 4: Performance & Latency Profiling (P1)
- [x] Phase 5: Conversion Instrumentation (P1)
- [x] Phase 6: Monthly SKU Baseline Definition (P1)
- [ ] Phase 7: Marketing Amplification (P2) (partial implementation; blockers documented below)

---

## Phase 1: Persistent Economics & Usage Integrity (P0)

### 1. Persistent Usage & Margin Storage
- [x] Move token metering from in-memory state to persistent storage (Firestore-backed when available, in-memory fallback when unavailable/test mode).
  - Implemented via `apps/api/utils/economics-persistence.js`.
  - Token usage persistence wired in `apps/api/utils/token-governor.js`.
- [x] Store per-user monthly counters (`input_tokens`, `output_tokens`, `requests`).
  - Stored as monthly usage documents keyed by month + user.
- [x] Store per-tier margin snapshots.
  - Persisted monthly tier rows from `apps/api/utils/margin-metering.js`.
- [x] Store cost per build.
  - Added `recordBuildCostSnapshot` and `GET /admin/build-costs`.
- [x] Store planner vs executor token split.
  - Captured per build in `recordBuildCostSnapshot`.
- [x] Ensure restart-safe monthly rollovers.
  - Monthly keying (`YYYY-MM`) used across usage and metering storage.
- [x] Add migration path for existing in-memory metrics.
  - Added `POST /admin/pre-scale/migrate-inmemory` to flush loaded in-memory rows to persistent storage.

Goal: Make economics real and restart-safe.

---

## Phase 2: Real-World Telemetry & Visibility (P0)

### 2. Production Usage Telemetry Dashboards
Implemented via `apps/api/utils/pre-scale-telemetry.js` and endpoint `GET /admin/pre-scale-telemetry`.

- [x] Avg tokens per build (planner vs executor)
- [x] Avg context injection size
- [x] Thick snapshot trigger frequency %
- [x] Delta compression savings %
- [x] Cap hit rate per tier
- [x] Overage frequency
- [x] Concurrency rejection rate
- [x] Avg cost per active user
- [x] Revenue vs cost per tier (live)

Goal: Replace theoretical unit economics with observed economics.

---

## Phase 3: Stress & Abuse Hardening (P0)

### 3. Load & Abuse Simulation
Implemented synthetic harness in `apps/api/utils/pre-scale-simulation.js`.

- [x] Simulate 100+ concurrent users
- [x] Simulate max-cap users
- [x] Simulate rapid build loops
- [x] Simulate thick-snapshot spam attempts
- [x] Simulate command-block abuse attempts
- [x] Simulate overage abuse patterns

Metrics returned by `POST /admin/pre-scale/simulate` and history at `GET /admin/pre-scale/simulations`:
- [x] Latency spikes
- [x] Queue depth
- [x] Retry loops
- [x] Token burn spikes
- [x] Failure rates

Deterministic 3-scenario guard shakeout CLI:
- [x] `npm --prefix apps/api run pre-scale:shakeout` (normal / active / recovery with validation assertions)

Goal: Break the system before users do.

### 3.1 Global Emergency Margin Guard
Implemented via `apps/api/utils/emergency-margin-guard.js` and integrated in `apps/api/index.js`.

- [x] Emergency margin guard (auto throttle + force-thin + admin override + alert + playbook)
- [x] Auto-evaluate guard on live economics (`monthly_margin < threshold` OR `token_burn_rate > threshold`)
- [x] Conservative default thresholds enabled for initial traffic (`margin=45%`, `burn=$3/hr`, `cooldown=20m`, cached eval `45s`)
- [x] Periodic persistence re-sync for multi-instance convergence (per-process in-memory cache + persistence refresh window)
- [x] Auto-throttle Free tier request path during active guard state
- [x] Force thin snapshots while guard is active (temporarily disables thick snapshots)
- [x] Persist guard state/overrides to pre-scale persistence layer (`emergencyGuard` collection key)
- [x] Add admin visibility + control endpoints:
  - `GET /admin/emergency-guard`
  - `POST /admin/emergency-guard/override` (`force_on` / `force_off` / `clear`)
- [x] Lock `/admin/emergency-guard`, `/admin/emergency-guard/override`, and `/admin/ops-alerts` behind JWT + admin authorization middleware
- [x] Harden admin fallback tier check cache with bounded TTL (`30-120s`) and invalidate on tier changes (`/user/plan`, `/stripe/confirm-checkout`)
- [x] Surface active guard alert in `GET /admin/ops-alerts` (`emergency_margin_guard_active`)
- [x] Emit stable transition log line on state changes (`GUARD_STATE_TRANSITION: NORMAL -> ACTIVE ...`)
- [x] Include `guard_state_effective` in `GET /admin/pre-scale-telemetry` payload for operations context
- [x] Return stable free-tier guard throttle contract (`429` + `Retry-After` + `code=FREE_TIER_THROTTLED_GUARD_ACTIVE`)
- [x] Attach incident playbook for guard activation (`emergency_margin_guard_active` in `apps/api/utils/incident-manager.js`)
- [x] Guard enforcement coverage verified across primary request path retries and admin simulation path (no separate queue worker path present in-repo)

Goal: Provide a fail-safe margin breaker that protects economics during abnormal burn or margin collapse.

---

## Phase 4: Performance & Latency Profiling (P1)

### 4. Cold-Start & Latency Profiling
Implemented via `GET /admin/performance-profile` and telemetry instrumentation in `/ai-get-structure`.

- [x] P50 / P95 / P99 latency
- [x] Planner cold-start time
- [x] Executor throughput
- [x] Memory usage under concurrency
- [x] Queue wait time by tier

Goal: Ensure interactive responsiveness under real usage.

---

## Phase 5: Conversion Instrumentation (P1)

### 5. Funnel & Upgrade Tracking
Implemented via `apps/api/utils/conversion-funnel.js` and endpoint `GET /admin/conversion-funnel`.

- [x] Free → Starter conversion %
- [x] Starter → Pro conversion %
- [x] Pro → Admin conversion %
- [x] Upgrade time-to-conversion
- [x] Feature usage before upgrade

Instrumentation wired in:
- `POST /user/signup`
- `POST /user/plan`
- `POST /stripe/create-checkout-session`
- `POST /stripe/confirm-checkout`
- `POST /ai-get-structure` (feature usage signal)

Goal: Understand monetization mechanics before scaling traffic.

---

## Phase 6: Monthly SKU Baseline Definition (P1)

### 6. Monthly SKU Hardening
Implemented in `apps/api/config/sku-catalog.js` and checkout mapping in `apps/api/index.js`.

- [x] Keep canonical monthly SKUs only (`starter_monthly`, `pro_monthly`, `admin_monthly`)
- [x] Remove expanded non-monthly/renamed SKU set and keep monthly baseline only
- [x] Keep checkout SKU-to-Stripe mapping aligned to monthly baseline only
- [x] Keep Starter/Pro/Admin plan naming consistent in user-facing selector

Goal: Keep plan catalog clear, stable, and easy to understand.

---

## Phase 7: Marketing Amplification (P2)

### 7. Developer-Focused Marketing Site Upgrade
- [ ] Architecture diagram (planner/executor + compression + token governor)
- [ ] Tier comparison matrix
- [ ] Real build demo GIFs
- [ ] Live screenshots
- [ ] Server-owner landing page
- [ ] Clear AI authority ladder explanation

Goal: Market defensibility and engineering rigor, not just features.

### Blockers / Issues (2026-02-21)
- [x] Plan selector naming reverted to Starter (`apps/webui/src/components/PlanSelector.jsx`).
- [ ] Dedicated public marketing site app/surface is not present in this repository (current Web UI is auth-gated dashboard-first).
- [ ] Demo GIF and screenshot assets were not available in-repo for direct integration.
- [ ] Marketing copy/art direction finalization requires product/marketing asset pass.

---

## Strategic Framing

This phase transitions the product from:

“Feature complete”

to

“Scale ready.”

Do not add major new features during this phase.

Focus on:
- Economic stability
- Operational durability
- Signal clarity
- Monetization visibility
- Performance reliability

---

## Completion Criteria

Pre-scale stabilization is complete when:

- [x] Economics persist across restarts
- [x] Live telemetry validates margin assumptions
- [x] System survives synthetic abuse testing
- [x] Global emergency margin guard can auto-throttle and force thin context mode
- [x] Latency is measurable with target profiles (P50/P95/P99 + cold-start/throughput)
- [x] Conversion funnel is measurable
- [x] Monthly SKU baseline (Starter/Pro/Admin) is clearly defined
- [ ] Marketing amplification assets/site pass is complete (blocked items above)

Only then should large-scale marketing expansion begin.
