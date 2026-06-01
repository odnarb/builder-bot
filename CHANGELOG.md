# Changelog

## 2026-06-01

- Replaced the Web UI with a Figma-directed desktop control-center shell for Electron and browser use.
- Added redesigned dashboard, launch, build, console, history, community, settings, and admin surfaces in the main Web UI app.
- Removed legacy visual components from `apps/webui/src/components`, keeping the shared API and WebSocket helpers.
- Added BuilderBot theme tokens and layout styling in `apps/webui/src/index.css`.
- Rewired the launch, build, subscription, parental-control, community, marketplace, build-history, and admin views against the existing backend/Electron interfaces.

