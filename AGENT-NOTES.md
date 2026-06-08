# Agent Notes

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
