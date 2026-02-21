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
 * Run a deterministic, bounded decision loop for build execution.
 * @param {{
 *   prompt: string,
 *   decisionPolicy?: { maxReplanAttempts?: number },
 *   initialCommands: Array<Record<string, unknown>>,
 *   executePlan: (params: {
 *     commands: Array<Record<string, unknown>>,
 *     attemptNumber: number,
 *     replanCount: number,
 *   }) => Promise<{ success: boolean, logs?: Array<Record<string, unknown>> }>,
 *   requestPatchPlan?: (params: {
 *     attemptNumber: number,
 *     replanAttempt: number,
 *     maxReplanAttempts: number,
 *     failureDigest: Array<{ code: string, stepType: string, message: string }>,
 *     lastResult: { success: boolean, logs?: Array<Record<string, unknown>> } | null,
 *     attempts: Array<Record<string, unknown>>,
 *   }) => Promise<Array<Record<string, unknown>> | { commands: Array<Record<string, unknown>>, meta?: Record<string, unknown> } | null>,
 *   onStateChange?: (state: { state: string, attemptNumber: number, replanCount: number, [key: string]: unknown }) => void,
 * }} params
 * @returns {Promise<{
 *   success: boolean,
 *   state: string,
 *   replanCount: number,
 *   maxReplanAttempts: number,
 *   attempts: Array<{
 *     attemptNumber: number,
 *     replanCountAtStart: number,
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
  const attempts = [];

  let currentCommands = initialCommands;
  let replanCount = 0;
  let attemptNumber = 0;
  let lastResult = null;

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
      commandCount: currentCommands.length,
    });

    try {
      lastResult = await executePlan({
        commands: currentCommands,
        attemptNumber,
        replanCount,
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

    const failureDigest = buildFailureDigest(lastResult?.logs, 8);
    attempts.push({
      attemptNumber,
      replanCountAtStart: replanCount,
      commandCount: currentCommands.length,
      success: Boolean(lastResult?.success),
      errorCodes: failureDigest.map((entry) => entry.code),
    });

    emitState(onStateChange, ENGINE_STATES.VERIFY, {
      attemptNumber,
      replanCount,
      success: Boolean(lastResult?.success),
      failureDigest,
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
        maxReplanAttempts,
        attempts,
        lastResult,
      };
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
        maxReplanAttempts,
        attempts,
        lastResult,
        failureReason: 'patch_replan_empty_plan',
      };
    }

    currentCommands = normalizedPatch.commands;
    replanCount += 1;
  }
}
