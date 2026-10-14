import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';
import { defaultProfile } from '../src/bevel-profile.js';

const linear = defaultProfile();
const curved = [{ x: 0, y: 0, mode: 'linear' }, { x: 0.5, y: 0.8, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }];
const base = { depth: 30, bevelSize: 8, bevelWidth: 24, bevelContinue: true, wallThickness: 8, meshReduction: 0 };
const key = p => p.map(v => Math.round(v * 1e5)).join(',');
function vertices(g) {
  const p = g.attributes.position;
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
}
function checkMesh(g) {
  for (const attr of ['position', 'normal', 'uv']) assert.ok(Array.from(g.attributes[attr].array).every(Number.isFinite), `${attr} is finite`);
  const points = vertices(g), edges = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const tri = points.slice(i, i + 3), ab = tri[1].map((v,j) => v - tri[0][j]), ac = tri[2].map((v,j) => v - tri[0][j]);
    assert.ok(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]) > 1e-9, 'no zero-area triangles');
    for (let j = 0; j < 3; j++) {
      const a = key(tri[j]), b = key(tri[(j+1)%3]), k = [a,b].sort().join('|');
      const old = edges.get(k) || { count: 0, winding: 0 };
      old.count++; old.winding += a < b ? 1 : -1; edges.set(k,old);
    }
  }
  for (const e of edges.values()) { assert.equal(e.count, 2, 'each mesh edge has exactly two faces'); assert.equal(e.winding, 0, 'opposite edge orientation'); }
  const obj = exportObj([{ geometry:g, color:'#999999', name:'尖ったベベル' }]).obj;
  assert.doesNotMatch(obj, /NaN|Infinity/);
  const counts = Object.fromEntries(['v','vt','vn'].map(prefix => [prefix,obj.split('\n').filter(line => line.startsWith(prefix+' ')).length]));
  for (const line of obj.split('\n').filter(line => line.startsWith('f '))) for (const corner of line.slice(2).split(' ')) corner.split('/').forEach((v,i) => assert.ok(Number(v) >= 1 && Number(v) <= counts[['v','vt','vn'][i]], 'OBJ indices valid'));
  return points;
}
function diamond() {
  const s = new Shape(); s.moveTo(0,0); s.lineTo(120,18); s.lineTo(240,0); s.lineTo(120,-18); s.closePath(); return s;
}
for (const hollow of [false,true]) {
  test(`straight pointed bevel eliminates redundant planar layers and retains a real ridge crease (hollow=${hollow})`, () => {
    const shape = diamond(), source = JSON.stringify(shape.toJSON());
    const low = buildMesh(shape,{...base,hollow,bevelSegments:2,curvePoints:linear});
    const high = buildMesh(shape,{...base,hollow,bevelSegments:12,curvePoints:linear});
    const bent = buildMesh(shape,{...base,hollow,bevelSegments:12,curvePoints:curved});
    const points = checkMesh(high); checkMesh(low); checkMesh(bent);
    assert.equal(high.attributes.position.count,low.attributes.position.count,'division count does not add rings to an entirely planar bevel');
    assert.notDeepEqual(bent.attributes.position.array,high.attributes.position.array,'non-collinear profile changes the geometry within the requested budget');
    assert.equal(JSON.stringify(shape.toJSON()),source,'source path remains unchanged');
    for (const [x,y] of [[0,0],[120,18],[240,0],[120,-18]]) assert.ok(points.some(p => Math.hypot(p[0]-x,p[1]+y)<1e-5),'every original corner remains');
    // The leftmost roof ridge starts at the source tip (0,0,H). Its
    // corresponding source-edge planes intersect in a straight x/z line.
    const h = high.userData.effectiveBevelDepth;
    const ridge = points.filter(p => Math.abs(p[1]) < 1e-5 && p[0] > 1e-5 && p[0] <= 120+1e-5 && p[2] < h-1e-5);
    assert.ok(ridge.length,'left tip has a medial ridge');
    const end = ridge.reduce((a,b) => a[0]<b[0]?a:b);
    const ridgeEdges = [];
    for(let i=0;i<points.length;i+=3) for(let j=0;j<3;j++) {
      const a=points[i+j],b=points[i+(j+1)%3];
      if([a,b].every(p => Math.abs(p[1])<1e-5 && p[0]>=-1e-5 && p[0]<=end[0]+1e-5 && p[2]<=h+1e-5)) ridgeEdges.push([a,b]);
    }
    assert.ok(ridgeEdges.some(([a,b])=>Math.abs(a[0]-b[0])>1),'ridge is represented by mesh edges');
    for(const edge of ridgeEdges) for(const p of edge) assert.ok(Math.abs(p[2]-(h+(end[2]-h)*p[0]/end[0]))<2e-5,'ridge edge stays on the analytic straight intersection');
    const p = high.attributes.position, n = high.attributes.normal;
    const normals=[];
    for(let i=0;i<p.count;i++) if(Math.hypot(p.getX(i)-end[0],p.getY(i)-end[1],p.getZ(i)-end[2])<1e-5) normals.push(n.getY(i));
    assert.ok(normals.some(y=>y>0.2)&&normals.some(y=>y<-.2),'opposing bevel normals remain distinct at the ridge');
    for(const g of [low,high,bent])g.dispose();
  });
}
function sampledShape(kind) {
  const ring=[], divisions=48;
  for(let side=0;side<2;side++) for(let i=side?divisions-1:0;side?i>0:i<=divisions;side?i--:i++) {
    const t=i/divisions;
    ring.push(kind==='leaf'?[240*t,(side?45:85)*4*t*(1-t)]:[(70+(side?-10:20)*Math.sin(Math.PI*t))*Math.cos(2.4*t),(70+(side?-10:20)*Math.sin(Math.PI*t))*Math.sin(2.4*t)]);
  }
  const s=new Shape();ring.forEach((p,i)=>i?s.lineTo(...p):s.moveTo(...p));s.closePath();return {s,ring};
}
for(const kind of ['leaf','crescent'])for(const hollow of [false,true])test(`sampled ${kind} preserves all source outline points and closed curved/linear roofs (hollow=${hollow})`,()=>{
  const {s,ring}=sampledShape(kind), source=JSON.stringify(s.toJSON());
  for(const profile of [linear,curved]) {
    const g=buildMesh(s,{...base,hollow,bevelWidth:15,bevelSegments:5,curvePoints:profile});
    const points=checkMesh(g);
    for(const [x,y] of ring)assert.ok(points.some(p=>Math.hypot(p[0]-x,p[1]+y)<2e-5),'source outline sampling is retained');
    assert.equal(JSON.stringify(s.toJSON()),source,'mesh changes do not reduce source vertices');g.dispose();
  }
});
