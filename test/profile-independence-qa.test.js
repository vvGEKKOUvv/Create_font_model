import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareContours } from '../src/path-reduction.js';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, buildMesh } from '../src/geometry.js';

globalThis.DOMParser = DOMParser;
const straight = [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }];
const bent = [{ x: 0, y: 0, mode: 'linear' }, { x: .5, y: .8, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }];
const square = () => parseSvg('<svg><path d="M0 0H100V100H0Z"/></svg>').objects[0].shape;
const annulus = () => parseSvg('<svg><path fill-rule="evenodd" d="M0 0H100V100H0Z M35 35V65H65V35Z"/></svg>').objects[0].shape;

// Sample the actual surface rather than vertex ordering: modifying a profile can
// legitimately change tessellation, but must not move the opposite bevel.
function frontHeight(geometry, x, sourceY, allowMissing = false) {
  const p = geometry.attributes.position, y = -sourceY;
  const hits = [];
  for (let i = 0; i < p.count; i += 3) {
    const ax=p.getX(i), ay=p.getY(i), bx=p.getX(i+1), by=p.getY(i+1), cx=p.getX(i+2), cy=p.getY(i+2);
    const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if (Math.abs(den) < 1e-10) continue;
    const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den;
    const b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den;
    const c=1-a-b;
    if (Math.min(a,b,c) >= -1e-7)
      hits.push(a*p.getZ(i)+b*p.getZ(i+1)+c*p.getZ(i+2));
  }
  if (!hits.length && allowMissing) return undefined;
  assert.ok(hits.length, `surface exists at ${x}, ${sourceY}`);
  return Math.min(...hits);
}
function assertClosed(geometry) {
  const p=geometry.attributes.position, edges=new Map();
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
  assert.ok(Array.from(p.array).every(Number.isFinite));
  for(let i=0;i<p.count;i+=3) for(let j=0;j<3;j++) {
    const a=key(i+j), b=key(i+(j+1)%3);
    assert.notEqual(a,b,'no collapsed mesh edge');
    const id=[a,b].sort().join('|'), edge=edges.get(id)??{count:0,orientation:0};
    edge.count++; edge.orientation+=a<b?1:-1; edges.set(id,edge);
  }
  for(const edge of edges.values()) {
    assert.equal(edge.count,2,'each bevel edge remains watertight');
    assert.equal(edge.orientation,0,'shared edge winding remains opposite');
  }
}
for(const bevelWidth of [3,5,10]) test(`hollow surface profiles remain independent at width ${bevelWidth}`,()=>{
  const shape=square(), settings={depth:30,bevelSize:8,bevelWidth,bevelSegments:5,hollow:true,wallThickness:10,bevelContinue:true,curvePoints:straight,innerCurvePoints:straight};
  const base=buildMesh(shape,settings);
  const outer=buildMesh(shape,{...settings,curvePoints:bent});
  const inner=buildMesh(shape,{...settings,innerCurvePoints:bent});
  for(const g of [base,outer,inner]) assertClosed(g);
  for(const x of [30.37,50.19,70.41]) {
    assert.ok(Math.abs(frontHeight(base,x,9)-frontHeight(outer,x,9))<.002,'outer edits do not move inner surface');
    assert.ok(Math.abs(frontHeight(base,x,1)-frontHeight(inner,x,1))<.002,'inner edits do not move outer surface');
    assert.ok(Math.abs(frontHeight(base,x,1)-frontHeight(outer,x,1))>.05,'outer edit moves outer surface');
    assert.ok(Math.abs(frontHeight(base,x,9)-frontHeight(inner,x,9))>.05,'inner edit moves inner surface');
  }
  for(const g of [base,outer,inner]) g.dispose();
});
test('native-hole hollow perimeter walls also keep opposite profile unchanged',()=>{
  const settings={depth:30,bevelSize:8,bevelWidth:3,bevelSegments:5,hollow:true,wallThickness:6,bevelContinue:true,curvePoints:straight,innerCurvePoints:straight};
  const shape=annulus(), base=buildMesh(shape,settings);
  const outer=buildMesh(shape,{...settings,curvePoints:bent});
  const inner=buildMesh(shape,{...settings,innerCurvePoints:bent});
  for(const g of [base,outer,inner]) assertClosed(g);
  for(const [x,y,changed] of [[50.31,5,outer],[50.31,1,inner],[50.31,30,inner],[50.31,34,outer]])
    assert.ok(Math.abs(frontHeight(base,x,y)-frontHeight(changed,x,y))<.002,'both imported boundary components preserve their opposite-side profile');
  for(const g of [base,outer,inner]) g.dispose();
});

const fixtureSvg = await readFile(new URL('./fixtures/hollow-acute-curves.svg',import.meta.url),'utf8');
test('uploaded sharp curved hollow path keeps outer surface fixed during inner edits',()=>{
  const shape=parseSvg(fixtureSvg).objects[0].shape;
  const settings={depth:64,bevelSize:8,bevelWidth:17.031,bevelSegments:3,hollow:true,wallThickness:17.031,bevelContinue:true,curvePoints:straight,innerCurvePoints:straight};
  const base=buildMesh(shape,settings), changed=buildMesh(shape,{...settings,innerCurvePoints:bent});
  const ring=prepareContours(shape,0).rings[0];
  const area=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.x*b.y-b.x*a.y;},0);
  const side=area>0?1:-1;
  let tested=0;
  for(let i=0;i<ring.length;i+=Math.max(1,Math.floor(ring.length/30))) {
    const a=ring[i], b=ring[(i+1)%ring.length], dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
    if(len<.1) continue;
    const x=(a.x+b.x)/2-side*dy/len*.3, y=(a.y+b.y)/2+side*dx/len*.3;
    const before=frontHeight(base,x,y,true);
    // Very short edges at an acute tip can have no material .3 units inward.
    if (before === undefined) continue;
    const after=frontHeight(changed,x,y);
    assert.ok(Math.abs(before-after)<.002,'inner edits leave outer curved and sharp regions unchanged');
    tested++;
  }
  assert.ok(tested>=15,'sampled across uploaded source contour');
  assertClosed(base); assertClosed(changed);
  base.dispose();changed.dispose();
});

test('a fixed curved Bezier surface stays unchanged when only the opposite profile changes',()=>{
  const curved=[{x:0,y:0,mode:'bezier'},{x:.5,y:.8,mode:'bezier'},{x:1,y:1,mode:'bezier'}];
  const shape=square(),settings={depth:30,bevelSize:8,bevelWidth:5,bevelSegments:5,hollow:true,wallThickness:10,bevelContinue:true,curvePoints:curved,innerCurvePoints:curved};
  const base=buildMesh(shape,settings),outer=buildMesh(shape,{...settings,curvePoints:straight}),inner=buildMesh(shape,{...settings,innerCurvePoints:straight});
  for(const y of [.7,1.9,3.7]) {
    assert.ok(Math.abs(frontHeight(base,40.37,y)-frontHeight(inner,40.37,y))<.002,'curved outer surface stays fixed');
    assert.ok(Math.abs(frontHeight(base,40.37,10-y)-frontHeight(outer,40.37,10-y))<.002,'curved inner surface stays fixed');
  }
  for(const g of [base,outer,inner]) {assertClosed(g);g.dispose();}
});
