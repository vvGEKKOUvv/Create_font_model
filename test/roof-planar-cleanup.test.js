import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlanarPatch } from '../src/roof-planar-cleanup.js';
const point = (x, y) => ({ x, y, height: x * .1 + y * .2 });
const triangle = (...points) => ({ faceIndex: 7, points });
test('planar patch removes clipped diagonal fan while retaining collinear boundary seam points', () => {
  const boundary = [point(0,0), point(1,0), point(2,0), point(2,2), point(0,2)];
  const center = point(1,.999999);
  const old = boundary.map((p,i) => triangle(p, boundary[(i+1)%boundary.length], center));
  const result = cleanupPlanarPatch(old);
  assert.equal(result.length, 3);
  const retained = new Set(result.flatMap(t => t.points));
  assert.equal(retained.has(center), false);
  boundary.forEach(p => assert.equal(retained.has(p), true));
  result.forEach(t => assert.equal(t.faceIndex,7));
});
test('planar patch retains hole boundaries', () => {
  const outer = [point(0,0),point(4,0),point(4,4),point(0,4)];
  const inner = [point(1,1),point(3,1),point(3,3),point(1,3)];
  const original = [];
  for (let i=0;i<4;i++) {
    const j=(i+1)%4, mid=point((outer[i].x+outer[j].x+inner[i].x+inner[j].x)/4,(outer[i].y+outer[j].y+inner[i].y+inner[j].y)/4);
    original.push(triangle(outer[i],outer[j],mid), triangle(outer[j],inner[j],mid),triangle(inner[j],inner[i],mid),triangle(inner[i],outer[i],mid));
  }
  const result=cleanupPlanarPatch(original);
  assert.equal(result.length,8);
  const retained=new Set(result.flatMap(t=>t.points));
  [...outer,...inner].forEach(p=>assert.equal(retained.has(p),true));
});
test('already minimal planar patch is returned without retriangulation', () => {
  const a=point(0,0),b=point(1,0),c=point(1,1),d=point(0,1);
  const triangles=[triangle(a,b,c),triangle(a,c,d)];
  assert.equal(cleanupPlanarPatch(triangles),triangles);
});
test('only explicitly removable collinear band intersections are dropped', () => {
  const a=point(0,0),mid=point(1,0),b=point(2,0),c=point(2,2),d=point(0,2),center=point(1,1);
  const boundary=[a,mid,b,c,d];
  const triangles=boundary.map((p,i)=>triangle(p,boundary[(i+1)%5],center));
  const result=cleanupPlanarPatch(triangles,p=>p===mid);
  assert.equal(result.length,2);
  const retained=new Set(result.flatMap(t=>t.points));
  assert.equal(retained.has(mid),false);
  [a,b,c,d].forEach(p=>assert.ok(retained.has(p)));
});
test('concave L skeleton bands discard pre-triangulation seam intersections', async () => {
  const { prepareBevelRoof, triangulateBevelRoof } = await import('../src/bevel-roof.js');
  const ring=[[0,0],[80,0],[80,20],[30,20],[30,80],[0,80]].map(([x,y])=>({x,y}));
  const roof=prepareBevelRoof([ring]);
  const triangles=triangulateBevelRoof(roof,15,[0,.25,.5,.75,1],t=>t);
  // Before regrouping its concave source-edge faces this fixture needed 52
  // triangles, including artificial diagonal intersections on band seams.
  assert.ok(triangles.length <= 44, `unexpected redundant triangles: ${triangles.length}`);
  const retained=triangles.flatMap(t=>t.points);
  ring.forEach(p=>assert.ok(retained.some(q=>q.x===p.x&&q.y===p.y&&q.height===1)));
  assert.equal(triangulateBevelRoof(roof,15,[0,.25,.5,.75,1],t=>t),triangles);
});

test('nonplanar fan retains its original vertices and shape', () => {
  const boundary=[point(0,0),point(2,0),point(2,2),point(0,2)];
  const center={...point(1,1),height:0.9};
  const triangles=boundary.map((p,i)=>triangle(p,boundary[(i+1)%4],center));
  assert.equal(cleanupPlanarPatch(triangles),triangles,'a curved or folded patch must not be flattened');
});
