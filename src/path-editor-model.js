import { Shape, Path, Vector2, ShapeUtils } from "three";
import { parseSvg } from "./geometry.js";
import { clean, simplify, valid } from "./path-reduction.js";

export const PATH_EDITOR_VERTEX_LIMIT = 3000;
const pointCopy = p => ({ x: p.x, y: p.y });
const copyContours = contours => contours.map(c => ({ closed: c.closed, points: c.points.map(pointCopy) }));
function extract(shape) {
  const extracted = shape.extractPoints(24);
  return [extracted.shape, ...extracted.holes].map(points => {
    if (points.length > 1 && points[0].distanceToSquared(points.at(-1)) < 1e-16) points = points.slice(0, -1);
    return { points: points.map(pointCopy), closed: true };
  });
}
export function createPathDrafts(text) {
  const { objects, warnings } = parseSvg(text, { forEditing: true });
  return { warnings, drafts: createObjectDrafts(objects) };
}
export function createObjectDrafts(objects) {
  return objects.map(entry => {
    let contours = entry.editorContours || extract(entry.shape);
    const epsilon = epsilonOf(contours.map(c => c.points));
    contours = contours.map(c => {
      if (!c.closed) {
        const points = c.points.filter((p, i) => !i || Math.hypot(p.x - c.points[i - 1].x, p.y - c.points[i - 1].y) > epsilon);
        return { ...c, points };
      }
      try { return { ...c, points: clean(c.points, epsilon).map(pointCopy) }; }
      catch { return c; } // Invalid outlines remain visible so they can be repaired.
    });
    return { id: entry.id, name: entry.name, layerName: entry.layerName || "", color: entry.color,
      ...(entry.sourceKey !== undefined ? { sourceKey: entry.sourceKey, sourceElementId: entry.sourceElementId, sourceShapeIndex: entry.sourceShapeIndex, sourceIdentityAmbiguous: !!entry.sourceIdentityAmbiguous } : {}),
      enabled: true, edited: false, originalShape: entry.shape, contours: copyContours(contours),
      originalContours: copyContours(contours) };
  });
}
function normalizedRings(contours) {
  return contours.map((contour, index) => {
    const ring = contour.points.map(p => new Vector2(p.x, p.y));
    if (ShapeUtils.area(ring) > 0 !== (index === 0)) ring.reverse();
    return ring;
  });
}
function epsilonOf(rings) {
  const all = rings.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return Math.max(1e-10, Math.hypot(maxX - minX, maxY - minY) * 1e-10);
}
export function validateDraft(draft) {
  const errors = [];
  const vertexCount = draft.contours.reduce((n, c) => n + c.points.length, 0);
  if (!draft.contours.length) errors.push("輪郭がありません。");
  if (draft.contours.some(c => !c.closed)) errors.push("開いた輪郭があります。「輪郭を閉じる」で閉じてください。");
  if (draft.contours.some(c => c.points.length < 3)) errors.push("輪郭には 3 頂点以上必要です。");
  if (draft.contours.some(c => c.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) errors.push("不正な座標があります。");
  if (vertexCount > PATH_EDITOR_VERTEX_LIMIT) errors.push(`頂点数が処理上限 ${PATH_EDITOR_VERTEX_LIMIT.toLocaleString()} を超えています。リダクションしてください。`);
  if (!errors.length) {
    const rings = normalizedRings(draft.contours), epsilon = epsilonOf(rings);
    if (rings.some(ring => ring.some((p, i) => p.distanceToSquared(ring[(i + 1) % ring.length]) <= epsilon ** 2)) || !valid(rings, epsilon))
      errors.push("輪郭の交差・重複または面積のない輪郭があります。頂点を調整してください。");
  }
  return { valid: errors.length === 0, errors, vertexCount };
}
export function toImportEntry(draft) {
  const result = validateDraft(draft);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  let shape = draft.originalShape;
  if (draft.edited) {
    const rings = normalizedRings(draft.contours);
    shape = new Shape(rings[0]);
    shape.autoClose = true;
    shape.holes = rings.slice(1).map(ring => { const hole = new Path(ring); hole.autoClose = true; return hole; });
  }
  return { id: draft.id, name: draft.name, layerName: draft.layerName, color: draft.color, shape,
    ...(draft.sourceKey !== undefined ? { sourceKey: draft.sourceKey, sourceElementId: draft.sourceElementId, sourceShapeIndex: draft.sourceShapeIndex, sourceIdentityAmbiguous: !!draft.sourceIdentityAmbiguous } : {}) };
}
export function moveDraftPoint(draft, contourIndex, pointIndex, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const point = draft.contours[contourIndex]?.points[pointIndex];
  if (!point) return false;
  point.x = x; point.y = y; draft.edited = true;
  return true;
}
export function deleteDraftPoint(draft, contourIndex, pointIndex) {
  const contour = draft.contours[contourIndex];
  if (!contour || !Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= contour.points.length || contour.points.length <= (contour.closed ? 3 : 2)) return false;
  contour.points.splice(pointIndex, 1); draft.edited = true; return true;
}
export function closeDraft(draft) {
  for (const contour of draft.contours) {
    const first = contour.points[0], last = contour.points.at(-1);
    if (first && last && contour.points.length > 1 && first.x === last.x && first.y === last.y) contour.points.pop();
    contour.closed = true;
  }
  draft.edited = true;
  return validateDraft(draft);
}
export function resetDraft(draft) {
  draft.contours = copyContours(draft.originalContours); draft.edited = false;
  return validateDraft(draft);
}
export function simplifyDraft(draft, tolerance) {
  tolerance = Number(tolerance);
  if (!(tolerance > 0)) return { applied: false, ...validateDraft(draft) };
  if (draft.contours.some(c => !c.closed)) return { applied: false, ...validateDraft(draft) };
  const original = normalizedRings(draft.contours);
  if (original.reduce((n, r) => n + r.length, 0) > 20000) return { applied: false, valid: false, errors: ["頂点数が多すぎます。SVG を分割してください（最大 20,000）。"], vertexCount: original.reduce((n, r) => n + r.length, 0) };
  const epsilon = epsilonOf(original);
  for (let attempt = 0; attempt < 7; attempt++) {
    const candidate = original.map(r => simplify(r, tolerance / 2 ** attempt, 2_000_000));
    if (candidate.reduce((n, r) => n + r.length, 0) > PATH_EDITOR_VERTEX_LIMIT || !valid(candidate, epsilon)) continue;
    draft.contours = candidate.map(points => ({ points: points.map(pointCopy), closed: true }));
    draft.edited = true;
    return { applied: true, ...validateDraft(draft) };
  }
  return { applied: false, ...validateDraft(draft) };
}

export function addDraftPoint(draft, contourIndex, segmentIndex, x, y) {
  const contour = draft.contours[contourIndex];
  if (!contour || !Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= contour.points.length || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!contour.closed && segmentIndex === contour.points.length - 1) return false;
  contour.points.splice(segmentIndex + 1, 0, { x, y }); draft.edited = true; return true;
}
