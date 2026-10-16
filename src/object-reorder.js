/** Move selected rows together, keeping both groups' relative order. */
export function reorderObjectsByDrop(objects, movingIds, targetId, after = false) {
  const moving = new Set(movingIds);
  if (moving.has(targetId) || !objects.some(o => o.id === targetId)) return objects.slice();
  const picked = objects.filter(o => moving.has(o.id)), rest = objects.filter(o => !moving.has(o.id));
  if (!picked.length) return objects.slice();
  const at = rest.findIndex(o => o.id === targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}
