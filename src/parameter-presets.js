import { defaultProfile, normalizeProfile } from "./bevel-profile.js";

const FORMAT = "PathFormPresets";
const MAX_BYTES = 1024 * 1024;
const fail = () => { throw new Error("プリセットデータが不正です。名前は 120 文字以内、プリセットは 100 件以内にしてください。"); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const defaults = {
  reductionTolerance: 0, meshReductionPercentage: 0, pathOffset: 0,
  depth: 24, bevelSize: 3, bevelWidth: 3, bevelContinue: true,
  bevelSegments: 4, hollow: false, wallThickness: 4,
  uvScaleX: 1, uvScaleY: 1, uvOffsetX: 0, uvOffsetY: 0, uvRotation: 0,
};
function checkJson(value, depth = 0, budget = { count: 0 }) {
  if (depth > 15 || ++budget.count > 100000) fail();
  if (typeof value === "number" && !Number.isFinite(value)) fail();
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail();
      checkJson(child, depth + 1, budget);
    }
  } else if (value !== null && !["number", "boolean", "string"].includes(typeof value)) fail();
}
function settingsFrom(input) {
  if (!record(input)) fail();
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = Object.hasOwn(input, key) ? input[key] : fallback;
    if (typeof value !== typeof fallback) fail();
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) fail();
      if (["depth", "wallThickness", "uvScaleX", "uvScaleY"].includes(key) && value <= 0) fail();
      if (["bevelSize", "bevelWidth", "reductionTolerance", "meshReductionPercentage"].includes(key) && value < 0) fail();
      if (key === "meshReductionPercentage" && value > 90) fail();
      if (key === "bevelSegments" && (!Number.isInteger(value) || value < 0 || value > 64)) fail();
    }
    result[key] = value;
  }
  for (const key of ["curvePoints", "innerCurvePoints"]) {
    const points = input[key] ?? (key === "innerCurvePoints" ? input.curvePoints : undefined) ?? defaultProfile();
    if (!Array.isArray(points) || points.length < 2 || points.length > 16) fail();
    for (const point of points) {
      if (!record(point) || ![point.x, point.y].every(v => typeof v === "number" && Number.isFinite(v))) fail();
      if (point.edge !== undefined && typeof point.edge !== "boolean") fail();
      for (const handle of [point.in, point.out]) if (handle !== undefined && (!record(handle) || ![handle.x, handle.y].every(v => typeof v === "number" && Number.isFinite(v)))) fail();
    }
    const normalized = normalizeProfile(points);
    result[key] = normalized.map(p => ({ x: p.x, y: p.y, mode: p.mode, handleMode: p.handleMode, ...(p.edge === undefined ? {} : { edge: p.edge }), in: { ...p.in }, out: { ...p.out } }));
  }
  return result;
}
export function validatePreset(input) {
  checkJson(input);
  if (!record(input) || typeof input.id !== "string" || !input.id.length || input.id.length > 120 || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) fail();
  if (typeof input.color !== "string" || !/^#[a-f\d]{6}$/i.test(input.color) || !["standard", "metal"].includes(input.materialType)) fail();
  return { id: input.id, name: input.name.trim(), settings: settingsFrom(input.settings), color: input.color.toLowerCase(), materialType: input.materialType };
}
export function createPreset(name, object) {
  if (!record(object)) fail();
  return validatePreset({ id: globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`, name,
    settings: object.settings, color: object.color ?? "#999999", materialType: object.materialType ?? "standard" });
}
function validateLibrary(presets) {
  if (!Array.isArray(presets) || presets.length > 100) fail();
  const result = presets.map(validatePreset);
  if (new Set(result.map(p => p.id)).size !== result.length) fail();
  return result;
}
export function serializePresetLibrary(presets) {
  const text = JSON.stringify({ format: FORMAT, version: 1, presets: validateLibrary(presets) });
  if (new TextEncoder().encode(text).length > MAX_BYTES) fail();
  return text;
}
export function parsePresetLibrary(text) {
  if (typeof text !== "string" || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) fail();
  let data;
  try { data = JSON.parse(text); } catch { fail(); }
  checkJson(data);
  if (!record(data) || data.format !== FORMAT || data.version !== 1) fail();
  return validateLibrary(data.presets);
}
// Aligned handle normalization can drift by a few ulps. Only profile
// coordinates permit tolerance; other parameters and anchor flags stay exact.
function sameProfileValue(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-12;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameProfileValue(a[key], b[key]));
}
function sameSettings(a, b) {
  return Object.keys(b).every(key => key === "curvePoints" || key === "innerCurvePoints"
    ? sameProfileValue(a[key], b[key]) : a[key] === b[key]);
}
export function applyPresetToObject(object, input) {
  const preset = validatePreset(input);
  const settings = { ...object.settings, ...clone(preset.settings) };
  if (!sameSettings(settingsFrom(object.settings), preset.settings)) delete settings.uvEdits;
  return { ...object, settings, color: preset.color, materialType: preset.materialType };
}
