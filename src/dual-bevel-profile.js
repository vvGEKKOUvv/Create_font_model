// Offset-band fallback has no source-face ownership. A fixed geometric mesh
// provides stable ownership; each side inverts only its own sampled curve.
const ownershipCache=new WeakMap(),transformedCache=new WeakMap(),profileTables=new Map();
const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(p.height*1e7)}`;
function segmentDistance(p,a,b){const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return (p.x-a.x-t*x)**2+(p.y-a.y-t*y)**2;}
const boundaryTrees = new WeakMap();
function segmentTree(segments) {
  if (!segments.length) return null;
  const node = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const [a,b] of segments) {
    node.minX=Math.min(node.minX,a.x,b.x);node.minY=Math.min(node.minY,a.y,b.y);
    node.maxX=Math.max(node.maxX,a.x,b.x);node.maxY=Math.max(node.maxY,a.y,b.y);
  }
  if(segments.length<=8)node.segments=segments;
  else {
    const axis=node.maxX-node.minX>node.maxY-node.minY?'x':'y';
    segments.sort((a,b)=>a[0][axis]+a[1][axis]-b[0][axis]-b[1][axis]);
    const middle=segments.length>>1;
    node.children=[segmentTree(segments.slice(0,middle)),segmentTree(segments.slice(middle))];
  }
  return node;
}
function nearestDistance(p,node,best=Infinity) {
  if(!node)return best;
  const dx=Math.max(node.minX-p.x,0,p.x-node.maxX),dy=Math.max(node.minY-p.y,0,p.y-node.maxY);
  if(dx*dx+dy*dy>=best)return best;
  if(node.segments)for(const [a,b] of node.segments)best=Math.min(best,segmentDistance(p,a,b));
  else for(const child of node.children)best=nearestDistance(p,child,best);
  return best;
}
function sourceTrees(rings) {
  let trees=boundaryTrees.get(rings);
  if(!trees){
    const segments=ring=>ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
    trees=[segmentTree(segments(rings[0])),segmentTree(rings.slice(1).flatMap(segments))];
    boundaryTrees.set(rings,trees);
  }
  return trees;
}
export function independentRoofProfiles(triangles,rings,outer,inner,profileKey){
 const count=512;let table=profileKey===undefined?undefined:profileTables.get(profileKey);
 if(!table){table={a:Array.from({length:count+1},(_,i)=>outer(i/count)),b:Array.from({length:count+1},(_,i)=>inner(i/count))};table.key=JSON.stringify(table);if(profileKey!==undefined){if(profileTables.size>=32)profileTables.delete(profileTables.keys().next().value);profileTables.set(profileKey,table);}}
 if([table.a,table.b].some(values=>values.some((v,i)=>i&&v<values[i-1]-1e-8)))throw new Error('内側・外側のベベルカーブは、戻らない形状にしてください。');
 let cached=transformedCache.get(triangles);if(!cached){cached=new Map();transformedCache.set(triangles,cached);}if(cached.has(table.key))return cached.get(table.key);
 let ownership=ownershipCache.get(triangles);
 if(!ownership){
  const [outerTree,innerTree]=sourceTrees(rings);
  const vertexOwners=new Map();const sides=triangles.map(face=>{const p=face.points.reduce((sum,q)=>({x:sum.x+q.x/3,y:sum.y+q.y/3}),{x:0,y:0});const outerDistance=nearestDistance(p,outerTree),innerDistance=nearestDistance(p,innerTree,outerDistance),side=innerDistance<outerDistance?1:0;for(const p of face.points){const k=key(p);if(!vertexOwners.has(k))vertexOwners.set(k,new Set());vertexOwners.get(k).add(side);}return side;});ownership={sides,vertexOwners};ownershipCache.set(triangles,ownership);
 }
 const vertices=new Map(),invert=(values,target)=>{let lo=0,hi=count;while(hi-lo>1){const mid=(hi+lo)>>1;if(values[mid]<target)lo=mid;else hi=mid;}const low=values[lo],high=values[hi];return Math.max(0,Math.min(1,(lo+(high>low?(target-low)/(high-low):0))/count));};
 const result=triangles.map((face,f)=>({...face,points:face.points.map(p=>{if(p.height<=0||p.height>=1||ownership.vertexOwners.get(key(p)).size>1)return p;const k=key(p);if(!vertices.has(k))vertices.set(k,invert(ownership.sides[f]?table.b:table.a,p.height));return {...p,height:vertices.get(k)};})}));
 if(cached.size>=8)cached.delete(cached.keys().next().value);cached.set(table.key,result);return result;
}
