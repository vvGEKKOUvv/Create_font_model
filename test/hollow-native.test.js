import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { parseSvg, buildMesh, applyUvSettings, exportObj } from "../src/geometry.js";
import { defaultProfile } from "../src/bevel-profile.js";

globalThis.DOMParser = DOMParser;

function annulus(scale = 1) {
  return parseSvg(`<svg><path fill-rule="evenodd" d="M0 0H${100*scale}V${100*scale}H0Z M${40*scale} ${40*scale}V${60*scale}H${60*scale}V${40*scale}Z"/></svg>`).objects[0].shape;
}
function triangles(geometry) {
  const p = geometry.attributes.position;
  const faces = [];
  for (let i = 0; i < p.count; i += 3)
    faces.push([0,1,2].map(j => [p.getX(i+j),p.getY(i+j),p.getZ(i+j)]));
  return faces;
}
function rayHits(geometry, x, y) {
  return triangles(geometry).filter(tri => {
    const [a,b,c] = tri;
    const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(area)<1e-16) return false;
    const signs=tri.map((p,i) => {const q=tri[(i+1)%3];return ((q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]))/area;});
    return signs.every(v => v >= -1e-8);
  }).length;
}
function closedVolume(geometry) {
  for (const name of ["position","normal","uv"])
    assert.ok(Array.from(geometry.attributes[name].array).every(Number.isFinite));
  geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  const step=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z)*1e-7;
  const key=p=>p.map(v=>Math.round(v/step)).join(",");
  const edges=new Map();
  let volume=0;
  for (const [a,b,c] of triangles(geometry)) {
    const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>step*step);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for (const [from,to] of [[a,b],[b,c],[c,a]]) {
      const first=key(from),second=key(to),k=[first,second].sort().join("|");
      const edge=edges.get(k)??{count:0,direction:0};
      edge.count++;edge.direction+=first<second?1:-1;edges.set(k,edge);
    }
  }
  assert.ok(volume>0);
  for (const edge of edges.values()) {
    assert.equal(edge.count,2,"all components are closed");
    assert.equal(edge.direction,0,"shared edges have opposite orientation");
  }
  return volume;
}
function wallAndCavityRays(geometry, scale) {
  assert.ok(rayHits(geometry,1.37*scale,-20.31*scale)>0,"original exterior boundary has a wall");
  assert.ok(rayHits(geometry,38.63*scale,-50.31*scale)>0,"original hole boundary has its own wall");
  assert.equal(rayHits(geometry,20.13*scale,-20.31*scale),0,"new hollow removes the region between both boundary walls");
  assert.equal(rayHits(geometry,50.13*scale,-50.31*scale),0,"original imported hole remains open");
}

test("hollowing an imported annulus leaves separate outer and original-hole walls", () => {
  const shape=annulus();
  const solid=buildMesh(shape,{depth:20,bevelSize:0});
  assert.ok(rayHits(solid,20.13,-20.31)>0,"source annulus contains the material that hollowing must remove");
  const hollow=buildMesh(shape,{depth:20,bevelSize:0,hollow:true,wallThickness:3});
  assert.equal(hollow.userData.hollowComponentCount,2,"outer boundary and imported hole produce separate wall components");
  const volume=closedVolume(hollow);
  assert.ok(Math.abs(volume-((10000-94*94)+(26*26-20*20))*20)<1e-4,"both perimeter walls retain the requested thickness");
  wallAndCavityRays(hollow,1);
});

test("native-hole hollow bevels retain both walls, cavities and independently editable UV/OBJ at small scales", () => {
  const outer=defaultProfile();
  const inner=[{x:0,y:0},{x:0.5,y:0.8},{x:1,y:1}];
  for(const scale of [1,0.001]) for(const bevelContinue of [false,true]) {
    const settings={depth:20*scale,bevelSize:8*scale,bevelWidth:1*scale,bevelSegments:5,hollow:true,wallThickness:3*scale,bevelContinue,curvePoints:outer,innerCurvePoints:inner};
    const geometry=buildMesh(annulus(scale),settings);
    closedVolume(geometry);wallAndCavityRays(geometry,scale);
    assert.equal(geometry.userData.effectiveBevelDepth,8*scale,"thin imported walls still receive the requested axial bevel");
    assert.ok(triangles(geometry).some(tri => {
      const z=tri.map(p=>p[2]);
      const area=Math.abs((tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1])-(tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0]));
      return area>scale*scale*1e-8 && Math.min(...z)>scale*1e-6 && Math.max(...z)<8*scale-scale*1e-6 && Math.max(...z)-Math.min(...z)>scale*1e-6;
    }),"actual mesh contains intermediate sloping bevel faces");
    const position=geometry.attributes.position;
    const sourcePositions=Array.from(position.array);
    const key=geometry.userData.uvKeys[0];
    assert.ok(key);
    applyUvSettings(geometry,{...settings,uvEdits:{[key]:[0.25,0.75]},uvScaleX:1.3,uvRotation:17});
    assert.equal(geometry.attributes.position,position);
    assert.deepEqual(Array.from(position.array),sourcePositions);
    assert.equal(geometry.attributes.uv.count,position.count);
    assert.ok(Array.from(geometry.attributes.uv.array).every(Number.isFinite));
    const {obj}=exportObj([{name:"Annulus",geometry,color:"#ffffff"}]);
    assert.ok(!/NaN|Infinity/.test(obj));
    const vertexCount=(obj.match(/^v /gm)??[]).length;
    const uvCount=(obj.match(/^vt /gm)??[]).length;
    const normalCount=(obj.match(/^vn /gm)??[]).length;
    for(const line of obj.split("\n").filter(l=>l.startsWith("f ")))
      for(const token of line.slice(2).split(" "))
        token.split("/").forEach((value,i)=>assert.ok(Number(value)>=1&&Number(value)<=[vertexCount,uvCount,normalCount][i]));
  }
});
