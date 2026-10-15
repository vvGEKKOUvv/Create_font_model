import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh } from '../src/geometry.js';

globalThis.DOMParser = DOMParser;
const shape = parseSvg(await readFile(new URL('./fixtures/hollow-acute-curves.svg', import.meta.url), 'utf8')).objects[0].shape;

// Check the emitted triangles, not only reference skeleton guide coverage: the
// shared centre seam must form a complete ring with no T junction or gap.
for (const reductionTolerance of [0, .01, .1, 1]) {
  for (const bevelContinue of [false, true]) {
    test(`uploaded hollow centre seam is one closed sharp cycle, path reduction ${reductionTolerance}, continue ${bevelContinue}`, () => {
      const geometry = buildMesh(shape, {
        depth: 64, bevelSize: 18, bevelWidth: 15,
        bevelContinue, bevelSegments: 0, hollow: true,
        wallThickness: 29.991, reductionTolerance,
      });
      const p = geometry.attributes.position, n = geometry.attributes.normal;
      const key = i => [p.getX(i), p.getY(i), p.getZ(i)].join(',');
      const edges = new Map();
      for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
        const a = i + j, b = i + (j + 1) % 3;
        const id = [key(a), key(b)].sort().join('|');
        const incidents = edges.get(id) ?? [];
        incidents.push([a, b]); edges.set(id, incidents);
      }
      const locked = new Set(geometry.userData.protectedMidpointIndices), graph = new Map();
      for (const incidents of edges.values()) {
        assert.equal(incidents.length, 2, 'the hollow mesh is watertight');
        const [a, b] = incidents[0];
        assert.equal(key(a), key(incidents[1][1]), 'shared faces wind in opposite directions');
        if (p.getZ(a) > 32 || p.getZ(b) > 32 || !locked.has(a) || !locked.has(b)) continue;
        for (const endpoint of [a, b]) {
          const other = incidents[1].find(i => key(i) === key(endpoint));
          const dot = n.getX(endpoint) * n.getX(other) + n.getY(endpoint) * n.getY(other) + n.getZ(endpoint) * n.getZ(other);
          assert.ok(dot < .99999, 'the shared seam retains distinct outside/inside normals');
        }
        for (const [from, to] of [[key(a), key(b)], [key(b), key(a)]]) {
          const neighbours = graph.get(from) ?? new Set();
          neighbours.add(to); graph.set(from, neighbours);
        }
      }
      assert.ok(graph.size > 20, 'centre seam exists with and without path reduction');
      for (const neighbours of graph.values()) assert.equal(neighbours.size, 2, 'every centre node has exactly two ring neighbours');
      const visited = new Set(), pending = [graph.keys().next().value];
      while (pending.length) {
        const key = pending.pop();
        if (visited.has(key)) continue;
        visited.add(key); pending.push(...graph.get(key));
      }
      assert.equal(visited.size, graph.size, 'the entire seam is a single connected loop');
      assert.ok([...geometry.attributes.uv.array].every(Number.isFinite), 'UVs remain finite');
      assert.ok(!geometry.userData.warnings.some(w => /通常ベベル|安全な最大幅/.test(w)), 'the complete ring is not produced by a fallback');
      geometry.dispose();
    });
  }
}
