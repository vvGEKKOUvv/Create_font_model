import test from 'node:test';
import assert from 'node:assert/strict';
import {Shape,Path} from 'three';
import {buildMesh,applyUvSettings} from '../src/geometry.js';
import {reduceMeshGeometry} from '../src/mesh-reduction.js';
function outline(hole=false){const s=new Shape();s.moveTo(0,0);s.lineTo(120,0);s.lineTo(120,40);s.lineTo(0,40);s.closePath();if(hole){const h=new Path();h.moveTo(20,10);h.lineTo(20,30);h.lineTo(100,30);h.lineTo(100,10);h.closePath();s.holes=[h];}return s;}
function spans(g){const uv=g.getAttribute('uv'),slots=g.getAttribute('surfaceSlot');const us=[],vs=[];for(let i=0;i<uv.count;i++)if(!slots.getX(i)){us.push(uv.getX(i));vs.push(uv.getY(i));}return [Math.max(...us)-Math.min(...us),Math.max(...vs)-Math.min(...vs)];}
for(const mode of ['solid','hollow','hole+hollow','half-cap'])test(`front UV contain preserves aspect and shared projection for ${mode}`,()=>{
 const settings={depth:20,bevelSize:3,bevelWidth:3,bevelSegments:1,hollow:mode.includes('hollow'),wallThickness:3,extrusionMirror:mode!=='half-cap',extrusionCap:true,frontUVFit:'contain'};
 const g=buildMesh(outline(mode.includes('hole')),settings),position=g.getAttribute('position'),uv=g.getAttribute('uv'),slot=g.getAttribute('surfaceSlot');
 const [u,v]=spans(g);assert.ok(Math.abs(u/v-3)<1e-5);
 const xy=new Map();for(let i=0;i<uv.count;i++)if(!slot.getX(i)){const key=`${position.getX(i)},${position.getY(i)}`,value=[uv.getX(i),uv.getY(i)];if(xy.has(key))assert.deepEqual(value,xy.get(key));else xy.set(key,value);}
 const reduced=reduceMeshGeometry(g,20);assert.equal(reduced.userData.frontUVFit,'contain');applyUvSettings(reduced,{...settings,frontUVFit:'stretch'});const [ru,rv]=spans(reduced);assert.ok(Math.abs(ru-rv)<1e-6);reduced.dispose();g.dispose();
});
test('front UV fit switches without changing geometry or side UVs and restores original values',()=>{
 const g=buildMesh(outline(),{depth:20,bevelSize:3}),position=g.getAttribute('position'),uv=g.getAttribute('uv'),slot=g.getAttribute('surfaceSlot'),before=uv.array.slice(),keys=[...g.userData.uvKeys];
 applyUvSettings(g,{frontUVFit:'contain'});assert.equal(g.getAttribute('position'),position);for(let i=0;i<uv.count;i++)if(slot.getX(i)===1)assert.deepEqual([...uv.array.slice(i*2,i*2+2)],[...before.slice(i*2,i*2+2)]);
 for(let n=0;n<10;n++){applyUvSettings(g,{frontUVFit:'stretch'});applyUvSettings(g,{frontUVFit:'contain'});}
 applyUvSettings(g,{frontUVFit:'stretch'});assert.deepEqual(uv.array,before);assert.deepEqual(g.userData.uvKeys,keys);g.dispose();
});
