import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENGINE_STATES,
  runDecisionEngineBuild,
} from '../apps/bot/decision-engine.js';

test('runDecisionEngineBuild succeeds on first attempt when execution passes', async () => {
  const visitedStates = [];
  const executed = [];

  const result = await runDecisionEngineBuild({
    prompt: 'build a small hut',
    decisionPolicy: { maxReplanAttempts: 2 },
    initialCommands: [{ type: 'place_block', x: 0, y: 64, z: 0, block: 'minecraft:stone' }],
    onStateChange: ({ state }) => visitedStates.push(state),
    executePlan: async ({ commands, attemptNumber, replanCount }) => {
      executed.push({ attemptNumber, replanCount, commandCount: commands.length });
      return {
        success: true,
        logs: [],
        verification: {
          checkedTargets: [{
            x: 0,
            y: 64,
            z: 0,
            block: 'stone',
            observed: 'stone',
            matches: true,
          }],
        },
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.state, ENGINE_STATES.DONE);
  assert.equal(result.replanCount, 0);
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(executed, [{ attemptNumber: 1, replanCount: 0, commandCount: 1 }]);
  assert.equal(visitedStates.includes(ENGINE_STATES.PRECHECK), true);
  assert.equal(visitedStates.includes(ENGINE_STATES.VERIFY), true);
  assert.equal(visitedStates.includes(ENGINE_STATES.DONE), true);
});

test('runDecisionEngineBuild requests a patch replan after failure and then succeeds', async () => {
  let executeCalls = 0;
  const patchRequests = [];

  const result = await runDecisionEngineBuild({
    prompt: 'build bridge',
    decisionPolicy: { maxReplanAttempts: 2 },
    initialCommands: [{ type: 'move_to', x: 1, y: 64, z: 1 }],
    executePlan: async ({ commands }) => {
      executeCalls += 1;
      if (executeCalls === 1) {
        return {
          success: false,
          logs: [{
            type: 'error',
            code: 'ERR_PATH_TIMEOUT',
            stepType: 'move_to',
            error: 'move timeout',
          }],
        };
      }

      return {
        success: true,
        logs: [{ type: 'executed', count: commands.length }],
        verification: {
          checkedTargets: commands
            .filter((command) => typeof command.block === 'string')
            .map((command) => ({
              ...command,
              block: command.block.replace(/^minecraft:/, ''),
              observed: command.block.replace(/^minecraft:/, ''),
              matches: true,
            })),
        },
      };
    },
    requestPatchPlan: async (params) => {
      patchRequests.push(params);
      return {
        commands: [{ type: 'place_block', x: 0, y: 64, z: 0, block: 'minecraft:cobblestone' }],
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.replanCount, 1);
  assert.equal(result.attempts.length, 2);
  assert.equal(patchRequests.length, 1);
  assert.equal(patchRequests[0].failureDigest[0].code, 'ERR_PATH_TIMEOUT');
  assert.equal(patchRequests[0].replanAttempt, 1);
});

test('runDecisionEngineBuild fails when max replan attempts are exhausted', async () => {
  const patchRequests = [];

  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: { maxReplanAttempts: 1, maxLocalRetries: 0 },
    initialCommands: [{ type: 'place_block', x: 0, y: 64, z: 0, block: 'minecraft:stone' }],
    executePlan: async () => ({
      success: false,
      logs: [{
        type: 'error',
        code: 'ERR_TARGET_OBSTRUCTED',
        stepType: 'place_block',
        error: 'blocked',
      }],
    }),
    requestPatchPlan: async (params) => {
      patchRequests.push(params);
      return [{ type: 'move_to', x: 0, y: 64, z: 0 }];
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.state, ENGINE_STATES.FAILED);
  assert.equal(result.replanCount, 1);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.failureReason, 'patch_replan_no_progress');
  assert.equal(patchRequests.length, 1);
});

test('runDecisionEngineBuild rejects a movement-only patch while placements remain unverified', async () => {
  let executeCalls = 0;
  let patchContext = null;
  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: {
      maxReplanAttempts: 1,
      maxLocalRetries: 0,
      maxBlocksPerBuild: 10,
      maxBuildVolume: 100,
    },
    initialCommands: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
    ],
    executePlan: async () => {
      executeCalls += 1;
      if (executeCalls === 1) {
        return {
          success: false,
          logs: [{
            type: 'error',
            code: 'ERR_TARGET_OBSTRUCTED',
            stepType: 'place_block',
            error: 'blocked',
          }],
          verification: {
            checkedTargets: [{
              x: 0,
              y: 0,
              z: 0,
              block: 'stone',
              observed: 'air',
              matches: false,
            }],
          },
        };
      }
      return { success: true, logs: [], verification: { checkedTargets: [] } };
    },
    requestPatchPlan: async (context) => {
      patchContext = context;
      return [{ type: 'move_to', x: 0, y: 0, z: 0 }];
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.lastResult.logs.some((entry) => entry.code === 'ERR_VERIFY_MISMATCH'), true);
  assert.deepEqual(patchContext.remainingTargets, [
    { x: 0, y: 0, z: 0, block: 'stone' },
  ]);
});

test('runDecisionEngineBuild does not replan terminal execution failures', async () => {
  let patchRequests = 0;
  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: { maxReplanAttempts: 2 },
    initialCommands: [{ type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' }],
    executePlan: async () => ({
      success: false,
      logs: [{
        type: 'error',
        code: 'ERR_INVENTORY_MISSING',
        stepType: 'place_block',
        error: 'missing stone',
      }],
    }),
    requestPatchPlan: async () => {
      patchRequests += 1;
      return [{ type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' }];
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'terminal_execution_failure');
  assert.equal(patchRequests, 0);
});

test('runDecisionEngineBuild enforces cumulative initial and patch placement caps', async () => {
  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: {
      maxReplanAttempts: 1,
      maxLocalRetries: 0,
      maxBlocksPerBuild: 2,
      maxBuildVolume: 100,
    },
    initialCommands: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
      { type: 'place_block', x: 1, y: 0, z: 0, block: 'minecraft:stone' },
    ],
    executePlan: async () => ({
      success: false,
      logs: [{
        type: 'error',
        code: 'ERR_TARGET_OBSTRUCTED',
        stepType: 'place_block',
        error: 'blocked',
      }],
    }),
    requestPatchPlan: async () => [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
    ],
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'patch_plan_budget_exceeded');
});

test('runDecisionEngineBuild retries unresolved placements locally before requesting AI', async () => {
  let executeCalls = 0;
  let patchRequests = 0;
  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: {
      maxReplanAttempts: 1,
      maxLocalRetries: 1,
      maxBlocksPerBuild: 10,
      maxBuildVolume: 100,
    },
    initialCommands: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
    ],
    executePlan: async ({ commands, localRetryCount }) => {
      executeCalls += 1;
      if (localRetryCount === 0) {
        return {
          success: false,
          logs: [{
            type: 'error',
            code: 'ERR_VERIFY_MISMATCH',
            stepType: 'verify',
            error: 'ghost placement',
            x: 0,
            y: 0,
            z: 0,
          }],
          verification: {
            checkedTargets: [{
              x: 0,
              y: 0,
              z: 0,
              block: 'stone',
              observed: 'air',
              matches: false,
            }],
          },
        };
      }

      return {
        success: true,
        logs: [],
        verification: {
          checkedTargets: commands.map((command) => ({
            x: command.x,
            y: command.y,
            z: command.z,
            block: 'stone',
            observed: 'stone',
            matches: true,
          })),
        },
      };
    },
    requestPatchPlan: async () => {
      patchRequests += 1;
      return [];
    },
  });

  assert.equal(result.success, true);
  assert.equal(executeCalls, 2);
  assert.equal(patchRequests, 0);
  assert.equal(result.attempts[1].localRetryCountAtStart, 1);
});

test('runDecisionEngineBuild rejects patches that replay completed placements', async () => {
  let patchContext = null;
  const result = await runDecisionEngineBuild({
    prompt: 'build wall',
    decisionPolicy: {
      maxReplanAttempts: 1,
      maxLocalRetries: 0,
      maxBlocksPerBuild: 10,
      maxBuildVolume: 100,
    },
    initialCommands: [
      { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
      { type: 'place_block', x: 1, y: 0, z: 0, block: 'minecraft:stone' },
    ],
    executePlan: async () => ({
      success: false,
      logs: [{
        type: 'error',
        code: 'ERR_VERIFY_MISMATCH',
        stepType: 'verify',
        error: 'one placement missing',
        x: 1,
        y: 0,
        z: 0,
      }],
      verification: {
        checkedTargets: [
          {
            x: 0,
            y: 0,
            z: 0,
            block: 'stone',
            observed: 'stone',
            matches: true,
          },
          {
            x: 1,
            y: 0,
            z: 0,
            block: 'stone',
            observed: 'air',
            matches: false,
          },
        ],
      },
    }),
    requestPatchPlan: async (context) => {
      patchContext = context;
      return [
        { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
      ];
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'patch_replays_completed_target');
  assert.deepEqual(patchContext.completedTargets, [
    { x: 0, y: 0, z: 0, block: 'stone' },
  ]);
  assert.deepEqual(patchContext.remainingTargets, [
    { x: 1, y: 0, z: 0, block: 'stone' },
  ]);
});
