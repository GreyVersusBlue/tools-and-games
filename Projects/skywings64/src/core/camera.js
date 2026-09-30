import * as THREE from 'three';
import { getSettings } from './settings.js';

// Camera modes. 'cine' (replay-style camera cuts) is only in the C-key cycle when settings.cinematic is on.
const MODES = [
  { name: 'chase', dist: 1.0, height: 1.0, look: 0.35, fov: 1.0, roll: 0.35 },
  { name: 'close', dist: 0.42, height: 0.55, look: 0.15, fov: 1.05, roll: 0.5 },
  { name: 'far', dist: 1.9, height: 1.7, look: 0.5, fov: 0.92, roll: 0.2 },
  { name: 'cine', dist: 1.0, height: 1.0, look: 0.3, fov: 0.9, roll: 0.15 },
];

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _ideal = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _def = { target: new THREE.Vector3(), chaseDistance: 12, height: 4, fov: 70 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.rig = null;
    this.mode = 0;
    this.modes = MODES;
    this.dir = new THREE.Vector3(0, 0, -1);   // smoothed chase direction
    this.lookPoint = new THREE.Vector3();
    this.off = new THREE.Vector3(0, 4, 12);   // spring state: camera offset from target
    this.offVel = new THREE.Vector3();
    this.dist = 12;
    this.heightOff = 4;
    this.fov = camera.fov || 70;
    this.roll = 0;
    this.shake = 0;          // impulse shake (decays)
    this.time = 0;
    this.lift = 0;           // smoothed collision lift
    this._needSnap = true;
    this._lastVehicle = null;
    this._lastWorld = null;
    this.minClearance = 2.5;
    this.omega = 7.5;        // spring stiffness (rad/s)
    this.zeta = 0.82;        // slightly under-damped -> buttery, alive
    this.cine = { shot: 'side', t: 0, len: 5, side: 1, pos: new THREE.Vector3(), n: 0 };
  }

  setRig(rig) { this.rig = rig; }

  get modeName() { return this._mode().name; }

  _modeList() { return getSettings().cinematic ? MODES : MODES.slice(0, 3); }
  _mode() { return MODES[Math.min(this.mode, MODES.length - 1)]; }

  toggleMode() {
    const list = this._modeList();
    this.mode = (this.mode + 1) % list.length;
    if (this._mode().name === 'cine') this._cut(true);
    this._needSnap = true;
    return this.modeName;
  }

  setMode(i) {
    if (typeof i === 'string') i = MODES.findIndex((m) => m.name === i);
    if (i < 0) i = 0;
    this.mode = ((i % MODES.length) + MODES.length) % MODES.length;
    if (this._mode().name === 'cine') this._cut(true);
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  // Jump immediately to the ideal position on the next update (or now if a vehicle was seen).
  snap(vehicle, world) {
    this._needSnap = true;
    const v = vehicle || this._lastVehicle;
    const w = world || this._lastWorld;
    if (v) { try { this.update(0.016, v, w); } catch (e) { /* ignore */ } }
  }

  _cut(first) {
    const c = this.cine;
    const order = ['side', 'fly', 'high', 'low', 'fly'];
    c.n = first ? 0 : c.n + 1;
    c.shot = order[c.n % order.length];
    c.side = (c.n % 2) ? -1 : 1;
    c.t = 0;
    c.len = 3.6 + (c.n * 1.7 % 2.2);
    c.fresh = true;
    this._needSnap = true;
  }

  update(dt, vehicle, world) {
    if (!vehicle || !vehicle.mesh) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._lastVehicle = vehicle;
    if (world) this._lastWorld = world;
    world = world || this._lastWorld;
    this.time += dt;
    const S = getSettings();
    if (this.mode >= this._modeList().length) this.mode = 0;

    let rig = null;
    try { rig = vehicle.getCameraRig ? vehicle.getCameraRig() : null; } catch (e) { rig = null; }
    rig = rig || this.rig || _def;
    if (rig === _def) _def.target.copy(vehicle.position || vehicle.mesh.position);
    if (!rig.target) rig = { ...rig, target: vehicle.position || vehicle.mesh.position };
    const m = this._mode();
    const isCine = m.name === 'cine';
    let snap = this._needSnap;
    this._needSnap = false;

    // Vehicle orientation
    _fwd.set(0, 0, -1).applyQuaternion(vehicle.mesh.quaternion);
    _right.set(1, 0, 0).applyQuaternion(vehicle.mesh.quaternion);
    const bankRoll = Math.asin(clamp(_right.y, -1, 1));

    // Desired chase direction: mix of body forward and velocity, pitch flattened.
    _want.copy(_fwd);
    const vel = vehicle.velocity;
    const spd = vel ? vel.length() : 0;
    if (vel && spd > 4) {
      _tmp.copy(vel).multiplyScalar(1 / spd);
      _want.lerp(_tmp, 0.35);
    }
    _want.y *= 0.55;
    if (_want.lengthSq() < 1e-6) _want.set(0, 0, -1);
    _want.normalize();

    if (snap) this.dir.copy(_want);
    else this.dir.lerp(_want, damp(4.2, dt)).normalize();

    const target = rig.target;
    const boosting = !!(vehicle.boosting || (vehicle.events && vehicle.events.includes && vehicle.events.includes('boost')));
    const speedN = clamp(spd / 60, 0, 1.4);

    let targetDist = (rig.chaseDistance || 12) * m.dist + Math.min(spd, 60) * 0.06;
    let targetH = (rig.height || 4) * m.height;
    let fovBase = (rig.fov || 70) * m.fov;
    let targetFov = fovBase + speedN * 12 + (boosting ? 6 : 0);

    // ---- ideal offset (world space, relative to target)
    if (isCine) {
      const c = this.cine;
      c.t += dt;
      if (c.t > c.len) this._cut(false);
      if (c.fresh) snap = true;
      const side = _tmp.set(-this.dir.z, 0, this.dir.x).multiplyScalar(c.side);
      if (c.shot === 'side') {
        _ideal.copy(side).multiplyScalar(targetDist * 1.25).addScaledVector(this.dir, targetDist * 0.15);
        _ideal.y = targetH * 0.55;
        targetFov = fovBase * 0.8;
      } else if (c.shot === 'high') {
        _ideal.copy(this.dir).multiplyScalar(-targetDist * 1.2).addScaledVector(side, targetDist * 0.5);
        _ideal.y = targetH * 3.6 + 10;
        targetFov = fovBase * 0.85;
      } else if (c.shot === 'low') {
        _ideal.copy(this.dir).multiplyScalar(-targetDist * 0.7).addScaledVector(side, targetDist * 0.4);
        _ideal.y = -targetH * 0.6;
        targetFov = fovBase * 1.15;
      } else { // 'fly': camera is planted ahead of the aircraft and watches it pass
        if (c.fresh) {
          c.pos.copy(target).addScaledVector(this.dir, Math.max(45, spd * 1.9)).addScaledVector(side, 9 + spd * 0.1);
          c.pos.y = target.y - 1;
        }
        _tmp.copy(target).sub(c.pos);
        if (_tmp.dot(this.dir) > 8) c.t = c.len; // it flew past: cut next frame
        _ideal.copy(c.pos).sub(target);
        this.off.copy(_ideal); this.offVel.set(0, 0, 0);
        const d = _tmp.length();
        targetFov = clamp(fovBase * (0.55 + 20 / (d + 20)), 25, 80);
      }
      c.fresh = false;
    } else {
      _ideal.copy(this.dir).multiplyScalar(-targetDist);
      _ideal.y += targetH;
    }

    const kf = damp(3, dt);
    if (snap) {
      this.dist = targetDist; this.heightOff = targetH; this.fov = targetFov; this.roll = 0;
      this.off.copy(_ideal); this.offVel.set(0, 0, 0); this.lift = 0;
    } else {
      this.dist += (targetDist - this.dist) * kf;
      this.heightOff += (targetH - this.heightOff) * kf;
      this.fov += (targetFov - this.fov) * damp(2.5, dt);
      this.roll += (bankRoll * m.roll - this.roll) * damp(3, dt);
      if (!(isCine && this.cine.shot === 'fly')) {
        // damped spring on the camera offset (sub-stepped for stability)
        const w = this.omega, z = this.zeta;
        const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
        for (let i = 0; i < n; i++) {
          this.offVel.x += (w * w * (_ideal.x - this.off.x) - 2 * z * w * this.offVel.x) * h;
          this.offVel.y += (w * w * (_ideal.y - this.off.y) - 2 * z * w * this.offVel.y) * h;
          this.offVel.z += (w * w * (_ideal.z - this.off.z) - 2 * z * w * this.offVel.z) * h;
          this.off.addScaledVector(this.offVel, h);
        }
      }
    }
    _pos.copy(target).add(this.off);

    // look-ahead
    _look.copy(target);
    if (vel) _look.addScaledVector(vel, 0.12 * m.look * 3);
    _look.addScaledVector(this.dir, this.dist * 0.25 * m.look * 2);
    if (snap) this.lookPoint.copy(_look);
    else this.lookPoint.lerp(_look, damp(isCine ? 14 : 8, dt));

    // ---- collision-safe: march target->camera, pull in if terrain intrudes, then keep a smoothed clearance.
    if (world && world.heightAt) {
      try {
        const clear = this.minClearance;
        const groundAt = (x, z) => Math.max(world.heightAt(x, z), 0);
        let t = 1;
        for (let i = 1; i <= 8; i++) {
          const f = i / 8;
          const x = target.x + (_pos.x - target.x) * f;
          const z = target.z + (_pos.z - target.z) * f;
          const y = target.y + (_pos.y - target.y) * f;
          if (y < groundAt(x, z) + clear * 0.6) { t = Math.max(0.3, (i - 1) / 8); break; }
        }
        if (t < 1 && !(isCine && this.cine.shot === 'fly')) {
          _pos.x = target.x + (_pos.x - target.x) * t;
          _pos.z = target.z + (_pos.z - target.z) * t;
          _pos.y = target.y + (_pos.y - target.y) * t;
        }
        const minY = groundAt(_pos.x, _pos.z) + clear;
        const need = Math.max(0, minY - _pos.y);
        // rise fast, sink slowly -> no popping over ridges
        this.lift = need > this.lift ? need : this.lift + (need - this.lift) * damp(2.5, dt);
        _pos.y += this.lift;
        if (this.lift > 0.01 && this.lift > need) _pos.y = Math.max(_pos.y, minY);
      } catch (e) { /* ignore */ }
    }

    // ---- shake: smooth pseudo-noise, speed turbulence + impulses, scaled by user setting
    const amt = S.shake;
    const turb = (speedN > 0.5 ? (speedN - 0.5) * 0.05 : 0) + (boosting ? 0.06 : 0);
    const imp = this.shake;
    if (imp > 0.001) this.shake = Math.max(0, imp - dt * 2.2);
    const mag = (imp * 0.7 + turb) * amt;
    if (mag > 0.0005) {
      const t = this.time;
      _pos.x += (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3)) * 0.5 * mag;
      _pos.y += (Math.sin(t * 41.9 + 2.1) + Math.sin(t * 29.3)) * 0.5 * mag;
      _pos.z += (Math.sin(t * 33.3 + 0.7) + Math.sin(t * 19.1 + 4)) * 0.5 * mag;
    }

    const cam = this.camera;
    cam.position.copy(_pos);
    cam.up.copy(_up);
    cam.lookAt(this.lookPoint);
    cam.rotateZ(this.roll + (mag > 0.0005 ? Math.sin(this.time * 31) * mag * 0.012 : 0));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
