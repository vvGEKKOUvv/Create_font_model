import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';
import { defaultProfile, normalizeProfile, evaluateProfile } from '../src/bevel-profile.js';
function rectangle() {
  const s = new Shape(); s.moveTo(0,0); s.lineTo(100,0); s.lineTo(100,80); s.lineTo(0,80); s.closePath(); return s;
}
function mesh(n, curvePoints=defaultProfile(), extra={}) {
  return buildMesh(rectangle(), {depth:30, bevelSize:8, bevelWidth:6, bevelSegments:n, curvePoints, bevelContinue:true, ...extra});
}
test('zero, one and two means that many uniform interior loops per control interval', () => {
  for(const roof of [true,false]) for(const n of [0,1,2,5]) {
    const g=mesh(n,defaultProfile(),{bevelContinue:roof});
    assert.equal(g.userData.bevelSamples.length,2*(n+1)+1);
    g.userData.bevelSamples.forEach((t,i)=>assert.ok(Math.abs(t-i/(2*(n+1)))<1e-12));
    const positions=g.attributes.position;
    for(const t of g.userData.bevelSamples) assert.ok(Array.from({length:positions.count},(_,i)=>positions.getZ(i)).some(z=>Math.abs(z-8*t)<1e-5),'specified cut present in actual mesh');
    assert.ok(!exportObj([{name:'loop',geometry:g}]).obj.includes('NaN')); g.dispose();
  }
});
test('curved bevel intervals have equal physical surface arclength rather than equal height', () => {
  const control=normalizeProfile([{x:0,y:0,mode:'bezier',out:{x:.1,y:.6}}, {x:1,y:1,mode:'bezier',in:{x:.7,y:.95}}]);
  const g=mesh(2,control), samples=g.userData.bevelSamples;
  assert.equal(samples.length,4); assert.ok(Math.abs(samples[1]-1/3)>.01);
  const lengths=samples.slice(1).map((end,i)=>{
    const start=samples[i]; let sum=0,y=evaluateProfile(control,start);
    for(let k=1;k<=4096;k++) { const t=start+(end-start)*k/4096, next=evaluateProfile(control,t); sum+=Math.hypot(8*(end-start)/4096,6*(next-y));y=next; }
    return sum;
  });
  assert.ok(Math.max(...lengths)/Math.min(...lengths)<1.0001); g.dispose();
});
test('every curve vertex explicitly inserts its edge including default center',()=>{
  const controls=defaultProfile().map(p=>({...p,edge:false}));
  controls.splice(1,0,{x:.27,y:.27,mode:'linear',edge:true});
  const g=mesh(0,controls);
  assert.deepEqual(g.userData.bevelSamples,[0,.27,.5,1]); g.dispose();
});

test('each curved control span distributes its own loops uniformly in physical arclength',()=>{
  const controls=normalizeProfile([
    {x:0,y:0,mode:'bezier',handleMode:'free',out:{x:.1,y:.05}},
    {x:.35,y:.6,mode:'bezier',handleMode:'free',in:{x:.25,y:.3},out:{x:.5,y:.8}},
    {x:1,y:1,mode:'bezier',handleMode:'free',in:{x:.85,y:.95}},
  ]);
  const g=mesh(2,controls),samples=g.userData.bevelSamples;
  assert.equal(samples.length,7);assert.ok(Math.abs(samples[3]-.35)<1e-10);
  for(const startIndex of [0,3]) {
    const arcLengths=[];
    for(let j=0;j<3;j++) {
      const a=samples[startIndex+j],b=samples[startIndex+j+1];let length=0,previous=evaluateProfile(controls,a);
      for(let k=1;k<=2048;k++) {const t=a+(b-a)*k/2048,next=evaluateProfile(controls,t);length+=Math.hypot(8*(b-a)/2048,6*(next-previous));previous=next;}
      arcLengths.push(length);
    }
    assert.ok(Math.max(...arcLengths)/Math.min(...arcLengths)<1.001,'each control span receives three equal physical segments');
  }
  g.dispose();
});
