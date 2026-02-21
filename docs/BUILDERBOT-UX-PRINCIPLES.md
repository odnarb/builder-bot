# BuilderBot UX Principles
Date: 2026-02-21

## Purpose
Define a product-specific UX baseline for the BuilderBot dashboard so design and implementation stay aligned across guided and advanced user modes.

## Product Principles
1. State should be obvious in under 3 seconds.
2. Every panel has one primary action and clear secondary actions.
3. Raw data is never the default view when a human-readable summary is possible.
4. Guided mode optimizes safety and clarity for younger/new users.
5. Advanced mode optimizes speed and control for experienced users.
6. Tier limits and policy outcomes are explained before failures, not only after.
7. Accessibility settings are first-class and persistent per user.

## Language Rules
- Use direct, plain labels (`Launch BuilderBot`, `Retry Last Build`, `Strict Mode`).
- Avoid emoji-only actions and ambiguous short labels.
- Always pair iconography with text labels.
- Prefer actionable error copy (`Connection is not ready. Reconnect and try again.`).

## Interaction Rules
- Mobile-first layouts must remain usable at 360px width.
- Touch targets are at least 40px tall.
- Guided mode defaults to preset chips and explicit confirmations for risky commands.
- Advanced mode surfaces keyboard-first behaviors and diagnostic detail.
- Panels use progressive disclosure: summary first, details second.

## Information Architecture Rules
- Top rail always includes connection, bot state, tier context, and current build status.
- Primary workspace includes command composer, build timeline, controls, and live activity feed.
- Utility column includes usage/tier visibility and build history deep-dive.
- Settings drawer includes mode, safety controls, subscription renewal, and accessibility preferences.

## Accessibility Bar
- Keyboard reachable controls and visible focus states.
- Reduced motion mode disables transitions/animations.
- High contrast mode increases visual contrast globally.
- Text scale is user-selectable and persisted.

## Source-To-Decision Matrix
| Source Theme | BuilderBot Decision |
| --- | --- |
| Progressive disclosure (NN/g) | Build history and activity feed default to summary cards with optional detail expansion. |
| Hierarchy and proximity (Cygnis) | Panels are clustered into status rail, workspace, and utility column with distinct headings. |
| Consistent component language (React library references) | MUI-first primitives and shared `ui/*` wrappers standardize cards, alerts, badges, and actions. |
| Icon clarity over novelty (icon library references) | `react-icons` replaces emoji-led controls and always pairs icon + text. |
| Accessibility-first modern UX | Added persistent text scale, reduced motion, and contrast mode in settings drawer. |

## Mode Contract
### Guided
- Default mode for new users.
- Preset command chips and low-friction command input.
- Confirmation for risky command vocabulary.
- Reduced diagnostics by default.

### Advanced
- Full command control with fast iteration.
- Expanded event payloads in activity feed.
- Better suited for repeated builds and diagnostics.

## Non-Negotiables
- No bypass of auth middleware or tier enforcement.
- No client-side assumption of paid entitlements.
- No removal of clear policy feedback for quotas, limits, or safety controls.
