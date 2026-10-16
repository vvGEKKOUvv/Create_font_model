import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path } from 'three';
import { buildMesh, applyUvSettings, exportObj } from '../src/geometry.js';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';
function outline(hole=false){const s=new Shape();s.moveTo(0,0);s.lineTo(80,0);s.lineTo(80,60);s.lineTo(0,60);s.closePath();if(hole){const h=new Path();h.moveTo(20,20);h.lineTo(20,40);h.lineTo(60,40);h.lineTo(60,20);h.closePath();s.holes=[h];}return s;}
function checkSlots(g){const slots=g.getAttribute('surfaceSlot'),count=g.getAttribute('position').count;assert.equal(slots.count,count);assert.equal(g.groups.reduce((sum,group)=>sum+group.count,0),count);for(let i=0;i<count;i+=3){assert.equal(slots.getX(i),slots.getX(i+1));assert.equal(slots.getX(i),slots.getX(i+2));const group=g.groups.find(group=>i>=group.start&&i<group.start+group.count);assert.equal(group.materialIndex,slots.getX(i));assert.ok(g.userData.uvKeys[i].startsWith(slots.getX(i)===1?'side:':'front:'));}}
for(const mode of ['solid','hole','hollow','hole+hollow'])for(const half of [false,true])test(`material slots and UV identities survive ${mode} half=${half} and mesh reduction`,()=>{
 const settings={depth:30,bevelSize:4,bevelWidth:3,bevelSegments:1,bevelContinue:true,hollow:mode.includes('hollow'),wallThickness:5,extrusionMirror:!half,extrusionCap:true};
 const g=buildMesh(outline(mode.includes('hole')),settings);checkSlots(g);
 const p=g.getAttribute('position'),slots=g.getAttribute('surfaceSlot'),uv=g.getAttribute('uv'),sameXY=new Map();
 for(let i=0;i<p.count;i++)if(slots.getX(i)===0){const key=`${p.getX(i)},${p.getY(i)}`,value=[uv.getX(i),uv.getY(i),g.userData.uvKeys[i]];if(sameXY.has(key))assert.deepEqual(value,sameXY.get(key));else sameXY.set(key,value);}
 const reduced=reduceMeshGeometry(g,50);checkSlots(reduced);assert.notEqual(reduced,g);
 reduced.dispose();g.dispose();
});
test('region edits and transforms share front/back keys without affecting side UVs',()=>{
 const settings={depth:30,bevelSize:4,bevelWidth:3,bevelSegments:1};
 const g=buildMesh(outline(),settings),uv=g.getAttribute('uv'),slots=g.getAttribute('surfaceSlot');const before=[...uv.array];
 const key=g.userData.uvKeys.find(key=>key.startsWith('front:'));
 applyUvSettings(g,{...settings,frontUV:{uvScaleX:2,uvScaleY:3,uvOffsetX:.3},sideUV:{uvScaleX:1,uvScaleY:1},uvEdits:{[key]:[.2,.4]}});
 let edits=0;for(let i=0;i<uv.count;i++)if(slots.getX(i)===1){assert.equal(uv.getX(i),before[i*2]);assert.equal(uv.getY(i),before[i*2+1]);}else if(g.userData.uvKeys[i]===key){assert.ok(Math.abs(uv.getX(i)-.7)<1e-6);assert.ok(Math.abs(uv.getY(i)-1.2)<1e-6);edits++;}assert.ok(edits>=2);
 g.dispose();
});
test('OBJ preserves two slots per object and defines clay and transparent MTL parameters',()=>{
 const g=buildMesh(outline(),{depth:20,bevelSize:3});
 const output=exportObj([{geometry:g,surfaceMaterials:{front:{color:'#888888',type:'clay',opacity:1},side:{color:'#ffffff',type:'transparent',opacity:.25}}}]);
 assert.match(output.obj,/usemtl material_1_front/);assert.match(output.obj,/usemtl material_1_side/);
 assert.match(output.mtl,/newmtl material_1_front\n[\s\S]*?Ks 0 0 0/);assert.match(output.mtl,/newmtl material_1_side\n[\s\S]*?d 0.25\nillum 4\nNi 1.45/);g.dispose();
});

test('different legacy front and back edits resolve to one shared front island',()=>{
 const settings={depth:30,bevelSize:3},g=buildMesh(outline(),settings),slots=g.getAttribute('surfaceSlot');
 const i=Array.from({length:slots.count},(_,i)=>i).find(i=>slots.getX(i)===0),u=g.userData.baseUVs[i*2],v=g.userData.baseUVs[i*2+1];
 const front=`${(u/3).toFixed(6)},${v.toFixed(6)}`,back=`${((u+1)/3).toFixed(6)},${v.toFixed(6)}`;
 applyUvSettings(g,{...settings,uvEdits:{[front]:[.2,.4],[back]:[.7,.8]}});
 const uv=g.getAttribute('uv'),key=g.userData.uvKeys[i];let matches=0;
 for(let j=0;j<slots.count;j++)if(g.userData.uvKeys[j]===key){assert.ok(Math.abs(uv.getX(j)-.2)<1e-6);assert.ok(Math.abs(uv.getY(j)-.4)<1e-6);matches++;}
 assert.ok(matches>=2);g.dispose();
});
