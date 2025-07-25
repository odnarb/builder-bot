import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder } = pkg;

import { startBotServer } from './ws-server.js';
import { handlePlayerCommand } from './command-router.js';
import { addLogEntry, createSession, getUserTier } from './apiClient.js';

//current user info
const COMMANDER_UUID = process.env.COMMANDER_UUID

//minecraft server info
const MC_HOST_IP = process.env.MC_HOST_IP || '127.0.0.1'
const MC_HOST_PORT = process.env.MC_HOST_PORT || 25565
const MC_HOST_VERSION = process.env.MC_HOST_VERSION || '1.20.4'

//bot's name
const BOT_NAME = process.env.BOT_NAME || 'BuilderBot'

//for disallowing multiple commands to be in flight
let handlingCommand = false

//start the session on the backend for logging
await createSession({
  session: {
    commanderUUID: COMMANDER_UUID,
    hostIp: MC_HOST_IP,
    hostPort: MC_HOST_PORT,
    hostVersion: MC_HOST_VERSION,
    botName: BOT_NAME
  }
})

//Get user tier information before starting bot
const tierData = await getUserTier()

//get user's tier and create the commander object
const commander = {
  //master player Minecraft UUID
  uuid: process.env.COMMANDER_UUID || null,
  tier: tierData?.tier || 'free'
}

const bot = mineflayer.createBot({
  username: BOT_NAME,
  host: MC_HOST_IP,
  port: MC_HOST_PORT,
  version: MC_HOST_VERSION
});

bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  console.log('🤖 Bot spawned!');

  await bot.waitForChunksToLoad(); // ensures blocks are loaded
  await bot.waitForTicks(20);      // slight extra delay just in case

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

    const player = Object.entries(bot.players).filter(([username, user]) => user.uuid === commander.uuid)[0]

    // don't allow commands from other players
    if (player === undefined) {
      console.log(`Ignoring chat from non-commander entity. Commander uuid is ${commander.uuid}`)
      return
    }

    //remove the "@{BOT_NAME} " part since we've verified it's directed towards the bot.
    const finalMessage = message.slice(BOT_NAME.length + 2, message.length)

    //Allowing command
    console.log(`Allowing "${finalMessage}" from ${username}`)

    addLogEntry({ type: "chat", message, from: username, level: 0 })

    //TODO: update state that lets the webUI know so that commands can't be spammed
    handlingCommand = true

    if (!handlingCommand) {
      await handlePlayerCommand({ commander, bot, message: finalMessage, username });
    } else {
      bot.chat(`Sorry, I'm currently busy with the previous command.`)
    }

    handlingCommand = false
  } catch (error) {
    console.error(`Could not process command. ${error.stack}`)
  }
});

bot.on('error', async (err) => {
  console.log(`Got error from bot: ${err.stack}`)
  await addLogEntry({ type: "error", message: 'Got error from bot', data: err.stack, level: 2 })
  process.exit(-1)
})

bot.on('kicked', async (reason, loggedIn) => {
  console.log(`Bot kicked:`, reason);
  await addLogEntry({ type: "error", message: 'Bot kicked from server', data: { reason, loggedIn }, level: 1 })
  process.exit(0)
})

bot.on('end', async (reason) => {
  console.log(`Bot disconnected..`, reason);
  await addLogEntry({ type: "error", message: 'Bot disconnected from server', data: { reason }, level: 1 })
  process.exit(0)
});