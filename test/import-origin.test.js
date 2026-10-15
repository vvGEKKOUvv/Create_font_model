import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path, Vector2, Box2 } from 'three';
import { centerImportedPaths } from '../src/import-origin.js';
import { createObjectDrafts, toImportEntry, moveDraftPoint } from '../src/path-editor-model.js';

test('import batch shares a centered origin without flattening curves or moving relative layout', () => {
  const a = new Shape(); a.moveTo(100,200); a.bezierCurveTo(110,200,120,210,120,220); a.lineTo(100,220); a.closePath();
  const b = new Shape([new Vector2(140,200),new Vector2(160,200),new Vector2(160,220),new Vector2(140,220)]);
  const entries = centerImportedPaths([{shape:a,id:'a'},{shape:b,id:'b'}]);
  assert.equal(entries[0].shape.curves[0].type,'CubicBezierCurve');
  assert.deepEqual(a.curves[0].v0.toArray(),[100,200]);
  const bounds = new Box2().setFromPoints(entries.flatMap(e=>e.shape.extractPoints(24).shape));
  assert.ok(bounds.getCenter(new Vector2()).length()<1e-10);
  assert.deepEqual(entries.map(e=>e.pivot),[[0,0,0],[0,0,0]]);
  assert.equal(entries[1].shape.getPoint(0).x-entries[0].shape.getPoint(0).x,40);
});
test('import centering translates hole and ellipse centers only once', () => {
  const a=new Shape(); a.absellipse(100,200,20,10,0,Math.PI*2,false,0);
  const hole=new Path(); hole.absellipse(100,200,5,3,0,Math.PI*2,true,0); a.holes=[hole];
  const [{shape}]=centerImportedPaths([{shape:a}]);
  assert.equal(shape.curves[0].aX,0); assert.equal(shape.curves[0].aY,0);
  assert.equal(shape.holes[0].curves[0].aX,0); assert.equal(a.curves[0].aX,100);
});
test('existing object drafts retain stable IDs and unchanged curve geometry', () => {
  const shape=new Shape();shape.moveTo(0,0);shape.bezierCurveTo(2,0,10,8,10,10);shape.lineTo(0,10);shape.closePath();
  const original={id:'stable',name:'custom',shape,layerName:'layer',color:'#ababab'};
  const [draft]=createObjectDrafts([original]);
  assert.equal(toImportEntry(draft).shape,shape); assert.equal(toImportEntry(draft).id,'stable');
  moveDraftPoint(draft,0,1,2,1);
  assert.notEqual(toImportEntry(draft).shape,shape); assert.equal(shape.curves[0].v0.x,0);
});
