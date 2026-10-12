import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../src/history.js';

function fixture(options = {}) {
  let state = { value: 0, objects: [{ name: 'A', visible: true }] };
  let failRestore = false;
  const history = createHistory({capture: () => structuredClone(state), restore: next => { if (failRestore) throw Error('restore failed'); state = structuredClone(next); }, ...options});
  return {history, get state() {return state;}, fail() {failRestore = true;}, recover() {failRestore = false;}};
}

test('history restores geometry settings, names and visibility, and redoes committed state', () => {
  const f = fixture();
  f.state.value = 2; f.state.objects[0].name = 'B'; f.state.objects[0].visible = false; f.history.commit();
  assert.equal(f.history.canUndo, true); assert.equal(f.history.undo(), true);
  assert.deepEqual(f.state, {value:0, objects:[{name:'A',visible:true}]});
  assert.equal(f.history.redo(), true);
  assert.deepEqual(f.state, {value:2, objects:[{name:'B',visible:false}]});
  assert.equal(f.history.redo(), false);
  f.history.dispose();
});

test('history commits pending changes on undo and discards redo after a new edit', () => {
  const f = fixture();
  f.state.value = 1; f.history.record(); f.state.value = 2; f.history.record();
  assert.equal(f.history.undo(), true); assert.equal(f.state.value, 0);
  assert.equal(f.history.canRedo, true);
  f.state.value = 3;
  assert.equal(f.history.redo(), false);
  assert.equal(f.state.value, 3); assert.equal(f.history.canRedo, false);
  assert.equal(f.history.undo(), true); assert.equal(f.state.value, 0);
  f.history.dispose();
});

test('history groups rapid edits, omits identical snapshots, and bounds retained history', async () => {
  const f = fixture({delay:10, limit:2});
  f.state.value = 1; f.history.record(); f.state.value = 2; f.history.record();
  await new Promise(resolve => setTimeout(resolve, 30));
  f.history.commit(); f.state.value = 3; f.history.commit(); f.state.value = 4; f.history.commit();
  assert.equal(f.history.undo(), true); assert.equal(f.state.value, 3);
  assert.equal(f.history.undo(), true); assert.equal(f.state.value, 2);
  assert.equal(f.history.undo(), false);
  f.history.dispose();
});

test('failed restore preserves history for a successful retry', () => {
  const f = fixture(); f.state.value = 1; f.history.commit(); f.fail();
  assert.throws(() => f.history.undo(), /restore failed/);
  assert.equal(f.history.canUndo, true); assert.equal(f.history.canRedo, false); assert.equal(f.state.value, 1);
  f.recover(); assert.equal(f.history.undo(), true); assert.equal(f.state.value, 0);
  f.history.dispose();
});
