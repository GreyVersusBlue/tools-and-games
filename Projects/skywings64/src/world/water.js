// SkyWings 64 - ocean: normal-map waves, fresnel sky reflection, sun glint, depth-based turquoise->deep colour,
// animated shoreline foam and whitecaps. Custom shader (no planar reflection pass -> cheap, 60fps friendly).
import * as THREE from 'three';
import { N, NV, HALF, SEA_DEPTH, Noise } from './terrain.js';

const WAVES = `
float waveH(vec2 p){
  float t = uTime;
  return 0.50*sin(p.x*0.021 + t*0.90) + 0.40*sin(p.y*0.017 - t*0.75 + 1.3)
       + 0.25*sin((p.x+p.y)*0.035 + t*1.30) + 0.12*sin((p.x-p.y)*0.06 - t*1.70);
}
vec2 waveGrad(vec2 p){
  float t = uTime;
  float a = 0.50*0.021*cos(p.x*0.021 + t*0.90);
  float b = 0.40*0.017*cos(p.y*0.017 - t*0.75 + 1.3);
  float c = 0.25*0.035*cos((p.x+p.y)*0.035 + t*1.30);
  float d = 0.12*0.06*cos((p.x-p.y)*0.06 - t*1.70);
  return vec2(a + c + d, b + c - d);
}
`;

const VERT = `
uniform float uTime;
varying vec3 vWorld;
#include <fog_pars_vertex>
${WAVES}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += waveH(wp.xz);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `
uniform float uTime;
uniform sampler2D uDepth;
uniform sampler2D uNormals;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uLight;
varying vec3 vWorld;
#include <fog_pars_fragment>
${WAVES}
vec2 rot(vec2 p){ return mat2(0.8, -0.6, 0.6, 0.8) * p; }
void main(){
  vec2 uv = (vWorld.xz + ${HALF}.0) / ${HALF * 2}.0 * ${(NV - 1) / NV} + ${0.5 / NV};
  vec4 dt = texture2D(uDepth, uv);
  bool inMap = abs(vWorld.x) < ${HALF}.0 && abs(vWorld.z) < ${HALF}.0;
  float depth = inMap ? dt.g * 6.0 - 0.5 : 60.0;            // fine depth (metres, -0.5..5.5)
  float deepM = inMap ? dt.r * 40.0 : 40.0;                 // coarse depth (0..40)
  if (deepM > 5.0) depth = deepM;
  float dist = length(cameraPosition - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);

  // normal-map waves: three scrolling octaves, faded with distance to avoid shimmer
  float t = uTime;
  vec4 n1 = texture2D(uNormals, vWorld.xz * 0.018 + vec2(t * 0.012, t * 0.008));
  vec4 n2 = texture2D(uNormals, rot(vWorld.xz) * 0.055 + vec2(-t * 0.02, t * 0.015));
  vec4 n3 = texture2D(uNormals, rot(rot(vWorld.xz)) * 0.21 + vec2(t * 0.05, -t * 0.03));
  float fine = 1.0 - smoothstep(80.0, 1000.0, dist);
  float mid = 1.0 - smoothstep(500.0, 3000.0, dist);
  vec2 nm = (n1.xy - 0.5) * 1.0 + (n2.xy - 0.5) * 0.6 * mid + (n3.xy - 0.5) * 0.3 * fine;
  vec2 g = waveGrad(vWorld.xz);
  vec3 n = normalize(vec3(-g.x * 1.6 - nm.x * (1.6 - 0.9 * (1.0 - fine)), 1.0, -g.y * 1.6 - nm.y * (1.6 - 0.9 * (1.0 - fine))));
  // flatten slightly toward the horizon so distant water is calm/clean
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(800.0, 5000.0, dist) * 0.6));

  // depth colour: Beer-Lambert absorption over a sandy bed, then deep colour
  vec3 bed = vec3(0.86, 0.80, 0.58);
  vec3 absorb = vec3(0.42, 0.11, 0.075);
  float dd = max(depth, 0.0);
  vec3 trans = exp(-dd * absorb);
  vec3 deepCol = mix(uShallow, uDeep, smoothstep(2.0, 26.0, dd));
  vec3 body = mix(deepCol, bed * uShallow * 1.5, trans * (1.0 - smoothstep(3.0, 9.0, dd)));
  body = mix(body, uShallow * 1.15, (1.0 - smoothstep(0.0, 1.2, dd)) * 0.35);
  float diff = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  body *= diff * uLight;
  // subsurface glow through wave crests toward the sun
  float crest = clamp(waveH(vWorld.xz) * 0.5 + 0.4, 0.0, 1.0);
  float sss = pow(max(dot(V, -normalize(uSunDir + n * 0.4)), 0.0), 3.0) * crest;
  body += uShallow * vec3(0.6, 1.1, 0.9) * sss * 0.35 * uLight;

  // reflection: sky gradient + sun glint
  vec3 R = reflect(-V, n);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(ry, 0.45));
  sky = mix(sky, uHorizon * 1.05, exp(-ry * 6.0) * 0.5) * (0.85 + 0.25 * uLight);
  float ndv = max(dot(V, n), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres = clamp(fres * 1.0 + 0.04, 0.0, 1.0);
  vec3 col = mix(body, sky, fres);
  float sd = max(dot(R, uSunDir), 0.0);
  float glint = pow(sd, 700.0) * 9.0 + pow(sd, 120.0) * 0.9 + pow(sd, 14.0) * 0.09;
  col += uSunColor * glint * uLight * (0.4 + 0.6 * fine);

  // foam: shoreline bands + breaking lines + whitecaps
  float fn1 = texture2D(uNormals, vWorld.xz * 0.09 + vec2(t * 0.01, 0.0)).a;
  float fn2 = texture2D(uNormals, rot(vWorld.xz) * 0.37 - vec2(0.0, t * 0.03)).a;
  float foamN = fn1 * 0.6 + fn2 * 0.5;
  float sw = 0.5 + 0.5 * sin(t * 1.1 + vWorld.x * 0.01);
  float edge = depth + 0.35 * sin(t * 1.25 - depth * 3.0) + waveH(vWorld.xz) * 0.35;
  float shore = (1.0 - smoothstep(0.0, 0.9 + 0.5 * sw, edge)) * smoothstep(0.2, 0.55, foamN + 0.25);
  float line = smoothstep(0.75, 1.0, sin(depth * 2.6 - t * 1.4 + foamN * 2.0)) * (1.0 - smoothstep(1.2, 4.2, depth)) * smoothstep(0.3, 0.6, foamN) * 0.6;
  float cap = smoothstep(0.78, 1.15, waveH(vWorld.xz) * 0.62 + (n1.a - 0.5) * 0.5 + 0.35) * smoothstep(0.5, 0.75, foamN) * 0.7 * (1.0 - smoothstep(1500.0, 3500.0, dist));
  float foam = clamp(shore + line + cap, 0.0, 1.0) * step(-0.4, depth);
  vec3 foamCol = vec3(0.96, 0.98, 1.0) * (0.35 + 0.65 * uLight);
  col = mix(col, foamCol, foam * 0.92);

  float alpha = smoothstep(-0.15, 0.55, depth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// tileable RGBA texture: rg = normal-map slope of a ridged multi-octave wave field, a = soft cellular foam noise
function makeWaveTexture(size = 256) {
  const rng = new Noise(4242);
  const per = (x, y, f) => {   // periodic noise: tile by sampling a torus embedding
    const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
    return rng.n2(Math.cos(a) * f + 20, Math.sin(a) * f + 20) * 0.6 + rng.n2(Math.cos(b) * f + 60, Math.sin(b) * f + 60) * 0.6
      + rng.n2(Math.cos(a) * f * 0.7 + Math.sin(b) * f * 0.7 + 90, Math.sin(a) * f * 0.7 + Math.cos(b) * f * 0.7 + 90) * 0.8;
  };
  const hgt = new Float32Array(size * size), fo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0, amp = 1, f = 2.0;
    for (let o = 0; o < 4; o++) { const v = 1 - Math.abs(per(x, y, f)); h += v * v * amp; amp *= 0.5; f *= 2.1; }
    hgt[y * size + x] = h;
    fo[y * size + x] = per(x + 37, y + 11, 3.0) * 0.5 + per(x, y, 7.0) * 0.35 + 0.5;
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
    const o = (y * size + x) * 4;
    data[o] = Math.max(0, Math.min(255, 128 + dx * 127));
    data[o + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
    data[o + 2] = 255;
    data[o + 3] = Math.max(0, Math.min(255, fo[y * size + x] * 255));
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function createWater(terrain) {
  const bytes = new Uint8Array(NV * NV * 4);
  const H = terrain.H;
  for (let i = 0; i < NV * NV; i++) {
    const d = -H[i];
    bytes[i * 4] = Math.round(clamp01(d / 40) * 255);
    bytes[i * 4 + 1] = Math.round(clamp01((d + 0.5) / 6) * 255);
    bytes[i * 4 + 2] = 0; bytes[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, NV, NV, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uDepth: { value: tex }, uNormals: { value: makeWaveTexture(256) },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }, uSunColor: { value: new THREE.Color(1, 0.95, 0.8) },
    uSky: { value: new THREE.Color(0.5, 0.7, 0.95) },
    uHorizon: { value: new THREE.Color(0.7, 0.87, 0.99) }, uZenith: { value: new THREE.Color(0.16, 0.47, 0.88) },
    uShallow: { value: new THREE.Color(0.06, 0.62, 0.62) }, uDeep: { value: new THREE.Color(0.0, 0.1, 0.32) },
    uLight: { value: 1 },
  }]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, fog: true });
  const geo = new THREE.PlaneGeometry(9200, 9200, 300, 300);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'sea';

  const SNAP = 9200 / 300;
  return {
    mesh,
    uniforms,
    update(dt, elapsed, cam) {
      uniforms.uTime.value = elapsed;
      if (cam) { mesh.position.x = Math.round(cam.x / SNAP) * SNAP; mesh.position.z = Math.round(cam.z / SNAP) * SNAP; }
    },
    // CPU mirror of vertex wave height (for splash effects / floaters)
    waveAt(x, z, t) {
      return 0.50 * Math.sin(x * 0.021 + t * 0.90) + 0.40 * Math.sin(z * 0.017 - t * 0.75 + 1.3)
        + 0.25 * Math.sin((x + z) * 0.035 + t * 1.30) + 0.12 * Math.sin((x - z) * 0.06 - t * 1.70);
    },
    setLighting(sunDir, sunColor, skyColor, light, horizon, zenith) {
      uniforms.uSunDir.value.copy(sunDir); uniforms.uSunColor.value.copy(sunColor);
      uniforms.uSky.value.copy(skyColor); uniforms.uLight.value = light;
      if (horizon) uniforms.uHorizon.value.copy(horizon);
      if (zenith) uniforms.uZenith.value.copy(zenith);
    },
  };
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
