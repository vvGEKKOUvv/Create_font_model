import cdt2d from "cdt2d";
import { cleanupPlanarPatch } from "./roof-planar-cleanup.js";
import { validateRoofTriangles } from "./roof-topology.js";
import { repairHollowMidpointTriangles } from "./hollow-ring-repair.js";
import { ShapeUtils, Vector2 } from "three";
import skeletonPackage from "straight-skeleton";

const { SkeletonBuilder } = skeletonPackage;
const EPS = 1e-8;
// Cache the expensive topology, which is independent of extrusion/profile edits.
const cache = new WeakMap();
const failures = new WeakMap();
const rejectedStrategies = new WeakMap();
export function invalidateBevelRoof(rings, error) {
  const rejected = cache.get(rings);
  cache.delete(rings);
  if (!rejected) {
    failures.set(rings, error);
    return;
  }
  let strategies = rejectedStrategies.get(rings);
  if (!strategies) rejectedStrategies.set(rings, (strategies = new Set()));
  strategies.add(rejected.regularization ?? 0);
  if (strategies.size >= 4) failures.set(rings, error);
}
const strategies = new WeakMap();
export function prepareBevelRoof(rings, family = rings) {
  if (cache.has(rings)) return cache.get(rings);
  if (failures.has(rings)) throw failures.get(rings);
  const previous = strategies.get(family);
  // Try the unmodified metric first. A bounded numerical perturbation separates
  // coincident split events only when the kernel cannot resolve them. Remember
  // the successful strategy across wall-thickness variants of the same shape.
  const choices = [...new Set([previous ?? 0, 0, 1e-6, -1e-6, 1e-5])];
  let rejected = rejectedStrategies.get(rings);
  if (!rejected) rejectedStrategies.set(rings, (rejected = new Set()));
  let failure;
  for (const shear of choices) {
    if (rejected.has(shear)) continue;
    try {
      const roof = buildRoof(rings, shear);
      cache.set(rings, roof);
      strategies.set(family, shear);
      return roof;
    } catch (error) {
      failure = error;
      rejected.add(shear);
    }
  }
  failures.set(rings, failure);
  throw failure;
}
function buildRoof(rings, shear) {
  const origin = shear ? rings[0][0] : { x: 0, y: 0 };
  const originals = new Map();
  const roundedOriginals = new Map();
  const roundedKey = (x, y) => `${Math.round(x * 1e7)},${Math.round(y * 1e7)}`;
  const coordinates = rings.map((ring) =>
    ring.map((p) => {
      const x = p.x - origin.x,
        y = p.y - origin.y;
      const a = x + shear * y,
        b = y + shear * x;
      originals.set(`${a},${b}`, p);
      roundedOriginals.set(roundedKey(a, b), p);
      return [a, b];
    }),
  );
  const result = SkeletonBuilder.BuildFromGeoJSON([coordinates]);
  if (!result?.Edges?.length)
    throw new Error("輪郭の稜線を生成できませんでした。");
  const restore = (p) => {
    const original =
      originals.get(`${p.X},${p.Y}`) ??
      roundedOriginals.get(roundedKey(p.X, p.Y));
    if (original) return { x: original.x, y: original.y, source: true };
    const determinant = 1 - shear * shear;
    return {
      x: (p.X - shear * p.Y) / determinant + origin.x,
      y: (p.Y - shear * p.X) / determinant + origin.y,
    };
  };
  const distanceByPoint = new Map(
    Array.from(result.Distances, ([p, t]) => [`${p.X},${p.Y}`, t]),
  );
  const roundedTimes = new Map(
    Array.from(result.Distances, ([p, t]) => [roundedKey(p.X, p.Y), t]),
  );
  let faces = result.Edges.map((edge) =>
    edge.Polygon.map((p) => ({
      ...restore(p),
      time:
        distanceByPoint.get(`${p.X},${p.Y}`) ??
        roundedTimes.get(roundedKey(p.X, p.Y)) ??
        0,
    })),
  );
  const ridgeTolerance = shear
    ? Math.max(
        1e-5,
        Math.abs(shear) *
          Math.max(
            1,
            ...rings
              .flat()
              .map((p) => Math.hypot(p.x - rings[0][0].x, p.y - rings[0][0].y)),
          ),
      )
    : 0;
  if (shear) {
    const tolerance = Math.max(1e-5, ridgeTolerance),
      grid = new Map();
    faces = faces.map((face) =>
      face
        .map((p) => {
          // Exact source vertices are never merged. Only internal, near-coincident
          // events introduced by the numerical perturbation share one ridge node.
          if (p.source || p.time <= EPS) return p;
          const gx = Math.floor(p.x / tolerance),
            gy = Math.floor(p.y / tolerance);
          let canonical;
          for (let dx = -1; dx <= 1 && !canonical; dx++)
            for (let dy = -1; dy <= 1 && !canonical; dy++)
              canonical = (grid.get(`${gx + dx},${gy + dy}`) || []).find(
                (q) =>
                  Math.hypot(q.x - p.x, q.y - p.y) <= tolerance &&
                  Math.abs(q.time - p.time) <= tolerance,
              );
          if (canonical) return canonical;
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(p);
          return p;
        })
        .filter((p, i, all) => i === 0 || p !== all[i - 1]),
    );
    faces = faces.map((face) =>
      face.length > 1 && face[0] === face.at(-1) ? face.slice(0, -1) : face,
    );
  }
  // A kernel can return finite faces after a near-simultaneous event while
  // silently dropping a boundary edge. Reject that topology before it is used
  // for the bevel; the original side wall must share every boundary edge.
  const pointKey = (p) => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
  const edgeKey = (a, b) => [pointKey(a), pointKey(b)].sort().join("|");
  const boundary = new Set();
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++)
      boundary.add(edgeKey(ring[i], ring[(i + 1) % ring.length]));
  const incidence = new Map();
  const times = new Map();
  let invalidTimes = false;
  for (const face of faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length];
      if (Math.hypot(a.x - b.x, a.y - b.y) < EPS) continue;
      const key = edgeKey(a, b);
      incidence.set(key, (incidence.get(key) || 0) + 1);
      if (
        boundary.has(key) &&
        (Math.abs(a.time) > EPS || Math.abs(b.time) > EPS)
      )
        invalidTimes = true;
      for (const point of [a, b]) {
        const pk = pointKey(point),
          previous = times.get(pk);
        if (
          previous !== undefined &&
          Math.abs(previous - point.time) >
            EPS * Math.max(1, previous, point.time)
        )
          invalidTimes = true;
        times.set(pk, point.time);
      }
    }
  if (
    invalidTimes ||
    [...boundary].some((key) => incidence.get(key) !== 1) ||
    // Perturbed kernels can retain zero-width terminal edges. The sampled
    // surface must still pass the complete edge validation below.
    (shear === 0 &&
      [...incidence].some(
        ([key, count]) => count !== (boundary.has(key) ? 1 : 2),
      ))
  ) {
    const error = new Error("輪郭の稜線が側面の境界と一致しません。");
    throw error;
  }
  const inside = (p, ring) => {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        result = !result;
    }
    return result;
  };
  // Terminal events after a wavefront has vanished can lie outside its solid
  // footprint. They do not define the reachable width of the actual bevel.
  const maximumWidth = Math.max(
    0,
    ...faces
      .flat()
      .filter(
        (p) =>
          p.time > EPS &&
          inside(p, rings[0]) &&
          !rings.slice(1).some((hole) => inside(p, hole)),
      )
      .map((p) => p.time),
  );
  if (
    !(maximumWidth > EPS) ||
    faces.flat().some((p) => ![p.x, p.y, p.time].every(Number.isFinite))
  )
    throw new Error("輪郭の稜線が不正です。");
  return { faces, maximumWidth, rings, regularization: shear, ridgeTolerance };
}

function cut(poly, limit, keepAbove) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const insideA = keepAbove ? a.time >= limit - EPS : a.time <= limit + EPS;
    const insideB = keepAbove ? b.time >= limit - EPS : b.time <= limit + EPS;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const ratio = (limit - a.time) / (b.time - a.time);
      out.push({
        x: a.x + ratio * (b.x - a.x),
        y: a.y + ratio * (b.y - a.y),
        time: limit,
      });
    }
  }
  return out.filter(
    (p, i) => !i || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > EPS,
  );
}

// Every face is a plane whose time is distance from its source edge. Cutting
// faces at common distance levels gives matching vertices along shared
// skeleton edges, including topology changes at narrow-stroke collisions.
export function triangulateBevelRoof(roof, width, samples, profile) {
  const triangleKey = JSON.stringify([width, samples, samples.map(profile)]);
  roof.triangleCache ||= new Map();
  if (roof.triangleCache.has(triangleKey))
    return roof.triangleCache.get(triangleKey);
  const sampled = samples.map((t) => ({ time: width * (1 - profile(t)), t }));
  if (sampled.some((p, i) => i && p.time > sampled[i - 1].time + EPS))
    throw new Error(
      "正面の合流モードでは、戻らないベベルカーブを使用してください。",
    );
  const limits = [
    ...new Set([0, ...sampled.map((p) => p.time), roof.maximumWidth]),
  ].sort((a, b) => a - b);
  const heightAt = (time) => {
    if (time >= width - EPS) return 0;
    if (time <= EPS) return 1;
    for (let i = 1; i < sampled.length; i++) {
      const a = sampled[i - 1],
        b = sampled[i];
      if (time <= a.time + EPS && time >= b.time - EPS && a.time - b.time > EPS)
        return a.t + (b.t - a.t) * ((a.time - time) / (a.time - b.time));
    }
    return 0;
  };
  let triangles = [];
  const uncleanedTriangles = [];
  roof.faceCells ||= [];
  for (let faceIndex = 0; faceIndex < roof.faces.length; faceIndex++) {
    const face = roof.faces[faceIndex];
    const contour = face.map((p) => [p.x, p.y]);
    const boundary = contour.map((_, index) => [
      index,
      (index + 1) % contour.length,
    ]);
    let cells = roof.faceCells[faceIndex];
    if (!cells) {
      cells =
        face.length === 3
          ? [[0, 1, 2]]
          : face.length === 4
            ? ShapeUtils.triangulateShape(
                face.map((p) => new Vector2(p.x, p.y)),
                [],
              )
            : cdt2d(contour, boundary, { exterior: false });
      if (!cells.length)
        cells = ShapeUtils.triangulateShape(
          face.map((p) => new Vector2(p.x, p.y)),
          [],
        );
      roof.faceCells[faceIndex] = cells;
    }
    // Clip a convex source-edge face before triangulating it. Cutting its
    // already triangulated diagonals creates extra vertices on every band,
    // although those diagonals have no geometric meaning. Concave cells retain
    // the constrained triangulation because clipping may disconnect them.
    let turn = 0;
    const convex = face.every((p, i) => {
      const q = face[(i + 1) % face.length], r = face[(i + 2) % face.length];
      const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
      if (Math.abs(cross) <= EPS) return true;
      const sign = Math.sign(cross);
      if (turn && turn !== sign) return false;
      turn = sign;
      return true;
    });
    const polygons = convex ? [face] : cells.map((indices) => indices.map((i) => face[i]));
    const protectedPoints = new Set();
    const pointKey = p => `${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(heightAt(p.time) * 1e7)}`;
    for (let i=0;!convex && i<face.length;i++) {
      const a=face[i], b=face[(i+1)%face.length];
      protectedPoints.add(pointKey(a));
      for (const time of limits) if ((time-a.time)*(time-b.time)<0) {
        const t=(time-a.time)/(b.time-a.time);
        protectedPoints.add(pointKey({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,time}));
      }
    }
    const bands = limits.slice(1).map(() => []);
    for (const base of polygons) {
      for (let band = 0; band < limits.length - 1; band++) {
        const poly = cut(
          cut(base, limits[band], true),
          limits[band + 1],
          false,
        );
        for (let i = 1; i < poly.length - 1; i++) {
          const tri = [poly[0], poly[i], poly[i + 1]];
          const cross =
            (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) -
            (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
          if (cross === 0) continue;
          if (cross < 0) tri.reverse();
          bands[band].push({
            faceIndex,
            points: tri.map((p) => ({ ...p, height: heightAt(p.time) })),
          });
        }
      }
    }
    for (const band of bands) uncleanedTriangles.push(...band);
    for (const band of bands) triangles.push(...(convex ? band : cleanupPlanarPatch(band, p => !protectedPoints.has(`${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(p.height * 1e7)}`))));
  }
  const sameRendered = (a, b) =>
    Math.fround(a.x) === Math.fround(b.x) &&
    Math.fround(a.y) === Math.fround(b.y) &&
    Math.fround(a.height) === Math.fround(b.height);
  let kept = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.points;
    if (sameRendered(a, b) || sameRendered(b, c) || sameRendered(c, a))
      continue;
    triangles[kept++] = triangle;
  }
  triangles.length = kept;
  try { validateRoofTriangles(triangles, roof.rings); }
  catch (error) {
    // Band seam rounding can differ at an event. Keep the original valid
    // triangulation rather than selecting another skeleton or losing a hole.
    let original = uncleanedTriangles.filter(({points:[a,b,c]}) => !sameRendered(a,b) && !sameRendered(b,c) && !sameRendered(c,a));
    try { validateRoofTriangles(original, roof.rings); }
    catch (failure) {
      if (!roof.midpointRoof) throw failure;
      try {
        // Recover only tiny numerical seam gaps or a missing collinear
        // centre-ring node. The repair must validate against every original
        // boundary before it can replace the sampled surface.
        original = repairHollowMidpointTriangles(original, roof, heightAt);
      } catch {
        // A roof is a single-valued height field. At a sampled collision, two
        // distinct double-precision XY nodes can become one renderer vertex.
        // Merge their subpixel heights as well, rather than retaining a tiny
        // vertical slit or abandoning the entire shared meeting roof.
        const rendered = new Map();
        for (const { points } of original) for (const p of points) {
          const key = `${Math.fround(p.x)},${Math.fround(p.y)}`;
          const entry = rendered.get(key);
          if (entry) { entry.min = Math.min(entry.min, p.height); entry.max = Math.max(entry.max, p.height); }
          else rendered.set(key, { min: p.height, max: p.height });
        }
        const merged = original.map(face => ({ ...face, points: face.points.map(p => {
          const entry = rendered.get(`${Math.fround(p.x)},${Math.fround(p.y)}`);
          return entry.max - entry.min < 1e-3
            ? { ...p, height: entry.max === 1 ? 1 : entry.min }
            : p;
        }) })).filter(({ points: [a,b,c] }) => !sameRendered(a,b) && !sameRendered(b,c) && !sameRendered(c,a));
        validateRoofTriangles(merged, roof.rings);
        original = merged;
      }
    }
    triangles = original;
  }
  if (roof.triangleCache.size >= 2)
    roof.triangleCache.delete(roof.triangleCache.keys().next().value);
  roof.triangleCache.set(triangleKey, triangles);
  return triangles;
}
