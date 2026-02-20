const SUPPORTED_ACTION_TYPES = Object.freeze([
  'move_to',
  'place_block',
  'follow',
  'stop',
]);

const COMMAND_BLOCK_NAME_PATTERN = /(^|_)command_block$/;

/**
 * Coerce a raw value into a bounded integer coordinate.
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 * @throws {Error}
 */
function toCoordinate(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid "${fieldName}" coordinate.`);
  }

  return Math.trunc(num);
}

/**
 * Normalize block identifiers into fully-qualified minecraft IDs.
 * @param {unknown} blockId
 * @returns {string}
 * @throws {Error}
 */
function normalizeBlockId(blockId) {
  const raw = String(blockId || '').trim().toLowerCase();
  if (!raw) {
    throw new Error('Missing block id.');
  }

  const withNamespace = raw.startsWith('minecraft:') ? raw : `minecraft:${raw}`;
  if (!/^minecraft:[a-z0-9_]+$/.test(withNamespace)) {
    throw new Error(`Invalid block id "${withNamespace}".`);
  }

  return withNamespace;
}

/**
 * Normalize a single action into canonical shape.
 * @param {Record<string, unknown>} action
 * @param {{ allowActionTypes?: string[] }} [options]
 * @returns {Record<string, unknown>}
 * @throws {Error}
 */
function normalizeAction(action, options = {}) {
  const allowActionTypes = Array.isArray(options.allowActionTypes)
    ? options.allowActionTypes
    : SUPPORTED_ACTION_TYPES;
  const inferredType = typeof action?.type === 'string'
    ? action.type.toLowerCase().trim()
    : (typeof action?.block === 'string' ? 'place_block' : '');

  if (!inferredType || !allowActionTypes.includes(inferredType)) {
    throw new Error(`Unsupported action type "${inferredType || 'unknown'}".`);
  }

  if (inferredType === 'move_to') {
    return {
      type: 'move_to',
      x: toCoordinate(action.x, 'x'),
      y: toCoordinate(action.y, 'y'),
      z: toCoordinate(action.z, 'z'),
    };
  }

  if (inferredType === 'place_block') {
    return {
      type: 'place_block',
      x: toCoordinate(action.x, 'x'),
      y: toCoordinate(action.y, 'y'),
      z: toCoordinate(action.z, 'z'),
      block: normalizeBlockId(action.block),
    };
  }

  if (inferredType === 'follow') {
    const distance = Number(action.distance);
    return {
      type: 'follow',
      target: String(action.target || 'commander'),
      distance: Number.isFinite(distance) ? Math.max(1, Math.min(16, Math.trunc(distance))) : 3,
    };
  }

  return { type: 'stop' };
}

/**
 * Parse input payload and return object form.
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 * @throws {Error}
 */
function parsePayload(payload) {
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Instruction payload must be an object.');
    }
    return parsed;
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Instruction payload must be an object.');
  }

  return payload;
}

/**
 * Normalize an instruction payload to a shared action-plan schema.
 * Supports both legacy `blocks` payloads and modern `actions` payloads.
 * @param {unknown} payload
 * @param {{ allowActionTypes?: string[] }} [options]
 * @returns {{
 *   schemaVersion: string,
 *   actions: Array<Record<string, unknown>>,
 *   tags: string[],
 *   sourceFormat: 'actions' | 'blocks',
 * }}
 * @throws {Error}
 */
export function normalizeInstructionPlan(payload, options = {}) {
  const parsed = parsePayload(payload);
  const rawActions = Array.isArray(parsed.actions)
    ? parsed.actions
    : (Array.isArray(parsed.blocks) ? parsed.blocks : []);
  const sourceFormat = Array.isArray(parsed.actions) ? 'actions' : 'blocks';

  if (rawActions.length === 0) {
    throw new Error('Instruction payload must include at least one action.');
  }

  const actions = rawActions.map((action) => normalizeAction(action, options));
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((tag) => String(tag)).filter((tag) => tag.length > 0).slice(0, 24)
    : [];

  return {
    schemaVersion: '1.0',
    actions,
    tags,
    sourceFormat,
  };
}

/**
 * Remove redundant movement actions to avoid micro-move loops.
 * Adjacent `move_to` actions collapse to the latest movement target.
 * @param {{ schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] }} plan
 * @returns {{ schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] }}
 */
export function optimizeInstructionPlan(plan) {
  const optimizedActions = [];

  for (const action of plan.actions) {
    if (action.type === 'move_to' && optimizedActions.length > 0) {
      const last = optimizedActions[optimizedActions.length - 1];
      if (last.type === 'move_to') {
        optimizedActions[optimizedActions.length - 1] = action;
        continue;
      }
    }

    optimizedActions.push(action);
  }

  return {
    ...plan,
    actions: optimizedActions,
  };
}

/**
 * Convert normalized action plan into legacy `{ blocks, tags }` shape.
 * This preserves backward compatibility with existing bot consumers.
 * @param {{ actions: Array<Record<string, unknown>>, tags?: string[] }} plan
 * @returns {{ blocks: Array<Record<string, unknown>>, tags: string[] }}
 */
export function toLegacyBlocksAndTags(plan) {
  const blocks = [];

  for (const action of plan.actions || []) {
    if (action.type === 'place_block') {
      blocks.push({
        x: action.x,
        y: action.y,
        z: action.z,
        block: action.block,
      });
      continue;
    }

    if (action.type === 'move_to') {
      blocks.push({
        type: 'move_to',
        x: action.x,
        y: action.y,
        z: action.z,
      });
      continue;
    }

    if (action.type === 'follow') {
      blocks.push({
        type: 'follow',
        target: action.target,
        distance: action.distance,
      });
      continue;
    }

    if (action.type === 'stop') {
      blocks.push({ type: 'stop' });
    }
  }

  return {
    blocks,
    tags: Array.isArray(plan.tags) ? plan.tags : [],
  };
}

/**
 * Compute summary metrics for instruction plans.
 * @param {{ actions: Array<Record<string, unknown>> }} plan
 * @returns {{ actionCount: number, placeBlockCount: number, moveCount: number, followCount: number, stopCount: number }}
 */
export function getInstructionPlanStats(plan) {
  const stats = {
    actionCount: 0,
    placeBlockCount: 0,
    moveCount: 0,
    followCount: 0,
    stopCount: 0,
  };

  for (const action of plan.actions || []) {
    stats.actionCount += 1;

    if (action.type === 'place_block') {
      stats.placeBlockCount += 1;
      continue;
    }
    if (action.type === 'move_to') {
      stats.moveCount += 1;
      continue;
    }
    if (action.type === 'follow') {
      stats.followCount += 1;
      continue;
    }
    if (action.type === 'stop') {
      stats.stopCount += 1;
    }
  }

  return stats;
}

/**
 * Determine whether a block is a command block variant.
 * @param {string} blockId
 * @returns {boolean}
 */
export function isCommandBlock(blockId) {
  const normalized = normalizeBlockId(blockId);
  const shortName = normalized.replace('minecraft:', '');
  return COMMAND_BLOCK_NAME_PATTERN.test(shortName);
}

export { SUPPORTED_ACTION_TYPES };
