import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';
import { createLocalBuildPlan } from '../apps/bot/local-decision-planner.js';

function createBot() {
  return {
    entity: {
      position: new Vec3(0, 64, 0),
    },
  };
}

const buildOrigin = Object.freeze({ x: 0, y: 64, z: 0 });
const buildStartOffset = Object.freeze({ x: 2, y: 0, z: 2 });
const decisionPolicy = Object.freeze({
  maxPrepVolume: 512,
});

test('createLocalBuildPlan compiles known prompt to prep and anchored relative placements', () => {
  const plan = createLocalBuildPlan({
    prompt: 'cube',
    bot: createBot(),
    decisionPolicy,
    buildOrigin,
    buildStartOffset,
    worldContext: {
      anchorCandidates: [{ x: 10, y: 70, z: 20, score: 100 }],
    },
  });

  assert.equal(plan.source, 'local');
  assert.equal(plan.placementCount, 8);
  assert.equal(plan.tags.includes('source:local'), true);
  assert.equal(plan.steps[0].type, 'prepare_site');
  assert.equal(plan.steps.some((step) => step.type === 'flatten_area'), true);

  const firstPlacement = plan.steps.find((step) => step.block === 'minecraft:cobblestone');
  assert.deepEqual(
    { x: firstPlacement.x, y: firstPlacement.y, z: firstPlacement.z },
    { x: 8, y: 6, z: 18 },
  );
});

test('createLocalBuildPlan returns null for unknown prompts', () => {
  const plan = createLocalBuildPlan({
    prompt: 'make a custom dragon statue',
    bot: createBot(),
    decisionPolicy,
    buildOrigin,
    buildStartOffset,
    worldContext: {
      anchorCandidates: [{ x: 10, y: 70, z: 20, score: 100 }],
    },
  });

  assert.equal(plan, null);
});

test('createLocalBuildPlan handles sized local templates without AI', () => {
  const plan = createLocalBuildPlan({
    prompt: '8 by 2 wooden bridge',
    bot: createBot(),
    decisionPolicy,
    buildOrigin,
    buildStartOffset,
    worldContext: {
      anchorCandidates: [{ x: 0, y: 64, z: 0, score: 100 }],
    },
  });

  assert.equal(plan.source, 'local');
  assert.equal(plan.placementCount, 16);
  assert.equal(plan.steps.filter((step) => step.block === 'minecraft:oak_planks').length, 16);
});
