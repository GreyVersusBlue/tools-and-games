// SkyWings 64 - particles.js : pooled instanced-quad particles with a procedural flipbook atlas + ribbon trails.
// One InstancedMesh-style draw per particle type. No per-frame allocation (typed-array pools).
import * as THREE from 'three';
import { getAtlas, ROWS, GRID } from './atlas.js';
import { Trail } from './trails.js';

// ---------------------------------------------------------------- type configs
// row/cols: atlas location. flip: frame chosen by age (crossfaded flipbook), else random column in [col0, col0+colN).
// mode: 0 lit/tinted (sun+ambient), 1 additive heat, 2 plain tint.  stretch: velocity-aligned streak.
// g: gravity m/s^2 (negative falls), drag 1/s.
const TYPES = {
  smoke:    { pool: 500, row: ROWS.smoke, flip: true, mode: 0, add: false, life: 2.0, s0: 1.6, s1: 6.0, c0: 0xd0d0d0, c1: 0x707070, a: 0.6, speed: 1.2, up: 1.5, g: 0.6, drag: 0.9, count: 1, spin: 0.5, fog: true },
  fire:     { pool: 400, row: ROWS.fire, flip: true, mode: 1, add: true, life: 0.7, s0: 1.8, s1: 0.6, c0: 0xffb040, c1: 0xe02800, a: 0.6, speed: 2.0, up: 1.0, g: 2.0, drag: 1.5, count: 1, spin: 1.0 },
  fireball: { pool: 96, row: ROWS.explosion, flip: true, mode: 1, add: true, life: 1.1, s0: 6, s1: 16, c0: 0xffc060, c1: 0xd83a08, a: 0.7, speed: 6, up: 3, g: 1.5, drag: 2.5, count: 1, spin: 0.4 },
  spark:    { pool: 500, row: ROWS.spark, flip: false, col0: 4, colN: 4, mode: 1, add: true, life: 0.6, s0: 0.35, s1: 0.1, c0: 0xffffcc, c1: 0xff7700, a: 1.0, speed: 12, up: 2, g: -7, drag: 0.6, count: 10, stretch: 1, spin: 0 },
  ember:    { pool: 300, row: ROWS.ember, flip: false, col0: 0, colN: 4, mode: 1, add: true, life: 1.4, s0: 0.5, s1: 0.1, c0: 0xffc060, c1: 0xff3000, a: 1.0, speed: 6, up: 3, g: -2.5, drag: 0.8, count: 6, spin: 0 },
  ringfx:   { pool: 64, row: ROWS.misc, flip: false, col0: 3, colN: 1, mode: 1, add: true, life: 0.55, s0: 1.5, s1: 22, c0: 0xffffff, c1: 0xffcc66, a: 0.9, speed: 0, up: 0, g: 0, drag: 0, count: 1, spin: 0 },
  glow:     { pool: 128, row: ROWS.misc, flip: false, col0: 0, colN: 1, mode: 1, add: true, life: 0.4, s0: 3, s1: 8, c0: 0xffffff, c1: 0xffffff, a: 0.8, speed: 0, up: 0, g: 0, drag: 0, count: 1, spin: 0 },
  splash:   { pool: 400, row: ROWS.splash, flip: false, col0: 4, colN: 4, mode: 0, add: false, life: 1.3, s0: 1.4, s1: 3.6, c0: 0xffffff, c1: 0xb8e0ff, a: 0.75, speed: 3, up: 6, g: -6, drag: 0.7, count: 8, spin: 0.6, fog: true },
  droplet:  { pool: 500, row: ROWS.splash, flip: false, col0: 0, colN: 4, mode: 0, add: false, life: 1.2, s0: 0.35, s1: 0.28, c0: 0xeaf6ff, c1: 0xbfe0ff, a: 0.9, speed: 5, up: 9, g: -12, drag: 0.15, count: 16, stretch: 0.5, spin: 0, fog: true },
  dust:     { pool: 300, row: ROWS.dust, flip: true, mode: 0, add: false, life: 1.5, s0: 1.2, s1: 5.0, c0: 0xd9c08a, c1: 0xb09a68, a: 0.5, speed: 2.0, up: 0.8, g: 0.2, drag: 1.6, count: 6, spin: 0.5, fog: true },
  leaf:     { pool: 200, row: ROWS.misc, flip: false, col0: 2, colN: 1, mode: 2, add: false, life: 1.8, s0: 0.35, s1: 0.3, c0: 0x4a9a2a, c1: 0x3a7a1a, a: 1.0, speed: 4, up: 4, g: -5, drag: 0.9, count: 8, spin: 6, fog: true },
  confetti: { pool: 600, row: ROWS.misc, flip: false, col0: 1, colN: 1, mode: 2, add: false, life: 4.0, s0: 0.45, s1: 0.45, c0: 0xffffff, c1: 0xffffff, a: 1.0, speed: 9, up: 10, g: -3.0, drag: 1.7, count: 30, rainbow: true, spin: 5, flutter: true },
  debris:   { pool: 300, row: ROWS.misc, flip: false, col0: 4, colN: 1, mode: 2, add: false, life: 2.2, s0: 0.6, s1: 0.45, c0: 0x4a3c30, c1: 0x201a16, a: 1.0, speed: 12, up: 7, g: -14, drag: 0.2, count: 10, spin: 8, fog: true },
};

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;   // size, rot, t(0..1), var
attribute vec4 iColor;
uniform float uStretch;
uniform float uFlutter;
varying vec2 vUv;
varying vec4 vData;
varying vec4 vColor;
varying float vNear;
varying float vWY;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vData = iData; vColor = iColor;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float size = iData.x;
  vec2 q = position.xy;
  vec2 offs;
  if (uStretch > 0.0) {
    vec4 mv2 = modelViewMatrix * vec4(iPos + iVel * 0.05, 1.0);
    vec2 d = mv2.xy - mvPosition.xy;
    float sp = length(d);
    vec2 dir = sp > 1e-6 ? d / sp : vec2(1.0, 0.0);
    float len = size * (1.0 + uStretch * min(sp * 20.0, 8.0));
    offs = dir * (q.x * len) + vec2(-dir.y, dir.x) * (q.y * size);
  } else {
    float c = cos(iData.y), s = sin(iData.y);
    if (uFlutter > 0.5) q.x *= abs(cos(iData.y * 1.7 + iData.w * 6.0)) * 0.9 + 0.1;
    offs = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
  }
  mvPosition.xy += offs;
  vNear = clamp((-mvPosition.z - 0.4) / (1.2 + size * 0.6), 0.0, 1.0);
  vWY = (inverse(viewMatrix) * mvPosition).y;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform float uRow;
uniform float uFlip;
uniform float uCol0;
uniform float uColN;
uniform float uMode;
uniform vec3 uSun;
uniform vec3 uAmb;
varying vec2 vUv;
varying vec4 vData;
varying vec4 vColor;
varying float vNear;
varying float vWY;
uniform float uGround;
#include <fog_pars_fragment>
vec4 cell(float col) {
  vec2 uv = (vec2(col, 7.0 - uRow) + clamp(vUv, 0.004, 0.996)) / ${GRID}.0;
  return texture2D(map, uv);
}
void main() {
  vec4 t;
  if (uFlip > 0.5) {
    float ft = clamp(vData.z, 0.0, 0.999) * 7.0;
    float f0 = floor(ft);
    t = mix(cell(f0), cell(f0 + 1.0), fract(ft));
  } else {
    t = cell(uCol0 + floor(vData.w * uColN));
  }
  float a = t.a * vColor.a * vNear * smoothstep(uGround - 0.1, uGround + 0.35 + vData.x * 0.3, vWY);
  if (a < 0.004) discard;
  vec3 rgb;
  if (uMode < 0.5) rgb = vColor.rgb * mix(uAmb, uSun, clamp(t.r, 0.0, 1.0)) * 1.15;
  else if (uMode < 1.5) rgb = vColor.rgb * (0.25 + t.r * 0.85);
  else rgb = vColor.rgb * (0.5 + 0.6 * t.r);
  gl_FragColor = vec4(rgb, a);
  if (uMode > 0.5 && uMode < 1.5) gl_FragColor.rgb *= a;   // additive: premultiply by alpha
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const GROUND = { value: -1e9 };

// scratch (no per-emit allocation)
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const _q = new THREE.Quaternion();

class Pool {
  constructor(scene, name, cfg, atlas) {
    this.name = name; this.cfg = cfg;
    const n = cfg.pool; this.n = n;
    this.cursor = 0; this.alive = 0; this.hi = 0;
    this.age = new Float32Array(n).fill(-1);
    this.life = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.cA = new Float32Array(n * 4);
    this.cB = new Float32Array(n * 3);
    this.sz = new Float32Array(n * 2);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.buoy = new Float32Array(n);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    this.col = new Float32Array(n * 4);
    const mk = (arr, sz) => new THREE.InstancedBufferAttribute(arr, sz).setUsage(THREE.DynamicDrawUsage);
    this.posAttr = mk(this.pos, 3); this.velAttr = mk(this.vel, 3);
    this.dataAttr = mk(this.data, 4); this.colAttr = mk(this.col, 4);
    geo.setAttribute('iPos', this.posAttr); geo.setAttribute('iVel', this.velAttr);
    geo.setAttribute('iData', this.dataAttr); geo.setAttribute('iColor', this.colAttr);
    geo.instanceCount = 0;
    this.geo = geo;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: atlas.texture }, uRow: { value: cfg.row }, uFlip: { value: cfg.flip ? 1 : 0 },
      uCol0: { value: cfg.col0 || 0 }, uColN: { value: cfg.colN || 1 }, uMode: { value: cfg.mode }, uGround: GROUND,
      uStretch: { value: cfg.stretch || 0 }, uFlutter: { value: cfg.flutter ? 1 : 0 },
      uSun: { value: new THREE.Vector3(1, 0.95, 0.85) }, uAmb: { value: new THREE.Vector3(0.6, 0.66, 0.78) },
    }]);
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: cfg.add ? THREE.CustomBlending : THREE.NormalBlending,
      fog: !!cfg.fog,
    });
    if (cfg.add) { // premultiplied additive
      this.material.blendSrc = THREE.OneFactor; this.material.blendDst = THREE.OneFactor;
      this.material.blendEquation = THREE.AddEquation;
      this.material.blendSrcAlpha = THREE.OneFactor; this.material.blendDstAlpha = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = cfg.add ? 12 : 11;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  update(dt) {
    if (this.alive <= 0) { if (this.geo.instanceCount) this.geo.instanceCount = 0; return; }
    const age = this.age, life = this.life, vel = this.vel, pos = this.pos, col = this.col, data = this.data;
    const cA = this.cA, cB = this.cB, sz = this.sz, drag = this.drag, grav = this.grav, spin = this.spin, rot = this.rot;
    let alive = 0, hi = 0;
    for (let i = 0, n = this.hi; i < n; i++) {
      const a0 = age[i];
      if (a0 < 0) continue;
      const a = a0 + dt;
      const i3 = i * 3, i4 = i * 4;
      if (a >= life[i]) { age[i] = -1; data[i4] = 0; col[i4 + 3] = 0; continue; }
      age[i] = a; alive++; hi = i + 1;
      const t = a / life[i];
      const dr = 1 - Math.min(0.95, drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr + grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      rot[i] += spin[i] * dt;
      col[i4] = cA[i4] + (cB[i3] - cA[i4]) * t;
      col[i4 + 1] = cA[i4 + 1] + (cB[i3 + 1] - cA[i4 + 1]) * t;
      col[i4 + 2] = cA[i4 + 2] + (cB[i3 + 2] - cA[i4 + 2]) * t;
      const fade = t < 0.08 ? t * 12.5 : (1 - t) / 0.92;
      col[i4 + 3] = cA[i4 + 3] * fade;
      data[i4] = sz[i * 2] + (sz[i * 2 + 1] - sz[i * 2]) * t;
      data[i4 + 1] = rot[i];
      data[i4 + 2] = t;
    }
    this.alive = alive; this.hi = hi;
    this.geo.instanceCount = hi;
    this.posAttr.needsUpdate = true; this.velAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
  }
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = {};
    this.trails = [];
    this._trailKeys = new Map();
    this._lightT = 0;
    this._groundT = 0;
    const atlas = getAtlas();
    for (const k in TYPES) this.pools[k] = new Pool(scene, k, TYPES[k], atlas);
    this._sun = new THREE.Vector3(1, 0.95, 0.85);
    this._amb = new THREE.Vector3(0.6, 0.66, 0.78);
    this._findLights();
  }

  // Soft floor: particles fade out below this world height for `hold` seconds (hides quad/terrain intersections after ground events).
  setGround(y, hold) { GROUND.value = y; this._groundT = hold || 6; }

  // Tint smoke/dust/splash by scene lighting (auto-detected; can also be called manually).
  setLighting(sunColor, ambientColor) {
    if (sunColor) this._sun.set(sunColor.r, sunColor.g, sunColor.b);
    if (ambientColor) this._amb.set(ambientColor.r, ambientColor.g, ambientColor.b);
    for (const k in this.pools) {
      const u = this.pools[k].material.uniforms;
      u.uSun.value.copy(this._sun); u.uAmb.value.copy(this._amb);
    }
  }

  _findLights() {
    let sun = null, hemi = null, amb = null;
    const r = this.scene.userData && this.scene.userData.swRender;
    if (r && r.sun) sun = r.sun;
    const ch = this.scene.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (!sun && o.isDirectionalLight) sun = o;
      else if (!hemi && o.isHemisphereLight) hemi = o;
      else if (!amb && o.isAmbientLight) amb = o;
    }
    const sc = sun ? _c0.copy(sun.color).multiplyScalar(Math.min(1.4, 0.55 + sun.intensity * 0.45)) : null;
    let ac = null;
    if (hemi) ac = _c1.copy(hemi.color).lerp(hemi.groundColor, 0.35).multiplyScalar(Math.min(1.2, 0.35 + hemi.intensity * 0.5));
    else if (amb) ac = _c1.copy(amb.color).multiplyScalar(Math.min(1.2, 0.4 + amb.intensity * 0.5));
    if (sc || ac) {
      const s = sc ? { r: sc.r, g: sc.g, b: sc.b } : null;
      const a = ac ? { r: ac.r, g: ac.g, b: ac.b } : null;
      this.setLighting(s, a);
    }
  }

  // opts: count, speed, spread, velocity(Vector3 base), up, size, sizeEnd, life, color, colorEnd, alpha, gravity,
  //       radius (positional jitter), dir (Vector3 cone axis) + cone (0..1 spread), spin, drag
  emit(type, position, opts) {
    const p = this.pools[type];
    if (!p || !position) return;
    const cfg = p.cfg; const o = opts || {};
    const count = o.count !== undefined ? o.count : cfg.count;
    const speed = o.speed !== undefined ? o.speed : cfg.speed;
    const up = o.up !== undefined ? o.up : cfg.up;
    const spread = o.spread !== undefined ? o.spread : 1;
    const life0 = o.life !== undefined ? o.life : cfg.life;
    const s0 = o.size !== undefined ? o.size : cfg.s0;
    const s1 = o.sizeEnd !== undefined ? o.sizeEnd : (o.size !== undefined ? o.size * (cfg.s1 / cfg.s0) : cfg.s1);
    const alpha = o.alpha !== undefined ? o.alpha : cfg.a;
    const grav = o.gravity !== undefined ? o.gravity : cfg.g;
    const drag = o.drag !== undefined ? o.drag : cfg.drag;
    const radius = o.radius || 0;
    const spinMax = o.spin !== undefined ? o.spin : cfg.spin;
    const bv = o.velocity;
    const dir = o.dir; const cone = o.cone !== undefined ? o.cone : 0.3;
    const hasCol = o.color !== undefined;
    _c0.setHex(hasCol ? o.color : cfg.c0);
    _c1.setHex(o.colorEnd !== undefined ? o.colorEnd : (hasCol ? o.color : cfg.c1));

    for (let k = 0; k < count; k++) {
      const i = p.cursor; p.cursor = (i + 1) % p.n;
      if (p.age[i] < 0) p.alive++;
      if (i + 1 > p.hi) p.hi = i + 1;
      const i3 = i * 3, i4 = i * 4;
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l; dy /= l; dz /= l;
      let vx, vy, vz;
      if (dir) {
        const sp = speed * (0.6 + Math.random() * 0.4);
        vx = (dir.x + dx * cone) * sp; vy = (dir.y + dy * cone) * sp; vz = (dir.z + dz * cone) * sp;
      } else {
        const sp = speed * spread * (0.4 + Math.random() * 0.6);
        vx = dx * sp; vy = dy * sp + up * (0.5 + Math.random() * 0.5) * spread; vz = dz * sp;
        if (type === 'dust') vy = Math.abs(vy) * 0.5;
      }
      p.vel[i3] = vx + (bv ? bv.x : 0); p.vel[i3 + 1] = vy + (bv ? bv.y : 0); p.vel[i3 + 2] = vz + (bv ? bv.z : 0);
      p.pos[i3] = position.x + (radius ? (Math.random() * 2 - 1) * radius : 0);
      p.pos[i3 + 1] = position.y + (radius ? (Math.random() * 2 - 1) * radius : 0);
      p.pos[i3 + 2] = position.z + (radius ? (Math.random() * 2 - 1) * radius : 0);
      p.age[i] = 0;
      p.life[i] = life0 * (0.75 + Math.random() * 0.5);
      p.grav[i] = grav; p.drag[i] = drag;
      p.spin[i] = (Math.random() * 2 - 1) * spinMax;
      p.rot[i] = Math.random() * 6.2831853;
      if (cfg.rainbow && !hasCol) { _c0.setHSL(Math.random(), 0.9, 0.55); _c1.copy(_c0); }
      p.cA[i4] = _c0.r; p.cA[i4 + 1] = _c0.g; p.cA[i4 + 2] = _c0.b; p.cA[i4 + 3] = alpha;
      p.cB[i3] = _c1.r; p.cB[i3 + 1] = _c1.g; p.cB[i3 + 2] = _c1.b;
      const sv = 0.8 + Math.random() * 0.4;
      p.sz[i * 2] = s0 * sv; p.sz[i * 2 + 1] = s1 * sv;
      p.data[i4] = s0 * sv; p.data[i4 + 1] = p.rot[i]; p.data[i4 + 2] = 0; p.data[i4 + 3] = Math.random();
      p.col[i4] = _c0.r; p.col[i4 + 1] = _c0.g; p.col[i4 + 2] = _c0.b; p.col[i4 + 3] = 0;
    }
    p.geo.instanceCount = p.hi;
    p.posAttr.needsUpdate = true; p.velAttr.needsUpdate = true; p.colAttr.needsUpdate = true; p.dataAttr.needsUpdate = true;
  }

  // ---- ribbon trails ----------------------------------------------------------------------------
  // opts: { width, life, maxPoints, spacing, color, colorEnd, alpha, additive, taper }
  createTrail(opts) {
    const t = new Trail(this.scene, opts);
    this.trails.push(t);
    return t;
  }
  // Keyed convenience: creates the trail on first use. Call every frame with the emitter position.
  trail(key, position, opts) {
    let t = this._trailKeys.get(key);
    if (!t) { t = this.createTrail(opts); this._trailKeys.set(key, t); }
    t.emitting = true;
    t.push(position);
    return t;
  }
  trailStop(key) { const t = this._trailKeys.get(key); if (t) t.emitting = false; }
  removeTrail(t) {
    const i = this.trails.indexOf(t); if (i >= 0) this.trails.splice(i, 1);
    for (const [k, v] of this._trailKeys) if (v === t) this._trailKeys.delete(k);
    t.dispose();
  }

  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    if (this._groundT > 0 && (this._groundT -= dt) <= 0) GROUND.value = -1e9;
    this._lightT -= dt;
    if (this._lightT <= 0) { this._lightT = 4; this._findLights(); }
    for (const k in this.pools) this.pools[k].update(dt);
    for (let i = 0; i < this.trails.length; i++) this.trails[i].update(dt);
  }

  clear() {
    for (const k in this.pools) {
      const p = this.pools[k];
      p.age.fill(-1); p.data.fill(0); p.col.fill(0); p.alive = 0; p.hi = 0; p.geo.instanceCount = 0;
      p.dataAttr.needsUpdate = true; p.colAttr.needsUpdate = true;
    }
    for (const t of this.trails) t.clear();
  }

  dispose() {
    for (const k in this.pools) {
      const p = this.pools[k];
      this.scene.remove(p.mesh); p.geo.dispose(); p.material.dispose();
    }
    for (const t of this.trails) t.dispose();
    this.trails.length = 0; this._trailKeys.clear();
    this.pools = {};
  }
}
