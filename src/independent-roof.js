import { validateRoofTriangles } from './roof-topology.js';
const cache=new WeakMap();
const key=p=>`${Math.fround(p.x)},${Math.fround(p.y)}`;
function fraction(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;if(!length)return null;const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/length;if(t < -1e-7||t > 1+1e-7)return null;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=Math.max(1e-7,Math.sqrt(length)*1e-7)?Math.max(0,Math.min(1,t)):null;}
export function roofFaceOwners(roof,rings){
 const sourceEdges=new Map();for(const [r,ring]of rings.entries())for(let i=0;i<ring.length;i++)sourceEdges.set([key(ring[i]),key(ring[(i+1)%ring.length])].sort().join('|'),r?1:0);
 return roof.faces.map((face,i)=>{if(roof.faceDirections?.[i])return roof.faceDirections[i][2]?1:0;for(let j=0;j<face.length;j++){const a=face[j],b=face[(j+1)%face.length];if(Math.abs(a.time)<1e-7&&Math.abs(b.time)<1e-7){const value=sourceEdges.get([key(a),key(b)].sort().join('|'));if(value!==undefined)return value;}}return 0;});
}
/** Each source face is sampled only from its own profile. Shared ridges are
 * fixed geometric constraints; adding a neighboring ridge node only splits an
 * existing planar triangle, and therefore cannot deform the other surface. */
export function triangulateIndependentRoof(roof,rings,width,outerSamples,innerSamples,outer,inner,triangulate){
 const cacheKey=JSON.stringify([width,outerSamples,innerSamples,outerSamples.map(outer),innerSamples.map(inner)]);
 let entries=cache.get(roof);if(!entries){entries=new Map();cache.set(roof,entries);}if(entries.has(cacheKey))return entries.get(cacheKey);
 const owners=roofFaceOwners(roof,rings),edgeMap=new Map(),vertexOwners=new Map();
 roof.faces.forEach((face,f)=>{for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],k=[key(a),key(b)].sort().join('|');let e=edgeMap.get(k);if(!e){e={a,b,owners:new Set(),faces:new Set()};edgeMap.set(k,e);}e.owners.add(owners[f]);e.faces.add(f);for(const p of[a,b]){const k=key(p);if(!vertexOwners.has(k))vertexOwners.set(k,new Set());vertexOwners.get(k).add(owners[f]);}}});
 const mixed=[...edgeMap.values()].filter(e=>e.owners.size>1);
 const perFace=roof.faces.map(()=>[]);for(const edge of mixed)for(const f of edge.faces)perFace[f].push(edge);
 const originalOuter=triangulate(outerSamples,outer),same=JSON.stringify([outerSamples,outerSamples.map(outer)])===JSON.stringify([innerSamples,innerSamples.map(inner)]);
 const originalInner=same?originalOuter:triangulate(innerSamples,inner);
 let triangles=[...originalOuter.filter(t=>owners[t.faceIndex]===0),...originalInner.filter(t=>owners[t.faceIndex]===1)].map(face=>({...face,points:face.points.map(p=>{
   const edge=perFace[face.faceIndex].find(e=>fraction(p,e.a,e.b)!==null);
   if(edge||vertexOwners.get(key(p))?.size>1)return {...p,height:Math.max(0,Math.min(1,1-p.time/width))};
   return p;
 })}));
 const buckets=roof.faces.map(()=>[]);for(const face of triangles)buckets[face.faceIndex].push(face);
 for(const edge of mixed){
   const nodes=new Map();for(const f of edge.faces)for(const face of buckets[f])for(const p of face.points){const t=fraction(p,edge.a,edge.b);if(t!==null)nodes.set(key(p),{...p,edgeT:t});}
   const sorted=[...nodes.values()].filter(p=>p.edgeT>1e-7&&p.edgeT<1-1e-7).sort((a,b)=>a.edgeT-b.edgeT);
   for(const f of edge.faces)for(const node of sorted){const result=[];for(const face of buckets[f]){const points=face.points;let split=false;for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],c=points[(j+2)%3];if(key(a)===key(node)||key(b)===key(node))continue;const t=fraction(node,a,b);if(t===null||t<=1e-7||t>=1-1e-7)continue;if(fraction(a,edge.a,edge.b)===null||fraction(b,edge.a,edge.b)===null)continue;const p={x:node.x,y:node.y,time:node.time,height:a.height+(b.height-a.height)*t};result.push({...face,points:[a,p,c]},{...face,points:[p,b,c]});split=true;break;}if(!split)result.push(face);}buckets[f]=result;}
 }
 triangles=buckets.flat();
 validateRoofTriangles(triangles,rings);
 if(entries.size>=4)entries.delete(entries.keys().next().value);entries.set(cacheKey,triangles);return triangles;
}
