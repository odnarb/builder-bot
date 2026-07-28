import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import Vec3 from 'vec3';
import {
  appendDecisionFailure,
  buildDecisionWorldContext,
  ensurePathfinderTelemetry,
} from '../apps/bot/world-context.js';

function createMockBot() {
  const bot = new EventEmitter();
  bot.entity = {
    position: new Vec3(0, 64, 0),
  };
  bot.pathfinder = {
    movements: {},
    getPathTo: () => ({
      status: 'success',
      cost: 3,
      time: 12,
      visitedNodes: 20,
      generatedNodes: 30,
      path: [new Vec3(0, 64, 0), new Vec3(1, 64, 1)],
    }),
  };
  bot.blockAt = (pos) => {
    if (pos.y <= 63) {
      return { name: 'stone' };
    }
    return { name: 'air' };
  };
  bot.entities = {};
  return bot;
}

test('ensurePathfinderTelemetry collects path update/reset events', () => {
  const bot = createMockBot();
  ensurePathfinderTelemetry(bot);

  bot.emit('path_update', {
    status: 'success',
    cost: 4,
    time: 20,
    visitedNodes: 10,
    generatedNodes: 20,
    path: [1, 2, 3],
  });
  bot.emit('path_reset', 'stuck');
  bot.emit('goal_reached');

  const context = buildDecisionWorldContext({
    bot,
    prompt: 'build test',
    decisionPolicy: {
      maxScanRadius: 8,
      maxAnchorCandidates: 2,
      pathProbeTimeoutMs: 400,
    },
  });

  assert.equal(context.pathfinderDiagnostics.counters.goalReached >= 1, true);
  assert.equal(Array.isArray(context.pathfinderDiagnostics.recentResets), true);
  assert.equal(context.pathfinderDiagnostics.recentResets.length >= 1, true);
});

test('appendDecisionFailure contributes to failure digest', () => {
  const bot = createMockBot();
  appendDecisionFailure(bot, {
    code: 'ERR_PATH_TIMEOUT',
    stepType: 'move_to',
    message: 'Timed out',
  });

  const context = buildDecisionWorldContext({
    bot,
    prompt: 'build test',
    decisionPolicy: {
      maxScanRadius: 8,
      maxAnchorCandidates: 2,
      pathProbeTimeoutMs: 400,
    },
  });

  assert.equal(Array.isArray(context.failureDigest), true);
  assert.equal(context.failureDigest.length >= 1, true);
  assert.equal(context.failureDigest[0].code, 'ERR_PATH_TIMEOUT');
});

test('buildDecisionWorldContext checks the actual footprint and bounds path probes', () => {
  const bot = createMockBot();
  let probeCount = 0;
  bot.pathfinder.getPathTo = () => {
    probeCount += 1;
    return {
      status: 'success',
      cost: 1,
      time: 1,
      visitedNodes: 1,
      generatedNodes: 1,
      path: [new Vec3(0, 64, 0)],
    };
  };
  bot.blockAt = (pos) => {
    if (pos.x === 3 && pos.z === 0 && pos.y === 64) {
      return { name: 'lava' };
    }
    if (pos.y <= 63) {
      return { name: 'stone' };
    }
    return { name: 'air' };
  };

  const context = buildDecisionWorldContext({
    bot,
    prompt: 'build a wide floor',
    decisionPolicy: {
      maxScanRadius: 8,
      maxAnchorCandidates: 2,
      pathProbeTimeoutMs: 400,
      minAnchorScore: 45,
    },
    footprint: {
      minX: 0,
      maxX: 3,
      minZ: 0,
      maxZ: 0,
      height: 1,
    },
  });

  assert.equal(probeCount, 2);
  assert.equal(context.anchorCandidates.some((candidate) => (
    candidate.x === 0 && candidate.z === 0
  )), false);
});
