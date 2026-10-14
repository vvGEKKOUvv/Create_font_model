import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { cleanupPlanarPatch } from '../src/roof-planar-cleanup.js';
import { buildMesh, exportObj } from '../src/geometry.js';

const point = (x,y) => ({ x,y,height:.2+x*.03+y*.02 });
const key = p => `${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(p.height*1e7)}`;
const count = ts => new Set(ts.flatMap(t=>t.points.map(key))).size;
function moments(ts) {
  return ts.reduce((v,t)=>{
    const [a,b,c]=t.points, area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
    v[0]+=area;v[1]+=area*(a.height+b.height+c.height)/3;return v;
  },[0,0]);
}

test('QA: planar fan removes only interior vertices while retaining seam, ridge and curve anchors exactly',()=>{
  // Collinear boundary points stand for the adjacent face/cap/curve anchors;
  // an almost coincident interior point creates the needle fan seen by users.
  const boundary=[[0,0],[4,0],[10,0],[10,6],[4,6],[0,6]].map(p=>point(...p));
  const center=point(4,2e-6);
  const old=boundary.map((p,i)=>({faceIndex:3,points:[p,boundary[(i+1)%boundary.length],center]}));
  const fresh=cleanupPlanarPatch(old);
  assert.equal(old.length,6);assert.equal(fresh.length,4);
  assert.equal(count(old),7);assert.equal(count(fresh),6);
  const kept=new Set(fresh.flatMap(t=>t.points.map(key)));
  for(const p of boundary)assert.ok(kept.has(key(p)),'unchanged required seam/ridge/anchor');
  assert.ok(!kept.has(key(center)),'tiny fan point is removed');
  const before=moments(old),after=moments(fresh);
  before.forEach((v,i)=>assert.ok(Math.abs(v-after[i])<1e-10,'same planar area and height integral'));
  for(const t of fresh) for(const p of t.points) assert.equal(p.height,.2+p.x*.03+p.y*.02,'same analytic plane');
});

function checkClosed(g) {
  for(const attr of ['position','normal','uv'])assert.ok([...g.attributes[attr].array].every(Number.isFinite));
  const a=g.attributes.position, edges=new Map();
  const vk=i=>[a.getX(i),a.getY(i),a.getZ(i)].map(x=>Math.round(x*1e5)).join(',');
  for(let i=0;i<a.count;i+=3)for(let j=0;j<3;j++){
    const x=vk(i+j),y=vk(i+(j+1)%3), k=[x,y].sort().join('|');
    assert.notEqual(x,y,'no collapsed edge');
    const e=edges.get(k)||[0,0];e[0]++;e[1]+=x<y?1:-1;edges.set(k,e);
  }
  for(const [n,w] of edges.values()){assert.equal(n,2,'hole and exterior remain closed');assert.equal(w,0,'opposite winding');}
  const obj=exportObj([{geometry:g,name:'QA',color:'#999999'}]).obj;
  assert.doesNotMatch(obj,/NaN|Infinity/);
  const counts=['v','vt','vn'].map(prefix=>obj.split('\n').filter(l=>l.startsWith(prefix+' ')).length);
  for(const l of obj.split('\n').filter(l=>l.startsWith('f ')))for(const v of l.slice(2).split(' '))v.split('/').forEach((n,i)=>assert.ok(+n>=1&&+n<=counts[i]));
}

test('QA: curved crescent hollow keeps original outline samples and valid UV/OBJ after sliver cleanup',()=>{
  const ring=[];
  for(let side=0;side<2;side++)for(let i=side?47:0;side?i>0:i<=48;side?i--:i++){
    const t=i/48,r=70+(side?-10:20)*Math.sin(Math.PI*t);ring.push([r*Math.cos(2.4*t),r*Math.sin(2.4*t)]);
  }
  const s=new Shape();ring.forEach((p,i)=>i?s.lineTo(...p):s.moveTo(...p));s.closePath();
  const original=JSON.stringify(s.toJSON());
  const curvePoints=[{x:0,y:0,mode:'linear'},{x:.37,y:.6,mode:'linear'},{x:1,y:1,mode:'linear'}];
  const g=buildMesh(s,{depth:30,bevelSize:8,bevelWidth:15,bevelSegments:4,hollow:true,wallThickness:8,curvePoints});
  checkClosed(g);
  const p=g.attributes.position;
  for(const [x,y] of ring)assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>Math.hypot(p.getX(i)-x,p.getY(i)+y)<2e-5),'all original path samples retained');
  assert.equal(JSON.stringify(s.toJSON()),original);
  assert.ok(g.userData.bevelSamples.includes(.37),'explicit curve anchor remains a sampled edge');
  g.dispose();
});
