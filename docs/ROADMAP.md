# Consolidated Roadmap (Unimplemented Items)
Audit date: 2026-02-20  
Sources audited:
- PDF roadmap set in `docs/` (`v1` through `v5`, including duplicated variants)
- `docs/AI-SaaS-Token-Economics-Margin-Analysis-Plan.md`

Goal: ship world-context injection without breaking SaaS unit economics, and keep every paid tier margin-positive at full-cap usage.

## Implementation Status
Implementation resumed after human decisions were provided.

## Contradictions Found (2026-02-20, Historical)
These blockers were identified first, then resolved in `2026-02-20 Implementation Pass 1`.
1. Tier price conflict:
   - Resolved by updating UI pricing to Pro `12.99` and Admin `24.99`.
2. Free tier block-limit conflict:
   - Resolved by enforcing `50` blocks for Free tier in bot command limits.
3. Model-cost assumption conflict:
   - Resolved by replacing single-model build generation with hybrid planner/executor routing and per-tier model policies.
4. “Done” state conflict:
   - Resolved by aligning roadmap status with code changes and implementation notes.

## Questions For Human Resolution (Resolved)
1. What are the canonical Pro/Admin prices to use everywhere right now:
   - Option A: `9.99` / `19.99`
   - Option B: `12.99` / `24.99` RESPONSE: <--- use B
2. What is the canonical Free block limit:
   - Option A: `50` <----  RESPONSE: use A
   - Option B: `100`
3. What is the canonical model strategy for build generation:
   - Option A: keep `gpt-4` for now
   - Option B: move to per-tier mini-family routing now
   - Option C (Recommended): Hybrid Model Strategy <--- use option C

//BEGIN ANSWER TO #3
      Architecture
      Use two logical roles:
      1. Planner Model (higher intelligence, lower frequency)
      2. Executor Model (mini-family, high frequency)


🏗 Example User Flow: “Build a medieval watchtower 12 blocks tall.”

Step 1 — Planner (Higher Model)
Generate:
Materials list
Structural outline
Phased plan
Block count estimate
Constraints
Called once.

Step 2 — Executor (Mini Model)
Expand step-by-step placement
Validate inventory
Adjust to terrain
Handle small variations
Called many times.

📊 How This Affects Profitability
Let’s say:
Without hybrid:
50 LLM calls per build
All at premium cost
With hybrid:
1 premium planning call
49 mini calls
That cuts premium token exposure by ~98%.
That’s massive margin protection.

Tier	Planner Model	Executor Model
Free	mini	mini
Starter	mini	mini
Pro	mid-tier	mini
Admin	high-tier	mini

Admin gets best planner.
Execution always mini (because it’s procedural).

This keeps costs predictable.

Is this clear?
//END ANSWER TO #3

4. Should `docs/AI-SaaS-Token-Economics-Margin-Analysis-Plan.md` be updated to match the final pricing decision before implementation starts?
   RESPONSE: I already added a new table with new pricing plans.
5. Should website marketing copy always mirror hard-enforced limits exactly, or can it remain “plan summary” language?
   RESPONSE: just plan summary language for now

## Phase 0: Margin Guardrails Foundation (P0)
- [x] Resolve canonical Pro/Admin pricing and align docs + UI + billing code to one source of truth. (UI updated to Pro `12.99`, Admin `24.99`)
- [x] Lock canonical tier economics in code (model, input cap/request, output cap/request, requests/month, concurrency, overage policy). (`apps/api/config/tier-policy.js`)
- [x] Implement per-tier token governor middleware in API (`max_input_tokens`, `max_output_tokens`, monthly token quotas). (`apps/api/utils/token-governor.js` used by `/ai-get-structure`)
- [x] Add per-tier request quotas and hard stops when cap is reached. (implemented on `/ai-get-structure`)
- [x] Add per-tier concurrency controls (queue slots and rejection behavior). (implemented on `/ai-get-structure`)
- [x] Add per-tier model routing (lower-cost models on Free/Starter, higher capability for Pro/Admin). (hybrid planner/executor route with fallback)
- [x] Add usage metering tables for `input_tokens`, `output_tokens`, `api_cost`, `infra_cost`, `total_cost`, `gross_margin`. (implemented in-memory in `apps/api/utils/margin-metering.js` and populated by `/ai-get-structure`)
- [x] Add monthly margin report endpoint/job by tier (`revenue`, `cost`, `raw_profit`, `margin_percent`). (endpoint: `GET /admin/margin-report`)
- [x] Add break-even monitors and alerts when projected margin drops below threshold. (implemented in `evaluateBreakEvenAlerts`, exposed by `GET /admin/margin-alerts`)

## Phase 1: World-Context Injection + Token Control (P0)
- [x] Add server-side context pipeline: `ContextBuilder -> Compression -> TierGate -> TokenEstimator -> OpenAI`. (implemented in `/ai-get-structure`)
- [x] Implement thin snapshot (default): bot position, health/hunger, compact inventory, nearby entities, task state, short diff. (`apps/api/utils/ai-context.js`)
- [x] Implement thick snapshot trigger path (failures, combat, build-critical steps, explicit request). (`prepareContextForSnapshot` + trigger resolver in `apps/api/utils/ai-context.js`)
- [x] Add deterministic compression (top-K summaries, float quantization, null/default stripping, canonical keys). (initial implementation)
- [x] Add delta encoding so repeated requests send only state changes. (in-memory per-user delta payload with changed keys only in `prepareContextForSnapshot`)
- [x] Add world memo cache refreshed on interval (30-120s target). (in-memory memo cache with bounded refresh interval in `prepareContextForSnapshot`)
- [x] Enforce per-tier context size budgets before model call.
- [x] Add AI world-context injection to `/ai-get-structure` with strict schema validation.

## Phase 2: Command/Build Execution Reliability (P0)
- [x] Support mixed AI action plans (`move_to` + placement) in one generated response path. (normalized `actions[]` plus legacy compatibility)
- [x] Add a normalized instruction schema shared by chat, WebSocket, and API. (`apps/shared-utils/instruction-schema.js`)
- [x] Implement explicit `follow` behavior/command (not just `come here`). (`apps/bot/command-router.js`)
- [x] Add strict server-side build validator (illegal block checks, max fill volume, command payload safety). (`apps/api/utils/build-validator.js`)
- [x] Split deterministic movement from LLM planning to prevent micro-move token burn loops. (movement action optimization + retry timeouts)
- [x] Add retry/backoff policy for pathfinding/build failures with bounded token retries. (`/ai-get-structure` bounded executor retries + backoff)
- [x] Reintroduce/ship a working CLI prompt flow (`apps/cli` currently missing). (`apps/cli/index.js`)
- [x] Add optional `.schematic` export for generated builds. (`includeSchematic` response support)

## Phase 3: Tiering and Monetization Completion (P0/P1)
- [x] Enforce build frequency quotas (daily/monthly), not just per-build limits. (`apps/api/utils/build-governor.js`)
- [x] Gate chat/build features by tier. (`TIER_FEATURE_POLICY` + `/user/features` + `/ai-get-structure` gating)
- [x] Add command-block permissions by tier (Pro/Admin) with auditing trail. (validator + `/admin/security-audits`)
- [x] Complete build history productization (user-facing history UI + retrieval API). (`GET /user/builds`, `GET /user/build/:buildId`, `apps/webui/src/components/BuildHistoryPanel.jsx`)
- [ ] Add SKU expansion from roadmap docs: Lite, Annual Pro, Server License, Mega Build Pass. (deferred; currently limited to Starter/Pro/Admin monthly SKUs)
- [x] Implement referral bonus rules and entitlement updates. (`/community/referral/*`, `/user/entitlements`, `apps/api/utils/referrals.js`)
- [x] Implement overage billing paths for paid tiers (Starter/Pro/Admin) from policy table. (`apps/api/utils/token-governor.js`, `apps/api/utils/overage-billing.js`, `/user/overage`, `/admin/overage-report`)

## Phase 4: Ops, Reliability, and Safety (P1)
- [x] Build operations dashboard: active sessions, installs, queue health, failures. (`apps/api/utils/ops-metrics.js`, `GET /admin/ops-dashboard`)
- [x] Add automated alerts for crashes, blocked placements, suspicious usage, and burn spikes. (`evaluateOpsAlerts`, `GET /admin/ops-alerts`)
- [x] Add admin incident notifications and response playbooks. (`apps/api/utils/incident-manager.js`, `GET /admin/incidents`)
- [x] Implement multi-pool inference routing (standard vs priority pool by tier). (`inferencePool` in tier model route)
- [x] Add canary rollout for prompt/model changes. (`isInCanaryRollout` usage-key enrollment)
- [x] Add quality guardrails (hallucination checks, auto-retry using fallback strategy). (schema validation + retry + deterministic fallback plan)
- [x] Add periodic evaluation harness and regression tracking. (`apps/api/utils/evaluation-harness.js`, `POST /admin/evaluation/run`, `GET /admin/evaluation`)
- [x] Add abuse-pattern analytics for chat and build requests. (`apps/api/utils/abuse-analytics.js`, `GET /admin/abuse-analytics`)

## Phase 5: Social and Community Features (P1)
- [x] Add account linking and sharing flows for CurseForge/Modrinth builds. (`POST/GET /community/link`)
- [x] Add likes/upvotes ingestion and rewards engine with anti-fraud checks. (`recordBuildReaction` anti-fraud + reward credits, `/community/rewards`)
- [x] Add shareable chat phrase packs / AI personality presets. (`POST/GET /community/phrase-pack(s)`)
- [x] Add user marketplace for build/template sharing and selling. (`POST /community/marketplace/listing`, `GET /community/marketplace/listings`)

## Phase 6: Policy, Compliance, and Trust (P1)
- [x] Implement in-app cancellation/refund workflows from dashboard. (`POST /user/subscription/ticket`)
- [x] Enforce refund and renewal policy logic in backend billing flows. (`apps/api/utils/billing-policy.js`, `/user/subscription/renewal`, refund eligibility enforcement in `/user/subscription/ticket`)
- [x] Publish and wire Terms/Privacy acceptance into signup/checkout. (`/user/signup`, `/api/user/policy/accept`, `/stripe/create-checkout-session`, `/stripe/confirm-checkout`)
- [x] Add parental controls and moderation layer for inappropriate output. (`/user/parental-controls` + prompt moderation filter)

## Phase 7: UX and Growth Backlog (P2)
- [x] Ship mobile-optimized web experience. (responsive dashboard + build history layout updates in `apps/webui/src/App.jsx` and `apps/webui/src/components/BuildHistoryPanel.jsx`)
- [ ] Add localization (Spanish, Portuguese, French).
- [x] Add campaign tooling/attribution for influencer and referral growth loops. (`POST /analytics/attribution`, `GET /admin/analytics/attribution`)

## Economics Baseline To Implement (from margin-analysis doc)
- [x] Free: `4k` max input/request, `100` req/month, `1` concurrency, hard cap.
- [x] Starter: `8k` max input/request, `1,000` req/month, `2` concurrency, basic overage.
- [x] Pro: `16k` max input/request, `5,000` req/month, `4` concurrency, advanced overage.
- [x] Admin: `32k` max input/request, `15,000` req/month, `8` concurrency, metered overage.
- [x] Enforce output caps per tier using explicit `max_output_tokens` policy.

## Notes
- Already present but incomplete: tiering, Stripe checkout, session/build logging, chat/WebSocket control.
- This roadmap is intentionally margin-aware: token safety and profitability are now P0 gates, not later-phase nice-to-haves.
- `2026-02-20 Implementation Pass 1`: added canonical tier pricing/policy config in `apps/api/config/tier-policy.js`.
- `2026-02-20 Implementation Pass 1`: added context compression/token estimation in `apps/api/utils/ai-context.js`.
- `2026-02-20 Implementation Pass 1`: added in-memory monthly request/token governor in `apps/api/utils/token-governor.js`.
- `2026-02-20 Implementation Pass 1`: upgraded `/ai-get-structure` to hybrid planner/executor model flow with per-tier limits and fallback model handling.
- `2026-02-20 Implementation Pass 1`: updated bot to send world context with build prompts.
- `2026-02-20 Implementation Pass 1`: updated plan UI pricing to Pro `12.99` and Admin `24.99`.
- `2026-02-20 Implementation Pass 1`: aligned free build cap enforcement to `50` blocks in bot command routing.
- `2026-02-20 Implementation Pass 2`: added in-memory margin metering tables for per-tier token/cost/revenue tracking in `apps/api/utils/margin-metering.js`.
- `2026-02-20 Implementation Pass 2`: added monthly economics reporting endpoint `GET /admin/margin-report` and diagnostics endpoint `GET /admin/usage-metering`.
- `2026-02-20 Implementation Pass 2`: added threshold-based break-even alert monitor with endpoint `GET /admin/margin-alerts`.
- `2026-02-20 Implementation Pass 3`: added server-side context preparation pipeline (`prepareContextForSnapshot`) with explicit thick-snapshot trigger path detection for failures/combat/build-critical/explicit requests.
- `2026-02-20 Implementation Pass 3`: added in-memory world memo cache with 30-120s bounded refresh interval and per-user delta encoding to reduce repeated context payload cost.
- `2026-02-20 Implementation Pass 3`: integrated context diagnostics into `/ai-get-structure` response metadata and added regression tests for trigger resolution, memo refresh, and delta behavior.
- `2026-02-20 Implementation Pass 4`: added normalized instruction schema and mixed action-plan execution path across API, bot chat flow, and WebSocket control.
- `2026-02-20 Implementation Pass 4`: added server-side instruction validator with command-block permission gating, fill-volume checks, and audit events.
- `2026-02-20 Implementation Pass 4`: added tier feature policy and build-frequency governor (daily/monthly caps) plus `/user/features` enforcement endpoint.
- `2026-02-20 Implementation Pass 4`: expanded API with build history retrieval, ops/security dashboards, campaign attribution, community sharing/marketplace flows, policy workflows, and parental controls.
- `2026-02-20 Implementation Pass 4`: reintroduced CLI prompt flow (`apps/cli/index.js`) and optional schematic artifact export for generated plans.
- `2026-02-20 Implementation Pass 5`: fixed missing build-history Firestore exports and shipped user-facing build history panel in Web UI (`apps/webui/src/components/BuildHistoryPanel.jsx`).
- `2026-02-20 Implementation Pass 5`: added SKU-aware checkout routing and canonical catalog endpoint for current monthly plans (`apps/api/config/sku-catalog.js`, `POST /stripe/create-checkout-session`).
- `2026-02-20 Implementation Pass 5`: implemented referral bonus rules, entitlement balances, and redemption endpoints (`apps/api/utils/referrals.js`, `/community/referral/*`, `/user/entitlements`).
- `2026-02-20 Implementation Pass 5`: enabled metered overage billing paths for paid tiers and reporting endpoints (`apps/api/utils/token-governor.js`, `apps/api/utils/overage-billing.js`, `/user/overage`, `/admin/overage-report`).
- `2026-02-20 Implementation Pass 5`: expanded ops metrics/alerts (installs, active sessions, queue depth, crash/blocked/burn spike alerts) and added incident playbooks/notifications (`apps/api/utils/ops-metrics.js`, `apps/api/utils/incident-manager.js`).
- `2026-02-20 Implementation Pass 5`: added evaluation harness + regression tracking and abuse analytics endpoints (`apps/api/utils/evaluation-harness.js`, `apps/api/utils/abuse-analytics.js`).
- `2026-02-20 Implementation Pass 5`: enforced refund eligibility + renewal preference policy logic and wired Terms/Privacy acceptance into signup/checkout confirmation (`apps/api/utils/billing-policy.js`, `/user/subscription/*`, `/stripe/confirm-checkout`).
- `2026-02-20 Implementation Pass 5`: added like/upvote reward credits with anti-fraud baseline checks (`recordBuildReaction`, `/community/rewards`).
- `2026-02-20 Pre-Scale Pass`: monthly usage/margin telemetry now supports Firestore persistence with restart-safe monthly keys (`apps/api/utils/economics-persistence.js`, `apps/api/utils/token-governor.js`, `apps/api/utils/margin-metering.js`).
- Caveat: persistent economics writes require a working Firestore runtime (`GOOGLE_APPLICATION_CREDENTIALS` or equivalent cloud identity). Without it, the system falls back to in-memory mode.
- Caveat: localization content is still pending translation copy and full UI string coverage; only locale config and roadmap scaffolding exist today.
