import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh,applyUvSettings,exportObj } from '../src/geometry.js';
const rectangle=()=>{const s=new Shape();s.moveTo(0,0);s.lineTo(100,0);s.lineTo(100,80);s.lineTo(0,80);s.closePath();return s;};
const settings={depth:30,bevelSize:5,bevelWidth:3,bevelSegments:1,bevelContinue:true};
for(const hollow of [false,true])test(`QA: actual cap/bevel and wall draw groups have independent UVs (hollow=${hollow})`,()=>{
 const g=buildMesh(rectangle(),{...settings,hollow,wallThickness:10}),p=g.getAttribute('position'),slots=g.getAttribute('surfaceSlot'),uv=g.getAttribute('uv');
 assert.equal(slots.count,p.count);assert(g.groups.some(x=>x.materialIndex===0));assert(g.groups.some(x=>x.materialIndex===1));let covered=0;
 for(const group of g.groups){assert.equal(group.start,covered);assert.equal(group.count%3,0);for(let i=group.start;i<group.start+group.count;i++)assert.equal(slots.getX(i),group.materialIndex);covered+=group.count;}assert.equal(covered,p.count);
 const before=Array.from(uv.array),positions=Array.from(p.array);
 applyUvSettings(g,{frontUV:{uvScaleX:1.7,uvOffsetX:.2}});
 let frontChanged=0,wallCount=0;
 for(let i=0;i<p.count;i++)if(slots.getX(i)===1){assert.equal(uv.getX(i),before[i*2]);assert.equal(uv.getY(i),before[i*2+1]);wallCount++;}else if(Math.abs(uv.getX(i)-before[i*2])>1e-5)frontChanged++;
 assert(frontChanged>0&&wallCount>0);const frontOnly=Array.from(uv.array);
 applyUvSettings(g,{frontUV:{uvScaleX:1.7,uvOffsetX:.2},sideUV:{uvScaleX:.7,uvOffsetX:-.1}});
 let sideChanged=0;
 for(let i=0;i<p.count;i++)if(slots.getX(i)===0){assert.equal(uv.getX(i),frontOnly[i*2]);assert.equal(uv.getY(i),frontOnly[i*2+1]);}else if(Math.abs(uv.getX(i)-frontOnly[i*2])>1e-5)sideChanged++;
 assert(sideChanged>0);assert.deepEqual(Array.from(p.array),positions,'UV edits do not change actual mesh positions');
 const points=new Map();let mirrored=0;
 for(let i=0;i<p.count;i++){const prefix=slots.getX(i)===1?'side:':'front:';assert(g.userData.uvKeys[i].startsWith(prefix));if(slots.getX(i)!==0)continue;const key=[p.getX(i),p.getY(i)].map(v=>v.toFixed(5)).join(','),entries=points.get(key)??[];entries.push(i);points.set(key,entries);}
 for(const indices of points.values())for(const i of indices)for(const j of indices)if(Math.abs(p.getZ(i)-p.getZ(j))>settings.depth/2){assert.equal(g.userData.uvKeys[i],g.userData.uvKeys[j],'front and back overlap the same UV key');assert.equal(uv.getX(i),uv.getX(j));assert.equal(uv.getY(i),uv.getY(j));mirrored++;}
 assert(mirrored>0,'actual front and back surface corners sampled');g.dispose();
});

test('QA: OBJ faces select the matching per-region material including opacity',()=>{
 const geometry=buildMesh(rectangle(),settings),surfaceMaterials={front:{color:'#ff0000',type:'metal',opacity:.65},side:{color:'#0000ff',type:'clay',opacity:.9}};
 const {obj,mtl}=exportObj([{name:'surface',geometry,surfaceMaterials}]);const materialFaces=new Map();let active;
 for(const line of obj.split('\n'))if(line.startsWith('usemtl '))active=line.slice(7);else if(line.startsWith('f '))materialFaces.set(active,(materialFaces.get(active)??0)+1);
 const slots=geometry.getAttribute('surfaceSlot'),counts=[0,0];for(let i=0;i<slots.count;i+=3)counts[slots.getX(i)]++;
 assert.equal(materialFaces.get('material_1_front'),counts[0]);assert.equal(materialFaces.get('material_1_side'),counts[1]);assert.match(mtl,/newmtl material_1_front\nKd 1 0 0[\s\S]*?\nd 0\.65\n/);assert.match(mtl,/newmtl material_1_side\nKd 0 0 1[\s\S]*?\nd 0\.9\n/);geometry.dispose();
});
