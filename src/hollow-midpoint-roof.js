import { prepareBevelRoof, triangulateBevelRoof } from './bevel-roof.js';
import { validateRoofTriangles } from './roof-topology.js';

const cached = new WeakMap();
const sourceCache = new WeakMap();
function cut(poly, limit, above) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length];
    const ia=above?a.time>=limit:a.time<=limit,ib=above?b.time>=limit:b.time<=limit;
    if(ia)out.push(a);
    if(ia!==ib){const t=(limit-a.time)/(b.time-a.time);out.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),time:limit});}
  }
  return out.filter((p,i)=>Math.hypot(p.x-out[(i+out.length-1)%out.length].x,p.y-out[(i+out.length-1)%out.length].y)>1e-9);
}
// Read the shared meeting line from both sides of the folded roof. Vertices
// use the same Float32 identity as the exported mesh, so coincident copies
// become one node rather than a pair of overlapping wireframe edges. Only
// complete loops are exposed: an ambiguous junction must never be repaired
// with a segment across the cavity.
function midpointLoops(faces, half) {
  const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)}`;
  const segments=new Map();
  for(const face of faces)for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length];
    if(a.time!==half||b.time!==half)continue;
    const ka=key(a),kb=key(b);if(ka===kb)continue;
    segments.set([ka,kb].sort().join('|'),[a,b]);
  }
  const adjacent=new Map();
  const edges=[...segments.values()];
  for(let i=0;i<edges.length;i++)for(const p of edges[i]){
    const k=key(p);if(!adjacent.has(k))adjacent.set(k,[]);adjacent.get(k).push(i);
  }
  if([...adjacent.values()].some(incident=>incident.length!==2))return [];
  const unused=new Set(edges.map((_,i)=>i)),loops=[];
  while(unused.size){
    const first=unused.values().next().value;
    const [start,second]=edges[first];
    const loop=[start];let p=second;unused.delete(first);
    while(key(p)!==key(start)){
      loop.push(p);
      const next=adjacent.get(key(p)).find(i=>unused.has(i));
      if(next===undefined)return [];
      unused.delete(next);const [a,b]=edges[next];p=key(a)===key(p)?b:a;
    }
    if(loop.length<3)return [];
    loops.push(loop);
  }
  return loops;
}
// A generated cavity is an outer wavefront at wall thickness W. Folding the
// solid roof at W/2 retains its meeting ridge independently of requested width.
// The cavity boundary is rebuilt from the same roof nodes used by its faces.
export function prepareHollowMidpointRoof(outer, wall) {
  if(!(wall>0))return null;
  let variants=cached.get(outer);if(!variants){variants=new Map();cached.set(outer,variants);}
  if(variants.has(wall))return variants.get(wall);
  let source=sourceCache.get(outer);
  if(!source){source=prepareBevelRoof([outer]);sourceCache.set(outer,source);}
  if(wall>=source.maximumWidth)return null;
  const span=Math.max(1,...outer.map(p=>Math.hypot(p.x-outer[0].x,p.y-outer[0].y)));
  const tolerance=span*1e-8;
  const half=wall/2,faces=[],edges=[],faceDirections=[];
  const edgeKey=p=>`${Math.round(p.x*1e7)},${Math.round(p.y*1e7)}`;
  const sourceDirections=new Map();
  outer.forEach((a,i)=>{
    const b=outer[(i+1)%outer.length],length=Math.hypot(b.x-a.x,b.y-a.y);
    sourceDirections.set([edgeKey(a),edgeKey(b)].sort().join('|'),[(b.x-a.x)/length,(b.y-a.y)/length,0]);
  });
  const nodes=new Map();
  const canonical=p=>{
    // Shared fold and cavity vertices must have the same exact distance on
    // both incident faces. A nearby skeleton event can otherwise be reused
    // on one side with time half+epsilon and folded on the other side to
    // half-epsilon, turning the meeting line into two separated edges.
    for (const critical of [half,wall])
      if (Math.abs(p.time-critical)<=tolerance) { p={...p,time:critical}; break; }
    const key=`${Math.round(p.x/tolerance)},${Math.round(p.y/tolerance)},${Math.round(p.time/tolerance)}`;if(!nodes.has(key))nodes.set(key,p);return nodes.get(key);};
  for(const raw of source.faces){
    // A folded face may terminate at a skeleton event before reaching the
    // cavity contour. Preserve its source provenance even without a zero-time
    // edge; otherwise normal smoothing can bridge the two sides of the fold.
    let direction=null;
    for(let i=0;i<raw.length;i++){
      const a=raw[i],b=raw[(i+1)%raw.length];
      if(Math.abs(a.time)>1e-8||Math.abs(b.time)>1e-8)continue;
      direction=sourceDirections.get([edgeKey(a),edgeKey(b)].sort().join('|'))??direction;
    }
    const face=cut(raw,wall,false).map(canonical);if(face.length<3)continue;
    for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length];if(Math.abs(a.time-wall)<tolerance&&Math.abs(b.time-wall)<tolerance)edges.push([a,b]);}
    const low=cut(face,half,false).map(canonical),high=cut(face,half,true).map(canonical);
    if(low.length>=3){faces.push(low);faceDirections.push(direction);}
    if(high.length>=3){
      faces.push(high.map(p=>({x:p.x,y:p.y,time:Math.max(0,wall-p.time)})));
      faceDirections.push(direction?[-direction[0],-direction[1],1]:null);
    }
  }
  const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)}`;
  const adjacency=new Map();
  edges.forEach(([a,b],i)=>{for(const p of [a,b]){const k=key(p);if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i);}});
  if([...adjacency.values()].some(v=>v.length!==2))return null;
  const unused=new Set(edges.map((_,i)=>i)),holes=[];
  while(unused.size){const first=unused.values().next().value;let [start,p]=edges[first];unused.delete(first);const loop=[start];
    for(let count=0;key(p)!==key(start)&&count<=edges.length;count++){loop.push(p);const next=(adjacency.get(key(p))||[]).find(i=>unused.has(i));if(next===undefined)return null;unused.delete(next);const [a,b]=edges[next];p=key(a)===key(p)?b:a;}
    if(key(p)!==key(start)||loop.length<3)return null;
    let area=loop.reduce((s,a,i)=>{const b=loop[(i+1)%loop.length];return s+a.x*b.y-b.x*a.y;},0);if(area>0)loop.reverse();holes.push(loop.map(p=>({x:p.x,y:p.y})));
  }
  if(!holes.length)return null;
  // Folded outer faces keep their original zero-time boundary; inner faces
  // acquire their zero-time boundary at the exact cavity contour.
  const roof={faces,faceDirections,maximumWidth:half,rings:[outer,...holes],regularization:source.regularization,ridgeTolerance:source.ridgeTolerance,midpointRoof:true,midpointLoops:midpointLoops(faces,half)};
  try{validateRoofTriangles(triangulateBevelRoof(roof,half,[0,1],t=>t),roof.rings);}catch{return null;}
  if(variants.size>=4)variants.delete(variants.keys().next().value);variants.set(wall,roof);return roof;
}
