import ClipperLib from "clipper-lib";
import { Vector2, ShapeUtils } from "three";

const cache = new WeakMap();

// Offset the filled region: outer boundaries expand while holes contract.
// Keep the topology of the input so oversized values cannot silently fill
// holes, split an object, or delete it. Original points are never mutated.
export function offsetContours(rings, requested = 0) {
  if (!Number.isFinite(requested)) throw new Error("オフセットには有限の数値を指定してください。");
  if (!requested) return { rings, effectivePathOffset: 0, warnings: [] };
  let variants = cache.get(rings);
  if (!variants) cache.set(rings, variants = new Map());
  if (variants.has(requested)) return variants.get(requested);
  const origin = rings[0][0];
  let extent = 0;
  for (const ring of rings) for (const p of ring)
    extent = Math.max(extent, Math.abs(p.x - origin.x), Math.abs(p.y - origin.y));
  let amount = requested;
  if (requested < 0 || rings.length > 1)
    amount = Math.sign(requested) * Math.min(Math.abs(requested), extent);
  const scale = Math.min(1e7, 1e14 / Math.max(extent, Math.abs(amount), 1));
  const paths = rings.map((ring, i) => {
    const path = ring.map(p => ({ X: Math.round((p.x - origin.x) * scale), Y: Math.round((p.y - origin.y) * scale) }));
    if (ClipperLib.Clipper.Orientation(path) !== (i === 0)) path.reverse();
    return path;
  });
  const run = (distance) => {
    const offset = new ClipperLib.ClipperOffset(4, 0.01 * scale);
    offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const tree = new ClipperLib.PolyTree();
    offset.Execute(tree, distance * scale);
    const outer = tree.Childs();
    if (outer.length !== 1 || outer[0].IsHole()) return null;
    const holes = outer[0].Childs();
    if (holes.length !== rings.length - 1 || holes.some(p => !p.IsHole() || p.ChildCount())) return null;
    const result = [outer[0], ...holes].map((node, i) => {
      const points = node.Contour().map(p => new Vector2(p.X / scale + origin.x, p.Y / scale + origin.y));
      if ((ShapeUtils.area(points) > 0) !== (i === 0)) points.reverse();
      return points;
    });
    if (result.some(p => p.length < 3 || Math.abs(ShapeUtils.area(p)) <= 1e-7)) return null;
    return result;
  };
  let shifted = run(amount);
  for (let n = 0; !shifted && n < 40; n++) shifted = run(amount *= 0.5);
  if (!shifted) throw new Error("輪郭を保持できません。オフセット量を小さくしてください。");
  const result = {
    rings: shifted,
    effectivePathOffset: amount,
    warnings: amount === requested ? [] : [`穴や輪郭を保持するため、オフセットを ${amount.toPrecision(3)} に縮小しました。`],
  };
  if (variants.size >= 24) variants.delete(variants.keys().next().value);
  variants.set(requested, result);
  return result;
}
