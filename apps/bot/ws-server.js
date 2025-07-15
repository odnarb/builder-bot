const WebSocket = require('ws');
const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');

function startBotServer(bot) {
  const wss = new WebSocket.Server({ port: 3001 });

  wss.on('connection', ws => {
    console.log('📡 Client connected');

    ws.on('message', async rawData => {
      try {
        const message = JSON.parse(rawData);

        // 🛰️ Bot Position Request
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

        // 🧭 Bot Movement Command
        if (message.type === 'move_to') {
          const goal = new goals.GoalBlock(message.x, message.y, message.z);
          bot.pathfinder.setGoal(goal);

          ws.send(JSON.stringify({ type: 'moving_to', x: message.x, y: message.y, z: message.z }));

          bot.once('goal_reached', () => {
            ws.send(JSON.stringify({ type: 'goal_reached', x: message.x, y: message.y, z: message.z }));
          });
          return;
        }

        // 🧰 Inventory Request
        if (message.type === 'get_inventory') {
          const items = bot.inventory.items().map(item => item.name);
          ws.send(JSON.stringify({
            type: 'bot_inventory',
            items
          }));
          return;
        }

        // 🌍 Nearby Blocks Request
        if (message.type === 'get_nearby_blocks') {
          const nearby = bot.findBlocks({
            matching: block => block.name !== 'air',
            maxDistance: 6,
            count: 20
          });

          const blocks = nearby.map(pos => {
            const block = bot.blockAt(pos);
            return {
              x: pos.x,
              y: pos.y,
              z: pos.z,
              name: block?.name ?? 'unknown'
            };
          });

          ws.send(JSON.stringify({
            type: 'nearby_blocks',
            blocks
          }));
          return;
        }

        // 🧱 Instruction Array (move_to and build)
        const commands = message;

        if (!Array.isArray(commands) || commands.length === 0) {
          console.warn('⚠️ Received empty or malformed command array');
          return;
        }

        console.log('📥 Received command sequence with', commands.length, 'steps');

        for (const step of commands) {
          if (step.type === 'move_to') {
            const goal = new goals.GoalBlock(step.x, step.y, step.z);
            bot.pathfinder.setGoal(goal);
            ws.send(JSON.stringify({ type: 'moving_to', x: step.x, y: step.y, z: step.z }));

            await new Promise(resolve => {
              bot.once('goal_reached', () => {
                ws.send(JSON.stringify({ type: 'goal_reached', x: step.x, y: step.y, z: step.z }));
                resolve();
              });
            });

          } else if (typeof step.block === 'string') {
            const pos = new Vec3(step.x, step.y, step.z);
            const below = pos.offset(0, -1, 0);
            const referenceBlock = bot.blockAt(below);

            if (!referenceBlock || referenceBlock.name === 'air') {
              console.log(`⛔ Skipping ${pos} — invalid reference block (${referenceBlock?.name})`);
              continue;
            }

            try {
              // Make sure bot equips the block before placing
              const item = bot.inventory.items().find(i => i.name === step.block);
              if (item) {
                await bot.equip(item, 'hand');

                //get the distance to the block position
                const distance = bot.entity.position.distanceTo(pos);

                // 👣 Move closer if too far to place
                if (distance > 3.5) {
                  await bot.pathfinder.goto(new goals.GoalNear(step.x, step.y, step.z, 2));  
                }

                // 🧠 Look at the block face before placing
                await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);

                // ✅ Place block
                await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
              } else {
                console.warn(`⚠️ Block ${step.block} not in inventory`);
              }

              console.log(`✅ Placed ${step.block} at ${pos}`);
            } catch (err) {
              console.log(`⚠️ Error placing block at ${pos}: ${err.message}`);
            }
          } else {
            console.warn('⚠️ Unknown instruction:', step);
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
