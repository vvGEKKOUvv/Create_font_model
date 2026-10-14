import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh, exportObj } from '../src/geometry.js';
import { prepareContours } from '../src/path-reduction.js';
import { prepareBevelRoof } from '../src/bevel-roof.js';

globalThis.DOMParser = DOMParser;
const svg = await readFile(new URL('./fixtures/hollow-acute-curves.svg', import.meta.url), 'utf8');
const shape = parseSvg(svg).objects[0].shape, original = JSON.stringify(shape.toJSON());
const ring = prepareContours(shape, 0).rings[0];
assert.ok(ring.length > 512, 'uploaded fixture exceeds the former corner-recovery gate');
const tip = ring.find(p => Math.hypot(p.x - 1512.144, p.y - 329.339) < 1e-6);
assert.ok(tip, 'use the user’s indicated outer acute tip');
const key = p => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
// A solid source roof supplies geometric guides. Actual hollow triangles must
// contain these edges; constraint labels and shading alone cannot satisfy this.
const roof = prepareBevelRoof([ring]), graph = new Map(), seen = new Set();
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
let current = { ...tip, time: 0 }, previous = null;
for (let i = 0; i < graph.size; i++) {
  const candidates = (graph.get(key(current)) ?? []).filter(p => key(p) !== previous && p.time > current.time + 1e-6);
  candidates.sort((a, b) => b.time - a.time);
  const next = candidates[0];
  if (!next) break;
  guide.push([current, next]); previous = key(current); current = next;
}
const settings = { depth: 60, bevelSize: 20, bevelWidth: 1000, bevelSegments: 2, bevelContinue: true,
  curvePoints: [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] };
function check(geometry, expectedMinimum, creaseThreshold = .95) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, projectedEdges = [], edgeCounts = new Map();
  const vertexKey = index => [p.getX(index), p.getY(index), p.getZ(index)].map(Math.fround).join(',');
  for (const name of ['position', 'normal', 'uv']) assert.ok([...geometry.attributes[name].array].every(Number.isFinite), `${name} finite`);
  for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
    const ai = i + j, bi = i + (j + 1) % 3, ak = vertexKey(ai), bk = vertexKey(bi);
    assert.notEqual(ak, bk, 'no collapsed edge');
    const id = [ak, bk].sort().join('|'), entry = edgeCounts.get(id) ?? [0, 0];
    entry[0]++; entry[1] += ak < bk ? 1 : -1; edgeCounts.set(id, entry);
    const ends = [ai, bi].map(k => ({ x: p.getX(k), y: -p.getY(k), z: p.getZ(k), index: k }));
    if (ends.every(q => q.z <= settings.bevelSize + 1e-4)) projectedEdges.push(ends);
  }
  for (const [count, winding] of edgeCounts.values()) { assert.equal(count, 2, 'closed manifold'); assert.equal(winding, 0, 'consistent winding'); }
  let checked = 0;
  const ridgeNormals = new Map();
  for (const [a, b] of guide) {
    // Stop before the width cap: a cap plateau beyond the active bevel is
    // legitimate and is not evidence of a missing crease.
    if (b.time > geometry.userData.effectiveBevel * .8) break;
    const length = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, intervals = [];
    for (const ends of projectedEdges) {
      if (ends.some(q => Math.abs((q.x - a.x) * uy - (q.y - a.y) * ux) > .001)) continue;
      const interval = ends.map(q => (q.x - a.x) * ux + (q.y - a.y) * uy).sort((a, b) => a - b);
      if (interval[1] < -.001 || interval[0] > length + .001) continue;
      intervals.push([Math.max(0, interval[0]), Math.min(length, interval[1])]);
      for (const q of ends) {
        if (Math.abs(n.getZ(q.index)) < .01) continue;
        const id = vertexKey(q.index), normals = ridgeNormals.get(id) ?? [];
        normals.push([n.getX(q.index), n.getY(q.index), n.getZ(q.index)]); ridgeNormals.set(id, normals);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let reach = 0;
    for (const [start, end] of intervals) if (start <= reach + .001) reach = Math.max(reach, end);
    assert.ok(reach >= length - .001, `uploaded tip ridge is continuous after event ${a.time}: ${reach}/${length}`);
    checked++;
  }
  assert.ok(checked >= expectedMinimum, 'test extends beyond the first tiny source-corner event');
  assert.ok([...ridgeNormals.values()].some(ns => ns.some(a => ns.some(b => a.reduce((sum, v, i) => sum + v * b[i], 0) < creaseThreshold))), 'real ridge retains opposing bevel normals');
  const { obj } = exportObj([{ name: 'uploaded-path', geometry }]);
  assert.doesNotMatch(obj, /NaN|Infinity/);
  const counts = ['v', 'vt', 'vn'].map(prefix => obj.split('\n').filter(line => line.startsWith(prefix + ' ')).length);
  for (const line of obj.split('\n').filter(line => line.startsWith('f '))) for (const corner of line.slice(2).split(' '))
    corner.split('/').forEach((value, i) => assert.ok(Number(value) >= 1 && Number(value) <= counts[i], 'valid OBJ index'));
  assert.equal(JSON.stringify(shape.toJSON()), original, 'original Bezier source is unchanged');
}

test('QA uploaded acute SVG solid control retains its complete active ridge', () => {
  const geometry = buildMesh(shape, settings); check(geometry, 100, .9999); geometry.dispose();
});
for (const wallThickness of [10, 20, 50]) test(`QA uploaded 748-point SVG hollow outer tip remains connected (wall=${wallThickness})`, () => {
  const geometry = buildMesh(shape, { ...settings, hollow: true, wallThickness });
  assert.ok(geometry.userData.effectiveWallThickness > 0, 'hollow walls were generated');
  check(geometry, 15); geometry.dispose();
});
