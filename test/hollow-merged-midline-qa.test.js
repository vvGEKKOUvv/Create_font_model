import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh } from '../src/geometry.js';
import { prepareContours } from '../src/path-reduction.js';
import { prepareBevelRoof } from '../src/bevel-roof.js';
import { defaultProfile } from '../src/bevel-profile.js';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';

globalThis.DOMParser=DOMParser;
const shape=parseSvg(await readFile(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8')).objects[0].shape;
const ring=prepareContours(shape,0).rings[0], roof=prepareBevelRoof([ring]);
const wall=17.031;
const guides=[];
for(const face of roof.faces){
  const hits=[];
  for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length];
    if((a.time<wall/2&&b.time>wall/2)||(b.time<wall/2&&a.time>wall/2)){
      const t=(wall/2-a.time)/(b.time-a.time);
      hits.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});
    }
  }
  if(hits.length===2&&Math.hypot(hits[1].x-hits[0].x,hits[1].y-hits[0].y)>.1)guides.push(hits);
}
assert.ok(guides.length>100);
function sharedMidline(geometry, checkAllGuides=true){
  const p=geometry.attributes.position, edges=new Map();
  for(const name of ['position','normal','uv'])assert.ok([...geometry.attributes[name].array].every(Number.isFinite));
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].join(',');
  for(let i=0;i<p.count;i+=3)for(let j=0;j<3;j++){
    const a=i+j,b=i+(j+1)%3,ka=key(a),kb=key(b),id=[ka,kb].sort().join('|');
    assert.notEqual(ka,kb,'no collapsed edge');
    const edge=edges.get(id)??{count:0,winding:0,ends:[a,b].map(k=>({x:p.getX(k),y:-p.getY(k),z:p.getZ(k)}))};
    edge.count++;edge.winding+=ka<kb?1:-1;edges.set(id,edge);
  }
  for(const edge of edges.values()){
    assert.equal(edge.count,2,'contact and all other edges are shared by exactly two triangles');
    assert.equal(edge.winding,0,'shared edges have opposite winding');
  }
  const front=[...edges.values()].filter(e=>e.ends.every(p=>p.z<20.0001));
  for(const [a,b]of checkAllGuides ? guides : []){
    const length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length,intervals=[];
    for(const {ends}of front){
      if(ends.some(q=>Math.abs((q.x-a.x)*uy-(q.y-a.y)*ux)>.002))continue;
      intervals.push(ends.map(q=>(q.x-a.x)*ux+(q.y-a.y)*uy).sort((a,b)=>a-b));
    }
    intervals.sort((a,b)=>a[0]-b[0]);let reach=0;
    for(const [start,end]of intervals)if(start<=reach+.002&&end>=0)reach=Math.max(reach,end);
    assert.ok(reach>=length-.002,`one shared midpoint edge covers ${reach}/${length} from (${a.x},${a.y})`);
  }
  assert.ok(!geometry.userData.warnings.some(w=>/通常ベベル|安全な最大幅/.test(w)),'sample positions do not force ordinary bevel fallback');
}
// This non-integer wall thickness failed before the width reached W/2. The
// complete midpoint partition must survive even when its upper part is flat.
for(const bevelSegments of [0,2,5])test(`QA uploaded midpoint joins remain shared through width transition, N=${bevelSegments}`,()=>{
  for(const width of [.4*wall,.5*wall,wall]){
    const g=buildMesh(shape,{depth:60,bevelSize:20,bevelWidth:width,bevelContinue:true,bevelSegments,hollow:true,wallThickness:wall,curvePoints:defaultProfile()});
    sharedMidline(g);g.dispose();
  }
});
test('QA unequal inner/outer profiles and mesh reduction retain shared joined midpoint at maximum width',()=>{
  const source=buildMesh(shape,{depth:60,bevelSize:20,bevelWidth:wall,bevelContinue:true,bevelSegments:4,hollow:true,wallThickness:wall,curvePoints:defaultProfile(),innerCurvePoints:[{x:0,y:0},{x:.5,y:.8},{x:1,y:1}]});
  sharedMidline(source);
  const reduced=reduceMeshGeometry(source,50);sharedMidline(reduced,false);
  if(reduced!==source)reduced.dispose();source.dispose();
});
