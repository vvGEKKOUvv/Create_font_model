import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg } from '../src/geometry.js';
import { prepareContours } from '../src/path-reduction.js';
import { prepareHollowMidpointRoof } from '../src/hollow-midpoint-roof.js';

globalThis.DOMParser=DOMParser;
const shape=parseSvg(readFileSync(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8')).objects[0].shape;
const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)}`;
const edge=(a,b)=>[key(a),key(b)].sort().join('|');
for(const reduction of [0,1])for(const wall of [17.031,29.991])
  test(`folded hollow exposes complete shared midpoint rings, wall ${wall}, path reduction ${reduction}`,()=>{
    const roof=prepareHollowMidpointRoof(prepareContours(shape,reduction).rings[0],wall);
    assert.ok(roof);
    assert.ok(roof.midpointLoops.length>0);
    const expected=new Set();
    for(const face of roof.faces)for(let i=0;i<face.length;i++){
      const a=face[i],b=face[(i+1)%face.length];
      if(a.time===wall/2&&b.time===wall/2&&key(a)!==key(b))expected.add(edge(a,b));
    }
    const actual=new Set(),nodes=new Set();
    for(const loop of roof.midpointLoops){
      assert.ok(loop.length>=3);
      for(let i=0;i<loop.length;i++){
        const a=loop[i],b=loop[(i+1)%loop.length];
        assert.equal(a.time,wall/2);
        assert.ok(!nodes.has(key(a)),'meeting nodes are shared, without coincident duplicates');
        nodes.add(key(a));
        const id=edge(a,b);
        assert.ok(!actual.has(id),'the loop never repeats a segment');
        actual.add(id);
      }
    }
    assert.deepEqual(actual,expected,'every roof meeting segment belongs to exactly one closed ring');
  });
