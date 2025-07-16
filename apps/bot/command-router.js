import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import Vec3 from 'vec3';
import { parsePrompt } from '../../packages/prompt-parser/index.js';
import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { executeCommands } from './execute-commands.js';

export async function handlePlayerCommand(bot, message, username = 'Commander') {
  console.log(`⚙️ Executing: ${message} from ${username}`);

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
    return;
  }

  if (msg === 'stop') {
    bot.pathfinder.setGoal(null);
    bot.chat("Okay, stopped.");
    return;
  }

  if (msg.startsWith('build ')) {
    const prompt = msg.slice(6);
    bot.chat(`📐 Building: ${prompt}`);

    //get the build steps - TODO: Have the AI provide an array of block placements
    // const steps = getAICommand(prompt) // from ai-agent.js
    const steps = parsePrompt(prompt)

    // adjust our steps to be relative to the bot's position
    const adjustedSteps = offsetStructure(steps, {x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z}, { x: 2, y: -1, z: 2 });

    //finalize the command set
    const commands = [
      { type: 'move_to', x: bot.entity.position.x + 3, y: bot.entity.position.y, z: bot.entity.position.z + 3 },
      ...adjustedSteps
    ];

    console.log('command array ', commands)

    await executeCommands(bot, commands, (event) => {
        if (event.type === 'block_placed') {
            bot.chat(`✅ Placed ${event.block} at (${event.x}, ${event.y}, ${event.z})`);
        } else if (event.type === 'error') {
            bot.chat(`❌ Failed: ${event.error}`);
        }
    });

    return;
  }

  bot.chat("❓ Unknown command.");
}
