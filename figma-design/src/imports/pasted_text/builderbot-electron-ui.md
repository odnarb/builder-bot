• What We Have

  Electron is currently a thin desktop shell around the Web UI.

  - apps/electron/main.js:15
      - Creates a frameless 1200x800 BrowserWindow.
      - Loads http://localhost:5173, so it depends on the Vite dev server.
      - Creates a tray icon with Show App and Quit.
      - Spawns the bot process on launch-bot.
      - Sends bot status events: launching, running, exited.
      - Stops the bot via stop-bot.
      - Persists endSession on process close/error/manual stop/window close.
      - Supports window minimize/maximize/close IPC.

  - apps/electron/preload.js:4
      - Exposes window.electronAPI.launchBot.
      - Exposes window.electronAPI.stopBot.
      - Exposes window.electronAPI.onBotStatus.
      - Exposes window controls.

  - apps/webui/src/components/ControlPanel.jsx:17
      - Detects Electron runtime.
      - Shows warning in browser mode.
      - Opens launch modal.
      - Sends launch env vars to Electron.
      - Shows bot status.
      - Has launch/stop buttons.
      - Has quick actions: position, build cube, inventory, nearby blocks.

  - apps/webui/src/components/LaunchBotModal.jsx:5
      - Captures commander UUID, server IP/port/version, bot name.
      - Passes Auth0 token and user id into Electron launch.

  What’s Missing

  Highest priority:

  1. Production loading path
      - Electron only loads http://localhost:5173.
      - Need dev/prod split: load Vite URL in dev, load built apps/webui/dist/index.html in packaged app.

  2. Missing preload.js packaging certainty
      - main.js references apps/electron/preload.js, but package/build config is minimal.
      - Need confirm packaged app includes preload, assets, bot code, and web build.

  3. Bot process path robustness
      - It spawns node bot/index.js with cwd: apps.
      - Works in repo layout, likely fragile in packaged app.
      - Need a reliable packaged path or keep bot as an external/local service.

  4. Bot logs in UI
      - Child process uses stdio: 'inherit', so logs go to terminal, not app UI.
      - Need pipe stdout/stderr to renderer so users can diagnose launch/server/auth failures.

  5. Status accuracy
      - UI says running on child process spawn, not when Mineflayer actually connects/logs in.
      - Need bot lifecycle events: starting, connected, logged in, websocket ready, disconnected, errored.

  6. Settings persistence
      - Launch modal defaults are hardcoded.
      - Need remember last server IP, port, version, bot name, commander UUID.

  7. Graceful shutdown
      - stop-bot sets botProcess = null immediately after SIGINT, then close handler can still fire.
      - Need avoid double session end / status weirdness.

  8. Security hardening
      - Validate/sanitize env values before spawning.
      - Avoid leaving Auth0 token in long-lived process env if possible.
      - Add explicit allowed launch fields.

  9. Packaging/distribution
      - apps/electron/package.json has build metadata but no root build script.
      - Need Electron Builder config/scripts and platform assets.

  My Take

  The Electron interface is a good dev harness, not yet a polished desktop app. The next useful pass should be: make dev/prod loading reliable, pipe bot
  logs/status into the Web UI, persist launch settings, and harden process lifecycle. That gives us a real desktop control surface without overbuilding.

---

 # BuilderBot Electron UI Overhaul Brief

  ## Product Goal
  Design BuilderBot as a polished desktop control center for launching, monitoring, and controlling a Minecraft AI building bot. The app should feel like a
  practical operator console, not a marketing page.

  ## Target Users
  - Minecraft players running BuilderBot locally.
  - Parents or server owners helping configure safe bot usage.
  - Power users/admins monitoring builds, usage, and failures.

  ## Core UX Principles
  - Make launch/setup obvious and hard to misconfigure.
  - Surface bot state clearly: offline, launching, connected, building, failed, stopped.
  - Put logs, errors, and next actions where users can act on them.
  - Keep controls dense but calm. This is a tool, not a landing page.
  - Avoid nested cards and decorative clutter.
  - Prioritize readable operational information over large hero sections.

  ## Main App Structure

  ### 1. App Shell
  Desktop-first layout with:
  - Custom title bar with app name, status pill, minimize/maximize/close.
  - Left sidebar navigation.
  - Main content area.
  - Optional bottom status/log strip.

  Sidebar items:
  - Dashboard
  - Launch
  - Build
  - Console
  - History
  - Settings
  - Admin, visible only for admin tier

  Global status:
  - Bot status: Offline / Launching / Connected / Building / Error
  - Server target: host:port
  - User tier
  - WebSocket/API health

  ## Primary Screens

  ### Dashboard
  Purpose: quick state and next action.

  Content:
  - Bot status panel
  - Server connection summary
  - Last build summary
  - Quick actions:
    - Launch Bot
    - Stop Bot
    - Build Test Cube
    - Get Position
    - Open Console
  - Recent errors or warnings
  - Usage summary for current tier

  Important states:
  - Browser mode: show “Desktop controls require Electron”
  - Electron mode but bot offline: primary CTA is Launch Bot
  - Bot running: primary CTA becomes Stop Bot or Build

  ### Launch Bot Screen / Modal
  Replace the current basic modal with a guided setup.

  Fields:
  - Minecraft server IP
  - Port
  - Minecraft version
  - Bot name
  - Commander UUID
  - Auth mode: Offline / Microsoft / Mojang, if supported
  - API URL, advanced collapsed
  - WebSocket origin/token status, read-only

  Behavior:
  - Save last-used settings.
  - Validate port and required fields.
  - Show connection checklist before launch.
  - Show “Test Connection” if technically available later.
  - Launch button should show progress.

  Launch progress states:
  - Preparing environment
  - Starting bot process
  - Connecting to Minecraft server
  - Logged in
  - WebSocket ready
  - Ready

  ### Build Screen
  Purpose: submit build prompts and show local-vs-AI planning.

  Content:
  - Prompt input
  - Tier/build limit indicator
  - Toggle or badge: Local planner eligible / AI likely needed
  - Submit button
  - Current build progress
  - Cancel/stop build if supported
  - Output summary:
    - Plan source: local / AI / AI patch
    - Blocks planned
    - Prep actions
    - Replans
    - Success/failure

  ### Console Screen
  Purpose: operational visibility.

  Content:
  - Live bot logs from Electron process stdout/stderr
  - WebSocket messages
  - Filter chips:
    - All
    - Bot
    - Build
    - Error
    - API
    - Minecraft
  - Copy logs button
  - Clear local console button
  - Error rows should expose actionable text

  Important:
  - Logs should be readable, timestamped, and not overly colorful.
  - Show bot process exit code and reason.

  ### Build History
  Purpose: inspect past builds.

  Content:
  - List of recent builds
  - Detail drawer/panel
  - Per-build:
    - Prompt
    - Status
    - Source: local / AI
    - Attempts
    - Replans
    - Telemetry counters
    - Failure reason
    - Timestamp

  Add aggregate summary:
  - Local plans
  - AI plans
  - AI calls avoided
  - Success rate
  - Patch replans

  ### Settings
  Purpose: persistent desktop preferences.

  Sections:
  - Minecraft defaults
  - Bot defaults
  - API/backend connection
  - Auth/session
  - Safety/tier limits
  - Diagnostics

  Controls:
  - Save settings
  - Reset to defaults
  - Open log folder, if implemented later
  - Export diagnostics, if implemented later

  ### Admin Screen
  Purpose: read-only operations dashboard first.

  Content:
  - Ops metrics
  - Alerts
  - Incidents
  - Emergency guard state
  - Margin/usage/overage/build costs
  - Abuse/security audit snapshots
  - Pre-scale telemetry
  - Conversion/referral/attribution snapshots

  Important:
  - Keep high-risk actions read-only unless explicitly approved:
    - Emergency guard override
    - Pre-scale simulation triggers
    - Data migration
  - Use drilldowns and JSON details for raw data.

  ## Visual Direction
  Style:
  - Dark operational desktop UI.
  - Compact panels, strong hierarchy.
  - Border radius: 6-8px.
  - Avoid playful oversized cards.
  - Avoid purple-heavy gradients.
  - Use restrained color:
    - Green: connected/success
    - Yellow: warning/launching
    - Red: error/stopped
    - Blue: neutral actions/info
    - Gray: inactive/secondary

  Typography:
  - Small, dense, readable.
  - No oversized hero type inside the app.
  - Monospace only for logs, IDs, env values, coordinates.

  Components Needed
  - App shell
  - Sidebar nav
  - Title bar
  - Status pill
  - Metric tile
  - Log row
  - Error banner
  - Warning banner
  - Launch form
  - Progress steps
  - Settings form
  - Build prompt form
  - Build progress panel
  - History list/detail
  - JSON detail expander
  - Empty state
  - Disabled state
  - Electron-unavailable state

  ## Critical Empty/Error States
  Design these explicitly:
  - Not logged in
  - Browser mode, Electron unavailable
  - Electron app open but Vite/API unavailable
  - Bot process failed to start
  - Minecraft server unreachable
  - Auth token missing/expired
  - Bot kicked/disconnected
  - WebSocket disconnected
  - Build failed with structured reason
  - No build history yet
  - No marketplace listings yet
  - Admin data unavailable

  ## Current Gaps the Design Should Solve
  - Current Electron UI feels like web dashboard controls bolted onto desktop.
  - Bot launch setup is too raw and not persistent.
  - Bot process logs are not visible in the app.
  - Status is too coarse; “running” does not mean connected/ready.
  - Desktop packaging and production mode are not reflected in UI.
  - Admin/community panels are useful but visually raw.
  - There is no cohesive app shell or information architecture.
  - Browser-vs-Electron behavior needs a first-class state.

  ## Suggested First Figma Frames
  1. Desktop App Shell - Bot Offline
  2. Launch Setup Modal / Screen
  3. Launch Progress - Connecting
  4. Dashboard - Bot Connected
  5. Build Screen - Local Planner Eligible
  6. Build Screen - Build Failed
  7. Console - Logs and Errors
  8. Build History - Detail Selected
  9. Settings - Minecraft Defaults
  10. Admin Ops - Read-only Snapshot
  11. Browser Mode - Electron Required
  12. Error State - Server Unreachable

  ## Design Success Criteria
  A user should be able to:
  - Understand whether they are in browser or Electron mode.
  - Configure and launch the bot without reading docs.
  - See whether the bot is actually connected and ready.
  - Diagnose launch/build failures from inside the app.
  - Submit builds and understand whether local or AI planning was used.
  - Review previous builds and errors.
  - Manage basic settings without editing env vars.