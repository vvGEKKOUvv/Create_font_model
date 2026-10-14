import { Shape, Path } from "three";
import { prepareContours } from "./path-reduction.js";

function writeRing(path, ring) {
  path.moveTo(ring[0].x, ring[0].y);
  for (const point of ring.slice(1)) path.lineTo(point.x, point.y);
  path.closePath();
  return path;
}

/** Commit the same sampled contours used by the reduction preview.
 * The input shape is immutable so history and duplicates retain their source.
 */
export function reduceSourcePath(shape, tolerance = 0) {
  const amount = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : 0;
  const preview = prepareContours(shape, amount);
  const before = preview.originalCount;
  if (amount === 0 || preview.reducedCount >= before)
    return { shape, before, after: before };
  const result = writeRing(new Shape(), preview.rings[0]);
  result.holes = preview.rings.slice(1).map(ring => writeRing(new Path(), ring));
  return { shape: result, before, after: preview.reducedCount };
}
