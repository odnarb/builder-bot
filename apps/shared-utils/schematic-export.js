import { Buffer } from 'node:buffer';

/**
 * Build a lightweight schematic artifact from placement actions.
 * The payload is encoded as base64 JSON so clients can persist it as `.schematic`.
 * @param {{
 *   name: string,
 *   plan: { actions: Array<Record<string, unknown>>, tags?: string[] },
 *   generatedAt?: string,
 * }} params
 * @returns {{ filename: string, contentType: string, encoding: 'base64', data: string }}
 */
export function exportInstructionPlanToSchematic(params) {
  const name = String(params?.name || 'minecraft-build').replace(/[^a-z0-9-_]/gi, '_').slice(0, 80);
  const generatedAt = params?.generatedAt || new Date().toISOString();
  const placements = (params?.plan?.actions || [])
    .filter((action) => action.type === 'place_block')
    .map((action) => ({
      x: action.x,
      y: action.y,
      z: action.z,
      block: action.block,
    }));

  const content = {
    format: 'minecraft-ai-schematic-v1',
    name,
    generatedAt,
    tags: Array.isArray(params?.plan?.tags) ? params.plan.tags : [],
    placementCount: placements.length,
    placements,
  };

  return {
    filename: `${name}.schematic`,
    contentType: 'application/json',
    encoding: 'base64',
    data: Buffer.from(JSON.stringify(content), 'utf8').toString('base64'),
  };
}
