import ClipperLib from "clipper-lib";
import { ShapeUtils, Vector2 } from "three";

const cache = new WeakMap();
export function prepareOffsetBevelRoof(rings) {
  if (cache.has(rings)) return cache.get(rings);
  const origin = rings[0][0];
  const extent = Math.max(
    1,
    ...rings
      .flat()
      .map((p) => Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y))),
  );
  const scale = Math.min(1e7, 1e14 / extent);
  const exactSource = new Map();
  const paths = rings.map((r) =>
    r.map((p) => ({
      X: Math.round((p.x - origin.x) * scale),
      Y: Math.round((p.y - origin.y) * scale),
    })),
  );
  paths.forEach((path, i) =>
    path.forEach((p, j) => exactSource.set(`${p.X},${p.Y}`, rings[i][j])),
  );
  paths.forEach((path, i) => {
    if (ClipperLib.Clipper.Orientation(path) !== (i === 0)) path.reverse();
  });
  const inset = (distance) => {
    if (distance === 0) return paths;
    const offset = new ClipperLib.ClipperOffset(10, 0.01 * scale);
    offset.AddPaths(
      paths,
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    const result = new ClipperLib.Paths();
    offset.Execute(result, -distance * scale);
    return result;
  };
  let low = 0,
    high = extent;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (inset(mid).length) low = mid;
    else high = mid;
  }
  const roof = {
    offsetRoof: true,
    rings,
    paths,
    inset,
    origin,
    scale,
    exactSource,
    maximumWidth: Math.max(
      0,
      low - Math.max(low * 0.0001, extent * 2 ** -23 * 2),
    ),
    faces: [null, null],
  };
  cache.set(rings, roof);
  return roof;
}
const segmentDistance = (p, a, b) => {
  const dx = b.X - a.X,
    dy = b.Y - a.Y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.X - a.X - t * dx, p.Y - a.Y - t * dy);
};
function boundaryDistance(p, paths) {
  let best = Infinity;
  for (const ring of paths)
    for (let i = 0; i < ring.length; i++)
      best = Math.min(
        best,
        segmentDistance(p, ring[i], ring[(i + 1) % ring.length]),
      );
  return best;
}
// Walk two corresponding offset loops together instead of letting an unconstrained
// hole triangulator connect distant portions of a curved bevel. Only existing
// boundary vertices are used, so adjacent bands and the cap remain watertight.
function triangulateMatchedBand(subject, clip, a, b, roof) {
  if (!clip.length || subject.length !== clip.length) return null;
  const unused = new Set(clip.map((_, i) => i));
  const triangles = [];
  const point = (p, height) => {
    const original = roof.exactSource.get(`${p.X},${p.Y}`);
    return {
      x: original?.x ?? p.X / roof.scale + roof.origin.x,
      y: original?.y ?? p.Y / roof.scale + roof.origin.y,
      height,
    };
  };
  for (const outer of subject) {
    let chosen = -1,
      best = Infinity;
    for (const index of unused) {
      const candidate = clip[index];
      if (
        ClipperLib.Clipper.Orientation(outer) !==
        ClipperLib.Clipper.Orientation(candidate)
      )
        continue;
      const distance = boundaryDistance(outer[0], [candidate]);
      if (distance < best) {
        best = distance;
        chosen = index;
      }
    }
    if (chosen < 0) return null;
    unused.delete(chosen);
    const inner = clip[chosen];
    let oi = 0,
      ii = 0,
      nearest = Infinity;
    for (let j = 0; j < inner.length; j++) {
      const d = Math.hypot(outer[0].X - inner[j].X, outer[0].Y - inner[j].Y);
      if (d < nearest) {
        nearest = d;
        ii = j;
      }
    }
    let o = 0,
      k = 0,
      area = 0;
    const signed =
      ClipperLib.Clipper.Area(outer) - ClipperLib.Clipper.Area(inner);
    const winding = Math.sign(signed);
    const outerContainsInner =
      Math.abs(ClipperLib.Clipper.Area(outer)) >
      Math.abs(ClipperLib.Clipper.Area(inner));
    const local = [];
    while (o < outer.length || k < inner.length) {
      const op = outer[(oi + o) % outer.length],
        ip = inner[(ii + k) % inner.length];
      const on = outer[(oi + o + 1) % outer.length],
        inn = inner[(ii + k + 1) % inner.length];
      const advanceOuter =
        k === inner.length ||
        (o < outer.length &&
          Math.hypot(on.X - ip.X, on.Y - ip.Y) <=
            Math.hypot(op.X - inn.X, op.Y - inn.Y));
      const raw = advanceOuter ? [op, on, ip] : [op, inn, ip];
      const cross =
        (raw[1].X - raw[0].X) * (raw[2].Y - raw[0].Y) -
        (raw[1].Y - raw[0].Y) * (raw[2].X - raw[0].X);
      if (cross * winding < -1) return null;
      area += cross / 2;
      if (Math.abs(cross) > 1) {
        const centroid = {
          X: (raw[0].X + raw[1].X + raw[2].X) / 3,
          Y: (raw[0].Y + raw[1].Y + raw[2].Y) / 3,
        };
        // A local connection must stay inside the actual band, including concave tips.
        const insideOuter =
          ClipperLib.Clipper.PointInPolygon(centroid, outer) !== 0;
        const insideInner =
          ClipperLib.Clipper.PointInPolygon(centroid, inner) !== 0;
        if (
          outerContainsInner
            ? !insideOuter || insideInner
            : !insideInner || insideOuter
        )
          return null;
        const tri = advanceOuter
          ? [point(op, a.height), point(on, a.height), point(ip, b.height)]
          : [point(op, a.height), point(inn, b.height), point(ip, b.height)];
        if (cross < 0) tri.reverse();
        local.push({ faceIndex: 1, points: tri });
      }
      if (advanceOuter) o++;
      else k++;
    }
    if (Math.abs(area - signed) > Math.max(2, Math.abs(signed) * 1e-8))
      return null;
    triangles.push(...local);
  }
  return triangles;
}
// Triangulate the difference of successive offset regions. Offsets can remove
// small tips or split cavities without shrinking the bevel on every other edge.
export function triangulateOffsetBevelRoof(roof, width, samples, profile) {
  const levels = samples.map((t) => ({
    height: t,
    inset: width * (1 - profile(t)),
  }));
  if (levels.some((p, i) => i && p.inset > levels[i - 1].inset + 1e-8))
    throw new Error(
      "輪郭の合流を伴うベベルでは、戻らないベベルカーブを使用してください。",
    );
  const triangles = [];
  const addRegion = (subject, clip, a, b, cap = false) => {
    if (!subject.length) return;
    if (!cap) {
      const matched = triangulateMatchedBand(subject, clip, a, b, roof);
      if (matched) {
        triangles.push(...matched);
        return;
      }
    }
    const key = (p) => `${p.X},${p.Y}`;
    const subjectKeys = new Set(subject.flat().map(key));
    const clipKeys = new Set(clip.flat().map(key));
    const pointHeight = (p) => {
      if (cap) return a.height;
      const k = key(p);
      if (subjectKeys.has(k) && !clipKeys.has(k)) return a.height;
      if (clipKeys.has(k)) return b.height;
      return boundaryDistance(p, subject) < boundaryDistance(p, clip)
        ? a.height
        : b.height;
    };
    const c = new ClipperLib.Clipper();
    c.PreserveCollinear = true;
    c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
    if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    c.Execute(
      clip.length
        ? ClipperLib.ClipType.ctDifference
        : ClipperLib.ClipType.ctUnion,
      tree,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    const visit = (node) => {
      if (!node.IsHole() && node.Contour().length) {
        const paths = [
          node.Contour(),
          ...node
            .Childs()
            .filter((n) => n.IsHole())
            .map((n) => n.Contour()),
        ];
        const points = paths.map((path) =>
          path.map((p) => {
            const source = roof.exactSource.get(`${p.X},${p.Y}`);
            return {
              x: source?.x ?? p.X / roof.scale + roof.origin.x,
              y: source?.y ?? p.Y / roof.scale + roof.origin.y,
              height: pointHeight(p),
            };
          }),
        );
        const flat = points.flat();
        for (const ids of ShapeUtils.triangulateShape(
          points[0].map((p) => new Vector2(p.x, p.y)),
          points.slice(1).map((r) => r.map((p) => new Vector2(p.x, p.y))),
        )) {
          const tri = ids.map((i) => flat[i]);
          const cross =
            (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) -
            (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
          if (Math.abs(cross) < 1e-10) continue;
          if (cross < 0) tri.reverse();
          triangles.push({ faceIndex: cap ? 0 : 1, points: tri });
        }
      }
      for (const child of node.Childs()) visit(child);
    };
    visit(tree);
  };
  let previous = roof.inset(levels[0].inset);
  addRegion(previous, [], levels[0], levels[0], true);
  for (let i = 1; i < levels.length; i++) {
    const next = roof.inset(levels[i].inset);
    addRegion(next, previous, levels[i], levels[i - 1]);
    previous = next;
  }
  return triangles;
}
