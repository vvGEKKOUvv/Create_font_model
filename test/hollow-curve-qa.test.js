import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path, Vector2 } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';
import { hollowContours } from '../src/hollow-offset.js';
import { safeHollowThickness } from '../src/hollow-smoothing.js';
import { defaultProfile } from '../src/bevel-profile.js';

function gaussian() {
  const ring = [new Vector2(-60, 0), new Vector2(60, 0)];
  for (let x = 60; x >= -60; x -= .75)
    ring.push(new Vector2(x, 20 + 20 * Math.exp(-((x / 12) ** 2))));
  return ring;
}
function shapeFrom(ring) { const s = new Shape(); s.setFromPoints(ring); s.closePath(); return s; }
function maxCentralTurn(ring) {
  return Math.max(...ring.flatMap((p, i) => {
    if (Math.abs(p.x) > 12) return [];
    const a = p.clone().sub(ring[(i + ring.length - 1) % ring.length]).normalize();
    const b = ring[(i + 1) % ring.length].clone().sub(p).normalize();
    return [Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI];
  }));
}
function closed(geometry) {
  const p = geometry.attributes.position.array, edges = new Map();
  for (let i = 0; i < p.length; i += 9) {
    const ids = [0, 3, 6].map(j => Array.from(p.slice(i + j, i + j + 3)).join(','));
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok([...edges.values()].every(n => n === 2), 'all geometric edges join exactly two triangles');
  for (const attribute of Object.values(geometry.attributes))
    assert.ok(Array.from(attribute.array).every(Number.isFinite));
}
const base = { depth: 24, bevelSize: 0, bevelWidth: 0, hollow: true, wallThickness: 8 };

test('smooth hollow safety avoids a Gaussian cusp without modifying the source path', () => {
  const ring = gaussian(), before = ring.map(p => p.toArray());
  const safeWall = safeHollowThickness([ring], 8);
  assert.ok(safeWall > 2 && safeWall < 3);
  assert.ok(maxCentralTurn(hollowContours(ring, 8)[0]) > 100, 'ordinary inward offset reproduces a sharp inner cusp');
  assert.ok(maxCentralTurn(hollowContours(ring, safeWall)[0]) < 15, 'safe thickness keeps the smooth sampled turn');
  assert.deepEqual(ring.map(p => p.toArray()), before);
  const shape = shapeFrom(ring), source = shape.toJSON();
  const old = buildMesh(shape, base), disabled = buildMesh(shape, { ...base, hollowCurveSafe: false });
  assert.deepEqual(Array.from(old.attributes.position.array), Array.from(disabled.attributes.position.array));
  const safe = buildMesh(shape, { ...base, hollowCurveSafe: true });
  assert.ok(safe.userData.effectiveWallThickness < 3);
  assert.ok(safe.userData.warnings.some(w => w.includes('滑らかな内周')));
  closed(safe);
  assert.deepEqual(shape.toJSON(), source);
  for (const g of [old, disabled, safe]) g.dispose();
});

test('smooth hollow safety preserves intentional polygon corners and wall thickness', () => {
  const ring = [new Vector2(0,0), new Vector2(80,0), new Vector2(80,40), new Vector2(0,40)];
  assert.equal(safeHollowThickness([ring], 8), 8);
  const shape = shapeFrom(ring), old = buildMesh(shape, base);
  const safe = buildMesh(shape, { ...base, hollowCurveSafe: true });
  assert.equal(safe.userData.effectiveWallThickness, 8);
  assert.deepEqual(Array.from(safe.attributes.position.array), Array.from(old.attributes.position.array));
  old.dispose(); safe.dispose();
});

test('smooth hollow safety retains native holes, independent bevel curves, and valid OBJ UVs', () => {
  const ring = Array.from({length: 128}, (_, i) => new Vector2(50*Math.cos(2*Math.PI*i/128),20*Math.sin(2*Math.PI*i/128)));
  const shape = shapeFrom(ring), hole = new Path();
  hole.absellipse(0,0,5,5,0,Math.PI*2,true); shape.holes.push(hole);
  const original = shape.toJSON();
  const geometry = buildMesh(shape, { ...base, wallThickness:12, hollowCurveSafe:true,
    bevelSize: 3, bevelWidth: 1, bevelSegments: 3, bevelContinue: false,
    curvePoints: defaultProfile(), innerCurvePoints: [{x:0,y:0,mode:'linear'},{x:.5,y:.8,mode:'linear'},{x:1,y:1,mode:'linear'}] });
  assert.ok(geometry.userData.effectiveWallThickness < 8);
  assert.ok(geometry.userData.hollowComponentCount >= 2);
  closed(geometry);
  const {obj} = exportObj([{ name: 'safe compound', geometry }]);
  assert.ok(obj.includes('\nvt ') && obj.includes('\nf '));
  assert.ok(!obj.includes('NaN') && !obj.includes('Infinity'));
  assert.deepEqual(shape.toJSON(), original);
  geometry.dispose();
});
