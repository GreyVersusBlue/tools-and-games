// SkyWings 64 - sky: analytic-scattering style dome (Rayleigh gradient + Mie glow + sunset band + cirrus + stars),
// layered soft-lit billboard clouds (infinite wrap around camera, slow parallax), aerial-perspective fog, sun glare.
// Owner: agent S. API: createSky(scene) -> { group, sun, hemi, fog, state, dome, setTimeOfDay(t01), update(dt, elapsed, camPos, wind) }
import * as THREE from 'three';
import { makeRng, smoothstep, LAYOUT } from './terrain.js';
import { shared, quality, createAtmosphere, horizonTint } from './atmosphere.js';

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99999;
}`;
const SKY_FRAG = `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uDuskCol;
uniform float uNight; uniform float uDusk; uniform float uGlow; uniform float uTime; uniform vec2 uWind; uniform float uCirrus;
varying vec3 vDir;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.03+vec2(17.0,9.0); a*=0.5; } return s; }
vec3 horizonAt(vec3 d){
  vec2 sh = normalize(uSunDir.xz + 1e-5); vec2 dh = normalize(d.xz + 1e-5);
  float c = max(dot(sh, dh), 0.0);
  return uHorizon + uSunColor * pow(c, 4.0) * uGlow;
}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float h = max(y, 0.0);
  vec3 hor = horizonAt(d);
  // Rayleigh-like gradient: deep zenith, thick pale horizon (optical depth ~ 1/(h+eps))
  float t = exp(-h * 3.6) * 0.86 + exp(-h * 22.0) * 0.14;
  vec3 col = mix(uZenith, hor, clamp(t, 0.0, 1.0));
  float cosS = dot(d, uSunDir);
  // Mie forward scattering (Henyey-Greenstein) + wide aureole
  float g = 0.78;
  float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cosS, 1.5) * 0.028;
  col += uSunColor * mie * (0.35 + 0.65 * exp(-h * 3.0)) * (1.0 - uNight);
  // sunset/dusk band concentrated toward the sun azimuth
  vec2 sh = normalize(uSunDir.xz + 1e-5); vec2 dh = normalize(d.xz + 1e-5);
  float az = max(dot(sh, dh), 0.0);
  float band = exp(-h * 7.0) * (0.25 + 0.75 * pow(az, 2.0)) * uDusk;
  col = mix(col, uDuskCol, clamp(band * 0.85, 0.0, 1.0));
  // sun disc
  col += uSunColor * smoothstep(0.99975, 0.99992, cosS) * 9.0 * (1.0 - uNight) * step(-0.02, y);
  // cirrus layer projected on a high plane
  if (y > 0.0 && uCirrus > 0.01) {
    vec2 uv = d.xz / (y + 0.12) * 0.55 + uWind * uTime * 0.0012;
    float n = fbm(uv * vec2(1.0, 2.2));
    float n2 = fbm(uv * 3.1 + 4.0);
    float c = smoothstep(0.50, 0.85, n) * (0.6 + 0.4 * n2);
    c *= smoothstep(0.0, 0.16, y) * uCirrus;
    vec3 cc = mix(vec3(0.75, 0.82, 0.95), vec3(1.0), 0.6) * (0.5 + 0.7 * (1.0 - uNight)) ;
    cc = mix(cc, uSunColor * 1.2, pow(max(cosS, 0.0), 6.0) * 0.6 + uDusk * 0.4);
    col = mix(col, cc * (1.0 - 0.75 * uNight), c * 0.6);
  }
  if (uNight > 0.01 && y > 0.0) {
    vec3 cc = floor(d * 300.0);
    float st = step(0.9968, hash(cc));
    col += vec3(st) * uNight * smoothstep(0.0, 0.2, y) * (0.5 + hash(cc + 3.0));
  }
  if (y < 0.0) col = mix(col, hor * 0.97, smoothstep(0.0, -0.06, y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------- cloud billboards ----------------
const CLOUD_VERT = `
attribute vec3 aCluster; attribute vec3 aOff; attribute vec4 aP; attribute vec2 aE;
uniform vec2 uDrift; uniform vec3 uCam; uniform float uWrap; uniform vec3 uSun;
uniform vec3 uRight; uniform vec3 uUp; uniform float uFogFar;
varying vec2 vUv; varying float vShade; varying float vAlpha; varying float vFog; varying float vBack;
void main(){
  float size = aP.z; float speed = aE.x; float fixedF = aE.y;
  vec2 c = aCluster.xz + uDrift * speed;
  vec2 rel = c - uCam.xz;
  if (fixedF < 0.5) rel = mod(rel + uWrap, 2.0 * uWrap) - uWrap;
  vec3 center = vec3(uCam.x + rel.x, aCluster.y + aOff.y, uCam.z + rel.y);
  if (fixedF > 0.5) center = vec3(aCluster.x + aOff.x, aCluster.y + aOff.y, aCluster.z + aOff.z);
  else center.xz += aOff.xz;
  float ca = cos(aP.x), sa = sin(aP.x);
  vec2 q = position.xy; q = vec2(q.x*ca - q.y*sa, q.x*sa + q.y*ca);
  vec3 wp = center + (uRight * q.x + uUp * q.y) * size;
  vec3 toCam = wp - uCam;
  float dist = length(toCam);
  vUv = position.xy + 0.5;
  // lighting: puffs on the sunward side/top are brighter; underside is shaded
  vec3 ln = normalize(aOff + vec3(0.0, size * 0.25, 0.0) + 1e-3);
  float lit = dot(ln, uSun) * 0.5 + 0.5;
  vShade = clamp(lit * 0.55 + aP.y * 0.55, 0.0, 1.0);
  vBack = max(dot(normalize(toCam), uSun), 0.0);
  float nearF = smoothstep(size * 0.15, size * 0.85, dist);
  float farF = fixedF > 0.5 ? 1.0 : smoothstep(uWrap, uWrap * 0.72, length(rel));
  vAlpha = aP.w * nearF * farF;
  vFog = clamp(1.0 - exp(-pow(dist / (uFogFar * 0.55), 2.0)), 0.0, 0.75);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const CLOUD_FRAG = `
uniform sampler2D uMap; uniform vec3 uLit; uniform vec3 uShadow; uniform vec3 uFogCol; uniform vec3 uSunCol; uniform vec2 uSunView;
varying vec2 vUv; varying float vShade; varying float vAlpha; varying float vFog; varying float vBack;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  float rim = dot(p, uSunView) * 0.5 + 0.5;
  float s = clamp(vShade * 0.65 + t.r * 0.5 + (rim - 0.5) * 0.22, 0.0, 1.0);
  vec3 col = mix(uShadow, uLit, s);
  // silver lining when the sun is behind the cloud
  col += uSunCol * pow(vBack, 5.0) * pow(1.0 - t.a, 2.0) * 0.9;
  col = mix(col, uFogCol, vFog);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function cloudTexture() {
  const S = 128, data = new Uint8Array(S * S * 4);
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (rnd(xi, yi) * (1 - u) + rnd(xi + 1, yi) * u) * (1 - v) + (rnd(xi, yi + 1) * (1 - u) + rnd(xi + 1, yi + 1) * u) * v;
  };
  const fbm = (x, y) => { let s = 0, a = 0.5; for (let i = 0; i < 5; i++) { s += vnoise(x, y) * a; x = x * 2.03 + 11; y = y * 2.03 + 5; a *= 0.5; } return s; };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = (i / (S - 1)) * 2 - 1, v = (j / (S - 1)) * 2 - 1;      // v up
    const r = Math.sqrt(u * u + v * v);
    const n = fbm(u * 2.6 + 3, v * 2.6 + 7);
    const n2 = fbm(u * 6 + 1, v * 6 + 2);
    let dens = Math.max(0, Math.min(1, (1 - r) * 1.55 + (n - 0.5) * 0.95 + (n2 - 0.5) * 0.3 - 0.05));
    dens = dens * dens * (3 - 2 * dens);
    dens *= smoothstep(1.0, 0.72, r);
    let sh = 0.55 + 0.35 * v - 0.35 * dens * (1 - n) + (n2 - 0.5) * 0.25;
    sh = Math.max(0, Math.min(1, sh));
    const o = (j * S + i) * 4;
    data[o] = data[o + 1] = data[o + 2] = Math.round(sh * 255);
    data[o + 3] = Math.round(dens * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

const C = (h) => new THREE.Color(h);
const PAL = {
  zenithDay: C(0x1f6fe0), zenithDusk: C(0x34478f), zenithNight: C(0x030718),
  horDay: C(0xb6dbf6), horDusk: C(0xf3a877), horNight: C(0x0a1230),
  sunDay: C(0xfff1d0), sunDusk: C(0xff8a3c), duskCol: C(0xff9a5a),
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createSky(scene) {
  const q = quality();
  const group = new THREE.Group();
  group.name = 'sky';
  const swr = () => (scene.userData && scene.userData.swRender) || null;
  const handled = !!(swr() && swr().handlesLighting);

  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uDuskCol: { value: PAL.duskCol.clone() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 }, uDusk: { value: 0 }, uGlow: { value: shared.glowAmt }, uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(3, 1) }, uCirrus: { value: q === 'low' ? 0 : 1 },
  };
  const domeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 40, 24), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  const hemi = new THREE.HemisphereLight(0xbfdfff, 0x6f8a4a, 1.15);
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.4);
  sun.position.set(800, 1000, 300);
  sun.target.position.set(0, 0, 0);
  if (!handled) group.add(hemi, sun, sun.target);

  const fog = new THREE.Fog(0xb4defc, 260, 7000);
  if (!handled) { scene.fog = fog; }
  if (!handled && (!scene.background || scene.background.isColor)) scene.background = new THREE.Color(0xb4defc);

  // ---- clouds ----
  const rng = makeRng(4242);
  const cloudTex = cloudTexture();
  const clusters = [];   // {x,y,z,r,n,puff,alpha,speed,fixed,flat}
  const nLow = q === 'low' ? 28 : q === 'medium' ? 46 : 64;
  for (let i = 0; i < nLow; i++) clusters.push({ x: (rng() - 0.5) * 9000, y: 430 + rng() * 300, z: (rng() - 0.5) * 9000, r: 140 + rng() * 260, n: 10 + Math.floor(rng() * 8), puff: 150 + rng() * 170, alpha: 0.9, speed: 0.8 + rng() * 0.5, fixed: 0, flat: 0.5 });
  for (const t of LAYOUT.thermals) clusters.push({ x: t.x, y: 640 + rng() * 40, z: t.z, r: 150, n: 16, puff: 230 + rng() * 60, alpha: 0.95, speed: 0, fixed: 1, flat: 0.55 });
  const nHigh = q === 'low' ? 10 : 26;
  for (let i = 0; i < nHigh; i++) clusters.push({ x: (rng() - 0.5) * 9000, y: 1250 + rng() * 350, z: (rng() - 0.5) * 9000, r: 500 + rng() * 500, n: 8, puff: 600 + rng() * 400, alpha: 0.42, speed: 0.35 + rng() * 0.2, fixed: 0, flat: 0.08 });
  let total = 0; for (const c of clusters) total += c.n;

  const aCluster = new Float32Array(total * 3), aOff = new Float32Array(total * 3), aP = new Float32Array(total * 4), aE = new Float32Array(total * 2);
  let k = 0;
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++, k++) {
      const a = rng() * 6.283, rr = Math.sqrt(rng()) * c.r;
      const ox = Math.cos(a) * rr * 1.2, oz = Math.sin(a) * rr;
      const edge = rr / c.r;
      // dome shaped: taller in the middle, flat base
      const oy = (1 - edge * edge) * c.r * (c.flat * 1.1) * (0.3 + rng() * 0.7) + rng() * c.r * 0.05;
      const sz = c.puff * (0.55 + 0.7 * (1 - edge * 0.6)) * (0.8 + rng() * 0.4);
      aCluster.set([c.x, c.y, c.z], k * 3); aOff.set([ox, oy, oz], k * 3);
      const hgt = clamp01(oy / (c.r * c.flat * 1.2 + 1));
      aP.set([rng() * 6.283, hgt, sz, c.alpha * (0.8 + rng() * 0.2)], k * 4);
      aE.set([c.speed, c.fixed], k * 2);
    }
  }
  const cg = new THREE.InstancedBufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  cg.setIndex([0, 1, 2, 0, 2, 3]);
  cg.setAttribute('aCluster', new THREE.InstancedBufferAttribute(aCluster, 3));
  cg.setAttribute('aOff', new THREE.InstancedBufferAttribute(aOff, 3));
  cg.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
  cg.setAttribute('aE', new THREE.InstancedBufferAttribute(aE, 2));
  cg.instanceCount = total;
  const cu = {
    uMap: { value: cloudTex }, uDrift: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() }, uWrap: { value: 4800 },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
    uFogFar: { value: 7000 }, uLit: { value: new THREE.Color(1, 1, 1) }, uShadow: { value: new THREE.Color(0.6, 0.68, 0.8) },
    uFogCol: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunView: { value: new THREE.Vector2(0, 1) },
  };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cu, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, fog: false,
  });
  const clouds = new THREE.Mesh(cg, cloudMat);
  clouds.frustumCulled = false; clouds.renderOrder = -500; clouds.name = 'clouds';
  group.add(clouds);

  const state = { t: 0.12, sunDir: shared.sunDir, daylight: 1, sunColor: new THREE.Color(), horizon: new THREE.Color(), zenith: new THREE.Color() };
  const atm = createAtmosphere(scene, { state });
  group.add(atm.group);
  const drift = new THREE.Vector2();
  const hemiSky = new THREE.Color(), tmp = new THREE.Color();

  function applySun(dir) {
    shared.sunDir.copy(dir).normalize();
    const el = shared.sunDir.y;
    const dayF = smoothstep(0.02, 0.5, el);
    const nightF = smoothstep(0.05, -0.3, el);
    const dusk = smoothstep(0.55, 0.05, el) * smoothstep(-0.32, -0.02, el);
    state.daylight = clamp01(0.08 + dayF * 0.92 + (el > -0.05 ? 0.15 : 0)) * (1 - nightF * 0.85);
    shared.daylight = state.daylight; shared.night = nightF; shared.dusk = dusk;
    state.horizon.copy(PAL.horDusk).lerp(PAL.horDay, dayF).lerp(PAL.horNight, nightF);
    state.zenith.copy(PAL.zenithDusk).lerp(PAL.zenithDay, dayF).lerp(PAL.zenithNight, nightF);
    state.sunColor.copy(PAL.sunDusk).lerp(PAL.sunDay, dayF);
    uniforms.uHorizon.value.copy(state.horizon); uniforms.uZenith.value.copy(state.zenith);
    uniforms.uSunColor.value.copy(state.sunColor); uniforms.uSunDir.value.copy(shared.sunDir);
    uniforms.uNight.value = nightF; uniforms.uDusk.value = dusk;
    uniforms.uGlow.value = shared.glowAmt * (0.5 + 0.9 * dusk) * (1 - nightF);
    uniforms.uCirrus.value = q === 'low' ? 0 : 1;
    fog.color.copy(state.horizon);
    if (!handled && scene.background && scene.background.isColor) scene.background.copy(state.horizon);
    fog.far = 7000 - 2600 * nightF;
    cu.uFogFar.value = fog.far;
    if (!handled) {
      sun.position.copy(shared.sunDir).multiplyScalar(1500);
      sun.color.copy(state.sunColor);
      sun.intensity = 2.4 * clamp01(dayF * 1.2 + (el > 0 ? 0.25 : 0)) * (1 - nightF);
      hemi.intensity = 0.25 + 0.9 * state.daylight;
      hemi.color.copy(state.horizon).lerp(hemiSky.setRGB(0.6, 0.8, 1.0), 0.5 * dayF);
      hemi.groundColor.set(0x6f8a4a).multiplyScalar(0.3 + 0.7 * state.daylight);
    }
    // cloud colours follow the light
    cu.uLit.value.setRGB(1, 1, 1).lerp(state.sunColor, 0.4 * (1 - dayF * 0.6)).multiplyScalar(0.35 + 0.75 * state.daylight);
    cu.uShadow.value.copy(state.zenith).lerp(tmp.setRGB(0.72, 0.78, 0.9), 0.55 + 0.25 * dayF).multiplyScalar(0.25 + 0.6 * state.daylight);
    cu.uSunCol.value.copy(state.sunColor).multiplyScalar(state.daylight);
    cu.uSun.value.copy(shared.sunDir);
  }

  function setTimeOfDay(t01) {
    // 0 = sunrise (east), 0.25 = noon, 0.5 = sunset, 0.75 = midnight
    const t = ((t01 % 1) + 1) % 1;
    state.t = t;
    const a = t * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a) * 0.85, Math.sin(a), -0.45).normalize();
    applySun(dir);
    const r = swr();
    if (r && r.setSun) { try { r.setSun(dir.clone()); } catch (e) { /* ignore */ } }
  }
  setTimeOfDay(0.12);

  const _l = new THREE.Vector3();
  return {
    group, sun, hemi, fog, state, setTimeOfDay, dome, uniforms, atmosphere: atm,
    update(dt, elapsed, cam, wind) {
      const r = swr();
      if (r && r.sunDirection && r.sunDirection.distanceToSquared(shared.sunDir) > 1e-6) applySun(r.sunDirection);
      const wx = wind ? wind.x : 3, wz = wind ? wind.z : 1;
      shared.wind.x = wx; shared.wind.z = wz;
      drift.x += wx * 3 * dt; drift.y += wz * 3 * dt;
      cu.uDrift.value.copy(drift);
      uniforms.uTime.value = elapsed; uniforms.uWind.value.set(wx, wz);
      atm.update(dt, elapsed, cam);
      const camera = atm.glare && scene.children.find((o) => o.isCamera);
      if (camera) {
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        cu.uRight.value.set(e[0], e[1], e[2]);
        cu.uUp.value.set(e[4], e[5], e[6]);
        _l.copy(shared.sunDir).transformDirection(camera.matrixWorldInverse);
        cu.uSunView.value.set(_l.x, _l.y).normalize();
      }
      cu.uCam.value.copy(shared.camPos);
      if (!handled) atm.updateFog(fog, state.horizon, state.sunColor);
      if (!handled && scene.background && scene.background.isColor) scene.background.copy(fog.color);
      cu.uFogCol.value.copy(scene.fog ? scene.fog.color : fog.color);
    },
  };
}
