import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDraft, createDraftHistory } from '../src/path-editor-history.js';
const make = () => ({ name:'Path', enabled:true, edited:false, originalShape:{ curves:['bezier'] }, originalContours:[], contours:[{closed:false,points:[{x:0,y:0},{x:2,y:0},{x:2,y:2}]}] });
test('draft undo restores curves by reference, contour edits and enabled/name without touching originals', () => {
  const draft=make(), shape=draft.originalShape, contours=draft.originalContours, history=createDraftHistory(), before=snapshotDraft(draft);
  draft.name='Edited'; draft.enabled=false; draft.edited=true; draft.contours[0].closed=true; draft.contours[0].points[0].x=7;
  const after=snapshotDraft(draft); history.record(0,before,after);
  assert.equal(history.undo([draft]),0); assert.deepEqual(snapshotDraft(draft),before); assert.equal(draft.originalShape,shape); assert.equal(draft.originalContours,contours);
  draft.contours[0].points[0].x=22; // Restored live data must not mutate retained snapshots.
  history.redo([draft]); assert.deepEqual(snapshotDraft(draft),after);
  history.undo([draft]); assert.deepEqual(snapshotDraft(draft),before);
});
test('history preserves other drafts, ignores no-ops, branches redo and bounds retained edits', () => {
  const drafts=[make(),make()], history=createDraftHistory(2);
  const edit=(index,name)=>{const before=snapshotDraft(drafts[index]); drafts[index].name=name; return history.record(index,before,snapshotDraft(drafts[index]));};
  assert.equal(edit(0,'Path'),false); assert.equal(history.canUndo,false);
  edit(0,'A'); edit(1,'B'); edit(1,'C');
  assert.equal(history.undo(drafts),1); assert.equal(drafts[1].name,'B'); assert.equal(history.undo(drafts),1); assert.equal(drafts[1].name,'Path'); assert.equal(history.undo(drafts),null); assert.equal(drafts[0].name,'A');
  assert.equal(history.canRedo,true); edit(0,'Branch'); assert.equal(history.canRedo,false); assert.equal(history.redo(drafts),null);
});
