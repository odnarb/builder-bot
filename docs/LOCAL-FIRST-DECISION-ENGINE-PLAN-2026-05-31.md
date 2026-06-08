# Local-First Decision Engine Plan
Date: 2026-06-07

## Goal
BuilderBot should use local code first.

Use AI only when local code cannot make a good build plan.

In simple words:

- local code should pick the build spot,
- local code should prepare the area,
- local code should place blocks,
- local code should check the result,
- AI should help with harder or more creative prompts.

## What Already Exists
- `apps/bot/world-context.js`
  - checks nearby terrain and possible build spots.
- `apps/bot/decision-engine.js`
  - runs the build steps.
- `apps/bot/execute-commands.js`
  - moves the bot and places blocks.
- `packages/prompt-parser/index.js`
  - understands simple prompts.

## Simple Flow
1. Try local parsing first.
   - Example: `10x4 stone floor`.
   - Example: `8 by 2 wooden bridge`.
2. If local parsing works, make a local build plan.
3. Pick a safe build spot.
4. Clear or flatten the area if needed.
5. Build the blocks.
6. Check for common failures.
7. Ask AI only if local code is not enough.

## What Local Code Should Handle
- floors,
- platforms,
- bridges,
- paths,
- walls,
- pillars,
- towers,
- stairs,
- simple houses,
- simple farms,
- gardens,
- doors and windows,
- tunnels and arches.

## What AI Should Handle
AI should handle prompts that are too open-ended for simple local rules.

Examples:

- styled castles,
- complex gardens,
- decorative builds,
- prompts with unclear sizes or shapes.

## What We Are Not Building Here
- no giant planning engine,
- no custom pathfinding engine,
- no huge world dump sent to AI,
- no slow search over many possible builds.

## Guardrails
- If local code is unsure, return `null` and ask AI.
- Keep tier limits in `decision-tier-policy.js`.
- Keep API tier checks server-side.
- Keep final block limits enforced by the executor.
- Add tests when adding new local templates.

