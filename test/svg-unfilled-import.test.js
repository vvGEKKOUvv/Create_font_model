import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { parseSvg, buildMesh } from "../src/geometry.js";

globalThis.DOMParser = DOMParser;
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const square = "M0 0H20V20H0Z";

test("closed unfilled outlines import without expanding stroke width", () => {
  for (const stroke of ["", 'stroke="red" stroke-width="10"']) {
    const result = parseSvg(wrap(`<path fill="none" ${stroke} d="${square}"/>`));
    assert.equal(result.objects.length, 1);
    assert.deepEqual(result.warnings, []);
    const mesh = buildMesh(result.objects[0].shape, {depth: 10, bevelEnabled: false});
    mesh.computeBoundingBox();
    assert.equal(mesh.boundingBox.max.x - mesh.boundingBox.min.x, 20);
    assert.equal(mesh.boundingBox.max.y - mesh.boundingBox.min.y, 20);
    assert.ok(mesh.getAttribute("position").count > 0);
  }
});

test("inherited fill none and compound hole rules survive import", () => {
  const result = parseSvg(wrap(`<g fill="none"><path fill-rule="evenodd" d="${square} M7 7H13V13H7Z"/></g>`));
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].shape.holes.length, 1);
  const nonzero = parseSvg(wrap(`<path fill="none" d="${square} M7 7V13H13V7Z"/>`));
  assert.equal(nonzero.objects[0].shape.holes.length, 1);
});

test("closed primitive shapes without fill import and hidden outlines stay hidden", () => {
  const result = parseSvg(wrap('<g fill="none"><rect width="20" height="10"/><circle cx="50" cy="50" r="5"/><g display="none"><path d="M0 0H100V100H0Z"/></g><path visibility="hidden" d="M0 0H200V200H0Z"/></g>'));
  assert.equal(result.objects.length, 2);
});

test("open unfilled subpaths are skipped with a warning rather than implicitly closed", () => {
  const result = parseSvg(wrap(`<path fill="none" d="${square} M30 0L40 0L40 10"/>`));
  assert.equal(result.objects.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /開いたパス/);
  assert.throws(() => parseSvg(wrap('<path fill="none" d="M0 0L20 0L20 20"/>')), /輪郭を閉じて/);
  assert.equal(parseSvg(wrap('<path fill="none" d="M0 0H20V20H0L0 0"/>')).objects.length, 1);
});

test("filled open path closure remains supported with its existing warning", () => {
  const result = parseSvg(wrap('<path d="M0 0L20 0L20 20"/>'));
  assert.equal(result.objects.length, 1);
  assert.match(result.warnings[0], /直線で閉じて/);
});
