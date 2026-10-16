import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Vector2 } from 'three';
import { createSourceReference, alignReloadEntries, planSourceReload, replaceReferencedPath, validateRelinkMatches } from '../src/source-reference.js';
import { createObjectDrafts, toImportEntry } from '../src/path-editor-model.js';
const entry = (id,x=100,layer='A') => ({id,name:id,sourceElementId:id,sourceShapeIndex:0,sourceKey:JSON.stringify([[layer],id,0]),layerName:layer,shape:new Shape([new Vector2(x,100),new Vector2(x+20,100),new Vector2(x+20,120),new Vector2(x,120)])});
test('reference origin is shared and fixed across asymmetric source edits',()=>{
 const originals=[entry('a'),entry('b',140)], imported=createSourceReference(originals,'source.svg',{groupId:'one'});
 assert.deepEqual(imported[0].sourceReference.center,[130,110]);
 assert.equal(originals[0].shape.getPoint(0).x,100);
 const changed=alignReloadEntries([entry('a'),entry('b',180)],imported[0].sourceReference);
 assert.equal(changed[0].shape.getPoint(0).x,-30);
 assert.equal(changed[1].shape.getPoint(0).x,50);
 assert.equal(changed[0].sourceReference.groupId,'one');
});
test('reordered layers match by identity and missing/new paths require relinking',()=>{
 const existing=createSourceReference([entry('a'),entry('b',140,'B')],'a.svg',{groupId:'one'});
 const reordered=planSourceReload(existing,[entry('b',150,'B'),entry('a',105)]);
 assert.equal(reordered.structureChanged,false);
 assert.deepEqual(reordered.matches,[{objectId:'a',incomingIndex:1},{objectId:'b',incomingIndex:0}]);
 const changed=planSourceReload(existing,[entry('a'),entry('c')]);
 assert.equal(changed.structureChanged,true); assert.deepEqual(changed.missing.map(o=>o.id),['b']); assert.deepEqual(changed.added.map(o=>o.incomingIndex),[1]);
});
test('ambiguous identities never auto relink, anonymous identities require confirmation',()=>{
 const existing=createSourceReference([entry('a')],'a.svg');
 const ambiguous=planSourceReload(existing,[entry('a'),entry('a')]);
 assert.equal(ambiguous.matches.length,0); assert.equal(ambiguous.structureChanged,true);
 assert.equal(planSourceReload(existing,[{...entry('a'),sourceElementId:''}]).structureChanged,true);
});
test('replacement preserves user parameters, name, visibility, transforms and material while clearing topology dependent UV edits',()=>{
 const [imported]=createSourceReference([entry('a')],'a.svg');
 const old={...imported,name:'renamed',visible:false,color:'#123456',materialType:'metal',settings:{depth:30,bevelWidth:15,uvEdits:{a:[0,1]}},validSettings:{depth:30,uvEdits:{}},transform:{position:[1,2,3],scale:[2,2,2],rotation:[0,0,0]}};
 const [incoming]=alignReloadEntries([entry('b',150,'B')],old.sourceReference);
 const result=replaceReferencedPath(old,incoming);
 for(const key of ['id','name','visible','color','materialType','transform']) assert.deepEqual(result[key],old[key]);
 assert.deepEqual(result.settings,{depth:30,bevelWidth:15}); assert.equal(result.sourceReference.key,incoming.sourceKey);
 assert.ok(old.settings.uvEdits); assert.notEqual(result.shape,incoming.shape);
});
test('manual mapping enforces one-to-one and valid existing identities',()=>{
 const existing=[entry('a'),entry('b')],incoming=[entry('c'),entry('d')];
 assert.ok(validateRelinkMatches([{objectId:'a',incomingIndex:0},{objectId:'b',incomingIndex:1}],existing,incoming));
 for(const links of [[{objectId:'z',incomingIndex:0}],[{objectId:'a',incomingIndex:2}],[{objectId:'a',incomingIndex:0},{objectId:'b',incomingIndex:0}]]) assert.equal(validateRelinkMatches(links,existing,incoming),false);
});
test('preimport editor preserves source identities',()=>{
 const original=entry('a'), [draft]=createObjectDrafts([original]);
 const result=toImportEntry(draft);
 assert.equal(result.sourceKey,original.sourceKey); assert.equal(result.sourceElementId,'a'); assert.equal(result.sourceShapeIndex,0);
});

test('actual SVG identities survive reordered layers and compound paths retain shape ordinals',async()=>{
 const {DOMParser}=await import('@xmldom/xmldom'); globalThis.DOMParser=DOMParser;
 const {parseSvg}=await import('../src/geometry.js');
 const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
 const a='<g id="layerA"><path id="a" d="M0 0H20V20H0Z M30 0H50V20H30Z"/></g>';
 const b='<g id="layerB"><path id="b" d="M100 0H120V20H100Z"/></g>';
 const first=parseSvg(svg(a+b)).objects, second=parseSvg(svg(b+a)).objects;
 assert.equal(first.length,3); assert.deepEqual(first.filter(e=>e.sourceElementId==='a').map(e=>e.sourceShapeIndex),[0,1]);
 const ref=createSourceReference(first,'test.svg');
 assert.equal(planSourceReload(ref,second).structureChanged,false);
 const duplicate=parseSvg(svg('<g id="A"><path id="dupe" d="M0 0H20V20H0Z"/></g><g id="B"><path id="dupe" d="M100 0H120V20H100Z"/></g>')).objects;
 assert.equal(planSourceReload(createSourceReference(duplicate,'test.svg'),duplicate).matches.length,0);
});

test('reloading unchanged geometry preserves UV edits despite new shape UUIDs',()=>{
 const [old]=createSourceReference([entry('a')],'a.svg');
 old.settings={depth:30,uvEdits:{'0,0':[0.1,0.2]}};
 old.validSettings=structuredClone(old.settings);
 const [incoming]=alignReloadEntries([entry('a')],old.sourceReference);
 assert.notEqual(old.shape.uuid,incoming.shape.uuid);
 const replaced=replaceReferencedPath(old,incoming);
 assert.deepEqual(replaced.settings,old.settings);
 assert.deepEqual(replaced.validSettings,old.validSettings);
 assert.notEqual(replaced.settings.uvEdits,old.settings.uvEdits);
});

test('reference baseline remains independent of edits and restoration preserves object modeling state',async()=>{
 const {restoreReferencedPath}=await import('../src/source-reference.js');
 const [original]=createSourceReference([entry('a')],'source.svg');
 assert.notEqual(original.referenceShape,original.shape);
 const signature=shape=>JSON.stringify(shape.toJSON(),(key,value)=>key==='uuid'?undefined:value);
 const baseline=signature(original.referenceShape);
 original.shape.curves[0].v1.x+=7;
 const object={...original,name:'local name',color:'#333333',materialType:'metal',visible:false,settings:{depth:42,bevelSegments:2,uvEdits:{a:[1,2]}},transform:{position:[1,2,3],rotation:[0,1,0],scale:[2,2,2]}};
 const restored=restoreReferencedPath(object);
 assert.equal(signature(restored.shape),baseline);
 assert.equal(signature(object.referenceShape),baseline);
 for(const key of ['name','color','materialType','visible','transform','sourceReference','id']) assert.deepEqual(restored[key],object[key]);
 assert.deepEqual(restored.settings,{depth:42,bevelSegments:2});
 assert.ok(object.settings.uvEdits);
 assert.notEqual(restored.shape,object.referenceShape);
 restored.settings.uvEdits={a:[0,0]};
 assert.deepEqual(restoreReferencedPath(restored).settings.uvEdits,{a:[0,0]});
 assert.throws(()=>restoreReferencedPath({shape:entry('a').shape}),/参照元を再読み込み/);
});
test('reloading establishes a new restoration baseline rather than retaining the previous source',async()=>{
 const {restoreReferencedPath}=await import('../src/source-reference.js');
 const [old]=createSourceReference([entry('a')],'source.svg');
 const [incoming]=alignReloadEntries([entry('a',160)],old.sourceReference);
 const updated=replaceReferencedPath({...old,settings:{depth:20}},incoming);
 const expected=updated.shape.getPoint(0).x;
 updated.shape.curves[0].v1.x+=10;
 assert.equal(restoreReferencedPath(updated).shape.getPoint(0).x,expected);
 assert.notEqual(expected,old.shape.getPoint(0).x);
});
