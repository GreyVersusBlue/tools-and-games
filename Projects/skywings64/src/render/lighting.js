// SkyWings 64 - sun, sky/ground fill, HDR environment (PMREM), time-of-day presets, stable shadow fitting.
import * as THREE from 'three';

export const TOD_PRESETS = {
  morning:     { elev: 20, azim: 115, color: 0xffd6a8, intensity: 2.6, hemiSky: 0xcfe0ff, hemiGround: 0x7a7a55, hemi: 0.8, t: 0.05 },
  lateMorning: { elev: 42, azim: 130, color: 0xfff1d8, intensity: 3.0, hemiSky: 0xc4e0ff, hemiGround: 0x6f8a4a, hemi: 0.8,  t: 0.12 },
  noon:        { elev: 68, azim: 150, color: 0xfffaf0, intensity: 3.2, hemiSky: 0xbfdcff, hemiGround: 0x6f8a4a, hemi: 0.8,  t: 0.25 },
  golden:      { elev: 11, azim: 250, color: 0xffb070, intensity: 3.6, hemiSky: 0xffd0aa, hemiGround: 0x7a6a50, hemi: 1.0,  t: 0.42 },
};

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _c = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function createLighting(scene, quality) {
  const sunDirection = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
  const sun = new THREE.DirectionalLight(0xfff1d8, 3.0);
  const hemi = new THREE.HemisphereLight(0xc4e0ff, 0x6f8a4a, 0.6);
  sun.name = 'sw-sun'; hemi.name = 'sw-hemi';
  scene.add(sun, sun.target, hemi);

  const size = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
  const extent = quality === 'low' ? 200 : 150;
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  const cam = sun.shadow.camera;
  cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent; cam.near = 1; cam.far = 1800;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.12 * (300 / extent);
  sun.shadow.radius = quality === 'high' ? 3 : 2;

  const L = {
    sun, hemi, sunDirection, extent, mapSize: size, preset: 'lateMorning', foreign: null, envMap: null,
    handlesLighting: true,
    setQuality(q) {
      const sz = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
      const ext = q === 'low' ? 200 : 150;
      L.mapSize = sz; L.extent = ext;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.set(sz, sz);
      const c = sun.shadow.camera;
      c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.updateProjectionMatrix();
      sun.shadow.normalBias = 0.12 * (300 / ext);
      sun.shadow.radius = q === 'high' ? 3 : 2;
    },
    setPreset(name) {
      const p = TOD_PRESETS[name]; if (!p) return false;
      L.preset = name;
      const e = THREE.MathUtils.degToRad(p.elev), a = THREE.MathUtils.degToRad(p.azim);
      sunDirection.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
      sun.color.setHex(p.color); sun.intensity = p.intensity;
      hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = p.hemi;
      return p;
    },
    // Adopt a legacy world-created directional light: mirror it into ours, hide it.
    adoptForeign(light) { L.foreign = light; light.castShadow = false; },
    /** Call every frame. focus = world position to keep shadowed. */
    update(focus) {
      const f = L.foreign;
      if (f) {
        _c.copy(f.position).sub(f.target.position);
        if (_c.lengthSq() > 1e-6) sunDirection.copy(_c).normalize();
        sun.color.copy(f.color); sun.intensity = f.intensity; f.visible = false;
      }
      // texel-snapped shadow frustum in light space
      _x.crossVectors(_up, sunDirection).normalize();
      _y.crossVectors(sunDirection, _x);
      const texel = (2 * L.extent) / L.mapSize;
      const cx = Math.round(focus.dot(_x) / texel) * texel;
      const cy = Math.round(focus.dot(_y) / texel) * texel;
      const cz = focus.dot(sunDirection);
      _c.set(0, 0, 0).addScaledVector(_x, cx).addScaledVector(_y, cy).addScaledVector(sunDirection, cz);
      sun.target.position.copy(_c);
      sun.position.copy(_c).addScaledVector(sunDirection, 900);
      sun.target.updateMatrixWorld();
      sun.intensity = Math.max(0, sun.intensity);
      sun.castShadow = sun.intensity > 0.05 && sunDirection.y > 0.02;
    },
  };
  L.setPreset('lateMorning');
  return L;
}

/** Async: load an HDR, PMREM it into scene.environment. Never throws. */
export async function loadEnvironment(renderer, scene, L, url) {
  try {
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
    const tex = await new RGBELoader().loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromEquirectangular(tex);
    tex.dispose(); pm.dispose();
    L.envMap = rt.texture;
    scene.environment = rt.texture;
    return rt.texture;
  } catch (e) {
    console.warn('[render] HDR environment failed', e);
    return null;
  }
}
