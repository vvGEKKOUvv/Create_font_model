import test from "node:test";
import assert from "node:assert/strict";
import { createPreset, validatePreset, serializePresetLibrary, parsePresetLibrary, applyPresetToObject } from "../src/parameter-presets.js";
import { Shape } from "three";
import { buildMesh } from "../src/geometry.js";
import { defaultProfile, normalizeProfile } from "../src/bevel-profile.js";

const object = () => ({ id: "original", name: "Source", visible: false, shape: { curves: ["source"] },
  transform: { position: [1, 2, 3] }, pivot: [2, 3, 4], color: "#AABBCC", materialType: "metal",
  settings: { depth: 40, bevelSize: 7, bevelWidth: 5, bevelSegments: 0, hollow: true, wallThickness: 6,
    bevelContinue: false, meshReductionPercentage: 25, reductionTolerance: .3, pathOffset: -2,
    uvScaleX: 2, uvScaleY: .5, uvRotation: 25, uvOffsetX: -.4, uvOffsetY: .6,
    curvePoints: defaultProfile(), innerCurvePoints: [{ x: 0, y: 0 }, { x: .3, y: .7 }, { x: 1, y: 1 }],
    uvEdits: { 0: [.2, .3] }, hollowCurveSafe: true } });
test("preset library round trips complete parameters and independent inner curve without storing source or UV vertex edits", () => {
  const source = object(), preset = createPreset("  金属  ", source);
  assert.equal(preset.name, "金属");
  assert.equal(preset.color, "#aabbcc");
  assert.equal(preset.settings.bevelSegments, 0);
  assert.equal(preset.settings.pathOffset, -2);
  assert.equal(preset.settings.innerCurvePoints[1].x, .3);
  for (const key of ["uvEdits", "hollowCurveSafe"]) assert.equal(key in preset.settings, false);
  for (const key of ["shape", "transform", "pivot", "visible"]) assert.equal(key in preset, false);
  const [restored] = parsePresetLibrary(serializePresetLibrary([preset]));
  assert.deepEqual(restored, preset);
  restored.settings.curvePoints[1].y = .9;
  assert.equal(source.settings.curvePoints[1].y, .5);
  assert.equal(preset.settings.curvePoints[1].y, .5);
});
test("application preserves object identity, source, placement and clears only incompatible per-vertex UV edits", () => {
  const source = object(), preset = createPreset("Preset", source);
  const unchanged = applyPresetToObject(source, preset);
  assert.equal(unchanged.settings.uvEdits, source.settings.uvEdits);
  preset.settings.depth = 60;
  const result = applyPresetToObject(source, preset);
  assert.equal(result.id, source.id);
  assert.equal(result.shape, source.shape);
  assert.equal(result.transform, source.transform);
  assert.equal(result.visible, false);
  assert.equal(result.name, source.name);
  assert.equal(result.settings.depth, 60);
  assert.equal(result.settings.uvEdits, undefined);
  assert.equal(source.settings.depth, 40);
  assert.ok(source.settings.uvEdits);
  result.settings.innerCurvePoints[1].y = .2;
  assert.equal(preset.settings.innerCurvePoints[1].y, .7);
});
test("reject invalid settings before geometry sees them", () => {
  const original = createPreset("Good", object());
  for (const [key, value] of [["depth", 0], ["wallThickness", -1], ["uvScaleX", 0], ["uvScaleY", null], ["bevelSegments", -.1], ["bevelSegments", 65], ["meshReductionPercentage", 91], ["bevelWidth", -1], ["pathOffset", Infinity], ["hollow", "true"], ["uvRotation", "1"]]) {
    assert.throws(() => validatePreset({ ...original, settings: { ...original.settings, [key]: value } }), undefined, key);
  }
  assert.throws(() => validatePreset({ ...original, settings: { ...original.settings, curvePoints: Array(17).fill({ x: 0, y: 0 }) } }));
  assert.throws(() => validatePreset({ ...original, settings: { ...original.settings, innerCurvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1, out: { x: NaN, y: 0 } }] } }));
});
test("reject malformed, duplicate, oversized and prototype-bearing libraries; ignore harmless unknown fields", () => {
  const preset = createPreset("Good", object());
  assert.throws(() => createPreset(" ", object()));
  assert.throws(() => createPreset("a".repeat(121), object()));
  assert.throws(() => serializePresetLibrary([preset, preset]));
  assert.throws(() => serializePresetLibrary(Array.from({ length: 101 }, (_, i) => ({ ...preset, id: String(i) }))));
  for (const text of ["{", '{"format":"PathFormPresets","version":2,"presets":[]}', ' '.repeat(1024 * 1024 + 1), '{"format":"PathFormPresets","version":1,"presets":[],"__proto__":{}}']) assert.throws(() => parsePresetLibrary(text));
  const data = JSON.parse(serializePresetLibrary([preset]));
  data.presets[0].settings.futureSetting = 5;
  assert.equal("futureSetting" in parsePresetLibrary(JSON.stringify(data))[0].settings, false);
});

test("legacy unflagged middle control round trips with its mandatory control edge", () => {
  const source = object();
  source.settings.hollow = false;
  source.settings.curvePoints = [0, .5, 1].map(x => ({ x, y: x, mode: "linear" }));
  source.settings.innerCurvePoints = source.settings.curvePoints;
  const [preset] = parsePresetLibrary(serializePresetLibrary([createPreset("Legacy", source)]));
  assert.equal(Object.hasOwn(preset.settings.curvePoints[1], "edge"), false);
  assert.equal(Object.hasOwn(preset.settings.innerCurvePoints[1], "edge"), false);
  const applied = applyPresetToObject(source, preset);
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(100, 0); shape.lineTo(100, 80); shape.lineTo(0, 80); shape.closePath();
  const before = buildMesh(shape, source.settings), after = buildMesh(shape, applied.settings);
  try {
    assert.deepEqual(before.userData.bevelSamples, [0, .5, 1]);
    assert.deepEqual(after.userData.bevelSamples, before.userData.bevelSamples);
    assert.equal(after.attributes.position.count, before.attributes.position.count);
  } finally { before.dispose(); after.dispose(); }
});

test("reapplying custom aligned profile preserves UV edits despite subprecision handle normalization", () => {
  const source = object();
  const points = defaultProfile();
  points[1].y = .001;
  source.settings.curvePoints = normalizeProfile(points);
  const preset = createPreset("Custom", source);
  const applied = applyPresetToObject(source, preset);
  assert.deepEqual(applied.settings.uvEdits, source.settings.uvEdits);
  preset.settings.depth += 1e-10;
  assert.equal(applyPresetToObject(source, preset).settings.uvEdits, undefined,
    "non-profile settings remain exact even for tiny changes");
});
