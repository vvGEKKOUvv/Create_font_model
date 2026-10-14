import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, ShapeUtils } from 'three';
import { safeHollowThickness } from '../src/hollow-smoothing.js';
import { hollowContours } from '../src/hollow-offset.js';

function gaussian() {
  const ring = Array.from({length:201}, (_,i) => {
    const x = -50+i*.5;
    return new Vector2(x,40+20*Math.exp(-x*x/200));
  });
  ring.push(new Vector2(50,0),new Vector2(-50,0));
  if(ShapeUtils.area(ring)<0) ring.reverse();
  return ring;
}
function peakTurn(ring) {
  return Math.max(...ring.filter(p=>Math.abs(p.x)<10&&p.y>20).map(p=>{
    const i=ring.indexOf(p), a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
    return Math.abs(Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),
      (p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y)))*180/Math.PI;
  }));
}
test('smooth Gaussian cusp prevention caps thickness before inward offset',()=>{
  const ring=gaussian(), before=ring.map(p=>p.toArray());
  const wall=safeHollowThickness([ring],12);
  assert.ok(wall>3.9&&wall<4.1);
  assert.ok(peakTurn(hollowContours(ring,12)[0])>90);
  assert.ok(peakTurn(hollowContours(ring,wall)[0])<10);
  assert.deepEqual(ring.map(p=>p.toArray()),before);
  assert.equal(safeHollowThickness([ring],1),1);
});
test('intentional polygon corners do not cap hollow thickness',()=>{
  const ring=[new Vector2(0,0),new Vector2(100,0),new Vector2(100,60),new Vector2(0,60)];
  assert.equal(safeHollowThickness([ring],12),12);
});
