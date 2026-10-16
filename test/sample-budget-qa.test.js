import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, Path } from 'three';
import { buildMesh } from '../src/geometry.js';

function rectangle() {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(100, 0); shape.lineTo(100, 70); shape.lineTo(0, 70); shape.closePath();
  return shape;
}
const curved = [
  {x:0,y:0,mode:'bezier',handleMode:'free',out:{x:.7,y:.05}},
  {x:1,y:1,mode:'bezier',handleMode:'free',in:{x:.8,y:.2}},
];
function closed(geometry) {
  for (const name of ['position','normal','uv']) assert.ok([...geometry.attributes[name].array].every(Number.isFinite));
  const position = geometry.attributes.position, index = geometry.index;
  const vertex = i => [position.getX(i),position.getY(i),position.getZ(i)].map(v => Math.round(v*1e5)).join(',');
  const edges = new Map();
  for (let i=0;i<(index?.count??position.count);i+=3) {
    const vertices=[0,1,2].map(j=>vertex(index?index.getX(i+j):i+j));
    for(let j=0;j<3;j++) {
      const a=vertices[j], b=vertices[(j+1)%3], key=[a,b].sort().join('|');
      const item=edges.get(key)??{count:0,direction:0};
      item.count++; item.direction+=a<b?1:-1; edges.set(key,item);
    }
  }
  for(const item of edges.values()) {assert.equal(item.count,2);assert.equal(item.direction,0);}
}

test('QA: curved Bezier bevel uses only requested uniform levels at low and high budgets', () => {
  for (const bevelSegments of [1,2,5]) {
    const geometry=buildMesh(rectangle(),{depth:30,bevelSize:7,bevelWidth:6,bevelSegments,curvePoints:curved,bevelContinue:true});
    assert.equal(geometry.userData.bevelSamples.length,bevelSegments+2);
    closed(geometry);
  }
});

test('QA: inserted collinear curve vertex remains a mandatory edge within straight roof', () => {
  const points=[0,.37,1].map(x=>({x,y:x,mode:'linear'}));
  const geometry=buildMesh(rectangle(),{depth:30,bevelSize:7,bevelWidth:6,bevelSegments:1,curvePoints:points,bevelContinue:true});
  assert.deepEqual(geometry.userData.bevelSamples,[0,.185,.37,.685,1]);
  const position=geometry.attributes.position;
  assert.ok(Array.from({length:position.count},(_,i)=>position.getZ(i)).some(z=>Math.abs(z-7*.37)<1e-5),'added control has actual mesh edge level');
  closed(geometry);
});

test('QA: independent inner curve with endpoint controls adds no hidden approximation cuts and retains hole', () => {
  const shape=rectangle(),hole=new Path();
  hole.moveTo(20,20);hole.lineTo(20,50);hole.lineTo(80,50);hole.lineTo(80,20);hole.closePath();shape.holes.push(hole);
  const inner=[{x:0,y:0,mode:'linear'},{x:1,y:1,mode:'linear'}];
  const geometry=buildMesh(shape,{depth:30,bevelSize:7,bevelWidth:6,bevelSegments:2,curvePoints:curved,innerCurvePoints:inner,bevelContinue:true});
  assert.equal(geometry.userData.bevelSamples.length,4);
  closed(geometry);
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i+=3) {
    const xs=[0,1,2].map(j=>p.getX(i+j)), ys=[0,1,2].map(j=>-p.getY(i+j));
    assert.ok(!(xs.every(x=>x>20&&x<80)&&ys.every(y=>y>20&&y<50)),'no triangle contained in hole');
  }
});

test('QA: each explicit control interval receives its own division budget', () => {
  for (const anchor of [.5,.37]) {
    const points=[0,anchor,1].map(x=>({x,y:x,mode:'bezier',handleMode:'aligned'}));
    const geometry=buildMesh(rectangle(),{depth:30,bevelSize:7,bevelWidth:6,bevelSegments:5,curvePoints:points,bevelContinue:true});
    assert.equal(geometry.userData.bevelSamples.length,13,'five interior loops in each of two control spans');
    if(anchor!==.5) assert.ok(geometry.userData.bevelSamples.some(t=>Math.abs(t-anchor)<1e-8),'explicit anchor preserved');
    closed(geometry);
  }
});
