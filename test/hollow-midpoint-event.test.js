import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh } from '../src/geometry.js';
import { prepareContours } from '../src/path-reduction.js';
import { prepareHollowMidpointRoof } from '../src/hollow-midpoint-roof.js';
import { triangulateBevelRoof } from '../src/bevel-roof.js';
import { validateRoofTriangles } from '../src/roof-topology.js';

globalThis.DOMParser = DOMParser;
const shape = parseSvg(await readFile(new URL('./fixtures/hollow-acute-curves.svg', import.meta.url), 'utf8')).objects[0].shape;
const ring = prepareContours(shape, 0).rings[0];
for (const {wall,width,segments,profile} of [
  {wall:17.031,width:6.8124,segments:6,profile:t=>t},
  {wall:5.713,width:2.2852,segments:12,profile:t=>t*t},
]) test(`hollow midpoint keeps shared topology when a profile cut nearly coincides with an event (wall ${wall})`, () => {
  const roof = prepareHollowMidpointRoof(ring, wall);
  assert.ok(roof);
  const samples = Array.from({length:segments+2},(_,i)=>i/(segments+1));
  const triangles = triangulateBevelRoof(roof,width,samples,profile);
  validateRoofTriangles(triangles,roof.rings);
  assert.ok(triangles.length > 1000);
  for (const {points} of triangles) for (const p of points)
    assert.ok([p.x,p.y,p.height].every(Number.isFinite));
});

test('fold uses exact shared distance when a skeleton event lies next to the midpoint', () => {
  for (const wall of [2.249581,27.777341]) {
    const roof=prepareHollowMidpointRoof(ring,wall);
    assert.ok(roof,`wall ${wall} retains the folded partition`);
    const triangles=triangulateBevelRoof(roof,wall/2,[0,.5,1],t=>t);
    validateRoofTriangles(triangles,roof.rings);
  }
});
test('production uploaded hollow remains closed with narrow wall and a curved profile', () => {
  const curvePoints=[
    {x:0,y:0,mode:'bezier',out:{x:1/3,y:0}},
    {x:1,y:1,mode:'bezier',in:{x:2/3,y:1/3}},
  ];
  for (const bevelSegments of [11,12]) {
    const geometry=buildMesh(shape,{depth:60,bevelSize:20,bevelWidth:2.2852,bevelSegments,bevelContinue:true,hollow:true,wallThickness:5.713,curvePoints});
    assert.ok(!geometry.userData.warnings.some(w=>/通常ベベル|安全な最大幅/.test(w)));
    const p=geometry.attributes.position,edges=new Map();
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].join(',');
    for(let i=0;i<p.count;i+=3)for(let j=0;j<3;j++){
      const a=key(i+j),b=key(i+(j+1)%3);
      assert.notEqual(a,b);
      const k=[a,b].sort().join('|'),entry=edges.get(k)||[0,0];
      entry[0]++;entry[1]+=a<b?1:-1;edges.set(k,entry);
    }
    for(const [count,winding] of edges.values()){assert.equal(count,2);assert.equal(winding,0);}
    geometry.dispose();
  }
});
