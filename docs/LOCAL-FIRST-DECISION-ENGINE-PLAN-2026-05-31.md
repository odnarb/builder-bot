# Local-First Decision Engine Plan
Date: 2026-05-31

## Goal
Use Mineflayer as the primary decision source and use AI only when local code cannot confidently turn a prompt or failure into an executable plan.

The AI should mostly design. The local engine should choose the site, prepare terrain, execute blocks, verify results, and recover from common failures.

## Current Base
The codebase already has the useful primitives:
- `apps/bot/world-context.js` scans terrain, ranks anchors, probes pathfinder reachability, and records failure/path diagnostics.
- `apps/bot/decision-engine.js` runs a bounded build state machine.
- `apps/bot/execute-commands.js` can execute prep, movement, clearing, flattening, support fill, and placement.
- `packages/prompt-parser/index.js` handles simple deterministic structure prompts.

## Simple Architecture
1. Parse locally first.
   - Use known templates for simple structures: floors, platforms, bridges, walls, pillars, towers, stairs, cubes/boxes, and small/medium houses.
   - Parse simple dimensions and materials locally, such as `10x4 stone floor` or `8 by 2 wooden bridge`.
   - Return `null` when confidence is low.
2. Compile locally.
   - Pick the best Mineflayer anchor from `buildDecisionWorldContext`.
   - Convert relative template blocks into the existing command format.
   - Add a small prep phase: `prepare_site`, `ensure_access`, `flatten_area`, `clear_volume`.
3. Execute locally.
   - Let `executeCommands` handle support, obstruction, inventory, and path failures.
4. Recover locally where execution already knows how.
   - Let `executeCommands` handle support, obstruction, inventory, and path retries.
   - Keep failure digests for the bounded patch-replan loop.
5. Ask AI last.
   - Initial AI call happens only when local planning returns `null`.
   - Patch AI calls still use the existing bounded replan loop when executor recovery is not enough.

## Non-Goals
- No complex symbolic planner.
- No long-running local search.
- No custom pathfinding engine.
- No raw world dump sent to AI.

## Context Contract
Continue sending compact, derived facts:
- bot position and survival state,
- inventory summary,
- terrain profile,
- top anchor candidates,
- reachability summary,
- nearby block/entity summaries,
- pathfinder diagnostics,
- failure digest,
- tier-derived decision policy.

## First Implementation Slice
- Add `apps/bot/local-decision-planner.js`.
- Wire `build` command to try local initial plan before AI.
- Add tests for local plan compilation.

## Guardrails
- Keep tier limits in `decision-tier-policy.js`.
- Keep AI route auth and tier derivation unchanged.
- Keep executor edit caps authoritative.
- Keep local planner conservative: if unsure, return `null`.
