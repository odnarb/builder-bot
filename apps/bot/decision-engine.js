export const ENGINE_STATES = Object.freeze({
  PRECHECK: 'PRECHECK',
  SITE_SELECTION: 'SITE_SELECTION',
  SITE_PREP: 'SITE_PREP',
  BUILD_EXECUTION: 'BUILD_EXECUTION',
  VERIFY: 'VERIFY',
  PATCH_REPLAN: 'PATCH_REPLAN',
  DONE: 'DONE',
  FAILED: 'FAILED',
});

const PREP_ACTION_TYPES = new Set([
  'prepare_site',
  'flatten_area',
  'clear_volume',
  'ensure_access',
]);

const TERMINAL_FAILURE_CODES = new Set([
  'ERR_EXECUTION_THROW',
  'ERR_INVENTORY_MISSING',
  'ERR_MUTATION_LIMIT',
  'ERR_POLICY_DENIED',
  'ERR_PREP_LIMIT',
]);

const LOCALLY_RETRYABLE_FAILURE_CODES = new Set([
  'ERR_NO_SUPPORT',
  'ERR_TARGET_OBSTRUCTED',
  'ERR_VERIFY_MISMATCH',
]);

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function emitState(onStateChange, state, context = {}) {
  if (typeof onStateChange !== 'function') {
    return;
  }

  try {
    onStateChange({ state, ...context });
  } catch {
    // State-change handlers are diagnostics only; never fail execution on telemetry.
  }
}

function hasPrepActions(commands) {
  return commands.some((step) => PREP_ACTION_TYPES.has(String(step?.type || '').toLowerCase()));
}

function buildFailureDigest(logs, maxEntries = 8) {
  if (!Array.isArray(logs)) {
    return [];
  }

  return logs
    .filter((entry) => entry?.type === 'error' || typeof entry?.code === 'string')
    .map((entry) => ({
      code: String(entry?.code || 'ERR_UNKNOWN'),
      stepType: String(entry?.stepType || entry?.type || 'unknown'),
      message: String(entry?.error || entry?.message || 'execution failure').slice(0, 140),
      target: (
        Number.isFinite(Number(entry?.x)) &&
        Number.isFinite(Number(entry?.y)) &&
        Number.isFinite(Number(entry?.z))
      )
        ? {
          x: Number(entry.x),
          y: Number(entry.y),
          z: Number(entry.z),
        }
        : null,
    }))
    .slice(-Math.max(1, maxEntries));
}

function normalizePatchCommands(payload) {
  if (Array.isArray(payload)) {
    return { commands: payload, meta: {} };
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (Array.isArray(payload.commands)) {
    return {
      commands: payload.commands,
      meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    };
  }

  return null;
}

/**
 * Return placement actions from a command list.
 * @param {Array<Record<string, unknown>>} commands
 * @returns {Array<{ x: number, y: number, z: number, block: string }>}
 */
function getPlacementTargets(commands) {
  return commands
    .filter((command) => typeof command?.block === 'string')
    .map((command) => ({
      x: Number(command.x),
      y: Number(command.y),
      z: Number(command.z),
      block: String(command.block).replace(/^minecraft:/, '').toLowerCase(),
    }));
}

/**
 * Compute the bounding volume occupied by placement targets.
 * @param {Array<{ x: number, y: number, z: number }>} targets
 * @returns {number}
 */
function computePlacementVolume(targets) {
  if (targets.length === 0) {
    return 0;
  }

  const xs = targets.map((target) => target.x);
  const ys = targets.map((target) => target.y);
  const zs = targets.map((target) => target.z);
  return (
    (Math.max(...xs) - Math.min(...xs) + 1) *
    (Math.max(...ys) - Math.min(...ys) + 1) *
    (Math.max(...zs) - Math.min(...zs) + 1)
  );
}

/**
 * Run a deterministic, bounded decision loop for build execution.
 * @param {{
 *   prompt: string,
 *   decisionPolicy?: {
 *     maxReplanAttempts?: number,
 *     maxLocalRetries?: number,
 *     maxBlocksPerBuild?: number,
 *     maxBuildVolume?: number,
 *   },
 *   initialCommands: Array<Record<string, unknown>>,
 *   executePlan: (params: {
 *     commands: Array<Record<string, unknown>>,
 *     attemptNumber: number,
 *     replanCount: number,
 *     localRetryCount: number,
 *   }) => Promise<{ success: boolean, logs?: Array<Record<string, unknown>> }>,
 *   requestPatchPlan?: (params: {
 *     attemptNumber: number,
 *     replanAttempt: number,
 *     maxReplanAttempts: number,
 *     failureDigest: Array<{
 *       code: string,
 *       stepType: string,
 *       message: string,
 *       target: { x: number, y: number, z: number } | null,
 *     }>,
 *     lastResult: { success: boolean, logs?: Array<Record<string, unknown>> } | null,
 *     attempts: Array<Record<string, unknown>>,
 *     completedTargets: Array<{ x: number, y: number, z: number, block: string }>,
 *     remainingTargets: Array<{ x: number, y: number, z: number, block: string }>,
 *     remainingBudgets: { placementRequests: number, buildVolume: number },
 *   }) => Promise<Array<Record<string, unknown>> | { commands: Array<Record<string, unknown>>, meta?: Record<string, unknown> } | null>,
 *   onStateChange?: (state: { state: string, attemptNumber: number, replanCount: number, [key: string]: unknown }) => void,
 * }} params
 * @returns {Promise<{
 *   success: boolean,
 *   state: string,
 *   replanCount: number,
 *   localRetryCount: number,
 *   maxReplanAttempts: number,
 *   attempts: Array<{
 *     attemptNumber: number,
 *     replanCountAtStart: number,
 *     localRetryCountAtStart: number,
 *     commandCount: number,
 *     success: boolean,
 *     errorCodes: string[],
 *   }>,
 *   lastResult: { success: boolean, logs?: Array<Record<string, unknown>> } | null,
 *   failureReason?: string,
 * }>}
 */
export async function runDecisionEngineBuild({
  prompt = '',
  decisionPolicy = {},
  initialCommands,
  executePlan,
  requestPatchPlan = null,
  onStateChange = null,
}) {
  if (!Array.isArray(initialCommands) || initialCommands.length === 0) {
    emitState(onStateChange, ENGINE_STATES.FAILED, {
      attemptNumber: 0,
      replanCount: 0,
      reason: 'empty_initial_plan',
    });
    return {
      success: false,
      state: ENGINE_STATES.FAILED,
      replanCount: 0,
      localRetryCount: 0,
      maxReplanAttempts: 0,
      attempts: [],
      lastResult: null,
      failureReason: 'empty_initial_plan',
    };
  }

  if (typeof executePlan !== 'function') {
    throw new Error('runDecisionEngineBuild requires an executePlan callback.');
  }

  const maxReplanAttempts = clampInt(decisionPolicy?.maxReplanAttempts, 0, 8);
  const maxLocalRetries = clampInt(decisionPolicy?.maxLocalRetries ?? 1, 0, 2);
  const maxBlocksPerBuild = clampInt(
    decisionPolicy?.maxBlocksPerBuild ?? Number.MAX_SAFE_INTEGER,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const maxBuildVolume = clampInt(
    decisionPolicy?.maxBuildVolume ?? Number.MAX_SAFE_INTEGER,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const attempts = [];
  const initialTargets = getPlacementTargets(initialCommands);
  const requestedTargets = initialTargets.slice();
  let requestedPlacementCount = initialTargets.length;

  if (
    requestedPlacementCount > maxBlocksPerBuild ||
    computePlacementVolume(requestedTargets) > maxBuildVolume
  ) {
    emitState(onStateChange, ENGINE_STATES.FAILED, {
      attemptNumber: 0,
      replanCount: 0,
      reason: 'initial_plan_budget_exceeded',
    });
    return {
      success: false,
      state: ENGINE_STATES.FAILED,
      replanCount: 0,
      localRetryCount: 0,
      maxReplanAttempts,
      attempts,
      lastResult: null,
      failureReason: 'initial_plan_budget_exceeded',
    };
  }

  const remainingTargets = new Map(initialTargets.map((target) => [
    `${target.x},${target.y},${target.z}`,
    target,
  ]));
  const completedTargets = new Map();

  let currentCommands = initialCommands;
  let replanCount = 0;
  let localRetryCount = 0;
  let attemptNumber = 0;
  let lastResult = null;
  let previousFailureSignature = null;

  emitState(onStateChange, ENGINE_STATES.PRECHECK, {
    attemptNumber,
    replanCount,
    promptChars: String(prompt || '').length,
    commandCount: currentCommands.length,
  });

  while (true) {
    attemptNumber += 1;

    emitState(onStateChange, ENGINE_STATES.SITE_SELECTION, {
      attemptNumber,
      replanCount,
      commandCount: currentCommands.length,
    });

    if (hasPrepActions(currentCommands)) {
      emitState(onStateChange, ENGINE_STATES.SITE_PREP, {
        attemptNumber,
        replanCount,
      });
    }

    emitState(onStateChange, ENGINE_STATES.BUILD_EXECUTION, {
      attemptNumber,
      replanCount,
      localRetryCount,
      commandCount: currentCommands.length,
    });

    try {
      lastResult = await executePlan({
        commands: currentCommands,
        attemptNumber,
        replanCount,
        localRetryCount,
      });
    } catch (error) {
      lastResult = {
        success: false,
        logs: [{
          type: 'error',
          code: 'ERR_EXECUTION_THROW',
          stepType: 'execute_plan',
          error: String(error?.message || error || 'execution failure'),
        }],
      };
    }

    const checkedTargets = Array.isArray(lastResult?.verification?.checkedTargets)
      ? lastResult.verification.checkedTargets
      : [];
    for (const checked of checkedTargets) {
      const key = `${checked.x},${checked.y},${checked.z}`;
      const expected = remainingTargets.get(key);
      const observed = String(checked.observed || '').replace(/^minecraft:/, '').toLowerCase();
      if (expected && checked.matches === true && observed === expected.block) {
        remainingTargets.delete(key);
        completedTargets.set(key, expected);
      }
    }

    if (lastResult?.success && remainingTargets.size > 0) {
      lastResult = {
        ...lastResult,
        success: false,
        logs: [
          ...(Array.isArray(lastResult?.logs) ? lastResult.logs : []),
          {
            type: 'error',
            code: 'ERR_VERIFY_MISMATCH',
            stepType: 'verify',
            error: `${remainingTargets.size} expected placement target(s) remain unverified.`,
          },
        ],
      };
    }

    const failureDigest = buildFailureDigest(lastResult?.logs, 8);
    attempts.push({
      attemptNumber,
      replanCountAtStart: replanCount,
      localRetryCountAtStart: localRetryCount,
      commandCount: currentCommands.length,
      success: Boolean(lastResult?.success),
      errorCodes: failureDigest.map((entry) => entry.code),
    });

    emitState(onStateChange, ENGINE_STATES.VERIFY, {
      attemptNumber,
      replanCount,
      localRetryCount,
      success: Boolean(lastResult?.success),
      failureDigest,
      remainingTargetCount: remainingTargets.size,
    });

    if (lastResult?.success) {
      emitState(onStateChange, ENGINE_STATES.DONE, {
        attemptNumber,
        replanCount,
      });
      return {
        success: true,
        state: ENGINE_STATES.DONE,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
      };
    }

    const terminalFailure = failureDigest.some((entry) => TERMINAL_FAILURE_CODES.has(entry.code));
    if (terminalFailure) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'terminal_execution_failure',
        failureDigest,
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'terminal_execution_failure',
      };
    }

    const failureSignature = failureDigest
      .map((entry) => `${entry.code}:${entry.stepType}:${JSON.stringify(entry.target)}`)
      .sort()
      .join('|');
    if (replanCount > 0 && failureSignature && failureSignature === previousFailureSignature) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'patch_replan_no_progress',
        failureDigest,
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_replan_no_progress',
      };
    }
    previousFailureSignature = failureSignature;

    const canRetryLocally = (
      localRetryCount < maxLocalRetries &&
      failureDigest.length > 0 &&
      failureDigest.every((entry) => LOCALLY_RETRYABLE_FAILURE_CODES.has(entry.code)) &&
      remainingTargets.size > 0
    );
    if (canRetryLocally) {
      const retryCommands = currentCommands.filter((command) => (
        typeof command?.block === 'string' &&
        remainingTargets.has(`${command.x},${command.y},${command.z}`)
      ));
      if (retryCommands.length > 0) {
        currentCommands = retryCommands;
        localRetryCount += 1;
        continue;
      }
    }

    const canReplan = typeof requestPatchPlan === 'function' && replanCount < maxReplanAttempts;
    if (!canReplan) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: replanCount >= maxReplanAttempts
          ? 'max_replan_attempts_reached'
          : 'patch_replan_not_available',
        failureDigest,
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: replanCount >= maxReplanAttempts
          ? 'max_replan_attempts_reached'
          : 'patch_replan_not_available',
      };
    }

    emitState(onStateChange, ENGINE_STATES.PATCH_REPLAN, {
      attemptNumber,
      replanCount,
      nextReplanAttempt: replanCount + 1,
      failureDigest,
    });

    let patchResponse = null;
    try {
      patchResponse = await requestPatchPlan({
        attemptNumber,
        replanAttempt: replanCount + 1,
        maxReplanAttempts,
        failureDigest,
        lastResult,
        attempts: attempts.slice(),
        completedTargets: Array.from(completedTargets.values()),
        remainingTargets: Array.from(remainingTargets.values()),
        remainingBudgets: {
          placementRequests: Math.max(0, maxBlocksPerBuild - requestedPlacementCount),
          buildVolume: Math.max(0, maxBuildVolume - computePlacementVolume(requestedTargets)),
        },
      });
    } catch (error) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'patch_replan_request_failed',
        error: String(error?.message || error || 'patch replan request failed'),
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_replan_request_failed',
      };
    }

    const normalizedPatch = normalizePatchCommands(patchResponse);
    if (!normalizedPatch || normalizedPatch.commands.length === 0) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'patch_replan_empty_plan',
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_replan_empty_plan',
      };
    }

    const patchTargets = getPlacementTargets(normalizedPatch.commands);
    const replaysCompletedTarget = patchTargets.some((target) => (
      completedTargets.has(`${target.x},${target.y},${target.z}`)
    ));
    if (replaysCompletedTarget) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'patch_replays_completed_target',
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_replays_completed_target',
      };
    }

    const nextRequestedPlacementCount = requestedPlacementCount + patchTargets.length;
    const nextRequestedTargets = [...requestedTargets, ...patchTargets];
    if (
      nextRequestedPlacementCount > maxBlocksPerBuild ||
      computePlacementVolume(nextRequestedTargets) > maxBuildVolume
    ) {
      emitState(onStateChange, ENGINE_STATES.FAILED, {
        attemptNumber,
        replanCount,
        reason: 'patch_plan_budget_exceeded',
      });
      return {
        success: false,
        state: ENGINE_STATES.FAILED,
        replanCount,
        localRetryCount,
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_plan_budget_exceeded',
      };
    }

    requestedPlacementCount = nextRequestedPlacementCount;
    requestedTargets.push(...patchTargets);
    for (const target of patchTargets) {
      const key = `${target.x},${target.y},${target.z}`;
      if (!remainingTargets.has(key)) {
        remainingTargets.set(key, target);
      }
    }
    currentCommands = normalizedPatch.commands;
    replanCount += 1;
  }
}
