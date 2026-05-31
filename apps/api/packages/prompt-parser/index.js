// packages/prompt-parser/index.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mediumHouseTemplatePath = path.join(currentDir, 'medium-house-template.json')

const MAX_DIMENSION = 32
const MATERIALS = [
  ['glass pane', 'glass_pane'],
  ['glass', 'glass_pane'],
  ['oak planks', 'oak_planks'],
  ['wooden', 'oak_planks'],
  ['wood', 'oak_planks'],
  ['stone brick', 'stone_bricks'],
  ['bricks', 'bricks'],
  ['brick', 'bricks'],
  ['quartz', 'quartz_block'],
  ['cobblestone', 'cobblestone'],
  ['sandstone', 'sandstone'],
  ['stone', 'stone'],
  ['dirt', 'dirt'],
]

function clampDimension(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.max(1, Math.min(MAX_DIMENSION, Math.trunc(num)))
}

function resolveMaterial(lower, fallback = 'cobblestone') {
  const match = MATERIALS.find(([word]) => lower.includes(word))
  return match ? match[1] : fallback
}

function parseDimensions(lower) {
  const explicit = lower.match(/(\d+)\s*(?:x|by)\s*(\d+)(?:\s*(?:x|by)\s*(\d+))?/)
  if (explicit) {
    return [
      clampDimension(explicit[1], 1),
      clampDimension(explicit[2], 1),
      explicit[3] ? clampDimension(explicit[3], 1) : null,
    ]
  }

  const firstNumber = lower.match(/\b(\d+)\b/)
  return firstNumber ? [clampDimension(firstNumber[1], 1)] : []
}

function parseMeasure(lower, words, fallback) {
  const pattern = new RegExp(`\\b(\\d+)\\s*(?:block\\s*)?(?:${words})\\b`)
  const match = lower.match(pattern)
  return match ? clampDimension(match[1], fallback) : fallback
}

function cuboid(width, height, length, block) {
  const structure = []
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        structure.push({ x, y, z, block })
      }
    }
  }
  return structure
}

function rectangle(width, length, block) {
  const structure = []
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      structure.push({ x, y: 0, z, block })
    }
  }
  return structure
}

function wall(width, height, block) {
  const structure = []
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      structure.push({ x, y, z: 0, block })
    }
  }
  return structure
}

function pillar(height, block) {
  const structure = []
  for (let y = 0; y < height; y++) {
    structure.push({ x: 0, y, z: 0, block })
  }
  return structure
}

function stairs(width, height, block) {
  const structure = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      structure.push({ x, y, z: y, block })
    }
  }
  return structure
}

function hollowTower(size, height, block) {
  const structure = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
          structure.push({ x, y, z, block })
        }
      }
    }
  }
  return structure
}

export function parsePrompt(prompt) {
  const lower = String(prompt || '').toLowerCase()
  const dimensions = parseDimensions(lower)
  const material = resolveMaterial(lower)

  if (lower.includes('bridge')) {
    const length = parseMeasure(lower, 'long|length', dimensions[0] || 8)
    const width = parseMeasure(lower, 'wide|width', dimensions[1] || 3)
    return rectangle(width, length, resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('stairs') || lower.includes('staircase') || lower.includes('steps')) {
    const height = parseMeasure(lower, 'tall|high|height', dimensions[0] || 5)
    const width = parseMeasure(lower, 'wide|width', dimensions[1] || 1)
    return stairs(width, height, material)
  }

  if (lower.includes('wall')) {
    const width = parseMeasure(lower, 'wide|long|length|width', dimensions[0] || 5)
    const height = parseMeasure(lower, 'tall|high|height', dimensions[1] || 3)
    return wall(width, height, material)
  }

  if (lower.includes('tower')) {
    const size = parseMeasure(lower, 'wide|width', dimensions[0] || 5)
    const height = parseMeasure(lower, 'tall|high|height', dimensions[1] || 8)
    return hollowTower(size, height, material)
  }

  if (lower.includes('pillar') || lower.includes('column')) {
    const height = parseMeasure(lower, 'tall|high|height', dimensions[0] || 5)
    return pillar(height, material)
  }

  if (lower.includes('floor') || lower.includes('platform') || lower.includes('pad')) {
    const width = parseMeasure(lower, 'wide|width', dimensions[0] || 3)
    const length = parseMeasure(lower, 'long|length', dimensions[1] || width)
    return rectangle(width, length, material)
  }

  if (lower.includes('cube') || lower.includes('box') || lower.includes('block')) {
    const width = dimensions[0] || 2
    const height = dimensions[2] || dimensions[1] || width
    const length = dimensions[1] || width
    return cuboid(width, height, length, material)
  }

  if (lower.includes('glass')) {
    return cuboid(2, 2, 2, 'glass_pane')
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
