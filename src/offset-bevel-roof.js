import ClipperLib from "clipper-lib";
import cdt2d from "cdt2d";
import { validateRoofTriangles } from "./roof-topology.js";

const cache = new WeakMap();
export function prepareOffsetBevelRoof(rings, widthHint) {
  const hintKey = Number.isFinite(widthHint) && widthHint > 0 ? widthHint : 0;
  let roofs = cache.get(rings);
  if (!roofs) { roofs = new Map(); cache.set(rings, roofs); }
  if (roofs.has(hintKey)) return roofs.get(hintKey);
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
  const precisePaths = paths.map((path) =>
    path.map((p) => {
      const original = exactSource.get(`${p.X},${p.Y}`);
      return {
        X: (original.x - origin.x) * scale,
        Y: (original.y - origin.y) * scale,
      };
    }),
  );
  const layerCache = new Map();
  const inset = (distance, density = true) => {
    const cacheKey = `${distance}:${density}`;
    if (layerCache.has(cacheKey)) return layerCache.get(cacheKey);
    if (distance < 1 / scale)
      return paths.map((ring, r) =>
        ring.map((p, i) => ({ ...p, sourceRing: r, sourceIndex: i })),
      );
    // A low miter limit truncates acute cavity corners before the wavefront
    // meets its opposing side. That changes the ring topology and forces a
    // zipper fan instead of the source corner's straight bisector rail.
    // Boolean offset clipping still resolves actual collisions; do not bevel
    // the mathematical miter merely because its source angle is acute.
    // Keep possible miter coordinates inside Clipper's exact integer range
    // even for unusually large imported coordinates.
    const miterLimit = Math.min(1e6, 1e15 / (extent * scale));
    const offset = new ClipperLib.ClipperOffset(miterLimit, 0.01 * scale);
    offset.AddPaths(
      paths,
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    const result = new ClipperLib.Paths();
    offset.Execute(result, -distance * scale);
    if (!density) return result;
    // A valid parallel offset retains source indices, including short collinear
    // edges that Clipper intentionally removes. This is exact correspondence,
    // not a nearest-neighbor triangle fan.
    const direct = precisePaths.map((path, index) =>
      parallelOffset(path, distance * scale, index),
    );
    const directArea = direct.reduce(
      (sum, ring) => sum + ClipperLib.Clipper.Area(ring),
      0,
    );
    const clippedArea = result.reduce(
      (sum, ring) => sum + ClipperLib.Clipper.Area(ring),
      0,
    );
    const forward = direct.every((ring, r) =>
      ring.every((p, i) => {
        const q = ring[(i + 1) % ring.length],
          a = precisePaths[r][i],
          b = precisePaths[r][(i + 1) % ring.length];
        return (q.X - p.X) * (b.X - a.X) + (q.Y - p.Y) * (b.Y - a.Y) > 0;
      }),
    );
    const compatible =
      direct.length === result.length &&
      forward &&
      Math.abs(directArea - clippedArea) <=
        Math.max(scale * scale * 1e-7, Math.abs(clippedArea) * 1e-7);
    const value = compatible
      ? direct
      : result.map((ring) => retainContourDensity(ring, paths, origin, scale, distance));
    if (layerCache.size >= 64)
      layerCache.delete(layerCache.keys().next().value);
    layerCache.set(cacheKey, value);
    return value;
  };
  let low = 0,
    high =
      Number.isFinite(widthHint) && widthHint > 0
        ? Math.min(extent, widthHint)
        : extent;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (inset(mid, false).length) low = mid;
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
    triangleCache: new Map(),
  };
  if (roofs.size >= 4) roofs.delete(roofs.keys().next().value);
  roofs.set(hintKey, roof);
  return roof;
}
function parallelOffset(path, distance, ringIndex) {
  return path.map((p, i) => {
    const prev = path[(i + path.length - 1) % path.length],
      next = path[(i + 1) % path.length];
    const al = Math.hypot(p.X - prev.X, p.Y - prev.Y),
      bl = Math.hypot(next.X - p.X, next.Y - p.Y);
    const ax = (p.X - prev.X) / al,
      ay = (p.Y - prev.Y) / al,
      bx = (next.X - p.X) / bl,
      by = (next.Y - p.Y) / bl;
    const sx = -ay - by,
      sy = ax + bx,
      denom = sx * -by + sy * bx;
    const t = Math.abs(denom) < 1e-12 ? 0 : distance / denom;
    return {
      X: p.X + sx * t,
      Y: p.Y + sy * t,
      sourceRing: ringIndex,
      sourceIndex: i,
    };
  });
}
// Offset cleanup may collapse dozens of short input edges into one long edge.
// Reinsert their closest boundary positions, keeping the offset itself unchanged.
// This controls tangential tessellation independently of bevel profile samples.
function retainContourDensity(ring, sources, origin, scale, insetDistance) {
  const compatible = sources.filter(
    (source) =>
      ClipperLib.Clipper.Orientation(source) ===
      ClipperLib.Clipper.Orientation(ring),
  );
  const candidates = compatible.length ? compatible : sources;
  const source = candidates.reduce((best, candidate) =>
    boundaryDistance(ring[0], [candidate]) < boundaryDistance(ring[0], [best])
      ? candidate
      : best,
  );
  const inserts = ring.map(() => []);
  for (const p of source) {
    let nearest = Infinity,
      edge = 0,
      parameter = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      const dx = b.X - a.X,
        dy = b.Y - a.Y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      const distance = Math.hypot(p.X - a.X - t * dx, p.Y - a.Y - t * dy);
      if (distance < nearest) {
        nearest = distance;
        edge = i;
        parameter = t;
      }
    }
    if (parameter > 1e-10 && parameter < 1 - 1e-10)
      inserts[edge].push(parameter);
  }
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    // Source correspondence alone bounds sampling; never subdivide by global mean edge length.
    const sorted = inserts[i].sort((x, y) => x - y);
    const points = [a];
    // Projected correspondence points are optional, not shape corners. Keep
    // a small inset-relative separation so collapsed source details do not
    // reappear as almost coincident vertices and needle triangles.
    const helperSpacing = Math.max(2, insetDistance * scale * 0.01);
    for (const t of sorted) {
      const p = {
        X: a.X + t * (b.X - a.X),
        Y: a.Y + t * (b.Y - a.Y),
        sample: true,
      };
      const previous = points.at(-1);
      const nearRenderedCorner = (corner) => {
        const px = Math.fround(p.X / scale + origin.x),
          py = Math.fround(p.Y / scale + origin.y),
          cx = Math.fround(corner.X / scale + origin.x),
          cy = Math.fround(corner.Y / scale + origin.y);
        return (
          (px === cx || py === cy) &&
          Math.hypot(px - cx, py - cy) <=
            Math.max(1, Math.abs(cx), Math.abs(cy)) * 2 ** -23 * 4
        );
      };
      // Only optional density samples are suppressed near a rendered corner.
      // Original contour vertices and offset corners remain unchanged.
      if (nearRenderedCorner(a) || nearRenderedCorner(b)) continue;
      if (
        Math.hypot(p.X - previous.X, p.Y - previous.Y) > helperSpacing &&
        Math.hypot(p.X - b.X, p.Y - b.Y) > helperSpacing
      )
        points.push(p);
    }
    return points;
  });
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
    if (
      outer.length === inner.length &&
      outer.every((p) => p.sourceIndex !== undefined) &&
      inner.every((p) => p.sourceIndex !== undefined) &&
      outer[0].sourceRing === inner[0].sourceRing
    ) {
      const byIndex = new Map(inner.map((p) => [p.sourceIndex, p]));
      for (let j = 0; j < outer.length; j++) {
        const op = outer[j],
          on = outer[(j + 1) % outer.length];
        const ip = byIndex.get(op.sourceIndex),
          inn = byIndex.get(on.sourceIndex);
        for (const raw of [
          [point(op, a.height), point(on, a.height), point(ip, b.height)],
          [point(on, a.height), point(inn, b.height), point(ip, b.height)],
        ]) {
          const cross =
            (raw[1].x - raw[0].x) * (raw[2].y - raw[0].y) -
            (raw[1].y - raw[0].y) * (raw[2].x - raw[0].x);
          if (Math.abs(cross) < 1e-12) continue;
          if (cross < 0) raw.reverse();
          triangles.push({ faceIndex: 1, points: raw });
        }
      }
      continue;
    }
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
      if (cross * winding < -roof.scale * 4) return null;
      area += cross / 2;
      if (Math.abs(cross) > roof.scale * roof.scale * 1e-12) {
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
            ? (!insideOuter && boundaryDistance(centroid, [outer]) > 2) ||
              (insideInner && boundaryDistance(centroid, [inner]) > 2)
            : (!insideInner && boundaryDistance(centroid, [inner]) > 2) ||
              (insideOuter && boundaryDistance(centroid, [outer]) > 2)
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
// Preserve cross-slice correspondence as constraints. Flip only the free
// diagonal inside each two-sided strip cell; unconstrained 2D triangulation
// of an entire curved band can create flat, same-height ears.
function improveStripDiagonals(matched) {
  const out = [];
  const equal = (a, b) => a.x === b.x && a.y === b.y && a.height === b.height;
  const orient = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < matched.length; i += 2) {
    const first = matched[i],
      second = matched[i + 1];
    const shared = second
      ? first.points.filter((p) => second.points.some((q) => equal(p, q)))
      : [];
    if (shared.length !== 2) {
      for (const tri of second ? [first, second] : [first]) {
        const constraints = tri.points.map((p, j) => [
          p,
          tri.points[(j + 1) % 3],
        ]);
        out.push({ ...tri, constraints });
      }
      continue;
    }
    const [a, b] = shared;
    const c = first.points.find((p) => !shared.some((q) => equal(p, q)));
    const d = second.points.find((p) => !shared.some((q) => equal(p, q)));
    const points = [a, b, c, d];
    const quad = points.filter((p) => p.height === a.height).length === 2;
    const constraints = [
      [a, c],
      [c, b],
      [b, d],
      [d, a],
    ];
    if (!quad) constraints.push([a, b]);
    let cells = [first.points, second.points];
    if (
      quad &&
      orient(a, b, c) * orient(a, b, d) < 0 &&
      orient(c, d, a) * orient(c, d, b) < 0
    ) {
      const ax = a.x - d.x,
        ay = a.y - d.y,
        bx = b.x - d.x,
        by = b.y - d.y,
        cx = c.x - d.x,
        cy = c.y - d.y;
      let determinant =
        (ax * ax + ay * ay) * (bx * cy - by * cx) -
        (bx * bx + by * by) * (ax * cy - ay * cx) +
        (cx * cx + cy * cy) * (ax * by - ay * bx);
      if (orient(a, b, c) < 0) determinant = -determinant;
      if (determinant > 1e-10)
        cells = [
          [a, c, d],
          [b, d, c],
        ];
    }
    for (const cell of cells) {
      if (orient(...cell) < 0) cell.reverse();
      out.push({ faceIndex: 1, points: cell, constraints });
    }
  }
  return out;
}
// Triangulate the difference of successive offset regions. Offsets can remove
// small tips or split cavities without shrinking the bevel on every other edge.
export function triangulateOffsetBevelRoof(roof, width, samples, profile) {
  const triangleKey = JSON.stringify([width, samples, samples.map(profile)]);
  if (roof.triangleCache.has(triangleKey))
    return roof.triangleCache.get(triangleKey);
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
    // A simple annular cap uses the same local strip connectivity without
    // expensive global triangulation. Topology changes retain the constrained
    // polygon triangulator below.
    if (cap && subject.length === 2) {
      const outer = subject.find((p) => ClipperLib.Clipper.Area(p) > 0);
      const hole = subject.find((p) => ClipperLib.Clipper.Area(p) < 0);
      if (outer && hole) {
        const matched = triangulateMatchedBand(
          [outer],
          [[...hole].reverse()],
          a,
          a,
          roof,
        );
        if (matched) {
          triangles.push(...matched.map((t) => ({ ...t, faceIndex: 0 })));
          return;
        }
      }
    }
    if (!cap) {
      const matched = triangulateMatchedBand(subject, clip, a, b, roof);
      if (matched) {
        triangles.push(...improveStripDiagonals(matched));
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
    const allBoundary = [...subject, ...clip].flat();
    const boundaryByKey = new Map(allBoundary.map((p) => [key(p), p]));
    const boundaryGrid = new Map();
    for (const p of allBoundary) {
      const gridKey = `${Math.round(p.X)},${Math.round(p.Y)}`;
      if (!boundaryGrid.has(gridKey)) boundaryGrid.set(gridKey, []);
      boundaryGrid.get(gridKey).push(p);
    }
    const boundaryRings = [...subject, ...clip].map((ring) =>
      ring.map((p) => {
        const original = roof.exactSource.get(`${p.X},${p.Y}`);
        return {
          x: original?.x ?? p.X / roof.scale + roof.origin.x,
          y: original?.y ?? p.Y / roof.scale + roof.origin.y,
          height: pointHeight(p),
        };
      }),
    );
    const boundaryLookup = new Map();
    boundaryRings.forEach((ring, r) =>
      ring.forEach((p, i) => {
        const k = `${Math.fround(p.x)},${Math.fround(p.y)},${p.height}`;
        if (!boundaryLookup.has(k)) boundaryLookup.set(k, []);
        boundaryLookup.get(k).push({ ring: r, index: i });
      }),
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
            // Boolean intersection rounding must reuse the neighboring layer's
            // actual boundary coordinate rather than invent a second seam point.
            let original = boundaryByKey.get(key(p));
            if (!original) {
              let nearest = 2;
              const gx = Math.round(p.X),
                gy = Math.round(p.Y);
              for (let dx = -2; dx <= 2; dx++)
                for (let dy = -2; dy <= 2; dy++)
                  for (const q of boundaryGrid.get(`${gx + dx},${gy + dy}`) ||
                    []) {
                    const distance = Math.hypot(q.X - p.X, q.Y - p.Y);
                    if (distance < nearest) {
                      nearest = distance;
                      original = q;
                    }
                  }
            }
            if (original) p = original;
            const source = roof.exactSource.get(`${p.X},${p.Y}`);
            return {
              x: source?.x ?? p.X / roof.scale + roof.origin.x,
              y: source?.y ?? p.Y / roof.scale + roof.origin.y,
              height: pointHeight(p),
            };
          }),
        );
        const flat = points.flat();
        const edges = [];
        let start = 0;
        for (const loop of points) {
          for (let i = 0; i < loop.length; i++)
            edges.push([start + i, start + ((i + 1) % loop.length)]);
          start += loop.length;
        }
        const cells = cdt2d(
          flat.map((p) => [p.x, p.y]),
          edges,
          { exterior: false },
        );
        for (const ids of cells) {
          const tri = ids.map((i) => flat[i]);
          const cross =
            (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) -
            (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
          if (Math.abs(cross) < 1e-10) continue;
          if (cross < 0) tri.reverse();
          // Earcut omits collinear boundary samples. Split its boundary edges
          // back at those samples so the cap and adjacent bands share seams.
          const pending = [tri];
          // An earcut boundary edge either has consecutive loop indices or
          // skips collinear points. Inspect only that index interval, never all
          // boundary points for every face (the former quadratic bottleneck).
          const pointKey = (p) =>
            `${Math.fround(p.x)},${Math.fround(p.y)},${p.height}`;
          for (let n = 0; n < pending.length; n++) {
            const face = pending[n];
            let split = false;
            for (let j = 0; j < 3; j++) {
              const a = face[j],
                b = face[(j + 1) % 3],
                c = face[(j + 2) % 3];
              const locationsA = boundaryLookup.get(pointKey(a)) || [];
              const locationsB = boundaryLookup.get(pointKey(b)) || [];
              const dx = b.x - a.x,
                dy = b.y - a.y,
                length2 = dx * dx + dy * dy;
              if (!length2) continue;
              for (const la of locationsA) {
                const lb = locationsB.find((v) => v.ring === la.ring);
                if (!lb) continue;
                const boundaryRing = boundaryRings[la.ring];
                for (const step of [1, -1]) {
                  let index =
                    (la.index + step + boundaryRing.length) %
                    boundaryRing.length;
                  if (index === lb.index) continue;
                  const q = boundaryRing[index];
                  const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / length2;
                  if (
                    !(t > 1e-8 && t < 1 - 1e-8) ||
                    Math.abs(dx * (q.y - a.y) - dy * (q.x - a.x)) >
                      Math.sqrt(length2) * 1e-7 ||
                    Math.abs(
                      q.height - (a.height + t * (b.height - a.height)),
                    ) > 1e-7
                  )
                    continue;
                  if (
                    Math.hypot(q.x - a.x, q.y - a.y) < 1e-6 ||
                    Math.hypot(q.x - b.x, q.y - b.y) < 1e-6
                  )
                    continue;
                  pending[n] = [a, q, c];
                  pending.push([q, b, c]);
                  split = true;
                  break;
                }
                if (split) break;
              }
              if (split) break;
            }
          }
          for (const face of pending)
            triangles.push({ faceIndex: cap ? 0 : 1, points: face });
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
  const equalRendered = (a, b) =>
    Math.fround(a.x) === Math.fround(b.x) &&
    Math.fround(a.y) === Math.fround(b.y) &&
    Math.fround(a.height) === Math.fround(b.height);
  let kept = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.points;
    if (equalRendered(a, b) || equalRendered(b, c) || equalRendered(c, a))
      continue;
    triangles[kept++] = triangle;
  }
  triangles.length = kept;
  validateRoofTriangles(triangles, roof.rings);
  if (roof.triangleCache.size >= 8)
    roof.triangleCache.delete(roof.triangleCache.keys().next().value);
  roof.triangleCache.set(triangleKey, triangles);
  return triangles;
}
