import Vec3 from 'vec3';
import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;

import { startBotServer } from './ws-server.js';

import runAgent from '../cli/ai-agent.js';

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

  startBotServer(bot); // ⬅️ Enable WebSocket control

  const base = bot.entity.position.offset(1, 0, 1);
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;

  const msg = message.toLowerCase();

  if (msg === 'come here') {
    const player = bot.players[username]?.entity;
    if (player) {
      const goal = new goals.GoalBlock(
        Math.floor(player.position.x),
        Math.floor(player.position.y),
        Math.floor(player.position.z)
      );
      bot.pathfinder.setGoal(goal);
      bot.chat("On my way!");
    }
  }

  if (msg === 'stop') {
    bot.pathfinder.setGoal(null);
    bot.chat("Okay, stopped.");
  }

  if (msg.startsWith('build ')) {
    const prompt = message.slice(6);
    bot.chat(`📐 Building: ${prompt}`);

    runAgent(prompt);
  }
});

