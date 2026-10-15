import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {setTransformAxis, applyTransformDelta} from '../src/transform-tools.js';
const object = (offset) => ({transform:{position:[offset,2,3],rotation:[.1,.2,.3],scale:[1,2,3]}});
test('multi selection shares only the numeric field being edited', () => {
 const a=object(4), b=object(9);
 setTransformAxis([a,b], 'position', 0, 12);
 assert.deepEqual(a.transform.position,[12,2,3]);
 assert.deepEqual(b.transform.position,[12,2,3]);
 assert.deepEqual(b.transform.scale,[1,2,3]);
 setTransformAxis([a,b], 'rotation', 1, 90);
 assert.equal(a.transform.rotation[1],Math.PI/2);
 assert.deepEqual(b.transform.rotation,[.1,Math.PI/2,.3]);
 setTransformAxis([a,b], 'scale', 2, 0);
 assert.deepEqual(b.transform.scale,[1,2,.01]);
});
test('translation manipulator preserves the other selected object offset', () => {
 const mesh = new THREE.Mesh();mesh.position.set(5,7,3);
 applyTransformDelta([mesh], new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(3,4,0));
 assert.deepEqual(mesh.position.toArray(),[8,11,3]);
});
test('rotation and scaling manipulator transform around active object pivot', () => {
 const mesh=new THREE.Mesh();mesh.position.set(4,0,0);
 const before=new THREE.Matrix4().makeTranslation(2,0,0);
 const after=new THREE.Matrix4().compose(new THREE.Vector3(2,0,0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2),new THREE.Vector3(2,2,2));
 applyTransformDelta([mesh],before,after);
 assert.ok(mesh.position.distanceTo(new THREE.Vector3(2,4,0))<1e-10);
 assert.ok(Math.abs(mesh.rotation.z-Math.PI/2)<1e-10);
 assert.deepEqual(mesh.scale.toArray(),[2,2,2]);
});
