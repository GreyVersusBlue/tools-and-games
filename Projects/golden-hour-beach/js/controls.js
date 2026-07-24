import * as THREE from 'three';

// First-person stroll controls. Pointer-lock on desktop; drag-look +
// hold-lower-screen-to-walk on touch. Camera height follows the terrain
// heightfield, with a gentle head bob while moving.

export class WalkControls {
  constructor(camera, dom, getGroundHeight) {
    this.camera = camera;
    this.dom = dom;
    this.getGroundHeight = getGroundHeight;

    this.enabled = false;
    this.yaw = Math.PI * 0.15;   // start facing down the beach toward the sun
    this.pitch = 0;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.keys = {};
    this.walkSpeed = 2.1;        // m/s — an unhurried stroll
    this.eyeHeight = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.touchWalking = false;
    this._lastTouch = null;

    // Bounds: keep the walker on the beach strip.
    this.bounds = { minX: -140, maxX: 140, minZ: -60, maxZ: 46 };

    this._bindEvents();
  }

  _bindEvents() {
    const dom = this.dom;

    document.addEventListener('keydown', e => { this.keys[e.code] = true; });
    document.addEventListener('keyup',   e => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== dom) return;
      this.yaw   -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    });

    // Touch: drag anywhere to look; touches on the lower third walk forward.
    dom.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      if (t.clientY > window.innerHeight * 0.66) {
        this.touchWalking = true;
        this._walkTouchId = t.identifier;
      } else {
        this._lastTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }, { passive: true });

    dom.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (this._lastTouch && t.identifier === this._lastTouch.id) {
          this.yaw   -= (t.clientX - this._lastTouch.x) * 0.005;
          this.pitch -= (t.clientY - this._lastTouch.y) * 0.005;
          this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
          this._lastTouch.x = t.clientX;
          this._lastTouch.y = t.clientY;
        }
      }
    }, { passive: true });

    dom.addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (this._walkTouchId === t.identifier) this.touchWalking = false;
        if (this._lastTouch && t.identifier === this._lastTouch.id) this._lastTouch = null;
      }
    }, { passive: true });
  }

  update(dt) {
    if (!this.enabled) dt = Math.min(dt, 0.05);

    // Movement input in camera-relative space
    let fwd = 0, strafe = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    fwd += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  fwd -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  strafe -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) strafe += 1;
    if (this.touchWalking) fwd += 1;

    const moving = (fwd !== 0 || strafe !== 0);
    const len = Math.hypot(fwd, strafe) || 1;
    fwd /= len; strafe /= len;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dx = (-sin * fwd + cos * strafe) * this.walkSpeed * dt;
    const dz = (-cos * fwd - sin * strafe) * this.walkSpeed * dt;

    this.pos.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.pos.x + dx));
    this.pos.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.pos.z + dz));

    // Head bob eases in and out
    const targetBob = moving ? 1 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    if (moving) this.bobPhase += dt * 6.5;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmount;

    const ground = this.getGroundHeight(this.pos.x, this.pos.z);
    this.pos.y = ground + this.eyeHeight;

    this.camera.position.set(this.pos.x + bobX * cos, this.pos.y + bobY, this.pos.z - bobX * sin);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    // subtle roll with the bob
    this.camera.rotateZ(Math.sin(this.bobPhase) * 0.004 * this.bobAmount);

    return moving;
  }
}
