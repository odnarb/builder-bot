# BuilderBot Dashboard Augmentation Plan
Date: 2026-02-21

TODO: ABOVE ALL ELSE, REMAKE THIS PLAN.. It is far too dense.
Show the logo, and title, show the user logged in and their tier, show the logout button as well.
I want simplicity over density.
Do not make the screen too busy. Offer some simple controls:
A chat box, a send button
A launch/stop button -- that changes state based on if the bot is on or not
Some helper text for things like "your minecraft uuid", like how to find that
Keep the status icon and text: online/offline
Show current state, but only as text and a colored icon like the status: idle, building, thinking/planning, error, etc.
Keep quick buttons like follow, stop, moveto, get bot position, inventory
Show a toggle to show bot chat or not
Show a clock icon for toggling on history:
   previous builds if we can have the bot build from previous steps.


## Why This Plan
The current dashboard works, but the experience is still "developer tooling" in several places and has context drift from product direction:
- `docs/ui-ux.guidelines.md` is mostly generic/copied guidance and not BuilderBot-specific.
- Core dashboard views (`apps/webui/src/App.jsx`, `apps/webui/src/components/ControlPanel.jsx`, `apps/webui/src/components/BotConsole.jsx`, `apps/webui/src/components/BuildHistoryPanel.jsx`) are functional but visually inconsistent and cognitively heavy.
- Rich backend surfaces already exist (`/user/features`, `/user/entitlements`, `/user/overage`, `/user/parental-controls`, `/user/subscription/*`, build history APIs), but the dashboard uses only a small subset.
- Upcoming decision-engine work expects dashboard counters for prep/replan/quality telemetry (`docs/BUILD-DECISION-ENGINE-PLAN-2026-02-21.md`).

Goal: deliver a cleaner, smarter, richer dashboard that works for kids and adults without sacrificing security, performance, or tier-policy integrity.

## Additional Article Inputs (From `docs/ui-ux.guidelines.md`)
Sources now incorporated:
- NN/g web UX study guide (`https://www.nngroup.com/articles/web-ux-study-guide/`).
- Cygnis web app UI/UX best practices 2025 (`https://cygnis.co/blog/web-app-ui-ux-best-practices-2025/`).
- UX Studio trend reference (`https://www.uxstudioteam.com/ux-blog/ui-trends-2019`) for selective ideas only.
- Additional modern UI principles article (`https://medium.com/@ampldm2025/ui-ux-design-principles-for-modern-web-apps-9f50558db091`).
- React UI/icon library comparisons:
  - `https://prismic.io/blog/react-component-libraries` (MUI preference noted),
  - `https://lineicons.com/blog/react-icon-libraries` (react-icons preference noted).

Resulting augmentation to this plan:
- Enforce mobile-first and progressive disclosure as baseline interaction patterns.
- Strengthen hierarchy/proximity/alignment in every panel.
- Replace emoji-led controls with consistent iconography (`react-icons`) + text labels.
- Move toward a theme-driven component system with MUI-first primitives for consistency.
- Keep trend usage intentional; prioritize clarity and accessibility over novelty.

## Product Outcomes
1. First-time users can issue a successful command in under 60 seconds.
2. Users can always understand bot state (offline/launching/online/building/error) at a glance.
3. Build progress and results are understandable without reading raw JSON.
4. Kids get guided, safe, low-friction controls; adults get faster, deeper controls.
5. Tier limits and upgrade value are visible in-context (not only on checkout pages).

## Constraints To Preserve
From security and architecture docs:
- Keep JWT-authenticated flow for user endpoints and AI requests (`docs/SECURITY-AUDIT-PLAN-2026-02-21.md`).
- Keep server-derived tier enforcement; no client-side tier trust.
- Keep WS auth/origin constraints unchanged.
- Do not add dashboard routes that bypass existing admin/user auth middleware.
- Preserve token/cost guardrails and quota semantics from roadmap and pre-scale plans.

## UX Strategy: Built For Kids And Adults
Use one product with two interaction modes, not two separate apps.

### Mode A: Guided (default for new/younger users)
- Prompt chips ("Build a house", "Follow me", "Come here", "Stop").
- Step-by-step command composer with plain-language confirmations.
- Simpler vocabulary and stronger safety copy.
- Fewer simultaneous controls on screen (progressive disclosure).

### Mode B: Advanced (for power users/adults)
- Fast command input + keyboard shortcuts.
- Expandable diagnostics: context size, retries, action phases, failure reasons.
- Bulk controls (retry last build, duplicate build prompt, export artifacts when available).

### Shared requirements
- Same data model, same permissions, same backend contracts.
- User can switch modes anytime; preference persists per user.

## Information Architecture (Dashboard v2)
### 1) Top Status Rail
Always-visible strip with:
- Bot status and connection quality.
- Current tier + usage snapshot.
- Active build phase + last outcome.
- Launch context (Electron vs browser) with clear next actions.

### 2) Primary Workspace (center)
- `CommandComposer`: guided templates + free-form prompt.
- `BuildExecutionCard`: current build timeline (queued -> planning -> prep -> placing -> verify -> done/failed).
- `ActivityFeed`: readable event cards grouped by type, replacing raw mixed log rendering.

### 3) Right Utility Column
- `BuildHistoryPanelV2`: build cards with metadata (status, duration, block count, timestamp) and structured detail tabs (Summary / Steps / Logs / JSON fallback).
- `QuickActions`: context-aware controls (position, inventory, nearby scan, retry build).

### 4) Settings + Safety Drawer
- Parental controls UI wired to `/user/parental-controls`.
- Renewal/subscription controls wired to `/user/subscription/renewal` and ticket flow.
- Accessibility preferences (text scale, reduced motion, contrast mode).

## Visual And Interaction Direction
- Keep dark-space "Minecraft command center" tone, but reduce neon noise and random emoji-heavy UI.
- Introduce a tokenized design foundation (spacing, typography, color roles, radius, elevation).
- Increase consistency in buttons, cards, statuses, and empty/error states.
- Apply strict hierarchy: one primary action per panel.
- Add clear motion only where it explains state change (launching, in-progress build phase, reconnect).
- Standardize icon usage with `react-icons` and always pair icons with clear text labels.
- Enforce touch-friendly controls and spacing for tablet/mobile use.

## Technical Plan By Phase

## Phase 0: Context Realignment (Docs + Decisions)
Deliverables:
1. Replace generic guidance with product-specific UX principles document:
   - add `docs/BUILDERBOT-UX-PRINCIPLES.md`.
   - scope: dashboard language, component hierarchy, accessibility bar, kid/adult mode rules.
2. Add a source-to-decision matrix mapping article principles to dashboard components/states.
3. Decide and lock component strategy:
   - MUI-first component primitives,
   - theme tokens as single source of visual truth,
   - `react-icons` as icon standard.
4. Define event taxonomy for UI states:
   - connection states,
   - build phases,
   - failure reasons,
   - action source (chat/manual/quick action).

Exit criteria:
- Approved IA wireframe and state map.
- No unresolved design-system ambiguity.

## Phase 1: Foundation Refactor (No Major Feature Expansion)
Deliverables:
1. Create reusable UI primitives in `apps/webui/src/components/ui/*` (MUI-backed where practical):
   - `Card`, `StatusBadge`, `SectionHeader`, `EmptyState`, `InlineAlert`, `PrimaryButton`.
2. Add `apps/webui/src/theme/*` for typography, spacing, color, radius, and motion tokens.
3. Replace inconsistent emoji affordances with icon components + accessible labels.
4. Normalize app layout in `apps/webui/src/App.jsx`:
   - responsive shell,
   - stable panel sizing,
   - consistent spacing rhythm.
5. Upgrade `WebSocketProvider` state model:
   - expose `connectionState`,
   - bounded message buffer,
   - typed message normalization before render.

Exit criteria:
- Existing functionality preserved.
- Visual consistency baseline established.

## Phase 2: Core Dashboard UX Upgrade
Deliverables:
1. Replace `PromptInput` with `CommandComposer`:
   - guided presets + free-form input,
   - command validation hints,
   - better placeholder/help text by mode,
   - progressive disclosure for advanced options.
2. Rebuild `ControlPanel` as task-oriented controls:
   - launch/stop cluster,
   - movement cluster,
   - environment scan cluster,
   - disabled-state explanations.
3. Replace `BotConsole` free-form stream with grouped event feed:
   - cards for chat, movement, build, inventory, errors,
   - filter chips,
   - collapse/expand details.
4. Upgrade `BuildHistoryPanel`:
   - summary-first cards,
   - status tags,
   - detail tabs,
   - JSON only as debug fallback,
   - mobile-first card/list behavior before desktop density enhancements.

Exit criteria:
- No raw JSON as primary UX.
- User can complete command -> observe progress -> inspect result in one flow.

## Phase 3: Kid/Adult Personalization + Safety
Deliverables:
1. Add mode toggle and persisted preference (`guided`/`advanced`).
2. Guided mode:
   - templates,
   - simplified labels,
   - confirmation prompts for risky actions,
   - step progress indicators so users know where they are.
3. Advanced mode:
   - keyboard-first shortcuts,
   - expanded diagnostics panel.
4. Integrate parental controls surface:
   - strict mode toggle,
   - blocked topic management,
   - transparent state indicator in dashboard header.

Exit criteria:
- Kids can operate safely with low cognitive load.
- Adults can execute repeated tasks quickly.

## Phase 4: Policy/Tier/AI Transparency
Deliverables:
1. Integrate `/user/features`, `/user/entitlements`, `/user/overage` into a usage card.
2. Add in-context tier messaging with accurate limits from the canonical tier policy.
3. Display build governance feedback (quota reached, rate-limited, fallback mode) in clear UX copy.
4. Add admin-only telemetry hooks later if/when admin view is in scope.

Exit criteria:
- Tier/limit behavior is predictable and visible before failures.
- Upgrade prompts are contextual, not disruptive.

## Phase 5: Decision Engine Telemetry Integration
After decision engine v2 backend fields ship, add dashboard panels for:
- site prep actions,
- replans and replan outcomes,
- success-after-replan,
- token/context delta indicators.

Sources: `docs/BUILD-DECISION-ENGINE-PLAN-2026-02-21.md`.

Exit criteria:
- Users can understand why a build succeeded/failed and what the bot did to recover.

## Phase 6: Quality, Accessibility, and Rollout
Deliverables:
1. Accessibility pass:
   - keyboard paths,
   - ARIA labels,
   - contrast compliance,
   - reduced motion support,
   - minimum hit-target sizing for touch interactions.
2. Performance pass:
   - memoized heavy render paths,
   - virtualized or capped message lists,
   - no UI stalls under high event rate.
3. Controlled rollout with feature flags:
   - `WEB_DASHBOARD_V2_ENABLED`,
   - optional `WEB_DASHBOARD_GUIDED_MODE_DEFAULT`.
4. Validation:
   - unit tests for parser/state reducers,
   - integration tests for command flows,
   - E2E smoke for launch/build/history/safety settings.

Exit criteria:
- Measurable UX improvement with no security or stability regression.

## Proposed File-Level Impact
Likely touched files:
- `apps/webui/src/App.jsx`
- `apps/webui/src/components/PromptInput.jsx` (or replacement)
- `apps/webui/src/components/ControlPanel.jsx`
- `apps/webui/src/components/BotConsole.jsx`
- `apps/webui/src/components/BuildHistoryPanel.jsx`
- `apps/webui/src/components/WebSocketProvider.jsx`
- `apps/webui/src/index.css`
- new: `apps/webui/src/components/ui/*`
- new docs: `docs/BUILDERBOT-UX-PRINCIPLES.md`

## Success Metrics
Track pre/post launch:
- Time-to-first-successful-command.
- Command success rate from dashboard-originated actions.
- Build completion visibility score (user can identify status without opening raw logs).
- Guided mode retention (new users).
- Build retry rate after clearer failure messaging.
- Support tickets tied to "didn't know what happened" confusion.

## Recommended Implementation Order
1. Phase 0 + Phase 1 in one stabilization PR.
2. Phase 2 in a focused UX PR.
3. Phase 3 in a personalization/safety PR.
4. Phase 4 + Phase 5 as API-aligned incremental PRs.
5. Phase 6 hardening before broad default enablement.

## Implementation Status Update (2026-02-21)
This plan has now been partially implemented in `apps/webui` with a production code pass focused on Phases 0-4 foundations plus Phase 5 preview telemetry wiring.

### Completed in this pass
1. Phase 0 context/design realignment:
   - Added product-specific UX baseline: `docs/BUILDERBOT-UX-PRINCIPLES.md`.
   - Added source-to-decision matrix and mode/a11y rules in that document.
2. Phase 1 foundation refactor:
   - Added MUI + `react-icons` dependencies in `apps/webui/package.json`.
   - Added tokenized theme foundation:
     - `apps/webui/src/theme/tokens.js`
     - `apps/webui/src/theme/dashboard-theme.js`
   - Added reusable UI primitives in `apps/webui/src/components/ui/*`:
     - `Card.jsx`
     - `StatusBadge.jsx`
     - `SectionHeader.jsx`
     - `EmptyState.jsx`
     - `InlineAlert.jsx`
     - `PrimaryButton.jsx`
   - Upgraded `WebSocketProvider` state model in `apps/webui/src/components/WebSocketProvider.jsx`:
     - explicit `connectionState`,
     - bounded normalized event buffer,
     - reconnect telemetry fields.
3. Phase 2 core dashboard UX upgrade:
   - Replaced prompt UX with `CommandComposer` (`apps/webui/src/components/CommandComposer.jsx`) and set `PromptInput.jsx` as compatibility wrapper.
   - Rebuilt control workflows in `apps/webui/src/components/ControlPanel.jsx` into launch/movement/environment clusters with disabled-state explanations.
   - Replaced free-form console stream with grouped activity feed in `apps/webui/src/components/BotConsole.jsx`.
   - Upgraded build history UI in `apps/webui/src/components/BuildHistoryPanel.jsx` with summary cards + detail tabs (Summary/Steps/Logs/JSON fallback).
   - Added build timeline card: `apps/webui/src/components/BuildExecutionCard.jsx`.
4. Phase 3 personalization + safety:
   - Added persistent mode toggle (`guided` / `advanced`) and accessibility prefs in:
     - `apps/webui/src/utils/preferences.js`
     - `apps/webui/src/App.jsx`
   - Added safety/settings drawer integrated with renewal and parental control APIs:
     - `apps/webui/src/components/SettingsSafetyDrawer.jsx`
   - Added strict-mode visibility in dashboard status rail.
5. Phase 4 policy/tier transparency:
   - Added authenticated dashboard data hook for:
     - `/api/user/features`
     - `/api/user/entitlements`
     - `/api/user/overage`
     - `/api/user/parental-controls`
     - `/api/user/subscription/renewal`
   - Files:
     - `apps/webui/src/hooks/useDashboardData.js`
     - `apps/webui/src/utils/auth-fetch.js`
   - Added usage/tier visibility card:
     - `apps/webui/src/components/UsageSnapshotCard.jsx`
6. Phase 5 preview telemetry integration:
   - Added dashboard telemetry preview panel for prep/replan/success-after-replan counters from normalized WS events:
     - `apps/webui/src/components/DecisionTelemetryCard.jsx`
   - Added build-phase derivation in `apps/webui/src/App.jsx`.
7. Shell/layout + rollout controls:
   - Rebuilt dashboard IA in `apps/webui/src/App.jsx` with top status rail, primary workspace, utility column, and settings drawer.
   - Added feature flag parsing for:
     - `VITE_WEB_DASHBOARD_V2_ENABLED`
     - `VITE_WEB_DASHBOARD_GUIDED_MODE_DEFAULT`
   - File: `apps/webui/src/utils/feature-flags.js`
   - Added top rail component: `apps/webui/src/components/TopStatusRail.jsx`.
8. Styling and interaction baseline:
   - Refined global CSS and Electron drag-region behavior in `apps/webui/src/index.css`.
   - Updated title bar and launch modal for consistency:
     - `apps/webui/src/components/TitleBar.jsx`
     - `apps/webui/src/components/LaunchBotModal.jsx`

### Validation run
- Web UI build succeeded:
  - `npm --prefix apps/webui run build`

### Remaining work for full plan completion
1. Add explicit keyboard shortcut map + command palette behaviors beyond current advanced hints.
2. Add richer build history `steps` / `logs` retrieval APIs if subcollection drill-down is required.
3. Add formal E2E coverage for guided/advanced mode switch, parental control updates, and renewal updates.
4. Add server-backed decision-engine token/context delta fields and replace telemetry placeholder labels.
5. Add feature-flag rollout defaults and environment wiring in deployment configs.
