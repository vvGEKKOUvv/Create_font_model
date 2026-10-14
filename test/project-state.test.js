import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path } from 'three';
import { serializeProject, parseProject } from '../src/project-state.js';
import { buildMesh, exportObj } from '../src/geometry.js';

function fixture() {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(30, 0); shape.quadraticCurveTo(35, 15, 30, 30); shape.lineTo(0, 30); shape.closePath();
  const hole = new Path(); hole.moveTo(10, 10); hole.lineTo(10, 20); hole.lineTo(20, 20); hole.lineTo(20, 10); hole.closePath(); shape.holes.push(hole);
  return { objects: [{ id: 'file-1-path-1', name: '輪郭 001', sourceName: 'original.svg', shape, visible: false, color: '#b6ee75', settings: { depth: 24, bevelSize: 2, bevelWidth: 2, bevelSegments: 3, bevelContinue: true, sharpCorners: true, hollow: false, wallThickness: 4, reductionTolerance: 0, uvScaleX: 1, uvScaleY: 1, uvOffsetX: 0.2, uvOffsetY: 0, uvRotation: 15, curvePoints: [{x:0,y:0,mode:'linear'},{x:1,y:1,mode:'linear'}], uvEdits: {'0,0':[0.1,0.2]} }, pivot: [15,15,12], transform: { position:[1,2,3], rotation:[0,0.5,0], scale:[2,1,1] } }], selected: 0, groupPosition: [-15,15,-12], sourceLabel:'original.svg', fileSequence:1, objectSequence:1, view:{cameraPosition:[230,200,330], cameraQuaternion:[0,0,0,1], target:[0,0,0], zoom:1, wireframe:true, wireframeMode:'hidden', tab:'3d', uvEditMode:false, sections:[true,false], transformMode:'translate', transformSpace:false} };
}
test('project roundtrip preserves editable source curves, holes, settings and exported geometry', () => {
  const original = fixture(), loaded = parseProject(serializeProject(original));
  assert.ok(loaded.objects[0].shape instanceof Shape);
  assert.notEqual(loaded.objects[0].shape, original.objects[0].shape);
  assert.equal(serializeProject(loaded), serializeProject(original));
  const a = buildMesh(original.objects[0].shape, original.objects[0].settings), b = buildMesh(loaded.objects[0].shape, loaded.objects[0].settings);
  assert.deepEqual(Array.from(a.getAttribute('position').array), Array.from(b.getAttribute('position').array));
  assert.deepEqual(Array.from(a.getAttribute('uv').array), Array.from(b.getAttribute('uv').array));
  assert.deepEqual(exportObj([{geometry:a,name:'輪郭'}]), exportObj([{geometry:b,name:'輪郭'}]));
  loaded.objects[0].settings.depth = 5;
  assert.equal(original.objects[0].settings.depth, 24);
  a.dispose(); b.dispose();
});
test('project rejects malformed, unsupported and unsafe data before reconstruction', () => {
  const raw = JSON.parse(serializeProject(fixture()));
  for (const mutate of [
    d => d.version = 999,
    d => d.state.selected = -1,
    d => d.state.objects[0].shape.curves[0].type = 'constructor',
    d => d.state.objects[0].shape.curves[0].v1 = [null, 0],
    d => d.state.objects[0].transform.position = [0, null, 0],
    d => d.state.objects[0].settings.bevelSegments = 100000,
    d => d.state.objects[0].shape.holes[0].curves = null,
    d => d.state.objects.push(d.state.objects[0]),
  ]) {
    const copy = structuredClone(raw); mutate(copy);
    assert.throws(() => parseProject(JSON.stringify(copy)), /プロジェクト/);
  }
  assert.throws(() => parseProject('{'), /プロジェクト/);
  assert.throws(() => parseProject('{"format":"PathFormProject","version":1,"__proto__":{}}'), /プロジェクト/);
  assert.throws(() => parseProject(' '.repeat(20 * 1024 * 1024 + 1)), /プロジェクト/);
  const state = fixture(); state.objects[0].transform.rotation[0] = Infinity;
  assert.throws(() => serializeProject(state), /プロジェクト/);
});
test('empty project and imported ellipse curves roundtrip', () => {
  const state = fixture(); state.objects = []; state.sourceLabel = 'SVG を追加';
  assert.deepEqual(parseProject(serializeProject(state)), state);
  const ellipse = fixture(); ellipse.objects[0].shape = new Shape(); ellipse.objects[0].shape.absellipse(0,0,10,20,0,Math.PI*2,false,0);
  assert.equal(serializeProject(parseProject(serializeProject(ellipse))), serializeProject(ellipse));
});

test('independent bevel curves and active side survive project roundtrip', () => {
  const state = fixture();
  state.objects[0].settings.innerCurvePoints = [
    {x:0,y:0,mode:'linear'}, {x:0.5,y:0.3,mode:'linear'}, {x:1,y:1,mode:'linear'},
  ];
  state.view.curveSide = 'inner';
  const loaded = parseProject(serializeProject(state));
  assert.deepEqual(loaded.objects[0].settings.innerCurvePoints,state.objects[0].settings.innerCurvePoints);
  assert.equal(loaded.view.curveSide,'inner');
  const a = buildMesh(state.objects[0].shape,state.objects[0].settings);
  const b = buildMesh(loaded.objects[0].shape,loaded.objects[0].settings);
  assert.deepEqual(Array.from(a.attributes.position.array),Array.from(b.attributes.position.array));
  const invalid = JSON.parse(serializeProject(state));
  invalid.state.objects[0].settings.innerCurvePoints = [{x:0,y:0},{x:1,y:2}];
  assert.throws(()=>parseProject(JSON.stringify(invalid)));
  a.dispose(); b.dispose();
});

test('metal and environment selections roundtrip and reject unknown presets', () => {
  const state=fixture();state.objects[0].materialType='metal';state.view.environmentPreset='sunset';
  const loaded=parseProject(serializeProject(state));
  assert.equal(loaded.objects[0].materialType,'metal');assert.equal(loaded.view.environmentPreset,'sunset');
  const raw=JSON.parse(serializeProject(state));raw.state.view.environmentPreset='invalid';
  assert.throws(()=>parseProject(JSON.stringify(raw)));
  raw.state.view.environmentPreset='studio';raw.state.objects[0].materialType='invalid';
  assert.throws(()=>parseProject(JSON.stringify(raw)));
});
