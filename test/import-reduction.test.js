import test from "node:test";
import assert from "node:assert/strict";
import {Shape,Path,Vector2} from "three";
import {inspectImportPath,reduceImportPath} from "../src/import-reduction.js";
import {prepareContours} from "../src/path-reduction.js";
const circle=(n,r=100)=>Array.from({length:n},(_,i)=>new Vector2(r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n)));
function shape(points,holes=[]) {const s=new Shape(points);s.closePath();s.holes=holes.map(p=>{const h=new Path(p);h.closePath();return h;});return s;}

test("approved import reduces 5k,25k,100k outlines to processable contours without mutation",()=>{
  for(const n of [5000,25000,100000]) {
    const original=shape(circle(n));
    const curves=original.curves.length;
    assert.deepEqual(inspectImportPath(original),{overBudget:true,originalCount:n,limit:3000});
    const result=reduceImportPath(original);
    assert.notEqual(result.shape,original);
    assert.ok(result.reducedCount<=3000);
    assert.ok(result.reducedCount>100);
    assert.equal(original.curves.length,curves);
    assert.equal(prepareContours(result.shape).reducedCount,result.reducedCount);
    for(const p of result.shape.extractPoints(1).shape) assert.ok(Math.abs(p.length()-100)<1e-8);
  }
});

test("approved reduction preserves existing hole and an acute corner",()=>{
  const outline=[];
  const vertices=[new Vector2(-100,-60),new Vector2(100,-60),new Vector2(0,300)];
  for(let side=0;side<3;side++) for(let i=0;i<2000;i++) outline.push(vertices[side].clone().lerp(vertices[(side+1)%3],i/2000));
  const original=shape(outline,[circle(4000,20).reverse()]);
  assert.equal(inspectImportPath(original).overBudget,true);
  const result=reduceImportPath(original);
  const rings=prepareContours(result.shape).rings;
  assert.equal(rings.length,2);
  assert.ok(rings[0].some(p=>p.distanceTo(vertices[2])<1e-9));
  assert.ok(result.reducedCount<=3000);
  assert.equal(original.holes[0].curves.length,4000);
});

test("too many mandatory corners are rejected rather than silently distorted",()=>{
  const points=Array.from({length:4000},(_,i)=>{
    const a=i*2*Math.PI/4000,r=i%2?50:100;return new Vector2(r*Math.cos(a),r*Math.sin(a));
  });
  assert.throws(()=>reduceImportPath(shape(points)),/削減できません/);
});

test("hard import cap and invalid coordinates fail before geometry generation",()=>{
  assert.throws(()=>inspectImportPath(shape(circle(200001))),/200,000/);
  assert.throws(()=>inspectImportPath(shape([new Vector2(0,0),new Vector2(NaN,1),new Vector2(1,0)])),/不正/);
});

test("small imports do not request reduction and legacy raw limit remains enforced",()=>{
  assert.equal(inspectImportPath(shape(circle(50))).overBudget,false);
  assert.throws(()=>prepareContours(shape(circle(25000))),/20,000/);
});
