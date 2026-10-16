import test from "node:test";
import assert from "node:assert/strict";
import { Shape, Path } from "three";
import { buildMesh, exportObj } from "../src/geometry.js";
import { defaultProfile, normalizeProfile, monotonicProfile } from "../src/bevel-profile.js";

function rectangle(hole = false) {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(100, 0); shape.lineTo(100, 80); shape.lineTo(0, 80); shape.closePath();
  if (hole) {
    const path = new Path();
    path.moveTo(20, 20); path.lineTo(20, 60); path.lineTo(80, 60); path.lineTo(80, 20); path.closePath();
    shape.holes.push(path);
  }
  return shape;
}
const curved = [{ x: 0, y: 0, mode: "bezier", out: { x: .1, y: .6 } },
  { x: 1, y: 1, mode: "bezier", in: { x: .7, y: .95 } }];

test("curved bevels use only the requested uniform division budget", () => {
  for (const hollow of [false, true]) for (const segments of [1, 2, 3, 7]) {
    const mesh = buildMesh(rectangle(hollow), { depth: 30, bevelSize: 5, bevelWidth: 4,
      bevelContinue: true, bevelSegments: segments, curvePoints: curved });
    assert.equal(mesh.userData.bevelSamples.length, segments + 2);
    assert.ok([...mesh.attributes.position.array, ...mesh.attributes.uv.array].every(Number.isFinite));
    assert.ok(!exportObj([{ name: "budget", geometry: mesh }]).obj.includes("NaN"));
    mesh.dispose();
  }
});

test("explicit collinear curve controls retain mandatory bevel edges", () => {
  const controls = defaultProfile();
  controls.splice(1, 0, { x: .25, y: .25, mode: "linear" });
  const mesh = buildMesh(rectangle(), { depth: 30, bevelSize: 5, bevelWidth: 4,
    bevelContinue: true, bevelSegments: 1, curvePoints: controls });
  assert.deepEqual(mesh.userData.bevelSamples, [0, .125, .25, .375, .5, .75, 1]);
  mesh.dispose();
});

test("independent inner profiles add explicit anchors only to their own samples", () => {
  const mesh = buildMesh(rectangle(true), { depth: 30, bevelSize: 5, bevelWidth: 4,
    bevelContinue: true, bevelSegments: 2, curvePoints: curved,
    innerCurvePoints: [{ x: 0, y: 0 }, { x: .3, y: .6 }, { x: 1, y: 1 }] });
  const samples = mesh.userData.innerBevelSamples;
  assert.equal(samples.length, 7, "two inner control spans receive two interior cuts each");
  assert.ok(samples.every(Number.isFinite));

  assert.ok(samples.some(t => Math.abs(t - .3) < 1e-8), "inner control retains its own edge level");
  assert.equal(mesh.userData.bevelSamples.length, 4, "inner anchors do not add outer cuts");
  mesh.dispose();
});


test("default center and added anchors each delimit independently divided spans", () => {
  for (const divisions of [2, 5, 8]) {
    const mesh = buildMesh(rectangle(), { depth: 30, bevelSize: 5, bevelWidth: 4,
      bevelContinue: false, bevelSegments: divisions, curvePoints: defaultProfile() });
    assert.equal(mesh.userData.bevelSamples.length, 2 * (divisions + 1) + 1);
    assert.ok(mesh.userData.bevelSamples.includes(.5));
    mesh.dispose();
  }
  const controls = defaultProfile();
  controls.splice(1, 0, { x: .37, y: .37, mode: "linear" });
  const mesh = buildMesh(rectangle(), { depth: 30, bevelSize: 5, bevelWidth: 4,
    bevelContinue: false, bevelSegments: 2, curvePoints: controls });
  assert.equal(mesh.userData.bevelSamples.length, 10);
  for (const point of controls) assert.ok(mesh.userData.bevelSamples.includes(point.x));
  mesh.dispose();
});


test("low divisions reject hidden returning cubic curves analytically", () => {
  const returning = normalizeProfile([{ x: 0, y: 0 },
    { x: .4, y: .5, mode: "bezier", out: { x: .4001, y: .8 } },
    { x: .4003, y: .5001, mode: "bezier", in: { x: .4002, y: .2 } },
    { x: 1, y: 1 }]);
  assert.equal(monotonicProfile(returning), false);
  assert.equal(monotonicProfile(defaultProfile()), true);
  assert.equal(monotonicProfile(normalizeProfile(curved)), true);
  for (const hollow of [false, true]) {
    assert.throws(() => buildMesh(rectangle(hollow), {
      depth: 30, bevelSize: 5, bevelWidth: 4, bevelContinue: true,
      bevelSegments: 1, curvePoints: returning,
    }), /戻らない/);
  }
  assert.equal(monotonicProfile(normalizeProfile([{ x: 0, y: 0 },
    { x: .4, y: .8 }, { x: .6, y: .2 }, { x: 1, y: 1 }])), false);
});
