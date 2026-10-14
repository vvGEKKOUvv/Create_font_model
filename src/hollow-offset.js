import ClipperLib from "clipper-lib";
import { Vector2, ShapeUtils } from "three";

// A polygon offset may remove a tiny tip or split into several cavities.
// Keeping one offset vertex for every source vertex incorrectly forces the
// thickness of the entire wall to shrink when any small feature collapses.
export function hollowContours(outer, thickness) {
  const origin = outer[0];
  const extent = Math.max(
    thickness,
    ...outer.map((p) =>
      Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y)),
    ),
  );
  const scale = Math.min(1e7, 1e14 / Math.max(extent, 1));
  const path = outer.map((p) => ({
    X: Math.round((p.x - origin.x) * scale),
    Y: Math.round((p.y - origin.y) * scale),
  }));
  if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
  // Retain true acute-corner intersections instead of clipping a miter to a
  // short bevel. Actual collisions are resolved by polygon offset cleanup.
  const offset = new ClipperLib.ClipperOffset(Math.min(1e6, 1e15 / (Math.max(extent, 1) * scale)), 0.01 * scale);
  offset.AddPath(
    path,
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, -thickness * scale);
  return solution
    .map((ring) => {
      const points = ring.map(
        (p) => new Vector2(p.X / scale + origin.x, p.Y / scale + origin.y),
      );
      // geometry.js uses positive outer area and negative cavity area.
      if (ShapeUtils.area(points) > 0) points.reverse();
      return points;
    })
    .filter(
      (ring) => ring.length >= 3 && Math.abs(ShapeUtils.area(ring)) > 1e-7,
    );
}

// Hollow an already compound filled region. Its boundary walls can be
// disconnected islands, so return independent outer/hole contour groups.
export function hollowFilledRegion(rings, requestedThickness) {
  const origin = rings[0][0];
  const extent = Math.max(...rings.flat().map(p =>
    Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y))));
  const scale = Math.min(1e7, 1e14 / Math.max(extent, requestedThickness, 1));
  const source = new Map();
  const paths = rings.map((ring, index) => {
    const path = ring.map(p => {
      const point = { X: Math.round((p.x - origin.x) * scale), Y: Math.round((p.y - origin.y) * scale) };
      source.set(`${point.X},${point.Y}`, p);
      return point;
    });
    if (ClipperLib.Clipper.Orientation(path) !== (index === 0)) path.reverse();
    return path;
  });
  let wall = Math.min(requestedThickness, extent / 2), cavity;
  for (let attempt = 0; attempt <= 32; attempt++) {
    const offset = new ClipperLib.ClipperOffset(Math.min(1e6, 1e15 / (Math.max(extent, 1) * scale)), 0.01 * scale);
    offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    cavity = new ClipperLib.Paths();
    offset.Execute(cavity, -wall * scale);
    // A microscopic surviving tip is not a usable cavity in the main filled
    // region. Continue shrinking an oversized wall rather than retaining a
    // nearly collapsed cap around that tip.
    const removedArea = Math.abs(cavity.reduce((sum, path) => sum + ClipperLib.Clipper.Area(path), 0));
    const filledArea = Math.abs(paths.reduce((sum, path) => sum + ClipperLib.Clipper.Area(path), 0));
    if (cavity.length && removedArea > filledArea * 1e-4) break;
    cavity = [];
    wall *= 0.5;
  }
  if (!cavity.length) throw new Error("内側の穴を保持できません。壁厚を小さくしてください。");
  const clip = new ClipperLib.Clipper();
  clip.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  clip.AddPaths(cavity, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  clip.Execute(ClipperLib.ClipType.ctDifference, tree,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const components = [];
  const convert = (node, outer) => {
    const points = node.Contour().map(p => source.get(`${p.X},${p.Y}`)?.clone() ??
      new Vector2(p.X / scale + origin.x, p.Y / scale + origin.y));
    if ((ShapeUtils.area(points) > 0) !== outer) points.reverse();
    return points;
  };
  const visit = node => {
    if (node.Contour().length && !node.IsHole())
      components.push([convert(node, true), ...node.Childs().filter(child => child.IsHole()).map(child => convert(child, false))]);
    for (const child of node.Childs()) visit(child);
  };
  visit(tree);
  if (!components.length) throw new Error("中抜き後の壁を生成できません。壁厚を小さくしてください。");
  return { components, effectiveWallThickness: wall };
}
