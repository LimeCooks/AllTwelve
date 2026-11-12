import { brandMarkPaths } from '@/lib/brand-identity.mjs';

/** Ink-friendly mark placed in the reserved print footer. */
export function drawPrintBrand(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
) {
  context.save();
  context.translate(x, y);
  context.scale(0.28, 0.28);
  context.fillStyle = '#24343f';
  for (const path of brandMarkPaths) context.fill(new Path2D(path));
  context.restore();
}
