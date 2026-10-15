import { Box2, Vector2 } from 'three';

/** Preserve curves and holes while moving a whole imported batch to one origin. */
export function centerImportedPaths(entries) {
  const bounds = new Box2();
  for (const entry of entries) {
    const points = entry.shape.extractPoints(24);
    for (const point of [...points.shape, ...points.holes.flat()]) bounds.expandByPoint(point);
  }
  if (bounds.isEmpty()) throw new Error('読み込むパスの範囲がありません。');
  const center = bounds.getCenter(new Vector2());
  return entries.map(entry => {
    const shape = entry.shape.clone();
    const seen = new WeakSet();
    function translate(value) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value.isVector2) { value.x -= center.x; value.y -= center.y; return; }
      if (value.type === 'EllipseCurve') { value.aX -= center.x; value.aY -= center.y; }
      for (const item of Object.values(value)) if (item && typeof item === 'object') translate(item);
    }
    translate(shape);
    return { ...entry, shape, pivot: [0,0,0] };
  });
}
