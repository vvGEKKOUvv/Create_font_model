import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path, Mesh, MeshBasicMaterial } from 'three';
import { buildMesh } from '../src/geometry.js';
import { prepareObjectMesh } from '../src/transform-tools.js';
function shape(hole=false){const s=new Shape();s.moveTo(0,0);s.lineTo(60,0);s.lineTo(60,50);s.lineTo(0,50);s.closePath();if(hole){const p=new Path();p.moveTo(20,15);p.lineTo(20,35);p.lineTo(40,35);p.lineTo(40,15);p.closePath();s.holes=[p];}return s;}
function edges(g){const p=g.getAttribute('position'),result=new Map();for(let i=0;i<p.count;i+=3)for(let j=0;j<3;j++){const a=i+j,b=i+(j+1)%3,keyA=[p.getX(a),p.getY(a),p.getZ(a)].join(','),keyB=[p.getX(b),p.getY(b),p.getZ(b)].join(',');if(keyA===keyB)continue;const key=[keyA,keyB].sort().join('|');const e=result.get(key)||{count:0,balance:0,z:[p.getZ(a),p.getZ(b)]};e.count++;e.balance+=keyA<keyB?1:-1;result.set(key,e);}return [...result.values()];}
for(const mode of ['solid','hole','hollow','hole+hollow'])for(const cap of [true,false])test(`positive extrusion half ${mode} cap=${cap} retains topology and ends at origin`,()=>{
 const g=buildMesh(shape(mode.includes('hole')),{depth:40,bevelSize:7,bevelWidth:4,bevelSegments:2,bevelContinue:true,hollow:mode.includes('hollow'),wallThickness:5,extrusionMirror:false,extrusionCap:cap});
 g.computeBoundingBox();assert.equal(g.boundingBox.min.z,0);assert.equal(g.boundingBox.max.z,20);
 const boundary=edges(g).filter(e=>e.count!==2||e.balance!==0);
 if(cap)assert.equal(boundary.length,0);else{assert.ok(boundary.length>0);assert.ok(boundary.every(e=>e.count===1&&e.z.every(z=>z===0)));}
 for(const attribute of Object.values(g.attributes))assert.ok([...attribute.array].every(Number.isFinite));
 assert.equal(g.userData.baseUVs.length,g.getAttribute('uv').array.length);assert.equal(g.userData.uvKeys.length,g.getAttribute('uv').count);
 const mesh=new Mesh(g,new MeshBasicMaterial());prepareObjectMesh(mesh,{shape:shape(),settings:{},pivot:[0,0,0],transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}});g.computeBoundingBox();assert.equal(g.boundingBox.min.z,0);g.dispose();mesh.material.dispose();
});

test('mirroring remains the default and preserves the previous mesh exactly',()=>{
 const settings={depth:40,bevelSize:7,bevelWidth:4,bevelSegments:0};
 const a=buildMesh(shape(),settings),b=buildMesh(shape(),{...settings,extrusionMirror:true,extrusionCap:false});
 for(const name of ['position','normal','uv'])assert.deepEqual(a.getAttribute(name).array,b.getAttribute(name).array);
 const mesh=new Mesh(a,new MeshBasicMaterial());prepareObjectMesh(mesh,{settings,pivot:[0,0,0]});a.computeBoundingBox();assert.equal(a.boundingBox.min.z,-20);assert.equal(a.boundingBox.max.z,20);a.dispose();b.dispose();mesh.material.dispose();
});
test('actual curved acute hollow SVG stays capped without filling its hollow region',async()=>{
 const {readFile}=await import('node:fs/promises');const {DOMParser}=await import('@xmldom/xmldom');globalThis.DOMParser=DOMParser;
 const {parseSvg}=await import('../src/geometry.js');
 const svg=await readFile(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8');
 const [entry]=parseSvg(svg).objects;
 for(const segments of [0,3]){
  const g=buildMesh(entry.shape,{depth:64.01,bevelSize:18.018,bevelWidth:15,bevelSegments:segments,bevelContinue:true,hollow:true,wallThickness:29.991,extrusionMirror:false,extrusionCap:true});
  const invalid=edges(g).filter(e=>e.count!==2||e.balance!==0);assert.equal(invalid.length,0);assert.ok(g.userData.protectedMidpointIndices.length>0);g.dispose();
 }
});

test('origin cap preserves the native hole instead of covering it',()=>{
 const g=buildMesh(shape(true),{depth:40,bevelSize:7,bevelWidth:4,bevelSegments:2,extrusionMirror:false,extrusionCap:true});
 const p=g.getAttribute('position');let area=0;
 for(let i=0;i<p.count;i+=3)if([0,1,2].every(j=>p.getZ(i+j)===0))area+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getY(i+2)-p.getY(i))-(p.getY(i+1)-p.getY(i))*(p.getX(i+2)-p.getX(i)))/2;
 assert.ok(Math.abs(area-2600)<1e-6);g.dispose();
});

test('edited nonaxis-aligned quad intersects shared edges identically from either direction',()=>{
 const outline=new Shape();outline.moveTo(-37.725486058288325,-28.786930664844235);outline.lineTo(80,-30);outline.lineTo(80,30);outline.lineTo(-40,30);outline.autoClose=true;
 for(const cap of [true,false]) {
  const g=buildMesh(outline,{depth:37,bevelSize:2.4,bevelWidth:2.4,bevelContinue:true,bevelSegments:4,bevelFullWidth:true,extrusionMirror:false,extrusionCap:cap});
  const boundary=edges(g).filter(e=>e.count!==2||e.balance!==0);
  if(cap)assert.equal(boundary.length,0);else{assert.ok(boundary.length>0);assert.ok(boundary.every(e=>e.count===1&&e.z.every(z=>z===0)));}
  g.dispose();
 }
});
