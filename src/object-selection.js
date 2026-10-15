/** Resolve list selection without mutating either the objects or current selection. */
export function resolveSelection(objects, selectedIds, anchorId, index, modifiers = {}) {
  const object = objects[index];
  const validIds = new Set(objects.map((entry) => entry.id));
  const ids = new Set([...selectedIds].filter((id) => validIds.has(id)));
  if (!object) return { ids, activeId: [...ids].at(-1) ?? null, anchorId: validIds.has(anchorId) ? anchorId : null };
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  const anchorIndex = objects.findIndex((entry) => entry.id === anchorId);
  if (modifiers.shiftKey && anchorIndex >= 0) {
    if (!additive) ids.clear();
    const first = Math.min(index, anchorIndex), last = Math.max(index, anchorIndex);
    for (let cursor = first; cursor <= last; cursor++) ids.add(objects[cursor].id);
    return { ids, activeId: object.id, anchorId };
  }
  if (!additive) {
    return { ids: new Set([object.id]), activeId: object.id, anchorId: object.id };
  }
  if (ids.has(object.id)) ids.delete(object.id);
  else ids.add(object.id);
  return { ids, activeId: ids.has(object.id) ? object.id : objects.findLast((entry) => ids.has(entry.id))?.id ?? null, anchorId: object.id };
}
