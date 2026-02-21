import { WebSocketServer } from 'ws';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { handlePlayerCommand, runBuildCommandSingleFlight } from './command-router.js';
import { executeCommands } from './execute-commands.js';
import { normalizeInstructionPlan, toLegacyBlocksAndTags } from '../shared-utils/instruction-schema.js';
import { resolveCommanderUsername } from './player-identity.js';

export function resolveWsBuildPrompt(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  if (message.type === 'chat_command') {
    if (typeof message.message !== 'string' || message.message.trim().length === 0) {
      return null;
    }
    return message.message.trim();
  }

  if (message.type === 'raw_prompt') {
    if (typeof message.prompt !== 'string' || message.prompt.trim().length === 0) {
      return null;
    }
    return `build ${message.prompt.trim()}`;
  }

  return null;
}

export function resolveWsInstructionPlanPayload(message) {
  if (!message || typeof message !== 'object' || message.type !== 'instruction_plan') {
    return null;
  }

  return message.plan || message.payload || null;
}

export function startBotServer({ bot, commander }) {
  console.log(`Starting bot WebSocketServer on port 3002...`)
  const wss = new WebSocketServer({ port: 3002 });

  wss.on('connection', ws => {
    console.log('📡 Client connected');

    ws.on('message', async rawData => {
      try {
        const message = JSON.parse(rawData);

        console.log('message from WS: ', message);

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

        const commandMessage = resolveWsBuildPrompt(message);
        if (commandMessage) {
          const username = resolveCommanderUsername({
            bot,
            commander,
            preferredUsername: message.username,
          });

          if (!username) {
            ws.send(JSON.stringify({
              type: 'command_rejected',
              reason: 'commander_offline',
              text: 'Commander player is not currently online.',
            }));
            return;
          }

          await handlePlayerCommand({
            commander,
            bot,
            message: commandMessage,
            username,
          });
          return;
        }

        const instructionPlanPayload = resolveWsInstructionPlanPayload(message);
        if (instructionPlanPayload) {
          const username = resolveCommanderUsername({
            bot,
            commander,
            preferredUsername: message.username,
          });

          if (!username) {
            ws.send(JSON.stringify({
              type: 'instruction_plan_rejected',
              reason: 'commander_offline',
            }));
            return;
          }

          const normalizedPlan = normalizeInstructionPlan(instructionPlanPayload);
          const { blocks } = toLegacyBlocksAndTags(normalizedPlan);
          const started = await runBuildCommandSingleFlight({
            bot,
            username,
            commandType: 'instruction_plan',
            busyMessage: "⏳ Bot is already running a build. Try again when it finishes.",
            run: async () => executeCommands({
              bot,
              commands: blocks,
              username,
            }),
          });

          if (!started) {
            ws.send(JSON.stringify({
              type: 'instruction_plan_rejected',
              reason: 'busy',
            }));
            return;
          }

          ws.send(JSON.stringify({
            type: 'instruction_plan_applied',
            actionCount: normalizedPlan.actions.length,
          }));
          return;
        }

        console.log('WS message not routed: ', message);

      } catch (err) {
        console.error('❌ Error parsing message:', err.stack);
      }
    });
  });

  console.log('🛰️ Bot WebSocket server running on ws://localhost:3002');

  // 💬 Broadcast in-game chat to all WebSocket clients
  bot.on('chat', (username, message) => {
    const player = bot.players[username];
    if (!player) {
      return;
    }

    const messageIsFromCommander = player.uuid === commander.uuid;
    const messageIsFromBot = bot.entity.username === player.username;

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
