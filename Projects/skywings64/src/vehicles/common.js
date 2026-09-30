// Shared helpers + base class for all SkyWings 64 vehicles.
// Conventions: forward = -Z, up = +Y. heading = mesh.rotation.y (CCW from above, turning right lowers it).
// pitch: nose-up positive. roll: right-bank positive (mesh.rotation.z = -roll).
import * as THREE from 'three';
import { syncEnvironment } from './materials.js';
import { PuffPool } from './vehicleFx.js';

export const G = 9.8;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

export * from './materials.js';
export * from './parts.js';
export * from './vehicleFx.js';

// ---------- base vehicle ----------
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class VehicleBase {
  constructor(world) {
    this.world = world || null;
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ';
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.state = 'grounded';
    this.speed = 0;
    this.altitude = 0;
    this.agl = 0;
    this.heading = 0;
    this.fuel = 1;
    this.throttle = 0;
    this.events = [];
    this.landingQuality = null;
    this.pitch = 0; // nose up +
    this.roll = 0; // right bank +
    this.gearOffset = 1; // CG height above ground when resting
    this.time = 0;
    // fx hooks (world-space positions refreshed every update). Consumers may read v.fx.*
    this.fx = {
      wingtips: [new THREE.Vector3(), new THREE.Vector3()], // world positions of wingtips (glider)
      vapour: 0, // 0..1 how strongly wingtip vapour hooks are condensing
      exhaust: [], // world nozzle/exhaust positions [{position:Vector3, direction:Vector3, power:0..1}]
      contact: [], // world ground-contact points (wheels/skids/feet) [Vector3]
      dust: 0, // 0..1 ground contact/skid/downwash dust intensity
      dustColor: 0xc9b98a,
      rotorDisc: null, // { center:Vector3, radius:number } gyro
    };
    this.puffs = new PuffPool(96);
    this.mesh.add(this.puffs.object);
    this._envT = 0;
    this._rig = { target: new THREE.Vector3(), chaseDistance: 14, height: 4, fov: 65 };
  }

  emit(name) {
    this.events.push(name);
    if (this.events.length > 32) this.events.shift();
  }

  groundHeight(x, z) {
    const w = this.world;
    if (w && typeof w.heightAt === 'function') {
      const h = w.heightAt(x, z);
      if (typeof h === 'number' && isFinite(h)) return h;
    }
    return 0;
  }

  surfaceName(x, z, h) {
    const w = this.world;
    if (w && typeof w.surfaceAt === 'function') {
      try {
        const s = w.surfaceAt(x, z);
        if (s) return s;
      } catch (e) { /* ignore */ }
    }
    return h <= 0.05 ? 'water' : 'grass';
  }

  slopeDeg(x, z) {
    const d = 1.5;
    const dx = this.groundHeight(x + d, z) - this.groundHeight(x - d, z);
    const dz = this.groundHeight(x, z + d) - this.groundHeight(x, z - d);
    return Math.atan(Math.hypot(dx, dz) / (2 * d)) * 57.29578;
  }

  // Return { dx, dz } downhill-free slope gradient (dh/dx, dh/dz)
  gradient(x, z) {
    const d = 1.5;
    return {
      gx: (this.groundHeight(x + d, z) - this.groundHeight(x - d, z)) / (2 * d),
      gz: (this.groundHeight(x, z + d) - this.groundHeight(x, z - d)) / (2 * d),
    };
  }

  reset(position, heading) {
    this.time = 0;
    this.position.copy(position || new THREE.Vector3());
    this.heading = num(heading, 0);
    this.velocity.set(0, 0, 0);
    this.pitch = 0;
    this.roll = 0;
    this.events.length = 0;
    this.landingQuality = null;
    this.fuel = 1;
    this.throttle = 0;
    this.speed = 0;
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    const air = this.position.y - gy > this.gearOffset + 3;
    if (air) {
      this.state = 'flying';
      this._airStart();
    } else {
      this.position.y = gy + this.gearOffset;
      this.state = 'grounded';
      this._groundStart();
    }
    this.altitude = this.agl = Math.max(0, this.position.y - gy - this.gearOffset);
    this.applyTransform();
  }
  _airStart() {}
  _groundStart() {}

  // per-frame housekeeping for the shared fx pool / environment; call at end of update
  tickFx(dt) {
    this.puffs.update(dt);
    this._envT -= dt;
    if (this._envT <= 0) {
      this._envT = 1;
      const sc = this.mesh.parent;
      if (sc && sc.isScene) syncEnvironment(sc);
    }
  }
  dustColorFor(x, z, h) {
    const s = this.surfaceName(x, z, h);
    return s === 'sand' ? 0xdcc98e : s === 'snow' ? 0xf4f8ff : s === 'rock' ? 0xa09a90 : s === 'water' ? 0xe8f4ff : s === 'pad' ? 0xcfcfcf : 0x93a070;
  }
  // world-space list of fx emitters for other systems
  getFxPoints() {
    return this.fx;
  }

  applyTransform() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(this.pitch, this.heading, -this.roll, 'YXZ');
  }

  forwardVec(out) {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }
  // body up vector from current attitude
  upVec(out) {
    _e.set(this.pitch, this.heading, -this.roll, 'YXZ');
    _q.setFromEuler(_e);
    return out.set(0, 1, 0).applyQuaternion(_q);
  }
  rightVec(out) {
    _e.set(this.pitch, this.heading, -this.roll, 'YXZ');
    _q.setFromEuler(_e);
    return out.set(1, 0, 0).applyQuaternion(_q);
  }

  updateDerived(gy) {
    if (gy === undefined) gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    this.speed = this.velocity.length();
    this.altitude = this.agl = Math.max(0, this.position.y - gy - this.gearOffset);
  }

  // Evaluate a touchdown; sets state/events/landingQuality. lim: {v,h,tilt,slope}
  evaluateLanding(lim, tiltDeg) {
    const x = this.position.x;
    const z = this.position.z;
    const h = this.groundHeight(x, z);
    const surface = this.surfaceName(x, z, h);
    const water = h <= 0.05 || surface === 'water';
    const vs = Math.max(0, -this.velocity.y);
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const slope = water ? 0 : this.slopeDeg(x, z);
    const q = {
      speed: this.velocity.length(),
      verticalSpeed: vs,
      horizontalSpeed: hs,
      tiltDeg,
      slopeDeg: slope,
      surface: water ? 'water' : surface,
      ok: false,
      rating: 'crash',
      score: 0,
    };
    if (water) {
      this.state = 'splashed';
      this.emit('splash');
    } else {
      const ok = vs <= lim.v && hs <= lim.h && tiltDeg <= lim.tilt && slope <= lim.slope;
      q.ok = ok;
      if (ok) {
        const f = Math.max(vs / lim.v, hs / lim.h, tiltDeg / lim.tilt, slope / lim.slope);
        q.score = clamp(1 - f * 0.7, 0.2, 1);
        q.rating = f < 0.4 ? 'perfect' : f < 0.7 ? 'good' : 'ok';
        this.state = 'landed';
        this.emit('touchdown');
      } else {
        this.state = 'crashed';
        this.emit('crash');
      }
    }
    this.landingQuality = q;
    return q;
  }

  getCameraRig() {
    const r = this._rig;
    r.target.copy(this.position);
    return r;
  }
}
