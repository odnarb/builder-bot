// packages/prompt-parser/index.js
export function parsePrompt(prompt) {
  const structure = [];

  const lower = prompt.toLowerCase();

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
        structure.push({ x, y: -1, z, block: 'cobblestone' });
      }
    }
    return structure;
  }

  if (lower.includes('pillar')) {
    for (let y = 0; y < 5; y++) {
      structure.push({ x: 0, y, z: 0, block: 'stone' });
    }
    return structure;
  }

  return [];
}
