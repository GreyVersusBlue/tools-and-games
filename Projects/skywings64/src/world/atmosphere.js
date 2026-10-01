// SkyWings 64 - atmosphere: shared view/sun state, aerial-perspective fog tint, sun glare + lens haze + god-ray sprite.
// Owner: agent S. Used by sky.js (created inside createSky) and read by vegetation.js / props.js / landmarks.js.
import * as THREE from 'three';

export const quality = () => (typeof window !== 'undefined' && window.SW_QUALITY) || 'high';

// Shared, mutable state (single instance per page). Other world modules read this.
export const shared = {
  camPos: new THREE.Vector3(0, 300, 0),
  camDir: new THREE.Vector3(0, 0, -1),
  sunDir: new THREE.Vector3(0.6, 0.7, -0.3).normalize(),
  daylight: 1,      // 0 night .. 1 full day
  night: 0,
  dusk: 0,          // 0..1 how sunset-y
  time: 0,
  wind: { x: 3.2, z: 1.4 },
  heightAt: null,   // set by landmarks/vegetation so glare can be terrain-occluded
  glowAmt: 0.22,    // sun-side horizon brighten amount (shared by dome + fog so they match)
};

// Horizon colour toward the sun (used for dome seam AND scene.fog so aerial perspective matches the sky).
const _t = new THREE.Vector3();
export function horizonTint(out, horizon, sunColor, dirX, dirZ) {
  const sx = shared.sunDir.x, sz = shared.sunDir.z;
  const sl = Math.hypot(sx, sz) || 1, dl = Math.hypot(dirX, dirZ) || 1;
  const c = Math.max(0, (sx * dirX + sz * dirZ) / (sl * dl));
  const k = Math.pow(c, 4) * shared.glowAmt * (0.5 + 0.9 * shared.dusk) * (1 - shared.night);
  out.copy(horizon);
  out.r += sunColor.r * k; out.g += sunColor.g * k; out.b += sunColor.b * k;
  return out;
}

const GLARE_V = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const GLARE_F = `
uniform vec3 uColor; uniform float uAmt; uniform float uTime;
varying vec2 vUv;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec2 p = (vUv-0.5)*2.0; float r = length(p); float a = atan(p.y,p.x);
  float core = exp(-r*r*70.0)*1.6;
  float halo = exp(-r*4.5)*0.42 + exp(-r*1.6)*0.10;
  // soft god-ray spokes
  float sp = 0.0;
  for(int i=0;i<3;i++){
    float f = 7.0 + float(i)*5.0;
    sp += pow(abs(sin(a*f + uTime*0.03*float(i+1) + hash(float(i))*6.0)), 6.0 + float(i)*4.0);
  }
  float rays = sp * exp(-r*2.6) * smoothstep(1.0,0.0,r) * 0.35;
  float v = (core + halo + rays) * smoothstep(1.0,0.75,r);
  gl_FragColor = vec4(uColor * v * uAmt, v*uAmt);
}`;

const VEIL_V = `
varying vec2 vN;
void main(){ vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const VEIL_F = `
uniform vec2 uSun; uniform float uAspect; uniform vec3 uColor; uniform float uAmt; uniform float uFacing;
varying vec2 vN;
float disc(vec2 p, vec2 c, float r){ return smoothstep(r, r*0.55, length((p-c)*vec2(uAspect,1.0))); }
void main(){
  vec2 p = vN;
  float d = length((p-uSun)*vec2(uAspect,1.0));
  float bloom = exp(-d*2.2)*0.55 + exp(-d*7.0)*0.6;
  vec3 c = uColor * bloom * uFacing;
  // lens ghosts along the sun -> screen-centre axis
  vec2 ax = -uSun;
  c += vec3(1.0,0.8,0.5)*disc(p, uSun+ax*0.55, 0.10)*0.10*uFacing;
  c += vec3(0.5,0.8,1.0)*disc(p, uSun+ax*1.05, 0.06)*0.14*uFacing;
  c += vec3(1.0,0.5,0.8)*disc(p, uSun+ax*1.55, 0.14)*0.06*uFacing;
  c += vec3(0.7,1.0,0.7)*disc(p, uSun+ax*2.1, 0.05)*0.10*uFacing;
  gl_FragColor = vec4(c*uAmt, 1.0);
}`;

export function createAtmosphere(scene, skyApi) {
  const q = quality();
  const group = new THREE.Group(); group.name = 'atmosphere';
  let camera = null;

  const glareU = { uColor: { value: new THREE.Color(1, 0.95, 0.8) }, uAmt: { value: 1 }, uTime: { value: 0 } };
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: glareU, vertexShader: GLARE_V, fragmentShader: GLARE_F,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  }));
  glare.frustumCulled = false; glare.renderOrder = -900;
  group.add(glare);

  const veilU = {
    uSun: { value: new THREE.Vector2() }, uAspect: { value: 1.7 }, uColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uAmt: { value: 0 }, uFacing: { value: 0 },
  };
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: veilU, vertexShader: VEIL_V, fragmentShader: VEIL_F,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  }));
  veil.frustumCulled = false; veil.renderOrder = 998;
  if (q !== 'low') group.add(veil);

  let vis = 1;
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const sunCol = new THREE.Color(), tmpC = new THREE.Color();

  function findCamera() {
    if (camera && camera.parent) return camera;
    camera = null;
    for (const o of scene.children) if (o.isCamera) { camera = o; break; }
    return camera;
  }

  function terrainVisibility(pos, dir) {
    const H = shared.heightAt;
    if (!H) return 1;
    // march along the sun ray; terrain above ray blocks the sun
    let block = 0;
    for (let d = 150; d <= 6000; d *= 1.55) {
      const x = pos.x + dir.x * d, y = pos.y + dir.y * d, z = pos.z + dir.z * d;
      if (H(x, z) > y) { block = 1; break; }
    }
    return 1 - block;
  }

  function update(dt, elapsed, camPos) {
    const cam = findCamera();
    if (camPos) shared.camPos.copy(camPos);
    if (cam) {
      cam.getWorldDirection(shared.camDir);
      if (!camPos) cam.getWorldPosition(shared.camPos);
    }
    shared.time = elapsed;
    const sun = shared.sunDir;
    const dist = Math.min(9000, ((cam && cam.far) || 12000) * 0.75);
    glare.position.copy(shared.camPos).addScaledVector(sun, dist);
    if (cam) glare.quaternion.copy(cam.quaternion); else glare.lookAt(shared.camPos);
    const size = dist * (0.55 + 0.6 * shared.dusk);
    glare.scale.set(size, size, 1);
    const above = THREE.MathUtils.smoothstep(sun.y, -0.06, 0.06);
    const target = terrainVisibility(shared.camPos, sun) * above;
    vis += (target - vis) * Math.min(1, dt * 6);
    sunCol.copy(skyApi.state.sunColor);
    glareU.uColor.value.copy(sunCol).lerp(tmpC.setRGB(1, 1, 1), 0.25);
    glareU.uAmt.value = vis * (0.55 + 0.5 * shared.dusk);
    glareU.uTime.value = elapsed;
    glare.visible = vis > 0.01 && shared.daylight > 0.05;

    // screen-space veil
    if (cam && veil.parent) {
      _fwd.copy(shared.camDir);
      const facing = Math.max(0, _fwd.dot(sun));
      _p.copy(shared.camPos).addScaledVector(sun, 1000).project(cam);
      veilU.uSun.value.set(_p.x, _p.y);
      veilU.uAspect.value = cam.aspect || 1.7;
      const inFront = facing > 0.05 ? 1 : 0;
      veilU.uFacing.value = Math.pow(facing, 3) * inFront * vis;
      veilU.uColor.value.copy(sunCol);
      veilU.uAmt.value = 0.42 * (0.7 + 0.6 * shared.dusk) * shared.daylight;
      veil.visible = veilU.uFacing.value > 0.005;
    }
  }

  // Fog: linear fog whose colour follows the horizon tint in the direction the camera is looking (aerial perspective).
  function updateFog(fog, horizon, sunColor) {
    if (!fog) return;
    const d = shared.camDir;
    horizonTint(fog.color, horizon, sunColor, d.x, d.z);
  }

  return { group, update, updateFog, glare, veil };
}

// Optional: build a PMREM environment map from the procedural sky (call once with the renderer; assign to scene.environment).
export function createSkyEnvironment(renderer, skyApi, scene) {
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    s.add(skyApi.dome.clone());
    const rt = pm.fromScene(s, 0, 0.1, 200);
    pm.dispose();
    if (scene) scene.environment = rt.texture;
    return rt.texture;
  } catch (e) { return null; }
}
