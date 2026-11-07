export function fieldViewport(
  centerY: number,
  heightYards: number,
  zoom = 1,
  pan = { x: 0, y: 0 },
) {
  const scale = Math.max(1, Math.min(6, zoom));
  const fullHeight = heightYards * 10;
  const width = 720 / scale,
    height = fullHeight / scale;
  const baseX = (720 - width) / 2,
    baseY = Math.max(-100, Math.min(1400 - height, centerY - height / 2));
  const x = Math.max(0, Math.min(720 - width, baseX + pan.x));
  const y = Math.max(-100, Math.min(1400 - height, baseY + pan.y));
  return { x, y, width, height, pan: { x: x - baseX, y: y - baseY } };
}
