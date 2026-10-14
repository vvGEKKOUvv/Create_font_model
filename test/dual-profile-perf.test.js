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
  assert.equal(evaluations,2,'only distinct interior vertices require exact evaluation');
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
