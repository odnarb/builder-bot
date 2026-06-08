# BuilderBot UX Principles
Date: 2026-06-07

This doc explains how the app should feel to use.

## Main Goal
Users should know what to do in a few seconds.

The app should make building feel clear, safe, and fast.

## Basic Rules
- Show the bot status clearly.
- Make the main action easy to find.
- Use plain button names.
- Do not show raw JSON unless the user asks for details.
- Explain limits before users hit them.
- Keep controls keyboard accessible.
- Make errors helpful.

Good error:

```txt
Connection is not ready. Reconnect and try again.
```

Bad error:

```txt
Error 500
```

## Screen Layout
The app should show:

- connection state,
- bot state,
- current user tier,
- current build status,
- prompt input,
- build history,
- recent activity.

## Guided Mode
Guided mode is for new users.

It should:

- show simple choices,
- ask before risky actions,
- hide noisy debug details,
- use clear labels.

## Advanced Mode
Advanced mode is for power users.

It can show:

- more logs,
- faster controls,
- more detail,
- keyboard-friendly flows.

## Accessibility
The app should support:

- keyboard navigation,
- visible focus states,
- reduced motion,
- high contrast,
- text scaling.

## Must Not Break
- Do not bypass auth checks.
- Do not trust the frontend for paid access.
- Do not hide quota or safety limits.
- Do not rely only on color to show meaning.

