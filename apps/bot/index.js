const mineflayer = require('mineflayer');

const { startBotServer } = require('./ws-server');

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 25565,
  username: 'BuilderBot',
  version: '1.20.4'
});

const Vec3 = require('vec3');

bot.once('spawn', async () => {
  console.log('🤖 Bot spawned!');

  await bot.waitForChunksToLoad(); // ⬅️ ensures blocks are loaded
  await bot.waitForTicks(20);      // ⬅️ slight extra delay just in case

  startBotServer(bot); // ⬅️ Enable WebSocket control

  const base = bot.entity.position.offset(1, 0, 1);
});
