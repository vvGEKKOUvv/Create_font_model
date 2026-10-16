import { PATH_VERTEX_LIMIT, TOTAL_RAW_VERTEX_LIMIT } from "./path-limits.js";
import { Shape, Path } from "three";
import { clean, simplify, valid } from "./path-reduction.js";

const LIMIT = PATH_VERTEX_LIMIT;
const RAW_LIMIT = TOTAL_RAW_VERTEX_LIMIT;
const cache = new WeakMap();
const signedArea = ring => ring.reduce((a,p,i) => {
  const q = ring[(i+1)%ring.length];
  return a + p.x*q.y-q.x*p.y;
},0)/2;
function source(shape) {
  if (cache.has(shape)) return cache.get(shape);
  // Reject before extractPoints allocates very large sampled curves.
  let estimate = 0;
  for (const path of [shape, ...shape.holes]) {
    for (const curve of path.curves) {
      estimate += curve.type === "LineCurve" ? 1 : curve.type === "EllipseCurve" ? 48 : curve.type === "SplineCurve" ? 24*Math.max(1, curve.points.length) : 24;
      if (estimate > RAW_LIMIT) throw new Error("読み込み上限 200,000 頂点を超えています。SVG を分割してください。");
    }
  }
  const extracted = shape.extractPoints(24);
  const raw = [extracted.shape, ...extracted.holes];
  const rawCount = raw.reduce((n,r) => n+r.length,0);
  if (rawCount > RAW_LIMIT + raw.length) throw new Error("読み込み上限 200,000 頂点を超えています。SVG を分割してください。");
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const ring of raw) for (const p of ring) {
    if (!Number.isFinite(p.x)||!Number.isFinite(p.y)) throw new Error("パスに不正な座標があります。");
    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
  }
  const span=Math.hypot(maxX-minX,maxY-minY);
  const epsilon=Math.max(span*1e-10,1e-10);
  const originalCount=raw.reduce((n,r)=>n+r.length-(r.length>1&&r[0].distanceToSquared(r.at(-1))<=epsilon**2?1:0),0);
  const rings=raw.map((r,i)=>{
    const ring=clean(r,epsilon);
    if ((signedArea(ring)>0)!==(i===0)) ring.reverse();
    return ring;
  });
  const entry={rings,originalCount,epsilon,span};
  cache.set(shape,entry);
  return entry;
}
export function inspectImportPath(shape) {
  const entry=source(shape);
  return {overBudget:entry.originalCount>LIMIT,originalCount:entry.originalCount,limit:LIMIT};
}

/** Called only after the user agrees to simplify an oversized import. */
export function reduceImportPath(shape) {
  const entry=source(shape);
  let tolerance=0, candidate=entry.rings;
  const count=rings=>rings.reduce((n,r)=>n+r.length,0);
  let accepted=count(candidate)<=LIMIT && valid(candidate,entry.epsilon);
  // Bounded search starts gently; sharp corners are mandatory anchors.
  for (let attempt=0; !accepted && attempt<32; attempt++) {
    tolerance=Math.max(entry.span*1e-8,entry.epsilon)*2**attempt;
    candidate=entry.rings.map(r=>simplify(r,tolerance,entry.originalCount*64));
    if (count(candidate)<=LIMIT && valid(candidate,entry.epsilon)) accepted=true;
    // Very large errors cannot preserve the outline reliably.
    if (tolerance>=entry.span*.05) break;
  }
  if (!accepted) throw new Error("穴と尖った角を保ったまま処理上限 6,000 頂点まで削減できませんでした。SVG を分割してください。");
  const result=new Shape(candidate[0].map(p=>p.clone()));
  result.closePath();
  result.holes=candidate.slice(1).map(r=>{const hole=new Path(r.map(p=>p.clone()));hole.closePath();return hole;});
  return {shape:result,originalCount:entry.originalCount,reducedCount:count(candidate),tolerance};
}
