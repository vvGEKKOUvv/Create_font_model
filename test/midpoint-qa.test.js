import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path, Vector2 } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';

function rectangle(x, y, width, height, Type = Shape) {
  const path = new Type();
  path.moveTo(x, y); path.lineTo(x + width, y);
  path.lineTo(x + width, y + height); path.lineTo(x, y + height);
  path.closePath(); return path;
}
function checkMesh(geometry) {
  for (const name of ['position', 'normal', 'uv'])
    assert.ok(Array.from(geometry.getAttribute(name).array).every(Number.isFinite), `${name} finite`);
  const positions = geometry.getAttribute('position');
  const edges = new Map();
  const key = index => [0, 1, 2].map(axis => Math.round(positions.array[index * 3 + axis] * 1e5)).join(',');
  for (let face = 0; face < positions.count; face += 3) {
    const ids = [key(face), key(face + 1), key(face + 2)];
    assert.equal(new Set(ids).size, 3, 'noncollapsed triangle');
    for (let edge = 0; edge < 3; edge++) {
      const id = [ids[edge], ids[(edge + 1) % 3]].sort().join('|');
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) assert.equal(count, 2, 'closed manifold edge');
  const { obj } = exportObj([{ name: 'midpoint-test', geometry }]);
  assert.ok(!/NaN|Infinity/.test(obj));
  const vertexCount = obj.split('\n').filter(line => line.startsWith('v ')).length;
  const faces = obj.split('\n').filter(line => line.startsWith('f '));
  assert.ok(faces.length > 0);
  for (const face of faces)
    for (const token of face.slice(2).split(' ')) {
      const index = Number(token.split('/')[0]);
      assert.ok(index >= 1 && index <= vertexCount, 'OBJ vertex index valid');
    }
}

// Intersect projected triangles, independently of generator metadata.
function frontHeight(geometry, x, sourceY) {
  const positions = geometry.getAttribute('position');
  const y = -sourceY;
  let minimum = Infinity;
  for (let i = 0; i < positions.count; i += 3) {
    const ax = positions.getX(i), ay = positions.getY(i);
    const bx = positions.getX(i + 1), by = positions.getY(i + 1);
    const cx = positions.getX(i + 2), cy = positions.getY(i + 2);
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-6)
      minimum = Math.min(minimum, u * positions.getZ(i) + v * positions.getZ(i + 1) + w * positions.getZ(i + 2));
  }
  return minimum;
}

const settings = { depth: 60, bevelSize: 28, bevelWidth: 100, bevelContinue: true, bevelSegments: 4 };

test('QA hollow rectangular wall does not bevel beyond its opposing midpoint', () => {
  const geometry = buildMesh(rectangle(0, 0, 100, 80), { ...settings, hollow: true, wallThickness: 10 });
  assert.ok(geometry.userData.effectiveBevel > 0);
  assert.ok(geometry.userData.effectiveBevel <= 5 + 1e-6);
  assert.equal(geometry.userData.effectiveBevelDepth, 28);
  checkMesh(geometry);
});

test('QA native uneven hole lets wide walls reach their local midpoint independently', () => {
  const shape = rectangle(0, 0, 100, 80);
  shape.holes.push(rectangle(4, 20, 76, 40, Path));
  const narrow = buildMesh(shape, { ...settings, bevelWidth: 2 });
  const wide = buildMesh(shape, { ...settings, bevelWidth: 10 });
  const saturated = buildMesh(shape, settings);
  assert.ok(wide.userData.effectiveBevel > 9.9, 'a four-unit wall must not cap the twenty-unit wall globally');
  assert.ok(frontHeight(wide, 85, 40) > frontHeight(narrow, 85, 40) + 5,
    'wide section continues beveling after the narrow section has met');
  for (const geometry of [narrow, wide, saturated]) {
    assert.ok(frontHeight(geometry, 2, 40) <= frontHeight(geometry, 1.5, 40) + 1e-4,
      'narrow section ridge stays at its own x=2 midpoint');
    assert.equal(frontHeight(geometry, 40, 40), Infinity, 'native hole remains open');
    checkMesh(geometry);
  }
  assert.ok(Math.abs(frontHeight(wide, 90, 40) - frontHeight(saturated, 90, 40)) < 1e-4,
    'wide midpoint stops once reached');
});

test('QA automatic hollow around an existing hole obeys each component wall midpoint', () => {
  const shape = rectangle(0, 0, 100, 80);
  shape.holes.push(rectangle(25, 20, 50, 40, Path));
  const geometry = buildMesh(shape, { ...settings, hollow: true, wallThickness: 4 });
  assert.ok(geometry.userData.effectiveBevel > 0);
  assert.ok(geometry.userData.effectiveBevel <= 2 + 1e-6);
  assert.equal(geometry.userData.effectiveBevelDepth, 28);
  checkMesh(geometry);
});

test('QA dense curved hollow retains a closed finite mesh, UV and OBJ at strong axial bevel', () => {
  const ring = Array.from({ length: 96 }, (_, i) => {
    const angle = i * Math.PI * 2 / 96;
    const radius = 50 + 5 * Math.cos(3 * angle);
    return new Vector2(radius * Math.cos(angle), radius * Math.sin(angle));
  });
  const geometry = buildMesh(new Shape(ring), { ...settings, hollow: true, wallThickness: 4 });
  assert.ok(geometry.userData.effectiveBevel > 0);
  assert.ok(geometry.userData.effectiveBevel <= 2 + 1e-6);
  assert.equal(geometry.userData.effectiveBevelDepth, 28);
  checkMesh(geometry);
});

test('QA solid outline retains full bevel without a hollow midpoint restriction', () => {
  const geometry = buildMesh(rectangle(0, 0, 100, 80), settings);
  assert.ok(geometry.userData.effectiveBevel >= 39.99);
  assert.equal(geometry.userData.effectiveBevelDepth, 28);
  checkMesh(geometry);
});

test('QA multiple cavities remain open while wider opposing gaps reach their own ridge', () => {
  const shape = rectangle(0, 0, 100, 80);
  shape.holes.push(rectangle(4, 20, 35, 40, Path), rectangle(60, 20, 20, 40, Path));
  const early = buildMesh(shape, { ...settings, bevelWidth: 2 });
  const full = buildMesh(shape, settings);
  assert.ok(full.userData.effectiveBevel > 9.9);
  assert.ok(frontHeight(full, 85, 40) > frontHeight(early, 85, 40) + 5);
  for (const geometry of [early, full]) {
    assert.equal(frontHeight(geometry, 20, 40), Infinity);
    assert.equal(frontHeight(geometry, 70, 40), Infinity);
    assert.ok(frontHeight(geometry, 2, 40) <= frontHeight(geometry, 1.5, 40) + 1e-4);
    checkMesh(geometry);
  }
});
