// Pointer-lock first-person controls for the interior,
// and a floaty six-degree drift mode for EVA. Simple, forgiving collision.

import * as THREE from 'three';

export class PlayerControls {
  constructor(camera, dom, roomsData) {
    this.camera = camera;
    this.dom = dom;
    this.rooms = roomsData;
    this.mode = 'interior';
    this.yaw = 0; this.pitch = 0;
    this.pos = new THREE.Vector3(0, 1.6, 2);
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.locked = false;
    this.enabled = true;

    dom.addEventListener('click', () => {
      if (this.enabled && !this.locked) dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw   -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    document.addEventListener('keyup',   (e) => { this.keys[e.code] = false; });
  }

  setEVA(on) {
    this.mode = on ? 'eva' : 'interior';
    this.vel.set(0, 0, 0);
    if (!on) this.pos.y = 1.6;
  }

  update(dt) {
    if (!this.enabled) { this.sync(); return; }
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (this.keys['KeyW']) wish.add(fwd);
    if (this.keys['KeyS']) wish.sub(fwd);
    if (this.keys['KeyD']) wish.add(right);
    if (this.keys['KeyA']) wish.sub(right);

    if (this.mode === 'interior') {
      wish.normalize().multiplyScalar(3.2);
      // ease toward wish velocity — soft, unhurried movement
      this.vel.x += (wish.x - this.vel.x) * Math.min(1, dt * 10);
      this.vel.z += (wish.z - this.vel.z) * Math.min(1, dt * 10);
      const next = this.pos.clone().addScaledVector(this.vel, dt);
      this.collide(next);
      this.pos.copy(next);
      this.pos.y = 1.6;
    } else {
      // EVA: gentle thrust with drift, vertical control on Space/Shift
      const look = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch));
      const thrust = new THREE.Vector3();
      if (this.keys['KeyW']) thrust.add(look);
      if (this.keys['KeyS']) thrust.sub(look);
      if (this.keys['KeyD']) thrust.add(right);
      if (this.keys['KeyA']) thrust.sub(right);
      if (this.keys['Space']) thrust.y += 1;
      if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) thrust.y -= 1;
      this.vel.addScaledVector(thrust.normalize(), dt * 2.4);
      this.vel.multiplyScalar(1 - dt * 0.35);           // faint damping — space with training wheels
      if (this.vel.length() > 4) this.vel.setLength(4);
      this.pos.addScaledVector(this.vel, dt);
      // soft leash: never drift hopelessly far
      const leash = this.pos.length();
      if (leash > 60) this.pos.setLength(60);
      this.pushOutOfShip();
    }
    this.sync();
  }

  pushOutOfShip() {
    // Keep the EVA player outside the ship's exterior shell (AABB pushout).
    const min = [-3.6, -0.6, -14.9], max = [3.6, 3.6, 10.85];
    const p = this.pos;
    if (p.x > min[0] && p.x < max[0] && p.y > min[1] && p.y < max[1] && p.z > min[2] && p.z < max[2]) {
      const pens = [
        [p.x - min[0], 'x', min[0]], [max[0] - p.x, 'x', max[0]],
        [p.y - min[1], 'y', min[1]], [max[1] - p.y, 'y', max[1]],
        [p.z - min[2], 'z', min[2]], [max[2] - p.z, 'z', max[2]],
      ].sort((a, b) => a[0] - b[0]);
      const [, axis, plane] = pens[0];
      p[axis] = plane;
      this.vel[axis] = 0;
    }
  }

  collide(next) {
    const h = this.rooms.hull, r = 0.35;
    next.x = Math.max(h.min[0] + r, Math.min(h.max[0] - r, next.x));
    next.z = Math.max(h.min[2] + r, Math.min(h.max[2] - r, next.z));
    // partitions: block crossing unless within doorway
    for (const pz of this.rooms.partitions) {
      const crossing = (this.pos.z - pz) * (next.z - pz) < 0 ||
                       Math.abs(next.z - pz) < r;
      if (crossing && Math.abs(next.x) > this.rooms.doorHalfWidth - r) {
        next.z = this.pos.z; // slide along the wall
      }
    }
  }

  sync() {
    this.camera.position.copy(this.pos);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);
  }

  currentRoom() {
    for (const r of this.rooms.rooms) {
      if (this.pos.z >= r.zMin && this.pos.z < r.zMax) return r.id;
    }
    return null;
  }
}
