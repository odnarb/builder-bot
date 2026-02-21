export function offsetStructure(blocks, origin, relativeOffset = { x: 0, y: 0, z: 0 }) {
  const safeOrigin = {
    x: Number(origin?.x || 0),
    y: Number(origin?.y || 0),
    z: Number(origin?.z || 0),
  };

  const safeOffset = {
    x: Number(relativeOffset?.x || 0),
    y: Number(relativeOffset?.y || 0),
    z: Number(relativeOffset?.z || 0),
  };

  return blocks.map((step) => {
    const adjusted = { ...step };
    const hasCoordinates = Number.isFinite(Number(step?.x))
      && Number.isFinite(Number(step?.y))
      && Number.isFinite(Number(step?.z));

    if (!hasCoordinates) {
      return adjusted;
    }

    adjusted.x = Math.floor(safeOrigin.x + Number(step.x) + safeOffset.x);
    adjusted.y = Math.floor(safeOrigin.y + Number(step.y) + safeOffset.y);
    adjusted.z = Math.floor(safeOrigin.z + Number(step.z) + safeOffset.z);
    return adjusted;
  });
}
