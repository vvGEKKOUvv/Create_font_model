import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOffsetBevelRoof, triangulateOffsetBevelRoof } from '../src/offset-bevel-roof.js';

const acuteCavity = () => [
  [{x:-150,y:-50},{x:150,y:-50},{x:150,y:50},{x:-150,y:50}],
  [{x:0,y:0},{x:100,y:3},{x:100,y:-3}],
];

test('acute cavity offset retains one exact bisector rail instead of clipped miter fans', () => {
  const roof = prepareOffsetBevelRoof(acuteCavity());
  const points = [];
  for (const inset of [0.1, 1, 3]) {
    const loops = roof.inset(inset);
    assert.deepEqual(loops.map(loop => loop.length), [4, 3]);
    assert.ok(loops.flat().every(p => Number.isInteger(p.sourceIndex)));
    const tip = loops[1].find(p => p.sourceIndex === 0);
    assert.ok(tip.X / roof.scale + roof.origin.x < 0, 'acute cavity expands towards the opposing wall');
    assert.equal(tip.Y / roof.scale + roof.origin.y, 0);
    points.push(tip);
    const triangles = triangulateOffsetBevelRoof(roof, inset, [0,0.25,0.5,0.75,1], t => t);
    assert.ok(triangles.length > 0);
    assert.ok(triangles.flatMap(t => t.points).every(p => [p.x,p.y,p.height].every(Number.isFinite)));
  }
  assert.ok(points[1].X < points[0].X && points[2].X < points[1].X);
});

test('acute miter wavefront collision is clipped instead of expanding outside the footprint', () => {
  const rings = acuteCavity();
  const roof = prepareOffsetBevelRoof(rings);
  // The cavity tip reaches the outer wall before a uniform-width inset can
  // preserve every source vertex. The polygon operation must resolve that
  // collision, rather than extending an unbounded corner outside the model.
  const loops = roof.inset(6);
  assert.ok(loops.flat().every(p => {
    const x=p.X/roof.scale+roof.origin.x, y=p.Y/roof.scale+roof.origin.y;
    return x>=-150 && x<=150 && y>=-50 && y<=50;
  }));
});

test('hollowing an imported acute hole preserves original and expanded tips on one straight bisector', async () => {
  const { hollowFilledRegion } = await import('../src/hollow-offset.js');
  const { DOMParser } = await import('@xmldom/xmldom');
  const { parseSvg, buildMesh } = await import('../src/geometry.js');
  globalThis.DOMParser = DOMParser;
  const shape = parseSvg('<svg><path fill-rule="evenodd" d="M-150 -50H150V50H-150Z M0 0L100 3L100 -3Z"/></svg>').objects[0].shape;
  const source = shape.extractPoints(1);
  const rings = [source.shape, ...source.holes];
  const hollow = hollowFilledRegion(rings, 1);
  assert.equal(hollow.components.length, 2);
  const triangularWall = hollow.components.find(component => Math.max(...component[0].map(p => p.x)) < 120);
  assert.ok(triangularWall);
  const expanded = triangularWall[0];
  assert.equal(expanded.length, 3, 'acute tip is not replaced by a flat truncation edge');
  const tip = expanded.reduce((a,b) => a.x < b.x ? a : b);
  assert.ok(tip.x < -30 && tip.x > -35);
  assert.equal(tip.y, 0);
  assert.ok(triangularWall[1].some(p => p.x === 0 && p.y === 0), 'native tip is unchanged');
  const geometry = buildMesh(shape, { hollow:true, wallThickness:1, depth:10, bevelSize:0.25,
    bevelWidth:0.25, bevelSegments:1, bevelContinue:true });
  assert.equal(geometry.userData.hollowComponentCount, 2);
  assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
  geometry.dispose();
});
