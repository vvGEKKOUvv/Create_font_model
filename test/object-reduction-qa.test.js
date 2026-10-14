import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path, Mesh, Vector3, Raycaster, MeshBasicMaterial, DoubleSide } from 'three';
import { buildMesh, exportObj, applyUvSettings } from '../src/geometry.js';
import { reduceMeshGeometry } from '../src/mesh-reduction.js';
import { prepareObjectMesh } from '../src/transform-tools.js';

function polygon(points) {
  const shape = new Shape();
  points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y));
  shape.closePath();
  return shape;
}
function assertManifold(geometry) {
  const p = geometry.attributes.position, edges = new Map();
  const key = i => [p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
  for (let i=0;i<p.count;i+=3) for (const [a,b] of [[i,i+1],[i+1,i+2],[i+2,i]]) {
    const ka=key(a),kb=key(b), k=[ka,kb].sort().join('|');
    assert.notEqual(ka,kb,'no collapsed triangle edge');
    const e=edges.get(k)||[0,0];e[0]++;e[1]+=ka<kb?1:-1;edges.set(k,e);
  }
  for (const [count,direction] of edges.values()) { assert.equal(count,2,'closed edge');assert.equal(direction,0,'oriented edge'); }
  for(const name of ['position','normal','uv']) assert.ok([...geometry.attributes[name].array].every(Number.isFinite),name);
}
function assertExport(geometry) {
  assert.equal(geometry.userData.uvKeys.length,geometry.attributes.position.count);
  assert.equal(geometry.userData.baseUVs.length,geometry.attributes.uv.array.length);
  applyUvSettings(geometry,{uvScale:1.25,uvRotation:17,uvEdits:{[geometry.userData.uvKeys[0]]:[.2,.4]}});
  const {obj}=exportObj([{name:'QA',geometry}]);
  assert.ok(!/NaN|Infinity/.test(obj));
  const count=obj.split('\n').filter(l=>l.startsWith('v ')).length;
  for(const line of obj.split('\n').filter(l=>l.startsWith('f '))) for(const index of line.slice(2).split(' ').flatMap(v=>v.split('/'))) assert.ok(Number(index)>=1&&Number(index)<=count);
}

test('depth rebuild expands around stable transformed object origin and exported center',()=>{
  const shape=polygon([[10,20],[70,20],[70,60],[10,60]]);
  for(const pivot of [undefined,[40,-40,12]]) {
    const object={pivot,transform:{position:[7,9,11],rotation:[0,0,.2],scale:[1,1,2]}};
    let fixedCenter;
    for(const depth of [8,40,12]) {
      const mesh=new Mesh(buildMesh(shape,{depth,bevelSize:0}));
      prepareObjectMesh(mesh,object);mesh.geometry.computeBoundingBox();
      const box=mesh.geometry.boundingBox;
      assert.equal(box.min.z,-depth/2);assert.equal(box.max.z,depth/2);
      const center=new Vector3(0,0,0).applyMatrix4(mesh.matrix).toArray();
      fixedCenter ||= center;assert.deepEqual(center,fixedCenter);
      const {obj}=exportObj([{geometry:mesh.geometry,matrix:mesh.matrix}]);
      const zs=obj.split('\n').filter(l=>l.startsWith('v ')).map(l=>Number(l.split(' ')[3]));
      assert.equal((Math.min(...zs)+Math.max(...zs))/2,center[2]);
      assert.equal(Math.max(...zs)-Math.min(...zs),depth*2);
      assertManifold(mesh.geometry);
    }
  }
});

function rayThrough(geometry,x,y) {
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));
  return new Raycaster(new Vector3(x,y,-100),new Vector3(0,0,1)).intersectObject(mesh).length;
}
test('smooth extruded object actually reduces faces without changing input, boundary or UV export',()=>{
  const points=Array.from({length:128},(_,i)=>[50*Math.cos(i*Math.PI/64),50*Math.sin(i*Math.PI/64)]);
  for(const hollow of [false,true]) {
    const source=buildMesh(polygon(points),{depth:24,bevelSize:3,bevelWidth:3,bevelSegments:8,bevelContinue:false,hollow,wallThickness:8});
    const original=source.attributes.position.array.slice();
    const reduced=reduceMeshGeometry(source,50);
    assert.ok(reduced.attributes.position.count<source.attributes.position.count*.75,'meaningful reduction on real extruded curves');
    assert.deepEqual(source.attributes.position.array,original);
    assertManifold(reduced);assertExport(reduced);
    source.computeBoundingBox();reduced.computeBoundingBox();
    assert.deepEqual(reduced.boundingBox,source.boundingBox,'outline extents and extrusion remain');
    assert.equal(rayThrough(reduced,0,0)>0,!hollow,'center cavity remains open');
  }
});
test('reduced native-hole hollow object retains both disconnected walls and open cavities',()=>{
  const shape=polygon([[-30,-30],[30,-30],[30,30],[-30,30]]);
  const hole=new Path();hole.moveTo(-10,-10);hole.lineTo(-10,10);hole.lineTo(10,10);hole.lineTo(10,-10);hole.closePath();shape.holes.push(hole);
  const source=buildMesh(shape,{depth:20,bevelSize:1,bevelWidth:1,bevelSegments:5,bevelContinue:false,hollow:true,wallThickness:4});
  for(const amount of [20,90]) {
    const reduced=reduceMeshGeometry(source,amount);assertManifold(reduced);assertExport(reduced);
    for(const x of [0,20]) assert.equal(rayThrough(reduced,x,0),0,'native hole and new cavity stay open');
    for(const x of [12,28]) assert.ok(rayThrough(reduced,x,0)>0,'both independently closed walls survive');
  }
});
test('sharp beveled arrow tips survive high reduction with finite editable UV and closed faces',()=>{
  const shape=polygon([[0,0],[80,0],[100,20],[80,40],[0,40],[20,20]]);
  const source=buildMesh(shape,{depth:20,bevelSize:4,bevelWidth:3,bevelSegments:6,bevelContinue:false});
  const reduced=reduceMeshGeometry(source,90);assertManifold(reduced);assertExport(reduced);
  const p=reduced.attributes.position;
  assert.ok(Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i)]).some(([x,y])=>x===100&&y===-20),'tip retained');
});
