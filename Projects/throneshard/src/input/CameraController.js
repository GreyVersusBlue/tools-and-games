import * as THREE from 'three';
import { MAP_HALF, FOUNTAIN } from '../core/constants.js';

// MOBA camera: fixed yaw looking north (-Z), ~57deg pitch, smooth damped panning,
// edge pan, arrow keys, middle-mouse drag, wheel zoom, hero centering / lock, shake.
const PITCH = THREE.MathUtils.degToRad(57);
const FOV = 40;
const DEFAULT_DIST = 31; // ~40 world units visible horizontally at 16:9
const MIN_DIST = 17;
const MAX_DIST = 46;
const EDGE_PX = 14;
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();

const isTyping = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
};

export class CameraController {
  constructor(game) {
    this.game = game;
    this.target = new THREE.Vector3(-70, 0, 70); // smoothed look-at point
    this.desired = this.target.clone(); // where we want to be
    this.distance = DEFAULT_DIST;
    this.desiredDistance = DEFAULT_DIST;
    this.groundY = 0;
    this.locked = false; // camera lock to hero (Y / F1 double tap)
    this.follow = false; // Space held
    this.edgePan = true;
    this.panSpeed = 1; // user setting multiplier
    this.keys = new Set();
    this.mouse = { x: -1, y: -1, inside: false };
    this.drag = null; // middle-mouse drag state
    this._shakes = [];
    this._shakeOffset = new THREE.Vector3();
    this._lastF1 = -10;
    this._introT = 0;
  }

  async init() {
    const cam = this.game.camera;
    if (cam) {
      cam.fov = FOV;
      cam.near = 1;
      cam.far = 500;
      cam.updateProjectionMatrix();
    }
    const canvas = this.game.renderer?.domElement;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => { this.keys.clear(); this.follow = false; this.mouse.inside = false; this.drag = null; });
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      if (this.drag) this._applyDrag();
    });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    document.documentElement.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget && !e.toElement) this.mouse.inside = false; });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      if (canvas && e.target !== canvas && !this._isPassThrough(e.target)) return;
      e.preventDefault();
      const g = this.groundAt(e.clientX, e.clientY);
      if (g) this.drag = { anchor: g.clone() };
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 1) this.drag = null; });
    window.addEventListener('wheel', (e) => {
      if (canvas && e.target !== canvas && !this._isPassThrough(e.target)) return;
      const dir = Math.sign(e.deltaY);
      this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance * (dir > 0 ? 1.12 : 1 / 1.12), MIN_DIST, MAX_DIST);
    }, { passive: true });

    const bus = this.game.bus;
    bus.on('camera:focus', (p) => {
      const pos = p?.position ?? p;
      if (pos && Number.isFinite(pos.x)) this.focus(pos.x, pos.z ?? pos.y ?? 0, !!p?.instant);
    });
    bus.on('building:destroyed', ({ unit }) => {
      const d = unit ? this.distanceFromView(unit.position) : 0;
      const k = unit?.subtype === 'throneshard' ? 1.6 : 1;
      this.shake(k * 0.9 * this._falloff(d, 60), 0.9 * k);
    });
    bus.on('ability:cast', ({ hero, ability }) => {
      if (!ability?.def?.ultimate || !hero) return;
      const d = this.distanceFromView(hero.position);
      this.shake(0.35 * this._falloff(d, 40), 0.45);
    });
    bus.on('grimmaw:killed', () => this.shake(0.4, 0.6));
    this.apply(0);
  }

  _isPassThrough(el) {
    return !el || el === document.body || el === document.documentElement || el.id === 'ui-root' || el.id === 'app';
  }
  _falloff(d, max) { return Math.max(0, 1 - d / max); }

  onMatchStart() {
    const h = this.game.player.hero;
    if (h) this.focus(h.position.x, h.position.z - 6, true);
    else { const f = FOUNTAIN[this.game.player.team] ?? [-90, 90]; this.focus(f[0], f[1], true); }
    this.desiredDistance = this.distance = DEFAULT_DIST;
  }

  onKeyDown(e) {
    if (isTyping()) return;
    const k = e.code;
    this.keys.add(k);
    if (this.game.input?._capture) return;
    const kb = this.game.input?.keybinds;
    const centerKey = kb?.codeFor?.('cameraCenter') ?? 'Space';
    const lockKey = kb?.codeFor?.('cameraLock') ?? 'KeyY';
    const heroKey = kb?.codeFor?.('selectHero') ?? 'F1';
    if (k === 'Space') e.preventDefault();
    if (k === centerKey) {
      e.preventDefault();
      this.follow = true;
      const h = this.game.player.hero;
      if (h && !e.repeat) this.focus(h.position.x, h.position.z, true);
    } else if (k === lockKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      this.toggleLock();
    } else if (k === heroKey && !e.repeat) {
      const now = performance.now() / 1000;
      if (now - this._lastF1 < 0.35) { this.centerOnHero(); }
      this._lastF1 = now;
    } else if (k.startsWith('Arrow')) {
      e.preventDefault();
    }
  }
  onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === (this.game.input?.keybinds?.codeFor?.('cameraCenter') ?? 'Space')) this.follow = false;
  }

  toggleLock(v = !this.locked) {
    this.locked = v;
    this.game.bus.emit('ui:message', { text: v ? 'Camera locked to hero' : 'Camera unlocked', color: '#9cf' });
    this.game.bus.emit('camera:lock', { locked: v });
  }
  centerOnHero(instant = false) {
    const h = this.game.player.hero;
    if (h) this.focus(h.position.x, h.position.z, instant);
  }

  // Center the view on world (x, z).
  focus(x, z, instant = false) {
    this.desired.set(x, this.desired.y, z);
    this.clamp(this.desired);
    if (instant) {
      this.target.copy(this.desired);
      this.distance = this.desiredDistance;
      this.apply(0);
    }
    this.game.bus.emit('camera:moved', { target: this.desired });
  }

  getTarget() { return this.target; }
  getDistance() { return this.distance; }

  // Screen shake: intensity ~ world units of jitter (0.2 subtle, 1 heavy), duration in seconds.
  shake(intensity = 0.3, duration = 0.4) {
    if (!(intensity > 0.01)) return;
    if (this._shakes.length > 6) this._shakes.shift();
    this._shakes.push({ i: Math.min(intensity, 2), d: duration, t: 0, seed: Math.random() * 100 });
  }

  distanceFromView(pos) {
    return Math.hypot(pos.x - this.target.x, pos.z - this.target.z);
  }

  clamp(v) {
    const lim = MAP_HALF - 4;
    v.x = THREE.MathUtils.clamp(v.x, -lim, lim);
    v.z = THREE.MathUtils.clamp(v.z, -lim - 2, lim + 4);
    return v;
  }

  // Ground point under a screen position using the CURRENT camera (y = groundY plane).
  groundAt(cx, cy, y = this.groundY) {
    const cam = this.game.camera;
    if (!cam) return null;
    _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    _plane.constant = -y;
    const out = new THREE.Vector3();
    return _ray.ray.intersectPlane(_plane, out) ? out : null;
  }

  // 4 ground points (y=0) of the view frustum: [topLeft, topRight, bottomRight, bottomLeft] (for minimap)
  getViewQuad() {
    const cam = this.game.camera;
    const out = [];
    if (!cam) return out;
    cam.updateMatrixWorld();
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    _plane.constant = 0;
    for (const [x, y] of corners) {
      _ndc.set(x, y);
      _ray.setFromCamera(_ndc, cam);
      const p = new THREE.Vector3();
      if (!_ray.ray.intersectPlane(_plane, p) || p.distanceTo(cam.position) > 400) {
        p.copy(_ray.ray.direction).setY(Math.min(_ray.ray.direction.y, -0.05)).normalize().multiplyScalar(200).add(cam.position).setY(0);
      }
      out.push(p);
    }
    return out;
  }

  update(dt) {
    const g = this.game;
    dt = Math.min(dt || 0, 0.05);
    const hero = g.player.hero;

    // pre-match: slow cinematic drift over the Sunward base
    if (!g.running) {
      this._introT += dt;
      const t = this._introT * 0.05;
      this.desired.set(-62 + Math.sin(t) * 14, 0, 62 + Math.cos(t * 0.7) * 10);
      this.target.lerp(this.desired, 1 - Math.exp(-dt * 2));
      this.distance += (40 - this.distance) * (1 - Math.exp(-dt * 2));
      this.apply(dt);
      return;
    }

    const focused = document.hasFocus?.() ?? true;
    const typing = isTyping();
    const followHero = hero && hero.alive !== false && (this.follow || this.locked);
    const speed = (22 + this.distance * 1.3) * this.panSpeed; // world units / sec, scales with zoom
    let px = 0, pz = 0;
    if (!typing) {
      if (this.keys.has('ArrowLeft')) px -= 1;
      if (this.keys.has('ArrowRight')) px += 1;
      if (this.keys.has('ArrowUp')) pz -= 1;
      if (this.keys.has('ArrowDown')) pz += 1;
    }
    if (this.edgePan && focused && this.mouse.inside && !this.drag && this.mouse.x >= 0) {
      const w = window.innerWidth, h = window.innerHeight;
      if (this.mouse.x <= EDGE_PX) px -= 1;
      else if (this.mouse.x >= w - 1 - EDGE_PX) px += 1;
      if (this.mouse.y <= EDGE_PX) pz -= 1;
      else if (this.mouse.y >= h - 1 - EDGE_PX) pz += 1;
    }
    if ((px || pz) && !followHero) {
      const len = Math.hypot(px, pz);
      this.desired.x += (px / len) * speed * dt;
      this.desired.z += (pz / len) * speed * dt;
      this.clamp(this.desired);
    }

    if (followHero) this.desired.set(hero.position.x, this.desired.y, hero.position.z);

    if (this.drag) this._applyDrag();

    // damped movement
    const k = 1 - Math.exp(-dt * (followHero ? 14 : 11));
    this.target.x += (this.desired.x - this.target.x) * k;
    this.target.z += (this.desired.z - this.target.z) * k;
    this.distance += (this.desiredDistance - this.distance) * (1 - Math.exp(-dt * 9));

    // follow terrain height smoothly so the camera doesn't dip into hills
    const gh = g.world?.getHeight?.(this.target.x, this.target.z);
    if (Number.isFinite(gh)) this.groundY += (gh - this.groundY) * (1 - Math.exp(-dt * 4));
    this.target.y = this.groundY;

    this.apply(dt);
  }

  // middle mouse drag: keep the grabbed ground point under the cursor
  _applyDrag() {
    if (this.mouse.x < 0) return;
    this.target.x = this.desired.x; this.target.z = this.desired.z;
    this.apply(0);
    const now = this.groundAt(this.mouse.x, this.mouse.y);
    if (!now) return;
    this.desired.x += this.drag.anchor.x - now.x;
    this.desired.z += this.drag.anchor.z - now.z;
    this.clamp(this.desired);
    this.target.x = this.desired.x;
    this.target.z = this.desired.z;
    this.apply(0);
  }

  apply(dt) {
    const cam = this.game.camera;
    if (!cam) return;
    // shake
    this._shakeOffset.set(0, 0, 0);
    if (this._shakes.length && dt > 0) {
      for (const s of this._shakes) {
        s.t += dt;
        const f = Math.max(0, 1 - s.t / s.d);
        const a = s.i * f * f;
        const tt = s.t * 38 + s.seed;
        this._shakeOffset.x += Math.sin(tt * 1.1) * a * 0.6;
        this._shakeOffset.y += Math.sin(tt * 1.7 + 1.3) * a * 0.4;
        this._shakeOffset.z += Math.cos(tt * 0.9 + 2.1) * a * 0.5;
      }
      this._shakes = this._shakes.filter((s) => s.t < s.d);
    }
    const d = this.distance;
    // slightly steeper when zoomed out 
    const pitch = PITCH + (d - DEFAULT_DIST) * 0.004;
    cam.position.set(
      this.target.x + this._shakeOffset.x,
      this.target.y + Math.sin(pitch) * d + this._shakeOffset.y,
      this.target.z + Math.cos(pitch) * d + this._shakeOffset.z,
    );
    _v.copy(this.target).add(this._shakeOffset);
    cam.lookAt(_v);
    cam.updateMatrixWorld();
  }
}
