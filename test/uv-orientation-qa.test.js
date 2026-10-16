import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path } from 'three';
import { buildMesh, applyUvSettings, exportObj } from '../src/geometry.js';

function outline(hole=false) {
  const shape=new Shape(); shape.moveTo(0,0);shape.lineTo(120,0);shape.lineTo(120,60);shape.lineTo(0,60);shape.closePath();
  if(hole){const path=new Path();path.moveTo(40,20);path.lineTo(40,40);path.lineTo(80,40);path.lineTo(80,20);path.closePath();shape.holes=[path];}
  return shape;
}
const near=(a,b,message)=>assert(Math.abs(a-b)<2e-6,`${message}: ${a} vs ${b}`);
for(const mode of ['solid','hollow','compound-hollow','half-cap'])for(const fit of ['stretch','contain']) {
  test(`QA front UV faces up in mesh and OBJ: ${mode}, ${fit}`,()=>{
    const settings={depth:30,bevelSize:4,bevelWidth:3,bevelSegments:1,wallThickness:6,hollow:mode.includes('hollow'),extrusionMirror:mode!=='half-cap',extrusionCap:true,frontUVFit:fit};
    const geometry=buildMesh(outline(mode==='compound-hollow'),settings);
    const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),slots=geometry.getAttribute('surfaceSlot');
    const front=[];for(let i=0;i<p.count;i++)if(slots.getX(i)===0)front.push(i);
    assert(front.length>0);
    const bottom=front.reduce((a,b)=>p.getY(a)<p.getY(b)?a:b),top=front.reduce((a,b)=>p.getY(a)>p.getY(b)?a:b);
    assert(uv.getY(top)>uv.getY(bottom),'top of rendered model must be above bottom in UV space');
    const ySpan=p.getY(top)-p.getY(bottom),vSpan=uv.getY(top)-uv.getY(bottom);
    for(const i of front)near(uv.getY(i),uv.getY(bottom)+(p.getY(i)-p.getY(bottom))/ySpan*vSpan,'all front/bevel/cap vertices use the same upward projection');
    const xy=new Map();let overlaps=0;
    for(const i of front){const key=`${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)}`,previous=xy.get(key);if(previous!==undefined&&Math.abs(p.getZ(previous)-p.getZ(i))>settings.depth/2){near(uv.getX(i),uv.getX(previous),'front/back U overlap');near(uv.getY(i),uv.getY(previous),'front/back V overlap');overlaps++;}else xy.set(key,i);}
    if(mode!=='half-cap')assert(overlaps>0,'front and back overlap is exercised');
    const {obj}=exportObj([{name:'orientation',geometry}]);
    const vertices=obj.split('\n').filter(line=>line.startsWith('v ')).map(line=>line.split(' ').slice(1).map(Number));
    const texcoords=obj.split('\n').filter(line=>line.startsWith('vt ')).map(line=>line.split(' ').slice(1).map(Number));
    let region,checked=0;
    for(const line of obj.split('\n')){if(line.startsWith('usemtl '))region=line.endsWith('_front')?'front':'side';else if(region==='front'&&line.startsWith('f '))for(const vertex of line.slice(2).split(' ')){const [pi,ti]=vertex.split('/').map(Number);near(texcoords[ti-1][1],uv.getY(bottom)+(vertices[pi-1][1]-p.getY(bottom))/ySpan*vSpan,'OBJ vt V follows exported position Y');checked++;}}
    assert(checked>0);
    const before=Array.from(uv.array);
    applyUvSettings(geometry,{...settings,frontUVFit:fit==='stretch'?'contain':'stretch'});
    let sideCount=0;for(let i=0;i<p.count;i++)if(slots.getX(i)===1){near(uv.getX(i),before[i*2],'side U unchanged');near(uv.getY(i),before[i*2+1],'side V unchanged');sideCount++;}assert(sideCount>0,'side mapping remains separate');
    geometry.dispose();
  });
}
