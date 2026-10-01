// Flight recorder + cinematic replay for the results screen.
// Recorder samples the vehicle mesh transform at 20 Hz during FLIGHT/ENDING (last 40 s kept).
// Replay drives the vehicle mesh along the recording and cuts between camera shots.
import * as THREE from 'three';

const HZ = 20;
const MAX_SECS = 40;
const MAX = HZ * MAX_SECS;

export class FlightRecorder {
  constructor() {
    this.buf = [];
    this.acc = 0;
  }
  clear() { this.buf.length = 0; this.acc = 0; }
  sample(dt, mesh) {
    if (!mesh) return;
    this.acc += dt;
    if (this.acc < 1 / HZ && this.buf.length) return;
    this.acc = 0;
    const f = this.buf.length >= MAX ? this.buf.shift() : { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    f.p.copy(mesh.position); f.q.copy(mesh.quaternion);
    this.buf.push(f);
  }
  get duration() { return Math.max(0, (this.buf.length - 1) / HZ); }
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _look = new THREE.Vector3();

// Shots: 0 chase (behind/above), 1 fixed trackside camera the craft flies past, 2 low side dolly, 3 high orbit.
export class ReplayDirector {
  constructor(recorder, world) {
    this.rec = recorder; this.world = world;
    this.t = 0; this.shot = -1; this.shotT = 0; this.shotLen = 3.2;
    this.fixed = new THREE.Vector3();
    this.side = 1;
    // replay the last ~14 s (the interesting finish); shorter flights replay entirely
    this.len = Math.min(this.rec.duration, 14);
    this.start = this.rec.duration - this.len;
  }
  get usable() { return this.len > 2; }

  sampleAt(t, outP, outQ) {
    const b = this.rec.buf;
    const x = Math.max(0, Math.min(b.length - 1, t * HZ));
    const i = Math.floor(x), k = x - i;
    const f0 = b[i], f1 = b[Math.min(b.length - 1, i + 1)];
    outP.copy(f0.p).lerp(f1.p, k);
    if (outQ) outQ.copy(f0.q).slerp(f1.q, k);
    return outP;
  }

  ground(x, z) { try { return Math.max(0, this.world.heightAt(x, z)); } catch (e) { return 0; } }

  // Advance and apply: moves mesh, positions camera. Returns true while playing.
  update(dt, mesh, camera) {
    if (!this.usable) return false;
    this.t += dt; this.shotT += dt;
    let lt = this.t % (this.len + 1.5); // brief hold on the final frame before looping
    const rt = this.start + Math.min(this.len, lt);
    this.sampleAt(rt, _p, _q);
    mesh.position.copy(_p); mesh.quaternion.copy(_q);
    if (this.shot < 0 || this.shotT > this.shotLen || lt < dt) this.cut(rt);
    // velocity direction for framing
    this.sampleAt(Math.max(this.start, rt - 0.5), _a);
    const dir = _b.copy(_p).sub(_a); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1).applyQuaternion(_q).setY(0);
    dir.normalize();
    const cp = camera.position;
    switch (this.shot) {
      case 0: cp.copy(_p).addScaledVector(dir, -14).add(_look.set(0, 5, 0)); break;
      case 1: cp.copy(this.fixed); break;
      case 2: cp.copy(_p).add(_look.set(dir.z * this.side * 11, 1.5, -dir.x * this.side * 11)).addScaledVector(dir, 3); break;
      default: {
        const a = this.shotT * 0.35 + this.side;
        cp.set(_p.x + Math.cos(a) * 32, _p.y + 16, _p.z + Math.sin(a) * 32);
      }
    }
    const gh = this.ground(cp.x, cp.z) + 2;
    if (cp.y < gh) cp.y = gh;
    camera.lookAt(_look.copy(_p).setY(_p.y + 0.8));
    return true;
  }

  cut(rt) {
    this.shot = (this.shot + 1 + (Math.random() < 0.3 ? 1 : 0)) % 4;
    this.shotT = 0;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.shotLen = 2.6 + Math.random() * 1.6;
    if (this.shot === 1) {
      // place a static camera ahead of where the craft will be in ~1.5 s, offset to the side
      const ahead = this.sampleAt(Math.min(this.start + this.len, rt + 1.6), new THREE.Vector3());
      const now = this.sampleAt(rt, new THREE.Vector3());
      const d = ahead.clone().sub(now).setY(0);
      if (d.lengthSq() < 1) d.set(1, 0, 0);
      d.normalize();
      this.fixed.copy(ahead).add(new THREE.Vector3(d.z * this.side * 16, 3, -d.x * this.side * 16)).addScaledVector(d, 6);
    }
  }
}
