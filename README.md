# Minecraft AI Agent
Natural-language Minecraft builder bot with API, Web UI, and Electron control app.

## Prerequisites
- Node.js 22+
- Java 17+ (for Paper server)
- `k.json` in repo root for local Firestore-backed API runs
- `.env` configured for API/Auth0/Stripe/OpenAI where needed

## Install
```bash
npm install
npm --prefix apps/api install
npm --prefix apps/webui install
```

## Local Run
1. Start Minecraft server:
```bash
java -Xmx2G -jar paper-1.20.4-499.jar
```
2. Start API (`http://localhost:3001`):
```bash
npm --prefix apps/api run dev
```
3. Start bot:
```bash
npm run dev:bot
```

Optional:
- Start Web UI (`http://localhost:5173`):
```bash
npm --prefix apps/webui run dev
```
- Start Electron app (expects Web UI on port 5173):
```bash
npm run dev:electron
```

## Tests
```bash
npm test
```
