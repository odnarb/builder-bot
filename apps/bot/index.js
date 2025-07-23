import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder } = pkg;

import { startBotServer } from './ws-server.js';

import { handlePlayerCommand } from './command-router.js';

//master player Minecraft UUID
const COMMANDER_UUID = process.env.COMMANDER_UUID || null

//minecraft server info
const MC_HOST_IP = process.env.MC_HOST_IP || '127.0.0.1'
const MC_HOST_PORT = process.env.MC_HOST_PORT || 25565
const MC_HOST_VERSION = process.env.MC_HOST_VERSION || '1.20.4'

//bot's name
const BOT_NAME = process.env.BOT_NAME || 'BuilderBot'

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

  //give self items needed
  // const neededItems = ['stone', 'oak_planks', 'torch', 'bed'];
  // neededItems.forEach((item, i) => {
  //   bot.chat(`/give ${bot.username} minecraft:${item} 999`);
  //   bot.waitForTicks(2 + i); // slight stagger
  // });

  startBotServer({ bot, commanderUUID: COMMANDER_UUID }); // ⬅️ Enable WebSocket control
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

    const player = Object.entries(bot.players).filter(([username, user]) => user.uuid === commanderUUID)[0]

    // don't allow commands from other players
    if (player === undefined) {
      console.log(`Ignoring chat from non-commander entity. Commander uuid is ${commanderUUID}`)
      return
    }

    //remove the "@{BOT_NAME} " part since we've verified it's directed towards the bot.
    const finalMessage = message.slice(BOT_NAME.length + 2, message.length)

    //Allowing command
    console.log(`Allowing "${finalMessage}" from ${username}`)

    await handlePlayerCommand({ commander, bot, message: finalMessage, username });
  } catch (error) {
    console.error(`Could not process command. ${error.stack}`)
  }
});