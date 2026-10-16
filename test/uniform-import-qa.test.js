import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path } from 'three';
import { buildMesh } from '../src/geometry.js';
import { defaultProfile, evaluateProfile } from '../src/bevel-profile.js';
import { inspectImportPath, reduceImportPath } from '../src/import-reduction.js';
function rectangle() {
  const s = new Shape(); s.moveTo(0,0); s.lineTo(80,0); s.lineTo(80,60); s.lineTo(0,60); s.closePath(); return s;
}
const settings = {depth:30,bevelSize:5,bevelWidth:3,continueBevel:false};
test('QA actual straight bevel layers count interior loops, including zero', () => {
  for (const loops of [0,1,2]) {
    const geometry=buildMesh(rectangle(),{...settings,bevelSegments:loops,curvePoints:defaultProfile()});
    const samples=geometry.userData.bevelSamples;
    assert.equal(samples.length,loops+2);
    samples.forEach((t,i)=>assert.ok(Math.abs(t-i/(loops+1))<1e-12));
    const pos=geometry.attributes.position;
    const front=new Set();
    for(let i=0;i<pos.count;i++) if(pos.getZ(i)<=5+1e-6)front.add(+pos.getZ(i).toFixed(5));
    assert.deepEqual([...front].sort((a,b)=>a-b),samples.map(t=>+(t*5).toFixed(5)));
    geometry.dispose();
  }
});
test('QA curved bevel loop lengths are equal in physical cross section',()=>{
  const curve=[{x:0,y:0,mode:'bezier',out:{x:.15,y:0}}, {x:1,y:1,mode:'bezier',in:{x:.85,y:.2}}];
  const geometry=buildMesh(rectangle(),{...settings,bevelSegments:2,curvePoints:curve});
  const samples=geometry.userData.bevelSamples;
  assert.equal(samples.length,4);
  const arc=(a,b)=>{let sum=0,prev=evaluateProfile(curve,a);for(let i=1;i<=2000;i++){const t=a+(b-a)*i/2000,y=evaluateProfile(curve,t);sum+=Math.hypot(5*(b-a)/2000,3*(y-prev));prev=y;}return sum;};
  const lengths=samples.slice(1).map((t,i)=>arc(samples[i],t));
  assert.ok((Math.max(...lengths)-Math.min(...lengths))/Math.max(...lengths)<.002,JSON.stringify(lengths));
  geometry.dispose();
});
test('QA oversized import inspection does not mutate source; accepted reduction preserves hole',()=>{
  const s=new Shape();const count=6200;
  for(let i=0;i<count;i++){const a=i*2*Math.PI/count;const x=50*Math.cos(a),y=50*Math.sin(a);i?s.lineTo(x,y):s.moveTo(x,y);}s.closePath();
  const hole=new Path();hole.moveTo(-8,-8);hole.lineTo(-8,8);hole.lineTo(8,8);hole.lineTo(8,-8);hole.closePath();s.holes.push(hole);
  const before=JSON.stringify(s.toJSON());
  const info=inspectImportPath(s);assert.equal(info.overBudget,true);assert.equal(info.limit,6000);
  assert.equal(JSON.stringify(s.toJSON()),before,'inspection/cancel path is read-only');
  const reduced=reduceImportPath(s);
  assert.ok(reduced.reducedCount<=6000);assert.ok(reduced.reducedCount>=3);assert.equal(reduced.shape.holes.length,1);
  assert.equal(JSON.stringify(s.toJSON()),before,'approved reduction creates independent source');
  const g=buildMesh(reduced.shape,{depth:20,bevelSize:0,bevelSegments:0});
  assert.ok(g.attributes.position.count>0);assert.ok([...g.attributes.position.array].every(Number.isFinite));g.dispose();
});
test('QA explicit added curve control creates edge even at zero loops',()=>{
  const curve=[{x:0,y:0,mode:'linear'}, {x:.27,y:.27,mode:'linear',edge:true}, {x:.5,y:.5,mode:'linear',edge:false}, {x:1,y:1,mode:'linear'}];
  const geometry=buildMesh(rectangle(),{...settings,bevelSegments:0,curvePoints:curve});
  assert.deepEqual(geometry.userData.bevelSamples,[0,.27,1]);
  const p=geometry.attributes.position;
  assert.ok(Array.from({length:p.count},(_,i)=>p.getZ(i)).some(z=>Math.abs(z-1.35)<1e-6));geometry.dispose();
});
