import assert from 'node:assert/strict';
import test from 'node:test';

import { validateInstructionPlan } from '../apps/api/utils/build-validator.js';

test('validateInstructionPlan accepts safe plan within tier limits', () => {
    const result = validateInstructionPlan({
        planPayload: {
            actions: [
                { type: 'move_to', x: 1, y: 2, z: 3 },
                { type: 'place_block', x: 0, y: 0, z: 0, block: 'oak_planks' },
            ],
            tags: ['house'],
        },
        tier: 'starter',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 500,
            maxBuildVolume: 5000,
            allowCommandBlocks: false,
        },
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.stats.placeBlockCount, 1);
    assert.equal(result.stats.fillVolume, 1);
});

test('validateInstructionPlan rejects command blocks for non-pro tiers and writes audit events', () => {
    const result = validateInstructionPlan({
        planPayload: {
            actions: [
                { type: 'place_block', x: 0, y: 0, z: 0, block: 'command_block' },
            ],
        },
        tier: 'free',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 50,
            maxBuildVolume: 5000,
            allowCommandBlocks: false,
        },
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => error.code === 'command_block_not_allowed'), true);
    assert.equal(result.audits.some((event) => event.type === 'command_block_denied'), true);
});

test('validateInstructionPlan enforces block count and volume limits', () => {
    const result = validateInstructionPlan({
        planPayload: {
            actions: [
                { type: 'place_block', x: 0, y: 0, z: 0, block: 'stone' },
                { type: 'place_block', x: 20, y: 20, z: 20, block: 'stone' },
            ],
        },
        tier: 'free',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 1,
            maxBuildVolume: 50,
            allowCommandBlocks: false,
        },
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => error.code === 'build_block_count_exceeded'), true);
    assert.equal(result.errors.some((error) => error.code === 'build_volume_exceeded'), true);
});

test('validateInstructionPlan rejects malformed payloads', () => {
    const result = validateInstructionPlan({
        planPayload: { tags: ['missing-actions'] },
        tier: 'starter',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 500,
            allowCommandBlocks: false,
        },
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, 'invalid_plan_payload');
});
