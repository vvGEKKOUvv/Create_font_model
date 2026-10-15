import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh, exportObj } from '../src/geometry.js';

test('OBJ hollow ridge faces share position indices while preserving UV and hard normal seams', () => {
  const shape = new Shape(); shape.moveTo(0,0); shape.lineTo(100,0); shape.lineTo(100,80); shape.lineTo(0,80); shape.closePath();
  const geometry = buildMesh(shape, { hollow:true, wallThickness:8, depth:30, bevelSize:5, bevelWidth:4, bevelSegments:2, bevelContinue:true });
  const {obj} = exportObj([{name:'first',geometry},{name:'second',geometry}]);
  const positions=[], normals=[], uvs=[], objects=[];
  let faces;
  for(const line of obj.split('\n')) {
    if(line.startsWith('v '))positions.push(line);
    if(line.startsWith('vt '))uvs.push(line);
    if(line.startsWith('vn '))normals.push(line);
    if(line.startsWith('o ')){faces=[];objects.push(faces);}
    if(line.startsWith('f '))faces.push(line.slice(2).split(' ').map(c=>c.split('/').map(Number)));
  }
  assert.ok(positions.length < geometry.attributes.position.count * 2);
  assert.equal(uvs.length,geometry.attributes.uv.count*2);
  assert.equal(normals.length,geometry.attributes.normal.count*2);
  const used=[];
  for(const faces of objects){
    const edges=new Map(), seams=new Map(), ids=new Set();
    for(const face of faces){
      for(const [v,uv,n]of face){assert.ok(v>=1&&v<=positions.length);assert.ok(uv>=1&&uv<=uvs.length);assert.ok(n>=1&&n<=normals.length);ids.add(v);const set=seams.get(v)||new Set();set.add(normals[n-1]);seams.set(v,set);}
      for(let i=0;i<3;i++){const a=face[i][0],b=face[(i+1)%3][0];assert.notEqual(a,b);const key=[a,b].sort((x,y)=>x-y).join(',');const e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}
    }
    for(const [count,winding]of edges.values()){assert.equal(count,2,'exported faces share a single edge by index');assert.equal(winding,0);}
    assert.ok([...seams.values()].some(ns=>ns.size>1),'welded positions retain distinct hard normals');
    used.push(ids);
  }
  assert.ok([...used[0]].every(id=>!used[1].has(id)),'separate objects keep separate vertices');
  geometry.dispose();
});
