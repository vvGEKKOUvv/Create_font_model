import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, normalizeProfile, evaluateProfile } from '../src/bevel-profile.js';
import { sampleBevelProfile } from '../src/bevel-profile-samples.js';
const sample=(points,n,dimensions={})=>sampleBevelProfile(points,t=>evaluateProfile(points,t),n,dimensions);
test('default middle control always has an edge, and each span gets the requested extra cuts',()=>{
 assert.deepEqual(sample(defaultProfile(),0),[0,.5,1]);
 assert.deepEqual(sample(defaultProfile(),1),[0,.25,.5,.75,1]);
 const values=sample(defaultProfile(),2),expected=[0,1/6,1/3,.5,2/3,5/6,1];
 assert.equal(values.length,expected.length);values.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-12));
});
test('unequal straight spans each receive their own evenly spaced cuts',()=>{
 const points=normalizeProfile([{x:0,y:0},{x:.2,y:.4},{x:.7,y:.9},{x:1,y:1}]);
 const result=sample(points,2);assert.equal(result.length,10);
 for(let span=0;span<3;span++)for(let j=0;j<=3;j++)assert.ok(Math.abs(result[span*3+j]-(points[span].x+(points[span+1].x-points[span].x)*j/3))<1e-12);
});
test('curved spans divide their own physical arc lengths rather than the whole curve',()=>{
 const points=normalizeProfile([{x:0,y:0,mode:'bezier',out:{x:.02,y:.2}},{x:.3,y:.4,mode:'bezier',in:{x:.2,y:.39},out:{x:.7,y:.41}},{x:1,y:1,mode:'bezier',in:{x:.95,y:.7}}]);
 const result=sample(points,3,{height:7,width:4});assert.equal(result.length,9);assert.equal(result[4],.3);
 const length=(a,b)=>{let sum=0,previous=evaluateProfile(points,a);for(let i=1;i<=500;i++){const t=a+(b-a)*i/500,value=evaluateProfile(points,t);sum+=Math.hypot(7*(b-a)/500,4*(value-previous));previous=value;}return sum;};
 for(let span=0;span<2;span++){const lengths=Array.from({length:4},(_,j)=>length(result[span*4+j],result[span*4+j+1]));assert.ok(Math.max(...lengths)-Math.min(...lengths)<.001);}
});
test('profiles without explicit controls have only endpoint anchors and cached results cannot be mutated',()=>{
 assert.deepEqual(sampleBevelProfile([],t=>t,0,{straightFallback:true}),[0,1]);
 const points=defaultProfile(),first=sample(points,1);first[1]=99;assert.deepEqual(sample(points,1),[0,.25,.5,.75,1]);
});
