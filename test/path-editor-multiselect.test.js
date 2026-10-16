import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteDraftPoints} from '../src/path-editor-model.js';
import {snapshotDraft,createDraftHistory} from '../src/path-editor-history.js';
const contour=n=>({closed:true,points:Array.from({length:n},(_,i)=>({x:i,y:i%2}))});
const draft=(...counts)=>({id:'a',name:'test',enabled:true,edited:false,contours:counts.map(contour)});
test('multiple vertex deletion uses original indices and deduplicates selection',()=>{
 const d=draft(6);const result=deleteDraftPoints(d,[{ci:0,pi:1},{ci:0,pi:3},{ci:0,pi:1}]);
 assert.deepEqual(d.contours[0].points.map(p=>p.x),[0,2,4,5]);assert.equal(result.deletedPoints,2);
});
test('collapsed hole is removed without removing outer contour',()=>{
 const d=draft(5,3);const result=deleteDraftPoints(d,[{ci:1,pi:1}]);
 assert.equal(d.contours.length,1);assert.equal(d.enabled,true);assert.equal(result.removedContours,1);
});
test('collapsed outer removes whole compound path and undo restores it',()=>{
 const d=draft(3,4),history=createDraftHistory(),before=snapshotDraft(d);
 const result=deleteDraftPoints(d,[{ci:0,pi:0}]);
 history.record(0,before,snapshotDraft(d));assert.equal(result.removedPath,true);assert.equal(d.deleted,true);assert.equal(d.enabled,false);assert.deepEqual(d.contours,[]);
 history.undo([d]);assert.equal(d.enabled,true);assert.equal(d.deleted,false);assert.deepEqual(d.contours.map(c=>c.points.length),[3,4]);
 history.redo([d]);assert.equal(d.deleted,true);assert.equal(d.contours.length,0);
});
test('invalid selection leaves draft untouched',()=>{
 const d=draft(4),before=snapshotDraft(d);deleteDraftPoints(d,[{ci:4,pi:0},{ci:0,pi:-1}]);assert.deepEqual(snapshotDraft(d),before);
});
