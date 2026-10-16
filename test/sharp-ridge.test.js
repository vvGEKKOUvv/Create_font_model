import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape } from 'three';
import { buildMesh } from '../src/geometry.js';
import { defaultProfile } from '../src/bevel-profile.js';

test('roof bevels keep each control interval subdivision while curved profiles retain their shape', () => {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(120, 0); shape.lineTo(120, 40); shape.lineTo(0, 40); shape.closePath();
  const settings = { depth: 30, bevelSize: 8, bevelWidth: 10, bevelContinue: true,
    hollow: true, wallThickness: 8, curvePoints: defaultProfile() };
  const coarse = buildMesh(shape, { ...settings, bevelSegments: 2 });
  const dense = buildMesh(shape, { ...settings, bevelSegments: 16 });
  assert.ok(coarse.getAttribute('position').count < dense.getAttribute('position').count);
  assert.equal(coarse.userData.bevelSamples.length,7);
  assert.equal(dense.userData.bevelSamples.length,35);
  assert.deepEqual(coarse.boundingBox, dense.boundingBox);
  const curved = [{ x: 0, y: 0, mode: 'linear' }, { x: 0.5, y: 0.75, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }];
  const curvedGeometry = buildMesh(shape, { ...settings, curvePoints: curved, bevelSegments: 16 });
  assert.notDeepEqual(curvedGeometry.getAttribute('position').array, dense.getAttribute('position').array, 'curve shape changes without requiring extra automatic subdivisions');
  assert.equal(curvedGeometry.userData.effectiveBevelDepth, dense.userData.effectiveBevelDepth);
  for (const geometry of [coarse, dense, curvedGeometry]) geometry.dispose();
});
