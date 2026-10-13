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
  const offset = new ClipperLib.ClipperOffset(10, 0.01 * scale);
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
