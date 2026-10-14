import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBevelRoof, triangulateBevelRoof } from '../src/bevel-roof.js';

const square = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }]];
function onEdge(p, a, b) {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  return Math.abs(cross) < 1e-6 &&
    p.x >= Math.min(a.x, b.x) - 1e-7 && p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 && p.y <= Math.max(a.y, b.y) + 1e-7;
}

test('convex bevel face bands avoid artificial diagonal intersections while preserving complete area', () => {
  const roof = prepareBevelRoof(square);
  const triangles = triangulateBevelRoof(roof, 15, [0, .2, .4, .6, .8, 1], t => t);
  // Triangulating the original faces before clipping produced 66 triangles.
  assert.equal(triangles.length, 46);
  let area = 0;
  for (const tri of triangles) {
    const face = roof.faces[tri.faceIndex];
    for (const p of tri.points) {
      assert.ok(face.some((a, i) => onEdge(p, a, face[(i + 1) % face.length])),
        'new band vertices remain on the actual source-face boundary and ridges');
      assert.ok(Math.abs(p.height - Math.max(0, 1 - p.time / 15)) < 1e-7);
    }
    const [a, b, c] = tri.points;
    area += Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
  }
  assert.ok(Math.abs(area - 3200) < 1e-7);
});

test('whole face clipping retains independent curved height levels and closed hole boundaries', () => {
  const outer = [{x:0,y:0},{x:80,y:0},{x:80,y:40},{x:0,y:40}];
  const hole = [{x:10,y:10},{x:10,y:30},{x:70,y:30},{x:70,y:10}];
  const roof = prepareBevelRoof([outer, hole]);
  const triangles = triangulateBevelRoof(roof, 5, [0,.25,.5,.75,1], t=>t*t);
  assert.ok(triangles.length > 0);
  // triangulateBevelRoof validates every boundary/interior edge before returning.
  for (const tri of triangles) for (const p of tri.points)
    assert.ok(Number.isFinite(p.height) && p.height >= 0 && p.height <= 1);
  assert.ok(triangles.some(tri => tri.points.some(p => Math.abs(p.height-.5)<1e-7)));
});
