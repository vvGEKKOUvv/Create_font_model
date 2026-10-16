import { PATH_VERTEX_LIMIT, EDITOR_RAW_VERTEX_LIMIT } from "./path-limits.js";
import { Shape, Path, Vector2, ShapeUtils } from "three";
import { parseSvg } from "./geometry.js";
import ClipperLib from "clipper-lib";
import { clean, simplify } from "./path-reduction.js";

export const PATH_EDITOR_VERTEX_LIMIT = PATH_VERTEX_LIMIT;
const pointCopy = p => ({ x: p.x, y: p.y });
const copyContours = contours => contours.map(c => ({ closed: c.closed, points: c.points.map(pointCopy) }));
function extract(shape) {
  const extracted = shape.extractPoints(24);
  return [extracted.shape, ...extracted.holes].map(points => {
    if (points.length > 1 && points[0].distanceToSquared(points.at(-1)) < 1e-16) points = points.slice(0, -1);
    return { points: points.map(pointCopy), closed: true };
  });
}
export function createPathDrafts(text) {
  const { objects, warnings } = parseSvg(text, { forEditing: true });
  return { warnings, drafts: createObjectDrafts(objects) };
}
export function createObjectDrafts(objects) {
  return objects.map(entry => {
    let contours = entry.editorContours || extract(entry.shape);
    const epsilon = epsilonOf(contours.map(c => c.points));
    contours = contours.map(c => {
      if (!c.closed) {
        const points = c.points.filter((p, i) => !i || Math.hypot(p.x - c.points[i - 1].x, p.y - c.points[i - 1].y) > epsilon);
        return { ...c, points };
      }
      try { return { ...c, points: clean(c.points, epsilon).map(pointCopy) }; }
      catch { return c; } // Invalid outlines remain visible so they can be repaired.
    });
    return { id: entry.id, name: entry.name, layerName: entry.layerName || "", color: entry.color,
      sourceOriginalName: entry.sourceOriginalName || entry.name,
      ...(entry.sourceKey !== undefined ? { sourceKey: entry.sourceKey, sourceElementId: entry.sourceElementId, sourceShapeIndex: entry.sourceShapeIndex, sourceIdentityAmbiguous: !!entry.sourceIdentityAmbiguous } : {}),
      enabled: true, edited: false, originalShape: entry.shape,
      ...(entry.referenceShape ? { referenceShape: entry.referenceShape, referenceContours: extract(entry.referenceShape) } : {}), contours: copyContours(contours),
      originalContours: copyContours(contours) };
  });
}
function normalizedRings(contours) {
  return contours.map((contour, index) => {
    const ring = contour.points.map(p => new Vector2(p.x, p.y));
    if (ShapeUtils.area(ring) > 0 !== (index === 0)) ring.reverse();
    return ring;
  });
}
function epsilonOf(rings) {
  const all = rings.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return Math.max(1e-10, Math.hypot(maxX - minX, maxY - minY) * 1e-10);
}
const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function pointInside(point, ring) {
  let result = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) result=!result;
  }
  return result;
}
function intersection(a,b,c,d,epsilon) {
  const threshold=epsilon*Math.max(Math.hypot(b.x-a.x,b.y-a.y),Math.hypot(d.x-c.x,d.y-c.y),epsilon);
  const sign=n=>n>threshold?1:n< -threshold?-1:0;
  if (sign(cross(a,b,c))*sign(cross(a,b,d))>0 || sign(cross(c,d,a))*sign(cross(c,d,b))>0) return null;
  const dx=b.x-a.x,dy=b.y-a.y,ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;
  if (Math.abs(den)>threshold) { const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den; return {x:a.x+t*dx,y:a.y+t*dy}; }
  return {x:(Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))+Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)))/2,y:(Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))+Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y)))/2};
}
/** Bounded diagnostics retain original contour/edge indices for visible repair hints. */
export function diagnoseDraft(draft, {maxComparisons=250000,maxIssues=24}={}) {
  const contours=draft.contours, vertexCount=contours.reduce((n,c)=>n+c.points.length,0);
  const issues=[]; let comparisonCount=0,complete=true;
  const add=(type,message,edges=[],points=[])=>{ if(issues.length<maxIssues) issues.push({type,message,edges,points}); };
  const finite=p=>Number.isFinite(p.x)&&Number.isFinite(p.y);
  const epsilon=epsilonOf(contours.map(c=>c.points.filter(finite)));
  if (!contours.length) add('empty','輪郭がありません。');
  const edges=[];
  contours.forEach((contour,ci)=>{
    if (!contour.closed) add('open',`輪郭${ci+1}が開いています。「輪郭を閉じる」で閉じてください。`,[],contour.points.length?[contour.points[0],contour.points.at(-1)].filter(finite):[]);
    if (contour.points.length<3) add('too-few-points',`輪郭${ci+1}には3頂点以上必要です。`,[],contour.points.filter(finite));
    let area=0;
    for(let pi=0;pi<contour.points.length;pi++) {
      const p=contour.points[pi],q=contour.points[(pi+1)%contour.points.length];
      if(!finite(p)) {add('coordinate',`輪郭${ci+1}の頂点${pi+1}に不正な座標があります。`);continue;}
      if(!q||!finite(q)||(!contour.closed&&pi===contour.points.length-1))continue;
      const edge={contourIndex:ci,edgeIndex:pi};
      if(Math.hypot(p.x-q.x,p.y-q.y)<=epsilon) add('duplicate',`輪郭${ci+1}の辺${pi+1}が重複頂点で潰れています。`,[edge],[p]);
      edges.push({a:p,b:q,...edge,minX:Math.min(p.x,q.x),maxX:Math.max(p.x,q.x),minY:Math.min(p.y,q.y),maxY:Math.max(p.y,q.y)});
      area+=p.x*q.y-q.x*p.y;
    }
    if(contour.closed&&contour.points.length>=3&&Math.abs(area)<=epsilon**2) add('area',`輪郭${ci+1}の面積がありません。交差や折り返しを確認してください。`,[],contour.points.slice(0,1).filter(finite));
  });
  if(vertexCount>PATH_EDITOR_VERTEX_LIMIT) add('vertex-limit',`頂点数が処理上限 ${PATH_EDITOR_VERTEX_LIMIT.toLocaleString()} を超えています。リダクションしてください。`);
  edges.sort((a,b)=>a.minX-b.minX);
  pairLoop:for(let i=0;i<edges.length;i++) for(let j=i+1;j<edges.length;j++) {
    const a=edges[i],b=edges[j]; if(b.minX>a.maxX+epsilon)break;
    if(++comparisonCount>maxComparisons) {complete=false;break pairLoop;}
    if(a.minY>b.maxY+epsilon||b.minY>a.maxY+epsilon)continue;
    const same=a.contourIndex===b.contourIndex,count=contours[a.contourIndex].points.length;
    if(same&&(Math.abs(a.edgeIndex-b.edgeIndex)===1||(contours[a.contourIndex].closed&&Math.abs(a.edgeIndex-b.edgeIndex)===count-1)))continue;
    const point=intersection(a.a,a.b,b.a,b.b,epsilon); if(!point)continue;
    const type=same?'self-crossing':'contour-crossing';
    add(type,`輪郭${a.contourIndex+1}の辺${a.edgeIndex+1}と輪郭${b.contourIndex+1}の辺${b.edgeIndex+1}が交差・接触しています。`,[{contourIndex:a.contourIndex,edgeIndex:a.edgeIndex},{contourIndex:b.contourIndex,edgeIndex:b.edgeIndex}],[point]);
    if(issues.length>=maxIssues)break pairLoop;
  }
  for(let ci=1;complete&&ci<contours.length&&issues.length<maxIssues;ci++) {
    const ring=contours[ci].points,outer=contours[0]?.points;if(!ring.length||!outer?.length||!ring.every(finite))continue;
    if(comparisonCount+outer.length>maxComparisons){complete=false;break;}comparisonCount+=outer.length;
    if(!pointInside(ring[0],outer)) add('outside-hole',`穴の輪郭${ci+1}が外側の輪郭1の外にあります。`,[{contourIndex:ci,edgeIndex:0}],[ring[0]]);
    for(let cj=1;cj<ci&&issues.length<maxIssues;cj++) {
      const other=contours[cj].points;if(!other.length||!other.every(finite))continue;
      if(comparisonCount+ring.length+other.length>maxComparisons){complete=false;break;}comparisonCount+=ring.length+other.length;
      if(pointInside(ring[0],other)||pointInside(other[0],ring))add('nested-hole',`穴の輪郭${ci+1}と輪郭${cj+1}が入れ子になっています。別のパスに分けてください。`,[{contourIndex:ci,edgeIndex:0},{contourIndex:cj,edgeIndex:0}],[ring[0],other[0]]);
    }
  }
  if(!complete)add('complexity','交差の確認が処理上限に達しました。パスを分割するか頂点を削減してください。');
  return {issues,complete,comparisonCount,vertexCount};
}
export function validateDraft(draft) {
  const result=diagnoseDraft(draft);
  return {...result,valid:result.issues.length===0&&result.complete,errors:result.issues.map(issue=>issue.message)};
}
/** Explicit conservative normalization. Never silently split objects or consume holes. */
export function repairDraft(draft) {
  const before=validateDraft(draft),fail=message=>({...before,applied:false,message});
  if(before.vertexCount>PATH_EDITOR_VERTEX_LIMIT)return fail('修復は6,000頂点以内で行えます。先に頂点を削減してください。');
  if(draft.contours.some(c=>!c.closed||c.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))return fail('開いた輪郭は先に閉じ、不正な座標を修正してください。');
  if(before.issues.some(i=>['outside-hole','nested-hole','contour-crossing'].includes(i.type)))return fail('穴と外周の交差・入れ子は自動修復しません。赤い箇所の頂点を手動で調整してください。');
  const epsilon=epsilonOf(draft.contours.map(c=>c.points));
  const contours=draft.contours.map(c=>{
    const points=c.points.filter((p,i)=>!i||Math.hypot(p.x-c.points[i-1].x,p.y-c.points[i-1].y)>epsilon).map(pointCopy);
    if(points.length>1&&Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<=epsilon)points.pop();
    return {closed:true,points};
  });
  if(contours.some(c=>c.points.length<3))return fail('面積のある輪郭を作れません。頂点を手動で調整してください。');
  let candidate={...draft,contours};
  if(!validateDraft(candidate).valid){
    const origin=contours[0].points[0];let extent=1;
    for(const c of contours)for(const p of c.points)extent=Math.max(extent,Math.abs(p.x-origin.x),Math.abs(p.y-origin.y));
    const scale=Math.min(1e7,1e14/extent);
    const paths=contours.map(c=>c.points.map(p=>({X:Math.round((p.x-origin.x)*scale),Y:Math.round((p.y-origin.y)*scale)})));
    try {
      const clipper=new ClipperLib.Clipper();clipper.StrictlySimple=true;clipper.AddPaths(paths,ClipperLib.PolyType.ptSubject,true);
      const tree=new ClipperLib.PolyTree();clipper.Execute(ClipperLib.ClipType.ctUnion,tree,ClipperLib.PolyFillType.pftEvenOdd,ClipperLib.PolyFillType.pftEvenOdd);
      const roots=tree.Childs(),holes=roots[0]?.Childs()||[];
      if(roots.length!==1||roots[0].IsHole()||holes.length!==contours.length-1||holes.some(h=>!h.IsHole()||h.ChildCount()))return fail('修復するとパスが分離するか穴が変わるため適用しません。赤い箇所を手動で調整してください。');
      candidate={...draft,contours:[roots[0],...holes].map(node=>({closed:true,points:node.Contour().map(p=>({x:p.X/scale+origin.x,y:p.Y/scale+origin.y}))}))};
    }catch{return fail('この交差は自動修復できません。赤い箇所を手動で調整してください。');}
  }
  const result=validateDraft(candidate);if(!result.valid)return fail('安全な輪郭を作れませんでした。赤い箇所を手動で調整してください。');
  if(JSON.stringify(draft.contours)===JSON.stringify(candidate.contours))return {...before,applied:false,message:'修復が必要な重複や交差はありません。'};
  draft.contours=copyContours(candidate.contours);draft.edited=true;
  return {...result,applied:true,message:'重複・交差を整理しました。形状を確認してください。変更は元に戻せます。'};
}
export function resetReferenceDraft(draft) {
  if(!draft.referenceContours)return {applied:false,...validateDraft(draft)};
  draft.contours=copyContours(draft.referenceContours);if(draft.deleted)draft.enabled=true;draft.deleted=false;draft.edited=true;
  return {applied:true,...validateDraft(draft)};
}
export function toImportEntry(draft) {
  const result = validateDraft(draft);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  let shape = draft.originalShape;
  if (draft.edited && draft.referenceShape && draft.contours.length===draft.referenceContours.length && draft.contours.every((c,i)=>c.closed===draft.referenceContours[i].closed && c.points.length===draft.referenceContours[i].points.length && c.points.every((p,j)=>p.x===draft.referenceContours[i].points[j].x&&p.y===draft.referenceContours[i].points[j].y))) shape=draft.referenceShape;
  else if (draft.edited) {
    const rings = normalizedRings(draft.contours);
    shape = new Shape(rings[0]);
    shape.autoClose = true;
    shape.holes = rings.slice(1).map(ring => { const hole = new Path(ring); hole.autoClose = true; return hole; });
  }
  return { id: draft.id, name: draft.name, layerName: draft.layerName, color: draft.color, shape,
    sourceOriginalName: draft.sourceOriginalName || draft.name,
    ...(draft.sourceKey !== undefined ? { sourceKey: draft.sourceKey, sourceElementId: draft.sourceElementId, sourceShapeIndex: draft.sourceShapeIndex, sourceIdentityAmbiguous: !!draft.sourceIdentityAmbiguous } : {}) };
}
export function moveDraftPoint(draft, contourIndex, pointIndex, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const point = draft.contours[contourIndex]?.points[pointIndex];
  if (!point) return false;
  point.x = x; point.y = y; draft.edited = true;
  return true;
}
export function deleteDraftPoint(draft, contourIndex, pointIndex) {
  const contour = draft.contours[contourIndex];
  if (!contour || !Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= contour.points.length || contour.points.length <= (contour.closed ? 3 : 2)) return false;
  contour.points.splice(pointIndex, 1); draft.edited = true; return true;
}
/** Delete one selection atomically; collapsed holes disappear, collapsed outer removes the path. */
export function deleteDraftPoints(draft, selections) {
  const byContour = new Map();
  for (const {ci, pi} of selections) {
    const contour=draft.contours[ci];
    if(!contour || !Number.isInteger(pi) || pi<0 || pi>=contour.points.length) continue;
    if(!byContour.has(ci))byContour.set(ci,new Set());byContour.get(ci).add(pi);
  }
  if(!byContour.size)return {deletedPoints:0,removedContours:0,removedPath:false};
  const deletedPoints=[...byContour.values()].reduce((n,set)=>n+set.size,0);
  const outer=draft.contours[0];
  if(byContour.has(0) && outer.points.length-byContour.get(0).size<=2){
    const removedContours=draft.contours.length;
    draft.contours=[];draft.enabled=false;draft.deleted=true;draft.edited=true;
    return {deletedPoints,removedContours,removedPath:true};
  }
  const before=draft.contours.length;
  draft.contours=draft.contours.map((contour,ci)=>byContour.has(ci)?{...contour,points:contour.points.filter((_,pi)=>!byContour.get(ci).has(pi))}:contour).filter((contour,ci)=>ci===0 || !byContour.has(ci) || contour.points.length>2);
  draft.edited=true;
  return {deletedPoints,removedContours:before-draft.contours.length,removedPath:false};
}
export function closeDraft(draft) {
  for (const contour of draft.contours) {
    const first = contour.points[0], last = contour.points.at(-1);
    if (first && last && contour.points.length > 1 && first.x === last.x && first.y === last.y) contour.points.pop();
    contour.closed = true;
  }
  draft.edited = true;
  return validateDraft(draft);
}
export function resetDraft(draft) {
  draft.contours = copyContours(draft.originalContours); if(draft.deleted)draft.enabled=true; draft.deleted=false; draft.edited = false;
  return validateDraft(draft);
}
export function simplifyDraft(draft, tolerance) {
  tolerance = Number(tolerance);
  if (!(tolerance > 0)) return { applied: false, ...validateDraft(draft) };
  if (draft.contours.some(c => !c.closed)) return { applied: false, ...validateDraft(draft) };
  const diagnosis=validateDraft(draft);
  if (diagnosis.issues.some(issue=>!['vertex-limit','complexity'].includes(issue.type))) return {applied:false,...diagnosis,errors:['リダクションは交差の修復には使えません。先に赤い箇所を調整するか「輪郭を修復」を使用してください。',...diagnosis.errors]};
  const original = normalizedRings(draft.contours);
  if (original.reduce((n, r) => n + r.length, 0) > EDITOR_RAW_VERTEX_LIMIT) return { applied: false, valid: false, errors: ["頂点数が多すぎます。SVG を分割してください（最大 40,000）。"], vertexCount: original.reduce((n, r) => n + r.length, 0) };
  for (let attempt = 0; attempt < 7; attempt++) {
    const candidate = original.map(r => simplify(r, tolerance / 2 ** attempt, 2_000_000));
    if (candidate.reduce((n, r) => n + r.length, 0) > PATH_EDITOR_VERTEX_LIMIT || !validateDraft({...draft,contours:candidate.map(points=>({points,closed:true}))}).valid) continue;
    draft.contours = candidate.map(points => ({ points: points.map(pointCopy), closed: true }));
    draft.edited = true;
    return { applied: true, ...validateDraft(draft) };
  }
  return { applied: false, ...validateDraft(draft) };
}

export function addDraftPoint(draft, contourIndex, segmentIndex, x, y) {
  const contour = draft.contours[contourIndex];
  if (!contour || !Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= contour.points.length || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!contour.closed && segmentIndex === contour.points.length - 1) return false;
  contour.points.splice(segmentIndex + 1, 0, { x, y }); draft.edited = true; return true;
}
