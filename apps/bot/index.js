import Vec3 from 'vec3';
import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;

import { startBotServer } from './ws-server.js';

import { handlePlayerCommand } from './command-router.js';

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 25565,
  username: 'BuilderBot',
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
  if (username === bot.username) return;
  await handlePlayerCommand(bot, message, username);
});