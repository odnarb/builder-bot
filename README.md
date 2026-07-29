# BuilderBot

BuilderBot is a Minecraft building bot.

You type a normal sentence, and BuilderBot tries to build it in Minecraft.

Example:

```txt
build a cobblestone tower
```

Current project status is in `STATUS.md`.

## What Is In This Repo
- API server
- Web UI
- Electron desktop wrapper
- Minecraft bot
- Shared build logic
- Local prompt parser
- Stripe billing code for hosted mode

## What Is Being Worked On Now
BuilderBot is moving to two modes:

| Mode | What it means |
|---|---|
| `local` | Run it yourself for free. No Stripe or Auth0. |
| `hosted` | Hosted app with Stripe payment checks. |

Local mode is not fully finished yet. Auth0 is no longer required for local API identity, but some local data paths still need SQLite wiring.

The plan is in:

```txt
docs/HOSTED-BILLING-AND-LOCAL-DB-PLAN.md
```

## Requirements
- Node.js 22+
- Java 17+ for a Paper Minecraft server
- Windows Terminal and Git for Windows when using the automatic WSL launcher
- Auth0/Stripe env values for hosted-style API flows
- OpenAI env values when AI features are used
- Firestore credentials only when using Firestore-backed storage

Do not read or commit `.env` files.

## Important Config
- `BUILDERBOT_DISTRIBUTION_MODE`
  - `local` or `hosted`
- `PERSISTENCE_MODE`
  - `sqlite`, `firestore`, or `memory`
- `BOT_WS_ALLOWED_ORIGINS`
  - allowed Web UI origins for bot WebSocket control
- `MC_AUTH_MODE`
  - Minecraft auth mode: `offline`, `mojang`, or `microsoft`
- `PRE_SCALE_PERSISTENCE_MODE`
  - older economics persistence switch
  - `firestore` makes fallback alerts show if Firestore is not available

## Install
```bash
npm install
npm --prefix apps/api install
npm --prefix apps/webui install
```

## Run Locally Today
In VS Code, press `Ctrl+Shift+B` to run the default `local stack` build task.

You can launch the same task from a terminal:

```bash
npm run build
```

On Windows/WSL, the launcher opens each service in a Git Bash tab and delegates
the service process back into the current WSL distro. This avoids PowerShell
task-shell issues without running Windows Node against Linux dependencies.
The checked-in VS Code workspace selects Git Bash for new Windows terminals,
while the local-stack task runs Node directly so it cannot inherit PowerShell.

The launcher starts these services in separate terminals when they are not already running:

- Minecraft server
- API
- Web UI
- Minecraft bot

The task checks local ports first, so it will not start another copy on top of a running service.

Start a Minecraft server:

```bash
java -Xmx2G -jar paper-1.20.4-499.jar
```

Start the API:

```bash
npm --prefix apps/api run dev
```

Start the Web UI:

```bash
npm --prefix apps/webui run dev
```

Local mode uses a default local user for API identity.
The Web UI also defaults to local mode and skips Auth0.

## Run With The Firestore Emulator
The Firestore emulator can be used for local Firestore-backed persistence without cloud credentials.

Requirements:

- Firebase CLI
- Java 21+ for current Firebase emulator tooling

Start the emulator:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

firebase emulators:start --only firestore --project demo-builderbot-local
```

Use these exports in any terminal that should connect to the emulator:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export GOOGLE_CLOUD_PROJECT=demo-builderbot-local
export PRE_SCALE_PERSISTENCE_MODE=firestore
```

Then start the API:

```bash
npm run dev:local-stack -- api
```

The emulator UI is available at:

```txt
http://127.0.0.1:4000/firestore
```

To test hosted Auth0 login from the Web UI, set:

```bash
VITE_BUILDERBOT_DISTRIBUTION_MODE=hosted
```

Hosted-style runs still use Auth0. For hosted-style local testing, get a token from the Web UI:

1. Open `http://localhost:5173`.
2. Log in.
3. In browser DevTools, open a request like `/api/user/tier`.
4. Copy the `Authorization` header.
5. Export it:

```bash
export AUTH_TOKEN='<paste token here>'
```

Start the bot from the terminal:

```bash
npm run dev:bot
```

Or start Electron:

```bash
npm run dev:electron
```

That command starts the Web UI first if it is not already running.

## CLI Prompt
You can run a simple prompt from the CLI:

```bash
npm run dev -- "build a cobblestone tower" --schematic
```

## Tests
Run all tests:

```bash
npm test
```

Useful checks:

```bash
npm run check:architecture
npm run check:routes-security
npm run check:secrets
```

## Architecture
Shared code lives in `apps/core`.

Before tests or deploys, shared code is copied into app folders:

```bash
npm run stage:shared-core
```

Read more:

- `docs/CORE-ARCHITECTURE.md`
- `docs/HOSTED-BILLING-AND-LOCAL-DB-PLAN.md`
- `STATUS.md`
