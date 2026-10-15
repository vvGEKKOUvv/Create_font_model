import test from 'node:test';
import assert from 'node:assert/strict';
import { repairHollowMidpointTriangles } from '../src/hollow-ring-repair.js';
import { validateRoofTriangles } from '../src/roof-topology.js';
import { triangulateBevelRoof } from '../src/bevel-roof.js';

function fixture(perturb=0){
  const square=s=>[[-s,-s],[s,-s],[s,s],[-s,s]].map(([x,y])=>({x,y,time:0,height:1}));
  const subdivide=ring=>ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length];return[a,{x:(a.x+b.x)/2,y:(a.y+b.y)/2,time:a.time,height:a.height}];});
  const outer=subdivide(square(3)),inner=square(1),mid=subdivide(square(2).map(p=>({...p,time:1,height:0})));
  const roof={maximumWidth:1,midpointRoof:true,midpointLoops:[mid],rings:[outer,[...inner].reverse()]};
  const triangles=[];
  const quad=(a,b,c,d,faceIndex)=>{
    for(const points of [[a,b,c],[a,c,d]]){
      const [p,q,r]=points;
      if((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)<0)points.reverse();
      triangles.push({faceIndex,points});
    }
  };
  for(let i=0;i<8;i++)quad(outer[i],outer[(i+1)%8],mid[(i+1)%8],mid[i],i);
  const coarse=mid.filter((_,i)=>i%2===0).map(p=>({...p,x:p.x+perturb}));
  for(let i=0;i<4;i++)quad(coarse[i],coarse[(i+1)%4],inner[(i+1)%4],inner[i],8+i);
  return {roof,triangles};
}
for(const perturb of [0,3e-7])test(`repair existing hollow midpoint T-junctions and subpixel seams ${perturb}`,()=>{
  const {roof,triangles}=fixture(perturb),original=JSON.stringify(triangles);
  assert.throws(()=>validateRoofTriangles(triangles,roof.rings));
  const repaired=repairHollowMidpointTriangles(triangles,roof,t=>1-t);
  validateRoofTriangles(repaired,roof.rings);
  assert.equal(JSON.stringify(triangles),original,'input triangles remain unchanged');
  assert.equal(repaired.length,triangles.length+4,'one split per missing midpoint vertex, without added profile rows');
  for(const triangle of repaired){
    assert.ok(Number.isInteger(triangle.faceIndex));
    for(const p of triangle.points)assert.equal(p.height,1-p.time);
  }
});
test('repair rejects a genuine missing face rather than bridging the cavity',()=>{
  const {roof,triangles}=fixture();triangles.splice(0,1);
  assert.throws(()=>repairHollowMidpointTriangles(triangles,roof,t=>1-t));
});
test('repair rejects seams beyond renderer precision',()=>{
  const {roof,triangles}=fixture(.01);
  assert.throws(()=>repairHollowMidpointTriangles(triangles,roof,t=>1-t));
});

test('repair rejects nonfinite data and preserves error classification',()=>{
  const {roof,triangles}=fixture();triangles[0].points[0]={...triangles[0].points[0],x:NaN};
  assert.throws(()=>repairHollowMidpointTriangles(triangles,roof,t=>1-t),{code:'INVALID_BEVEL_TOPOLOGY'});
});
test('repair rejects a near-collinear triangle whose snapped orientation flips',()=>{
  const {roof,triangles}=fixture();
  triangles.push({faceIndex:99,points:[
    {x:-2+3e-7,y:-2,time:1,height:0},
    {x:-2+2e-7,y:-2+1e-7,time:.5,height:.5},
    {x:-2+2e-7,y:-2-1e-7,time:.5,height:.5},
  ]});
  assert.throws(()=>repairHollowMidpointTriangles(triangles,roof,t=>1-t),{code:'INVALID_BEVEL_TOPOLOGY'});
});

test('production bevel triangulation repairs a hollow meeting contour instead of abandoning the roof',()=>{
  const {roof,triangles}=fixture();
  roof.faces=triangles.map(t=>t.points);
  assert.throws(()=>validateRoofTriangles(triangles,roof.rings),{code:'INVALID_BEVEL_TOPOLOGY'});
  const sampled=triangulateBevelRoof(roof,1,[0,1],t=>t);
  validateRoofTriangles(sampled,roof.rings);
  assert.equal(sampled.length,triangles.length+4,'production route inserts only the four missing meeting-edge vertices');
  assert.equal(triangulateBevelRoof(roof,1,[0,1],t=>t),sampled,'the repaired result is cached normally');
});
test('repair refuses to merge nearby anchors belonging to distinct loops',()=>{
  const {roof,triangles}=fixture();
  roof.midpointLoops.push(roof.midpointLoops[0].map(p=>({...p,x:p.x+3e-7})));
  assert.throws(()=>repairHollowMidpointTriangles(triangles,roof,t=>1-t),
    error=>error.code==='INVALID_BEVEL_TOPOLOGY'&&/異なる/.test(error.message));
});
