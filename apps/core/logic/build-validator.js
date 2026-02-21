import {
    getInstructionPlanStats,
    isCommandBlock,
    normalizeInstructionPlan,
} from '../../shared-utils/instruction-schema.js';

const HARD_COORDINATE_LIMIT = 2048;
const DEFAULT_MAX_FILL_VOLUME = 60_000;
const DEFAULT_MAX_MOVE_ACTIONS = 20;

const ALWAYS_BLOCKED_BLOCKS = new Set([
    'minecraft:barrier',
    'minecraft:bedrock',
    'minecraft:jigsaw',
    'minecraft:structure_block',
    'minecraft:structure_void',
]);

/**
 * Build a finite number or fall back to default.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

/**
 * Compute bounding-box volume for block placements.
 * @param {Array<{ x: number, y: number, z: number }>} placements
 * @returns {number}
 */
function computePlacementVolume(placements) {
    if (!Array.isArray(placements) || placements.length === 0) {
        return 0;
    }

    let minX = placements[0].x;
    let maxX = placements[0].x;
    let minY = placements[0].y;
    let maxY = placements[0].y;
    let minZ = placements[0].z;
    let maxZ = placements[0].z;

    for (const step of placements) {
        minX = Math.min(minX, step.x);
        maxX = Math.max(maxX, step.x);
        minY = Math.min(minY, step.y);
        maxY = Math.max(maxY, step.y);
        minZ = Math.min(minZ, step.z);
        maxZ = Math.max(maxZ, step.z);
    }

    return (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
}

/**
 * Validate a normalized instruction plan against safety and tier limits.
 * @param {{
 *   planPayload: unknown,
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   tierFeaturePolicy: {
 *     maxBlocksPerBuild?: number,
 *     maxBuildVolume?: number,
 *     allowCommandBlocks?: boolean,
 *   },
 * }} params
 * @returns {{
 *   valid: boolean,
 *   normalizedPlan: {
 *     schemaVersion: string,
 *     actions: Array<Record<string, unknown>>,
 *     tags: string[],
 *     sourceFormat: 'actions' | 'blocks',
 *   } | null,
 *   stats: {
 *     actionCount: number,
 *     placeBlockCount: number,
 *     moveCount: number,
 *     followCount: number,
 *     stopCount: number,
 *     fillVolume: number,
 *   },
 *   errors: Array<{ code: string, message: string, actionIndex?: number, block?: string }>,
 *   warnings: Array<{ code: string, message: string }>,
 *   audits: Array<{ type: string, severity: string, message: string, context: Record<string, unknown> }>,
 * }}
 */
export function validateInstructionPlan({ planPayload, tier, tierFeaturePolicy }) {
    const errors = [];
    const warnings = [];
    const audits = [];

    let normalizedPlan = null;
    try {
        normalizedPlan = normalizeInstructionPlan(planPayload);
    } catch (error) {
        errors.push({
            code: 'invalid_plan_payload',
            message: error.message || 'Invalid instruction payload.',
        });
        return {
            valid: false,
            normalizedPlan: null,
            stats: {
                actionCount: 0,
                placeBlockCount: 0,
                moveCount: 0,
                followCount: 0,
                stopCount: 0,
                fillVolume: 0,
            },
            errors,
            warnings,
            audits,
        };
    }

    const maxBlocksPerBuild = Math.max(1, toFiniteNumber(tierFeaturePolicy?.maxBlocksPerBuild, 2000));
    const maxBuildVolume = Math.max(1, toFiniteNumber(tierFeaturePolicy?.maxBuildVolume, DEFAULT_MAX_FILL_VOLUME));
    const allowCommandBlocks = tierFeaturePolicy?.allowCommandBlocks === true;
    const stats = getInstructionPlanStats(normalizedPlan);

    if (stats.placeBlockCount > maxBlocksPerBuild) {
        errors.push({
            code: 'build_block_count_exceeded',
            message: `Build has ${stats.placeBlockCount} blocks; tier cap is ${maxBlocksPerBuild}.`,
        });
    }

    if (stats.moveCount > DEFAULT_MAX_MOVE_ACTIONS) {
        warnings.push({
            code: 'excessive_movement_steps',
            message: `Plan has ${stats.moveCount} move steps; deterministic movement is recommended.`,
        });
    }

    const placementActions = normalizedPlan.actions
        .map((action, actionIndex) => ({ action, actionIndex }))
        .filter(({ action }) => action.type === 'place_block');

    for (const { action, actionIndex } of placementActions) {
        const block = String(action.block || '').toLowerCase();
        if (ALWAYS_BLOCKED_BLOCKS.has(block)) {
            errors.push({
                code: 'blocked_block_type',
                message: `Block "${block}" is not allowed.`,
                actionIndex,
                block,
            });
            audits.push({
                type: 'blocked_block',
                severity: 'warning',
                message: `Blocked illegal block type "${block}" for tier ${tier}.`,
                context: { tier, block, actionIndex },
            });
        }

        if (isCommandBlock(block) && !allowCommandBlocks) {
            errors.push({
                code: 'command_block_not_allowed',
                message: `Tier "${tier}" cannot place command blocks.`,
                actionIndex,
                block,
            });
            audits.push({
                type: 'command_block_denied',
                severity: 'warning',
                message: `Rejected command block placement for tier ${tier}.`,
                context: { tier, block, actionIndex },
            });
        }
    }

    for (const [actionIndex, action] of normalizedPlan.actions.entries()) {
        if (action.type !== 'place_block' && action.type !== 'move_to') {
            continue;
        }

        if (
            Math.abs(action.x) > HARD_COORDINATE_LIMIT ||
            Math.abs(action.y) > HARD_COORDINATE_LIMIT ||
            Math.abs(action.z) > HARD_COORDINATE_LIMIT
        ) {
            errors.push({
                code: 'coordinate_out_of_bounds',
                message: `Action coordinates exceed safe bounds (+/-${HARD_COORDINATE_LIMIT}).`,
                actionIndex,
            });
        }
    }

    const fillVolume = computePlacementVolume(placementActions.map(({ action }) => action));
    if (fillVolume > maxBuildVolume) {
        errors.push({
            code: 'build_volume_exceeded',
            message: `Build footprint volume ${fillVolume} exceeds cap ${maxBuildVolume}.`,
        });
    }

    return {
        valid: errors.length === 0,
        normalizedPlan,
        stats: {
            ...stats,
            fillVolume,
        },
        errors,
        warnings,
        audits,
    };
}
