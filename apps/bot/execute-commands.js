import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
import { updateUserBuild, uploadBuildLogs } from './apiClient.js';
const { goals } = pkg;

async function runBestEffortPersistence(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`⚠️ ${label} skipped: ${error.message}`);
    return null;
  }
}

function resolveFollowTargetName({ stepTarget, fallbackUsername }) {
  const normalizedTarget = typeof stepTarget === 'string' ? stepTarget.trim() : '';
  if (!normalizedTarget) {
    return fallbackUsername;
  }

  const lowered = normalizedTarget.toLowerCase();
  if (lowered === 'commander' || lowered === '@commander') {
    return fallbackUsername;
  }

  return normalizedTarget;
}

/**
 * Execute mixed movement/build actions against the bot.
 * @param {{
 *   bot: any,
 *   buildId?: string,
 *   commands: Array<Record<string, unknown>>,
 *   username?: string,
 * }} params
 * @returns {Promise<void>}
 */
export async function executeCommands({ bot, buildId, commands, username = 'Commander' }) {
  const stepsLog = []
  let buildSuccess = true

  for (const step of commands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      bot.pathfinder.setGoal(goal);
      stepsLog.push({ type: 'moving_to', ...step })

      const maxAttempts = 2;
      let reachedGoal = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await new Promise(resolve => {
          let resolved = false;
          const timeoutId = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }, 12000);

          bot.once('goal_reached', () => {
            if (!resolved) {
              clearTimeout(timeoutId);
              resolved = true;
              reachedGoal = true;
              stepsLog.push({ type: 'goal_reached', attempt, ...step })
              resolve();
            }
          });
        });
        if (reachedGoal) {
          break;
        }
        stepsLog.push({ type: 'path_retry', attempt, ...step });
      }

      if (!reachedGoal) {
        buildSuccess = false;
        stepsLog.push({ type: 'error', error: 'move_to timeout', ...step });
      }

    } else if (step.type === 'follow') {
      const targetPlayerName = resolveFollowTargetName({
        stepTarget: step.target,
        fallbackUsername: username,
      });
      const targetEntity = bot.players[targetPlayerName]?.entity;
      const followDistance = Math.max(1, Math.min(12, Number(step.distance) || 3));

      if (!targetEntity) {
        buildSuccess = false;
        stepsLog.push({ type: 'error', error: `follow target not found: ${targetPlayerName}` });
        continue;
      }

      const goal = new goals.GoalFollow(targetEntity, followDistance);
      bot.pathfinder.setGoal(goal, true);
      stepsLog.push({ type: 'following', target: targetPlayerName, distance: followDistance });
    } else if (step.type === 'stop') {
      bot.pathfinder.setGoal(null);
      stepsLog.push({ type: 'stopped' });
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

  if (buildSuccess) {
    bot.chat(`📐 Build complete!`);
    console.log(`📐 Build complete!`);
  } else {
    bot.chat(`⚠️ Build finished with some errors. Check logs for details.`);
    console.warn(`⚠️ Build finished with one or more command failures.`);
  }

  //update build success
  const build = {
    success: buildSuccess
  }
  if (buildId) {
    //update the final build
    await runBestEffortPersistence(
      'Update final build status',
      () => updateUserBuild({ buildId, build })
    )

    //update build log
    await runBestEffortPersistence(
      'Upload build execution logs',
      () => uploadBuildLogs({ buildId, logs: stepsLog })
    )
  }

  return {
    success: buildSuccess,
    logs: stepsLog,
  };
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
        return true;
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
