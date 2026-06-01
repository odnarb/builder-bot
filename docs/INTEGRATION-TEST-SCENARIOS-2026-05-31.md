# Integration Test Scenarios
Date: 2026-05-31

These are scripted manual scenarios for a real Minecraft server or local test world. Unit tests cover the core logic; these scenarios cover Mineflayer, chunk state, pathfinder behavior, and live service wiring.

Current status: not automated in this repository. Execution requires a live Minecraft server, bot credentials/runtime env (`MC_HOST_IP`, `MC_HOST_PORT`, `MC_HOST_VERSION`, `COMMANDER_UUID`), and a disposable test world.

## Local Template Build, Flat Terrain
- Start bot in creative mode.
- Run: `build 8 by 2 wooden bridge`
- Expected:
  - No `/api/ai-get-structure` request.
  - Bot chooses a local anchor.
  - Bot prepares site and places 16 oak planks.
  - Build history records `source: local`.

## Local Template Build, Uneven Terrain
- Place bot near terrain with 1-3 block height variation.
- Run: `build 6 by 4 stone platform`
- Expected:
  - Local planner is used.
  - `flatten_area` and optional `clear_volume` run before placement.
  - Build succeeds or fails with structured prep/path reason.

## AI Fallback
- Run: `build a small fantasy garden gazebo with a fountain`
- Expected:
  - Local planner returns no plan.
  - `/api/ai-get-structure` is called.
  - AI plan is validated, tier-gated, offset, and executed.

## Path Failure and Patch Replan
- Put the bot behind a simple obstacle or unreachable initial route.
- Run a small build prompt that needs movement.
- Expected:
  - Executor logs `ERR_PATH_TIMEOUT` or `ERR_UNREACHABLE`.
  - Decision engine emits `PATCH_REPLAN`.
  - Patch plan is bounded by tier limits.

## Tier Limit Rejection
- Use Free tier.
- Run: `build 20x20 stone floor`
- Expected:
  - Local plan may be generated.
  - Command router rejects before execution due to `maxBlocksPerBuild`.
  - No world edits occur.

## Command Block Policy
- As Free/Starter, request a plan containing `minecraft:command_block`.
- Expected:
  - Validator rejects command block.
  - Security audit event records `command_block_denied`.
- As Pro/Admin in a controlled world, verify the validator allows command block placement only when tier policy allows it.

## WebSocket Control
- Connect dashboard/Electron app with valid token and allowed origin.
- Send a raw build prompt through WebSocket.
- Expected:
  - Message resolves to `build <prompt>`.
  - Unauthorized token/origin is rejected.

## Persistence and Ops
- Run one successful build and one failing build.
- Expected:
  - Build history records both.
  - Build logs include decision-engine state events.
  - Ops alerts show persistence fallback if Firestore is unavailable.
