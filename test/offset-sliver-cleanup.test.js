import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOffsetBevelRoof, triangulateOffsetBevelRoof } from '../src/offset-bevel-roof.js';

const area = rings => rings.reduce((sum, ring) => sum + ring.reduce((a, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return a + p.X * q.Y - p.Y * q.X;
}, 0) / 2, 0);

test('offset topology collapse does not restore nearly coincident optional density samples', () => {
  const ring = Array.from({ length: 400 }, (_, i) => {
    const angle = 2 * Math.PI * (i / 400) ** 2;
    const radius = 50 + 20 * Math.cos(12 * angle);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const original = JSON.stringify(ring);
  const roof = prepareOffsetBevelRoof([ring]);
  const distance = 5;
  const dense = roof.inset(distance);
  const exact = roof.inset(distance, false);
  // Before cleanup, this layer had 373 points and the roof 2050 triangles.
  assert.ok(dense.flat().length <= 354);
  assert.ok(Math.abs(area(dense) - area(exact)) <= Math.abs(area(exact)) * 1e-12,
    'removing only collinear correspondence helpers leaves the actual offset unchanged');
  for (const loop of dense) for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    if (!p.sample) continue;
    for (const q of [loop[(i + 1) % loop.length], loop[(i + loop.length - 1) % loop.length]])
      assert.ok(Math.hypot(p.X - q.X, p.Y - q.Y) > distance * roof.scale * .01,
        'optional projected helpers cannot form inset-relative needle edges');
  }
  const triangles = triangulateOffsetBevelRoof(roof, distance, [0, .5, 1], t => t);
  assert.ok(triangles.length <= 1974);
  let skinny = 0;
  for (const triangle of triangles.filter(t => t.faceIndex !== 0)) {
    const [a, b, c] = triangle.points;
    const u = [b.x-a.x, b.y-a.y, 5*(b.height-a.height)];
    const v = [c.x-a.x, c.y-a.y, 5*(c.height-a.height)];
    const cross = Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]);
    const length2 = (p,q) => (p.x-q.x)**2+(p.y-q.y)**2+(5*(p.height-q.height))**2;
    const quality = 2*Math.sqrt(3)*cross/(length2(a,b)+length2(b,c)+length2(c,a));
    if (quality < .01) skinny++;
  }
  assert.ok(skinny <= 4, 'needle triangles decrease from 55 to at most four without reducing the source');
  assert.equal(JSON.stringify(ring), original, 'original outline vertices are unchanged');
  const boundary = new Set(triangles.flatMap(t => t.points)
    .filter(p => p.height === 1).map(p => `${p.x},${p.y}`));
  for (const p of ring) assert.ok(boundary.has(`${p.x},${p.y}`), 'every original source vertex remains');
});
