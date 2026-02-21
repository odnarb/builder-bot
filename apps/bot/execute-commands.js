import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
import { updateUserBuild, uploadBuildLogs } from './apiClient.js';
import { appendDecisionFailure } from './world-context.js';
const { goals } = pkg;

const ERROR_CODES = Object.freeze({
  NO_SUPPORT: 'ERR_NO_SUPPORT',
  PATH_TIMEOUT: 'ERR_PATH_TIMEOUT',
  TARGET_OBSTRUCTED: 'ERR_TARGET_OBSTRUCTED',
  INVENTORY_MISSING: 'ERR_INVENTORY_MISSING',
  UNREACHABLE: 'ERR_UNREACHABLE',
  PREP_LIMIT: 'ERR_PREP_LIMIT',
});

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
export async function executeCommands({ bot, buildId, commands, username = 'Commander', decisionPolicy = null }) {
  const stepsLog = []
  let buildSuccess = true
  let prepEdits = 0;

  const maxPathRetriesPerStep = Math.max(1, Math.min(8, Number(decisionPolicy?.maxPathRetriesPerStep || 2)));
  const maxPrepEdits = Math.max(8, Number(decisionPolicy?.maxPrepEdits || 256));

  const pushError = ({ code, message, stepType = 'unknown', step = {}, extra = {} }) => {
    const payload = {
      type: 'error',
      code,
      error: message,
      stepType,
      ...step,
      ...extra,
    };
    stepsLog.push(payload);
    appendDecisionFailure(bot, {
      code,
      message,
      stepType,
      context: {
        ...step,
        ...extra,
      },
    });
  };

  for (const step of commands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      bot.pathfinder.setGoal(goal);
      stepsLog.push({ type: 'moving_to', ...step })

      const maxAttempts = maxPathRetriesPerStep;
      let reachedGoal = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await new Promise(resolve => {
          let resolved = false;
          let onGoalReached = null;
          const timeoutId = setTimeout(() => {
            if (resolved) {
              return;
            }
            resolved = true;
            if (onGoalReached && typeof bot.removeListener === 'function') {
              bot.removeListener('goal_reached', onGoalReached);
            }
            resolve();
          }, 12000);

          onGoalReached = () => {
            if (resolved) {
              return;
            }
            clearTimeout(timeoutId);
            resolved = true;
            reachedGoal = true;
            stepsLog.push({ type: 'goal_reached', attempt, ...step })
            resolve();
          };

          bot.once('goal_reached', onGoalReached);
        });
        if (reachedGoal) {
          break;
        }
        stepsLog.push({ type: 'path_retry', attempt, ...step });
      }

      if (!reachedGoal) {
        buildSuccess = false;
        pushError({
          code: ERROR_CODES.PATH_TIMEOUT,
          message: 'move_to timeout',
          stepType: 'move_to',
          step,
        });
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
        pushError({
          code: ERROR_CODES.UNREACHABLE,
          message: `follow target not found: ${targetPlayerName}`,
          stepType: 'follow',
          step,
        });
        continue;
      }

      const goal = new goals.GoalFollow(targetEntity, followDistance);
      bot.pathfinder.setGoal(goal, true);
      stepsLog.push({ type: 'following', target: targetPlayerName, distance: followDistance });
    } else if (step.type === 'stop') {
      bot.pathfinder.setGoal(null);
      stepsLog.push({ type: 'stopped' });
    } else if (step.type === 'prepare_site') {
      stepsLog.push({ type: 'prepare_site', label: step.label || 'default' });
    } else if (step.type === 'ensure_access') {
      const radius = Math.max(1, Math.min(16, Number(step.radius) || 2));
      try {
        await bot.pathfinder.goto(new goals.GoalNear(step.x, step.y, step.z, radius));
        stepsLog.push({ type: 'access_confirmed', x: step.x, y: step.y, z: step.z, radius });
      } catch (error) {
        buildSuccess = false;
        pushError({
          code: ERROR_CODES.UNREACHABLE,
          message: `ensure_access failed: ${error?.message || String(error)}`,
          stepType: 'ensure_access',
          step,
        });
      }
    } else if (step.type === 'clear_volume') {
      const result = await clearVolume(bot, step, {
        stepsLog,
        maxPrepEdits: Math.max(8, maxPrepEdits - prepEdits),
      });
      prepEdits += result.edits;
      if (!result.ok) {
        buildSuccess = false;
        pushError({
          code: result.code || ERROR_CODES.TARGET_OBSTRUCTED,
          message: result.message || 'clear_volume failed',
          stepType: 'clear_volume',
          step,
          extra: { edits: result.edits },
        });
      }
    } else if (step.type === 'flatten_area') {
      const result = await flattenArea(bot, step, {
        stepsLog,
        maxPrepEdits: Math.max(8, maxPrepEdits - prepEdits),
      });
      prepEdits += result.edits;
      if (!result.ok) {
        buildSuccess = false;
        pushError({
          code: result.code || ERROR_CODES.PREP_LIMIT,
          message: result.message || 'flatten_area failed',
          stepType: 'flatten_area',
          step,
          extra: { edits: result.edits },
        });
      }
    } else if (typeof step.block === 'string') {
      const blockName = step.block.replace(/^minecraft:/, '');
      const placement = await placeBlockWithOverwrite(bot, new Vec3(step.x, step.y, step.z), blockName, {
        allowOverwrite: true,
        autoSupport: true,
        stepsLog,
      });
      if (!placement.ok) {
        buildSuccess = false
        pushError({
          code: placement.code || ERROR_CODES.TARGET_OBSTRUCTED,
          message: placement.message || `Failed to place ${blockName}`,
          stepType: 'place_block',
          step,
        });
      }
    } else {
      console.warn('⚠️ Unknown instruction:', step);
      pushError({
        code: ERROR_CODES.TARGET_OBSTRUCTED,
        message: 'Unknown instruction',
        stepType: 'unknown',
        step,
      });
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

function normalizeBlockName(rawName, fallback = 'dirt') {
  const normalized = String(rawName || fallback).replace(/^minecraft:/, '').trim().toLowerCase();
  return normalized || fallback;
}

function canDig(bot, block) {
  if (!block || block.name === 'air') {
    return false;
  }
  if (typeof bot.canDigBlock === 'function') {
    return bot.canDigBlock(block);
  }
  return true;
}

async function clearVolume(bot, step, options = {}) {
  const {
    stepsLog = null,
    maxPrepEdits = 256,
  } = options;

  const width = Math.max(1, Math.min(64, Number(step.width) || 1));
  const height = Math.max(1, Math.min(32, Number(step.height) || 1));
  const length = Math.max(1, Math.min(64, Number(step.length) || 1));
  let edits = 0;

  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dz = 0; dz < length; dz += 1) {
        if (edits >= maxPrepEdits) {
          return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
        }

        const pos = new Vec3(step.x + dx, step.y + dy, step.z + dz);
        const block = bot.blockAt(pos);
        if (!block || block.name === 'air') {
          continue;
        }
        if (!canDig(bot, block)) {
          return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot dig target block', edits };
        }

        try {
          await bot.dig(block, true);
          edits += 1;
          stepsLog?.push({ type: 'block_cleared', pos, was: block.name });
        } catch (error) {
          return {
            ok: false,
            code: ERROR_CODES.TARGET_OBSTRUCTED,
            message: `clear_volume dig failed: ${error?.message || String(error)}`,
            edits,
          };
        }
      }
    }
  }

  return { ok: true, edits };
}

async function flattenArea(bot, step, options = {}) {
  const {
    stepsLog = null,
    maxPrepEdits = 256,
  } = options;

  const width = Math.max(1, Math.min(64, Number(step.width) || 1));
  const length = Math.max(1, Math.min(64, Number(step.length) || 1));
  const targetY = Number.isFinite(Number(step.targetY))
    ? Math.trunc(Number(step.targetY))
    : Math.trunc(Number(step.y || 0));
  const fillBlock = normalizeBlockName(step.fillBlock || step.block, 'dirt');
  const clearHeight = Math.max(1, Math.min(4, Number(step.clearHeight) || 2));
  let edits = 0;

  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < length; dz += 1) {
      const x = step.x + dx;
      const z = step.z + dz;

      for (let y = targetY + 1; y <= targetY + clearHeight; y += 1) {
        if (edits >= maxPrepEdits) {
          return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
        }

        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);
        if (!block || block.name === 'air') {
          continue;
        }

        if (!canDig(bot, block)) {
          return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot clear flatten_area obstruction', edits };
        }

        try {
          await bot.dig(block, true);
          edits += 1;
          stepsLog?.push({ type: 'flatten_cleared', pos, was: block.name });
        } catch (error) {
          return {
            ok: false,
            code: ERROR_CODES.TARGET_OBSTRUCTED,
            message: `flatten_area clear failed: ${error?.message || String(error)}`,
            edits,
          };
        }
      }

      if (edits >= maxPrepEdits) {
        return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
      }

      const basePos = new Vec3(x, targetY, z);
      const existing = bot.blockAt(basePos);
      if (!existing || existing.name === 'air' || existing.name !== fillBlock) {
        if (existing && existing.name !== 'air' && existing.name !== fillBlock) {
          if (!canDig(bot, existing)) {
            return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot dig non-fill base block', edits };
          }
          try {
            await bot.dig(existing, true);
            edits += 1;
            stepsLog?.push({ type: 'flatten_base_removed', pos: basePos, was: existing.name });
          } catch (error) {
            return {
              ok: false,
              code: ERROR_CODES.TARGET_OBSTRUCTED,
              message: `flatten_area base remove failed: ${error?.message || String(error)}`,
              edits,
            };
          }
        }

        const placement = await placeBlockWithOverwrite(bot, basePos, fillBlock, {
          allowOverwrite: false,
          autoSupport: true,
          stepsLog,
        });
        if (!placement.ok) {
          return { ok: false, code: placement.code, message: placement.message, edits };
        }
        edits += 1;
      }
    }
  }

  return { ok: true, edits };
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
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 */
async function placeBlockWithOverwrite(bot, pos, blockName, options = {}) {
  const {
    allowOverwrite = true,
    skipIfAlreadyCorrect = true,
    maxDistance = 3.5,
    autoSupport = false,
    supportDepth = 4,
    stepsLog = null
  } = options;

  const existing = bot.blockAt(pos);
  if (existing) {
    if (existing.name === blockName) {
      if (skipIfAlreadyCorrect) {
        console.log(`⏭️ ${blockName} already at ${pos}`);
        stepsLog?.push({ type: 'block_already_exists', block: blockName, pos });
        return { ok: true };
      }
    } else if (existing.name !== 'air' && allowOverwrite) {
      if (!canDig(bot, existing)) {
        stepsLog?.push({ type: 'error', code: ERROR_CODES.TARGET_OBSTRUCTED, error: 'cannot dig existing block', pos });
        return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot dig existing block' };
      }
      try {
        console.log(`🪓 Removing ${existing.name} at ${pos}`);
        await bot.dig(existing, true);
        await bot.waitForTicks(2);
        stepsLog?.push({ type: 'block_removed', was: existing.name, pos });
      } catch (err) {
        console.warn(`❌ Failed to dig ${pos}: ${err.message}`);
        stepsLog?.push({ type: 'error', code: ERROR_CODES.TARGET_OBSTRUCTED, error: `dig failed: ${err.message}`, pos });
        return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: `dig failed: ${err.message}` };
      }
    }
  }

  let below = bot.blockAt(pos.offset(0, -1, 0));
  if ((!below || below.name === 'air') && autoSupport) {
    const supportResult = await ensureSupportColumn(bot, pos, blockName, {
      maxDepth: supportDepth,
      stepsLog,
    });
    if (!supportResult.ok) {
      return supportResult;
    }
    below = bot.blockAt(pos.offset(0, -1, 0));
  }

  if (!below || below.name === 'air') {
    console.warn(`❌ No support below ${pos}`);
    stepsLog?.push({ type: 'error', code: ERROR_CODES.NO_SUPPORT, error: 'no support block below', pos });
    return { ok: false, code: ERROR_CODES.NO_SUPPORT, message: 'no support block below' };
  }

  const item = bot.inventory.items().find(i => i.name === blockName);
  if (!item) {
    console.warn(`❌ Missing item: ${blockName}`);
    stepsLog?.push({ type: 'error', code: ERROR_CODES.INVENTORY_MISSING, error: 'missing item in inventory', block: blockName, pos });
    return { ok: false, code: ERROR_CODES.INVENTORY_MISSING, message: `missing item in inventory: ${blockName}` };
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
    return { ok: true };
  } catch (err) {
    console.warn(`❌ Failed to place ${blockName} at ${pos}: ${err.message}`);
    stepsLog?.push({ type: 'error', code: ERROR_CODES.TARGET_OBSTRUCTED, error: `placement failed: ${err.message}`, block: blockName, pos });
    return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: `placement failed: ${err.message}` };
  }
}

async function ensureSupportColumn(bot, pos, blockName, options = {}) {
  const {
    maxDepth = 4,
    stepsLog = null,
  } = options;

  const directBelow = bot.blockAt(pos.offset(0, -1, 0));
  if (directBelow && directBelow.name !== 'air') {
    return { ok: true };
  }

  let solidY = null;
  for (let depth = 2; depth <= maxDepth + 1; depth += 1) {
    const candidate = bot.blockAt(pos.offset(0, -depth, 0));
    if (candidate && candidate.name !== 'air') {
      solidY = pos.y - depth;
      break;
    }
  }

  if (solidY === null) {
    stepsLog?.push({ type: 'error', code: ERROR_CODES.NO_SUPPORT, error: 'could not find support column base', pos });
    return { ok: false, code: ERROR_CODES.NO_SUPPORT, message: 'could not find support column base' };
  }

  for (let y = solidY + 1; y < pos.y; y += 1) {
    const fillPos = new Vec3(pos.x, y, pos.z);
    const existing = bot.blockAt(fillPos);
    if (existing && existing.name !== 'air') {
      continue;
    }

    const placed = await placeBlockWithOverwrite(bot, fillPos, blockName, {
      allowOverwrite: false,
      skipIfAlreadyCorrect: true,
      autoSupport: false,
      stepsLog,
      maxDistance: 4.5,
    });

    if (!placed.ok) {
      return placed;
    }
  }

  return { ok: true };
}
