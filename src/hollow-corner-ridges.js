import cdt2d from 'cdt2d';
import { prepareBevelRoof } from './bevel-roof.js';
const chainCache = new WeakMap();
const triangleBounds = new WeakMap();
const pointKeys = new WeakMap();
function xyKey(p) {
  let keys=pointKeys.get(p);
  if(!keys){keys={xy:`${Math.fround(p.x)},${Math.fround(p.y)}`};pointKeys.set(p,keys);}
  return keys.xy;
}
function renderedKey(p) {
  const xy=xyKey(p),keys=pointKeys.get(p);
  if(!keys.rendered)keys.rendered=`${xy},${Math.round(p.height * 1e7)}`;
  return keys.rendered;
}
function bounds(triangle) {
  let box = triangleBounds.get(triangle);
  if (!box) {
    const [a,b,c] = triangle.points;
    box = { minX:Math.min(a.x,b.x,c.x), maxX:Math.max(a.x,b.x,c.x), minY:Math.min(a.y,b.y,c.y), maxY:Math.max(a.y,b.y,c.y) };
    triangleBounds.set(triangle,box);
  }
  return box;
}
// Replacing a closed triangulated patch is safe exactly when its boundary
// remains identical and every newly introduced interior edge has two faces.
// The unchanged surface is already validated by the offset roof caller.
function validReplacement(previous, next) {
  const count = faces => {
    const edges = new Map();
    for (const face of faces) {
      const ids=face.points.map(renderedKey);
      for(let i=0;i<3;i++) {
        const a=ids[i],b=ids[(i+1)%3];
        if(a===b)continue;
        const key=a<b?`${a}|${b}`:`${b}|${a}`;
        edges.set(key,(edges.get(key)||0)+1);
      }
    }
    return edges;
  };
  const oldEdges=count(previous),newEdges=count(next);
  for(const [edge,n]of oldEdges) {
    const replacement=newEdges.get(edge)||0;
    if(n===1?replacement!==1:replacement!==0&&replacement!==2)return false;
  }
  for(const [edge,n]of newEdges)
    if(n!==(oldEdges.get(edge)===1?1:2))return false;
  return true;
}
function sourceGraph(rings) {
  const cacheKey=rings[0];
  if (chainCache.has(cacheKey)) return chainCache.get(cacheKey);
  // Imported contours are already bounded by the geometry vertex limit.
  // A separate 512-vertex cutoff discarded the complete ridge of valid SVGs.
  if(cacheKey.length>3000)return null;
  let graph = null;
  try {
    const roof = prepareBevelRoof([rings[0]]);
    graph = new Map(); const seen = new Set();
    graph.planes = roof.faces.flatMap(face=>{
      for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length];if(a.time<=1e-8&&b.time<=1e-8){const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);return [{face,a,dx,dy,l,minX:Math.min(...face.map(p=>p.x)),maxX:Math.max(...face.map(p=>p.x)),minY:Math.min(...face.map(p=>p.y)),maxY:Math.max(...face.map(p=>p.y))}];}}
      return [];
    });
    const key = p => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
    for (const face of roof.faces) for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (a.time < 1e-8 && b.time < 1e-8) continue;
      const edge = [key(a), key(b)].sort().join('|');
      if (seen.has(edge)) continue; seen.add(edge);
      for (const [p,q] of [[a,b],[b,a]]) { const k=key(p); if (!graph.has(k)) graph.set(k,[]); graph.get(k).push(q); }
    }
  } catch { /* Local bisector recovery remains available for failed kernels. */ }
  chainCache.set(cacheKey, graph); return graph;
}
function cornerChain(c, graph, holes, epsilon) {
  if (!graph) return [];
  const key = p => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
  let point = { x:c.x, y:c.y, time:0 }, previous = null;
  const chain=[]; const visited = new Set();
  const safe = p => holes.every(r => r.every((a,i) => distance(p,a,r[(i+1)%r.length]) >= p.time - epsilon));
  for (let i=0; i<graph.size; i++) {
    const choices=(graph.get(key(point)) || []).filter(q => key(q)!==previous && q.time>point.time+epsilon && !visited.has(key(q)));
    if (!choices.length) break; choices.sort((a,b)=>b.time-a.time); let next=choices[0];
    if (!safe(next)) {
      let low=0, high=1; for(let j=0;j<40;j++){const t=(low+high)/2,p={x:point.x+(next.x-point.x)*t,y:point.y+(next.y-point.y)*t,time:point.time+(next.time-point.time)*t}; if(safe(p))low=t;else high=t;}
      next={x:point.x+(next.x-point.x)*low,y:point.y+(next.y-point.y)*low,time:point.time+(next.time-point.time)*low};
      if(Math.hypot(next.x-point.x,next.y-point.y)>epsilon)chain.push([point,next]);break;
    }
    chain.push([point,next]);previous=key(point);visited.add(previous);point=next;
  }
  const branches=[];const chainEdges=new Set(chain.map(([a,b])=>[key(a),key(b)].sort().join('|')));
  for(const [,event]of chain)for(const q of graph.get(key(event))||[]){
    if(q.time>=event.time-epsilon||chainEdges.has([key(q),key(event)].sort().join('|')))continue;
    let valid=true;for(let i=0;i<=8;i++){const t=i/8,p={x:q.x+(event.x-q.x)*t,y:q.y+(event.y-q.y)*t,time:q.time+(event.time-q.time)*t};if(!safe(p)){valid=false;break;}}
    if(valid){const branch=[q,event];branch.auxiliary=true;branches.push(branch);}
  }
  return [...chain,...branches];
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (p, a, b) => {
  const v = subtract(b, a), w = subtract(p, a);
  const t = Math.max(0, Math.min(1, (v.x * w.x + v.y * w.y) / (v.x * v.x + v.y * v.y)));
  return Math.hypot(w.x - t * v.x, w.y - t * v.y);
};

// Recover the exact outer wavefront branch at sharp source corners when
// offset-band triangulation crosses it. Stop at the first cavity competition
// or the bevel width; incident source branches partition the same local faces.
export function constrainHollowCornerRidges(triangles, rings, width, samples, profile) {
  if (rings.length < 2 || width <= 0) return triangles;
  let result = triangles;
  const span = Math.max(...rings.flat().map(p => Math.hypot(p.x - rings[0][0].x, p.y - rings[0][0].y)), 1);
  const epsilon = span * 1e-7;
  const existing = new Map(), indexedPoints = new Set();
  const indexPoint = p => {
    const id=`${p.x},${p.y}`;
    if(indexedPoints.has(id))return;
    indexedPoints.add(id);
    const key=`${Math.floor(p.x/epsilon)},${Math.floor(p.y/epsilon)}`;
    if(!existing.has(key))existing.set(key,[]);
    existing.get(key).push(p);
  };
  for(const face of triangles)for(const p of face.points)indexPoint(p);
  const levels = samples.map(t => ({ t, d: width * (1 - profile(t)) }));
  const height = d => {
    if (d >= levels[0].d) return levels[0].t;
    for (let i = 1; i < levels.length; i++) if (d >= levels[i].d) {
      const a = levels[i - 1], b = levels[i];
      return a.t + (b.t - a.t) * (a.d - d) / (a.d - b.d || 1);
    }
    return 1;
  };
  const ring = rings[0];
  const graph = sourceGraph(rings);
  const area = ring.reduce((s, p, i) => s + cross(p, ring[(i + 1) % ring.length]), 0);
  for (let index = 0; index < ring.length; index++) {
    const c = ring[index], prev = ring[(index + ring.length - 1) % ring.length], next = ring[(index + 1) % ring.length];
    const va = subtract(prev, c), vb = subtract(next, c), la = Math.hypot(va.x, va.y), lb = Math.hypot(vb.x, vb.y);
    if (cross(va, vb) * area >= 0) continue;
    const cosine = (va.x * vb.x + va.y * vb.y) / (la * lb);
    if (cosine < Math.cos(Math.PI / 3)) continue;
    const sum = { x: va.x / la + vb.x / lb, y: va.y / la + vb.y / lb };
    const norm = Math.hypot(sum.x, sum.y), u = { x: sum.x / norm, y: sum.y / norm };
    const k = Math.abs(cross(u, vb)) / lb;
    const opponents = [];
    for (const r of rings) for (let j = 0; j < r.length; j++) {
      const a = r[j], b = r[(j + 1) % r.length];
      if (a === c || b === c) continue;
      opponents.push([a, b]);
    }
    const valid = t => {
      const p = { x: c.x + u.x * t, y: c.y + u.y * t };
      return opponents.every(([a, b]) => distance(p, a, b) >= t * k - epsilon);
    };
    let low = 0, high = Math.min(la, lb) / Math.sqrt((1 + cosine) / 2);
    // Stop at the first competition, never continue through a cavity.
    let previous = 0;
    for (let i = 1; i <= 128; i++) {
      const t = high * i / 128;
      if (!valid(t)) { low = previous; high = t; break; }
      previous = t; low = t;
    }
    for (let i = 0; i < 36; i++) { const mid = (low + high) / 2; if (valid(mid)) low = mid; else high = mid; }
    const fallbackLength = low;
    const chain = cornerChain(c, graph, rings.slice(1), epsilon);
    if (!chain.length && fallbackLength > epsilon * 10) chain.push([{...c,time:0}, {x:c.x+u.x*fallbackLength,y:c.y+u.y*fallbackLength,time:fallbackLength*k}]);
    const sourceCorner=c;
    const ridgeId=`${c.x},${c.y}`;
    for (const segment of chain) {
    const [start,rawEnd]=segment;
    if(start.time>=width)continue;
    let end=rawEnd;
    if(end.time>width){const t=(width-start.time)/(end.time-start.time);end={x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t,time:width};}
    const c=start, length=Math.hypot(end.x-start.x,end.y-start.y);
    const u={x:(end.x-start.x)/length,y:(end.y-start.y)/length};
    const ridgeHeight=t=>height(start.time+(end.time-start.time)*t/length);
    if (length <= epsilon * 10) continue;
    const endpoint = { x: c.x + length * u.x, y: c.y + length * u.y, height: ridgeHeight(length) };
    const cache = new Map();

    const canonical = (p, t) => {
      const key = `${Math.round(t / epsilon)}`;
      if (!cache.has(key)) {
        let x=c.x+u.x*t,y=c.y+u.y*t,nearest=null,best=epsilon;
        const gx=Math.floor(x/epsilon),gy=Math.floor(y/epsilon);
        for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of existing.get(`${gx+i},${gy+j}`)||[]){const d=Math.hypot(q.x-x,q.y-y);if(d<best){best=d;nearest=q;}}
        if(nearest){x=nearest.x;y=nearest.y;}
        cache.set(key,{x,y,height:nearest?.height === 1 ? 1 : ridgeHeight(t)});
      }
      return cache.get(key);
    };
    const output = [];
    const minX=Math.min(c.x,endpoint.x)-epsilon,maxX=Math.max(c.x,endpoint.x)+epsilon,
      minY=Math.min(c.y,endpoint.y)-epsilon,maxY=Math.max(c.y,endpoint.y)+epsilon;
    for (const triangle of result) {
      const box=bounds(triangle);
      if(box.maxX<minX||box.minX>maxX||box.maxY<minY||box.minY>maxY){output.push(triangle);continue;}
      const points = triangle.points;
      const boundary = [], hits = [];
      for (let j = 0; j < 3; j++) {
        const a = points[j], b = points[(j + 1) % 3];
        const av = subtract(a, c), bv = subtract(b, c), sa = cross(u, av), sb = cross(u, bv);
        const ta = av.x * u.x + av.y * u.y;
        let p = a;
        if (Math.abs(sa) <= epsilon && ta >= -epsilon && ta <= length + epsilon) { p = canonical(a, Math.max(0, Math.min(length, ta))); hits.push(p); }
        boundary.push(p);
        if (sa * sb < -epsilon * epsilon) {
          const q = sa / (sa - sb), x = a.x + (b.x - a.x) * q, y = a.y + (b.y - a.y) * q;
          const t = (x - c.x) * u.x + (y - c.y) * u.y;
          if (t > epsilon && t <= length + epsilon) { const p = canonical({ x, y }, Math.min(t,length)); boundary.push(p); hits.push(p); }
        }
      }
      const inside = p => {
        const signs = points.map((a, j) => cross(subtract(points[(j + 1) % 3], a), subtract(p, a)));
        const areaEpsilon = epsilon * epsilon;
        return signs.every(v => v >= -areaEpsilon) || signs.every(v => v <= areaEpsilon);
      };
      const flat = [...boundary];
      if (inside(endpoint) && !hits.some(p => Math.hypot(p.x - endpoint.x, p.y - endpoint.y) < epsilon)) { flat.push(canonical(endpoint, length)); hits.push(flat.at(-1)); }
      const unique = [...new Set(hits)];
      if (unique.length < 2 && boundary.length === 3) { output.push(boundary.every((p,i)=>p===points[i])?triangle:{ ...triangle, points: boundary }); continue; }
      const edges = boundary.map((p, i) => [i, (i + 1) % boundary.length]);
      unique.sort((a,b) => (a.x-b.x)*u.x+(a.y-b.y)*u.y);
      if(unique.length >= 2) edges.push([flat.indexOf(unique[0]), flat.indexOf(unique.at(-1))]);
      const clean=[], indices=[], coordinates=new Map();
      for(const p of flat){const key=`${Math.fround(p.x)},${Math.fround(p.y)}`;if(!coordinates.has(key)){coordinates.set(key,clean.length);clean.push(p);}indices.push(coordinates.get(key));}
      const uniqueEdges=new Map();for(const [a,b]of edges){const i=indices[a],j=indices[b];if(i!==j)uniqueEdges.set([i,j].sort((a,b)=>a-b).join(','),[i,j]);}
      for (const ids of cdt2d(clean.map(p => [p.x, p.y]), [...uniqueEdges.values()], { exterior: true })) {
        const face = ids.map(i => clean[i]);
        if (Math.abs(cross(subtract(face[1], face[0]), subtract(face[2], face[0]))) <= epsilon * epsilon) continue;
        output.push({ ...triangle, points: face, constraints: [...(triangle.constraints || []), ...(unique.length>=2?[[unique[0], unique.at(-1)]]:[])], cornerRidge: segment.auxiliary ? triangle.cornerRidge : { origin: c, direction: u, ridgeId, sourceCorner } });
      }
    }
    const shared=new Map([...cache.values()].map(p=>[xyKey(p),p]));
    // A rendered coordinate key can also match the neighboring Float32 cell.
    // Include that whole rounding neighborhood before skipping shared nodes.
    const padding=epsilon+Math.max(1,Math.abs(minX),Math.abs(maxX),Math.abs(minY),Math.abs(maxY))*2**-22;
    const unified=output.map(triangle=>{
      const box=bounds(triangle);
      if(box.maxX<minX-padding||box.minX>maxX+padding||box.maxY<minY-padding||box.minY>maxY+padding)return triangle;
      const [a,b,c]=triangle.points;
      const aa=shared.get(xyKey(a))||a,bb=shared.get(xyKey(b))||b,cc=shared.get(xyKey(c))||c;
      return aa===a&&bb===b&&cc===c?triangle:{...triangle,points:[aa,bb,cc]};
    });
    const previousSet=new Set(result);
    const visible=unified.filter(triangle=>previousSet.has(triangle)||new Set(triangle.points.map(renderedKey)).size===3);
    const unchanged=new Set(visible.filter(triangle=>previousSet.has(triangle)));
    const removed=result.filter(triangle=>!unchanged.has(triangle));
    const added=visible.filter(triangle=>!unchanged.has(triangle));
    if(validReplacement(removed,added)) {
      result=visible;
      for(const face of added)for(const p of face.points)indexPoint(p);
    }
    }
  }
  // A newly inserted ridge cannot retain an old CDT fan's interpolated
  // third-vertex height: that would leave both sides physically coplanar.
  // Canonical updates reach every incident triangle, including neighbors
  // outside the local retriangulation, so no height seam is introduced.
  const updates=new Map();
  const roofTime = p => {
    if(graph?.planes)for(const plane of graph.planes){
      if(p.x<plane.minX-epsilon||p.x>plane.maxX+epsilon||p.y<plane.minY-epsilon||p.y>plane.maxY+epsilon)continue;
      let inside=false,onBoundary=false;const f=plane.face;
      for(let i=0,j=f.length-1;i<f.length;j=i++){
        const a=f[j],b=f[i];if(distance(p,a,b)<=epsilon)onBoundary=true;
        if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
      }
      if(inside||onBoundary)return Math.abs(plane.dx*(p.y-plane.a.y)-plane.dy*(p.x-plane.a.x))/plane.l;
    }
    return Math.min(...ring.map((a,i)=>distance(p,a,ring[(i+1)%ring.length])));
  };
  const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)}`;
  for(const triangle of result) if(triangle.cornerRidge) for(const p of triangle.points) {
    const outerDistance=roofTime(p);
    const holeDistance=Math.min(...rings.slice(1).flatMap(r=>r.map((a,i)=>distance(p,a,r[(i+1)%r.length]))));
    if(outerDistance<=holeDistance+epsilon) updates.set(key(p), height(outerDistance));
  }
  return result.map(triangle=>({...triangle,points:triangle.points.map(p=>updates.has(key(p))?{...p,height:updates.get(key(p))}:p)})).filter(triangle=>{const keys=triangle.points.map(p=>`${Math.fround(p.x)},${Math.fround(p.y)}`);return new Set(keys).size===3;});
}
