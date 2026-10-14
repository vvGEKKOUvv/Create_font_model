import { Shape } from "three";
import { normalizeProfile } from "./bevel-profile.js";

const FORMAT = "PathFormProject";
const MAX_BYTES = 20 * 1024 * 1024;
const fail = () => { throw new Error("PathForm のプロジェクトデータが不正、または対応していない形式です。"); };
const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(v => typeof v === "number" && Number.isFinite(v));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
// Validate before Three's constructors or geometry code see user-controlled data.
function validateJson(value, depth = 0, budget = { count: 0 }) {
  if (depth > 40 || ++budget.count > 500000) fail();
  if (typeof value === "number" && !Number.isFinite(value)) fail();
  if (typeof value === "string" && value.length > 1000000) fail();
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail();
      validateJson(child, depth + 1, budget);
    }
  } else if (!["string", "number", "boolean"].includes(typeof value) && value !== null) fail();
}
const curveFields = {
  LineCurve: ["v1", "v2"],
  QuadraticBezierCurve: ["v0", "v1", "v2"],
  CubicBezierCurve: ["v0", "v1", "v2", "v3"],
  EllipseCurve: ["aX", "aY", "xRadius", "yRadius", "aStartAngle", "aEndAngle", "aRotation"],
  SplineCurve: ["points"],
};
function validatePath(path, shape = false, budget = { count: 0 }) {
  if (!record(path) || path.type !== (shape ? "Shape" : "Path") || !vector(path.currentPoint, 2) || !Array.isArray(path.curves) || typeof path.autoClose !== "boolean") fail();
  if (!path.curves.length || (budget.count += path.curves.length) > 20000) fail();
  for (const curve of path.curves) {
    if (!record(curve) || !Object.hasOwn(curveFields, curve.type)) fail();
    for (const field of curveFields[curve.type]) {
      if (field === "points") {
        if (!Array.isArray(curve.points) || curve.points.length < 2 || curve.points.length > 20000 || !curve.points.every(p => vector(p, 2))) fail();
      } else if (field.startsWith("v")) {
        if (!vector(curve[field], 2)) fail();
      } else if (typeof curve[field] !== "number" || !Number.isFinite(curve[field])) fail();
    }
    if (curve.type === "EllipseCurve" && typeof curve.aClockwise !== "boolean") fail();
    if (curve.arcLengthDivisions !== undefined && (!Number.isInteger(curve.arcLengthDivisions) || curve.arcLengthDivisions < 1 || curve.arcLengthDivisions > 2000)) fail();
  }
  if (shape) {
    if (!Array.isArray(path.holes) || path.holes.length > 1000 || typeof path.uuid !== "string") fail();
    for (const hole of path.holes) validatePath(hole, false, budget);
  }
}
function validateState(state) {
  if (!record(state) || !Array.isArray(state.objects) || state.objects.length > 1000 || !Number.isInteger(state.selected) || state.selected < 0 || state.selected >= Math.max(1, state.objects.length) || !vector(state.groupPosition, 3) || typeof state.sourceLabel !== "string") fail();
  for (const key of ["fileSequence", "objectSequence"]) if (state[key] !== undefined && (!Number.isSafeInteger(state[key]) || state[key] < 0)) fail();
  const ids = new Set();
  for (const object of state.objects) {
    if (!record(object) || typeof object.id !== "string" || ids.has(object.id) || typeof object.name !== "string" || object.name.length > 1000 || !/^#[\da-f]{6}$/i.test(object.color) || !record(object.settings)) fail();
    if (object.materialType !== undefined && !["standard", "metal"].includes(object.materialType)) fail();
    ids.add(object.id);
    if (object.visible !== undefined && typeof object.visible !== "boolean") fail();
    if (object.pivot !== undefined && !vector(object.pivot, 3)) fail();
    if (object.transform !== undefined && (!record(object.transform) || !["position", "rotation", "scale"].every(key => vector(object.transform[key], 3)) || object.transform.scale.some(v => v === 0))) fail();
    for (const settings of [object.settings, object.validSettings].filter(Boolean)) {
      if (!record(settings) || !(typeof settings.depth === "number" && settings.depth > 0) || !Number.isInteger(settings.bevelSegments) || settings.bevelSegments < 0 || settings.bevelSegments > 64) fail();
      for (const key of ["bevelSize", "bevelWidth", "wallThickness", "reductionTolerance"]) if (settings[key] !== undefined && !(typeof settings[key] === "number" && settings[key] >= 0)) fail();
      if (settings.meshReductionPercentage !== undefined && !(typeof settings.meshReductionPercentage === "number" && settings.meshReductionPercentage >= 0 && settings.meshReductionPercentage <= 90)) fail();
      for (const key of ["uvScaleX", "uvScaleY", "uvOffsetX", "uvOffsetY", "uvRotation", "offset", "pathOffset"]) if (settings[key] !== undefined && typeof settings[key] !== "number") fail();
      for (const key of ["bevelContinue", "sharpCorners", "hollow", "hollowCurveSafe", "bevelFullWidth"]) if (settings[key] !== undefined && typeof settings[key] !== "boolean") fail();
      if (settings.uvEdits !== undefined && (!record(settings.uvEdits) || !Object.values(settings.uvEdits).every(v => vector(v, 2)))) fail();
      for (const name of ["curvePoints", "innerCurvePoints"]) {
        const points = settings[name];
        if (points === undefined) continue;
        try { normalizeProfile(points); } catch { fail(); }
        if (points.some(p => p?.edge !== undefined && typeof p.edge !== "boolean")) fail();
        if (!Array.isArray(points) || points.length < 2 || points.length > 16 || !points.every(p => record(p) && typeof p.x === "number" && typeof p.y === "number" && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) fail();
      }
    }
    validatePath(object.shape, true);
  }
  if (state.view !== undefined) {
    if (!record(state.view)) fail();
    if (state.view.environmentPreset !== undefined && !["studio", "softbox", "outdoor", "sunset"].includes(state.view.environmentPreset)) fail();
    for (const key of ["cameraPosition", "target"]) if (!vector(state.view[key], 3)) fail();
    if (!vector(state.view.cameraQuaternion, 4)) fail();
    if (!(typeof state.view.zoom === "number" && state.view.zoom > 0)) fail();
    for (const key of ["wireframe", "uvEditMode", "transformSpace"]) if (typeof state.view[key] !== "boolean") fail();
    for (const [key, choices] of [["wireframeMode", ["lines", "hidden", "overlay"]], ["tab", ["3d", "uv"]], ["transformMode", ["translate", "rotate", "scale"]]]) if (!choices.includes(state.view[key])) fail();
    if (state.view.curveSide !== undefined && !["outer", "inner"].includes(state.view.curveSide)) fail();
    if (!Array.isArray(state.view.sections) || state.view.sections.length > 100 || !state.view.sections.every(v => typeof v === "boolean")) fail();
  }
}
function removeRetiredSettings(object) {
  const clean = { ...object };
  for (const key of ["settings", "validSettings"]) if (object[key]) {
    clean[key] = { ...object[key] };
    delete clean[key].hollowCurveSafe;
  }
  return clean;
}
export function serializeProject(state) {
  const data = { ...state, objects: state.objects.map(object => ({ ...removeRetiredSettings(object), shape: object.shape.toJSON() })) };
  validateJson(data);
  validateState(data);
  const text = JSON.stringify({ format: FORMAT, version: 2, state: data });
  if (new TextEncoder().encode(text).length > MAX_BYTES) fail();
  return text;
}
export function parseProject(text) {
  if (typeof text !== "string" || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) fail();
  let data;
  try { data = JSON.parse(text); } catch { fail(); }
  validateJson(data);
  if (!record(data) || data.format !== FORMAT || ![1,2].includes(data.version)) fail();
  validateState(data.state);
  if (data.version === 1) for (const object of data.state.objects) {
    for (const settings of [object.settings,object.validSettings].filter(Boolean)) {
      settings.bevelSegments = Math.max(0,settings.bevelSegments-1);
      for (const key of ["curvePoints","innerCurvePoints"]) if (Array.isArray(settings[key])) {
        const interior=settings[key].slice(1,-1);
        const middle=interior.reduce((best,p)=>!best||Math.abs(p.x-.5)<Math.abs(best.x-.5)?p:best,null);
        for (const point of settings[key]) if (point.edge === undefined)
          point.edge=point !== middle && point !== settings[key][0] && point !== settings[key].at(-1);
      }
    }
  }
  return { ...data.state, objects: data.state.objects.map(object => ({ ...removeRetiredSettings(object), shape: new Shape().fromJSON(object.shape) })) };
}
