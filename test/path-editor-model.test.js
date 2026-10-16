import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { createPathDrafts, validateDraft, toImportEntry, moveDraftPoint, addDraftPoint, deleteDraftPoint, closeDraft, resetDraft, simplifyDraft } from "../src/path-editor-model.js";
import { parseSvg } from "../src/geometry.js";
globalThis.DOMParser = DOMParser;
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">${body}</svg>`;

test("editor retains open unfilled contours until explicit closure; quick import still rejects", () => {
  const text = svg('<path id="open" fill="none" d="M0 0 L20 0 L20 20"/>');
  assert.throws(() => parseSvg(text));
  const { drafts } = createPathDrafts(text);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].contours[0].closed, false);
  assert.equal(validateDraft(drafts[0]).valid, false);
  assert.throws(() => toImportEntry(drafts[0]));
  assert.equal(closeDraft(drafts[0]).valid, true);
  assert.equal(toImportEntry(drafts[0]).shape.extractPoints().shape.length, 4);
  resetDraft(drafts[0]);
  assert.equal(drafts[0].contours[0].closed, false);
});

test("nested Illustrator/Inkscape groups stay independent, compound holes stay together", () => {
  const text = svg('<g id="layerA" inkscape:label="A"><path id="ring" fill-rule="evenodd" d="M0 0H40V40H0Z M10 10V30H30V10Z"/></g><g id="layerB"><g id="nested"><path id="other" d="M0 0H40V40H0Z"/></g></g>');
  const { drafts } = createPathDrafts(text);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map(d => d.layerName), ["A", "layerB / nested"]);
  assert.equal(drafts[0].name, "ring");
  assert.equal(drafts[0].contours.length, 2);
  assert.equal(toImportEntry(drafts[0]).shape.holes.length, 1);
});

test("unedited editor preserves cubic geometry rather than replacing it by sampled polylines", () => {
  const { drafts: [draft] } = createPathDrafts(svg('<path d="M0 0 C0 20 20 20 20 0 L0 0Z"/>'));
  assert.equal(toImportEntry(draft).shape, draft.originalShape);
  assert(draft.originalShape.curves.some(c => c.isCubicBezierCurve));
  const before = draft.contours[0].points[2];
  moveDraftPoint(draft, 0, 2, before.x + 1, before.y);
  assert.notEqual(toImportEntry(draft).shape, draft.originalShape);
  resetDraft(draft);
  assert.equal(toImportEntry(draft).shape, draft.originalShape);
});

test("editor rejects self intersection, degenerate rings, nonfinite points and vertex overflow", () => {
  const { drafts: [draft] } = createPathDrafts(svg('<path d="M0 0H20V20H0Z"/>'));
  const initial = draft.contours;
  draft.contours = [{ closed: true, points: [{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}] }];
  assert.equal(validateDraft(draft).valid, false);
  draft.contours = [{ closed: true, points: [{x:0,y:0},{x:1,y:0},{x:2,y:0}] }];
  assert.equal(validateDraft(draft).valid, false);
  draft.contours = [{ closed: true, points: [{x:0,y:0},{x:Infinity,y:0},{x:2,y:1}] }];
  assert.equal(validateDraft(draft).valid, false);
  draft.contours = [{ closed: true, points: Array.from({length:6001}, (_,i) => ({x:Math.cos(i/6001*2*Math.PI),y:Math.sin(i/6001*2*Math.PI)})) }];
  assert.equal(validateDraft(draft).valid, false);
  assert.equal(simplifyDraft(draft, .01).valid, true);
  assert(draft.contours[0].points.length < 6000);
  draft.contours = initial;
});

test("point insertion and deletion are explicit; simplification keeps holes and corners", () => {
  const { drafts: [draft] } = createPathDrafts(svg('<path fill-rule="evenodd" d="M0 0H40V40H0Z M10 10V30H30V10Z"/>'));
  assert.equal(addDraftPoint(draft,0,0,20,0),true);
  assert.equal(draft.contours[0].points.length,5);
  assert.equal(deleteDraftPoint(draft,0,1),true);
  assert.equal(draft.contours[0].points.length,4);
  const result = simplifyDraft(draft,100);
  assert.equal(result.valid,true);
  assert.equal(draft.contours.length,2);
  assert.equal(toImportEntry(draft).shape.holes.length,1);
});

test("hidden layers are never imported into editor and ENTITY protection remains", () => {
  const { drafts } = createPathDrafts(svg('<g display="none"><path d="M0 0H20V20H0Z"/></g><path d="M0 0H10V10H0Z"/>'));
  assert.equal(drafts.length,1);
  assert.throws(() => createPathDrafts('<!DOCTYPE svg [<!ENTITY x "bad">]><svg/>'));
});

test("editor separates adjacent transformed layers using original SVG world coordinates", () => {
  const { drafts } = createPathDrafts(svg('<g id="first" transform="translate(100 50)"><path d="M0 0H20V20H0Z"/></g><g id="second" transform="translate(5 10)"><g transform="scale(2)"><path d="M0 0H20V20H0Z"/></g></g>'));
  assert.equal(drafts.length,2);
  assert.deepEqual(drafts[0].contours[0].points.map(p => [p.x,p.y]), [[100,50],[120,50],[120,70],[100,70]]);
  assert.deepEqual(drafts[1].contours[0].points.map(p => [p.x,p.y]), [[5,10],[45,10],[45,50],[5,50]]);
  assert.equal(drafts[1].layerName,"second");
});

test("editor normalizes tiny duplicate segments without altering original curve shape", () => {
  const { drafts: [draft] } = createPathDrafts(svg('<path d="M0 0 L0.00000000001 0 L20 0 L20 20 L0 20Z"/>'));
  assert.equal(draft.contours[0].points.length,4);
  assert.equal(validateDraft(draft).valid,true);
  assert.equal(toImportEntry(draft).shape,draft.originalShape);
});

test("editor rejects excessive sampled curve budget before allocating editable points", () => {
  const commands = ' C0 10 10 10 10 0'.repeat(1680);
  assert.throws(() => createPathDrafts(svg(`<path fill="none" d="M0 0${commands}"/>`)), /40,000/);
  const manyPaths = Array.from({length:11},(_,i) => `<path id="p${i}" fill="none" d="M0 0${' C0 10 10 10 10 0'.repeat(800)}"/>`).join('');
  assert.throws(() => createPathDrafts(svg(manyPaths)), /200,000/);
});
