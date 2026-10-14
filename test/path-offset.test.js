import test from "node:test";
import assert from "node:assert/strict";
import { Vector2, Shape, ShapeUtils } from "three";
import { offsetContours } from "../src/path-offset.js";
import { buildMesh } from "../src/geometry.js";

const square = (size, start = 0) => [[start,start],[start+size,start],[start+size,start+size],[start,start+size]].map(([x,y]) => new Vector2(x,y));

test("path offset expands/contracts contour without mutating source and caches results", () => {
  const rings = [square(20)];
  const source = JSON.stringify(rings);
  for (const amount of [-2, 2]) {
    const result = offsetContours(rings, amount);
    assert.equal(ShapeUtils.area(result.rings[0]), (20 + amount * 2) ** 2);
    assert.equal(result.effectivePathOffset, amount);
    assert.equal(result, offsetContours(rings, amount));
  }
  assert.equal(JSON.stringify(rings), source);
  assert.equal(offsetContours(rings, 0).rings, rings);
});

test("path offset preserves holes and prevents collapse at extreme positive/negative values", () => {
  const rings = [square(20), square(6, 7).reverse()];
  for (const amount of [-1, 1, -1e12, 1e12]) {
    const result = offsetContours(rings, amount);
    assert.equal(result.rings.length, 2);
    assert.ok(ShapeUtils.area(result.rings[0]) > 0);
    assert.ok(ShapeUtils.area(result.rings[1]) < 0);
    assert.equal(Math.sign(result.effectivePathOffset), Math.sign(amount));
    if (Math.abs(amount) > 1) assert.ok(result.warnings.length);
  }
  assert.ok(offsetContours([square(20)], -1e12).warnings.length);
  assert.throws(() => offsetContours(rings, NaN));
});

test("path offset mesh preserves depth and zero offset is byte-identical", () => {
  const shape = new Shape();
  shape.moveTo(0,0); shape.lineTo(20,0); shape.lineTo(20,20); shape.lineTo(0,20); shape.closePath();
  const settings = { depth: 17, bevelSize: 0 };
  const original = buildMesh(shape, settings);
  const zero = buildMesh(shape, { ...settings, pathOffset: 0 });
  assert.deepEqual(original.attributes.position.array, zero.attributes.position.array);
  for (const amount of [-2, 2]) {
    const mesh = buildMesh(shape, { ...settings, pathOffset: amount });
    mesh.computeBoundingBox();
    assert.equal(mesh.boundingBox.max.z - mesh.boundingBox.min.z, 17);
    assert.equal(mesh.boundingBox.max.x - mesh.boundingBox.min.x, 20 + amount * 2);
    assert.equal(mesh.userData.effectivePathOffset, amount);
    assert.ok(Array.from(mesh.attributes.position.array).every(Number.isFinite));
  }
});

test("inward offset clamps before a narrow bridge separates into multiple objects", () => {
  const ring = [[0,0],[10,0],[10,4],[20,4],[20,0],[30,0],[30,10],[20,10],[20,6],[10,6],[10,10],[0,10]].map(([x,y]) => new Vector2(x,y));
  const result = offsetContours([ring], -3);
  assert.equal(result.rings.length, 1);
  assert.ok(result.effectivePathOffset > -1);
  assert.ok(result.warnings.length);
});
