import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

const STATE_KEY = '__decisionEngineState';
const MAX_PATH_UPDATE_HISTORY = 16;
const MAX_RESET_HISTORY = 24;
const MAX_FAILURE_HISTORY = 24;

const HAZARD_NAME_FRAGMENTS = Object.freeze([
  'lava',
  'water',
  'fire',
  'cactus',
  'magma',
  'campfire',
]);

const PROTECTED_BLOCK_FRAGMENTS = Object.freeze([
  'barrel',
  'chest',
  'dispenser',
  'dropper',
  'furnace',
  'hopper',
  'shulker_box',
]);

function isHazardName(name) {
  const lower = String(name || '').toLowerCase();
  return HAZARD_NAME_FRAGMENTS.some(fragment => lower.includes(fragment));
}

/**
 * Return whether a block is known to contain or control player-owned content.
 * @param {string} name
 * @returns {boolean}
 */
function isProtectedBlockName(name) {
  const lower = String(name || '').toLowerCase();
  return PROTECTED_BLOCK_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function safeBlockAt(bot, pos) {
  try {
    return bot.blockAt(pos, false);
  } catch {
    return null;
  }
}

function getOrCreateDecisionState(bot) {
  if (!bot[STATE_KEY]) {
    bot[STATE_KEY] = {
      telemetryAttached: false,
      pathfinder: {
        lastUpdate: null,
        recentUpdates: [],
        recentResets: [],
        counters: {
          goalReached: 0,
          pathStopped: 0,
          status: {
            success: 0,
            partial: 0,
            timeout: 0,
            noPath: 0,
            unknown: 0,
          },
        },
      },
      failures: [],
    };
  }

  return bot[STATE_KEY];
}

function pushBounded(arr, value, maxEntries) {
  arr.push(value);
  if (arr.length > maxEntries) {
    arr.splice(0, arr.length - maxEntries);
  }
}

/**
 * Attach passive pathfinder telemetry listeners once per bot instance.
 * @param {any} bot
 * @returns {void}
 */
export function ensurePathfinderTelemetry(bot) {
  if (!bot || typeof bot.on !== 'function') {
    return;
  }

  const state = getOrCreateDecisionState(bot);
  if (state.telemetryAttached) {
    return;
  }

  state.telemetryAttached = true;

  bot.on('path_update', (result) => {
    const status = ['success', 'partial', 'timeout', 'noPath'].includes(result?.status)
      ? result.status
      : 'unknown';
    const update = {
      status,
      timeMs: Number(result?.time || 0),
      cost: Number(result?.cost || 0),
      visitedNodes: Number(result?.visitedNodes || 0),
      generatedNodes: Number(result?.generatedNodes || 0),
      pathLength: Array.isArray(result?.path) ? result.path.length : 0,
      timestamp: Date.now(),
    };
    state.pathfinder.lastUpdate = update;
    state.pathfinder.counters.status[status] = Number(state.pathfinder.counters.status[status] || 0) + 1;
    pushBounded(state.pathfinder.recentUpdates, update, MAX_PATH_UPDATE_HISTORY);
  });

  bot.on('path_reset', (reason) => {
    pushBounded(state.pathfinder.recentResets, {
      reason: String(reason || 'unknown'),
      timestamp: Date.now(),
    }, MAX_RESET_HISTORY);
  });

  bot.on('goal_reached', () => {
    state.pathfinder.counters.goalReached += 1;
  });

  bot.on('path_stop', () => {
    state.pathfinder.counters.pathStopped += 1;
  });
}

/**
 * Append a normalized failure digest entry for downstream replanning context.
 * @param {any} bot
 * @param {{ code: string, message?: string, stepType?: string, context?: Record<string, unknown> }} failure
 */
export function appendDecisionFailure(bot, failure) {
  if (!bot || !failure || typeof failure !== 'object') {
    return;
  }

  const state = getOrCreateDecisionState(bot);
  const entry = {
    code: String(failure.code || 'ERR_UNKNOWN'),
    message: String(failure.message || ''),
    stepType: String(failure.stepType || ''),
    context: failure.context && typeof failure.context === 'object'
      ? failure.context
      : {},
    timestamp: Date.now(),
  };
  pushBounded(state.failures, entry, MAX_FAILURE_HISTORY);
}

function getFailureDigest(bot, limit = 8) {
  const state = getOrCreateDecisionState(bot);
  return state.failures
    .slice(-Math.max(1, limit))
    .map((entry) => ({
      code: entry.code,
      stepType: entry.stepType,
      message: entry.message.slice(0, 140),
      timestamp: entry.timestamp,
    }));
}

function resolveSurfaceYAtXZ(bot, x, z, centerY, yRange = 8) {
  const minY = Math.max(-64, Math.floor(centerY - yRange));
  const maxY = Math.min(320, Math.floor(centerY + yRange));

  for (let y = maxY; y >= minY; y -= 1) {
    const block = safeBlockAt(bot, new Vec3(x, y, z));
    if (!block) {
      return { loaded: false, y: Math.floor(centerY), blockName: 'unknown' };
    }
    if (block.name !== 'air') {
      return {
        loaded: true,
        y: y + 1,
        blockName: block.name,
      };
    }
  }

  return { loaded: true, y: minY, blockName: 'air' };
}

function summarizeTerrainProfile(bot, origin, radius) {
  const sampleStep = Math.max(1, Math.min(4, Math.floor(radius / 4)));
  const heights = [];
  let samples = 0;
  let loadedSamples = 0;
  let unloadedSamples = 0;
  let hazardSamples = 0;
  let liquidSamples = 0;

  for (let dx = -radius; dx <= radius; dx += sampleStep) {
    for (let dz = -radius; dz <= radius; dz += sampleStep) {
      samples += 1;
      const x = origin.x + dx;
      const z = origin.z + dz;
      const surface = resolveSurfaceYAtXZ(bot, x, z, origin.y, 10);
      if (!surface.loaded) {
        unloadedSamples += 1;
        continue;
      }

      loadedSamples += 1;
      heights.push(surface.y);

      if (isHazardName(surface.blockName)) {
        hazardSamples += 1;
      }
      if (surface.blockName.includes('water') || surface.blockName.includes('lava')) {
        liquidSamples += 1;
      }
    }
  }

  if (heights.length === 0) {
    return {
      scanRadius: radius,
      sampleStep,
      sampleCount: samples,
      loadedSamples,
      unloadedSamples,
      minY: origin.y,
      maxY: origin.y,
      heightVariance: 0,
      flatnessScore: 0,
      hazardSampleRatio: 0,
      liquidSampleRatio: 0,
    };
  }

  const minY = Math.min(...heights);
  const maxY = Math.max(...heights);
  const mean = heights.reduce((sum, value) => sum + value, 0) / heights.length;
  const meanAbsDeviation = heights.reduce((sum, value) => sum + Math.abs(value - mean), 0) / heights.length;
  const heightVariance = Number((maxY - minY).toFixed(2));
  const flatnessScore = Number((1 / (1 + meanAbsDeviation + (heightVariance / 3))).toFixed(4));

  return {
    scanRadius: radius,
    sampleStep,
    sampleCount: samples,
    loadedSamples,
    unloadedSamples,
    minY,
    maxY,
    heightVariance,
    flatnessScore,
    hazardSampleRatio: Number((hazardSamples / Math.max(1, loadedSamples)).toFixed(4)),
    liquidSampleRatio: Number((liquidSamples / Math.max(1, loadedSamples)).toFixed(4)),
  };
}

/**
 * Evaluate the actual planned footprint at a candidate anchor.
 * @param {any} bot
 * @param {{ x: number, y: number, z: number }} candidate
 * @param {{
 *   minX?: number,
 *   maxX?: number,
 *   minZ?: number,
 *   maxZ?: number,
 *   height?: number,
 * }} [footprint]
 * @returns {{
 *   supportRatio: number,
 *   obstructedRatio: number,
 *   hazardRatio: number,
 *   loadedRatio: number,
 *   loadedCells: number,
 *   unloadedCells: number,
 *   protectedCells: number,
 *   entityCount: number,
 * }}
 */
function evaluateCandidateFeasibility(bot, candidate, footprint = {}) {
  const minX = Math.max(-32, Math.trunc(Number(footprint.minX) || 0));
  const maxX = Math.min(32, Math.trunc(Number(footprint.maxX) || 0));
  const minZ = Math.max(-32, Math.trunc(Number(footprint.minZ) || 0));
  const maxZ = Math.min(32, Math.trunc(Number(footprint.maxZ) || 0));
  const height = Math.max(1, Math.min(32, Math.trunc(Number(footprint.height) || 2)));
  let loadedCells = 0;
  let unloadedCells = 0;
  let supportCells = 0;
  let obstructedCells = 0;
  let hazardCells = 0;
  let protectedCells = 0;

  for (let dx = minX; dx <= maxX; dx += 1) {
    for (let dz = minZ; dz <= maxZ; dz += 1) {
      const x = candidate.x + dx;
      const z = candidate.z + dz;
      const below = safeBlockAt(bot, new Vec3(x, candidate.y - 1, z));
      const column = [];
      for (let dy = 0; dy < height; dy += 1) {
        column.push(safeBlockAt(bot, new Vec3(x, candidate.y + dy, z)));
      }
      if (!below || column.some((block) => !block)) {
        unloadedCells += 1;
        continue;
      }

      loadedCells += 1;
      if (below.name !== 'air' && !isHazardName(below.name)) {
        supportCells += 1;
      }
      if (column.some((block) => block.name !== 'air')) {
        obstructedCells += 1;
      }
      if (column.some((block) => isHazardName(block.name)) || isHazardName(below.name)) {
        hazardCells += 1;
      }
      if (column.some((block) => isProtectedBlockName(block.name)) || isProtectedBlockName(below.name)) {
        protectedCells += 1;
      }
    }
  }

  const totalCells = loadedCells + unloadedCells;
  const entityCount = Object.values(bot?.entities || {}).filter((entity) => {
    const position = entity?.position;
    return position &&
      position.x >= candidate.x + minX &&
      position.x <= candidate.x + maxX + 1 &&
      position.z >= candidate.z + minZ &&
      position.z <= candidate.z + maxZ + 1 &&
      position.y >= candidate.y - 1 &&
      position.y <= candidate.y + height;
  }).length;

  if (loadedCells === 0 || totalCells === 0) {
    return {
      supportRatio: 0,
      obstructedRatio: 1,
      hazardRatio: 1,
      loadedRatio: 0,
      loadedCells: 0,
      unloadedCells,
      protectedCells,
      entityCount,
    };
  }

  return {
    supportRatio: Number((supportCells / loadedCells).toFixed(4)),
    obstructedRatio: Number((obstructedCells / loadedCells).toFixed(4)),
    hazardRatio: Number((hazardCells / loadedCells).toFixed(4)),
    loadedRatio: Number((loadedCells / totalCells).toFixed(4)),
    loadedCells,
    unloadedCells,
    protectedCells,
    entityCount,
  };
}

function probeCandidatePath(bot, candidate, pathProbeTimeoutMs) {
  if (!bot?.pathfinder?.getPathTo || !bot?.pathfinder?.movements) {
    return {
      status: 'unknown',
      timeMs: 0,
      cost: 0,
      visitedNodes: 0,
      pathLength: 0,
    };
  }

  try {
    const goal = new goals.GoalNear(candidate.x, candidate.y, candidate.z, 1);
    const result = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, pathProbeTimeoutMs);
    return {
      status: String(result?.status || 'unknown'),
      timeMs: Number(result?.time || 0),
      cost: Number(result?.cost || 0),
      visitedNodes: Number(result?.visitedNodes || 0),
      pathLength: Array.isArray(result?.path) ? result.path.length : 0,
    };
  } catch (error) {
    return {
      status: 'error',
      timeMs: 0,
      cost: 0,
      visitedNodes: 0,
      pathLength: 0,
      error: error?.message || String(error),
    };
  }
}

function buildAnchorOffsets(radius) {
  const half = Math.max(2, Math.floor(radius / 2));
  const quarter = Math.max(2, Math.floor(radius / 3));
  return [
    { x: 0, z: 0 },
    { x: half, z: 0 },
    { x: -half, z: 0 },
    { x: 0, z: half },
    { x: 0, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
    { x: half, z: -half },
    { x: -half, z: -half },
    { x: quarter, z: 0 },
    { x: -quarter, z: 0 },
    { x: 0, z: quarter },
    { x: 0, z: -quarter },
  ];
}

/**
 * Score a candidate using terrain safety and bounded path evidence.
 * @param {{
 *   originY: number,
 *   candidateY: number,
 *   feasibility: Record<string, number>,
 *   pathProbe: Record<string, unknown>,
 * }} params
 * @returns {number}
 */
function computeAnchorScore({ originY, candidateY, feasibility, pathProbe }) {
  let score = 100;
  score -= Math.abs(candidateY - originY) * 4;
  score -= Math.round(feasibility.obstructedRatio * 30);
  score -= Math.round(feasibility.hazardRatio * 45);
  score -= Math.round((1 - feasibility.loadedRatio) * 60);
  score -= feasibility.protectedCells > 0 ? 100 : 0;
  score -= feasibility.entityCount > 0 ? 40 : 0;
  score += Math.round(feasibility.supportRatio * 20);

  if (pathProbe.status === 'success') {
    score += 10;
  } else if (pathProbe.status === 'partial') {
    score -= 5;
  } else if (pathProbe.status === 'timeout') {
    score -= 20;
  } else if (pathProbe.status === 'noPath') {
    score -= 35;
  } else if (pathProbe.status === 'error') {
    score -= 25;
  }

  score -= Math.min(20, Math.round(pathProbe.cost || 0));
  return Number(score.toFixed(2));
}

function summarizeReachability(candidates = []) {
  const summary = {
    probeCount: candidates.length,
    successCount: 0,
    partialCount: 0,
    timeoutCount: 0,
    noPathCount: 0,
    errorCount: 0,
    unknownCount: 0,
  };

  for (const candidate of candidates) {
    const status = String(candidate?.pathProbe?.status || 'unknown');
    if (status === 'success') {
      summary.successCount += 1;
      continue;
    }
    if (status === 'partial') {
      summary.partialCount += 1;
      continue;
    }
    if (status === 'timeout') {
      summary.timeoutCount += 1;
      continue;
    }
    if (status === 'noPath') {
      summary.noPathCount += 1;
      continue;
    }
    if (status === 'error') {
      summary.errorCount += 1;
      continue;
    }
    summary.unknownCount += 1;
  }

  summary.successRatio = Number((summary.successCount / Math.max(1, summary.probeCount)).toFixed(4));
  return summary;
}

/**
 * Build richer runtime context for build planning and adaptive execution.
 * @param {{
 *   bot: any,
 *   prompt?: string,
 *   decisionPolicy: {
 *     maxScanRadius: number,
 *     maxAnchorCandidates: number,
 *     pathProbeTimeoutMs: number,
 *     minAnchorScore?: number,
 *   },
 *   footprint?: { minX?: number, maxX?: number, minZ?: number, maxZ?: number, height?: number },
 * }} params
 * @returns {Record<string, unknown>}
 */
export function buildDecisionWorldContext({
  bot,
  prompt = '',
  decisionPolicy,
  footprint = {},
}) {
  ensurePathfinderTelemetry(bot);

  const entityPos = bot?.entity?.position;
  const origin = entityPos
    ? entityPos.floored()
    : new Vec3(0, 64, 0);
  const radius = Math.max(4, Math.min(32, Number(decisionPolicy?.maxScanRadius || 8)));
  const maxAnchorCandidates = Math.max(1, Math.min(12, Number(decisionPolicy?.maxAnchorCandidates || 3)));
  const pathProbeTimeoutMs = Math.max(200, Math.min(4000, Number(decisionPolicy?.pathProbeTimeoutMs || 800)));
  const minAnchorScore = Math.max(0, Math.min(100, Number(decisionPolicy?.minAnchorScore || 45)));

  const terrainProfile = summarizeTerrainProfile(bot, origin, radius);
  const candidates = [];
  const seen = new Set();

  for (const offset of buildAnchorOffsets(radius)) {
    const x = origin.x + offset.x;
    const z = origin.z + offset.z;
    const key = `${x},${z}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const surface = resolveSurfaceYAtXZ(bot, x, z, origin.y, 10);
    if (!surface.loaded) {
      continue;
    }

    const candidate = {
      x,
      y: surface.y,
      z,
      surfaceBlock: surface.blockName,
    };
    const feasibility = evaluateCandidateFeasibility(bot, candidate, footprint);
    const pathProbe = { status: 'unknown', timeMs: 0, cost: 0, visitedNodes: 0, pathLength: 0 };
    const score = computeAnchorScore({
      originY: origin.y,
      candidateY: candidate.y,
      feasibility,
      pathProbe,
    });

    candidates.push({
      ...candidate,
      score,
      feasibility,
      pathProbe,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const anchorCandidates = candidates
    .slice(0, maxAnchorCandidates)
    .map((candidate) => {
      const pathProbe = probeCandidatePath(bot, candidate, pathProbeTimeoutMs);
      return {
        ...candidate,
        pathProbe,
        score: computeAnchorScore({
          originY: origin.y,
          candidateY: candidate.y,
          feasibility: candidate.feasibility,
          pathProbe,
        }),
      };
    })
    .filter((candidate) => (
      candidate.score >= minAnchorScore &&
      candidate.feasibility.loadedRatio === 1 &&
      candidate.feasibility.hazardRatio === 0 &&
      candidate.feasibility.protectedCells === 0 &&
      candidate.feasibility.entityCount === 0 &&
      candidate.pathProbe.status !== 'noPath' &&
      candidate.pathProbe.status !== 'timeout' &&
      candidate.pathProbe.status !== 'error'
    ))
    .sort((a, b) => b.score - a.score)
    .map((candidate) => ({
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      score: candidate.score,
      surfaceBlock: candidate.surfaceBlock,
      feasibility: candidate.feasibility,
      pathProbe: candidate.pathProbe,
    }));

  const reachability = summarizeReachability(anchorCandidates);
  const state = getOrCreateDecisionState(bot);

  return {
    terrainProfile,
    anchorCandidates,
    hazards: {
      hazardSampleRatio: terrainProfile.hazardSampleRatio,
      liquidSampleRatio: terrainProfile.liquidSampleRatio,
    },
    reachability: {
      ...reachability,
      recentResetReasons: state.pathfinder.recentResets.slice(-8),
      lastPathUpdate: state.pathfinder.lastUpdate,
    },
    failureDigest: getFailureDigest(bot, 8),
    pathfinderDiagnostics: {
      counters: state.pathfinder.counters,
      recentResets: state.pathfinder.recentResets.slice(-8),
      recentUpdates: state.pathfinder.recentUpdates.slice(-6),
    },
    taskHints: {
      promptWords: String(prompt || '').trim().split(/\s+/).filter(Boolean).length,
      promptChars: String(prompt || '').length,
    },
  };
}
