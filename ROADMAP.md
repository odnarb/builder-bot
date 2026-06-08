# BuilderBot Roadmap
Date: 2026-06-07

This file explains where the project is going.

For the latest work in progress, read `STATUS.md`.
For old detailed notes, read `docs/archive/ROADMAP.md`.

## What BuilderBot Does
BuilderBot lets a player ask for Minecraft builds in normal language.

Example:

```txt
build a stone tower with windows
```

The system can:

- turn prompts into build plans,
- run a Minecraft bot,
- build blocks in the game,
- show progress in the Web UI,
- save build history,
- enforce user tiers,
- use Stripe for paid hosted plans.

## Main Direction
The next big goal is simple:

- people can run BuilderBot locally for free,
- hosted BuilderBot can ask for payment with Stripe.

This means the app needs two modes:

| Mode | What it is for | Payment | Data |
|---|---|---|---|
| `local` | Open-source users on their own machine | No Stripe | SQLite file |
| `hosted` | The paid hosted service | Stripe | Firestore or hosted DB |

The detailed plan is in `docs/HOSTED-BILLING-AND-LOCAL-DB-PLAN.md`.

## What Works Now
- The bot can connect to Minecraft.
- The API has routes for builds, users, Stripe, admin data, community data, and config.
- The Web UI has screens for launch, build, console, history, community, settings, and admin.
- The local build planner handles many simple builds without AI.
- AI is used when the local planner cannot handle a prompt.
- Build limits and tier rules exist.
- Stripe checkout routes exist.
- Admin and security checks exist.

## What Is Being Built Now
Priority work:

1. Save local settings, sessions, and build history in SQLite.
2. Keep Auth0 required when `BUILDERBOT_DISTRIBUTION_MODE=hosted`.
3. Keep hosted payment checks on the backend.
4. Keep the current tier policy and Stripe SKU names unchanged.
5. Run the full test and security checks before opening a PR.

## Next Code Slice
The next code slice should be local SQLite storage.

Start with local build history and settings.

Do not move every Firestore path at once.

## Later Work
After local/hosted mode is stable:

- improve Electron packaging,
- stream bot logs into the Console screen,
- polish admin screens,
- rebuild localization in the new UI,
- add more local build templates,
- add more real Minecraft test coverage.

## Known Gaps
- Local settings and build history still need a SQLite path.
- Some hosted/economics data still uses Firestore or memory.
- Hosted payment gating is only started on the first cost-heavy route.
- The full test suite has not been run after the newest changes.
- Some admin and community screens are useful but still basic.

## Rules For Future Work
- Keep changes small.
- Do not rewrite all persistence in one PR.
- Do not put payment checks only in React.
- Do not bypass Auth0 in hosted mode.
- Do not store local SQLite files in the repo.
- Do not edit staged files directly. Edit `apps/core`, then run `npm run stage:shared-core`.
- Keep docs honest. Only say local mode is ready after it has been tested.
