import { parsePrompt } from '../../packages/prompt-parser/index.js';
import { buildDecisionWorldContext } from './world-context.js';

function finiteInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
}

function normalizeBlock(block) {
  const raw = String(block || '').replace(/^minecraft:/, '').trim().toLowerCase();
  return `minecraft:${raw || 'dirt'}`;
}

function getBotOrigin(bot) {
  const position = bot?.entity?.position;
  return {
    x: finiteInt(position?.x),
    y: finiteInt(position?.y, 64),
    z: finiteInt(position?.z),
  };
}

function getBounds(blocks) {
  const xs = blocks.map((block) => finiteInt(block.x));
  const ys = blocks.map((block) => finiteInt(block.y));
  const zs = blocks.map((block) => finiteInt(block.z));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs) + 1),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys) + 1),
    length: Math.max(1, Math.max(...zs) - Math.min(...zs) + 1),
  };
}

/**
 * Choose a safe anchor from footprint-aware world observations.
 * @param {{
 *   bot: any,
 *   decisionPolicy: Record<string, unknown>,
 *   footprint: { minX: number, maxX: number, minZ: number, maxZ: number, height: number },
 *   worldContext?: Record<string, unknown> | null,
 *   anchorIndex?: number,
 * }} params
 * @returns {Record<string, unknown>}
 * @throws {Error} When no safe candidate exists.
 */
function chooseAnchor({
  bot,
  decisionPolicy,
  footprint,
  worldContext = null,
  anchorIndex = 0,
}) {
  const context = worldContext || buildDecisionWorldContext({
    bot,
    prompt: '',
    decisionPolicy,
    footprint,
  });
  const candidates = Array.isArray(context?.anchorCandidates)
    ? context.anchorCandidates
    : [];
  const candidate = candidates[Math.max(0, Math.min(candidates.length - 1, anchorIndex))];

  if (candidate) {
    return {
      x: finiteInt(candidate.x),
      y: finiteInt(candidate.y, getBotOrigin(bot).y),
      z: finiteInt(candidate.z),
      source: 'world_context_anchor',
      score: Number(candidate.score || 0),
      feasibility: candidate.feasibility || null,
    };
  }

  const error = new Error('No safe build site was found within the configured scan area.');
  error.code = 'ERR_NO_SAFE_ANCHOR';
  throw error;
}

function toRelativeFromAnchor({ block, anchor, buildOrigin, buildStartOffset }) {
  return {
    x: finiteInt(anchor.x) - finiteInt(buildOrigin.x) - finiteInt(buildStartOffset.x) + finiteInt(block.x),
    y: finiteInt(anchor.y) - finiteInt(buildOrigin.y) - finiteInt(buildStartOffset.y) + finiteInt(block.y),
    z: finiteInt(anchor.z) - finiteInt(buildOrigin.z) - finiteInt(buildStartOffset.z) + finiteInt(block.z),
    block: normalizeBlock(block.block),
  };
}

/**
 * Compile a relative structure into bounded prep and placement actions.
 * @param {{
 *   structure: Array<Record<string, unknown>>,
 *   anchor: Record<string, unknown>,
 *   buildOrigin: Record<string, unknown>,
 *   buildStartOffset: Record<string, unknown>,
 *   decisionPolicy: Record<string, unknown>,
 * }} params
 * @returns {Array<Record<string, unknown>>}
 */
function compileActions({ structure, anchor, buildOrigin, buildStartOffset, decisionPolicy }) {
  const placements = structure.map((block) => toRelativeFromAnchor({
    block,
    anchor,
    buildOrigin,
    buildStartOffset,
  }));
  const bounds = getBounds(placements);
  const maxPrepVolume = Math.max(1, Number(decisionPolicy?.maxPrepVolume || 512));
  const clearHeight = Math.min(6, Math.max(2, bounds.height + 1));
  const clearVolume = bounds.width * clearHeight * bounds.length;

  const steps = [
    { type: 'prepare_site', label: 'local_template' },
    {
      type: 'ensure_access',
      x: bounds.minX,
      y: bounds.minY,
      z: bounds.minZ,
      radius: 3,
    },
  ];
  const feasibility = anchor?.feasibility;
  const needsSupportPrep = !feasibility || Number(feasibility.supportRatio) < 1;
  const needsClearPrep = !feasibility || Number(feasibility.obstructedRatio) > 0;

  if (needsSupportPrep) {
    steps.push({
      type: 'flatten_area',
      x: bounds.minX,
      y: bounds.minY - 1,
      z: bounds.minZ,
      width: bounds.width,
      length: bounds.length,
      targetY: bounds.minY - 1,
      fillBlock: 'minecraft:dirt',
    });
  }

  if (needsClearPrep && clearVolume <= maxPrepVolume) {
    steps.push({
      type: 'clear_volume',
      x: bounds.minX,
      y: bounds.minY,
      z: bounds.minZ,
      width: bounds.width,
      height: clearHeight,
      length: bounds.length,
    });
  }

  return [
    ...steps,
    ...placements.map((placement) => ({
      x: placement.x,
      y: placement.y,
      z: placement.z,
      block: placement.block,
    })),
  ];
}

/**
 * Compile a high-confidence prompt into one relative, site-aware build plan.
 * @param {{
 *   prompt?: string,
 *   bot?: any,
 *   decisionPolicy?: Record<string, unknown>,
 *   buildOrigin?: Record<string, unknown>,
 *   buildStartOffset?: Record<string, unknown>,
 *   worldContext?: Record<string, unknown> | null,
 *   anchorIndex?: number,
 * }} [params]
 * @returns {{
 *   steps: Array<Record<string, unknown>>,
 *   tags: string[],
 *   actionCount: number,
 *   source: string,
 *   anchor: Record<string, unknown>,
 *   placementCount: number,
 * } | null}
 * @throws {RangeError} When requested dimensions exceed local planner limits.
 * @throws {Error} When no safe anchor is available.
 */
export function createLocalBuildPlan({
  prompt,
  bot,
  decisionPolicy,
  buildOrigin,
  buildStartOffset = { x: 0, y: 0, z: 0 },
  worldContext = null,
  anchorIndex = 0,
} = {}) {
  const structure = parsePrompt(String(prompt || ''));
  if (!Array.isArray(structure) || structure.length === 0) {
    return null;
  }

  const safeBuildOrigin = buildOrigin || getBotOrigin(bot);
  const structureBounds = getBounds(structure);
  const anchor = chooseAnchor({
    bot,
    decisionPolicy,
    footprint: {
      minX: structureBounds.minX,
      maxX: structureBounds.maxX,
      minZ: structureBounds.minZ,
      maxZ: structureBounds.maxZ,
      height: structureBounds.height,
    },
    worldContext,
    anchorIndex,
  });
  const steps = compileActions({
    structure,
    anchor,
    buildOrigin: safeBuildOrigin,
    buildStartOffset,
    decisionPolicy,
  });

  return {
    steps,
    tags: ['source:local', 'phase:prep', 'phase:build'],
    actionCount: steps.length,
    source: 'local',
    anchor,
    placementCount: structure.length,
  };
}
