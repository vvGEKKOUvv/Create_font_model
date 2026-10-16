// Keep original Three.js shapes outside history so undo retains untouched Bézier curves.
export function snapshotDraft(draft) {
  return { name: draft.name, enabled: draft.enabled, edited: draft.edited, deleted: !!draft.deleted, reductionError: draft.reductionError || "",
    contours: draft.contours.map(c => ({ closed: c.closed, points: c.points.map(p => ({ x: p.x, y: p.y })) })) };
}
export function restoreDraft(draft, snapshot) {
  Object.assign(draft, snapshotDraft(snapshot));
}
export function createDraftHistory(limit = 60) {
  const undo = [], redo = [];
  return {
    get canUndo() { return undo.length > 0; }, get canRedo() { return redo.length > 0; },
    record(index, before, after) {
      if (JSON.stringify(before) === JSON.stringify(after)) return false;
      undo.push({ index, before, after }); if (undo.length > limit) undo.shift(); redo.length = 0; return true;
    },
    recordBatch(changes, activeIndex = changes[0]?.index ?? 0) {
      const retained=changes.filter(change=>JSON.stringify(change.before)!==JSON.stringify(change.after));
      if(!retained.length)return false;
      undo.push({index:activeIndex,changes:retained});if(undo.length>limit)undo.shift();redo.length=0;return true;
    },
    undo(drafts) { const entry = undo.pop(); if (!entry) return null; for(const change of entry.changes||[entry])restoreDraft(drafts[change.index], change.before); redo.push(entry); return entry.index; },
    redo(drafts) { const entry = redo.pop(); if (!entry) return null; for(const change of entry.changes||[entry])restoreDraft(drafts[change.index], change.after); undo.push(entry); return entry.index; },
  };
}
