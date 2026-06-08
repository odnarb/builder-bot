# Deep Work Guide

Use this when making a larger change.

## Goal
Make the smallest complete fix.

Do not over-engineer.

## Before Coding
1. Read `AGENTS.md`.
2. Read `README.md`.
3. Read `STATUS.md`.
4. Read the docs related to your task.
5. Check the files you will change.

## While Coding
- Keep changes small.
- Do not edit unrelated files.
- Do not change behavior unless the task needs it.
- Prefer simple code.
- Add tests for risky changes.
- Update docs when behavior changes.

## Checks
Run the checks that match your change.

Common checks:

```bash
npm test
npm run check:architecture
npm run check:routes-security
npm run check:secrets
```

## Done Means
The work is done when:

- the feature or fix works,
- the right tests pass,
- docs are updated,
- no unrelated files changed,
- the final summary says what changed and what still needs work.

