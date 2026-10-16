import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Shape } from 'three';
import { DOMParser } from '@xmldom/xmldom';
import { buildMesh, parseSvg } from '../src/geometry.js';

globalThis.DOMParser = DOMParser;
const square = () => {
  const s = new Shape();
  s.moveTo(0,0); s.lineTo(100,0); s.lineTo(100,100); s.lineTo(0,100); s.closePath();
  return s;
};
const base = { depth:30, bevelSize:8, bevelWidth:50, wallThickness:10, bevelSegments:0, bevelContinue:true };
function assertClosed(g) {
  for(const attribute of Object.values(g.attributes))
    assert.ok(Array.from(attribute.array).every(Number.isFinite), 'surface attributes are finite');
  const p=g.attributes.position, edges=new Map();
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
  for(let i=0;i<p.count;i+=3) {
    const a=[p.getX(i),p.getY(i),p.getZ(i)], b=[p.getX(i+1),p.getY(i+1),p.getZ(i+1)], c=[p.getX(i+2),p.getY(i+2),p.getZ(i+2)];
    const u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-9,'triangles have positive area');
    for(let j=0;j<3;j++) {
      const a=key(i+j),b=key(i+(j+1)%3),id=[a,b].sort().join('|');
      assert.notEqual(a,b,'no collapsed geometric edges');
      const edge=edges.get(id)||{count:0,winding:0}; edge.count++;edge.winding+=a<b?1:-1;edges.set(id,edge);
    }
  }
  for(const edge of edges.values()) {
    assert.equal(edge.count,2,'every geometric edge joins two triangles');
    assert.equal(edge.winding,0,'joined triangles have opposite winding');
  }
}
function assertControlLevels(g, profile) {
  const p=g.attributes.position, height=g.userData.effectiveBevelDepth;
  for(const {x} of profile) assert.ok(Array.from({length:p.count},(_,i)=>p.getZ(i)).some(z=>Math.abs(z-height*x)<2e-5),`control at ${x} retains its own axial edge level`);
}
for(const hollow of [false,true]) for(const values of [[0,0],[1,1],[.99,.99000001]]) {
  test(`extreme monotonic plateau preserves contour levels and closed topology hollow=${hollow}, y=${values}`,()=>{
    const profile=[{x:0,y:0},{x:.01,y:values[0]},{x:.99,y:values[1]},{x:1,y:1}];
    const g=buildMesh(square(),{...base,hollow,curvePoints:profile,innerCurvePoints:profile});
    assertClosed(g);assertControlLevels(g,profile);g.dispose();
  });
}
test('sharp curved imported SVG stays closed with extreme plateau at large requested width',()=>{
  const shape=parseSvg(readFileSync(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8')).objects[0].shape;
  const profile=[{x:0,y:0},{x:.01,y:.99},{x:.99,y:.99},{x:1,y:1}];
  for(const hollow of [false,true]) {
    const g=buildMesh(shape,{...base,depth:64,bevelSize:18,wallThickness:30,hollow,curvePoints:profile,innerCurvePoints:profile});
    assertClosed(g);assertControlLevels(g,profile);g.dispose();
  }
});
test('extreme reversing curve remains closed with different inner curve and extra span edges',()=>{
  const profile=[{x:0,y:0},{x:.01,y:.99},{x:.99,y:.01},{x:1,y:1}];
  const inner=[{x:0,y:0},{x:.2,y:.95},{x:.8,y:.05},{x:1,y:1}];
  const g=buildMesh(square(),{...base,hollow:true,bevelSegments:3,curvePoints:profile,innerCurvePoints:inner});
  assertClosed(g);assertControlLevels(g,profile);assertControlLevels(g,inner);g.dispose();
});
test('unrepresentably close curve controls fail explicitly instead of emitting collapsed triangles',()=>{
  const profile=[{x:0,y:0},{x:1e-9,y:.99},{x:.99,y:.01},{x:1,y:1}];
  assert.throws(()=>buildMesh(square(),{...base,curvePoints:profile}),/カーブ|間隔|近|精度/);
});
