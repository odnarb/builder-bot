import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
import { updateUserBuild, uploadBuildLogs } from './apiClient.js';
const { goals } = pkg;

export async function executeCommands({ bot, buildId, commands }) {
  const stepsLog = []
  let buildSuccess = true

  for (const step of commands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      bot.pathfinder.setGoal(goal);
      stepsLog.push({ type: 'moving_to', ...step })

      await new Promise(resolve => {
        bot.once('goal_reached', () => {
          stepsLog.push({ type: 'goal_reached', ...step })
          resolve();
        });
      });

    } else if (typeof step.block === 'string') {
      const blockName = step.block.replace(/^minecraft:/, '');
      const placed = await placeBlockWithOverwrite(bot, new Vec3(step.x, step.y, step.z), blockName, {
        allowOverwrite: true,
        stepsLog
      });
      if (!placed) {
        buildSuccess = false
      }
    } else {
      console.warn('⚠️ Unknown instruction:', step);
      stepsLog.push({ type: 'error', error: 'Unknown instruction', ...step });
      buildSuccess = false
    }
  } //end comands set

  bot.chat(`📐 Build complete!`);
  console.log(`📐 Build complete!`);

  //update build success
  const build = {
    success: buildSuccess
  }
  //update the final build
  await updateUserBuild({ buildId, build })

  //update build log
  await uploadBuildLogs({ buildId, logs: stepsLog })
}

/**
 * Places a block at a given position, removing the existing block if necessary.
 * @param {Bot} bot - The mineflayer bot instance
 * @param {Vec3} pos - World position where block should be placed
 * @param {string} blockName - Block name (e.g. "oak_planks", no "minecraft:" prefix)
 * @param {object} [options] - Optional behavior flags
 * @param {boolean} [options.allowOverwrite=true] - Remove block if incorrect one exists
 * @param {boolean} [options.skipIfAlreadyCorrect=true] - Skip if correct block already present
 * @param {number} [options.maxDistance=3.5] - Max distance before moving
 * @param {Array} [options.stepsLog] - Optional stepsLog array to push logs into
 * @returns {Promise<boolean>} - Returns true if placed, false otherwise
 */
async function placeBlockWithOverwrite(bot, pos, blockName, options = {}) {
  const {
    allowOverwrite = true,
    skipIfAlreadyCorrect = true,
    maxDistance = 3.5,
    stepsLog = null
  } = options;

  const existing = bot.blockAt(pos);
  if (existing) {
    if (existing.name === blockName) {
      if (skipIfAlreadyCorrect) {
        console.log(`⏭️ ${blockName} already at ${pos}`);
        stepsLog?.push({ type: 'block_already_exists', block: blockName, pos });
        return false;
      }
    } else if (existing.name !== 'air' && allowOverwrite) {
      try {
        console.log(`🪓 Removing ${existing.name} at ${pos}`);
        await bot.dig(existing, true);
        await bot.waitForTicks(2);
        stepsLog?.push({ type: 'block_removed', was: existing.name, pos });
      } catch (err) {
        console.warn(`❌ Failed to dig ${pos}: ${err.message}`);
        stepsLog?.push({ type: 'error', error: `dig failed: ${err.message}`, pos });
        return false;
      }
    }
  }

  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.name === 'air') {
    console.warn(`❌ No support below ${pos}`);
    stepsLog?.push({ type: 'error', error: 'no support block below', pos });
    return false;
  }

  const item = bot.inventory.items().find(i => i.name === blockName);
  if (!item) {
    console.warn(`❌ Missing item: ${blockName}`);
    stepsLog?.push({ type: 'error', error: 'missing item in inventory', block: blockName, pos });
    return false;
  }

  try {
    await bot.equip(item, 'hand');

    const botPos = bot.entity.position.floored();
    if (botPos.equals(pos)) {
      await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z, 1));
    }

    if (bot.entity.position.distanceTo(pos) > maxDistance) {
      await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z, 1));
    }

    await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
    await bot.placeBlock(below, new Vec3(0, 1, 0));

    console.log(`✅ Placed ${blockName} at ${pos}`);
    stepsLog?.push({ type: 'block_placed', block: blockName, pos });
    return true;
  } catch (err) {
    console.warn(`❌ Failed to place ${blockName} at ${pos}: ${err.message}`);
    stepsLog?.push({ type: 'error', error: `placement failed: ${err.message}`, block: blockName, pos });
    return false;
  }
}
