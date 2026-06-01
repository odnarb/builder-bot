# DEEP_WORK.md

## Mission
Build/fix/refactor this app. Simplify code as you go. Do not over-engineer

## Non-Negotiables
- Do not change unrelated files.
- Do not redesign architecture unless required.
- Preserve existing behavior unless explicitly listed.
- Prefer small, reviewable commits/diffs.

## Source of Truth
- Read AGENTS.md first.
- Read ROADMAP.md.
- Read relevant docs before editing code.

## Milestones
### Milestone 1 — Understand
- Inspect code paths.
- Identify affected files.
- Write a brief implementation plan.

### Milestone 2 — Implement
- Make the smallest complete change.
- Keep changes scoped.

### Milestone 3 — Validate
Run:
- npm test
- npm run lint
- npm run build

Fix failures before moving on.

### Milestone 4 — Document
Update:
- CHANGELOG.md
- ROADMAP.md
- any affected docs

## Completion Criteria
Done only when:
- Feature works
- Tests pass
- Build passes
- No unrelated diffs
- Summary explains what changed, why, and what remains