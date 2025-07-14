// 5x5x5 cube made of cobblestone
const structure = [];

for (let x = 0; x < 2; x++) {
  for (let y = 0; y < 2; y++) {
    for (let z = 0; z < 2; z++) {
      structure.push({
        x, y, z,
        block: 'cobblestone'
      });
    }
  }
}

module.exports = structure;
