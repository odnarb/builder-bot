# Local-First Decision Engine Reliability Plan

Last reviewed: 2026-07-28

Status: implementation in progress. The safety-critical Phase 0 slice and selected Phase 1-2 reliability work were implemented on 2026-07-28; real Paper/Mineflayer smoke coverage and Phase 3 persistence work remain.

This plan replaces the older aspirational description with a code-verified reliability plan. The detailed plan under `docs/archive/BUILD-DECISION-ENGINE-PLAN-2026-02-21.md` remains historical; much of its first implementation phases already shipped.

## Implementation Progress

| Area | Status |
|---|---|
| Shared validation | Implemented for local, AI, patch, and WebSocket plans, including prep fill-block policy. |
| Coordinates | Relative AI examples fixed; chat and WebSocket plans offset once at execution and verification retains relative plus world targets. |
| Mutation limits | One ledger now spans prep, overwrite digs, support writes, initial execution, and patches. Requested initial-plus-patch placement/volume limits are cumulative. |
| Verification | `DONE` requires expected placement read-back. Movement-only patches cannot complete unresolved placement work. |
| Failure handling | One bounded local placement retry runs before AI repair; completed placement targets cannot be replayed; terminal material, mutation, prep, and internal execution failures do not trigger AI repair; repeated no-progress signatures stop. |
| Local planning | Ambiguous styles, unsupported explicit materials, oversized dimensions, and fluid templates no longer silently degrade. |
| Site selection | Local templates use their real footprint, reject unloaded/hazard/container/entity-occupied candidates, enforce a score threshold, and bound path probes. |
| Prep/materials | Safe flat sites skip redundant prep; prep failures stop later actions; materials are verified before terrain mutation. |
| AI context | Caller identity/policy is stripped and server capabilities plus bounded terrain/anchor/failure observations reach the model snapshot. |
| Still pending | Completed/remaining modeling for non-placement actions, current-policy refresh during long runs, logical persistence parity, honest pre-scale event naming, and real server smoke tests. |

## Goal

BuilderBot should prefer deterministic local planning when it can understand a prompt with high confidence, use the existing AI route only when needed, and report success only after the expected Minecraft world state is verified.

Priority order:

1. world safety and policy correctness,
2. verified build correctness,
3. clear recovery and failure behavior,
4. completion speed,
5. AI/token cost.

“Local-first” describes the planning strategy. It is separate from local versus hosted distribution mode:

- local planning can run in either distribution mode,
- AI fallback requires an OpenAI configuration,
- hosted AI calls must retain authentication, subscription, rate, and usage enforcement.

## Non-Negotiable Invariants

- Every plan source uses the same normalization and validation rules: local parser, AI, patch replan, and WebSocket instruction plan.
- All plan coordinates are relative to one frozen build anchor. World coordinates are calculated exactly once at the execution boundary.
- Tier, identity, billing, and hard policy are server-derived for AI calls. Caller context is observational only.
- Safety rules are universal. A higher tier may increase bounded capacity, but must not permit blocked blocks or unsafe world edits.
- One build has one cumulative mutation ledger across initial execution, support blocks, prep, retries, and patches.
- Every dig, fill, overwrite, support placement, and requested placement is charged to the applicable remaining budget.
- Prep or policy failure stops later destructive/build actions in that attempt.
- `DONE` means read-back verification passed. A successful API call or Mineflayer method call is not sufficient.
- Replans are bounded by count, remaining mutation budget, remaining time, and existing API quotas.
- Existing WebSocket loopback binding, token authentication, origin allowlisting, and single-flight execution remain intact.
- Persistence and telemetry failures must not change the execution result.
- Do not add a second decision service, a custom pathfinder, or one-use abstraction layers.

## Verified Runtime Today

The current chat build path is:

1. `apps/bot/command-router.js` receives a build prompt under a single-flight guard.
2. `apps/bot/local-decision-planner.js` tries `packages/prompt-parser` first.
3. Unknown prompts call the existing authenticated `/ai-get-structure` route.
4. The bot normalizes the returned plan and offsets all coordinates from the original bot position plus `BUILD_START_OFFSET`.
5. `apps/bot/decision-engine.js` coordinates execution and bounded AI patch attempts.
6. `apps/bot/execute-commands.js` runs prep, movement, and placement actions sequentially.
7. Attempt logs and a final decision summary are saved on a best-effort basis.

The WebSocket `instruction_plan` path now shares normalization, tier validation, coordinate offsetting, the decision engine, cumulative mutation accounting, and verification.

## Implementation Reality

| Capability | Current state | Evidence and limitation |
|---|---|---|
| Local parser before AI | Conservative baseline implemented | Known templates stay local; ambiguity, unsupported explicit materials, oversized dimensions, and fluid templates fall back or reject. More grammar coverage is intentionally deferred. |
| Terrain and path context | Delivered end to end | Bounded terrain, anchors, hazards, reachability, and failures survive the model snapshot; AI final anchoring is still pending. |
| Site selection | Footprint-aware for local templates | Candidate scoring uses the actual local structure footprint, a minimum score, protected-content/entity checks, and bounded path probes. |
| Prep actions | Cumulative and conditional | Prep shares one ledger, halts on hard failure, fills below the placement plane, and is skipped on already-safe terrain. |
| Tier decision policy | Safer, still partially aligned | Bot policy now carries canonical block/volume limits; unused context/aggressive-recovery fields and server prep defaults still need consolidation. |
| State machine | Coordinator with real verification | `VERIFY` now reflects read-back results; site selection still occurs in the local planner rather than inside the engine coordinator. |
| Patch replan | Bounded and fail-closed | It receives relative remaining targets/budgets, honors cumulative caps, blocks terminal repair, and stops repeated no-progress signatures. Completed-action modeling remains partial. |
| Standard failure codes | Implemented and classified | Terminal inventory, mutation, prep, and internal failures stop without AI repair. |
| Post-build verification | Implemented baseline | Every expected placement is read back; target-level local recovery and real-server validation remain. |
| Decision telemetry | Partial | Process counters and a per-build summary exist, but plan generation is also reported as build success before Minecraft execution. |
| Tests | Expanded regression baseline | Automated tests cover fill-block policy, ingress behavior, cumulative budgets, fail-closed prep/materials, footprint checks, verification, movement-only patches, and terminal recovery. Real server obstacle recovery remains. |

## Original Confirmed Gaps

These code-audit findings are retained for traceability. The progress table above identifies what this implementation closed and what remains.

### P0: Safety and Contract Correctness

1. **Not every execution ingress is validated.**
   - AI plans pass the server validator.
   - Local plans only receive a placement-count check.
   - WebSocket instruction plans call `normalizeInstructionPlan` and then execute without build-volume, command-block, or tier validation.
   - The executor itself has no final placement or command-block guard.

2. **Prep fill blocks bypass blocked-block checks.**
   - `build-validator.js` applies blocked/command-block policy to `place_block.block`.
   - `flatten_area.fillBlock` can contain the same block IDs but is not checked by that policy.

3. **The coordinate contract contradicts itself.**
   - The AI prompt says coordinates are relative.
   - Its prep examples use absolute-looking Y values such as 64 and 65.
   - The bot offsets every coordinate action again, which can move model-following prep far above the intended site.

4. **Prep and placement limits are not cumulative.**
   - Remaining prep edits are forced back to at least eight for each prep action.
   - Auto-support, overwrite digs, and support placements are not all charged.
   - Initial and patch placement counts are checked independently.
   - A build can therefore mutate more blocks than its configured cap.

5. **AI context authority and context delivery are incomplete.**
   - Caller-provided `context.identity` reaches the model even though route enforcement correctly uses the persisted server tier.
   - Terrain, anchor, hazard, reachability, failure, and decision data are computed by the bot but omitted from the compact AI snapshot.

### P1: Local Planning and Execution Reliability

1. **The parser is not conservative enough.**
   - Broad keyword matches can reduce a styled/complex prompt to a simple template.
   - Unknown materials can silently become cobblestone.
   - Oversized dimensions can be silently clamped.
   - Farm/garden templates can emit water, while the current item-placement executor cannot reliably place it.

2. **The selected site is not proven safe for the planned footprint.**
   - Candidate feasibility is fixed-size rather than structure-size.
   - Unloaded cells and fluid/support semantics are incomplete.
   - Containers, known blocked blocks, nearby players/entities, and a minimum score are not enforced.
   - AI shapes are still anchored from the original bot position rather than a locally frozen safe anchor.

3. **Prep is unconditional and can be wasteful.**
   - Local plans flatten even already-flat ground.
   - The fill plane overlaps the lowest placement plane, creating blocks that may immediately be replaced.
   - Prep failure does not stop subsequent plan actions.

4. **Movement retries do not adapt.**
   - `move_to` sets a goal once, then waits repeatedly.
   - It does not reissue the goal, use path reset/status evidence, choose another approach, or enforce one attempt-wide deadline.

5. **Material mode is implicit.**
   - The runtime assumes creative/op access and falls back to `/give`.
   - Tests mock a creative material method that is not the real Mineflayer inventory API.
   - Inventory clearing/provisioning is not verified before mutation starts.

6. **`VERIFY` is not verification.**
   - A placement call can report success without a later block read.
   - A patch containing only a successful movement action can make an incomplete build appear successful.

### P2: Recovery, Lifecycle, and Observability

1. Patch context lacks relative failed targets, completed actions, remaining actions, and expected-versus-observed state.
2. AI repair is attempted for terminal failures such as policy denial, depleted budget, missing inventory, or an internal throw.
3. Every patch is another fully metered AI request, but this quota behavior is not explicit in the product contract.
4. Bot auth and tier are captured early; a long run can use stale local policy while a patch request resolves current server policy.
5. Firestore and SQLite build updates store decision summaries in different document shapes.
6. Pre-scale “build success” currently means successful plan generation, not verified Minecraft execution.

## Target Flow

```text
build prompt
  -> conservative local parse OR authenticated AI shape plan
  -> normalize
  -> validate relative shape
  -> derive exact structure footprint
  -> locally choose and freeze one safe anchor
  -> add only necessary bounded prep
  -> validate the final plan against shared policy and remaining budgets
  -> material/runtime preflight
  -> execute under one cumulative mutation/time ledger
  -> read back expected world state
       -> verified: DONE
       -> retryable local mismatch: retry failed actions once
       -> recoverable remaining work: validated bounded AI patch
       -> terminal/policy/budget failure: FAILED
```

The AI should generate relative structure intent. Local code should own final anchor selection, coordinate conversion, safety checks, and world mutation.

## Ownership Boundaries

- `apps/bot/command-router.js`
  - command/session orchestration and user-facing status only,
  - no duplicate policy math.
- `apps/bot/decision-engine.js`
  - attempt lifecycle, cumulative ledger, failure classification, and bounded recovery,
  - keep it a small coordinator.
- `apps/bot/local-decision-planner.js`
  - deterministic prompt-to-relative-shape compilation,
  - no unverified world mutation.
- `apps/bot/world-context.js`
  - bounded footprint-aware observations and anchor candidates.
- `apps/bot/execute-commands.js`
  - world mutation, exact mutation accounting, structured action outcomes.
- `apps/shared-utils/instruction-schema.js`
  - one canonical action/coordinate shape.
- `apps/core/contracts/tier-policy.js`
  - canonical tier and decision budgets used by bot and API.
- `apps/core/logic/build-validator.js`
  - one policy gate reused for every plan source.
- `apps/core/logic/ai-context.js`
  - explicit allowlisted model context with only server-resolved capabilities needed for planning and bounded decision observations.

Prefer extending these modules. Extract a helper only when it is reused by multiple runtime paths or independently testable business logic.

## Delivery Plan

### Phase 0: Close Safety, Coordinate, and Truthfulness Gaps

Work:

1. Put canonical decision budgets beside the existing tier contracts and consume the same resolved policy in bot validation and server validation.
2. Extend the existing validator to apply blocked-block and command-block rules to every block-bearing field, including `flatten_area.fillBlock`.
3. Run the same validator immediately before execution for local, AI, patch, and WebSocket plans.
4. Define one coordinate contract:
   - plans store relative coordinates,
   - examples use relative Y values such as 0 and 1,
   - one frozen anchor is stored with the run,
   - offsetting occurs once,
   - logs retain action index, relative target, and optional world target.
5. Add a run-scoped ledger for remaining placement writes, support writes, destructive/prep edits, prep volume, replans, and wall-clock time.
6. Charge every mutation and stop before an operation that would exceed the remaining budget. Reject an initial plan or patch before execution when its requested placements or build volume exceed the original run cap or remaining allowance.
7. In the API, drop caller-supplied identity, tier, and policy context. Add only the server-resolved capabilities needed by the model and allowlist a bounded `decision` observation section.
8. Carry terrain summary, bounded anchor summary, hazards, reachability, and failure digest through `buildContextSnapshot`.
9. Add minimum read-back verification for every expected placement target. Do not emit `DONE` unless all expected blocks match; retain a compact mismatch set for later recovery work.

Acceptance:

- A free-tier `flatten_area` using a command block is rejected.
- The same invalid plan is rejected through chat/local, AI, patch, and WebSocket ingress.
- A second prep action cannot edit after the build-wide prep budget reaches zero.
- A terminal prep, policy, or budget failure prevents every later action in that attempt.
- Auto-support and overwrite mutations appear in the same ledger.
- Initial plus patch mutations cannot exceed the original run budget.
- Cumulative initial-plus-patch requested placements and build volume cannot exceed the original run cap.
- Relative plan coordinates produce the same intended world targets for initial and patch attempts.
- Caller identity and policy fields are not sent to the model; only server-resolved planning capabilities are included.
- Terrain and failure context reach the model snapshot within the tier context budget.
- A no-op/ghost placement cannot produce `DONE`; read-back mismatch produces a non-success result.

### Phase 1: Make Local Planning Conservative and Site-Aware

Work:

1. Make parser decisions explicit:
   - supported material and grammar -> deterministic plan,
   - ambiguous style or unsupported material/action -> `null` and AI fallback,
   - invalid/oversized dimensions -> clear rejection rather than silent substitution or truncation.
2. Disable fluid-dependent templates until fluid placement has an explicit safe action and executor support.
3. Generate/receive the relative structure before final site selection so the real width, height, and length are known.
4. Score candidate sites against that footprint plus a small access margin.
5. Reject unloaded, fluid/hazardous, container-bearing, known-blocked, or below-threshold candidates.
6. Cheaply rank candidates first, then path-probe no more than the policy limit under one scan deadline.
7. Freeze the selected anchor for the entire run, including AI patches.
8. Add prep only when observed terrain requires it:
   - support plane below the lowest placement,
   - clear only occupied headroom,
   - no destructive edits outside the allowed footprint/access margin.
9. Make creative/op mode an explicit MVP precondition, use supported Mineflayer inventory operations, and verify required materials before prep begins.
10. Route valid WebSocket instruction plans through the same anchor, preflight, decision-engine, ledger, and verification path instead of calling the executor directly.
11. Make state names honest: attach real work to `PRECHECK`, `SITE_SELECTION`, `SITE_PREP`, and `VERIFY`, or remove the ceremonial states. Do not add more states.

Acceptance:

- Known, unambiguous templates complete without an AI request.
- Styled/ambiguous prompts do not silently collapse to an unrelated simple template.
- Flat, empty ground does not trigger redundant flatten/fill work.
- A hazard outside the old 5x5 center but inside a large structure footprint rejects that anchor.
- Candidate probe count and scan duration stay within policy.
- No safe candidate returns a clear failure/relocation response before world mutation.
- Material preflight fails clearly without clearing inventory or modifying terrain.
- A valid WebSocket plan receives the same safety, budget, execution, and verification behavior as a chat build.

### Phase 2: Add Real Verification and Bounded Recovery

Work:

1. Return structured per-action outcomes from the executor:
   - action ID/index,
   - relative and world target,
   - mutations consumed,
   - failure code,
   - expected and observed block where relevant.
2. Stop an attempt on hard prep, policy, budget, or runtime-precondition failures.
3. Extend Phase 0 read-back into target-level mismatch outcomes that bounded recovery can consume.
4. Retry only locally recoverable failed actions once before spending an AI request.
5. Reissue or replace movement goals on retry; use path status/reset evidence and one attempt deadline.
6. Classify errors:
   - retryable locally,
   - eligible for AI repair,
   - terminal.
7. Send AI repair only the original relative intent, frozen anchor summary, remaining actions, mismatch/failure digest, and remaining budgets.
8. Require a patch to repair the failed remainder rather than replay the full build.
9. Revalidate patches against current server entitlement and the most restrictive of the run-start and current policy.
10. Keep the existing AI endpoint and its auth/subscription/rate/usage gates. Document that each patch is a metered request unless product policy deliberately changes.
11. Stop when a patch makes no progress, repeats the same failure signature, exceeds the deadline, or exhausts any budget.

Acceptance:

- A ghost/no-op placement is caught by read-back verification.
- A patch containing only movement cannot mark missing blocks complete.
- Missing inventory, policy denial, and exhausted budget do not trigger AI repair.
- A recoverable obstruction can succeed through a bounded local retry or minimal patch.
- Completed actions are not repeated by a patch.
- Tier downgrade/token or route-quota denial during a run stops safely with a human-readable reason.

### Phase 3: Persist Honest Outcomes and Prove the Flow

Work:

1. Normalize one logical build-run contract across SQLite and Firestore without requiring identical storage topology:
   - run/build ID,
   - plan source and policy version/tier,
   - frozen anchor and coordinate-frame version,
   - attempts and patch count,
   - actual mutation totals,
   - verification totals/mismatches,
   - terminal reason,
   - AI call/token/cost totals.
2. Separate events:
   - `plan_generated`,
   - `execution_started`,
   - `execution_attempt_finished`,
   - `verification_finished`,
   - `build_finished`.
3. Count “build success” only from verified `build_finished`.
4. Persist a compact failure digest while keeping detailed logs bounded.
5. Add fixture-based orchestration tests before adding dashboard UI.
6. Add a small Paper/Mineflayer smoke matrix for:
   - flat local build,
   - uneven terrain,
   - obstruction with local recovery,
   - no safe anchor,
   - AI fallback,
   - successful patch,
   - quota/auth failure during recovery.
7. Tune budgets only from measured traces.

Acceptance:

- Local and hosted persistence expose the same logical run/event contract, even when their storage topology differs.
- One run can be traced from prompt through plan, attempts, verification, and terminal result.
- Plan-generation success cannot inflate Minecraft build-success metrics.
- Automated fixtures cover every Phase 0-2 acceptance condition.
- At least the smoke matrix passes against a real supported Minecraft server version before calling the engine reliable.

## Required Test Additions

| Test area | Required coverage |
|---|---|
| `instruction-schema` / validator | Blocked and command block in every block-bearing field; local/AI/patch/WS parity; relative coordinate examples. |
| `ai-context` / AI route | Decision observations survive truncation; caller identity/policy is stripped; server capabilities and patch context stay bounded. |
| Parser/local planner | Unknown material, decorative ambiguity, oversized dimensions, unsupported fluid template, high-confidence known template. |
| World context | Actual-footprint hazard, unloaded cells, no-safe-anchor threshold, maximum path-probe count, scan deadline. |
| Executor | Exact cumulative edit cap across multiple actions, auto-support accounting, prep-failure halt, movement retry reissue, material preflight. |
| Decision engine | Hard versus retryable errors, no-progress circuit breaker, cumulative initial+patch limits, read-back mismatch, movement-only patch cannot finish. |
| Auth/tier | Persisted tier wins, stale/expired patch auth fails safely, policy change uses the conservative remaining budget. |
| Persistence/telemetry | SQLite/Firestore logical event-contract parity; `plan_generated` is distinct from verified `build_finished`. |
| End to end | Known local success without AI, unknown prompt AI fallback, obstacle recovery, terminal failure without extra mutation. |

## Metrics After Outcome Data Is Trustworthy

- verified build success rate,
- local-plan selection and verified-success rates,
- success after local retry,
- success after AI patch,
- average and maximum mutations by category,
- budget-exhaustion and no-safe-anchor rates,
- planning, scan, execution, and verification latency,
- AI calls/tokens/cost per verified build,
- repeated-failure/no-progress circuit-breaker rate.

Do not build new dashboard panels until the persisted events and success semantics are stable.

## Product Decisions Still Needed

Use conservative defaults until these are decided:

- **Runtime mode:** creative/op-only MVP; survival resource planning is later work.
- **Terraforming:** edits only inside the verified footprint plus a small access margin.
- **Protected content:** do not edit containers, known blocked blocks, unloaded cells, or liquids. Add broader protected-zone behavior only when the runtime has an authoritative zone source.
- **Ambiguity:** ask AI or reject; do not silently substitute materials, style, or size.
- **Recovery:** safety/correctness before fidelity, speed, or AI cost.
- **Patch quota:** keep existing auth, subscription, route, build, and token gates until a different billing policy is explicitly approved.
- **Maximum duration:** add one configured build deadline before increasing retry counts.

## Non-Goals

- Rewriting Mineflayer pathfinding.
- A general-purpose agent framework or larger state machine.
- A new decision-engine API endpoint.
- Sending raw chunks or a giant world dump to AI.
- Survival-mode parity in the first reliability phases.
- More templates before current templates are safe and verifiable.
- Dashboard/UI work before telemetry semantics are correct.
- Pricing, SKU, or tier-name changes.
- Provider-call cost reconciliation; track it as a separate AI metering issue so it does not delay execution safety.
- Changing existing command-block tier eligibility or weakening safety for higher tiers.

## Definition of Reliable

The decision engine is reliable when:

- every ingress is validated by the same policy,
- all coordinates use one tested relative frame,
- all mutations and AI calls stay within cumulative budgets,
- local plans are conservative and footprint-aware,
- terminal failures stop safely,
- recovery works only on actionable remaining work,
- success is based on verified world state,
- one persisted run explains what happened end to end.
