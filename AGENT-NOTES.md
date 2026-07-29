# Agent Notes

## 2026-07-29 Git Bash Local Stack

- No local or remote `dev` branch exists, so this bugfix was branched from an updated `main`.
- Windows VS Code terminals now default to the detected Git Bash profile. The local-stack task bypasses task shells, opens Windows Terminal tabs with Git Bash explicitly, and delegates each service back into the originating WSL distro.
- Live verification opened the corrected tabs and confirmed ports `25565`, `3001`, `5173`, and `3002` were listening.
- Automated verification: `npm test` passes 203 tests; architecture, protected-route, and secret checks pass.
- The dependency security audit still fails on the pre-existing advisories recorded in `AGENT-ISSUES.md`.

## 2026-07-28 Decision Engine Reliability

- Implemented shared validation, relative-coordinate verification, cumulative mutation accounting, terminal failure classification, conservative local parsing, footprint-aware site screening, material preflight, and bounded patch context.
- Automated verification: `npm test` passes 195 tests; architecture, route-security, and secret checks pass.
- Human follow-up needed: run the plan's Paper/Mineflayer smoke matrix on a disposable world before treating terrain mutation and obstacle recovery as production-proven.

## 2026-06-27 Local Firestore Emulator

- Verified the Firestore emulator starts locally with Firebase CLI when `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`.
- Verified `@google-cloud/firestore` can write/read/delete against `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
- Verified `PRE_SCALE_PERSISTENCE_MODE=firestore` enables the repo economics persistence path against the emulator.

## 2026-06-07 Branching Note

- Repo instructions say to create new code branches from `dev`, but no local or remote `dev` branch exists.
- Available branches checked: local `main`, current `free-for-all`, remote `origin/main`.
- Proceeding from updated `main` for `features/hosted-billing-local-db-switch`.

## 2026-06-01 UX Self-Critique

What simplified:
- The UI now has one desktop shell and one screen router instead of many independent panels with mismatched visual rules.
- Reused backend and Electron contracts directly instead of introducing another UI data layer.
- Removed the old localization wrapper from the visual tree so the redesign could land without carrying stale UI structure forward.

Friction removed:
- Launch settings, bot state, connection state, and account tier are visible from the main workspace.
- Build prompting, console output, history, and settings are reachable through stable navigation instead of scattered page sections.
- Community and admin workflows now sit inside the same app shell as the core bot controls.

Interaction improvements:
- Primary actions are grouped near the forms they affect.
- Status pills make bot, socket, build, and incident states easier to scan.
- Build history supports selecting a build and reading the detailed JSON without leaving the page.

Visual hierarchy adjustments:
- The title bar carries global state and account actions.
- The sidebar owns navigation and keeps the main screen focused on the active workflow.
- Panels use restrained borders and darker fields to separate operational data without returning to the old card-heavy composition.

What would confuse a first-time user:
- The Console screen still depends on WebSocket event shapes and does not yet explain absent logs.
- Some admin snapshots are raw JSON because the operator drilldowns are not fully designed.
- Localization was removed with the old shell and needs a redesigned selector and copy pass.

What a power user wants next:
- Faster command history and prompt reuse.
- Richer build telemetry aggregates with saved filters.
- Admin drilldowns for usage, margin, abuse, security, and incident workflows.
- Console streaming from Electron child-process stdout and stderr.

What still feels unpolished:
- The UI follows the Figma direction, but exact visual fidelity needs human design review.
- Marketplace and phrase-pack creation are functional but sparse.
- Packaged Electron behavior needs validation on a built desktop artifact, not only Vite.
