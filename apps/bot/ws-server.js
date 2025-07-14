const WebSocket = require('ws');
const Vec3 = require('vec3');

function startBotServer(bot) {
  const wss = new WebSocket.Server({ port: 3001 });

  wss.on('connection', ws => {
    console.log('📡 Client connected');

    ws.on('message', async rawData => {
      try {
        const message = JSON.parse(rawData);

        // 🛰️ 1. Bot Position Request
        if (message.type === 'get_position') {
          const pos = bot.entity.position;
          ws.send(JSON.stringify({
            type: 'bot_position',
            position: {
              x: Math.floor(pos.x),
              y: Math.floor(pos.y),
              z: Math.floor(pos.z)
            }
          }));
          return;
        }

        // 🧱 2. Build Instruction (Expecting an array of blocks)
        const structure = message;

        if (!Array.isArray(structure) || structure.length === 0) {
          console.warn('⚠️ Received empty or malformed structure');
          return;
        }

        for (const block of structure) {
          if (
            typeof block.x !== 'number' ||
            typeof block.y !== 'number' ||
            typeof block.z !== 'number' ||
            typeof block.block !== 'string' // updated from 'type'
          ) {
            console.warn('⚠️ Invalid block format:', block);
            return;
          }
        }

        console.log('📥 Received build command with', structure.length, 'blocks');

        for (const block of structure) {
        const pos = new Vec3(block.x, block.y, block.z); // ✅ no bot.entity.offset
        const below = pos.offset(0, -1, 0);
        const referenceBlock = bot.blockAt(below);

        if (!referenceBlock) {
            console.log(`⛔ Skipping ${pos} — no block below`);
            continue;
        }

        try {
            await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
            console.log(`✅ Placed ${block.block} at ${pos}`);
        } catch (err) {
            console.log(`⚠️ Error placing block at ${pos}: ${err.message}`);
        }
        }
      } catch (err) {
        console.error('❌ Error parsing message:', err.message);
      }
    });
  });

  console.log('🛰️ Bot WebSocket server running on ws://localhost:3001');
}

module.exports = { startBotServer };
