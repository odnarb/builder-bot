import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { normalizeInstructionPlan, toLegacyBlocksAndTags } from '../shared-utils/instruction-schema.js';
import { executeCommands } from './execute-commands.js';
import {
  createUserBuild,
  updateUserBuild,
  uploadBuildSteps,
  getStructureAndTagsFromAI,
  addLogEntry
} from './apiClient.js';

const USAGE_TIER_NAMES = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ADMIN: 'admin'
};

const USAGE_TIERS = {
  FREE: {
    maxBlocks: 50,
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

/**
 * Build a compact context snapshot for server-side AI injection.
 * @param {{ bot: any, commander: { tier: string }, prompt: string }} params
 * @returns {Record<string, unknown>}
 */
function buildAiContext({ bot, commander, prompt }) {
  const position = bot?.entity?.position;
  const inventoryItems = bot?.inventory?.items?.() || [];

  let nearbyBlockSummary = [];
  try {
    const nearby = bot.findBlocks({
      matching: block => block.name !== 'air',
      maxDistance: 8,
      count: 30,
    });

    const blockCountByName = {};
    for (const pos of nearby) {
      const block = bot.blockAt(pos);
      const name = block?.name || 'unknown';
      blockCountByName[name] = (blockCountByName[name] || 0) + 1;
    }

    nearbyBlockSummary = Object.entries(blockCountByName)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  } catch {
    nearbyBlockSummary = [];
  }

  const nearbyEntities = Object.values(bot?.entities || {})
    .filter(entity => entity && entity.position && entity.name !== bot.entity?.username)
    .map(entity => ({
      name: entity.displayName || entity.name || 'unknown',
      type: entity.type || 'unknown',
      distance: Number(bot.entity.position.distanceTo(entity.position).toFixed(2)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  return {
    identity: {
      userId: process.env.USER_ID || process.env.COMMANDER_UUID || null,
      tier: commander.tier,
    },
    bot: {
      position: position ? {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
      } : null,
      health: Number(bot?.health || 0),
      food: Number(bot?.food || 0),
      dimension: bot?.game?.dimension || null,
      biome: bot?.biome?.name || null,
    },
    inventory: inventoryItems.map(item => ({
      name: item.name,
      count: item.count,
      durabilityUsed: item.durabilityUsed,
      durability: item.durability,
    })),
    nearbyEntities,
    nearbyBlocks: nearbyBlockSummary,
    taskState: {
      task: 'build',
      promptChars: prompt.length,
      promptWords: prompt.trim().split(/\s+/).length,
    },
    usageCounters: {
      requestCount: 1,
    },
  };
}

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

  if (msg.startsWith('follow')) {
    const playerEntity = bot.players[username]?.entity;
    const distanceMatch = message.match(/follow\s*(\d+)?/i);
    const followDistance = distanceMatch?.[1] ? Math.max(1, Math.min(12, Number(distanceMatch[1]))) : 3;

    if (!playerEntity) {
      bot.chat("I can't find you to follow right now.");
      return;
    }

    const goal = new goals.GoalFollow(playerEntity, followDistance);
    bot.pathfinder.setGoal(goal, true);
    addLogEntry({
      type: "command",
      message: "follow",
      data: { username, followDistance },
      level: 0
    });
    bot.chat(`Following ${username} at distance ${followDistance}.`);
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
    const aiPayload = await getStructureAndTagsFromAI({
      message: prompt,
      tier: commander.tier,
      context: buildAiContext({ bot, commander, prompt }),
    })

    try {
      const normalizedPlan = normalizeInstructionPlan(aiPayload)
      const { blocks, tags } = toLegacyBlocksAndTags(normalizedPlan)
      steps = blocks

      await updateUserBuild({
        buildId,
        build: {
          event: "steps_parsed",
          blockCount: steps.length,
          tags,
          actionCount: normalizedPlan.actions.length,
        }
      })

    } catch (error) {
      steps = []
      bot.chat(`❌ Sorry, could not get a valid build from AI. This has been logged.`);

      //log the build error to the server
      await updateUserBuild({
        buildId,
        build: {
          error: error.stack,
          error_message: error.message
        }
      })

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

      bot.chat(`Giving self the materials needed for the build...`);

      // 1. Extract unique blocks from the command list
      const blockNames = [...new Set(adjustedCommands
        .filter(step => typeof step.block === 'string')
        .map(step => step.block.replace(/^minecraft:/, '')))];

      // 2. Give all blocks to the bot ahead of time
      for (const blockName of blockNames) {
        try {
          const itemId = bot.registry.itemsByName[blockName]?.id;
          if (itemId === undefined) {
            console.warn(`⚠️ Unknown block type: ${blockName}`);
            continue;
          }

          if (bot.creative?.give) {
            await bot.creative.give(itemId, 999);
          } else {
            bot.chat(`/give ${bot.username} minecraft:${blockName} 999`);
            await bot.waitForTicks(20);
          }

          console.log(`✅ Gave ${blockName}`);
        } catch (err) {
          console.warn(`❌ Failed to give ${blockName}: ${err.message}`);
        }
      }

      bot.chat(`Attempting to build...`);

      //finalize the command set
      await executeCommands({ bot, buildId, commands: adjustedCommands });
    } else {
      bot.chat(`❌ I couldn't understand how to build that. This has been logged.`);
      console.log(`❌ No structure received from AI or failed to parse`);

      await updateUserBuild({ buildId, build: { error: "build steps array empty" } })
    }

    return;
  }

  bot.chat("❓ Unknown command.");
}
