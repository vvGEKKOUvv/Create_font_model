import test from 'node:test';
import assert from 'node:assert/strict';
import {reorderObjectsByDrop} from '../src/object-reorder.js';
const objects='abcd'.split('').map(id=>({id}));
test('drag reorder preserves object identities and selected block order',()=>{
 const next=reorderObjectsByDrop(objects,['a','c'],'d',true);
 assert.deepEqual(next.map(o=>o.id),['b','d','a','c']);assert.equal(next[2],objects[0]);assert.deepEqual(objects.map(o=>o.id),['a','b','c','d']);
 assert.deepEqual(reorderObjectsByDrop(objects,['c','d'],'a').map(o=>o.id),['c','d','a','b']);
});
test('dropping onto the moved selection or an absent row keeps order',()=>{
 assert.deepEqual(reorderObjectsByDrop(objects,['a','b'],'b'),objects);
 assert.deepEqual(reorderObjectsByDrop(objects,['a'],'missing'),objects);
});
