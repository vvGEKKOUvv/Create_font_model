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
const settings = { depth: 60, bevelSize: 28, bevelWidth: 100, bevelContinue: true, bevelSegments: 4 };

test('QA hollow rectangular wall does not bevel beyond its opposing midpoint', () => {
  const geometry = buildMesh(rectangle(0, 0, 100, 80), { ...settings, hollow: true, wallThickness: 10 });
  assert.ok(geometry.userData.effectiveBevel > 0);
  assert.ok(geometry.userData.effectiveBevel <= 5 + 1e-6);
  assert.equal(geometry.userData.effectiveBevelDepth, 28);
  checkMesh(geometry);
});

test('QA native uneven hole limits both bevel sides by the narrowest four-unit gap', () => {
  const shape = rectangle(0, 0, 100, 80);
  shape.holes.push(rectangle(4, 20, 76, 40, Path));
  const geometry = buildMesh(shape, settings);
  assert.ok(geometry.userData.effectiveBevel > 0);
  assert.ok(geometry.userData.effectiveBevel <= 2 + 1e-6);
  checkMesh(geometry);
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
