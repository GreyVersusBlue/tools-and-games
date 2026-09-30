// SkyWings 64 - effects.js : Effects manager (explosions, splashes, dust, ring bursts, speed lines, vehicle trails).
// Ring / pad / target visuals live in rings.js and are re-exported here (contract: createRing, createLandingPadMesh, createTargetMarker).
import * as THREE from 'three';

export { createRing, createLandingPadMesh, createTargetMarker } from './rings.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const quality = () => (typeof window !== 'undefined' && window.SW_QUALITY) || 'high';

const SHOCK_N = 12;
const LIGHT_N = 2;
const COL_N = 8;      // lingering smoke columns
const STREAK_N = 56;

// ---------------------------------------------------------------- shock / foam ring shader
const SHOCK_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHOCK_FS = /* glsl */`
uniform vec3 uColor; uniform float uT; uniform float uOpacity; uniform float uMode;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float a;
  vec3 col = uColor;
  if (uMode < 0.5) {                       // shockwave: thin bright front, trailing haze
    float front = smoothstep(0.62, 0.93, r) * smoothstep(1.0, 0.94, r);
    float streak = 0.6 + 0.4 * vn(vec2(ang * 6.0, uT * 8.0));
    a = front * streak * uOpacity;
    col = mix(uColor, vec3(1.0), front * 0.5);
  } else {                                 // foam / dust ring lying on the surface
    float band = smoothstep(0.30, 0.78, r) * smoothstep(1.0, 0.88, r);
    float n = vn(p * 9.0 + uT * 0.6) * 0.6 + vn(p * 22.0 - uT) * 0.4;
    float bubbles = smoothstep(0.42, 0.75, n);
    a = band * (0.25 + 0.75 * bubbles) * uOpacity;
    col = mix(uColor, vec3(1.0), bubbles * 0.6);
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPEED_LINES = { last: 0 };

export class Effects {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this._dt = 1 / 60;
    this.world = null;                     // optional: setWorld(world) for surface-aware dust
    const q = quality();
    this._q = q;

    // ---- shock / foam rings
    const rg = new THREE.CircleGeometry(1, 48); rg.rotateX(-Math.PI / 2);
    this._shockGeo = rg;
    this.shocks = [];
    for (let i = 0; i < SHOCK_N; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uT: { value: 0 }, uOpacity: { value: 1 }, uMode: { value: 0 } },
        vertexShader: SHOCK_VS, fragmentShader: SHOCK_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(rg, m);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 13;
      scene.add(mesh);
      this.shocks.push({ mesh, mat: m, t: 0, dur: 1, size: 1, op: 1, active: false, mode: 0 });
    }
    this._sc = 0;

    // ---- pooled explosion lights (created up front so the scene light count never changes -> no shader recompiles)
    this.lights = [];
    if (q !== 'low') {
      for (let i = 0; i < LIGHT_N; i++) {
        const l = new THREE.PointLight(0xff9a40, 0, 100, 1.6);
        l.castShadow = false;
        scene.add(l);
        this.lights.push({ light: l, t: 0, dur: 1, peak: 0, active: false });
      }
    }
    this._lc = 0;

    // ---- lingering smoke columns (delayed emitters)
    this.cols = [];
    for (let i = 0; i < COL_N; i++) this.cols.push({ x: 0, y: 0, z: 0, t: 0, dur: 0, acc: 0, s: 1, active: false, water: false });
    this._cc = 0;

    // ---- 3D wind streaks
    const pos = new Float32Array(STREAK_N * 6);
    const col = new Float32Array(STREAK_N * 6);
    for (let i = 0; i < STREAK_N; i++) col[i * 6] = col[i * 6 + 1] = col[i * 6 + 2] = 1;
    const geo = new THREE.BufferGeometry();
    this._streakPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._streakPos);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this._streakMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.streaks = new THREE.LineSegments(geo, this._streakMat);
    this.streaks.frustumCulled = false; this.streaks.visible = false; this.streaks.renderOrder = 14;
    scene.add(this.streaks);
    this._sp = new Float32Array(STREAK_N * 3);
    this._sl = new Float32Array(STREAK_N);
    this._sInit = false;
    this._intensity = 0;
    this._dir = new THREE.Vector3(0, 0, -1);
    this._u = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._cam = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this._down = new THREE.Vector3();

    // ---- screen-space speed lines / wind-rush overlay (DOM canvas, created lazily)
    this._ov = null;
    this._ovT = 0;

    // ---- vehicle fx state
    this._vfx = new WeakMap();
    this._exhT = 0;
  }

  setWorld(w) { this.world = w; }

  _ground(pos) {
    const w = this.world || (typeof globalThis !== 'undefined' ? globalThis.__world : null);
    try {
      if (w && w.heightAt && this.particles && this.particles.setGround) {
        const h = w.heightAt(pos.x, pos.z);
        if (typeof h === 'number' && pos.y - h < 10) this.particles.setGround(Math.max(h, pos.y - 6), 6);
      }
    } catch (e) { /* ignore */ }
  }

  _surface(x, z) {
    const w = this.world || (typeof globalThis !== 'undefined' ? globalThis.__world : null);
    try { if (w && w.surfaceAt) return w.surfaceAt(x, z); } catch (e) { /* ignore */ }
    return 'grass';
  }

  // ------------------------------------------------------------ primitives
  _shock(pos, color, size, dur, opacity, mode, dy) {
    const s = this.shocks[this._sc]; this._sc = (this._sc + 1) % SHOCK_N;
    s.mesh.position.set(pos.x, pos.y + (dy || 0), pos.z);
    _col.setHex(color);
    s.mat.uniforms.uColor.value.set(_col.r, _col.g, _col.b);
    s.mat.uniforms.uMode.value = mode || 0;
    s.mat.blending = mode ? THREE.NormalBlending : THREE.CustomBlending;
    if (!mode) { s.mat.blendSrc = THREE.SrcAlphaFactor; s.mat.blendDst = THREE.OneFactor; s.mat.blendEquation = THREE.AddEquation; s.mat.blendSrcAlpha = THREE.ZeroFactor; s.mat.blendDstAlpha = THREE.OneFactor; }
    s.size = size; s.dur = dur; s.t = 0; s.op = opacity; s.active = true; s.mode = mode || 0;
    s.mesh.visible = true; s.mesh.scale.setScalar(0.01);
  }

  _light(pos, color, peak, dur, dist) {
    if (!this.lights.length) return;
    const L = this.lights[this._lc]; this._lc = (this._lc + 1) % this.lights.length;
    L.light.position.set(pos.x, pos.y + 2, pos.z);
    L.light.color.setHex(color);
    L.light.distance = dist || 100;
    L.peak = peak; L.dur = dur; L.t = 0; L.active = true;
  }

  _column(pos, dur, scale, water) {
    const c = this.cols[this._cc]; this._cc = (this._cc + 1) % COL_N;
    c.x = pos.x; c.y = pos.y; c.z = pos.z; c.t = 0; c.dur = dur; c.acc = 0; c.s = scale; c.active = true; c.water = !!water;
  }

  // ------------------------------------------------------------ public effects
  explosion(pos, opts) {
    if (!pos) return;
    const s = (opts && opts.scale) || 1;
    const p = this.particles;
    this._ground(pos);
    if (opts && opts.grounded === false) { /* caller supplied exact centre */ } else { pos = _ex.set(pos.x, pos.y + 2.5 * s, pos.z); }
    if (p) {
      // flash + white-hot core
      p.emit('glow', pos, { count: 1, size: 16 * s, sizeEnd: 28 * s, life: 0.28, color: 0xffb060, colorEnd: 0xff5a10, alpha: 0.6 });
      p.emit('glow', pos, { count: 1, size: 7 * s, sizeEnd: 12 * s, life: 0.18, color: 0xffe0a0, colorEnd: 0xffc060, alpha: 0.8 });
      // volumetric fireball: flipbook lumps
      p.emit('fireball', pos, { count: 7, alpha: 0.5, speed: 5 * s, up: 2.5 * s, size: 6 * s, sizeEnd: 14 * s, life: 1.0, radius: 1.6 * s, spin: 0.6 });
      p.emit('fireball', pos, { count: 3, alpha: 0.45, speed: 2 * s, up: 4 * s, size: 9 * s, sizeEnd: 18 * s, life: 1.3, radius: 1.2 * s, colorEnd: 0x7a2208, spin: 0.3 });
      p.emit('fire', pos, { count: 26, speed: 9 * s, up: 3 * s, size: 3 * s, sizeEnd: 0.6 * s, life: 0.8, radius: 1 * s });
      // dark billowing smoke
      p.emit('smoke', pos, { count: 22, speed: 6 * s, up: 5 * s, size: 4 * s, sizeEnd: 13 * s, life: 3.2, radius: 2 * s, color: 0x4a443e, colorEnd: 0x8d8a86, alpha: 0.75, gravity: 1.2 });
      p.emit('smoke', pos, { count: 8, speed: 2 * s, up: 9 * s, size: 3 * s, sizeEnd: 10 * s, life: 4.2, radius: 1 * s, color: 0x2e2a26, colorEnd: 0x77746f, alpha: 0.8, gravity: 1.8 });
      p.emit('spark', pos, { count: 70, speed: 26 * s, up: 8 * s, size: 0.5, life: 0.9 });
      p.emit('ember', pos, { count: 26, speed: 9 * s, up: 6 * s, size: 0.7, life: 2.0 });
      p.emit('debris', pos, { count: 26, speed: 17 * s, up: 10 * s, size: 0.8, life: 2.6 });
      p.emit('debris', pos, { count: 6, speed: 9 * s, up: 12 * s, size: 1.6, sizeEnd: 1.2, life: 3, color: 0x2a2320, colorEnd: 0x1a1512 });
      p.emit('dust', pos, { count: 12, speed: 9 * s, up: 0.5, size: 4 * s, sizeEnd: 14 * s, life: 2.0, radius: 2 });
    }
    this._shock(pos, 0xffb060, 34 * s, 0.75, 0.9, 0, 0.3 - 2.5 * s);
    this._shock(pos, 0xffe0b0, 20 * s, 0.5, 0.7, 0, 0.6 - 2.5 * s);
    this._shock(pos, 0x9a8f80, 46 * s, 1.3, 0.55, 1, 0.2 - 2.5 * s);
    this._light(pos, 0xffa050, 2600 * s * s, 1.1, 120 * s);
    this._column(pos, 2.6, s, false);
  }

  splash(pos, opts) {
    if (!pos) return;
    const s = ((opts && opts.scale) || 1) * 1.5;
    const p = this.particles;
    this._ground(pos);
    if (p) {
      _up.set(0, 1, 0);
      p.emit('droplet', pos, { count: 70, speed: 5 * s, up: 12 * s, size: 0.4 * s, life: 1.6, radius: 0.8 * s });
      p.emit('droplet', pos, { count: 30, speed: 9 * s, up: 6 * s, size: 0.3 * s, life: 1.3 });
      p.emit('splash', pos, { count: 14, dir: _up, cone: 0.35, speed: 11 * s, size: 1.6 * s, sizeEnd: 3.6 * s, life: 1.4, radius: 0.9 * s, gravity: -9 });
      p.emit('splash', pos, { count: 10, speed: 4 * s, up: 3 * s, size: 2.4 * s, sizeEnd: 6 * s, life: 1.8, alpha: 0.5, gravity: -1, radius: 1.5 * s });
      p.emit('glow', pos, { count: 1, size: 5 * s, sizeEnd: 12 * s, life: 0.3, color: 0xcfeaff, colorEnd: 0xffffff, alpha: 0.4 });
    }
    this._shock(pos, 0xe8f6ff, 20 * s, 1.7, 0.8, 1, 0.12);
    this._shock(pos, 0xffffff, 10 * s, 1.1, 0.7, 1, 0.14);
    this._column(pos, 1.0, s * 0.7, true);
  }

  dustPuff(pos, opts) {
    if (!pos || !this.particles) return;
    const s = (opts && opts.scale) || 1;
    const surface = (opts && opts.surface) || this._surface(pos.x, pos.z);
    if (surface === 'water') { this.splash(pos, { scale: 0.6 * s }); return; }
    let c0 = 0xd9c08a, c1 = 0xb09a68, dc = 0x5a4632, leaf = false;
    switch (surface) {
      case 'sand': c0 = 0xecd9a0; c1 = 0xc8b27a; dc = 0xb8a070; break;
      case 'grass': c0 = 0xb8b48a; c1 = 0x8e9066; leaf = true; break;
      case 'rock': c0 = 0xaaa59c; c1 = 0x7d7973; dc = 0x55514c; break;
      case 'snow': c0 = 0xffffff; c1 = 0xd8e4f0; dc = 0xe8f0fa; break;
      case 'pad': c0 = 0xc8c8c8; c1 = 0x9a9a9a; dc = 0x666666; break;
      default: break;
    }
    const p = this.particles;
    // radial ground-hugging ring of puffs
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2831853 + Math.random() * 0.4;
      _v.set(Math.cos(a) * 4.5 * s, 0.4, Math.sin(a) * 4.5 * s);
      p.emit('dust', pos, { count: 1, velocity: _v, speed: 0.6, up: 0.4, size: 3.2 * s, sizeEnd: 10 * s, life: 1.8, color: c0, colorEnd: c1, alpha: 0.8, spread: 0.5 });
    }
    p.emit('dust', pos, { count: 5, speed: 1.5, up: 3 * s, size: 3 * s, sizeEnd: 9 * s, life: 2.2, color: c0, colorEnd: c1, alpha: 0.6 });
    p.emit('debris', pos, { count: 7, speed: 4.5 * s, up: 5 * s, size: 0.22 * s, life: 1.1, color: dc, colorEnd: dc });
    if (leaf) p.emit('leaf', pos, { count: 12, speed: 4 * s, up: 4 * s, size: 0.45 * s, life: 1.8, radius: 0.6 });
  }

  // opts: { normal:Vector3, radius:number, color:hex }
  ringPass(pos, opts) {
    if (!pos) return;
    const p = this.particles;
    const rad = (opts && opts.radius) || 10;
    const col = (opts && opts.color) || 0xffe070;
    if (p) {
      p.emit('spark', pos, { count: 46, speed: 16, up: 0, size: 0.4, color: 0xfff0a0, colorEnd: col, life: 0.9, gravity: -2 });
      p.emit('spark', pos, { count: 18, speed: 7, up: 0, size: 0.55, color: 0xffffff, colorEnd: 0x66ccff, life: 0.7, gravity: 0 });
      p.emit('glow', pos, { count: 1, size: rad * 0.8, sizeEnd: rad * 2.2, life: 0.35, color: col, colorEnd: 0xffffff, alpha: 0.6 });
      p.emit('ringfx', pos, { count: 1, size: rad * 0.6, sizeEnd: rad * 2.6, life: 0.55, color: 0xffffff, colorEnd: col, alpha: 0.9 });
      p.emit('ringfx', pos, { count: 1, size: rad * 0.4, sizeEnd: rad * 1.7, life: 0.4, color: col, colorEnd: col, alpha: 0.7 });
      p.emit('ember', pos, { count: 14, speed: 5, up: 1, size: 0.5, life: 1.2, color: col, colorEnd: 0xff8822 });
    }
    this._light(pos, col, 500, 0.4, 60);
  }

  confetti(pos) {
    if (!pos || !this.particles) return;
    this.particles.emit('confetti', pos, { count: 110, speed: 10, up: 13, radius: 2 });
    this.particles.emit('confetti', pos, { count: 50, speed: 5, up: 18, radius: 1 });
    this.particles.emit('spark', pos, { count: 20, speed: 12, up: 8, size: 0.4, color: 0xfff0a0, colorEnd: 0xff88cc, life: 1.0 });
  }

  // Muzzle puff / bomb release / any small burst
  puff(pos, color) {
    if (!pos || !this.particles) return;
    this.particles.emit('smoke', pos, { count: 5, speed: 2, up: 1, size: 0.8, sizeEnd: 3, life: 1.0, color: color || 0xdddddd, colorEnd: 0x999999, alpha: 0.5 });
  }

  // Rocket-exhaust helper (used internally; also callable for bombs/missiles). dir = direction the exhaust travels.
  exhaust(pos, dir, k, velocity) {
    const p = this.particles; if (!p) return;
    k = clamp(k === undefined ? 1 : k, 0, 1);
    p.emit('fire', pos, { count: 1 + (k > 0.6 ? 1 : 0), dir, cone: 0.15, speed: 9 + 6 * k, size: 0.9 + 0.5 * k, sizeEnd: 0.2, life: 0.32, velocity, drag: 2.5, gravity: 0, spin: 0.3 });
    p.emit('smoke', pos, { count: 1, dir, cone: 0.25, speed: 3, size: 0.5, sizeEnd: 3.4, life: 1.6, velocity, alpha: 0.35 + 0.2 * k, color: 0xe0e0e0, colorEnd: 0x9a9a9a, gravity: 0.5, drag: 1.2 });
    if (Math.random() < 0.35 * k) p.emit('spark', pos, { count: 1, dir, cone: 0.5, speed: 10, size: 0.16, life: 0.5, velocity });
  }

  // Call every frame (after vehicle/camera update). Drives 3D streaks, screen overlay and per-vehicle trails.
  windStreaks(vehicle, camera) {
    if (!vehicle || !camera) { this.streaks.visible = false; this._overlay(0); return; }
    const speed = vehicle.speed || 0;
    const flying = vehicle.state === 'flying' || vehicle.state === undefined;
    const target = clamp((speed - 14) / 28, 0, 1) * (flying ? 1 : 0);
    this._intensity += (target - this._intensity) * Math.min(1, this._dt * 4);
    try { this._vehicleFx(vehicle, camera, flying, speed); } catch (e) { /* never break frame */ }
    this._overlay(this._intensity);
    const I = this._intensity;
    if (I < 0.02) { this.streaks.visible = false; return; }
    this.streaks.visible = true;
    this._streakMat.opacity = I * 0.5;

    const dir = this._dir, cam = this._cam;
    camera.getWorldPosition(cam);
    const vel = vehicle.velocity;
    if (vel && vel.lengthSq() > 4) dir.copy(vel).normalize();
    else camera.getWorldDirection(dir);

    const u = this._u, w = this._w;
    u.set(0, 1, 0).cross(dir);
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
    u.normalize();
    w.crossVectors(dir, u);

    const sp = this._sp, sl = this._sl, arr = this._streakPos.array;
    const len = 1.5 + speed * 0.18;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    for (let i = 0; i < STREAK_N; i++) {
      const i3 = i * 3;
      const ax = sp[i3] - cam.x, ay = sp[i3 + 1] - cam.y, az = sp[i3 + 2] - cam.z;
      const along = ax * dx + ay * dy + az * dz;
      if (!this._sInit || along < -10 || along > 70) {
        const ang = Math.random() * 6.2831853;
        const r = 2.8 + Math.random() * 11;
        const fwd = this._sInit ? 30 + Math.random() * 35 : -5 + Math.random() * 60;
        const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r;
        sp[i3] = cam.x + dx * fwd + u.x * cx + w.x * cy;
        sp[i3 + 1] = cam.y + dy * fwd + u.y * cx + w.y * cy;
        sp[i3 + 2] = cam.z + dz * fwd + u.z * cx + w.z * cy;
        sl[i] = 0.5 + Math.random();
      }
      const l = len * sl[i];
      const o = i * 6;
      arr[o] = sp[i3]; arr[o + 1] = sp[i3 + 1]; arr[o + 2] = sp[i3 + 2];
      arr[o + 3] = sp[i3] - dx * l; arr[o + 4] = sp[i3 + 1] - dy * l; arr[o + 5] = sp[i3 + 2] - dz * l;
    }
    this._sInit = true;
    this._streakPos.needsUpdate = true;
  }

  // ------------------------------------------------------------ screen overlay
  _overlay(I) {
    if (typeof document === 'undefined') return;
    let ov = this._ov;
    if (!ov) {
      if (I < 0.03) return;
      const cv = document.createElement('canvas');
      cv.width = 480; cv.height = 270;
      cv.id = 'sw-windrush';
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;opacity:0;transition:none;';
      document.body.appendChild(cv);
      ov = this._ov = { cv, g: cv.getContext('2d'), shown: false };
    }
    if (I < 0.03) {
      if (ov.shown) { ov.cv.style.opacity = '0'; ov.shown = false; }
      return;
    }
    this._ovT += this._dt;
    if (this._ovT < 1 / 30) return;
    this._ovT = 0;
    const g = ov.g, W = ov.cv.width, H = ov.cv.height, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    const maxR = Math.hypot(cx, cy);
    // vignette-ish air rush
    const gr = g.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(230,244,255,${(0.16 * I).toFixed(3)})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const n = 6 + Math.floor(22 * I);
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2831853;
      const r0 = maxR * (0.55 + Math.random() * 0.35);
      const r1 = r0 + maxR * (0.08 + Math.random() * 0.22) * (0.5 + I);
      const ca = Math.cos(a), sa = Math.sin(a);
      g.strokeStyle = `rgba(255,255,255,${(0.05 + Math.random() * 0.25 * I).toFixed(3)})`;
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.beginPath(); g.moveTo(cx + ca * r0, cy + sa * r0 * 0.9); g.lineTo(cx + ca * r1, cy + sa * r1 * 0.9); g.stroke();
    }
    ov.cv.style.opacity = String(clamp(I * 1.1, 0, 1));
    ov.shown = true;
  }

  // ------------------------------------------------------------ per-vehicle FX (trails, exhaust)
  _vehicleFx(v, camera, flying, speed) {
    const p = this.particles; if (!p || !v.mesh) return;
    let st = this._vfx.get(v);
    if (!st) {
      st = { kind: 'other', hx: 0, tipY: 0, tipZ: 0, tips: null };
      const name = (v.constructor && v.constructor.name || '').toLowerCase();
      if (v.flames) st.kind = 'rocket';
      else if (name.indexOf('glider') >= 0) st.kind = 'glider';
      else if (name.indexOf('gyro') >= 0) st.kind = 'gyro';
      if (st.kind === 'glider') this._measure(v.mesh, st);
      st.tk0 = 'wt0_' + this._vfx_id(); st.tk1 = 'wt1_' + this._vfx_id();
      st.bolts = 0;
      this._vfx.set(v, st);
    }
    const m = v.mesh;
    m.updateMatrixWorld(true);
    const fxw = v.fx && v.fx.wingtips && v.fx.wingtips.length === 2 && v.fx.wingtips[0].lengthSq() > 0 ? v.fx.wingtips : null;
    if (st.kind === 'glider' && (fxw || st.hx > 0)) {
      const k = flying ? clamp((speed - 16) / 16, 0, 1) : 0;
      if (k > 0.02) {
        for (let i = 0; i < 2; i++) {
          // prefer the vehicle's own fx hook (exact sail tips, survives GLB swaps); else the measured bbox
          const tip = fxw ? this._tmp.copy(fxw[i]) : this._tmp.set(i ? st.hx : -st.hx, st.tipY, st.tipZ).applyMatrix4(m.matrixWorld);
          const key = i ? st.tk1 : st.tk0;
          const t = p.trail(key, tip, { width: 0.35, life: 1.4, maxPoints: 40, spacing: 0.9, color: 0xffffff, colorEnd: 0xcfe8ff, alpha: 0.4, grow: 2.2, taper: 0.2 });
          t.material.uniforms.uAlpha.value = 0.42 * k;
        }
      } else { p.trailStop(st.tk0); p.trailStop(st.tk1); }
    } else if (st.kind === 'rocket' && v.fx && v.fx.exhaust && v.fx.exhaust.length && v.fx.exhaust[0].position) {
      // vehicle fx hook: world nozzle positions/directions/power
      let any = false;
      for (let i = 0; i < v.fx.exhaust.length; i++) {
        const e = v.fx.exhaust[i];
        if (!(e.power > 0.03)) continue;
        any = true;
        this.exhaust(e.position, e.direction || this._down.set(0, -1, 0), clamp(e.power, 0.2, 1), v.velocity);
        const t = p.trail('rk' + i, e.position, { width: 0.7, life: 0.8, maxPoints: 24, spacing: 0.6, color: 0xffe080, colorEnd: 0x886655, alpha: 0.5, additive: false, grow: 3, taper: 0.1 });
        t.emitting = true;
      }
      if (!any) { p.trailStop('rk0'); p.trailStop('rk1'); }
    } else if (st.kind === 'rocket') {
      const fl = v.flames;
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i].group;
        if (!f || !f.visible) continue;
        f.getWorldPosition(this._tmp);
        this._down.set(0, -1, 0).transformDirection(m.matrixWorld);
        const k = clamp(v.throttle || 0.7, 0.2, 1);
        this.exhaust(this._tmp, this._down, k, v.velocity);
        // long ribbon exhaust plume
        const t = p.trail('rk' + i, this._tmp, { width: 0.7, life: 0.8, maxPoints: 24, spacing: 0.6, color: 0xffe080, colorEnd: 0x886655, alpha: 0.5, additive: false, grow: 3, taper: 0.1 });
        t.emitting = true;
      }
      if (!fl.length || !fl[0].group.visible) { p.trailStop('rk0'); p.trailStop('rk1'); }
    } else if (st.kind === 'gyro') {
      const thr = v.throttle || 0;
      if (flying && thr > 0.5 && (this._exhT -= this._dt) <= 0) {
        this._exhT = 0.05;
        this._tmp.set(0, 0.15, 1.7).applyMatrix4(m.matrixWorld);
        this._down.set(0, 0, 1).transformDirection(m.matrixWorld);
        p.emit('smoke', this._tmp, { count: 1, dir: this._down, cone: 0.2, speed: 4, size: 0.3, sizeEnd: 1.6, life: 1.0, velocity: v.velocity, alpha: 0.22, color: 0xd8d8d8, colorEnd: 0x9a9a9a, gravity: 0.2 });
      }
    }
  }

  _vfx_id() { return (this._idc = (this._idc || 0) + 1); }

  _measure(mesh, st) {
    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const box = new THREE.Box3();
    const b = new THREE.Box3(); const mat = new THREE.Matrix4();
    mesh.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox).applyMatrix4(mat.multiplyMatrices(inv, o.matrixWorld));
      box.union(b);
    });
    if (box.isEmpty()) return;
    st.hx = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * 0.98;
    st.tipY = (box.min.y + box.max.y) * 0.5 + (box.max.y - box.min.y) * 0.15;
    st.tipZ = (box.min.z + box.max.z) * 0.5;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    if (!(dt > 0)) return;
    this._dt = dt;
    const p = this.particles;
    for (let i = 0; i < SHOCK_N; i++) {
      const s = this.shocks[i]; if (!s.active) continue;
      s.t += dt; const k = s.t / s.dur;
      if (k >= 1) { s.active = false; s.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, s.mode ? 2.2 : 3);
      s.mesh.scale.setScalar(s.size * e + 0.01);
      s.mat.uniforms.uT.value = k;
      s.mat.uniforms.uOpacity.value = s.op * (s.mode ? (1 - k) * Math.min(1, k * 8) : (1 - k) * (1 - k));
    }
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i]; if (!L.active) continue;
      L.t += dt; const k = L.t / L.dur;
      if (k >= 1) { L.active = false; L.light.intensity = 0; continue; }
      L.light.intensity = L.peak * (1 - k) * (1 - k) * Math.min(1, k * 20);
    }
    if (p) {
      for (let i = 0; i < COL_N; i++) {
        const c = this.cols[i]; if (!c.active) continue;
        c.t += dt;
        if (c.t >= c.dur) { c.active = false; continue; }
        c.acc += dt * (c.water ? 24 : 16) * (1 - c.t / c.dur);
        while (c.acc >= 1) {
          c.acc -= 1;
          _v.set(c.x, c.y + Math.random() * 1.5 * c.s, c.z);
          if (c.water) p.emit('splash', _v, { count: 1, speed: 1.5 * c.s, up: 6 * c.s, size: 1.6 * c.s, sizeEnd: 4 * c.s, life: 1.2, alpha: 0.45, gravity: -3, radius: 0.8 * c.s });
          else {
            p.emit('smoke', _v, { count: 1, speed: 1.5 * c.s, up: 6 * c.s, size: 3 * c.s, sizeEnd: 9 * c.s, life: 3.0, color: 0x38342f, colorEnd: 0x8a8782, alpha: 0.6, radius: 1.5 * c.s, gravity: 1.2 });
            if (c.t < 1.0) p.emit('fire', _v, { count: 1, speed: 2 * c.s, up: 4 * c.s, size: 2.5 * c.s, sizeEnd: 0.5 * c.s, life: 0.7, radius: 1.5 * c.s });
          }
        }
      }
    }
  }

  dispose() {
    for (const s of this.shocks) { this.scene.remove(s.mesh); s.mat.dispose(); }
    this._shockGeo.dispose();
    for (const L of this.lights) this.scene.remove(L.light);
    this.scene.remove(this.streaks); this.streaks.geometry.dispose(); this._streakMat.dispose();
    if (this._ov && this._ov.cv.parentNode) this._ov.cv.parentNode.removeChild(this._ov.cv);
    this._ov = null;
  }
}

const _ex = new THREE.Vector3();
const _col = new THREE.Color();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
