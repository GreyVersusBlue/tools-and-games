import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Fx: a single timed effect. Owns scene objects + disposable GPU resources; VFX.update drives it.
// ---------------------------------------------------------------------------------------------
export class Fx {
  constructor(vfx, duration = 1) {
    this.vfx = vfx;
    this.t = 0;
    this.dur = duration;
    this.objects = [];
    this.disposables = [];
    this.dead = false;
    this.onUpdate = null; // (dt, t, k) => void
    this.onEnd = null;
  }
  add(obj, parent) { (parent ?? this.vfx.root).add(obj); this.objects.push(obj); return obj; }
  own(...xs) { for (const x of xs) if (x) this.disposables.push(x); return xs[0]; }
  remove() { this.dead = true; }
  stop() { this.dead = true; }
  get alive() { return !this.dead; }
  tick(dt) {
    if (this.dead) return false;
    this.t += dt;
    const k = this.dur > 0 && Number.isFinite(this.dur) ? Math.min(1, this.t / this.dur) : 0;
    if (this.onUpdate) {
      try { this.onUpdate(dt, this.t, k); } catch (e) { console.warn('[vfx] effect error', e); this.dead = true; }
    }
    if (Number.isFinite(this.dur) && this.t >= this.dur) this.dead = true;
    return !this.dead;
  }
  dispose() {
    try { this.onEnd?.(); } catch { /* ignore */ }
    for (const o of this.objects) o.parent?.remove(o);
    for (const d of this.disposables) d.dispose?.();
    this.objects.length = 0;
    this.disposables.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Shared geometries (never disposed)
// ---------------------------------------------------------------------------------------------
export const GEO = {};
export function initGeometries() {
  const ground = new THREE.PlaneGeometry(1, 1);
  ground.rotateX(-Math.PI / 2);
  GEO.ground = ground; // 1x1 on XZ, scale by diameter
  GEO.plane = new THREE.PlaneGeometry(1, 1);
  GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0); // base at y=0
  GEO.cone = new THREE.CylinderGeometry(0.6, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  GEO.sphere = new THREE.SphereGeometry(1, 20, 14);
  GEO.sphereLow = new THREE.SphereGeometry(1, 10, 8);
  GEO.spike = new THREE.ConeGeometry(0.5, 1, 5, 1).translate(0, 0.5, 0);
  GEO.shard = new THREE.OctahedronGeometry(1, 0);
  GEO.icosa = new THREE.IcosahedronGeometry(1, 0);
  GEO.torus = new THREE.TorusGeometry(1, 0.08, 6, 32);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.dodeca = new THREE.DodecahedronGeometry(1, 0);
  // Arrow along +Z (length 1)
  const shaft = new THREE.CylinderGeometry(0.025, 0.025, 1, 5).rotateX(Math.PI / 2);
  GEO.arrowShaft = shaft;
  GEO.arrowHead = new THREE.ConeGeometry(0.07, 0.22, 6).rotateX(Math.PI / 2).translate(0, 0, 0.6);
  // streak (tracer) along +Z
  GEO.streak = new THREE.CylinderGeometry(0.04, 0.0, 1, 6, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  // Blade (dagger / sword slash sprite) — flat quad along +Z
  GEO.blade = new THREE.PlaneGeometry(0.12, 0.7).rotateX(-Math.PI / 2);
  // Half-ring arc for cleave (in XZ, opening toward +Z)
  GEO.arc = new THREE.RingGeometry(0.7, 1, 24, 1, Math.PI * 0.2, Math.PI * 0.6).rotateX(-Math.PI / 2).rotateY(Math.PI);
  GEO.ring = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
export function addMat(color = 0xffffff, map = null, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, ...extra,
  });
}
export function normMat(color = 0xffffff, map = null, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...extra });
}

const BEAM_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uScroll; uniform float uRepeat;
uniform float uNoise; uniform float uCore; uniform sampler2D uNoiseTex;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float n = texture2D(uNoiseTex, vec2(vUv.x * uRepeat - uTime * uScroll, vUv.y * 0.35 + uTime * 0.2)).r;
  float glow = pow(across, 1.6) * mix(1.0, n * 1.8, uNoise);
  float core = pow(across, 7.0) * uCore;
  float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
  vec3 col = uColor * glow + vec3(1.0) * core;
  gl_FragColor = vec4(col * uOpacity * ends, 1.0);
}`;
export function beamMat(vfx, color, { noise = 0.6, scroll = 2, repeat = 3, core = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uScroll: { value: scroll },
      uRepeat: { value: repeat }, uNoise: { value: noise }, uCore: { value: core }, uNoiseTex: { value: vfx.tex.noise },
    },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

const FIRE_FRAG = /* glsl */`
uniform vec3 uColor; uniform vec3 uColor2; uniform float uOpacity; uniform float uTime; uniform sampler2D uNoiseTex; uniform float uSpeed;
varying vec2 vUv;
void main() {
  float n = texture2D(uNoiseTex, vec2(vUv.x * 2.0, vUv.y * 0.7 - uTime * uSpeed)).r;
  float n2 = texture2D(uNoiseTex, vec2(vUv.x * 3.0 + 0.37, vUv.y * 1.2 - uTime * uSpeed * 1.6)).r;
  float h = vUv.y;
  float shape = smoothstep(0.0, 0.06, h) * pow(1.0 - h, 1.3);
  float v = (n * 0.7 + n2 * 0.6) * shape * 1.7 - h * 0.35;
  v = clamp(v, 0.0, 1.0);
  vec3 col = mix(uColor2, uColor, v);
  col += vec3(1.0, 0.95, 0.8) * smoothstep(0.7, 1.0, v);
  gl_FragColor = vec4(col * v * uOpacity, 1.0);
}`;
export function fireMat(vfx, color = 0xffaa33, color2 = 0xff2200, speed = 1.5) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uColor2: { value: new THREE.Color(color2) }, uOpacity: { value: 1 },
      uTime: { value: 0 }, uNoiseTex: { value: vfx.tex.noise }, uSpeed: { value: speed },
    },
    vertexShader: BEAM_VERT, fragmentShader: FIRE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

const FRESNEL_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vUv = uv;
  vWP = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRESNEL_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uPower; uniform sampler2D uNoiseTex; uniform float uNoise;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWP;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  float n = texture2D(uNoiseTex, vUv * vec2(3.0, 2.0) + vec2(uTime * 0.15, uTime * 0.1)).r;
  float a = (f + 0.08) * mix(1.0, n * 1.8, uNoise);
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;
export function fresnelMat(vfx, color, { power = 2.2, noise = 0.5 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uPower: { value: power },
      uNoiseTex: { value: vfx.tex.noise }, uNoise: { value: noise },
    },
    vertexShader: FRESNEL_VERT, fragmentShader: FRESNEL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
  });
}

// ---------------------------------------------------------------------------------------------
// Ribbon: camera-facing strip through a polyline. Used for beams, lightning, chains, trails.
// ---------------------------------------------------------------------------------------------
const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export class Ribbon {
  constructor(maxPoints, material) {
    this.max = maxPoints;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPoints * 2 * 3);
    const uv = new Float32Array(maxPoints * 2 * 2);
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.uv = uv;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }
  // points: Vector3[]; width: number | (i, u) => number
  setPoints(points, width, camera) {
    const n = Math.min(points.length, this.max);
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    // cumulative length for uv.x
    let total = 0;
    const lens = [0];
    for (let i = 1; i < n; i++) { total += points[i].distanceTo(points[i - 1]); lens.push(total); }
    const cam = camera.position;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      _t.subVectors(b, a).normalize();
      _v.subVectors(cam, p).normalize();
      _s.crossVectors(_t, _v);
      if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
      _s.normalize();
      const u = total > 0 ? lens[i] / total : i / (n - 1);
      const w = (typeof width === 'function' ? width(i, u) : width) * 0.5;
      const j = i * 6;
      this.pos[j] = p.x + _s.x * w; this.pos[j + 1] = p.y + _s.y * w; this.pos[j + 2] = p.z + _s.z * w;
      this.pos[j + 3] = p.x - _s.x * w; this.pos[j + 4] = p.y - _s.y * w; this.pos[j + 5] = p.z - _s.z * w;
      const k = i * 4;
      this.uv[k] = u; this.uv[k + 1] = 0; this.uv[k + 2] = u; this.uv[k + 3] = 1;
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
  dispose() { this.geo.dispose(); }
}

// Jagged lightning path between a and b (midpoint displacement). Returns Vector3[].
export function jaggedPath(a, b, segments = 12, amp = 0.12, out = []) {
  out.length = 0;
  const len = a.distanceTo(b);
  const dir = _t.subVectors(b, a).normalize().clone();
  let p1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(dir.x) > 0.9) p1.set(0, 1, 0);
  const side1 = new THREE.Vector3().crossVectors(dir, p1).normalize();
  const side2 = new THREE.Vector3().crossVectors(dir, side1).normalize();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = new THREE.Vector3().lerpVectors(a, b, u);
    if (i > 0 && i < segments) {
      const env = Math.sin(Math.PI * u);
      const o1 = (Math.random() * 2 - 1) * amp * len * env;
      const o2 = (Math.random() * 2 - 1) * amp * len * env;
      p.addScaledVector(side1, o1).addScaledVector(side2, o2);
    }
    out.push(p);
  }
  return out;
}
