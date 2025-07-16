export function offsetStructure(blocks, origin, relativeOffset = { x: 0, y: 0, z: 0 }) {
  return blocks.map(block => ({
    x: Math.floor(origin.x + block.x + (relativeOffset.x || 0)),
    y: Math.floor(origin.y + block.y + (relativeOffset.y || 0)),
    z: Math.floor(origin.z + block.z + (relativeOffset.z || 0)),
    block: block.block
  }));
}
