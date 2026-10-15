import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, Shape, Path } from 'three';
import { prepareOffsetBevelRoof, triangulateOffsetBevelRoof } from '../src/offset-bevel-roof.js';
import { validateRoofTriangles } from '../src/roof-topology.js';
import { buildMesh } from '../src/geometry.js';

const rectangle = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p => new Vector2(...p));
const rings = [rectangle(0, 0, 100, 80), rectangle(4, 20, 76, 40)];
// Inspect actual edges, not effective-width metadata or an interpolated cap.
function assertCenterEdge(triangles, x, from, to) {
  const intervals = [];
  for (const points of triangles) for (let i = 0; i < 3; i++) {
    const a = points[i], b = points[(i + 1) % 3];
    if (Math.abs(a.x-x) < 1e-4 && Math.abs(b.x-x) < 1e-4)
      intervals.push([Math.min(a.y,b.y),Math.max(a.y,b.y)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);
  let reach = from;
  for (const [a,b] of intervals) if (a <= reach+1e-4 && b >= from) reach = Math.max(reach,b);
  assert.ok(reach >= to-1e-4, `actual meeting ridge at x=${x} remains connected from y=${from} to ${to}; reached ${reach}`);
}

for (const width of [2,4,8]) test(`QA offset fallback retains already met narrow wall ridge while width increases to ${width}`,()=>{
  const roof = prepareOffsetBevelRoof(rings);
  const triangles = triangulateOffsetBevelRoof(roof,width,[0,1/3,2/3,1],t=>t);
  validateRoofTriangles(triangles,rings);
  assertCenterEdge(triangles.map(t=>t.points),2,25,55);
});

test('QA offset fallback maximum width leaves both narrow and wide wall center ridges',()=>{
  const roof = prepareOffsetBevelRoof(rings);
  const triangles = triangulateOffsetBevelRoof(roof,roof.maximumWidth,[0,1/3,2/3,1],t=>t);
  validateRoofTriangles(triangles,rings);
  assertCenterEdge(triangles.map(t=>t.points),2,25,55);
  // The wide twenty-unit opposing wall reaches x=90 independently.
  assertCenterEdge(triangles.map(t=>t.points),90,32,48);
});

for (const width of [2,4,8,100]) test(`QA mesh primary route retains narrow wall center ridge at width ${width}`,()=>{
  const shape = new Shape(rings[0]); shape.holes.push(new Path(rings[1]));
  const geometry = buildMesh(shape,{depth:60,bevelSize:20,bevelWidth:width,bevelContinue:true,bevelSegments:2});
  const p = geometry.attributes.position, triangles=[];
  for(let i=0;i<p.count;i+=3) {
    const points=[i,i+1,i+2].map(j=>({x:p.getX(j),y:-p.getY(j),z:p.getZ(j)}));
    if(points.every(q=>q.z<=20+1e-4)) triangles.push(points);
  }
  assertCenterEdge(triangles,2,25,55);
  geometry.dispose();
});

// The generated cavity is the source wavefront at distance W. Its meeting
// curve is the SAME wavefront at W/2, independently of the current width.
// Derive its segments from the solid source roof, not the hollow mesh labels.
test('QA uploaded SVG keeps its complete outer/cavity center curve after widths meet', async()=>{
  const {readFile}=await import('node:fs/promises');
  const {DOMParser}=await import('@xmldom/xmldom');
  const {parseSvg}=await import('../src/geometry.js');
  const {prepareContours}=await import('../src/path-reduction.js');
  const {prepareBevelRoof}=await import('../src/bevel-roof.js');
  globalThis.DOMParser=DOMParser;
  const shape=parseSvg(await readFile(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8')).objects[0].shape;
  const ring=prepareContours(shape,0).rings[0], sourceRoof=prepareBevelRoof([ring]), wall=20, guides=[];
  for(const face of sourceRoof.faces){
    const hits=[];
    for(let i=0;i<face.length;i++){
      const a=face[i],b=face[(i+1)%face.length];
      if((a.time<wall/2&&b.time>wall/2)||(b.time<wall/2&&a.time>wall/2)){
        const t=(wall/2-a.time)/(b.time-a.time);hits.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});
      }
    }
    if(hits.length===2&&Math.hypot(hits[1].x-hits[0].x,hits[1].y-hits[0].y)>.1)guides.push(hits);
  }
  assert.ok(guides.length>100,'center curve covers the real dense imported outline');
  for(const width of [wall/2,wall,1000]){
    const geometry=buildMesh(shape,{depth:60,bevelSize:20,bevelWidth:width,bevelContinue:true,bevelSegments:2,hollow:true,wallThickness:wall});
    const p=geometry.attributes.position, edges=[];
    for(let i=0;i<p.count;i+=3)for(let j=0;j<3;j++){
      const ends=[i+j,i+(j+1)%3].map(k=>({x:p.getX(k),y:-p.getY(k),z:p.getZ(k)}));
      if(ends.every(q=>q.z<=20.0001))edges.push(ends);
    }
    for(const [a,b] of guides){
      const length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length,intervals=[];
      for(const ends of edges){
        if(ends.some(q=>Math.abs((q.x-a.x)*uy-(q.y-a.y)*ux)>.002))continue;
        const ts=ends.map(q=>(q.x-a.x)*ux+(q.y-a.y)*uy).sort((a,b)=>a-b);intervals.push(ts);
      }
      intervals.sort((a,b)=>a[0]-b[0]);let reach=0;
      for(const [start,end] of intervals)if(start<=reach+.002&&end>=0)reach=Math.max(reach,end);
      assert.ok(reach>=length-.002,`uploaded center curve holds at width ${width}, segment (${a.x},${a.y}) -> (${b.x},${b.y}), covered ${reach}/${length}`);
    }
    geometry.dispose();
  }
});
