import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { parsePrompt } from '../../packages/prompt-parser/index.js';
import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { executeCommands } from './execute-commands.js';
import { getStructureFromAI } from '../cli/ai-agent.js';

import fs from 'fs'

const USAGE_TIER_NAMES = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ADMIN: 'admin'
};

const USAGE_TIERS = {
  FREE: { maxBlocks: 100, allowCustomChat: false },
  STARTER: { maxBlocks: 500 },
  PRO: { maxBlocks: 2000, allowCustomChat: true },
  ADMIN: { maxBlocks: Infinity }
};

function overTierLimit({ commander, numBlocks }) {
  return (commander.tier === USAGE_TIER_NAMES.FREE && numBlocks > USAGE_TIERS.FREE.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.STARTER && numBlocks > USAGE_TIERS.STARTER.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.PRO && numBlocks > USAGE_TIERS.PRO.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.ADMIN && numBlocks > USAGE_TIERS.ADMIN.maxBlocks
  )
}

export async function handlePlayerCommand({ commander, bot, message, username = 'Commander' }) {
  console.log(`⚙️ Executing: ${message} from ${username}`);

  const msg = message.toLowerCase();

  if (msg.includes('come here')) {
    const playerEntity = bot.players[username]?.entity;

    //if a close entity found go there else try to check for coordinates in the message
    if (playerEntity) {
      const goal = new goals.GoalBlock(
        Math.floor(playerEntity.position.x),
        Math.floor(playerEntity.position.y),
        Math.floor(playerEntity.position.z)
      );
      bot.pathfinder.setGoal(goal);
      bot.chat("On my way!");
    } else {
      // Match "come here x:0,y:0,z:0" using regex
      const coordMatch = message.match(/x\s*:\s*(-?\d+)\s*,\s*y\s*:\s*(-?\d+)\s*,\s*z\s*:\s*(-?\d+)/i);

      if (coordMatch) {
        const [, x, y, z] = coordMatch.map(Number);

        if ([x, y, z].every(v => !isNaN(v))) {
          console.log(`🧭 ${username} requested bot to travel to: (${x}, ${y}, ${z})`);

          const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
          bot.pathfinder.setGoal(goal);
          bot.chat("On my way! This might take a while...");
        } else {
          bot.chat(`⚠️ Invalid coordinates given.`);
        }
      } else {
        bot.chat("Looks like you're too far away or I couldn't understand those coordinates. You need to use F3 to find your coordinates and tell me where to go. Like this: @Bot come here x:0,y:0,z:0");
      }
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

    if (steps.length === 0) {
      //get the build steps from the AI
      const rawSteps = await getStructureFromAI(prompt) // from ai-agent.js

      try {
        steps = JSON.parse(rawSteps)

        // fs.writeFileSync(`ai-build-structures.log`, JSON.stringify(steps))
      } catch (error) {
        steps = []
        console.error(`❌ Could not parse AI commands as JSON: ${error.stack}`)
      }
    }

    if (steps.length > 0) {
      //check build size, if user's tier too low, reject it
      if (overTierLimit({ commander, numBlocks: steps.length })) {
        bot.chat(`⚠️ Commander's tier (${commander.tier}) is too low for ${steps.length} blocks to be placed.`)
        console.log(`⚠️ Commander's tier (${commander.tier}) is too low for ${steps.length} blocks to be placed.`)
        return
      }

      // adjust our steps to be relative to the bot's position
      const adjustedCommands = offsetStructure(steps, { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }, { x: 2, y: 0, z: 2 });

      //disable, the AI should be doing this
      //sort commands by height -- disallow floating blocks
      // adjustedCommands.sort((a, b) => a.y - b.y);

      //clear the inventory first before a build
      await bot.creative.clearInventory()

      //finalize the command set
      await executeCommands(bot, adjustedCommands, (event) => {
        if (event.type === 'block_placed') {
          // don't spam the server
          // bot.chat(`✅ Placed ${event.block} at (${event.x}, ${event.y}, ${event.z})`);
          console.log(`✅ Placed ${event.block} at (${event.x}, ${event.y}, ${event.z})`);
        } else if (event.type === 'error') {
          // don't spam the server
          // bot.chat(`❌ Could not place block. ${event.error}`);
          console.log(`❌ Failed: ${event.error}`);
        }
      });
    } else {
      bot.chat(`❌ I couldn't understand how to build that. Try something simpler like "build a cube" or "build a house".`);
      console.log(`❌ No structure received from AI or failed to parse`);
    }

    return;
  }

  bot.chat("❓ Unknown command.");
}
