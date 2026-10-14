import * as THREE from 'three';

export const environmentPresets = ['studio', 'softbox', 'outdoor', 'sunset'];

// Procedural HDR light sources keep the standalone editor fully offline.
export function createEnvironmentController(renderer, scene) {
  const cache = new Map();
  const pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
  function set(preset = 'studio') {
    if (!environmentPresets.includes(preset)) preset = 'studio';
    if (!pmrem) return preset;
    if (!cache.has(preset)) {
      const width = 256, height = 128;
      const data = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const u = x / width, v = y / height;
        let color;
        if (preset === 'outdoor') color = v < .5 ? [.3 + .65 * (1-v), .55 + .6 * (1-v), 1.1] : [.18,.2,.15];
        else if (preset === 'sunset') color = v < .55 ? [.9 * v + .15,.16 + .15 * v,.3 + .35 * (1-v)] : [.12,.08,.07];
        else color = preset === 'softbox' ? [.16,.18,.22] : [.07,.09,.12];
        const wrap = (a,b) => Math.min(Math.abs(a-b), 1-Math.abs(a-b));
        const box = (cx,cy,sx,sy) => Math.exp(-Math.pow(wrap(u,cx)/sx,8)-Math.pow((v-cy)/sy,8));
        const a = box(.22,.32,preset === 'softbox' ? .13 : .045,.2);
        const b = box(.7,.4,.08,.13);
        const sun = Math.exp(-(wrap(u,.62)**2 + (v-.47)**2)/.0005);
        const light = preset === 'sunset' ? [sun*16,sun*5,sun] : preset === 'outdoor' ? [sun*20,sun*18,sun*15] : [a*7+b*4,a*7+b*4.3,a*7+b*5];
        const i=(y*width+x)*4;
        data[i]=color[0]+light[0]; data[i+1]=color[1]+light[1]; data[i+2]=color[2]+light[2]; data[i+3]=1;
      }
      const texture = new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
      texture.mapping=THREE.EquirectangularReflectionMapping;
      texture.needsUpdate=true;
      const target = pmrem.fromEquirectangular(texture);
      texture.dispose();
      cache.set(preset,target);
    }
    scene.environment = cache.get(preset).texture;
    return preset;
  }
  return {set,dispose(){for(const target of cache.values()) target.dispose(); pmrem?.dispose();}};
}
