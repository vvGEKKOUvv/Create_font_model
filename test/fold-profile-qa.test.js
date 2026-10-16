import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';
import { normalizeProfile, monotonicProfile, evaluateProfile } from '../src/bevel-profile.js';

const straight = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const returning = [{ x: 0, y: 0 }, { x: .3, y: .85 }, { x: .65, y: .25 }, { x: 1, y: 1 }];
const square = () => {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(100, 0); shape.lineTo(100, 100); shape.lineTo(0, 100); shape.closePath();
  return shape;
};
const settings = { depth: 30, bevelSize: 8, bevelWidth: 3, bevelSegments: 0,
  bevelContinue: true, wallThickness: 10, curvePoints: returning, innerCurvePoints: straight };

function assertClosedFinite(geometry) {
  for (const attribute of Object.values(geometry.attributes))
    assert.ok(Array.from(attribute.array).every(Number.isFinite), 'all surface attributes remain finite');
  const p = geometry.getAttribute('position'), edges = new Map();
  const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
    assert.ok(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) > 1e-8, 'no zero-area fold triangles');
    for (let j = 0; j < 3; j++) {
      const a = key(i + j), b = key(i + (j + 1) % 3), id = [a, b].sort().join('|');
      assert.notEqual(a, b, 'no collapsed fold edges');
      const edge = edges.get(id) ?? { count: 0, balance: 0 };
      edge.count++; edge.balance += a < b ? 1 : -1; edges.set(id, edge);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'fold joins remain closed');
    assert.equal(edge.balance, 0, 'fold joins have opposite winding');
  }
}
function hasKnot(geometry, t, value, inner = false) {
  const p = geometry.getAttribute('position');
  const inset = geometry.userData.effectiveBevel * (1 - value);
  const y = inner ? -(geometry.userData.effectiveWallThickness - inset) : -inset;
  const z = geometry.userData.effectiveBevelDepth * t;
  // Intersect a fixed x=50 plane through the middle of the same straight
  // source edge: a change of corner identity cannot mimic a returning curve.
  for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = i + j, b = i + (j + 1) % 3;
    if (Math.abs(p.getZ(a) - z) > 2e-5 || Math.abs(p.getZ(b) - z) > 2e-5) continue;
    const dx = p.getX(b) - p.getX(a);
    if (Math.abs(dx) < 1e-8) continue;
    const t = (50 - p.getX(a)) / dx;
    if (t < 0 || t > 1) continue;
    if (Math.abs(p.getY(a) + t * (p.getY(b) - p.getY(a)) - y) < 2e-5) return true;
  }
  return false;
}

for (const hollow of [false, true]) test(`returning linear profile preserves its actual inward/outward knots, hollow=${hollow}`, () => {
  const g = buildMesh(square(), { ...settings, hollow });
  assertClosedFinite(g);
  for (const point of returning) assert.ok(hasKnot(g, point.x, point.y), 'returning control is represented geometrically instead of flattened');
  assert.deepEqual(g.userData.bevelSamples, returning.map(p => p.x), 'zero divisions retain exactly the control levels');
  assert.equal(g.userData.effectiveBevel, 3, 'safe requested width is retained');
  g.dispose();
});

test('hollow inner returning profile preserves knots without changing the straight outer profile', () => {
  const g = buildMesh(square(), { ...settings, hollow: true, curvePoints: straight, innerCurvePoints: returning });
  assertClosedFinite(g);
  for (const point of returning) assert.ok(hasKnot(g, point.x, point.y, true), 'inner control is represented geometrically');
  assert.deepEqual(g.userData.bevelSamples, [0, 1], 'inner controls do not add outer cuts');
  assert.deepEqual(g.userData.innerBevelSamples, returning.map(p => p.x));
  g.dispose();
});

test('different returning inner and outer curves retain their own edge levels without gaps', () => {
  const inner = [{ x: 0, y: 0 }, { x: .25, y: .7 }, { x: .8, y: .4 }, { x: 1, y: 1 }];
  const g = buildMesh(square(), { ...settings, hollow: true, innerCurvePoints: inner });
  assertClosedFinite(g);
  for (const point of returning) assert.ok(hasKnot(g, point.x, point.y), 'outer fold retains its own control edges');
  for (const point of inner) assert.ok(hasKnot(g, point.x, point.y, true), 'inner fold retains its distinct control edges');
  assert.deepEqual(g.userData.bevelSamples, returning.map(p => p.x));
  assert.deepEqual(g.userData.innerBevelSamples, inner.map(p => p.x));
  g.dispose();
});

test('Bezier reversals between anchors generate a closed curved bevel rather than rejecting the profile', () => {
  const profile = normalizeProfile([{ x: 0, y: 0 },
    { x: .3, y: .6, mode: 'bezier', out: { x: .4, y: .95 } },
    { x: .7, y: .65, mode: 'bezier', in: { x: .6, y: .2 } }, { x: 1, y: 1 }]);
  assert.equal(monotonicProfile(profile), false, 'the cubic has a genuine negative-width derivative');
  for (const hollow of [false, true]) {
    const g = buildMesh(square(), { ...settings, hollow, bevelSegments: 3, curvePoints: profile });
    assertClosedFinite(g);
    assert.equal(g.userData.bevelSamples.length, 13, 'three extra edges are inserted per control span');
    for (const t of g.userData.bevelSamples) assert.ok(hasKnot(g, t, evaluateProfile(profile, t)), 'sampled Bezier contour remains faithful');
    g.dispose();
  }
});

test('oversized returning hollow bevel is constrained to a closed cavity and exports finite faces', () => {
  const g = buildMesh(square(), { ...settings, hollow: true, bevelWidth: 50, innerCurvePoints: returning });
  assertClosedFinite(g);
  assert.ok(g.userData.effectiveBevel < 5, 'opposing folds cannot cross the wall midpoint');
  assert.ok(g.userData.warnings.length, 'safe-width adjustment is visible');
  const { obj } = exportObj([{ name: 'folded hollow', color: '#b0b0b0', geometry: g }]);
  assert.ok(!/NaN|Infinity/.test(obj));
  assert.ok(/^f /m.test(obj));
  g.dispose();
});

test('returning hollow profile supports capped one-sided extrusion', () => {
  const g = buildMesh(square(), { ...settings, hollow: true, extrusionMirror: false, extrusionCap: true });
  assertClosedFinite(g);
  g.computeBoundingBox();
  assert.equal(g.boundingBox.min.z, 0);
  assert.equal(g.boundingBox.max.z, 15);
  g.dispose();
});
