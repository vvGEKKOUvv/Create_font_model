import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Vector2 } from 'three';
import { prepareBevelRoof } from '../src/bevel-roof.js';
import { buildMesh, exportObj } from '../src/geometry.js';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';

function crescent(divisions = 48, scale = 1) {
  const ring = [];
  for (let side = 0; side < 2; side++) {
    for (let i = side ? divisions - 1 : 0; side ? i > 0 : i <= divisions; side ? i-- : i++) {
      const t = i / divisions, radius = 70 + (side ? -10 : 20) * Math.sin(Math.PI * t);
      ring.push([scale * radius * Math.cos(2.4 * t), scale * radius * Math.sin(2.4 * t)]);
    }
  }
  const shape = new Shape();
  ring.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return { shape, ring, tips: [0, divisions] };
}
const pointKey = p => p.map(v => Math.fround(v)).join(',');
function checkMesh(geometry) {
  for (const attribute of ['position', 'normal', 'uv'])
    assert.ok([...geometry.attributes[attribute].array].every(Number.isFinite), `${attribute} finite`);
  const p = geometry.attributes.position, edges = new Map();
  for (let i = 0; i < p.count; i += 3) {
    const points = [i, i + 1, i + 2].map(j => [p.getX(j), p.getY(j), p.getZ(j)]);
    const ids = points.map(pointKey);
    assert.equal(new Set(ids).size, 3, 'no collapsed triangle');
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3], key = [a, b].sort().join('|');
      const entry = edges.get(key) ?? [0, 0];
      entry[0]++; entry[1] += a < b ? 1 : -1; edges.set(key, entry);
    }
  }
  for (const [count, winding] of edges.values()) {
    assert.equal(count, 2, 'closed manifold');
    assert.equal(winding, 0, 'consistent winding');
  }
  const obj = exportObj([{ name: 'hollow-ridge', geometry }]).obj;
  assert.doesNotMatch(obj, /NaN|Infinity/);
  const counts = ['v', 'vt', 'vn'].map(prefix => obj.split('\n').filter(line => line.startsWith(prefix + ' ')).length);
  for (const line of obj.split('\n').filter(line => line.startsWith('f '))) {
    for (const corner of line.slice(2).split(' ')) {
      corner.split('/').forEach((v, i) => assert.ok(Number(v) >= 1 && Number(v) <= counts[i], 'valid OBJ index'));
    }
  }
}

// This is a mesh-edge test, not a test of generator metadata or appearance.
// Within the first unit from these convex tips, the adjacent source edges
// determine the medial branch; the cavity and the next corner are farther away.
function assertInitialStraightRidge(geometry, ring, corner, minimumReach = 1) {
  const c = ring[corner], a = ring[(corner + ring.length - 1) % ring.length], b = ring[(corner + 1) % ring.length];
  const unit = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
  const ua = unit(a.map((v, i) => v - c[i])), ub = unit(b.map((v, i) => v - c[i]));
  const direction = unit(ua.map((v, i) => v + ub[i]));
  const p = geometry.attributes.position;
  const intervals = [], ridgeCorners = [];
  for (let i = 0; i < p.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const points = [i + j, i + (j + 1) % 3].map(k => [p.getX(k), -p.getY(k), p.getZ(k)]);
      // Front roof only: back roof and vertical side edges cannot substitute.
      if (points.some(q => q[2] > geometry.userData.effectiveBevelDepth + 1e-4)) continue;
      const local = points.map(q => [q[0] - c[0], q[1] - c[1]]);
      if (local.some(q => Math.abs(q[0] * direction[1] - q[1] * direction[0]) > 1e-4)) continue;
      const ends = local.map(q => q[0] * direction[0] + q[1] * direction[1]).sort((x, y) => x - y);
      if (ends[0] < -1e-4 || ends[1] - ends[0] < 1e-5) continue;
      intervals.push(ends);
      ridgeCorners.push(i + j, i + (j + 1) % 3);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [start, end] of intervals) if (start <= reach + 1e-4) reach = Math.max(reach, end);
  assert.ok(reach >= minimumReach, `actual straight ridge must connect tip to the first unit of its medial branch; reached ${reach}`);
  const n = geometry.attributes.normal, normalsByPoint = new Map();
  for (const index of ridgeCorners) {
    if (Math.abs(n.getZ(index)) < .01) continue;
    const key = pointKey([p.getX(index), p.getY(index), p.getZ(index)]);
    const normals = normalsByPoint.get(key) ?? [];
    normals.push([n.getX(index), n.getY(index), n.getZ(index)]);
    normalsByPoint.set(key, normals);
  }
  const minimumDot = Math.min(...[...normalsByPoint.values()].flatMap(normals =>
    normals.flatMap(a => normals.map(b => a.reduce((sum, value, i) => sum + value * b[i], 0)))));
  assert.ok(minimumDot < .95,
    `opposing bevel faces retain separate normals along their straight ridge (minimum dot ${minimumDot})`);
}
function assertCavityOpen(geometry, scale = 1) {
  const x = scale * 75 * Math.cos(1.2), y = -scale * 75 * Math.sin(1.2), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), bx = p.getX(i + 1), by = p.getY(i + 1), cx = p.getX(i + 2), cy = p.getY(i + 2);
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    assert.ok(Math.min(u, v, 1 - u - v) < -1e-6, 'central cavity stays open through front and back');
  }
}
const base = { hollow: true, wallThickness: 8, depth: 30, bevelSize: 8, bevelWidth: 24, bevelContinue: true };
const profiles = [
  [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }],
  [{ x: 0, y: 0, mode: 'linear' }, { x: .4, y: .65, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }],
];
for (const bevelSegments of [0, 1, 2]) {
  test(`QA hollow crescent tips have continuous straight mesh ridges with ${bevelSegments} intermediate loops`, () => {
    const { shape, ring, tips } = crescent(), original = JSON.stringify(shape.toJSON());
    for (const curvePoints of profiles) {
      const raw = buildMesh(shape, { ...base, bevelSegments, curvePoints });
      for (const reduction of [0, 50]) {
        const g = reduceMeshGeometry(raw, reduction);
        checkMesh(g);
        assertCavityOpen(g);
        for (const tip of tips) {
          try { assertInitialStraightRidge(g, ring, tip); } catch (error) {
            throw new Error(`${error.message} (tip=${tip}, reduction=${reduction}, controls=${curvePoints.length})`, { cause: error });
          }
        }
        if (g !== raw) g.dispose();
      }
      raw.dispose();
    }
    assert.equal(JSON.stringify(shape.toJSON()), original, 'source is unchanged');
  });
}

test('QA same crescent solid control already has straight sharp mesh tip ridges', () => {
  const { shape, ring, tips } = crescent();
  const geometry = buildMesh(shape, { ...base, hollow: false, bevelSegments: 0, curvePoints: profiles[0] });
  checkMesh(geometry);
  for (const tip of tips) assertInitialStraightRidge(geometry, ring, tip);
  geometry.dispose();
});

test('QA hollow tip ridge survives independent inner bevel profile', () => {
  const { shape, ring, tips } = crescent();
  const raw = buildMesh(shape, { ...base, bevelSegments: 2, curvePoints: profiles[0], innerCurvePoints: profiles[1] });
  for (const percentage of [0, 50]) {
    const geometry = reduceMeshGeometry(raw, percentage);
    checkMesh(geometry); assertCavityOpen(geometry);
    for (const tip of tips) assertInitialStraightRidge(geometry, ring, tip);
    if (geometry !== raw) geometry.dispose();
  }
  raw.dispose();
});


test('QA hollow main crease continues through several source-wavefront events', () => {
  const { shape, ring } = crescent();
  // The solid roof supplies geometric guide segments, never the hollow
  // generator's constraint metadata. Check actual final triangles against it.
  const roof = prepareBevelRoof([ring.map(([x, y]) => new Vector2(x, y))]);
  const key = p => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
  const graph = new Map(), seen = new Set();
  for (const face of roof.faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    if (a.time < 1e-8 && b.time < 1e-8) continue;
    const id = [key(a), key(b)].sort().join('|');
    if (seen.has(id)) continue; seen.add(id);
    for (const [p, q] of [[a, b], [b, a]]) {
      const neighbors = graph.get(key(p)) ?? []; neighbors.push(q); graph.set(key(p), neighbors);
    }
  }
  const guide = [];
  let current = { x: ring[0][0], y: ring[0][1], time: 0 }, previous = null;
  for (let i = 0; i < graph.size; i++) {
    const candidates = (graph.get(key(current)) ?? []).filter(p => key(p) !== previous && p.time > current.time + 1e-6);
    candidates.sort((a, b) => b.time - a.time);
    const next = candidates[0];
    if (!next) break;
    if (next.time > 4.4) {
      const t = (4.4 - current.time) / (next.time - current.time);
      guide.push([current, { x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t, time: 4.4 }]);
      break;
    }
    guide.push([current, next]); previous = key(current); current = next;
  }
  assert.ok(guide.length >= 6, 'guide contains multiple events beyond the initial tip bisector');
  for (const bevelSegments of [0, 2]) {
    const raw = buildMesh(shape, { ...base, bevelSegments, curvePoints: profiles[0] });
    // The reduction tool intentionally approximates gently bending chains.
    // Its closure/crease checks above remain applicable; exact source-event
    // coordinates are required here only for the unreduced generator.
    for (const percentage of [0]) {
      const geometry = reduceMeshGeometry(raw, percentage), p = geometry.attributes.position;
      for (const [a, b] of guide) {
        const length = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        const intervals = [];
        for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
          const points = [i + j, i + (j + 1) % 3].map(k => ({ x: p.getX(k), y: -p.getY(k), z: p.getZ(k) }));
          if (points.some(q => q.z > 8 + 1e-4)) continue;
          if (points.some(q => Math.abs((q.x - a.x) * uy - (q.y - a.y) * ux) > 1e-4)) continue;
          const ends = points.map(q => (q.x - a.x) * ux + (q.y - a.y) * uy).sort((a, b) => a - b);
          if (ends[1] >= -1e-4 && ends[0] <= length + 1e-4) intervals.push([Math.max(0, ends[0]), Math.min(length, ends[1])]);
        }
        intervals.sort((a, b) => a[0] - b[0]);
        let reach = 0;
        for (const [start, end] of intervals) if (start <= reach + 1e-4) reach = Math.max(reach, end);
        assert.ok(reach >= length - 1e-4, `continuous real edge after wavefront event at distance ${a.time} (segments=${bevelSegments}, reduction=${percentage}, ${reach}/${length})`);
      }
      if (geometry !== raw) geometry.dispose();
    }
    raw.dispose();
  }
});


test('QA dense small hollow crescent retains both tip ridges without merging nearby source points', () => {
  const { shape, ring, tips } = crescent(128, .1);
  for (const bevelSegments of [0, 2]) {
    const geometry = buildMesh(shape, { ...base, wallThickness: .8, depth: 3, bevelSize: .8,
      bevelWidth: 2.4, bevelSegments, curvePoints: profiles[0] });
    checkMesh(geometry); assertCavityOpen(geometry, .1);
    for (const tip of tips) assertInitialStraightRidge(geometry, ring, tip, .1);
    geometry.dispose();
  }
});
