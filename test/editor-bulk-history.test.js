import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDraft,createDraftHistory} from '../src/path-editor-history.js';
import {matchSourceOriginalNames} from '../src/source-name-links.js';
const make=()=>({name:'Path',enabled:true,edited:false,contours:[{closed:true,points:[{x:0,y:0},{x:2,y:0},{x:2,y:2}]}]});
test('bulk draft changes and per-path reduction failures undo and redo as one action',()=>{
  const drafts=[make(),make(),make()],history=createDraftHistory(),before=drafts.map(snapshotDraft);
  drafts[0].contours[0].points[1].x=3;drafts[0].edited=true;
  drafts[1].reductionError='輪郭1の辺1と辺3が交差しています。';
  const changes=drafts.map((draft,index)=>({index,before:before[index],after:snapshotDraft(draft)}));
  assert.equal(history.recordBatch(changes,1),true);assert.equal(history.undo(drafts),1);
  assert.deepEqual(drafts.map(snapshotDraft),before);assert.equal(history.canUndo,false);
  assert.equal(history.redo(drafts),1);assert.equal(drafts[0].contours[0].points[1].x,3);assert.match(drafts[1].reductionError,/交差/);
  assert.deepEqual(snapshotDraft(drafts[2]),before[2]);
});
test('no-op batch preserves redo while changed batch branches redo',()=>{
  const drafts=[make()],history=createDraftHistory(),before=snapshotDraft(drafts[0]);
  drafts[0].name='new';history.record(0,before,snapshotDraft(drafts[0]));history.undo(drafts);
  assert.equal(history.recordBatch([{index:0,before,after:before}]),false);assert.equal(history.canRedo,true);
  drafts[0].reductionError='failure';history.recordBatch([{index:0,before,after:snapshotDraft(drafts[0])}]);assert.equal(history.canRedo,false);
});
test('original-name linking uses exact names rather than renamed display names or layer order',()=>{
  const result=matchSourceOriginalNames([{id:'a',name:'renamed',sourceOriginalName:'A'},{id:'b',sourceOriginalName:'B'}],[{sourceOriginalName:'B'},{sourceOriginalName:'A'}]);
  assert.deepEqual(result.matches,[{objectId:'a',incomingIndex:1},{objectId:'b',incomingIndex:0}]);assert.deepEqual(result.ambiguousNames,[]);
});
test('original-name linking never guesses duplicate, missing, whitespace-only or nonexact names',()=>{
  const result=matchSourceOriginalNames([{id:'a',sourceOriginalName:'A'},{id:'b',sourceOriginalName:'A'},{id:'c',sourceOriginalName:'B'},{id:'d',name:'Display'},{id:'e',sourceOriginalName:' C '},{id:'f',sourceOriginalName:'   '}],[{sourceOriginalName:'A'},{sourceOriginalName:'B'},{sourceOriginalName:'B'},{sourceOriginalName:'Display'},{sourceOriginalName:'C'},{sourceOriginalName:'   '}]);
  assert.deepEqual(result.matches,[]);assert.deepEqual(result.ambiguousNames,['A','B']);
});
