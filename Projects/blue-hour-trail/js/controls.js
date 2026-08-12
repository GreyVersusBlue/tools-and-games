import * as THREE from 'three';
import { walkHeight, walkable, surfaceAt, BOUNDS } from './field.js';

// First-person hike controls. Pointer-lock on desktop; drag-look +
// hold-lower-screen-to-walk on touch. Camera height follows walkHeight (the
// terrain, or the bridge deck over the creek), with a gentle head bob.
//
// Golden Hour's WalkControls, with the wading limit swapped for a slope limit:
// on a mountainside the bound is steepness, and it deflects rather than stops
// — a blocked diagonal still slides along whichever axis stays walkable, so
// steep banks feel like banks instead of glass.

export class WalkControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;

    this.enabled = false;
    this.yaw = 0;
    this.pitch = 0;

    // Yaw-then-pitch, matching the order update() composes them in below. The
    // default XYZ order decomposes the same quaternion into an x/y that are
    // not pitch and yaw once both are non-zero — anything reading
    // `camera.rotation.y` as facing gets nonsense. Same fix Golden Hour needed.
    camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(0, 0, 147);
    this.keys = {};
    this.walkSpeed = 2.0;        // m/s — a hiker's pace, before the grade
    this.keyLookSpeed = 1.15;    // rad/s on the arrow keys — a pan, not a flick
    this.eyeHeight = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.touchWalking = false;
    this._lastTouch = null;

    this.surface = 'trail';      // what's underfoot this frame, for audio
    this.moving = false;

    this._bindEvents();
  }

  _bindEvents() {
    const dom = this.dom;

    const LOOK_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      // Arrows scroll by default; don't rely on style.css's overflow:hidden.
      if (LOOK_KEYS.includes(e.code)) e.preventDefault();
    });
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
    if (this.keys['KeyW']) fwd += 1;
    if (this.keys['KeyS']) fwd -= 1;
    if (this.keys['KeyA']) strafe -= 1;
    if (this.keys['KeyD']) strafe += 1;
    if (this.touchWalking) fwd += 1;

    // Arrows look, they don't walk — the whole mountain stays reachable from
    // the keyboard alone, pointer lock or no pointer lock.
    const lookRate = this.keyLookSpeed * dt;
    if (this.keys['ArrowLeft'])  this.yaw += lookRate;
    if (this.keys['ArrowRight']) this.yaw -= lookRate;
    if (this.keys['ArrowUp'])    this.pitch += lookRate * 0.7;
    if (this.keys['ArrowDown'])  this.pitch -= lookRate * 0.7;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));

    const moving = (fwd !== 0 || strafe !== 0);
    const len = Math.hypot(fwd, strafe) || 1;
    fwd /= len; strafe /= len;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);

    // Uphill slows the walker down. Not for realism points — because speed is
    // how a body reads a grade, and a climb you take at full stroll speed
    // doesn't feel like a climb at all.
    const stepDist = this.walkSpeed * dt || 1e-6;
    let dx = (-sin * fwd + cos * strafe) * this.walkSpeed * dt;
    let dz = (-cos * fwd - sin * strafe) * this.walkSpeed * dt;
    if (moving) {
      const here = walkHeight(this.pos.x, this.pos.z);
      const there = walkHeight(this.pos.x + dx, this.pos.z + dz);
      const rise = Math.max(0, there - here) / stepDist;
      const slow = Math.max(0.45, 1 - rise * 1.8);
      dx *= slow; dz *= slow;
    }

    // Steepness deflects rather than stops: try the full move, then each axis
    // alone, so a blocked diagonal slides along the bank instead of sticking.
    let nx = this.pos.x + dx, nz = this.pos.z + dz;
    if (!walkable(nx, nz)) {
      if (walkable(this.pos.x + dx, this.pos.z)) { nx = this.pos.x + dx; nz = this.pos.z; }
      else if (walkable(this.pos.x, this.pos.z + dz)) { nx = this.pos.x; nz = this.pos.z + dz; }
      else { nx = this.pos.x; nz = this.pos.z; }
    }
    this.pos.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, nx));
    this.pos.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, nz));

    // Head bob eases in and out
    const targetBob = moving ? 1 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    if (moving) this.bobPhase += dt * 6.5;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmount;

    const ground = walkHeight(this.pos.x, this.pos.z);
    this.pos.y = ground + this.eyeHeight;
    this.surface = surfaceAt(this.pos.x, this.pos.z);
    this.moving = moving;

    this.camera.position.set(this.pos.x + bobX * cos, this.pos.y + bobY, this.pos.z - bobX * sin);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    // subtle roll with the bob
    this.camera.rotateZ(Math.sin(this.bobPhase) * 0.004 * this.bobAmount);

    return moving;
  }
}
