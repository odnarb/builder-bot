# Consolidated Roadmap (Unimplemented Items)
Audit date: 2026-02-20  
Sources audited: all PDFs in `docs/` (`v1` through `v5`, plus duplicated roadmap variants). (these were from my Google Drive)

This document lists only work that is still missing or incomplete after comparing roadmap PDFs to the current codebase.

## Phase 1: Core Product Gaps (P0)
- [ ] Add AI world-context injection (bot position, inventory, nearby blocks) to `/ai-get-structure` prompts.
- [ ] Support mixed AI action plans (`move_to` + placement) in one generated response path.
- [ ] Add a normalized command instruction format shared by chat, WebSocket, and API calls.
- [ ] Implement explicit `follow` behavior/command (current flow mainly supports `come here` and `stop`).
- [ ] Reintroduce/ship a working CLI prompt flow (`apps/cli` is currently missing).
- [ ] Add optional `.schematic` export for generated builds.
- [ ] Add strict server-side build validator (illegal block checks, max fill volume, command payload safety).

## Phase 2: Tiering and Monetization Completion (P0/P1)
- [ ] Enforce build frequency quotas (daily/monthly), not just per-build prompt/block limits.
- [ ] Add concurrent build/queue slot limits by tier.
- [ ] Add command-block permissions by tier (Pro/Admin only) with hard validation.
- [ ] Gate chat/build features by tier (currently mostly open once bot is running).
- [ ] Complete build history productization (user-facing history UI + filters + retrieval API).
- [ ] Add SKU expansion from roadmap docs: Lite, Annual Pro, Server License, Mega Build Pass.
- [ ] Implement referral bonus rules and entitlement updates.

## Phase 3: Social and Community Features (P1)
- [ ] Add account linking and sharing flows for CurseForge/Modrinth user builds.
- [ ] Add likes/upvotes ingest + rewards engine (including anti-fraud checks).
- [ ] Add shareable chat phrase packs / AI personality presets.
- [ ] Add user marketplace for build/template sharing and selling.

## Phase 4: Ops, Reliability, and Safety (P1)
- [ ] Build an operations dashboard for active sessions, installs, failures, and queue health.
- [ ] Add automated alerting for crashes, blocked placements, suspicious usage, and repeated failures.
- [ ] Add admin notification workflows for critical incidents.
- [ ] Add analytics pipeline for tier usage, feature popularity, and abuse patterns.
- [ ] Implement multi-pool inference routing (standard vs priority pool by tier).
- [ ] Add canary rollout path for prompt/model changes.
- [ ] Add cost guardrails (token caps, budget thresholds, nightly burn checks).
- [ ] Add output quality checks (air-block hallucination detection, auto-retry strategy).
- [ ] Add continuous eval cadence (benchmark prompt set + regression tracking).

## Phase 5: Policy, Compliance, and Trust (P1)
- [ ] Implement in-app cancellation/refund workflows from dashboard.
- [ ] Enforce roadmap refund policies in backend logic (renewals, grace periods, exclusions).
- [ ] Publish and wire Terms/Privacy policy acceptance into signup/checkout.
- [ ] Add parental controls (age flags, safety caps) and moderation layer for inappropriate output.

## Phase 6: UX and Growth Backlog (P2)
- [ ] Ship mobile-optimized web experience.
- [ ] Add localization (Spanish, Portuguese, French from roadmap targets).
- [ ] Formalize growth execution items from roadmap docs (influencer/referral campaign tooling and tracking).

## Notes
- Already present but incomplete: tiering, Stripe checkout, session/build logging, chat/WebSocket control.
- Duplicated PDFs were consolidated into a single backlog to avoid repeated items.
