# Build Decision Engine Plan
Date: 2026-02-21

## Goal
Make build execution adaptive to real terrain and obstacles so the bot can:
- choose better build anchors,
- flatten/prepare terrain when needed,
- recover from local path/build failures without full job failure,
- send richer but token-bounded world context to `/api/ai-get-structure`.

## Security Constraints (From Audit Baseline)
Decision-engine work must preserve these enforced boundaries:
- Keep `/ai-get-structure` JWT-protected and server-tier-derived only; never trust caller tier or user headers.
- Keep bot WS control channel loopback-bound, token-authenticated, and origin-allowlisted (`BOT_WS_ALLOWED_ORIGINS`).
- Keep command-block placement gated strictly by persisted tier feature policy.
- Keep denied-authn/denied-authz telemetry and security audit events intact for new routes or control paths.
- Keep AI + billing rate-limit controls intact when adding patch-replan or retry paths.
- Keep persistence fallback visibility intact (do not remove ops alerting when persistence degrades to in-memory).
- Do not add new decision-engine endpoints that bypass existing admin auth middleware.

## Current Gaps (Codebase Snapshot)
- `apps/bot/command-router.js` sends a thin context summary but no terrain profile, anchor candidates, or failure digest.
- `apps/shared-utils/instruction-schema.js` only supports `move_to`, `place_block`, `follow`, `stop`.
- `apps/bot/execute-commands.js` executes sequentially with limited adaptation. It can dig-overwrite and move, but it does not do planned site prep (flatten/clear/fill) or dynamic pivoting when local geometry changes.
- `apps/api/core/logic/ai-get-structure.js` already supports planner/executor retries and thick snapshots, but prompts are not explicitly terrain-tasked for site prep + robust fallback actions.

## Missing Context (Important)
### A) Runtime Signals Not Yet Captured
- Pathfinder event diagnostics are not fed into AI context: `path_update.status`, `path_reset` reason, `goal_reached`, `path_stop`.
- Path-computation quality metrics are missing from planning context and logs:
  - `status` (`success`/`partial`/`timeout`/`noPath`),
  - `time`,
  - `visitedNodes`,
  - `cost`,
  from `getPathTo(...)`/`getPathFromTo(...)`.
- Chunk/load readiness is not explicitly modeled in planning context even though `bot.blockAt(...)` can return `null` when not loaded.
- Bot movement mode is not explicit in runtime:
  - no deterministic per-phase `Movements` profile assignment,
  - no event-driven movement policy switching.

### B) World/Build Context Not Yet Captured
- Build-footprint feasibility summary is missing:
  - support-map ratio (blocks with valid support below),
  - obstructed-volume ratio,
  - fluid hazard ratio,
  - nearest reachable anchor confidence.
- Resource execution mode is missing from context:
  - creative vs survival assumptions,
  - material sufficiency confidence,
  - expected dig/place effort.
- Safety envelope is missing:
  - protected/no-edit zones,
  - max allowed edit radius from commander spawn/base,
  - entity danger weighting (mobs, players, villagers).

### C) Performance Context Not Yet Captured
- No explicit latency budget contract per build phase:
  - scan budget,
  - planning budget,
  - execution budget,
  - recovery budget.
- No throughput baselines:
  - target blocks/minute by tier,
  - acceptable replan overhead per build size bucket.
- No pathfinder budget tuning policy by tier:
  - `thinkTimeout`,
  - `tickTimeout`,
  - `searchRadius`.

### D) Validation/Policy Gaps
- Validator does not yet constrain future site-prep action families (`flatten_area`, `clear_volume`, `ensure_access`).
- No explicit “maximum destructive edits” policy separate from final build block cap.
- No explicit circuit breaker for repeated local failures (e.g., stop after N `path_reset:stuck`).
- No explicit “auth context continuity” assertion across replan flows (ensure user/tier identity used for initial plan is reused for every patch-plan call).

## Decisions Needed From Product/Owner
- Priority order for optimization:
  - fastest completion,
  - highest build fidelity,
  - lowest world damage,
  - lowest token/cost burn.
- Terraform policy:
  - allowed to flatten only inside footprint, or around it,
  - allowed to remove trees/terrain/water/lava,
  - allowed to bridge/gap-fill beyond footprint.
- Safety policy:
  - never edit near player bases/containers,
  - avoid villagers/passive mobs strictly or softly,
  - stop-on-combat vs continue build.
- Runtime policy:
  - max minutes per build,
  - max automatic replans,
  - when to fail fast and ask user for relocation.
- Environment policy:
  - creative-only support now, or survival parity required now.

## Target Behavior
For `build <prompt>`:
1. Bot scans nearby terrain and computes viable build sites.
2. Bot sends ranked site data + concise terrain context to backend.
3. AI returns phased actions with explicit prep and build phases.
4. Executor runs deterministic local adaptation rules:
   - if ground is uneven, flatten/fill first,
   - if path blocked, reroute or micro-clear,
   - if repeated failure, request patch plan with failure digest.
5. Build completes or exits with explicit reason and recovery hints.

## Architecture Changes
### 1) Rich Bot Context v2
Add a bot-side context module (new file suggestion: `apps/bot/world-context.js`) to compute:
- `terrainProfile`: height variance, liquid count, replaceable/solid ratios, flatness score.
- `anchorCandidates`: top N candidate origins with score breakdown.
- `hazards`: lava/water/cactus/fire counts in footprint.
- `reachability`: short probe outcomes (path success/fail + estimated travel cost).
- `failureDigest`: last K execution failures with normalized reason codes.

Wire into `buildAiContext(...)` in `apps/bot/command-router.js`.

### 1.1) Tier-Aware Decision Policy
Decision-engine behavior must read both:
- `getTierFeaturePolicy(tier)` for hard build/edit limits,
- `getTierAiPolicy(tier)` for context/request token budgets.

Add a new helper (new file suggestion: `apps/bot/decision-tier-policy.js`) that derives execution budgets:
- `maxScanRadius`
- `maxAnchorCandidates`
- `maxPrepEdits`
- `maxPrepVolume`
- `maxReplanAttempts`
- `maxPathRetriesPerStep`
- `allowAggressiveRecovery` (dig/reroute intensity)

Recommended default profile:
- `free`: scan radius `8`, anchors `2`, prep edits `<= 64`, prep volume `<= 512`, replans `1`.
- `starter`: scan radius `12`, anchors `4`, prep edits `<= 256`, prep volume `<= 2,000`, replans `2`.
- `pro`: scan radius `16`, anchors `6`, prep edits `<= 1,000`, prep volume `<= 8,000`, replans `3`.
- `admin`: scan radius `24`, anchors `8`, prep edits `<= 3,000`, prep volume `<= 20,000`, replans `4`.

All values must be clamped under tier hard caps (`maxBlocksPerBuild`, `maxBuildVolume`) before execution.

### 2) Instruction Schema v2
Extend `apps/shared-utils/instruction-schema.js` with controlled new action types:
- `prepare_site` (semantic phase marker),
- `flatten_area` (`x`, `y`, `z`, `width`, `length`, `targetY`, `fillBlock`),
- `clear_volume` (`x`, `y`, `z`, `width`, `height`, `length`),
- `ensure_access` (`x`, `y`, `z`, `radius`).

Keep backward compatibility with existing plan payloads.

### 3) Deterministic Decision Engine
Add a small state machine (new file suggestion: `apps/bot/decision-engine.js`):
- `PRECHECK`
- `SITE_SELECTION`
- `SITE_PREP`
- `BUILD_EXECUTION`
- `VERIFY`
- `PATCH_REPLAN` (bounded)
- `DONE` / `FAILED`

Use this engine from `apps/bot/command-router.js` instead of calling `executeCommands(...)` directly for builds.

State guards must be tier-aware:
- reject or down-scope site prep if prep budget exceeds tier policy,
- cap retry/replan loops by tier,
- downgrade to conservative fallback plan when budget is exhausted.

### 4) Adaptive Executor
Refactor `apps/bot/execute-commands.js` so actions can spawn corrective sub-actions:
- place failure due to no support -> enqueue fill/support action.
- path timeout -> enqueue alternate approach waypoint.
- obstructed target -> enqueue clear/dig action (bounded).

Add standardized error codes in logs:
- `ERR_NO_SUPPORT`
- `ERR_PATH_TIMEOUT`
- `ERR_TARGET_OBSTRUCTED`
- `ERR_INVENTORY_MISSING`
- `ERR_UNREACHABLE`

### 5) Backend Prompt + Validation Updates
In `apps/api/core/logic/ai-get-structure.js`:
- adjust planner/executor prompts to consume `terrainProfile` and `anchorCandidates`,
- require explicit site-prep actions when flatness score is below threshold,
- require phasing tags such as `phase:prep`, `phase:build`.

In `apps/api/core/logic/build-validator.js`:
- validate bounds and safety for new action types,
- cap expensive prep operations by tier policy.

### 6) Mineflayer/Pathfinder Capability Mapping
Use package-supported primitives directly in the engine design:
- Terrain scan: `bot.blockAt`, `bot.findBlocks`, `bot.findBlock`.
- Safe block edits: `bot.canDigBlock`, `bot.dig`, `bot.placeBlock`, `bot.equip`.
- Path execution: `bot.pathfinder.setMovements`, `bot.pathfinder.setGoal`, `bot.pathfinder.goto`, `bot.pathfinder.stop`.
- Path status introspection: `bot.pathfinder.isMoving`, `isMining`, `isBuilding`, plus `path_update`, `path_reset`, `goal_reached`, `path_stop` events.
- Reachability scoring: `bot.pathfinder.getPathTo(...)` / `getPathFromTo*(...)` for low-cost candidate-anchor probing before full execution.
- Goal selection by use case:
  - coarse navigation: `GoalNear`, `GoalNearXZ`,
  - precise adjacency for placements: `GoalGetToBlock`,
  - exact stand target: `GoalBlock`,
  - moving target behavior: `GoalFollow`,
  - multi-option anchors: `GoalCompositeAny`.
- Movement tuning with `Movements`:
  - `canDig`, `allow1by1towers`, `allowParkour`, `allowSprinting`,
  - `allowEntityDetection`, `entitiesToAvoid`, `blocksToAvoid`,
  - `exclusionAreasStep`, `exclusionAreasBreak`, `exclusionAreasPlace`.

Engine should maintain two movement profiles:
- `scoutMovements`: low-risk probing (`allowParkour=false`, conservative dig/place costs),
- `buildMovements`: execution profile tuned by tier budget and recovery mode.

## Implementation Phases
### Phase 1 (MVP: safer context + site prep)
- Add `world-context.js` with terrain scan and candidate anchors.
- Add `decision-tier-policy.js` and wire tier-derived budgets into build runtime.
- Extend build request context payload in `command-router`.
- Add `flatten_area` + `clear_volume` schema + validator support.
- Implement executor handlers for new actions.
- Add unit tests for schema normalization and executor behavior.
- Add regression checks that decision-engine paths do not bypass existing authz/tier gating contracts.

Acceptance:
- bot can flatten a small build pad before placing structure,
- build succeeds on uneven terrain cases that currently fail.

### Phase 2 (Adaptive execution + patch replans)
- Add decision-engine state machine and bounded replan loop.
- Add failure digest plumbing into API context.
- Add patch-plan mode in `/ai-get-structure` prompt contract.
- Persist and expose failure reason metrics.
- Add dynamic movement-profile switching (`scoutMovements` <-> `buildMovements`) based on `path_reset`/failure codes.
- Ensure patch-plan requests reuse the same authenticated identity + server-derived tier resolution path.

Acceptance:
- repeated path/build failures trigger patch-replan automatically,
- execution recovers in obstacle-heavy scenarios without manual restart.

### Phase 3 (Optimization + rollout safety)
- Add feature flag: `BOT_DECISION_ENGINE_V2`.
- Canary by usage key/tier.
- Add dashboard counters for prep actions, replans, success-after-replan, token deltas.
- Tune budgets so richer context does not break tier token caps.

Acceptance:
- improved completion rate with bounded token/cost increase,
- no safety regressions in validator or quota behavior.

## Test Plan
Add/expand tests:
- `tests/instruction-schema.test.js`: new action normalization + backward compatibility.
- `tests/build-validator.test.js`: safety constraints for prep actions.
- `tests/bot-execute-commands.test.js`: adaptive sub-actions and retry behavior.
- `tests/ai-context.test.js`: terrain/anchor/failureDigest inclusion and truncation behavior.
- New tests for tier decision budgets (prep volume/retries/replans clamped by tier).
- New tests for pathfinder event-driven adaptation (`path_update`, `path_reset`) and fallback behavior.
- New integration test: uneven terrain build scenario with successful prep + build.
- Security regression carry-forward:
  - `tests/ai-routes-security.test.js` coverage remains valid with patch-plan/retry flow.
  - `tests/bot-ws-routing.test.js` coverage remains valid with new command types.
  - Add a test that replan attempts cannot elevate tier/permissions via payload overrides.

## Metrics To Track
- `build_success_rate`
- `build_partial_failure_rate`
- `avg_replans_per_build`
- `avg_site_prep_actions_per_build`
- `avg_executor_attempts`
- `context_tokens_before_after_v2`
- `cost_per_successful_build`

## Risks and Guardrails
- Risk: token growth from richer context.
  Mitigation: summarize/quantize terrain into compact scalar stats + top-N anchors.
- Risk: over-aggressive terrain edits.
  Mitigation: strict prep bounds by tier and max edit volume.
- Risk: looping retries.
  Mitigation: bounded state transitions and max patch-replan attempts.
- Risk: schema drift across bot/API.
  Mitigation: shared schema module and contract tests.
- Risk: security regression while adding adaptive control flow.
  Mitigation: preserve audited auth/tier/WS constraints and extend existing security test suite before rollout.

## First Execution Slice (Recommended)
Implement in this order:
1. `decision-tier-policy.js` + `world-context.js` + `command-router` context/budget wiring.
2. `flatten_area` action support in schema, validator, executor (with tier clamping).
3. Basic pre-build site prep invocation for `build` commands using `GoalNear/GoalGetToBlock`.
4. Tests for uneven-ground success path and tier budget enforcement.

## Reference APIs
Validated against installed deps:
- `mineflayer@4.30.0`
- `mineflayer-pathfinder@2.4.5`

Primary references:
- Mineflayer API docs (`bot.blockAt`, `findBlocks`, `canDigBlock`, `equip`, `dig`, `placeBlock`):
  - local: `node_modules/mineflayer/docs/api.md`
  - upstream: <https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md>
- Mineflayer-pathfinder API (`goto`, `setGoal`, `setMovements`, `Movements`, events, goals):
  - local: `node_modules/mineflayer-pathfinder/readme.md`
  - upstream: <https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md>
- Mineflayer-pathfinder type surface (`Pathfinder`, goal classes, movement properties):
  - local: `node_modules/mineflayer-pathfinder/index.d.ts`
  - upstream: <https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/index.d.ts>
