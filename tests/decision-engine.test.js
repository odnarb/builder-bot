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
      return { success: true, logs: [] };
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
    decisionPolicy: { maxReplanAttempts: 1 },
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
  assert.equal(result.failureReason, 'max_replan_attempts_reached');
  assert.equal(patchRequests.length, 1);
});
