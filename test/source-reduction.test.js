import test from "node:test";
import assert from "node:assert/strict";
import { Shape, Path } from "three";
import { reduceSourcePath } from "../src/source-reduction.js";
import { prepareContours } from "../src/path-reduction.js";
import { buildMesh } from "../src/geometry.js";

function circle(radius = 50, count = 96, Type = Shape) {
  const shape = new Type();
  for (let i = 0; i < count; i++) {
    const angle = i * 2 * Math.PI / count;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

test("source reduction creates an independent closed path and leaves history source untouched", () => {
  const source = circle();
  const previous = JSON.stringify(source.toJSON());
  const result = reduceSourcePath(source, 1);
  assert.notEqual(result.shape, source);
  assert.notEqual(result.shape.uuid, source.uuid);
  assert.ok(result.after < result.before);
  assert.equal(JSON.stringify(source.toJSON()), previous);
  assert.deepEqual(prepareContours(result.shape).rings, prepareContours(source, 1).rings);
  const restored = new Shape().fromJSON(result.shape.toJSON());
  assert.deepEqual(prepareContours(restored).rings, prepareContours(result.shape).rings);
  assert.deepEqual(new Shape().fromJSON(JSON.parse(previous)).toJSON(), source.toJSON());
});

test("source reduction no-op returns original shape and preserves sharp vertices", () => {
  const source = new Shape();
  source.moveTo(0, 0); source.lineTo(100, 0); source.lineTo(40, 10); source.lineTo(0, 100); source.closePath();
  for (const tolerance of [0, -1, NaN, 0.0001, 100]) {
    const result = reduceSourcePath(source, tolerance);
    assert.equal(result.shape, source);
    assert.equal(result.before, result.after);
  }
});

test("source reduction commits dense paths when reduced preview fits the geometry budget", () => {
  const source = circle(50, 3100);
  const result = reduceSourcePath(source, 1);
  assert.equal(result.before, 3100);
  assert.ok(result.after < 100);
  assert.notEqual(result.shape, source);
  assert.deepEqual(prepareContours(result.shape).rings, prepareContours(source, 1).rings);
});

test("source reduction preserves holes and committed mesh matches reduction preview", () => {
  const source = circle();
  source.holes.push(circle(15, 64, Path));
  const { shape, before, after } = reduceSourcePath(source, 0.7);
  assert.equal(shape.holes.length, 1);
  assert.ok(after < before);
  assert.deepEqual(prepareContours(shape).rings, prepareContours(source, 0.7).rings);
  const settings = {depth: 20, bevelSize: 2, bevelWidth: 1, bevelContinue: false, bevelSegments: 3, hollow: false, sharpCorners: true};
  const preview = buildMesh(source, {...settings, reductionTolerance: 0.7});
  const committed = buildMesh(shape, {...settings, reductionTolerance: 0});
  for (const attribute of ["position", "normal", "uv"]) {
    assert.deepEqual(committed.getAttribute(attribute).array, preview.getAttribute(attribute).array);
  }
  preview.dispose(); committed.dispose();
});
