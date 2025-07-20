import Vec3 from 'vec3';
import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;

import { startBotServer } from './ws-server.js';

import { handlePlayerCommand } from './command-router.js';

//master player
const commanderUUID = 'd32f0358-7604-3be7-b35b-6f8e6ec02e05'

//bot's name
const botName = 'BuilderBot'

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 25565,
  username: botName,
  version: '1.20.4'
});

bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  console.log('🤖 Bot spawned!');

  await bot.waitForChunksToLoad(); // ⬅️ ensures blocks are loaded
  await bot.waitForTicks(20);      // ⬅️ slight extra delay just in case

  //give self items needed
  const neededItems = ['stone', 'oak_planks', 'torch', 'bed'];
  neededItems.forEach((item, i) => {
    bot.chat(`/give ${bot.username} minecraft:${item} 999`);
    bot.waitForTicks(2 + i); // slight stagger
  });

  startBotServer(bot); // ⬅️ Enable WebSocket control

  const base = bot.entity.position.offset(1, 0, 1);
});

bot.on('chat', async (username, message) => {
  try {
    console.log(`Got "${message}" from ${username}`)

    // this shouldn't ever happen, but just in case the AI starts chatting with users
    if (username === bot.username) {
      console.log(`Ignoring chat from self.`)
      return;
    }

    // only respond to commands with format like: "@BuilderBot build a fortress"
    if (!message.includes(`@${botName}`)) {
      console.log(`Ignoring chat without @${botName}.`)
      return;
    }

    const player = Object.entries(bot.players).filter(([username, user]) => user.uuid === commanderUUID)[0]

    // don't allow commands from other players
    if (player === undefined) {
      console.log(`Ignoring chat from non-commander entity. Commander uuid is ${commanderUUID}`)
      return
    }

    //remove the "@{botName} " part since we've verified it's directed towards the bot.
    const finalMessage = message.slice(botName.length + 2, message.length)

    //Allowing command
    console.log(`Allowing "${finalMessage}" from ${username}`)

    await handlePlayerCommand(bot, finalMessage, username);
  } catch (error) {
    console.error(`Could not process command. ${error.stack}`)
  }
});