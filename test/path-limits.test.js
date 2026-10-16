import test from 'node:test';
import assert from 'node:assert/strict';
import {Shape,Vector2} from 'three';
import {buildMesh} from '../src/geometry.js';
import {inspectImportPath} from '../src/import-reduction.js';
import {PATH_VERTEX_LIMIT,EDITOR_RAW_VERTEX_LIMIT} from '../src/path-limits.js';
const circle=n=>new Shape(Array.from({length:n},(_,i)=>new Vector2(100*Math.cos(i/n*Math.PI*2),100*Math.sin(i/n*Math.PI*2))));
test('expanded path budget builds 5000 source vertices without requiring a bevel',()=>{
 const shape=circle(5000);assert.equal(inspectImportPath(shape).overBudget,false);
 const g=buildMesh(shape,{depth:20,bevelSize:0,bevelWidth:0,bevelSegments:0});
 assert.equal(g.userData.reducedCount,5000);assert.ok(g.getAttribute('position').count>5000);
 assert.ok([...g.getAttribute('position').array].every(Number.isFinite));g.dispose();
});
test('shared input limits keep consent above 6000 and raw editing bounded at 40000',()=>{
 assert.equal(PATH_VERTEX_LIMIT,6000);assert.equal(EDITOR_RAW_VERTEX_LIMIT,40000);
 assert.equal(inspectImportPath(circle(6001)).overBudget,true);
});
