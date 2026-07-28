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

test('validateInstructionPlan applies blocked-block policy to flatten fill blocks', () => {
    const commandBlockResult = validateInstructionPlan({
        planPayload: {
            actions: [
                {
                    type: 'flatten_area',
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 2,
                    length: 2,
                    fillBlock: 'command_block',
                },
            ],
        },
        tier: 'free',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 50,
            maxBuildVolume: 5000,
            allowCommandBlocks: false,
        },
    });
    const blockedResult = validateInstructionPlan({
        planPayload: {
            actions: [
                {
                    type: 'flatten_area',
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 2,
                    length: 2,
                    fillBlock: 'barrier',
                },
            ],
        },
        tier: 'admin',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 6000,
            maxBuildVolume: 95000,
            allowCommandBlocks: true,
        },
    });

    assert.equal(commandBlockResult.valid, false);
    assert.equal(commandBlockResult.errors.some((error) => (
        error.code === 'command_block_not_allowed' && error.field === 'fillBlock'
    )), true);
    assert.equal(blockedResult.valid, false);
    assert.equal(blockedResult.errors.some((error) => (
        error.code === 'blocked_block_type' && error.field === 'fillBlock'
    )), true);
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

test('validateInstructionPlan enforces prep action count and prep volume limits', () => {
    const result = validateInstructionPlan({
        planPayload: {
            actions: [
                { type: 'prepare_site', label: 'a' },
                { type: 'prepare_site', label: 'b' },
                { type: 'prepare_site', label: 'c' },
                { type: 'prepare_site', label: 'd' },
                { type: 'flatten_area', x: 0, y: 64, z: 0, width: 20, length: 20, targetY: 64, fillBlock: 'dirt' },
            ],
        },
        tier: 'free',
        tierFeaturePolicy: {
            maxBlocksPerBuild: 50,
            maxBuildVolume: 500,
            allowCommandBlocks: false,
            maxPrepActions: 3,
            maxPrepVolume: 120,
        },
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => error.code === 'prep_action_count_exceeded'), true);
    assert.equal(result.errors.some((error) => error.code === 'prep_volume_exceeded'), true);
});
