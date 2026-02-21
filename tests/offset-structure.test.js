import assert from 'node:assert/strict';
import test from 'node:test';

import { offsetStructure } from '../apps/shared-utils/offsetStructure.js';

test('offsetStructure applies origin and relative offsets and floors values', () => {
  const blocks = [{ x: 1.2, y: 2.9, z: -3.1, block: 'oak_planks' }];
  const origin = { x: 10.8, y: 64.2, z: -5.5 };
  const relativeOffset = { x: 0.5, y: 1.1, z: 2.7 };

  const adjusted = offsetStructure(blocks, origin, relativeOffset);

  assert.deepEqual(adjusted, [
    { x: 12, y: 68, z: -6, block: 'oak_planks' },
  ]);
});

test('offsetStructure treats missing relative offset fields as zero', () => {
  const blocks = [{ x: 0, y: 0, z: 0, block: 'stone' }];
  const origin = { x: 1, y: 2, z: 3 };

  const adjusted = offsetStructure(blocks, origin, { y: 4 });

  assert.deepEqual(adjusted, [{ x: 1, y: 6, z: 3, block: 'stone' }]);
});

test('offsetStructure does not mutate input blocks', () => {
  const blocks = [{ x: 1, y: 2, z: 3, block: 'dirt' }];
  const original = structuredClone(blocks);

  offsetStructure(blocks, { x: 5, y: 5, z: 5 }, { x: 1, y: 1, z: 1 });

  assert.deepEqual(blocks, original);
});

test('offsetStructure preserves non-placement action fields and only offsets coordinate actions', () => {
  const steps = [
    { type: 'move_to', x: 0, y: 1, z: 2 },
    { type: 'follow', target: 'Commander', distance: 4 },
    { type: 'stop' },
    { type: 'place_block', x: 1, y: 2, z: 3, block: 'minecraft:stone' },
  ];

  const adjusted = offsetStructure(steps, { x: 10, y: 64, z: -5 }, { x: 2, y: 0, z: 1 });

  assert.deepEqual(adjusted, [
    { type: 'move_to', x: 12, y: 65, z: -2 },
    { type: 'follow', target: 'Commander', distance: 4 },
    { type: 'stop' },
    { type: 'place_block', x: 13, y: 66, z: -1, block: 'minecraft:stone' },
  ]);
});
