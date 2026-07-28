import {
    getInstructionPlanStats,
    isCommandBlock,
    normalizeInstructionPlan,
} from '../../shared-utils/instruction-schema.js';

const HARD_COORDINATE_LIMIT = 2048;
const DEFAULT_MAX_FILL_VOLUME = 60_000;
const DEFAULT_MAX_MOVE_ACTIONS = 20;
const DEFAULT_MAX_PREP_ACTIONS = 12;
const DEFAULT_MAX_PREP_VOLUME_RATIO = 0.5;

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
 * Estimate prep volume impact for non-placement actions.
 * @param {Record<string, unknown>} action
 * @returns {number}
 */
function estimatePrepVolume(action) {
    if (action?.type === 'flatten_area') {
        return Math.max(0, Number(action.width || 0)) * Math.max(0, Number(action.length || 0));
    }

    if (action?.type === 'clear_volume') {
        return Math.max(0, Number(action.width || 0))
            * Math.max(0, Number(action.height || 0))
            * Math.max(0, Number(action.length || 0));
    }

    if (action?.type === 'ensure_access') {
        const radius = Math.max(0, Number(action.radius || 0));
        return Math.ceil(Math.PI * radius * radius);
    }

    return 0;
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
 *     prepActionCount: number,
 *     prepVolume: number,
 *   },
 *   errors: Array<{ code: string, message: string, actionIndex?: number, block?: string, field?: string }>,
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
                prepActionCount: 0,
                prepVolume: 0,
            },
            errors,
            warnings,
            audits,
        };
    }

    const maxBlocksPerBuild = Math.max(1, toFiniteNumber(tierFeaturePolicy?.maxBlocksPerBuild, 2000));
    const maxBuildVolume = Math.max(1, toFiniteNumber(tierFeaturePolicy?.maxBuildVolume, DEFAULT_MAX_FILL_VOLUME));
    const maxPrepActions = Math.max(1, toFiniteNumber(tierFeaturePolicy?.maxPrepActions, DEFAULT_MAX_PREP_ACTIONS));
    const maxPrepVolume = Math.max(
        1,
        Math.min(
            maxBuildVolume,
            toFiniteNumber(tierFeaturePolicy?.maxPrepVolume, Math.floor(maxBuildVolume * DEFAULT_MAX_PREP_VOLUME_RATIO)),
        ),
    );
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

    for (const [actionIndex, action] of normalizedPlan.actions.entries()) {
        const blockFields = action.type === 'place_block'
            ? [['block', action.block]]
            : (action.type === 'flatten_area' ? [['fillBlock', action.fillBlock]] : []);

        for (const [field, rawBlock] of blockFields) {
            const block = String(rawBlock || '').toLowerCase();
            if (ALWAYS_BLOCKED_BLOCKS.has(block)) {
                errors.push({
                    code: 'blocked_block_type',
                    message: `Block "${block}" is not allowed.`,
                    actionIndex,
                    block,
                    field,
                });
                audits.push({
                    type: 'blocked_block',
                    severity: 'warning',
                    message: `Blocked illegal block type "${block}" for tier ${tier}.`,
                    context: { tier, block, field, actionIndex },
                });
            }

            if (isCommandBlock(block) && !allowCommandBlocks) {
                errors.push({
                    code: 'command_block_not_allowed',
                    message: `Tier "${tier}" cannot use command blocks.`,
                    actionIndex,
                    block,
                    field,
                });
                audits.push({
                    type: 'command_block_denied',
                    severity: 'warning',
                    message: `Rejected command block use for tier ${tier}.`,
                    context: { tier, block, field, actionIndex },
                });
            }
        }
    }

    for (const [actionIndex, action] of normalizedPlan.actions.entries()) {
        if (
            action.type !== 'place_block' &&
            action.type !== 'move_to' &&
            action.type !== 'flatten_area' &&
            action.type !== 'clear_volume' &&
            action.type !== 'ensure_access'
        ) {
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

    const prepActions = normalizedPlan.actions.filter((action) => (
        action.type === 'prepare_site' ||
        action.type === 'flatten_area' ||
        action.type === 'clear_volume' ||
        action.type === 'ensure_access'
    ));
    const prepActionCount = prepActions.length;
    const prepVolume = prepActions.reduce((sum, action) => sum + estimatePrepVolume(action), 0);

    if (prepActionCount > maxPrepActions) {
        errors.push({
            code: 'prep_action_count_exceeded',
            message: `Plan has ${prepActionCount} prep actions; cap is ${maxPrepActions}.`,
        });
    }

    if (prepVolume > maxPrepVolume) {
        errors.push({
            code: 'prep_volume_exceeded',
            message: `Prep volume ${prepVolume} exceeds cap ${maxPrepVolume}.`,
        });
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
            prepActionCount,
            prepVolume,
        },
        errors,
        warnings,
        audits,
    };
}
