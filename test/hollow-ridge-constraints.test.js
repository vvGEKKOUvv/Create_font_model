import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2 } from 'three';
import { hollowFilledRegion } from '../src/hollow-offset.js';
import { prepareOffsetBevelRoof, triangulateOffsetBevelRoof } from '../src/offset-bevel-roof.js';
import { validateRoofTriangles } from '../src/roof-topology.js';

for (const count of [48, 64]) test(`offset fallback restores bounded straight sharp corner ridges in hollow crescent ${count}`, () => {
  const source = [];
  for (let side = 0; side < 2; side++) for (let i = side ? count - 1 : 0; side ? i > 0 : i <= count; side ? i-- : i++) {
    const t = i / count, r = 70 + (side ? -10 : 20) * Math.sin(Math.PI * t);
    source.push(new Vector2(r * Math.cos(2.4 * t), r * Math.sin(2.4 * t)));
  }
  const rings = hollowFilledRegion([source], 8).components[0];
  const roof = prepareOffsetBevelRoof(rings), width = Math.min(24, roof.maximumWidth);
  const triangles = triangulateOffsetBevelRoof(roof, width, [0, .5, 1], t => t);
  validateRoofTriangles(triangles, rings);
  for (const index of [0, count]) {
    const c = source[index], a = source[(index + source.length - 1) % source.length], b = source[(index + 1) % source.length];
    const u = a.clone().sub(c).normalize().add(b.clone().sub(c).normalize()).normalize();
    const intervals = [];
    for (const triangle of triangles) for (let i = 0; i < 3; i++) {
      const a = triangle.points[i], b = triangle.points[(i + 1) % 3];
      const ta = (a.x - c.x) * u.x + (a.y - c.y) * u.y, tb = (b.x - c.x) * u.x + (b.y - c.y) * u.y;
      const error = p => Math.abs((p.x-c.x)*u.y-(p.y-c.y)*u.x);
      if (error(a) < 1e-7 && error(b) < 1e-7 && ta >= -1e-7 && tb >= -1e-7) intervals.push([Math.min(ta,tb), Math.max(ta,tb)]);
    }
    intervals.sort((a,b) => a[0]-b[0]);
    let reach=0;
    for (const [a,b] of intervals) if (a <= reach+1e-7) reach=Math.max(reach,b);
    assert.ok(reach > 2.5, `tip ${index} has one connected actual mesh edge chain, not only a shading change`);
    assert.ok(reach < 4, 'bounded corner rail stops before another contour competes');
  }
  assert.ok(triangles.some(t => t.cornerRidge && t.constraints?.length));
  assert.ok(triangles.flatMap(t => t.points).every(p => Number.isFinite(p.height) && p.height >=0 && p.height<=1));
});
