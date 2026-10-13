import cdt2d from "cdt2d";
import { validateRoofTriangles } from "./roof-topology.js";
import { ShapeUtils, Vector2 } from "three";
import skeletonPackage from "straight-skeleton";

const { SkeletonBuilder } = skeletonPackage;
const EPS = 1e-8;
// Cache the expensive topology, which is independent of extrusion/profile edits.
const cache = new WeakMap();
const failures = new WeakMap();
export function invalidateBevelRoof(rings, error) {
  cache.delete(rings);
  failures.set(rings, error);
}
export function prepareBevelRoof(rings) {
  if (cache.has(rings)) return cache.get(rings);
  if (failures.has(rings)) throw failures.get(rings);
  let result;
  try {
    result = SkeletonBuilder.BuildFromGeoJSON([
      rings.map((ring) => ring.map((p) => [p.x, p.y])),
    ]);
  } catch (error) {
    failures.set(rings, error);
    throw error;
  }
  if (!result?.Edges?.length)
    throw new Error("輪郭の稜線を生成できませんでした。");
  const distanceByPoint = new Map(
    Array.from(result.Distances, ([p, t]) => [`${p.X},${p.Y}`, t]),
  );
  const faces = result.Edges.map((edge) =>
    edge.Polygon.map((p) => ({
      x: p.X,
      y: p.Y,
      time: distanceByPoint.get(`${p.X},${p.Y}`) ?? 0,
    })),
  );
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
    [...incidence].some(([key, count]) => count !== (boundary.has(key) ? 1 : 2))
  ) {
    const error = new Error("輪郭の稜線が側面の境界と一致しません。");
    failures.set(rings, error);
    throw error;
  }
  const maximumWidth = Math.max(...faces.flat().map((p) => p.time));
  if (
    !(maximumWidth > EPS) ||
    faces.flat().some((p) => ![p.x, p.y, p.time].every(Number.isFinite))
  )
    throw new Error("輪郭の稜線が不正です。");
  const roof = { faces, maximumWidth, rings };
  cache.set(rings, roof);
  return roof;
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
  const triangles = [];
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
    for (const indices of cells) {
      const base = indices.map((i) => face[i]);
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
          if (Math.abs(cross) < EPS) continue;
          if (cross < 0) tri.reverse();
          triangles.push({
            faceIndex,
            points: tri.map((p) => ({ ...p, height: heightAt(p.time) })),
          });
        }
      }
    }
  }
  validateRoofTriangles(triangles, roof.rings);
  return triangles;
}
