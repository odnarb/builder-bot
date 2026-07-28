// packages/prompt-parser/index.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mediumHouseTemplatePath = path.join(currentDir, 'medium-house-template.json')

const MAX_DIMENSION = 32
const AMBIGUOUS_STYLE_PATTERN = /\b(?:ornate|detailed|elaborate|gothic|futuristic|modern|custom|decorative|medieval|victorian)\b/
const SHAPE_WORD_PATTERN = '(?:arch|block|box|bridge|column|cube|door|doorway|fence|floor|house|pad|path|pillar|platform|road|roof|room|staircase|stairs|steps|tower|tunnel|wall|window)'
const NON_MATERIAL_MODIFIERS = new Set([
  'a',
  'an',
  'big',
  'hollow',
  'large',
  'long',
  'medium',
  'short',
  'simple',
  'small',
  'tall',
  'wide',
])
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

/**
 * Parse a requested dimension without silently changing user intent.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 * @throws {RangeError} When the requested dimension is outside supported bounds.
 */
function parseDimension(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  const dimension = Math.trunc(num)
  if (dimension < 1 || dimension > MAX_DIMENSION) {
    throw new RangeError(`Build dimensions must be between 1 and ${MAX_DIMENSION} blocks.`)
  }
  return dimension
}

/**
 * Find a supported material mentioned in text.
 * @param {string} lower
 * @returns {string | null}
 */
function findMaterial(lower) {
  const match = MATERIALS.find(([word]) => lower.includes(word))
  return match ? match[1] : null
}

/**
 * Resolve a supported material or use the template default.
 * @param {string} lower
 * @param {string} fallback
 * @returns {string}
 */
function resolveMaterial(lower, fallback = 'cobblestone') {
  return findMaterial(lower) || fallback
}

/**
 * Parse compact dimensions such as `4x6x3`.
 * @param {string} lower Lower-cased prompt.
 * @returns {Array<number | null>}
 * @throws {RangeError} When a requested dimension is unsupported.
 */
function parseDimensions(lower) {
  const explicit = lower.match(/(\d+)\s*(?:x|by)\s*(\d+)(?:\s*(?:x|by)\s*(\d+))?/)
  if (explicit) {
    return [
      parseDimension(explicit[1], 1),
      parseDimension(explicit[2], 1),
      explicit[3] ? parseDimension(explicit[3], 1) : null,
    ]
  }

  const firstNumber = lower.match(/\b(\d+)\b/)
  return firstNumber ? [parseDimension(firstNumber[1], 1)] : []
}

/**
 * Parse a named dimension such as `4 blocks wide`.
 * @param {string} lower Lower-cased prompt.
 * @param {string} words Alternation used for supported measure names.
 * @param {number} fallback Default dimension.
 * @returns {number}
 * @throws {RangeError} When a requested dimension is unsupported.
 */
function parseMeasure(lower, words, fallback) {
  const pattern = new RegExp(`\\b(\\d+)\\s*(?:block\\s*)?(?:${words})\\b`)
  const match = lower.match(pattern)
  return match ? parseDimension(match[1], fallback) : fallback
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

function wallWithOpening(width, height, block, openingType) {
  const structure = []
  const centerX = Math.floor(width / 2)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const isDoorOpening = openingType === 'door' && x === centerX && y < Math.min(2, height)
      const isWindowOpening = openingType === 'window' && x === centerX && y === Math.min(2, height - 1)
      if (isDoorOpening) {
        if (y === 0) {
          structure.push({ x, y, z: 0, block: 'oak_door' })
        }
        continue
      }
      if (isWindowOpening) {
        structure.push({ x, y, z: 0, block: 'glass_pane' })
        continue
      }
      structure.push({ x, y, z: 0, block })
    }
  }
  return structure
}

function framedDoor(block) {
  return [
    { x: 0, y: 0, z: 0, block },
    { x: 0, y: 1, z: 0, block },
    { x: 0, y: 2, z: 0, block },
    { x: 1, y: 2, z: 0, block },
    { x: 2, y: 0, z: 0, block },
    { x: 2, y: 1, z: 0, block },
    { x: 2, y: 2, z: 0, block },
    { x: 1, y: 0, z: 0, block: 'oak_door' },
  ]
}

function framedWindow(block) {
  return [
    { x: 0, y: 0, z: 0, block },
    { x: 1, y: 0, z: 0, block },
    { x: 2, y: 0, z: 0, block },
    { x: 0, y: 1, z: 0, block },
    { x: 1, y: 1, z: 0, block: 'glass_pane' },
    { x: 2, y: 1, z: 0, block },
    { x: 0, y: 2, z: 0, block },
    { x: 1, y: 2, z: 0, block },
    { x: 2, y: 2, z: 0, block },
  ]
}

function fence(length, block) {
  const structure = []
  for (let z = 0; z < length; z++) {
    structure.push({ x: 0, y: 0, z, block })
    if (z % 2 === 0) {
      structure.push({ x: 0, y: 1, z, block })
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

function tunnel(width, height, length, block) {
  const structure = []
  for (let z = 0; z < length; z++) {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (x === 0 || x === width - 1 || y === height - 1) {
          structure.push({ x, y, z, block })
        }
      }
    }
  }
  return structure
}

function arch(width, height, block) {
  const structure = []
  for (let y = 0; y < height; y++) {
    structure.push({ x: 0, y, z: 0, block })
    structure.push({ x: width - 1, y, z: 0, block })
  }
  for (let x = 0; x < width; x++) {
    structure.push({ x, y: height - 1, z: 0, block })
  }
  return structure
}

function simpleRoof(width, length, block) {
  const structure = []
  const levels = Math.max(1, Math.ceil(width / 2))
  for (let y = 0; y < levels; y++) {
    for (let x = y; x < width - y; x++) {
      for (let z = 0; z < length; z++) {
        if (x === y || x === width - y - 1 || y === levels - 1) {
          structure.push({ x, y, z, block })
        }
      }
    }
  }
  return structure
}

function simpleRoom(width, length, block) {
  const structure = rectangle(width, length, block)
  for (let x = 0; x < width; x++) {
    structure.push({ x, y: 1, z: 0, block })
    structure.push({ x, y: 1, z: length - 1, block })
  }
  for (let z = 1; z < length - 1; z++) {
    structure.push({ x: 0, y: 1, z, block })
    structure.push({ x: width - 1, y: 1, z, block })
  }
  return structure
}

/**
 * Parse only deterministic, supported build prompts.
 * @param {string} prompt User build prompt.
 * @returns {Array<{ x: number, y: number, z: number, block: string }>}
 * @throws {RangeError} When explicit dimensions exceed supported bounds.
 */
export function parsePrompt(prompt) {
  const lower = String(prompt || '').toLowerCase()
  if (AMBIGUOUS_STYLE_PATTERN.test(lower)) {
    return []
  }

  const explicitMaterialPhrase = lower.match(new RegExp(
    `\\b(?:made\\s+(?:from|of)|using)\\s+([a-z_ ]{1,32}?)(?:\\s+${SHAPE_WORD_PATTERN}\\b|$)`,
  ))
  if (explicitMaterialPhrase && !findMaterial(explicitMaterialPhrase[1])) {
    return []
  }

  const leadingMaterial = lower.match(new RegExp(`\\b([a-z_]+)\\s+${SHAPE_WORD_PATTERN}\\b`))
  if (
    leadingMaterial &&
    !NON_MATERIAL_MODIFIERS.has(leadingMaterial[1]) &&
    !findMaterial(lower)
  ) {
    return []
  }

  const dimensions = parseDimensions(lower)
  const material = resolveMaterial(lower)

  if (lower.includes('bridge')) {
    const length = parseMeasure(lower, 'long|length', dimensions[0] || 8)
    const width = parseMeasure(lower, 'wide|width', dimensions[1] || 3)
    return rectangle(width, length, resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('door') || lower.includes('doorway')) {
    if (lower.includes('wall')) {
      const width = parseMeasure(lower, 'wide|long|length|width', dimensions[0] || 5)
      const height = parseMeasure(lower, 'tall|high|height', dimensions[1] || 3)
      return wallWithOpening(width, height, material, 'door')
    }
    return framedDoor(resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('window')) {
    if (lower.includes('wall')) {
      const width = parseMeasure(lower, 'wide|long|length|width', dimensions[0] || 5)
      const height = parseMeasure(lower, 'tall|high|height', dimensions[1] || 3)
      return wallWithOpening(width, height, material, 'window')
    }
    return framedWindow(resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('road') || lower.includes('path')) {
    const length = parseMeasure(lower, 'long|length', dimensions[0] || 8)
    const width = parseMeasure(lower, 'wide|width', dimensions[1] || 3)
    return rectangle(width, length, resolveMaterial(lower, 'stone_bricks'))
  }

  if (lower.includes('farm')) {
    return []
  }

  if (lower.includes('garden')) {
    return []
  }

  if (lower.includes('fence')) {
    const length = parseMeasure(lower, 'long|length', dimensions[0] || 8)
    return fence(length, resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('tunnel')) {
    const length = parseMeasure(lower, 'long|length', dimensions[0] || 8)
    const width = parseMeasure(lower, 'wide|width', dimensions[1] || 3)
    const height = parseMeasure(lower, 'tall|high|height', dimensions[2] || 3)
    return tunnel(width, height, length, material)
  }

  if (lower.includes('arch')) {
    const width = parseMeasure(lower, 'wide|width', dimensions[0] || 5)
    const height = parseMeasure(lower, 'tall|high|height', dimensions[1] || 4)
    return arch(width, height, material)
  }

  if (lower.includes('roof')) {
    const width = parseMeasure(lower, 'wide|width', dimensions[0] || 5)
    const length = parseMeasure(lower, 'long|length', dimensions[1] || width)
    return simpleRoof(width, length, resolveMaterial(lower, 'oak_planks'))
  }

  if (lower.includes('room')) {
    const width = parseMeasure(lower, 'wide|width', dimensions[0] || 5)
    const length = parseMeasure(lower, 'long|length', dimensions[1] || width)
    return simpleRoom(width, length, material)
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
