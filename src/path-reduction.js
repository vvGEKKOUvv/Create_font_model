import { Vector2 } from "three";

const cache = new WeakMap();
const MAX_RAW = 20000;
const MAX_GEOMETRY = 3000;
const sharpCos = Math.cos((35 * Math.PI) / 180);
const area = (ring) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
const distanceSq = (p, a, b) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
};
export function clean(points, epsilon) {
  const ring = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error("パスに不正な座標があります。");
    if (!ring.length || ring.at(-1).distanceToSquared(p) > epsilon ** 2)
      ring.push(new Vector2(p.x, p.y));
  }
  if (ring.length > 1 && ring[0].distanceToSquared(ring.at(-1)) <= epsilon ** 2)
    ring.pop();
  // Linked neighbours avoid repeated array splices for densely sampled straight edges.
  const next = ring.map((_, i) => (i + 1) % ring.length);
  const previous = ring.map((_, i) => (i + ring.length - 1) % ring.length);
  const alive = new Uint8Array(ring.length).fill(1);
  const queue = ring.map((_, i) => ring.length - 1 - i);
  let count = ring.length;
  for (let head = 0; head < queue.length && count > 3; head++) {
    const i = queue[head];
    if (!alive[i]) continue;
    const a = previous[i], b = next[i];
    if (distanceSq(ring[i], ring[a], ring[b]) <= epsilon ** 2) {
      alive[i] = 0;
      count--;
      next[a] = b;
      previous[b] = a;
      queue.push(a, b);
    }
  }
  const retained = ring.filter((_, i) => alive[i]);
  ring.length = 0;
  for (const p of retained) ring.push(p);
  if (ring.length < 3 || Math.abs(area(ring)) <= epsilon ** 2)
    throw new Error(
      "輪郭が退化しています。閉じた面積のあるパスを使用してください。",
    );
  return ring;
}
export function simplify(ring, tolerance, operationLimit = Infinity) {
  let operations = 0;
  const anchors = [0];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length],
      p = ring[i],
      b = ring[(i + 1) % ring.length];
    const ax = p.x - a.x,
      ay = p.y - a.y,
      bx = b.x - p.x,
      by = b.y - p.y;
    if (
      (ax * bx + ay * by) /
        Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by)) <
      sharpCos
    )
      anchors.push(i);
  }
  if (anchors.length === 1) {
    let farthest = 1;
    for (let i = 2; i < ring.length; i++)
      if (
        ring[i].distanceToSquared(ring[0]) >
        ring[farthest].distanceToSquared(ring[0])
      )
        farthest = i;
    anchors.push(farthest);
  }
  const keep = new Set(anchors),
    squared = tolerance ** 2;
  for (let k = 0; k < anchors.length; k++) {
    const start = anchors[k],
      end = k + 1 < anchors.length ? anchors[k + 1] : ring.length;
    const stack = [[start, end]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let farthest = -1,
        max = squared;
      for (let i = a + 1; i < b; i++) {
        if (++operations > operationLimit) throw new Error("輪郭の簡略化が複雑すぎます。SVG を分割してください。");
        const d = distanceSq(
          ring[i % ring.length],
          ring[a % ring.length],
          ring[b % ring.length],
        );
        if (d > max) {
          max = d;
          farthest = i;
        }
      }
      if (farthest !== -1) {
        keep.add(farthest % ring.length);
        stack.push([a, farthest], [farthest, b]);
      }
    }
  }
  return ring.filter((_, i) => keep.has(i));
}
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function intersects(a, b, c, d, eps) {
  if (
    Math.max(a.x, b.x) + eps < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + eps < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + eps < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + eps < Math.min(a.y, b.y)
  )
    return false;
  const scale = Math.max(a.distanceTo(b), c.distanceTo(d), eps),
    threshold = eps * scale;
  const sign = (x) => (x > threshold ? 1 : x < -threshold ? -1 : 0);
  return (
    sign(cross(a, b, c)) * sign(cross(a, b, d)) <= 0 &&
    sign(cross(c, d, a)) * sign(cross(c, d, b)) <= 0
  );
}
function inside(p, ring) {
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
}
export function valid(rings, epsilon) {
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (
      ring.length < 3 ||
      Math.abs(area(ring)) <= epsilon ** 2 ||
      area(ring) > 0 !== (r === 0)
    )
      return false;
    for (let s = r; s < rings.length; s++) {
      const other = rings[s];
      for (let i = 0; i < ring.length; i++)
        for (let j = s === r ? i + 1 : 0; j < other.length; j++) {
          if (r === s && (j === i + 1 || (i === 0 && j === ring.length - 1)))
            continue;
          if (
            intersects(
              ring[i],
              ring[(i + 1) % ring.length],
              other[j],
              other[(j + 1) % other.length],
              epsilon,
            )
          )
            return false;
        }
    }
    if (r > 0 && !inside(ring[0], rings[0])) return false;
    for (let s = 1; s < r; s++)
      if (inside(ring[0], rings[s]) || inside(rings[s][0], ring)) return false;
  }
  return true;
}

/** Cached contours are immutable input: callers must clone before editing them. */
export function prepareContours(shape, tolerance = 0) {
  tolerance = Number.isFinite(Number(tolerance))
    ? Math.max(0, Number(tolerance))
    : 0;
  let entry = cache.get(shape);
  if (!entry) {
    const extracted = shape.extractPoints(24);
    const raw = [extracted.shape, ...extracted.holes];
    const rawCount = raw.reduce((n, ring) => n + ring.length, 0);
    if (rawCount > MAX_RAW)
      throw new Error(
        "パスの頂点が多すぎます（最大 20,000）。SVG を分割してください。",
      );
    const all = raw.flat();
    const bounds = all.reduce(
      (b, p) => [
        Math.min(b[0], p.x),
        Math.min(b[1], p.y),
        Math.max(b[2], p.x),
        Math.max(b[3], p.y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const epsilon = Math.max(
      Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 1e-10,
      1e-10,
    );
    const originalCount = raw.reduce(
      (n, ring) =>
        n +
        ring.length -
        (ring.length > 1 &&
        ring[0].distanceToSquared(ring.at(-1)) <= epsilon ** 2
          ? 1
          : 0),
      0,
    );
    const rings = raw.map((ring, i) => {
      const result = clean(ring, epsilon);
      if (area(result) > 0 !== (i === 0)) result.reverse();
      return result;
    });
    entry = { rings, originalCount, epsilon, results: new Map() };
    cache.set(shape, entry);
  }
  if (entry.results.has(tolerance)) return entry.results.get(tolerance);
  let rings = entry.rings,
    warnings = [];
  if (tolerance > 0) {
    let accepted = false;
    for (let attempt = 0; attempt < 7; attempt++) {
      const candidate = entry.rings.map((ring) =>
        simplify(ring, tolerance / 2 ** attempt),
      );
      if (candidate.reduce((n, ring) => n + ring.length, 0) > MAX_GEOMETRY)
        continue;
      if (valid(candidate, entry.epsilon)) {
        rings = candidate;
        accepted = true;
        if (attempt > 0)
          warnings.push(
            "穴や輪郭の交差を防ぐため、リダクションの許容誤差を自動的に小さくしました。",
          );
        break;
      }
    }
    if (!accepted)
      warnings.push(
        "輪郭と穴を保つため、このリダクション設定は適用しませんでした。",
      );
  }
  const reducedCount = rings.reduce((n, ring) => n + ring.length, 0);
  if (reducedCount > MAX_GEOMETRY)
    throw new Error(
      "パスの頂点が多すぎます（処理上限 3,000）。リダクションの許容誤差を増やすか、SVG を分割してください。",
    );
  const result = {
    rings,
    originalCount: entry.originalCount,
    reducedCount,
    warnings,
  };
  // Bound cache size during continuous slider editing.
  if (entry.results.size >= 12)
    entry.results.delete(entry.results.keys().next().value);
  entry.results.set(tolerance, result);
  return result;
}
