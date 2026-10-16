import test from 'node:test';
import assert from 'node:assert/strict';
import { independentRoofProfiles } from '../src/dual-bevel-profile.js';

const rings = [
  [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],
  [{x:3,y:3},{x:3,y:7},{x:7,y:7},{x:7,y:3}],
];
const roof = () => [
  {points:[{x:1,y:1,height:0},{x:2,y:2,height:0.4},{x:8,y:2,height:0.6}]},
  {points:[{x:2,y:2,height:0.4},{x:8,y:2,height:0.6},{x:8,y:8,height:1}]},
];

test('independent profile tables reuse unchanged controls across roof rebuilds', () => {
  let evaluations=0;
  const outer=t=>{evaluations++;return t*t;};
  const inner=t=>{evaluations++;return t;};
  const first=roof();
  const expected=independentRoofProfiles(first,rings,outer,inner);
  evaluations=0;
  const keyed=independentRoofProfiles(first,rings,outer,inner,'performance-profile-test-a');
  assert.deepEqual(keyed,expected);
  const cold=evaluations;
  assert.ok(cold>=1026);
  evaluations=0;
  assert.strictEqual(independentRoofProfiles(first,rings,outer,inner,'performance-profile-test-a'),keyed);
  assert.equal(evaluations,0);
  const changedRoof=roof();
  const rebuilt=independentRoofProfiles(changedRoof,rings,outer,inner,'performance-profile-test-a');
  assert.deepEqual(rebuilt,expected);
  assert.equal(evaluations,0,'cached side profiles invert without evaluating either control curve again');
  assert.equal(rebuilt[0].points[1].height,rebuilt[1].points[0].height);
});

test('changed controls and cached returning profiles preserve validation', () => {
  const triangles=roof();
  const original=independentRoofProfiles(triangles,rings,t=>t*t,t=>t,'performance-profile-test-b');
  const changed=independentRoofProfiles(triangles,rings,t=>t*t,t=>Math.sqrt(t),'performance-profile-test-c');
  assert.notDeepEqual(original,changed);
  for(let i=0;i<2;i++) assert.throws(
    ()=>independentRoofProfiles(triangles,rings,t=>t,t=>Math.sin(t*Math.PI),'performance-profile-test-returning'),
    /戻らない/,
  );
});

test('accelerated fallback ownership matches exhaustive source distance, including outer-priority ties',()=>{
 const ring=(low,high,count)=>{const result=[];for(let edge=0;edge<4;edge++)for(let i=0;i<count;i++){const t=i/count;result.push(edge===0?{x:low+(high-low)*t,y:low}:edge===1?{x:high,y:low+(high-low)*t}:edge===2?{x:high-(high-low)*t,y:high}:{x:low,y:high-(high-low)*t});}return result;};
 const rings=[ring(0,100,180),ring(20,80,180)];
 const triangles=Array.from({length:60},(_,i)=>{const x=2+i*1.6,y=i%3===0?5:i%3===1?10:15;return {points:[{x:x-.001,y:y-.001,height:.36},{x:x+.001,y:y-.001,height:.36},{x,y:y+.002,height:.36}]};});
 const result=independentRoofProfiles(triangles,rings,t=>t*t,t=>t,'bvh-distance-regression');
 const distance=(p,a,b)=>{const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return (p.x-a.x-t*x)**2+(p.y-a.y-t*y)**2;};
 for(let i=0;i<triangles.length;i++){
  const p=triangles[i].points.reduce((sum,q)=>({x:sum.x+q.x/3,y:sum.y+q.y/3}),{x:0,y:0});
  const d=rings.map(ring=>Math.min(...ring.map((a,j)=>distance(p,a,ring[(j+1)%ring.length]))));
  const expected=d[1]<d[0]?.36:.6;
  for(const point of result[i].points)assert.ok(Math.abs(point.height-expected)<1e-5);
 }
});
