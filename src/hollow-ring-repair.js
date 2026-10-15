import { validateRoofTriangles } from './roof-topology.js';

// Repair only the known meeting contour. New vertices lie on existing triangle
// edges; no cap, bridge across a hole, or additional bevel profile is created.
export function repairHollowMidpointTriangles(triangles, roof, heightAt) {
  if (!roof.midpointRoof || !roof.midpointLoops?.length) {
    validateRoofTriangles(triangles, roof.rings);
    return triangles;
  }
  const anchors=roof.midpointLoops.flat(), half=roof.maximumWidth;
  const failure=message=>{const error=new Error(message);error.code='INVALID_BEVEL_TOPOLOGY';throw error;};
  if(!(half>0)||!Number.isFinite(half)||anchors.some(p=>![p.x,p.y,p.time].every(Number.isFinite))||
    triangles.some(t=>t.points.length!==3||t.points.some(p=>![p.x,p.y,p.time,p.height].every(Number.isFinite))))
    failure('中抜き中心線に不正な座標があります。');
  const midpointHeight=heightAt(half);
  if(!Number.isFinite(midpointHeight))failure('中抜き中心線に不正な高さがあります。');
  const xs=anchors.map(p=>p.x),ys=anchors.map(p=>p.y);
  const minX=Math.min(...xs),minY=Math.min(...ys);
  const span=Math.max(1,Math.max(...xs)-minX,Math.max(...ys)-minY);
  const tolerance=Math.min(span*2e-7,half*1e-4), cell=span/Math.max(1,Math.sqrt(anchors.length));
  const fine=new Map(),coarse=new Map(),loopOf=new WeakMap();
  const anchorLoop=new WeakMap();
  roof.midpointLoops.forEach((loop,id)=>loop.forEach(p=>anchorLoop.set(p,id)));
  const add=(map,x,y,p)=>{const k=`${x},${y}`;if(!map.has(k))map.set(k,[]);map.get(k).push(p);};
  for(const p of anchors){
    add(fine,Math.floor(p.x/tolerance),Math.floor(p.y/tolerance),p);
    add(coarse,Math.floor((p.x-minX)/cell),Math.floor((p.y-minY)/cell),p);
  }
  const midpoint=p=>p.time>0&&Math.abs(p.time-half)<=tolerance;
  const snap=p=>{
    if(!midpoint(p))return p;
    const x=Math.floor(p.x/tolerance),y=Math.floor(p.y/tolerance);
    let best=null,distance=tolerance*tolerance;const loops=new Set();
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const a of fine.get(`${x+dx},${y+dy}`)||[]){
      const d=(a.x-p.x)**2+(a.y-p.y)**2;
      if(d<=tolerance*tolerance)loops.add(anchorLoop.get(a));
      if(d<=distance){best=a;distance=d;}
    }
    if(loops.size>1)failure('異なる中抜き中心線が近接しすぎています。');
    if(!best)return p;
    const point={...p,x:best.x,y:best.y,time:half,height:midpointHeight};
    loopOf.set(point,anchorLoop.get(best));return point;
  };
  const cross=([a,b,c])=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const result=[];
  for(const triangle of triangles){
    const points=triangle.points.map(snap),originalCross=cross(triangle.points);
    const pending=[points];let total=0;
    while(pending.length){
      const current=pending.pop();let split=false;
      for(let edge=0;edge<3&&!split;edge++){
        const a=current[edge],b=current[(edge+1)%3],opposite=current[(edge+2)%3];
        if(!midpoint(a)||!midpoint(b))continue;
        const dx=b.x-a.x,dy=b.y-a.y,lengthSq=dx*dx+dy*dy;
        if(lengthSq<=tolerance*tolerance)continue;
        const length=Math.sqrt(lengthSq), candidates=[];
        const x0=Math.floor((Math.min(a.x,b.x)-minX-tolerance)/cell),x1=Math.floor((Math.max(a.x,b.x)-minX+tolerance)/cell);
        const y0=Math.floor((Math.min(a.y,b.y)-minY-tolerance)/cell),y1=Math.floor((Math.max(a.y,b.y)-minY+tolerance)/cell);
        for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const p of coarse.get(`${x},${y}`)||[]){
          const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/lengthSq;
          if(t<=tolerance/length||t>=1-tolerance/length)continue;
          // A point within Float32 precision may be off the double edge. It
          // must still coincide with that edge in the renderer; global area
          // and incidence checks below reject geometric repairs beyond this.
          if(Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)>tolerance*length)continue;
          candidates.push({p,t});
        }
        if(!candidates.length)continue;
        const aLoop=loopOf.get(a),bLoop=loopOf.get(b);
        const loops=new Set(candidates.map(({p})=>anchorLoop.get(p)));
        if(aLoop!==undefined)loops.add(aLoop);
        if(bLoop!==undefined)loops.add(bLoop);
        if(loops.size>1)failure('異なる中抜き中心線を接続できません。');
        candidates.sort((u,v)=>u.t-v.t);
        const chain=[a];
        for(const {p}of candidates)if(Math.hypot(p.x-chain.at(-1).x,p.y-chain.at(-1).y)>tolerance){
          const point={...p,time:half,height:midpointHeight};
          loopOf.set(point,anchorLoop.get(p));chain.push(point);
        }
        chain.push(b);
        for(let i=1;i<chain.length;i++)pending.push([chain[i-1],chain[i],opposite]);
        split=true;
      }
      if(!split){
        const area=cross(current);
        if(area===0)continue;
        if(area*originalCross<=0)failure('中抜き中心線の修復で面の向きが変わりました。');
        total+=area;result.push({...triangle,points:current});
      }
    }
    if(Math.abs(total-originalCross)>Math.max(tolerance*span*8,Math.abs(originalCross)*1e-6))
      failure('中抜き中心線の修復範囲が大きすぎます。');
  }
  validateRoofTriangles(result,roof.rings);
  return result;
}
