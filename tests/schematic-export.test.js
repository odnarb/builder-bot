import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';

import { exportInstructionPlanToSchematic } from '../apps/shared-utils/schematic-export.js';

test('exportInstructionPlanToSchematic encodes placement actions as base64 artifact', () => {
  const artifact = exportInstructionPlanToSchematic({
    name: 'Watchtower',
    plan: {
      actions: [
        { type: 'move_to', x: 1, y: 2, z: 3 },
        { type: 'place_block', x: 0, y: 0, z: 0, block: 'minecraft:stone' },
      ],
      tags: ['tower'],
    },
    generatedAt: '2026-02-20T00:00:00Z',
  });

  assert.equal(artifact.filename, 'Watchtower.schematic');
  assert.equal(artifact.encoding, 'base64');

  const decoded = JSON.parse(Buffer.from(artifact.data, 'base64').toString('utf8'));
  assert.equal(decoded.format, 'minecraft-ai-schematic-v1');
  assert.equal(decoded.placementCount, 1);
  assert.equal(decoded.placements[0].block, 'minecraft:stone');
});
