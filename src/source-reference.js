import { Box2, Vector2 } from 'three';

const clone = value => value === undefined ? undefined : structuredClone(value);
const shapeSignature = shape => JSON.stringify(shape.toJSON(), (key, value) => key === 'uuid' ? undefined : value);
export function sourceEntryKey(entry) {
  return entry.sourceKey || JSON.stringify([entry.layerName || '', entry.sourceElementId || entry.name || entry.id, entry.sourceShapeIndex || 0]);
}
function sourceCenter(entries) {
  const bounds = new Box2();
  for (const entry of entries) {
    const p = entry.shape.extractPoints(24);
    for (const point of [...p.shape, ...p.holes.flat()]) bounds.expandByPoint(point);
  }
  if (bounds.isEmpty()) throw new Error('読み込むパスの範囲がありません。');
  return bounds.getCenter(new Vector2()).toArray();
}
function translateShape(shape, center) {
  const result = shape.clone(), seen = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.isVector2) { value.x -= center[0]; value.y -= center[1]; return; }
    if (value.type === 'EllipseCurve') { value.aX -= center[0]; value.aY -= center[1]; }
    for (const item of Object.values(value)) visit(item);
  }
  visit(result);
  return result;
}
export function createSourceReference(entries, fileName, { groupId = globalThis.crypto.randomUUID() } = {}) {
  const reference = { groupId, fileName, center: sourceCenter(entries) };
  return alignReloadEntries(entries, reference);
}
export function alignReloadEntries(entries, reference) {
  if (!Array.isArray(reference.center) || reference.center.length !== 2 || !reference.center.every(Number.isFinite)) throw new Error('参照元の原点が不正です。');
  return entries.map(entry => {
    const shape = translateShape(entry.shape, reference.center);
    return { ...entry, shape, referenceShape: shape.clone(), pivot: [0,0,0],
      sourceReference: { groupId: reference.groupId, fileName: reference.fileName, center: [...reference.center], key: sourceEntryKey(entry) } };
  });
}
/** Ambiguous or missing identities are never guessed: the relink screen resolves them. */
export function planSourceReload(existing, incoming) {
  const incomingKeys = incoming.map(sourceEntryKey), oldKeys = existing.map(o => o.sourceReference?.key || sourceEntryKey(o));
  const matches = [], used = new Set();
  existing.forEach((object, index) => {
    const key = oldKeys[index], target = incomingKeys.indexOf(key);
    if (oldKeys.indexOf(key) !== oldKeys.lastIndexOf(key) || target < 0 || target !== incomingKeys.lastIndexOf(key) || incoming[target].sourceIdentityAmbiguous) return;
    matches.push({ objectId: object.id, incomingIndex: target }); used.add(target);
  });
  const matched = new Set(matches.map(m => m.objectId));
  const missing = existing.filter(o => !matched.has(o.id));
  const added = incoming.flatMap((entry, incomingIndex) => used.has(incomingIndex) ? [] : [{ entry, incomingIndex }]);
  const uncertainIdentity = incoming.some(entry => entry.sourceElementId === '');
  return { matches, missing, added, structureChanged: missing.length > 0 || added.length > 0 || uncertainIdentity };
}
/** incoming must already have been aligned to the original reference origin. */
export function replaceReferencedPath(object, entry, reference = entry.sourceReference) {
  const settings = clone(object.settings), validSettings = clone(object.validSettings);
  // Shape UUIDs change when parsing the same file; only geometry changes invalidate UV edits.
  const changed = shapeSignature(object.shape) !== shapeSignature(entry.shape);
  if (changed && settings) delete settings.uvEdits;
  if (changed && validSettings) delete validSettings.uvEdits;
  return { ...object, shape: entry.shape.clone(), referenceShape: entry.shape.clone(), layerName: entry.layerName || '',
    sourceElementId: entry.sourceElementId, sourceShapeIndex: entry.sourceShapeIndex, sourceKey: entry.sourceKey,
    sourceName: reference.fileName, sourceReference: { ...clone(reference), key: sourceEntryKey(entry) },
    settings, ...(validSettings ? { validSettings } : {}), invalid: false };
}
/** Restore only the editable path; object-level modeling and display settings remain intact. */
export function restoreReferencedPath(object) {
  if (object.referenceShape?.type !== 'Shape' || typeof object.referenceShape.clone !== 'function') throw new Error('参照元の形状が保存されていません。参照元を再読み込みしてください。');
  const changed = shapeSignature(object.shape) !== shapeSignature(object.referenceShape);
  const result = { ...object, shape: object.referenceShape.clone(), invalid: false };
  for (const key of ['settings', 'validSettings']) if (object[key]) {
    result[key] = clone(object[key]);
    if (changed) delete result[key].uvEdits;
  }
  return result;
}
export function validateRelinkMatches(matches, existing, incoming) {
  const ids = new Set(existing.map(o => o.id)), usedIds = new Set(), usedIndices = new Set();
  for (const match of matches) {
    if (!ids.has(match.objectId) || usedIds.has(match.objectId) || !Number.isInteger(match.incomingIndex) || match.incomingIndex < 0 || match.incomingIndex >= incoming.length || usedIndices.has(match.incomingIndex)) return false;
    usedIds.add(match.objectId); usedIndices.add(match.incomingIndex);
  }
  return true;
}
