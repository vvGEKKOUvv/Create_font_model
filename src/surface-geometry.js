/** Front = caps and bevels; side = the straight extrusion walls. */
export const surfaceRegion = slot => slot === 1 ? 'side' : 'front';
export const surfaceUvKey = (slot,u,v) => `${surfaceRegion(slot)}:${u.toFixed(6)},${v.toFixed(6)}`;
export function assignSurfaceGroups(geometry) {
  geometry.clearGroups();
  const slots=geometry.getAttribute('surfaceSlot'),count=geometry.index?.count??geometry.getAttribute('position').count;
  if(!count)return geometry;
  const value=i=>slots?.getX(geometry.index?geometry.index.getX(i):i)===1?1:0;
  let start=0,slot=value(0);
  for(let i=3;i<count;i+=3){const next=value(i);if(next!==slot){geometry.addGroup(start,i-start,slot);start=i;slot=next;}}
  geometry.addGroup(start,count-start,slot);return geometry;
}
function uvTransform(settings,region) {
  const nested=settings[`${region}UV`];
  if(nested!==undefined&&(!nested||typeof nested!=='object'||Array.isArray(nested)))throw new Error('面ごとの UV 設定が不正です。');
  const value={...settings,...nested};
  for(const field of ['uvScale','uvScaleX','uvScaleY','uvOffsetX','uvOffsetY','uvRotation'])if(value[field]!==undefined&&!Number.isFinite(Number(value[field])))throw new Error(`${field} に有限の数値を指定してください。`);
  const scale=Math.max(.0001,Number(value.uvScale)||1),angle=(Number(value.uvRotation)||0)*Math.PI/180;
  return {sx:value.uvScaleX===undefined?scale:Math.max(.0001,Number(value.uvScaleX)),sy:value.uvScaleY===undefined?scale:Math.max(.0001,Number(value.uvScaleY)),x:Number(value.uvOffsetX)||0,y:Number(value.uvOffsetY)||0,c:Math.cos(angle),s:Math.sin(angle)};
}
export function transformSurfaceUv(slot,u,v,settings={}) {
  const t=uvTransform(settings,surfaceRegion(slot));return [(u*t.c-v*t.s)*t.sx+t.x,(u*t.s+v*t.c)*t.sy+t.y];
}
// A centered projection uses the same scale on both axes in contain mode.
// Re-map the existing base coordinates instead of rebuilding any mesh data.
function fitFrontUv(geometry,settings) {
  const mode=settings.frontUVFit??'stretch';
  if(mode!=='stretch'&&mode!=='contain')throw new Error('正面 UV の配置方式が不正です。');
  const previous=geometry.userData.frontUVFit??'stretch';
  if(mode===previous)return;
  const aspect=geometry.userData.frontUVAspect??[1,1],base=geometry.userData.baseUVs;
  const slots=geometry.getAttribute('surfaceSlot'),keys=geometry.userData.uvKeys;
  for(let i=0;i<base.length/2;i++)if(slots?.getX(i)!==1){
    for(let axis=0;axis<2;axis++){
      const factor=Math.max(Number.EPSILON,aspect[axis]);
      const stretch=.5+(base[i*2+axis]-.5)/(previous==='contain'?factor:1);
      base[i*2+axis]=.5+(stretch-.5)*(mode==='contain'?factor:1);
    }
    if(keys)keys[i]=surfaceUvKey(0,base[i*2],base[i*2+1]);
  }
  geometry.userData.frontUVFit=mode;
}
export function applySurfaceUvSettings(geometry,settings={}) {
  const uv=geometry.getAttribute('uv'),base=geometry.userData.baseUVs,keys=geometry.userData.uvKeys,slots=geometry.getAttribute('surfaceSlot');
  if(!base||base.length!==uv.count*2)throw new Error('UV 元データがありません。');
  fitFrontUv(geometry,settings);
  const edits=settings.uvEdits??{};
  if(!edits||typeof edits!=='object'||Array.isArray(edits))throw new Error('UV 編集データの形式が不正です。');
  for(const point of Object.values(edits))if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))throw new Error('UV 編集座標には有限の数値を指定してください。');
  const transforms=[uvTransform(settings,'front'),uvTransform(settings,'side')];
  for(let i=0;i<uv.count;i++){
    const slot=slots?.getX(i)===1?1:0,key=keys?.[i]??surfaceUvKey(slot,base[i*2],base[i*2+1]);
    const legacy=key.replace(/^(?:front|side):/,'');
    const edited=edits[key]??edits[geometry.userData.legacyUVKeys?.[i]]??edits[legacy];
    const u=edited?edited[0]:base[i*2],v=edited?edited[1]:base[i*2+1],t=transforms[slot];
    uv.setXY(i,(u*t.c-v*t.s)*t.sx+t.x,(u*t.s+v*t.c)*t.sy+t.y);
  }
  uv.needsUpdate=true;
}
