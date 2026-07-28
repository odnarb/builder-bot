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
  MUTATION_LIMIT: 'ERR_MUTATION_LIMIT',
  VERIFY_MISMATCH: 'ERR_VERIFY_MISMATCH',
});

/**
 * Create one mutation ledger that can be reused across initial and patch attempts.
 * @param {{
 *   maxPrepEdits?: number,
 *   maxBlocksPerBuild?: number,
 * }} [decisionPolicy]
 * @returns {{
 *   limits: { prepEdits: number, placementWrites: number },
 *   used: {
 *     prepEdits: number,
 *     placementWrites: number,
 *     overwriteDigs: number,
 *     supportWrites: number,
 *   },
 * }}
 */
export function createExecutionLedger(decisionPolicy = {}) {
  const rawPrepLimit = Number(decisionPolicy?.maxPrepEdits);
  const rawPlacementLimit = Number(decisionPolicy?.maxBlocksPerBuild);

  return {
    limits: {
      prepEdits: Number.isFinite(rawPrepLimit)
        ? Math.max(0, Math.trunc(rawPrepLimit))
        : 256,
      placementWrites: Number.isFinite(rawPlacementLimit)
        ? Math.max(1, Math.trunc(rawPlacementLimit))
        : Number.MAX_SAFE_INTEGER,
    },
    used: {
      prepEdits: 0,
      placementWrites: 0,
      overwriteDigs: 0,
      supportWrites: 0,
    },
  };
}

/**
 * Conservatively reserve mutation budget before a world-edit attempt.
 * Failed calls keep their reservation because the remote world result may be uncertain.
 * @param {ReturnType<typeof createExecutionLedger>} ledger
 * @param {{
 *   prepEdits?: number,
 *   placementWrites?: number,
 *   overwriteDigs?: number,
 *   supportWrites?: number,
 * }} mutation
 * @returns {boolean}
 */
function reserveMutation(ledger, mutation = {}) {
  const prepEdits = Math.max(0, Math.trunc(Number(mutation.prepEdits) || 0));
  const placementWrites = Math.max(0, Math.trunc(Number(mutation.placementWrites) || 0));

  if (
    ledger.used.prepEdits + prepEdits > ledger.limits.prepEdits ||
    ledger.used.placementWrites + placementWrites > ledger.limits.placementWrites
  ) {
    return false;
  }

  ledger.used.prepEdits += prepEdits;
  ledger.used.placementWrites += placementWrites;
  ledger.used.overwriteDigs += Math.max(0, Math.trunc(Number(mutation.overwriteDigs) || 0));
  ledger.used.supportWrites += Math.max(0, Math.trunc(Number(mutation.supportWrites) || 0));
  return true;
}

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
 *   relativeCommands?: Array<Record<string, unknown>> | null,
 *   username?: string,
 *   decisionPolicy?: Record<string, unknown> | null,
 *   executionLedger?: ReturnType<typeof createExecutionLedger>,
 *   suppressCompletionChat?: boolean,
 * }} params
 * @returns {Promise<{
 *   success: boolean,
 *   logs: Array<Record<string, unknown>>,
 *   ledger: ReturnType<typeof createExecutionLedger>,
 *   verification: {
 *     expectedCount: number,
 *     verifiedCount: number,
 *     checkedTargets: Array<{ x: number, y: number, z: number, block: string, matches: boolean, observed: string }>,
 *     mismatches: Array<{ x: number, y: number, z: number, block: string, observed: string }>,
 *   },
 * }>}
 */
export async function executeCommands({
  bot,
  buildId,
  commands,
  relativeCommands = null,
  username = 'Commander',
  decisionPolicy = null,
  executionLedger = null,
  suppressCompletionChat = false,
}) {
  const stepsLog = []
  let buildSuccess = true

  const maxPathRetriesPerStep = Math.max(1, Math.min(8, Number(decisionPolicy?.maxPathRetriesPerStep || 2)));
  const ledger = executionLedger || createExecutionLedger(decisionPolicy || {});

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

  const requiredBlockNames = new Set();
  for (const step of commands) {
    if (typeof step?.block === 'string') {
      const blockName = normalizeBlockName(step.block);
      const current = bot.blockAt(new Vec3(step.x, step.y, step.z));
      if (current?.name !== blockName) {
        requiredBlockNames.add(blockName);
      }
    }
    if (typeof step?.fillBlock === 'string') {
      requiredBlockNames.add(normalizeBlockName(step.fillBlock));
    }
  }
  const inventoryNames = new Set(bot.inventory.items().map((item) => item.name));
  const missingMaterials = [...requiredBlockNames].filter((name) => !inventoryNames.has(name));
  if (missingMaterials.length > 0) {
    buildSuccess = false;
    pushError({
      code: ERROR_CODES.INVENTORY_MISSING,
      message: `Required build materials are unavailable: ${missingMaterials.join(', ')}.`,
      stepType: 'material_preflight',
      extra: { missingMaterials },
    });
  }

  const executableCommands = missingMaterials.length > 0 ? [] : commands;
  for (const step of executableCommands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      stepsLog.push({ type: 'moving_to', ...step })

      const maxAttempts = maxPathRetriesPerStep;
      let reachedGoal = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        bot.pathfinder.setGoal(goal);
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
        break;
      }
    } else if (step.type === 'clear_volume') {
      const result = await clearVolume(bot, step, {
        stepsLog,
        ledger,
      });
      if (!result.ok) {
        buildSuccess = false;
        pushError({
          code: result.code || ERROR_CODES.TARGET_OBSTRUCTED,
          message: result.message || 'clear_volume failed',
          stepType: 'clear_volume',
          step,
          extra: { edits: result.edits },
        });
        break;
      }
    } else if (step.type === 'flatten_area') {
      const result = await flattenArea(bot, step, {
        stepsLog,
        ledger,
      });
      if (!result.ok) {
        buildSuccess = false;
        pushError({
          code: result.code || ERROR_CODES.PREP_LIMIT,
          message: result.message || 'flatten_area failed',
          stepType: 'flatten_area',
          step,
          extra: { edits: result.edits },
        });
        break;
      }
    } else if (typeof step.block === 'string') {
      const blockName = step.block.replace(/^minecraft:/, '');
      const placement = await placeBlockWithOverwrite(bot, new Vec3(step.x, step.y, step.z), blockName, {
        allowOverwrite: true,
        autoSupport: true,
        stepsLog,
        ledger,
      });
      if (!placement.ok) {
        buildSuccess = false
        pushError({
          code: placement.code || ERROR_CODES.TARGET_OBSTRUCTED,
          message: placement.message || `Failed to place ${blockName}`,
          stepType: 'place_block',
          step,
        });
        if (
          placement.code === ERROR_CODES.INVENTORY_MISSING ||
          placement.code === ERROR_CODES.MUTATION_LIMIT
        ) {
          break;
        }
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
      break;
    }
  } //end comands set

  const expectedTargets = new Map();
  for (const [index, step] of commands.entries()) {
    if (typeof step?.block !== 'string') {
      continue;
    }
    const block = normalizeBlockName(step.block);
    const relativeStep = Array.isArray(relativeCommands) ? relativeCommands[index] : null;
    expectedTargets.set(`${step.x},${step.y},${step.z}`, {
      x: step.x,
      y: step.y,
      z: step.z,
      block,
      relativeTarget: relativeStep && typeof relativeStep.block === 'string'
        ? {
          x: relativeStep.x,
          y: relativeStep.y,
          z: relativeStep.z,
        }
        : null,
    });
  }

  const checkedTargets = [];
  const mismatches = [];
  for (const expected of expectedTargets.values()) {
    const observed = normalizeBlockName(
      bot.blockAt(new Vec3(expected.x, expected.y, expected.z))?.name,
      'air',
    );
    const matches = observed === expected.block;
    const checked = {
      x: expected.relativeTarget?.x ?? expected.x,
      y: expected.relativeTarget?.y ?? expected.y,
      z: expected.relativeTarget?.z ?? expected.z,
      block: expected.block,
      matches,
      observed,
      worldTarget: {
        x: expected.x,
        y: expected.y,
        z: expected.z,
      },
    };
    checkedTargets.push(checked);
    if (!matches) {
      mismatches.push(checked);
      stepsLog.push({
        type: 'error',
        code: ERROR_CODES.VERIFY_MISMATCH,
        stepType: 'verify',
        error: `Expected ${expected.block} but observed ${observed}.`,
        x: checked.x,
        y: checked.y,
        z: checked.z,
        block: expected.block,
        observed,
        worldTarget: checked.worldTarget,
      });
    }
  }

  if (mismatches.length > 0) {
    buildSuccess = false;
  }

  if (!suppressCompletionChat) {
    if (buildSuccess) {
      bot.chat(`📐 Build complete!`);
      console.log(`📐 Build complete!`);
    } else {
      bot.chat(`⚠️ Build finished with some errors. Check logs for details.`);
      console.warn(`⚠️ Build finished with one or more command failures.`);
    }
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
    ledger,
    verification: {
      expectedCount: checkedTargets.length,
      verifiedCount: checkedTargets.length - mismatches.length,
      checkedTargets,
      mismatches,
    },
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

/**
 * Clear loaded, diggable blocks inside a bounded volume.
 * @param {any} bot Mineflayer bot instance.
 * @param {Record<string, unknown>} step Normalized clear-volume action.
 * @param {{
 *   stepsLog?: Array<Record<string, unknown>> | null,
 *   ledger?: ReturnType<typeof createExecutionLedger>,
 * }} [options]
 * @returns {Promise<{ ok: boolean, edits: number, code?: string, message?: string }>}
 * @throws {Error} Only when an unexpected bot API error escapes the guarded dig calls.
 */
async function clearVolume(bot, step, options = {}) {
  const {
    stepsLog = null,
    ledger = createExecutionLedger(),
  } = options;

  const width = Math.max(1, Math.min(64, Number(step.width) || 1));
  const height = Math.max(1, Math.min(32, Number(step.height) || 1));
  const length = Math.max(1, Math.min(64, Number(step.length) || 1));
  let edits = 0;

  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dz = 0; dz < length; dz += 1) {
        const pos = new Vec3(step.x + dx, step.y + dy, step.z + dz);
        const block = bot.blockAt(pos);
        if (!block || block.name === 'air') {
          continue;
        }
        if (!canDig(bot, block)) {
          return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot dig target block', edits };
        }

        if (!reserveMutation(ledger, { prepEdits: 1 })) {
          return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
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

/**
 * Clear headroom and create a bounded support plane.
 * @param {any} bot Mineflayer bot instance.
 * @param {Record<string, unknown>} step Normalized flatten action.
 * @param {{
 *   stepsLog?: Array<Record<string, unknown>> | null,
 *   ledger?: ReturnType<typeof createExecutionLedger>,
 * }} [options]
 * @returns {Promise<{ ok: boolean, edits: number, code?: string, message?: string }>}
 * @throws {Error} Only when an unexpected bot API error escapes guarded world edits.
 */
async function flattenArea(bot, step, options = {}) {
  const {
    stepsLog = null,
    ledger = createExecutionLedger(),
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
        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);
        if (!block || block.name === 'air') {
          continue;
        }

        if (!canDig(bot, block)) {
          return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot clear flatten_area obstruction', edits };
        }

        if (!reserveMutation(ledger, { prepEdits: 1 })) {
          return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
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

      const basePos = new Vec3(x, targetY, z);
      const existing = bot.blockAt(basePos);
      if (!existing || existing.name === 'air' || existing.name !== fillBlock) {
        if (existing && existing.name !== 'air' && existing.name !== fillBlock) {
          if (!canDig(bot, existing)) {
            return { ok: false, code: ERROR_CODES.TARGET_OBSTRUCTED, message: 'cannot dig non-fill base block', edits };
          }
          if (!reserveMutation(ledger, { prepEdits: 1, overwriteDigs: 1 })) {
            return { ok: false, code: ERROR_CODES.PREP_LIMIT, message: 'prep edit limit reached', edits };
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
          ledger,
          countsAsPrep: true,
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
 * @param {ReturnType<typeof createExecutionLedger>} [options.ledger] Shared mutation ledger.
 * @param {boolean} [options.countsAsPrep=false] Whether writes count toward prep budget.
 * @param {boolean} [options.isSupportWrite=false] Whether writes are automatic supports.
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 */
async function placeBlockWithOverwrite(bot, pos, blockName, options = {}) {
  const {
    allowOverwrite = true,
    skipIfAlreadyCorrect = true,
    maxDistance = 3.5,
    autoSupport = false,
    supportDepth = 4,
    stepsLog = null,
    ledger = createExecutionLedger(),
    countsAsPrep = false,
    isSupportWrite = false,
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
      if (!reserveMutation(ledger, { prepEdits: 1, overwriteDigs: 1 })) {
        return {
          ok: false,
          code: ERROR_CODES.MUTATION_LIMIT,
          message: 'destructive edit limit reached',
        };
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
      ledger,
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
    if (!reserveMutation(ledger, {
      prepEdits: countsAsPrep ? 1 : 0,
      placementWrites: 1,
      supportWrites: isSupportWrite ? 1 : 0,
    })) {
      return {
        ok: false,
        code: ERROR_CODES.MUTATION_LIMIT,
        message: 'placement mutation limit reached',
      };
    }

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

/**
 * Fill a bounded vertical support column below a placement target.
 * @param {any} bot Mineflayer bot instance.
 * @param {Vec3} pos Placement target.
 * @param {string} blockName Normalized material name.
 * @param {{
 *   maxDepth?: number,
 *   stepsLog?: Array<Record<string, unknown>> | null,
 *   ledger?: ReturnType<typeof createExecutionLedger>,
 * }} [options]
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 * @throws {Error} Only when an unexpected bot API error escapes guarded placement calls.
 */
async function ensureSupportColumn(bot, pos, blockName, options = {}) {
  const {
    maxDepth = 4,
    stepsLog = null,
    ledger = createExecutionLedger(),
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
      ledger,
      isSupportWrite: true,
    });

    if (!placed.ok) {
      return placed;
    }
  }

  return { ok: true };
}
