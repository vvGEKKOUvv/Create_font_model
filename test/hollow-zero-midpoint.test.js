import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh } from '../src/geometry.js';
import { prepareContours } from '../src/path-reduction.js';
import { prepareBevelRoof } from '../src/bevel-roof.js';

globalThis.DOMParser = DOMParser;
const svg = await readFile(new URL('./fixtures/hollow-acute-curves.svg', import.meta.url), 'utf8');
const shape = parseSvg(svg).objects[0].shape;
const wall = 29.991;
const roof = prepareBevelRoof([prepareContours(shape, 0).rings[0]]);
// Compute reference segments independently from the original solid roof.
const guides = [];
for (const face of roof.faces) {
  const hits = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    if ((a.time < wall / 2 && b.time > wall / 2) ||
        (b.time < wall / 2 && a.time > wall / 2)) {
      const t = (wall / 2 - a.time) / (b.time - a.time);
      hits.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  if (hits.length === 2 && Math.hypot(hits[0].x - hits[1].x, hits[0].y - hits[1].y) > .1)
    guides.push(hits);
}
function isMidpointEdge(a, b) {
  return guides.some(([c, d]) => {
    const length = Math.hypot(d.x - c.x, d.y - c.y);
    const ux = (d.x - c.x) / length, uy = (d.y - c.y) / length;
    const sa = (a.x - c.x) * ux + (a.y - c.y) * uy;
    const sb = (b.x - c.x) * ux + (b.y - c.y) * uy;
    return Math.abs((a.x - c.x) * uy - (a.y - c.y) * ux) < .002 &&
      Math.abs((b.x - c.x) * uy - (b.y - c.y) * ux) < .002 &&
      Math.min(sa, sb) > -.002 && Math.max(sa, sb) < length + .002;
  });
}
for (const bevelSize of [3, 18]) for (const width of [14.9, wall / 2, 15, 20])
  test(`zero subdivision hollow merged ridge keeps hard normals, depth ${bevelSize}, width ${width}`, () => {
    const geometry = buildMesh(shape, {
      depth: 64, bevelSize, bevelWidth: width, bevelContinue: true,
      bevelSegments: 0, hollow: true, wallThickness: wall,
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
    for (const incidents of edges.values())
      assert.equal(incidents.length, 2, 'every edge remains shared across the merge threshold');
    const frontEdges = [...edges.values()].map(e => e[0]).filter(e => e.every(i => p.getZ(i) < 20));
    for (const [a, b] of guides) {
      const length = Math.hypot(b.x-a.x, b.y-a.y), ux=(b.x-a.x)/length, uy=(b.y-a.y)/length;
      const intervals = frontEdges.flatMap(edge => {
        const q=edge.map(i => ({x:p.getX(i),y:-p.getY(i)}));
        if(q.some(v => Math.abs((v.x-a.x)*uy-(v.y-a.y)*ux)>.002)) return [];
        return [q.map(v=>(v.x-a.x)*ux+(v.y-a.y)*uy).sort((x,y)=>x-y)];
      }).sort((x,y)=>x[0]-y[0]);
      let reach=0;
      for(const [start,end] of intervals) if(start<=reach+.002 && end>=0) reach=Math.max(reach,end);
      assert.ok(reach>=length-.002, 'every source midpoint segment has continuous mesh edges');
    }
    let matched = 0;
    for (const incidents of edges.values()) {
      if (incidents.length !== 2) continue;
      const [a, b] = incidents[0];
      if (p.getZ(a) > 20 || p.getZ(b) > 20) continue;
      if (!isMidpointEdge({ x: p.getX(a), y: -p.getY(a) },
          { x: p.getX(b), y: -p.getY(b) })) continue;
      matched++;
      for (const endpoint of [a, b]) {
        const opposite = incidents[1].find(i => key(i) === key(endpoint));
        const dot = n.getX(endpoint) * n.getX(opposite) +
          n.getY(endpoint) * n.getY(opposite) + n.getZ(endpoint) * n.getZ(opposite);
        if (width >= wall / 2) assert.ok(dot < .99999, 'joined outer/inner midpoint normals remain distinct');
      }
    }
    assert.ok(matched > 500, 'the actual source midpoint edges remain present');
    if (width > wall / 2) {
      const atMerge=buildMesh(shape, {depth:64, bevelSize, bevelWidth:wall/2, bevelContinue:true,
        bevelSegments:0, hollow:true, wallThickness:wall});
      assert.deepEqual(geometry.attributes.position.array, atMerge.attributes.position.array,
        'raising width beyond the midpoint leaves merged positions unchanged');
      assert.deepEqual(geometry.attributes.normal.array, atMerge.attributes.normal.array,
        'raising width beyond the midpoint leaves sharp normals unchanged');
      atMerge.dispose();
    }
    geometry.dispose();
  });
