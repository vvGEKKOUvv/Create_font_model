import test from 'node:test';
import assert from 'node:assert/strict';
import { SphereGeometry, Shape, Path } from 'three';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';
import { buildMesh, applyUvSettings } from '../src/geometry.js';

function closed(geometry) {
  const p = geometry.getAttribute('position'), edges = new Map();
  for (let i = 0; i < p.count; i += 3) {
    const keys = [0, 1, 2].map(j => [p.getX(i + j), p.getY(i + j), p.getZ(i + j)].join(','));
    for (let j = 0; j < 3; j++) { const key = [keys[j], keys[(j + 1) % 3]].sort().join('|'); edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  for (const count of edges.values()) assert.equal(count, 2);
}

test('mesh reduction removes smooth redundant faces while preserving a closed surface and input', () => {
  const sphere = new SphereGeometry(10, 48, 24).toNonIndexed();
  const position = sphere.getAttribute('position'), uv = sphere.getAttribute('uv');
  sphere.userData.baseUVs = Float64Array.from(uv.array);
  const original = Float32Array.from(position.array);
  const reduced = reduceMeshGeometry(sphere, 50);
  assert.ok(reduced.getAttribute('position').count < position.count * 0.95);
  assert.deepEqual(position.array, original);
  assert.equal(reduced.userData.baseUVs.length, reduced.getAttribute('uv').count * 2);
  assert.equal(reduced.userData.uvKeys.length, reduced.getAttribute('uv').count);
  assert.equal(reduceMeshGeometry(sphere, 0), sphere);
  applyUvSettings(reduced, { uvScale: 2 });
  assert.ok([...reduced.getAttribute('position').array, ...reduced.getAttribute('uv').array].every(Number.isFinite));
});

test('mesh reduction keeps hole boundaries and sharp corners closed', () => {
  const shape = new Shape(); shape.moveTo(-30, -30); shape.lineTo(30, -30); shape.lineTo(30, 30); shape.lineTo(-30, 30); shape.closePath();
  const hole = new Path(); hole.moveTo(-10, -10); hole.lineTo(-10, 10); hole.lineTo(10, 10); hole.lineTo(10, -10); hole.closePath(); shape.holes.push(hole);
  const geometry = buildMesh(shape, { depth: 20, bevelSize: 2, bevelWidth: 2, bevelSegments: 5 });
  const reduced = reduceMeshGeometry(geometry, 90); closed(reduced);
  const p = reduced.getAttribute('position');
  for (let i = 0; i < p.count; i++) assert.ok(Math.abs(p.getX(i)) >= 9.99 || Math.abs(p.getY(i)) >= 9.99);
  assert.throws(() => reduceMeshGeometry(geometry, NaN)); assert.throws(() => reduceMeshGeometry(geometry, 91));
});
