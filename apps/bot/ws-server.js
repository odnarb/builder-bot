import { WebSocketServer } from 'ws';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { handlePlayerCommand } from './command-router.js';
import { executeCommands } from './execute-commands.js';

export function startBotServer({ bot, commander }) {
  console.log(`Starting bot WebSocketServer on port 3002...`)
  const wss = new WebSocketServer({ port: 3002 });

  wss.on('connection', ws => {
    console.log('📡 Client connected');

    ws.on('message', async rawData => {
      try {
        const message = JSON.parse(rawData);

        console.log('message: ', message);

        //DISABLE THIS FOR NOW
        //Update who the commander is in the game (player's UUID)
        // if (message.type === 'commander_change') {
        //   const player = bot.players[message.message];

        //   //don't switch commanders if it is not found
        //   if (player === undefined) {
        //     // can't update, player not on server
        //     ws.send(JSON.stringify({ type: 'commander_change_error', text: `Commander could not be updated to player with UUID: ${message.message}` }));
        //   } else {
        //     commanderUUID = message.message
        //     ws.send(JSON.stringify({ type: 'commander_changed', text: `Commander updated to player ${player.username} (uuid: ${player.uuid})` }));
        //   }
        // }

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

        if (message.type === 'chat_command') {
          await handlePlayerCommand({ commander, bot, message: message.message, username: 'Commander' }); // or "WebUI"
          return;
        }

        if (message.type === 'raw_prompt') {
          // You can route this to `ai-agent.js` or parsePrompt()
          const structure = parsePrompt(message.prompt); // or runAgent()

          if (!structure || !Array.isArray(structure)) {
            console.warn("❌ Invalid structure from prompt");
            return;
          }

          console.log("🧠 Executing structure from prompt:", message.prompt);
          // Then run the same logic to handle move/build
        }

        // 🧱 Instruction Array (move_to and build)
        const commands = message;

        console.log('commands: ', commands);

        if (!Array.isArray(commands) || commands.length === 0) {
          console.warn('⚠️ Received empty or malformed command array');
          return;
        }

        console.log('📥 Received command sequence with', commands.length, 'steps');

        // 🧱 Instruction Array
        if (Array.isArray(message)) {
          console.log('📥 Received command sequence:', message);
          await executeCommands({
            bot, buildId, commands: message, onProgress: (event) => {
              ws.send(JSON.stringify(event));
            }
          });
          return;
        }
      } catch (err) {
        console.error('❌ Error parsing message:', err.stack);
      }
    });
  });

  console.log('🛰️ Bot WebSocket server running on ws://localhost:3002');

  // 💬 Broadcast in-game chat to all WebSocket clients
  bot.on('chat', (username, message) => {
    const messageIsFromCommander = bot.players[username].uuid === commander.uuid;
    const messageIsFromBot = bot.entity.username === bot.players[username].username;

    if (messageIsFromCommander || messageIsFromBot) {
      const payload = {
        type: 'chat_feed',
        from: username,
        text: message,
        timestamp: Date.now()
      };

      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify(payload));
        }
      }

    }

  });
}

