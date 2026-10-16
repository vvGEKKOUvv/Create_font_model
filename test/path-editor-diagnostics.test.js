import test from 'node:test';
import assert from 'node:assert/strict';
import {Shape,Vector2} from 'three';
import {diagnoseDraft,validateDraft,repairDraft,simplifyDraft,createObjectDrafts,resetReferenceDraft,toImportEntry,moveDraftPoint} from '../src/path-editor-model.js';
import {snapshotDraft,createDraftHistory} from '../src/path-editor-history.js';
const contour=coords=>({closed:true,points:coords.map(([x,y])=>({x,y}))});
const square=(x=0,y=0,size=20)=>contour([[x,y],[x+size,y],[x+size,y+size],[x,y+size]]);
const draft=(...contours)=>({contours,edited:false});

test('editor diagnoses original self-crossing edge indices and exact intersection position',()=>{
  const d=draft(contour([[0,0],[20,20],[0,20],[20,0]]));
  const result=validateDraft(d),issue=result.issues.find(i=>i.type==='self-crossing');
  assert.equal(result.valid,false);assert.match(result.errors.join(' '),/輪郭1の辺1.*輪郭1の辺3/);
  assert.deepEqual(issue.edges,[{contourIndex:0,edgeIndex:0},{contourIndex:0,edgeIndex:2}]);
  assert.deepEqual(issue.points,[{x:10,y:10}]);
});
test('editor distinguishes crossings between rings, outside holes and nested holes',()=>{
  assert(validateDraft(draft(square(),square(15,5,10))).issues.some(i=>i.type==='contour-crossing'));
  assert(validateDraft(draft(square(),square(30,5,5))).issues.some(i=>i.type==='outside-hole'));
  assert(validateDraft(draft(square(),square(2,2,15),square(4,4,3))).issues.some(i=>i.type==='nested-hole'));
  assert.equal(validateDraft(draft(square(),square(3,3,4),square(12,12,4))).valid,true);
});
test('diagnostic scan is bounded and vertex overflow still exposes crossing locations',()=>{
  const ring=contour(Array.from({length:3001},(_,i)=>[Math.cos(i/3001*Math.PI*2),Math.sin(i/3001*Math.PI*2)]));
  const overflow=diagnoseDraft(draft(ring));assert(overflow.issues.some(i=>i.type==='vertex-limit'));assert(overflow.comparisonCount<=250001);
  const crossing=diagnoseDraft(draft(contour([[0,0],[20,20],[0,20],[20,0]]),ring));
  assert(crossing.issues.some(i=>i.type==='self-crossing'&&i.edges.length===2));assert(crossing.comparisonCount<=250001);
  const bounded=diagnoseDraft(draft(square(),square(3,3,4)),{maxComparisons:1});
  assert.equal(bounded.complete,false);assert(bounded.comparisonCount<=2);assert(bounded.issues.some(i=>i.type==='complexity'));
});
test('invalid source simplification explains repair requirement and leaves source untouched',()=>{
  const d=draft(contour([[0,0],[20,20],[0,20],[20,0]])),before=JSON.stringify(d);
  const result=simplifyDraft(d,100);assert.equal(result.applied,false);assert.match(result.errors.join(' '),/リダクションは交差の修復には使えません/);assert.equal(JSON.stringify(d),before);
});
test('explicit repair removes zero-width spike while preserving separate inner hole',()=>{
  const d=draft(contour([[0,0],[20,0],[20,20],[10,20],[10,25],[10,20],[0,20]]),square(3,3,4));
  assert.equal(validateDraft(d).valid,false);
  const result=repairDraft(d);assert.equal(result.applied,true);assert.equal(result.valid,true);assert.equal(d.contours.length,2);
  assert.equal(d.contours[0].points.length,4);assert.equal(d.contours[1].points.length,4);assert.equal(d.edited,true);
  const hole=d.contours[1].points;assert.equal(Math.min(...hole.map(p=>p.x)),3);assert.equal(Math.max(...hole.map(p=>p.x)),7);
});
test('repair refuses split bowtie, outer-hole crossing and nested holes without changes',()=>{
  for(const d of [draft(contour([[0,0],[20,20],[0,20],[20,0]])),draft(square(),square(15,5,10)),draft(square(),square(2,2,15),square(4,4,3))]){
    const before=JSON.stringify(d),result=repairDraft(d);assert.equal(result.applied,false);assert(result.message);assert.equal(JSON.stringify(d),before);
  }
});
test('repair cleans duplicate zero-length edges explicitly and is a no-op on valid geometry',()=>{
  const d=draft(contour([[0,0],[20,0],[20,0],[20,20],[0,20]]));
  assert(validateDraft(d).issues.some(i=>i.type==='duplicate'));assert.equal(repairDraft(d).applied,true);assert.equal(d.contours[0].points.length,4);
  const before=JSON.stringify(d);assert.equal(repairDraft(d).applied,false);assert.equal(JSON.stringify(d),before);
});
test('reference restore preserves original Bezier curve and supports existing editor undo history',()=>{
  const reference=new Shape();reference.moveTo(0,0);reference.bezierCurveTo(0,20,20,20,20,0);reference.lineTo(0,0);
  const start=new Shape([new Vector2(0,0),new Vector2(20,0),new Vector2(20,20),new Vector2(0,20)]);
  const [d]=createObjectDrafts([{id:'a',name:'a',shape:start,referenceShape:reference}]);
  moveDraftPoint(d,0,1,22,0);const before=snapshotDraft(d),history=createDraftHistory();
  assert.equal(resetReferenceDraft(d).applied,true);history.record(0,before,snapshotDraft(d));
  assert.equal(toImportEntry(d).shape,reference);history.undo([d]);assert.equal(d.contours[0].points[1].x,22);
  history.redo([d]);assert.equal(toImportEntry(d).shape,reference);
});
