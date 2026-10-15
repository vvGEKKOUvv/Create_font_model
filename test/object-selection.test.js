import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../src/object-selection.js';

const objects = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const sorted = (selection) => [...selection.ids].sort();
test('plain selection replaces existing set without changing it', () => {
  const previous = new Set(['a', 'c']);
  const result = resolveSelection(objects, previous, 'a', 1);
  assert.deepEqual(sorted(result), ['b']);
  assert.equal(result.activeId, 'b');
  assert.equal(result.anchorId, 'b');
  assert.deepEqual([...previous], ['a', 'c']);
});
test('Ctrl and Cmd toggle individual members and allow an empty selection', () => {
  let result = resolveSelection(objects, new Set(['a']), 'a', 2, { ctrlKey: true });
  assert.deepEqual(sorted(result), ['a', 'c']);
  result = resolveSelection(objects, result.ids, result.anchorId, 2, { metaKey: true });
  assert.deepEqual(sorted(result), ['a']);
  assert.equal(result.activeId, 'a');
  result = resolveSelection(objects, result.ids, result.anchorId, 0, { ctrlKey: true });
  assert.equal(result.ids.size, 0);
  assert.equal(result.activeId, null);
});
test('Shift selects a contiguous range anchored across repeated range changes', () => {
  let result = resolveSelection(objects, new Set(['d']), 'd', 1, { shiftKey: true });
  assert.deepEqual(sorted(result), ['b', 'c', 'd']);
  assert.equal(result.anchorId, 'd');
  result = resolveSelection(objects, result.ids, result.anchorId, 2, { shiftKey: true });
  assert.deepEqual(sorted(result), ['c', 'd']);
  assert.equal(result.activeId, 'c');
});
test('Ctrl Shift adds a range while retaining other selected rows', () => {
  const result = resolveSelection(objects, new Set(['a', 'c']), 'c', 3, { ctrlKey: true, shiftKey: true });
  assert.deepEqual(sorted(result), ['a', 'c', 'd']);
});
test('stale identities and removed anchors do not select unrelated objects', () => {
  const result = resolveSelection(objects, new Set(['removed']), 'removed', 1, { shiftKey: true });
  assert.deepEqual(sorted(result), ['b']);
  const invalid = resolveSelection(objects, new Set(['a', 'removed']), 'removed', -1);
  assert.deepEqual(sorted(invalid), ['a']);
  assert.equal(invalid.anchorId, null);
});
