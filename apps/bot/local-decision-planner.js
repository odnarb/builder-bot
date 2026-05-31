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

function chooseAnchor({ bot, decisionPolicy, worldContext = null, anchorIndex = 0 }) {
  const context = worldContext || buildDecisionWorldContext({
    bot,
    prompt: '',
    decisionPolicy,
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
    };
  }

  const origin = getBotOrigin(bot);
  return {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    source: 'bot_position',
    score: 0,
  };
}

function toRelativeFromAnchor({ block, anchor, buildOrigin, buildStartOffset }) {
  return {
    x: finiteInt(anchor.x) - finiteInt(buildOrigin.x) - finiteInt(buildStartOffset.x) + finiteInt(block.x),
    y: finiteInt(anchor.y) - finiteInt(buildOrigin.y) - finiteInt(buildStartOffset.y) + finiteInt(block.y),
    z: finiteInt(anchor.z) - finiteInt(buildOrigin.z) - finiteInt(buildStartOffset.z) + finiteInt(block.z),
    block: normalizeBlock(block.block),
  };
}

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
    {
      type: 'flatten_area',
      x: bounds.minX,
      y: bounds.minY,
      z: bounds.minZ,
      width: bounds.width,
      length: bounds.length,
      targetY: bounds.minY,
      fillBlock: 'minecraft:dirt',
    },
  ];

  if (clearVolume <= maxPrepVolume) {
    steps.push({
      type: 'clear_volume',
      x: bounds.minX,
      y: bounds.minY + 1,
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
  const anchor = chooseAnchor({
    bot,
    decisionPolicy,
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
