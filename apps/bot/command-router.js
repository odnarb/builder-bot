import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { executeCommands } from './execute-commands.js';
import { getStructureFromAI } from '../cli/ai-agent.js';

const USAGE_TIER_NAMES = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ADMIN: 'admin'
};

const USAGE_TIERS = {
  FREE: {
    maxBlocks: 100,
    maxPromptChars: 80,
    maxPromptWords: 30,
  },
  STARTER: {
    maxBlocks: 500,
    maxPromptChars: 250,
    maxPromptWords: 50,
  },
  PRO: {
    maxBlocks: 2000,
    maxPromptChars: 1000,
    maxPromptWords: 150,
  },
  ADMIN: {
    maxBlocks: Infinity,
    maxPromptChars: 2000,
    maxPromptWords: 250,
  }
};

function overTierBlockLimit({ commander, numBlocks }) {
  return (commander.tier === USAGE_TIER_NAMES.FREE && numBlocks > USAGE_TIERS.FREE.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.STARTER && numBlocks > USAGE_TIERS.STARTER.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.PRO && numBlocks > USAGE_TIERS.PRO.maxBlocks ||
    commander.tier === USAGE_TIER_NAMES.ADMIN && numBlocks > USAGE_TIERS.ADMIN.maxBlocks
  )
}

function overTierPromptLimit({ commander, prompt }) {
  const numWords = prompt.trim().split(/\s+/).length
  const numChars = prompt.length
  return (
    commander.tier === USAGE_TIER_NAMES.FREE && numWords > USAGE_TIERS.FREE.maxPromptWords ||
    commander.tier === USAGE_TIER_NAMES.FREE && numChars > USAGE_TIERS.FREE.maxPromptChars ||
    commander.tier === USAGE_TIER_NAMES.STARTER && numWords > USAGE_TIERS.STARTER.maxPromptWords ||
    commander.tier === USAGE_TIER_NAMES.STARTER && numChars > USAGE_TIERS.STARTER.maxPromptChars ||
    commander.tier === USAGE_TIER_NAMES.PRO && numWords > USAGE_TIERS.PRO.maxPromptWords ||
    commander.tier === USAGE_TIER_NAMES.PRO && numChars > USAGE_TIERS.PRO.maxPromptChars ||
    commander.tier === USAGE_TIER_NAMES.ADMIN && numWords > USAGE_TIERS.ADMIN.maxPromptWords ||
    commander.tier === USAGE_TIER_NAMES.ADMIN && numChars > USAGE_TIERS.ADMIN.maxPromptChars
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

      addLogEntry({ type: "command", message: "move to", data: JSON.stringify(goal), level: 0 })

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

          addLogEntry({ type: "command", message: "move to specific x,y,z", data: JSON.stringify(goal), level: 0 })

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

    addLogEntry({ type: "command", message: "stop", data: bot.entity.position.floored(), level: 0 })

    return;
  }

  if (msg.startsWith('build ')) {
    const prompt = msg.slice(6);

    //check prompt before submitting
    if (overTierPromptLimit({ commander, prompt })) {
      bot.chat(`❌ Sorry, your prompt is too long for your tier "${commander.tier}"...`);
      console.warn(`⚠️ Prompt exceeded limits for tier "${commander.tier}". prompt length:${prompt.length} chars`);

      addLogEntry({
        type: "prompt_tier_limit",
        message: "user",
        data: {
          tier: commander.tier,
          prompt,
          charCount: prompt.length,
          wordCount: prompt.trim().split(/\s+/).length,
        },
        level: 1
      })

      return
    }

    bot.chat(`📐 Asking AI to generate build for: ${prompt}...`);
    console.log(`📐 Asking AI to generate build for: ${prompt}...`);

    const build = {
      type: "build",
      commanderUUID: process.env.COMMANDER_UUID,
      message: prompt,
      level: 0
    }

    //start the build and log an id
    const buildId = await createUserBuild({ build })

    let steps = []

    //get the build steps from the AI
    const rawSteps = await getStructureFromAI(prompt)

    try {
      steps = JSON.parse(rawSteps)

      const build = {
        event: "steps_parsed",
        blockCount: steps.length,
      }

      await updateUserBuild({ buildId, build })

    } catch (error) {
      steps = []
      bot.chat(`❌ Sorry, could not get a valid build from AI. This has been logged.`);

      //log the build error to the server
      const build = {
        error: error.stack,
        error_message: error.message
      }
      await updateUserBuild({ buildId, build })

      console.error(`❌ Could not parse AI commands as JSON: ${error.stack}`)
    }

    bot.chat(`💾 Saving build steps...`);

    //save steps to backend, later
    await uploadBuildSteps({ buildId, steps })

    if (steps.length > 0) {
      //check build size, if user's tier too low, reject it
      if (overTierBlockLimit({ commander, numBlocks: steps.length })) {
        bot.chat(`⚠️ User's tier (${commander.tier}) is too low for ${steps.length} blocks to be placed.`)
        console.log(`⚠️ User's tier (${commander.tier}) is too low for ${steps.length} blocks to be placed.`)

        //user hit tier limit, log this
        addLogEntry({ type: "block_tier_limit", message: "user", data: { tier: commander.tier, steps: steps.length }, level: 1 })

        return
      }

      // adjust our steps to be relative to the bot's position
      const adjustedCommands = offsetStructure(steps, { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }, { x: 2, y: 0, z: 2 });

      //clear the inventory first before a build
      await bot.creative.clearInventory()

      //finalize the command set
      await executeCommands({ bot, commands: adjustedCommands });
    } else {
      bot.chat(`❌ I couldn't understand how to build that. This has been logged.`);
      console.log(`❌ No structure received from AI or failed to parse`);

      await updateUserBuild({ buildId, build: { error: "build steps array empty" } })
    }

    return;
  }

  bot.chat("❓ Unknown command.");
}
