# Consolidated Roadmap (Unimplemented Items)
Audit date: 2026-02-20  
Sources audited:
- PDF roadmap set in `docs/` (`v1` through `v5`, including duplicated variants)
- `docs/AI-SaaS-Token-Economics-Margin-Analysis-Plan.md`

Goal: ship world-context injection without breaking SaaS unit economics, and keep every paid tier margin-positive at full-cap usage.

## Phase 0: Margin Guardrails Foundation (P0)
- [ ] Lock canonical tier economics in code (model, input cap/request, output cap/request, requests/month, concurrency, overage policy).
- [ ] Implement per-tier token governor middleware in API (`max_input_tokens`, `max_output_tokens`, monthly token quotas).
- [ ] Add per-tier request quotas and hard stops when cap is reached.
- [ ] Add per-tier concurrency controls (queue slots and rejection behavior).
- [ ] Add per-tier model routing (lower-cost models on Free/Starter, higher capability for Pro/Admin).
- [ ] Add usage metering tables for `input_tokens`, `output_tokens`, `api_cost`, `infra_cost`, `total_cost`, `gross_margin`.
- [ ] Add monthly margin report endpoint/job by tier (`revenue`, `cost`, `raw_profit`, `margin_percent`).
- [ ] Add break-even monitors and alerts when projected margin drops below threshold.

## Phase 1: World-Context Injection + Token Control (P0)
- [ ] Add server-side context pipeline: `ContextBuilder -> Compression -> TierGate -> TokenEstimator -> OpenAI`.
- [ ] Implement thin snapshot (default): bot position, health/hunger, compact inventory, nearby entities, task state, short diff.
- [ ] Implement thick snapshot trigger path (failures, combat, build-critical steps, explicit request).
- [ ] Add deterministic compression (top-K summaries, float quantization, null/default stripping, canonical keys).
- [ ] Add delta encoding so repeated requests send only state changes.
- [ ] Add world memo cache refreshed on interval (30-120s target).
- [ ] Enforce per-tier context size budgets before model call.
- [ ] Add AI world-context injection to `/ai-get-structure` with strict schema validation.

## Phase 2: Command/Build Execution Reliability (P0)
- [ ] Support mixed AI action plans (`move_to` + placement) in one generated response path.
- [ ] Add a normalized instruction schema shared by chat, WebSocket, and API.
- [ ] Implement explicit `follow` behavior/command (not just `come here`).
- [ ] Add strict server-side build validator (illegal block checks, max fill volume, command payload safety).
- [ ] Split deterministic movement from LLM planning to prevent micro-move token burn loops.
- [ ] Add retry/backoff policy for pathfinding/build failures with bounded token retries.
- [ ] Reintroduce/ship a working CLI prompt flow (`apps/cli` currently missing).
- [ ] Add optional `.schematic` export for generated builds.

## Phase 3: Tiering and Monetization Completion (P0/P1)
- [ ] Enforce build frequency quotas (daily/monthly), not just per-build limits.
- [ ] Gate chat/build features by tier.
- [ ] Add command-block permissions by tier (Pro/Admin) with auditing trail.
- [ ] Complete build history productization (user-facing history UI + retrieval API).
- [ ] Add SKU expansion from roadmap docs: Lite, Annual Pro, Server License, Mega Build Pass.
- [ ] Implement referral bonus rules and entitlement updates.
- [ ] Implement overage billing paths for paid tiers (Starter/Pro/Admin) from policy table.

## Phase 4: Ops, Reliability, and Safety (P1)
- [ ] Build operations dashboard: active sessions, installs, queue health, failures.
- [ ] Add automated alerts for crashes, blocked placements, suspicious usage, and burn spikes.
- [ ] Add admin incident notifications and response playbooks.
- [ ] Implement multi-pool inference routing (standard vs priority pool by tier).
- [ ] Add canary rollout for prompt/model changes.
- [ ] Add quality guardrails (hallucination checks, auto-retry using fallback strategy).
- [ ] Add periodic evaluation harness and regression tracking.
- [ ] Add abuse-pattern analytics for chat and build requests.

## Phase 5: Social and Community Features (P1)
- [ ] Add account linking and sharing flows for CurseForge/Modrinth builds.
- [ ] Add likes/upvotes ingestion and rewards engine with anti-fraud checks.
- [ ] Add shareable chat phrase packs / AI personality presets.
- [ ] Add user marketplace for build/template sharing and selling.

## Phase 6: Policy, Compliance, and Trust (P1)
- [ ] Implement in-app cancellation/refund workflows from dashboard.
- [ ] Enforce refund and renewal policy logic in backend billing flows.
- [ ] Publish and wire Terms/Privacy acceptance into signup/checkout.
- [ ] Add parental controls and moderation layer for inappropriate output.

## Phase 7: UX and Growth Backlog (P2)
- [ ] Ship mobile-optimized web experience.
- [ ] Add localization (Spanish, Portuguese, French).
- [ ] Add campaign tooling/attribution for influencer and referral growth loops.

## Economics Baseline To Implement (from margin-analysis doc)
- [ ] Free: `4k` max input/request, `100` req/month, `1` concurrency, hard cap.
- [ ] Starter: `8k` max input/request, `1,000` req/month, `2` concurrency, basic overage.
- [ ] Pro: `16k` max input/request, `5,000` req/month, `4` concurrency, advanced overage.
- [ ] Admin: `32k` max input/request, `15,000` req/month, `8` concurrency, metered overage.
- [ ] Enforce output caps per tier using explicit `max_output_tokens` policy.

## Notes
- Already present but incomplete: tiering, Stripe checkout, session/build logging, chat/WebSocket control.
- This roadmap is intentionally margin-aware: token safety and profitability are now P0 gates, not later-phase nice-to-haves.
