import * as THREE from "three";
import skeletonPackage from "straight-skeleton";

const { SkeletonBuilder } = skeletonPackage;
const EPS = 1e-8;
// Cache the expensive topology, which is independent of extrusion/profile edits.
const cache = new WeakMap();
export function prepareBevelRoof(rings) {
  if (cache.has(rings)) return cache.get(rings);
  const result = SkeletonBuilder.BuildFromGeoJSON([
    rings.map((ring) => ring.map((p) => [p.x, p.y])),
  ]);
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
  const maximumWidth = Math.max(...faces.flat().map((p) => p.time));
  if (
    !(maximumWidth > EPS) ||
    faces.flat().some((p) => ![p.x, p.y, p.time].every(Number.isFinite))
  )
    throw new Error("輪郭の稜線が不正です。");
  const roof = { faces, maximumWidth };
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
// triangles at common distance levels gives matching vertices along shared
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
  for (let faceIndex = 0; faceIndex < roof.faces.length; faceIndex++) {
    const face = roof.faces[faceIndex];
    const contour = face.map((p) => new THREE.Vector2(p.x, p.y));
    for (const indices of THREE.ShapeUtils.triangulateShape(contour, [])) {
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
  return triangles;
}
