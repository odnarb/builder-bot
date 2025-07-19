import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import Vec3 from 'vec3';
import { parsePrompt } from '../../packages/prompt-parser/index.js';
import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { executeCommands } from './execute-commands.js';
import { getStructureFromAI } from '../cli/ai-agent.js';

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
    console.log(`📐 Building: ${prompt}`);

    let steps = []

    //first try parsing to ste steps
    steps = parsePrompt(prompt)

    // console.log('structure parsePrompt: ', steps)

    if(steps.length === 0) {
      //get the build steps from the AI
      steps = await getStructureFromAI(prompt) // from ai-agent.js
      // console.log('structure from AI: ', steps)
    }

    if(steps.length > 0) {
      // adjust our steps to be relative to the bot's position
      const adjustedCommands = offsetStructure(steps, {x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z}, { x: 2, y: 0, z: 2 });

      //sort commands by height -- disallow floating blocks
      adjustedCommands.sort((a, b) => a.y - b.y);

      //clear the inventory first before a build
      await bot.creative.clearInventory()

      //finalize the command set
      await executeCommands(bot, adjustedCommands, (event) => {
          if (event.type === 'block_placed') {
              // bot.chat(`✅ Placed ${event.block} at (${event.x}, ${event.y}, ${event.z})`);
              console.log(`✅ Placed ${event.block} at (${event.x}, ${event.y}, ${event.z})`);
          } else if (event.type === 'error') {
              bot.chat(`❌ Could not perform action`);
              console.log(`❌ Failed: ${event.error}`);
          }
      });
    } else {
      bot.chat(`❌ No structure received from AI`)
      console.log(`❌ No structure received from AI`)
    }

    return;
  }

  bot.chat("❓ Unknown command.");
}
