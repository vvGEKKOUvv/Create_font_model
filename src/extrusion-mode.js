import { BufferGeometry, Float32BufferAttribute } from 'three';
import cdt2d from 'cdt2d';
import { assignSurfaceGroups, surfaceUvKey, transformSurfaceUv } from './surface-geometry.js';

/** Keep the positive half of a symmetric raw 0..depth extrusion. */
export function positiveExtrusionHalf(source, depth, { cap = true, settings = {} } = {}) {
  const plane = depth / 2, epsilon = Math.max(1, depth) * 1e-7;
  const positions = [], normals = [], uvs = [], bases = [], slots = [], protectedIndices = [];
  const p = source.getAttribute('position'), n = source.getAttribute('normal'), uv = source.getAttribute('uv');
  const protectedSource = new Set(source.userData.protectedMidpointIndices || []);
  const base = source.userData.baseUVs || uv.array;
  const index = source.index;
  const read = i => ({ p:[p.getX(i),p.getY(i),Math.abs(p.getZ(i)-plane)<=epsilon ? plane : p.getZ(i)], n:[n.getX(i),n.getY(i),n.getZ(i)], uv:[uv.getX(i),uv.getY(i)], base:[base[i*2],base[i*2+1]], slot:source.getAttribute('surfaceSlot')?.getX(i)??0, protected:protectedSource.has(i) });
  const interpolate = (a,b) => {
    const t = (plane-a.p[2])/(b.p[2]-a.p[2]);
    const mix = key => a[key].map((value,i)=>value+(b[key][i]-value)*t);
    const result = {p:mix('p'),n:mix('n'),uv:mix('uv'),base:mix('base'),slot:a.slot,protected:a.protected&&b.protected};
    // Adjacent faces traverse their shared edge in opposite directions. Use
    // the same endpoint order for geometric intersections so roundoff cannot
    // create distinct Float32 section vertices (UVs/normals remain per face).
    const before = a.p[2] < b.p[2] || (a.p[2] === b.p[2] && (a.p[0] < b.p[0] || (a.p[0] === b.p[0] && a.p[1] <= b.p[1])));
    const start = before ? a.p : b.p, end = before ? b.p : a.p;
    const fraction = (plane-start[2])/(end[2]-start[2]);
    result.p = start.map((value,i)=>value+(end[i]-value)*fraction);
    result.p[2]=plane; return result;
  };
  function addTriangle(a,b,c) {
    const ab=b.p.map((v,i)=>v-a.p[i]),ac=c.p.map((v,i)=>v-a.p[i]);
    if (Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]) === 0) return;
    for(const vertex of [a,b,c]) {
      const i=positions.length/3;
      positions.push(Math.fround(vertex.p[0]),Math.fround(vertex.p[1]),Math.fround(Math.max(0,vertex.p[2]-plane)));
      const length=Math.hypot(...vertex.n)||1;
      normals.push(...vertex.n.map(v=>v/length)); uvs.push(...vertex.uv); bases.push(...vertex.base);
      slots.push(vertex.slot);
      if(vertex.protected) protectedIndices.push(i);
    }
  }
  const count=index ? index.count : p.count;
  for(let i=0;i<count;i+=3) {
    const input=[0,1,2].map(offset=>read(index ? index.getX(i+offset):i+offset));
    const polygon=[];
    for(let j=0;j<3;j++) {
      const a=input[j],b=input[(j+1)%3],insideA=a.p[2]>=plane,insideB=b.p[2]>=plane;
      if(insideA) polygon.push(a);
      if(insideA!==insideB) polygon.push(interpolate(a,b));
    }
    for(let j=1;j+1<polygon.length;j++) addTriangle(polygon[0],polygon[j],polygon[j+1]);
  }
  if (!positions.length) throw new Error('片側の押し出し形状を生成できませんでした。');
  if(cap) {
    const edges=new Map(),points=[],pointIds=new Map();
    function pointId(offset) {
      const point=[positions[offset*3],positions[offset*3+1]],key=point.join(',');
      if(!pointIds.has(key)){pointIds.set(key,points.length);points.push(point);}
      return pointIds.get(key);
    }
    for(let i=0;i<positions.length/3;i+=3) for(let j=0;j<3;j++) {
      const a=i+j,b=i+(j+1)%3;
      if(positions[a*3+2]!==0 || positions[b*3+2]!==0) continue;
      const ai=pointId(a),bi=pointId(b); if(ai===bi)continue;
      const key=ai<bi?`${ai},${bi}`:`${bi},${ai}`;
      const edge=edges.get(key); if(edge)edge.count++;else edges.set(key,{a:ai,b:bi,count:1});
    }
    const boundary=[...edges.values()].filter(edge=>edge.count===1).map(edge=>[edge.a,edge.b]);
    if(boundary.length) {
      const degree=new Map(); for(const edge of boundary)for(const id of edge)degree.set(id,(degree.get(id)||0)+1);
      if([...degree.values()].some(value=>value!==2))throw new Error('原点の断面が閉じていないため、蓋を生成できませんでした。');
      const ids=[...degree.keys()],remap=new Map(ids.map((id,i)=>[id,i])),capPoints=ids.map(id=>points[id]);
      const boundaryEdges=boundary.map(edge=>edge.map(id=>remap.get(id)));
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const [x,y] of capPoints){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      const vertex=id=>{
        const [x,y]=capPoints[id],base=[.02+.96*(x-minX)/Math.max(1e-7,maxX-minX),.02+.96*(maxY-y)/Math.max(1e-7,maxY-minY)];
        const edited=settings.uvEdits?.[surfaceUvKey(0,...base)]||settings.uvEdits?.[`${(base[0]/3).toFixed(6)},${base[1].toFixed(6)}`]||settings.uvEdits?.[`${base[0].toFixed(6)},${base[1].toFixed(6)}`]||base;
        return {p:[x,y,plane],n:[0,0,-1],base,slot:0,uv:transformSurfaceUv(0,...edited,settings),protected:false};
      };
      for(const cell of cdt2d(capPoints,boundaryEdges,{exterior:false})) {
        const [a,b,c]=cell.map(vertex),cross=(b.p[0]-a.p[0])*(c.p[1]-a.p[1])-(b.p[1]-a.p[1])*(c.p[0]-a.p[0]);
        if(cross>0)addTriangle(a,c,b);else addTriangle(a,b,c);
      }
    }
  }
  const result=new BufferGeometry();
  result.setAttribute('position',new Float32BufferAttribute(positions,3)); result.setAttribute('normal',new Float32BufferAttribute(normals,3)); result.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  result.setAttribute('surfaceSlot',new Float32BufferAttribute(slots,1));
  result.userData={...source.userData,extrusionMirror:false,extrusionCap:cap,protectedMidpointIndices:protectedIndices,baseUVs:new Float64Array(bases),uvKeys:Array.from({length:bases.length/2},(_,i)=>surfaceUvKey(slots[i],bases[i*2],bases[i*2+1])),centralWallDepth:(source.userData.centralWallDepth||0)/2};
  result.userData.legacyUVKeys=Array.from({length:bases.length/2},(_,i)=>`${((bases[i*2]+(slots[i]===1?2:0))/3).toFixed(6)},${bases[i*2+1].toFixed(6)}`);
  assignSurfaceGroups(result);
  return result;
}
