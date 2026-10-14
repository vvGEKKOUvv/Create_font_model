// Reuse a shared roof topology: independently built inner/outer rings can crack
// at their common ridge. Distance-weighted curves keep that ridge watertight.
const weightsCache = new WeakMap();
const transformedCache = new WeakMap();
// Controls do not change when depth or width changes. Keep sampled profiles
// separate from each roof topology so parameter drags reuse their inversion table.
const profileTables = new Map();
function tree(segments) {
  const minX = Math.min(...segments.map(s => Math.min(s[0].x,s[1].x)));
  const maxX = Math.max(...segments.map(s => Math.max(s[0].x,s[1].x)));
  const minY = Math.min(...segments.map(s => Math.min(s[0].y,s[1].y)));
  const maxY = Math.max(...segments.map(s => Math.max(s[0].y,s[1].y)));
  const node = {minX,maxX,minY,maxY};
  if (segments.length <= 8) node.segments = segments;
  else {
    const axis = maxX-minX > maxY-minY ? 'x' : 'y';
    segments.sort((a,b) => a[0][axis]+a[1][axis]-b[0][axis]-b[1][axis]);
    const mid = segments.length >> 1;
    node.children = [tree(segments.slice(0,mid)),tree(segments.slice(mid))];
  }
  return node;
}
function distance(p,node,best=Infinity) {
  const dx = Math.max(node.minX-p.x,0,p.x-node.maxX);
  const dy = Math.max(node.minY-p.y,0,p.y-node.maxY);
  if (dx*dx+dy*dy >= best) return best;
  if (node.segments) for(const [a,b] of node.segments) {
    const x=b.x-a.x,y=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));
    best=Math.min(best,(p.x-a.x-t*x)**2+(p.y-a.y-t*y)**2);
  }
  else for(const child of node.children) best=distance(p,child,best);
  return best;
}
export function independentRoofProfiles(triangles,rings,outer,inner,profileKey) {
  const count=512;
  let table=profileKey === undefined ? undefined : profileTables.get(profileKey);
  if (!table) {
    const a=Array.from({length:count+1},(_,i)=>outer(i/count));
    const b=Array.from({length:count+1},(_,i)=>inner(i/count));
    table={a,b,cacheKey:JSON.stringify([a,b])};
    if (profileKey !== undefined) {
      if(profileTables.size>=32) profileTables.delete(profileTables.keys().next().value);
      profileTables.set(profileKey,table);
    }
  }
  const {a,b,cacheKey}=table;
  if (a.every((v,i)=>Math.abs(v-b[i])<1e-10)) return triangles;
  if ([a,b].some(values=>values.some((v,i)=>i&&v<values[i-1]-1e-8)))
    throw new Error('内側・外側のベベルカーブは、戻らない形状にしてください。');
  let cache=transformedCache.get(triangles);
  if (!cache) {cache=new Map();transformedCache.set(triangles,cache);}
  if(cache.has(cacheKey)) return cache.get(cacheKey);
  let weights=weightsCache.get(triangles);
  if (!weights) {
    const segments=ring=>ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
    const outerTree=tree(segments(rings[0]));
    const innerTree=tree(rings.slice(1).flatMap(segments));
    const locations=new Map();
    weights=triangles.map(face=>face.points.map(p=>{
      const key=`${p.x},${p.y}`;
      if (!locations.has(key)) {
        const d0=Math.sqrt(distance(p,outerTree)),d1=Math.sqrt(distance(p,innerTree));
        locations.set(key,d0/(d0+d1||1));
      }
      return locations.get(key);
    }));
    weightsCache.set(triangles,weights);
  }
  const vertices=new Map();
  const result = triangles.map((face,f)=>({...face,points:face.points.map((p,i)=>{
    if (p.height<=0 || p.height>=1) return p;
    const vertexKey=`${p.x},${p.y},${p.height}`;
    if(vertices.has(vertexKey)) return {...p,height:vertices.get(vertexKey)};
    const w=weights[f][i], target=outer(p.height);
    let lo=0,hi=count;
    const value=j=>a[j]*(1-w)+b[j]*w;
    while(hi-lo>1) {const mid=(hi+lo)>>1;if(value(mid)<target)lo=mid;else hi=mid;}
    const low=value(lo),high=value(hi);
    const height=(lo+(high>low?(target-low)/(high-low):0))/count;
    const result={...p,height:Math.max(0,Math.min(1,height))};
    vertices.set(vertexKey,result.height);
    return result;
  })}));
  if(cache.size>=8) cache.delete(cache.keys().next().value);
  cache.set(cacheKey,result);
  return result;
}
