// packages/prompt-parser/index.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mediumHouseTemplatePath = path.join(currentDir, 'medium-house-template.json')

export function parsePrompt(prompt) {
  let structure = [];

  const lower = prompt.toLowerCase();

  if (lower.includes('glass')) {
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          structure.push({ x, y, z, block: 'glass_pane' });
        }
      }
    }
    return structure;
  }

  if (lower.includes('cube')) {
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          structure.push({ x, y, z, block: 'cobblestone' });
        }
      }
    }
    return structure;
  }

  if (lower.includes('floor')) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        structure.push({ x, y: 0, z, block: 'cobblestone' });
      }
    }
    return structure;
  }

  if (lower.includes('pillar')) {
    for (let y = 0; y < 5; y++) {
      structure.push({ x: 0, y, z: 0, block: 'cobblestone' });
    }
    return structure;
  }

  if (lower.includes('medium house')) {
    const mediumHouseRaw = fs.readFileSync(mediumHouseTemplatePath, 'utf8')
    return JSON.parse(mediumHouseRaw)
  }

  if (lower.includes('house')) {
    return [
      { "x": 0, "y": 0, "z": 0, "block": "cobblestone" },
      { "x": 0, "y": 0, "z": 1, "block": "cobblestone" },
      { "x": 0, "y": 0, "z": 2, "block": "cobblestone" },
      { "x": 1, "y": 0, "z": 0, "block": "cobblestone" },
      { "x": 1, "y": 0, "z": 1, "block": "cobblestone" },
      { "x": 1, "y": 0, "z": 2, "block": "cobblestone" },
      { "x": 2, "y": 0, "z": 0, "block": "cobblestone" },
      { "x": 2, "y": 0, "z": 1, "block": "cobblestone" },
      { "x": 2, "y": 0, "z": 2, "block": "cobblestone" },
      { "x": 0, "y": 1, "z": 0, "block": "oak_planks" },
      { "x": 0, "y": 2, "z": 0, "block": "oak_planks" },
      { "x": 2, "y": 1, "z": 0, "block": "oak_planks" },
      { "x": 2, "y": 2, "z": 0, "block": "oak_planks" },
      { "x": 0, "y": 1, "z": 2, "block": "oak_planks" },
      { "x": 0, "y": 2, "z": 2, "block": "oak_planks" },
      { "x": 2, "y": 1, "z": 2, "block": "oak_planks" },
      { "x": 2, "y": 2, "z": 2, "block": "oak_planks" },
      { "x": 0, "y": 3, "z": 0, "block": "oak_planks" },
      { "x": 0, "y": 3, "z": 1, "block": "oak_planks" },
      { "x": 0, "y": 3, "z": 2, "block": "oak_planks" },
      { "x": 2, "y": 3, "z": 0, "block": "oak_planks" },
      { "x": 2, "y": 3, "z": 1, "block": "oak_planks" },
      { "x": 2, "y": 3, "z": 2, "block": "oak_planks" },
      { "x": 1, "y": 3, "z": 0, "block": "oak_planks" },
      { "x": 1, "y": 3, "z": 2, "block": "oak_planks" },
      { "x": 1, "y": 3, "z": 0, "block": "glass_pane" },
      { "x": 1, "y": 2, "z": 0, "block": "glass_pane" },
      { "x": 1, "y": 1, "z": 0, "block": "oak_door" },
      { "x": 1, "y": 0, "z": 1, "block": "oak_planks" },
      { "x": 1, "y": 3, "z": 1, "block": "oak_planks" }
    ]
  }

  return [];
}
