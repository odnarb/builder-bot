import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder } = pkg;

import { startBotServer } from './ws-server.js';
import { handlePlayerCommand } from './command-router.js';
import { addLogEntry, createSession, getUserTier } from './apiClient.js';
import { resolveTier } from '../api/config/tier-policy.js';
import { isCommanderChatSender } from './player-identity.js';
import { ensurePathfinderTelemetry } from './world-context.js';

//current user info
const COMMANDER_UUID = process.env.COMMANDER_UUID || "123-123-1234"

//minecraft server info
const MC_HOST_IP = process.env.MC_HOST_IP || '127.0.0.1'
const MC_HOST_PORT = process.env.MC_HOST_PORT || 25565
const MC_HOST_VERSION = process.env.MC_HOST_VERSION || '1.20.4'
const MC_AUTH_MODE = String(process.env.MC_AUTH_MODE || 'offline').trim().toLowerCase()
const VALID_MC_AUTH_MODES = new Set(['offline', 'mojang', 'microsoft'])
const RESOLVED_MC_AUTH_MODE = VALID_MC_AUTH_MODES.has(MC_AUTH_MODE) ? MC_AUTH_MODE : 'offline'

if (MC_AUTH_MODE !== RESOLVED_MC_AUTH_MODE) {
  console.warn(`⚠️ Unsupported MC_AUTH_MODE "${MC_AUTH_MODE}". Falling back to "${RESOLVED_MC_AUTH_MODE}".`)
}
if (RESOLVED_MC_AUTH_MODE !== 'offline') {
  console.warn(`⚠️ MC_AUTH_MODE="${RESOLVED_MC_AUTH_MODE}" enables external auth flows. Keep dependencies updated and use trusted runtime environments.`)
}

//bot's name
const BOT_NAME = process.env.BOT_NAME || 'BuilderBot'

async function safeAddLogEntry(log) {
  try {
    await addLogEntry(log);
  } catch (error) {
    console.warn(`⚠️ Could not persist bot log entry: ${error.message}`);
  }
}

//start the session on the backend for logging
try {
  await createSession({
    session: {
      commanderUUID: COMMANDER_UUID,
      hostIp: MC_HOST_IP,
      hostPort: MC_HOST_PORT,
      hostVersion: MC_HOST_VERSION,
      botName: BOT_NAME
    }
  });
} catch (error) {
  console.warn(`⚠️ Could not create API session. Continuing without remote session logging. ${error.message}`);
}

//Get user tier information before starting bot
let tierData = { tier: 'free' };
try {
  tierData = await getUserTier();
} catch (error) {
  console.warn(`⚠️ Could not fetch user tier. Defaulting to free tier. ${error.message}`);
}

//get user's tier and create the commander object
const commander = {
  //master player Minecraft UUID
  uuid: process.env.COMMANDER_UUID || null,
  tier: resolveTier(tierData?.tier)
}

const bot = mineflayer.createBot({
  username: BOT_NAME,
  host: MC_HOST_IP,
  port: MC_HOST_PORT,
  version: MC_HOST_VERSION,
  auth: RESOLVED_MC_AUTH_MODE,
});

bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  console.log('🤖 Bot spawned!');

  await bot.waitForChunksToLoad(); // ensures blocks are loaded
  await bot.waitForTicks(20);      // slight extra delay just in case
  ensurePathfinderTelemetry(bot);

  // Enable WebSocket control
  startBotServer({ bot, commander });
});

bot.on('chat', async (username, message) => {
  try {
    //Ignore chat from self.
    if (username === bot.username) {
      return;
    }

    // Only respond to commands with format like: "@BuilderBot build a fortress"
    if (!message.includes(`@${BOT_NAME}`)) {
      return;
    }

    // don't allow commands from other players
    if (!isCommanderChatSender({ bot, commander, username })) {
      console.log(`Ignoring chat from non-commander sender "${username}". Commander uuid is ${commander.uuid}`);
      return
    }

    //remove the "@{BOT_NAME} " part since we've verified it's directed towards the bot.
    const finalMessage = message.slice(BOT_NAME.length + 2, message.length)

    //Allowing command
    console.log(`Allowing "${finalMessage}" from ${username}`)

    void safeAddLogEntry({ type: "chat", message, from: username, level: 0 });

    await handlePlayerCommand({ commander, bot, message: finalMessage, username });
  } catch (error) {
    console.error(`Could not process command. ${error.stack}`)
  }
});

bot.on('error', async (err) => {
  console.log(`Got error from bot: ${err.stack}`)
  await safeAddLogEntry({ type: "error", message: 'Got error from bot', data: err.stack, level: 2 });
  process.exit(-1)
})

bot.on('kicked', async (reason, loggedIn) => {
  console.log(`Bot kicked:`, reason);
  await safeAddLogEntry({ type: "error", message: 'Bot kicked from server', data: { reason, loggedIn }, level: 1 });
  process.exit(-1)
})

bot.on('end', async (reason) => {
  console.log(`Bot disconnected..`, reason);
  await safeAddLogEntry({ type: "error", message: 'Bot disconnected from server', data: { reason }, level: 1 });
  process.exit(-1)
});
