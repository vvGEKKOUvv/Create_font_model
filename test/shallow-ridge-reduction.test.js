import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';

for (const percentage of [50, 90]) {
  test(`mesh reduction ${percentage}% preserves shallow hard bevel ridges`, () => {
    const shape = new Shape(); shape.moveTo(0, 0);
    for (let i = 1; i <= 64; i++) shape.lineTo(240 * i / 64, 18 * Math.sin(Math.PI * i / 64));
    for (let i = 63; i >= 0; i--) shape.lineTo(240 * i / 64, -18 * Math.sin(Math.PI * i / 64));
    shape.closePath();
    const source = buildMesh(shape, { depth: 30, bevelSize: 1, bevelWidth: 18,
      bevelContinue: true, bevelSegments: 16, curvePoints: [
        { x: 0, y: 0, mode: 'linear' }, { x: 0.5, y: 0.7, mode: 'linear' },
        { x: 1, y: 1, mode: 'linear' },
      ] });
    const geometry = reduceMeshGeometry(source, percentage);
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    assert.ok(p.count < source.getAttribute('position').count * 0.8, 'normal seams still permit meaningful reduction');
    for (const name of ['position', 'normal', 'uv']) assert.ok([...geometry.getAttribute(name).array].every(Number.isFinite));
    const edges = new Map(), ridgeNormals = new Map();
    const key = i => [p.getX(i), p.getY(i), p.getZ(i)].join(',');
    for (let i = 0; i < p.count; i += 3) {
      const ys = [0, 1, 2].map(j => p.getY(i + j)), zs = [0, 1, 2].map(j => p.getZ(i + j));
      if (Math.max(...zs) <= 1.00001)
        assert.ok(!(Math.min(...ys) < -1e-5 && Math.max(...ys) > 1e-5), 'front bevel triangles must not straddle the central ridge');
      for (let j = 0; j < 3; j++) {
        const edge = [key(i + j), key(i + (j + 1) % 3)].sort().join('|');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
        const vertex = i + j;
        if (Math.abs(p.getY(vertex)) < 1e-5 && p.getZ(vertex) > 0 && p.getZ(vertex) < 1) {
          const site = key(vertex);
          if (!ridgeNormals.has(site)) ridgeNormals.set(site, []);
          ridgeNormals.get(site).push(n.getY(vertex));
        }
      }
    }
    for (const incidence of edges.values()) assert.equal(incidence, 2, 'reduced solid stays closed');
    assert.ok([...ridgeNormals.values()].some(values => Math.min(...values) < -0.01 && Math.max(...values) > 0.01), 'the ridge keeps opposite hard normals');
    const { obj } = exportObj([{ name: 'leaf', geometry, color: '#888888' }]);
    assert.ok(!/NaN|Infinity/.test(obj));
    const counts = { v: 0, vt: 0, vn: 0 };
    for (const line of obj.split('\n')) {
      const [type, ...values] = line.trim().split(/\s+/);
      if (type in counts) counts[type]++;
      if (type === 'f') for (const value of values) value.split('/').forEach((index, j) => {
        const number = Number(index); assert.ok(number >= 1 && number <= counts[['v', 'vt', 'vn'][j]], 'OBJ references existing vertices, UVs, and normals');
      });
    }
    source.dispose(); geometry.dispose();
  });
}
