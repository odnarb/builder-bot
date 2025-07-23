🧱 Minecraft AI Agent Roadmap

## ✅ Phase 0: Foundation & Setup
- Create project structure and modular layout
- Set up monorepo or packages: bot, prompt-parser, CLI
- Install core dependencies: mineflayer, WebSocket, Vec3, etc.
- Prepare development environment and version control

## ✅ Phase 1: Prompt Parsing & Structure Streaming
- Build CLI tool to accept natural language input (e.g., "build a cube")
- Parse prompt into structured block instructions
- Send instructions via WebSocket to the bot
- Create basic cube and wall templates to test building
- Bot places blocks from static build array

## ✅ Phase 2: AI Context Awareness & Movement
- Add mineflayer-pathfinder plugin for bot movement
- Include bot position, inventory, and nearby blocks in prompt context
- AI generates both movement and structure instructions
- Implement moveTo + build in bot
- Add chat command support: move, follow, stop
- Parse chat phrases into same instruction format as WebSocket
- Allow real-time control by players in-game

## ✅ Phase 3: Web UI or API Gateway
- Build a web app or REST API to replace CLI
- Let users submit instructions via browser
- Web UI communicates via WebSocket or REST to bot
- Add sandbox limits per build tier (blocks per build, etc.)
- UI options to toggle chat control, display chat logs
- Mirror chat commands into UI buttons

## ✅ Phase 4: Subscription Tiering & Monetization
- Create Free, Starter, Pro, and Admin tiers
- Define limits per tier: build size, command block use, concurrent builds
- Integrate Stripe for payments
- Track build history and tier usage
- Gate chat features per tier (e.g., Pro unlocks structure chat builds)

## 🔜 Phase 5: Agent AI Operations Management
- Create persistent logging for all builds: who, what, when, where
- Monitor installations and active bot sessions via dashboard
- Alert on build errors, blocked placements, or suspicious behavior
- Use analytics to adjust tier limits and detect popular features
- Notify admins on crash or build failures
- Store structured event logs in a database
- Track and analyze chat usage and abuse patterns

## 🔜 Phase 6: Pro Tier + Command Block Support
- Allow command block placement for Pro users
- Validate incoming structures for illegal block use
- Apply higher build size limit and access to automation triggers
- Enable redstone scripting or teleporting via chat commands

## 🔜 Phase 7: Social Integration & Share Rewards
- Add CurseForge/Modrinth links for user builds
- Track number of likes/upvotes for rewards
- Incentivize builds with additional perks (e.g., larger plots, custom blocks)
- Allow users to share custom chat phrases or AI personalities

## Ideas that might be critical but not sure if included in roadmap

build a server that logs to sqlite for local development for now (will swap with GCP Firestore later, make sure we are not locked into sqlite)
server connects to auth0 for logins and signups
log errors and successes to server via bot
server handles stripe payment processing


## Extra Ideas Not on Roadmap


build structure limits
    needs to have build structure limit in bot before executing
        keep a local cache of what user's restrictions are and where they're at

build structure log/history
    send builds completed to server backend
    do not count errored blocks against quota
    do count error blocks and the build it occurred with

bot inventory:
    allow bot to give self blocks when not in inventory and retry build

code obfuscation:
    wrap with electron (possibly deploy to macOS as well with this)

system architecture:
    GCP function for updating app on startup
    GCP function with auth0 for SSO/login
    GCP function for license check on login
    GCP container (or function) for AI command parser
    GCP Firestore for db
    GCP ? for logging user actions

chat ideas:
    only allow commands from authorized (or linked) player
    -by starting the bot and telling it who to listen to (single player only for now)
    -allow uuid to be updated from web ui
    -make sure it follows commands only from the commander that has a valid uuid

ai instruction/context
    access to and use of the "creative" menu
        accesses every single block in the game
    break blocks that are in the way