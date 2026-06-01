# Minecraft AI Agent Roadmap

Audit date: 2026-05-31

This roadmap was audited against the current codebase, tests, and the more detailed implementation log archived at `docs/archive/ROADMAP.md`.

## Current Summary

The core product is no longer in early roadmap state. Most original phases have working code and tests:

- Bot command routing, WebSocket control, and Mineflayer execution are implemented.
- AI build generation is tier-gated, token-governed, and context-aware.
- Local-first deterministic build planning is implemented for common structured prompts, with local-vs-AI telemetry.
- Stripe checkout, tier policy, build history, usage metering, ops alerts, abuse analytics, referrals, and community primitives exist.
- The biggest remaining gaps are production hardening, full localization coverage, real-world integration testing, Electron packaging/log streaming hardening, and broader local build-template coverage.

## Phase 0: Foundation and Setup

Status: Done

Implemented:
- Project structure split across `apps/bot`, `apps/api`, `apps/webui`, `apps/cli`, `apps/electron`, `apps/shared-utils`, `apps/core`, and `packages/prompt-parser`.
- Mineflayer, pathfinder, WebSocket, Vec3, OpenAI, Auth0, Stripe, and test tooling are wired.
- Shared core staging exists via `scripts/stage-shared-core.mjs`.
- Architecture boundary and security checks exist in `scripts/check-architecture-boundaries.mjs`, `scripts/check-protected-routes.mjs`, and `scripts/scan-secrets.mjs`.

Remaining gaps:
- Production deployment docs now have a checklist and admin runbook, but cloud-specific deployment steps still need to be finalized for the chosen host.

## Phase 1: Prompt Parsing and Structure Streaming

Status: Done for deterministic/common builds

Implemented:
- CLI prompt flow exists in `apps/cli/index.js`.
- Shared instruction schema exists in `apps/shared-utils/instruction-schema.js`.
- Prompt parser supports common local templates in `packages/prompt-parser/index.js`.
- Local templates now cover floors/platforms, bridges, roads/paths, walls, wall openings, doors, windows, fences, pillars/columns, towers, stairs, cubes/boxes, tunnels, arches, roofs, simple farms, gardens, rooms, glass blocks, and small/medium houses.
- Simple dimensions and materials are parsed locally, e.g. `10x4 stone floor`, `8 by 2 wooden bridge`, `3 wide 4 tall quartz stairs`.
- Bot command routing can skip `/api/ai-get-structure` for known local prompts.

Remaining gaps:
- Template coverage is still finite. Decorative compositions and multi-part styled builds are not fully local.
- Natural language beyond simple dimensions/materials still falls back to AI.

## Phase 2: AI Context Awareness, Local Decision Engine, and Movement

Status: MVP complete

Implemented:
- Mineflayer pathfinder is wired in the bot.
- Bot context includes position, inventory, nearby blocks/entities, terrain profile, anchor candidates, reachability, pathfinder diagnostics, and failure digest.
- `apps/bot/world-context.js` computes terrain and anchor summaries locally.
- `apps/bot/local-decision-planner.js` compiles local parser output into prep/build commands.
- `apps/bot/decision-engine.js` runs a bounded state machine: precheck, site selection, site prep, build execution, verify, patch replan, done/failed.
- `apps/bot/execute-commands.js` handles movement, follow, stop, site prep, clear volume, flatten area, support fill, block overwrite, material equip, and structured failure logs.
- AI patch replans remain bounded and tier-aware for failures that the local executor cannot recover from.

Remaining gaps:
- No fully general no-AI planner for arbitrary creative builds. This is intentional; AI remains the right fallback for open-ended prompts.
- Real server/chunk integration tests are still needed for terrain edge cases.
- Survival-mode resource gathering is not implemented as a full local loop; creative/material-give mode is the strongest path today.
- Decision-engine local-vs-AI telemetry is recorded in the bot build summary and surfaced per build in the Web UI build history. Build history now includes a recent-build aggregate rollup; terrain-prep summaries are still pending.

## Phase 3: Web UI and API Gateway

Status: Mostly done

Implemented:
- API app exists with route modules for AI, users, Stripe, admin, community, and config.
- Web UI exists in `apps/webui`.
- Dashboard has been replaced with a Figma-directed desktop control-center shell covering dashboard, launch, build, console, history, community, settings, and admin screens.
- Admin-tier dashboard now includes a read-only operations panel for ops, alerts, margin, margin alerts, usage, overage, build-cost, emergency guard, pre-scale telemetry, performance, simulation history, conversion, attribution, referral analytics, incidents, abuse, and security audit snapshots.
- Dashboard includes a basic community panel for linked accounts, rewards, referral summary/code creation, phrase packs, and marketplace listing visibility.
- Dashboard includes an account panel for policy acceptance state, renewal preference, cancellation/refund ticket submission, and parental controls.
- WebSocket provider handles authenticated bot communication.
- Electron wrapper exists for local bot launch/control.
- Build history retrieval and UI panel exist, including per-build decision-engine source, success, attempts, replans, local-vs-AI telemetry counters, and recent-build aggregate rollups.

Remaining gaps:
- Admin ops dashboards have a redesigned Web UI surface with read-only snapshots and incident resolution. Polished drilldowns and high-risk operator controls are still pending.
- Community/referral/marketplace features have a redesigned dashboard surface with referral redemption, phrase pack creation, listing creation, and marketplace listing browsing. Publishing, editing, moderation, and polished marketplace workflows are still pending.
- The previous dashboard localization provider was removed during the Figma UI overhaul; translation coverage needs to be rebuilt against the new shell. Website copy and translation review are still pending.
- Broader end-to-end browser tests are not present.

Decision recorded:
- Admin/community UI is not a blocker for backend roadmap completion. It should be prioritized before a polished public launch, but API-first operations are acceptable for internal/pre-scale use.
- Real Mineflayer integration scenarios require a live local or hosted Minecraft server plus commander credentials. Do not mark them automated until that test environment exists; keep executing locally verifiable unit/API/web checks in the meantime.

## Phase 4: Subscription Tiering and Monetization

Status: Mostly done

Implemented:
- Canonical tiers: Free, Starter, Pro, Admin.
- Tier prices and limits live in `apps/core/contracts/tier-policy.js`.
- Stripe checkout and confirmation routes exist.
- SKU catalog exists for monthly paid plans.
- Prompt/request/token/concurrency quotas are enforced.
- Build frequency quotas are enforced.
- Overage billing logic exists for paid tiers.
- Margin metering, monthly margin reports, break-even alerts, and emergency margin guard exist.
- Auth0-protected user signup, tier fetch, policy acceptance, and checkout confirmation flows exist.

Remaining gaps:
- Live Stripe product/env validation is deployment-time work, not proven by unit tests.
- Persistent economics depends on Firestore credentials or cloud identity; otherwise it falls back to in-memory mode.
- Subscription management UI now exposes renewal preference, cancellation/refund ticket submission, and policy state. Real Stripe customer portal/refund automation remains backend-ticket driven.

Decision recorded:
- Stripe customer portal, automated cancellation, and automated refund execution require a payment-operations decision. The current implementation keeps user requests as auditable tickets and disables renewal locally for cancellation requests.

## Phase 5: Agent Operations Management

Status: Backend done, UI incomplete

Implemented:
- Build/session logging API exists.
- Ops metrics, active sessions, queue depth, failures, blocked placements, token burn, crash alerts, and incident manager exist.
- Admin routes expose ops dashboard, alerts, incidents, evaluation reports, abuse analytics, margin reports, overage reports, and security audits.
- Security-denied audit middleware exists for auth failures.
- Pre-scale simulation and telemetry exist.

Remaining gaps:
- Admin Web UI exposes read-only snapshots for these backend metrics inside the redesigned shell, but it is not a fully polished operator console.
- No external notification integration is wired in code, e.g. email, Slack, PagerDuty.
- Admin runbook exists in `docs/ADMIN-RUNBOOK-2026-05-31.md`; provider-specific escalation and deployment-host steps remain pending.

Decision recorded:
- External notifications need a provider decision before implementation. Candidate options: Slack webhook, email provider, PagerDuty/Opsgenie. Continue with API-visible incidents until the provider is chosen.
- Emergency guard override buttons and pre-scale simulation triggers need an operator-safety decision before being exposed in the Web UI. Keep these as API/runbook workflows for now.

## Phase 6: Pro Tier and Command Block Support

Status: Partially done

Implemented:
- Command block placement is forbidden for Free/Starter and allowed for Pro/Admin by validator policy.
- Command-block denial emits security audit events.
- Higher build limits are enforced by tier.

Remaining gaps:
- Redstone scripting and teleport chat commands are not implemented.
- There is no dedicated UX for Pro/Admin command-block workflows.
- Command-block behavior should get real-world safety testing before being marketed as a polished feature.

Decision recorded:
- Redstone scripting and teleport commands require a product/safety decision because they can affect server integrity. Keep validator-level command-block support but do not expand automation commands until policy is explicit.

## Phase 7: Social Integration and Share Rewards

Status: Backend primitives done, basic UI started

Implemented:
- Account linking endpoints exist for community platforms.
- Referral code, redemption, entitlement credits, and admin referral analytics exist.
- Like/upvote reward logic with anti-fraud baseline exists.
- Phrase pack and marketplace listing endpoints exist.
- Dashboard community panel surfaces linked account counts, reward/referral state, phrase pack count, public marketplace listings, referral redemption, phrase pack creation, listing creation, and a basic marketplace listing view.

Remaining gaps:
- CurseForge/Modrinth publishing is not a full product flow.
- Marketplace and phrase pack user interfaces support basic creation, visibility, and marketplace browsing, but editing, publishing, and moderation workflows are still incomplete.
- Reward abuse protection is basic and should be hardened before launch-scale incentives.

## Phase 8: Policy, Compliance, and Trust

Status: Mostly done

Implemented:
- Terms/privacy acceptance is wired into signup/checkout flows.
- Refund eligibility and renewal preference logic exist.
- Subscription ticket endpoint exists.
- Parental controls and prompt moderation baseline exist.
- Dashboard account panel surfaces policy acceptance, renewal preference, subscription tickets, and parental controls.
- Admin routes are JWT and admin-authorized.
- Protected-route checks and security tests exist.
- Read-only admin dashboard endpoint smoke coverage now includes the broader admin telemetry endpoints surfaced in the Web UI.

Remaining gaps:
- Legal copy and policy versions need product/legal review before production launch.
- Moderation is blocklist/baseline oriented, not a comprehensive safety system.

Decision recorded:
- Legal copy is a launch blocker, but not an engineering blocker. Current policy version wiring can proceed with placeholder versions until final copy is approved.

## Phase 9: UX and Growth

Status: Mixed

Implemented:
- Figma-directed responsive dashboard shell exists for the Electron/Web UI surface.
- Locale selector was removed with the old UI and needs to be rebuilt for the new shell.
- Campaign attribution endpoints exist.
- Website and Electron app shells exist.

Remaining gaps:
- Localization remains partially open: Spanish, Portuguese, and French have dashboard dictionary coverage for the main app surfaces, but website copy coverage and translation review are pending.
- Marketing website and dashboard are not fully tied into every backend capability.
- Growth/admin analytics now have partial dashboard/admin visibility, but deeper workflows remain API-first.

## Local-First Decision Engine Status

Status: Complete for MVP local-first scope

Implemented:
- Common deterministic builds bypass AI.
- Local parser handles dimensions/materials for common structures.
- Local-vs-AI plan source telemetry is tracked and included in build summaries.
- Mineflayer world context chooses anchors and provides terrain/reachability inputs.
- Local planner emits existing command shapes, keeping execution simple.
- Existing decision engine executes and verifies locally, then falls back to bounded AI replans only when needed.
- Tests cover parser behavior, local planner compilation, and command-router AI bypass for local prompts.

Remaining gaps:
- More local templates can be added over time, but the original high-priority set is now covered.
- Arbitrary creative composition remains AI-backed.
- Real in-game integration tests should be added before claiming broad terrain robustness.

## Highest-Priority Remaining Work

1. Use the production readiness checklist:
   - `docs/PRODUCTION-READINESS-CHECKLIST-2026-05-31.md`.
   - `docs/ADMIN-RUNBOOK-2026-05-31.md`.

2. Execute real integration scenarios:
   - `docs/INTEGRATION-TEST-SCENARIOS-2026-05-31.md`.

3. Expand admin UI surfaces for existing backend endpoints:
   - ops, alerts, margin, margin alerts, usage, overage, build-cost, emergency guard, pre-scale telemetry, performance, simulation history, conversion, attribution, referral analytics, incidents, abuse, and security audit snapshots are now visible to admin-tier users,
   - active incidents can now be resolved from the admin panel,
   - active incidents show expandable playbook/runbook steps,
   - incident status filtering is available,
   - remaining work is polished drilldowns and explicitly approved high-risk operator controls.

4. Expand local-vs-AI telemetry in the dashboard:
   - bot telemetry now records local plan count, AI plan count, AI patch count, success/failure counts, and local plan ratio.
   - build history now shows per-build source, outcome, replan count, and local-vs-AI counters.
   - build history now shows a recent-build aggregate rollup for local plans, AI plans, patch plans, success rate, local ratio, and AI calls avoided.
   - remaining work is persistent API aggregate reporting, terrain-prep summaries, and dollar-denominated cost-saved estimate.

5. Expand local templates further only when the shape is deterministic:
   - decorative variants,
   - biome/style presets.

6. Finish localization:
   - Spanish,
   - Portuguese,
   - French,
   - rebuild locale selector for the redesigned shell,
   - website string coverage,
   - translation review,
   - tests for config and fallback language behavior.

## Known Caveats

- `apps/api/packages/prompt-parser/index.js` is staged from `packages/prompt-parser/index.js` by `npm test`; edit the package source first.
- Firestore-backed persistence requires a working cloud identity or `GOOGLE_APPLICATION_CREDENTIALS`; otherwise some economics/persistence systems run in memory.
- `apps/website/demo.mp4` is currently untracked in this worktree and was not part of this roadmap audit.
- `docs/archive/ROADMAP.md` remains the detailed historical implementation log; this root roadmap is the current product/status view.

## 2026-05-31 Follow-Through Pass

Implemented after the audit:
- Added production readiness checklist.
- Added admin runbook tying ops endpoints, incident triage, margin guard, and build-failure triage together.
- Added real-world integration test scenarios.
- Added bot decision telemetry for local-vs-AI source tracking and build outcomes.
- Surfaced per-build decision telemetry in the Web UI build history.
- Added recent-build aggregate local-vs-AI telemetry to the Web UI build history.
- Added a basic admin-tier operations panel for existing backend snapshots, including usage, overage, and build-cost snapshots.
- Added active incident resolution controls to the admin operations panel.
- Added incident playbook drilldowns to the admin operations panel.
- Added basic incident status filtering to the admin operations panel.
- Added read-only admin snapshots for margin alerts, emergency guard, pre-scale telemetry, performance, simulation history, conversion, attribution, and referral analytics.
- Added smoke coverage that verifies the expanded read-only admin dashboard endpoints still require auth.
- Added Web UI localization provider, locale selector, and main dashboard dictionaries for English, Spanish, Portuguese, and French.
- Expanded Web UI localization coverage to checkout success, launch modal, plan selector, and bot console surfaces.
- Added a basic community dashboard panel for referral/reward/marketplace visibility.
- Added basic community actions for referral redemption, phrase pack creation, and marketplace listing creation.
- Added a basic marketplace listing view to the community panel.
- Added a basic account settings panel for subscription ticket, renewal preference, policy acceptance, and parental-control workflows.
- Expanded local deterministic templates to cover roads/paths, fences, tunnels, arches, roofs, simple farms, and rooms.
- Expanded local deterministic templates to cover standalone doors/windows and simple wall openings.
- Expanded local deterministic templates to cover simple gardens.

## 2026-06-01 Figma UI Overhaul Pass

Implemented:
- Replaced the legacy Web UI composition with a Figma-directed desktop control-center shell.
- Added redesigned dashboard, launch, build, console, history, community, settings, and admin screens in `apps/webui/src/App.jsx`.
- Removed unused legacy visual components from `apps/webui/src/components`, keeping only non-visual WebSocket/API helpers.
- Added Figma-derived BuilderBot theme tokens and component styling in `apps/webui/src/index.css`.

Remaining:
- Rebuild localization on top of the new shell.
- Add Electron bot stdout/stderr log streaming into the Console screen.
- Harden packaged Electron loading and bot process paths.
- Human review needed for final visual polish and exact Figma fidelity.
