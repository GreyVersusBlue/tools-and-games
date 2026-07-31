import * as THREE from 'three';
import { wadeLimitZ } from './field.js';

// First-person stroll controls. Pointer-lock on desktop; drag-look +
// hold-lower-screen-to-walk on touch. Camera height follows the terrain
// heightfield, with a gentle head bob while moving.

// Knee-ish. See field.js's wadeLimitZ for why this is a depth, not a position.
const WADE_DEPTH = 0.45;

export class WalkControls {
  constructor(camera, dom, getGroundHeight) {
    this.camera = camera;
    this.dom = dom;
    this.getGroundHeight = getGroundHeight;

    this.enabled = false;
    this.yaw = Math.PI * 0.15;   // start facing down the beach toward the sun
    this.pitch = 0;

    // Yaw-then-pitch, matching the order update() composes them in below. The
    // default XYZ order decomposes the same quaternion into an x/y that are not
    // pitch and yaw once both are non-zero — look 30° down and `rotation.y` stops
    // being the direction you are facing. Nothing on screen changes (the
    // quaternion is identical either way); what changes is that anything reading
    // `camera.rotation` off this game gets the truth. `drive.mjs`'s camState does
    // exactly that, and it was reading facing 0.54 while the camera pointed at
    // 2.60 — every aim after the first landed somewhere nobody asked for.
    camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(0, 0, 0);
    this.keys = {};
    this.walkSpeed = 2.1;        // m/s — an unhurried stroll
    this.keyLookSpeed = 1.15;    // rad/s on the arrow keys — a slow pan, not a flick
    this.eyeHeight = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.touchWalking = false;
    this._lastTouch = null;

    // Bounds: keep the walker on the beach strip. minZ here is a fallback outer
    // wall only — the real seaward limit is computed every frame from the
    // current water level, see wadeLimitZ below.
    this.bounds = { minX: -140, maxX: 140, minZ: -60, maxZ: 46 };
    this.wadeDepth = 0;
    this.wadeT = 0;

    this._bindEvents();
  }

  _bindEvents() {
    const dom = this.dom;

    const LOOK_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      // Arrows scroll by default, and this page is only unscrollable because
      // style.css sets overflow:hidden on body. Don't rely on that from here.
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

  update(dt, waterLevel = 0) {
    if (!this.enabled) dt = Math.min(dt, 0.05);

    // Movement input in camera-relative space
    let fwd = 0, strafe = 0;
    if (this.keys['KeyW']) fwd += 1;
    if (this.keys['KeyS']) fwd -= 1;
    if (this.keys['KeyA']) strafe -= 1;
    if (this.keys['KeyD']) strafe += 1;
    if (this.touchWalking) fwd += 1;

    // Arrows look, they don't walk.
    //
    // They used to be a second copy of WASD, which made them the least useful
    // keys on the board — and it left mouse-look as the only way to turn, so
    // losing pointer lock (Esc, alt-tab, anything that takes focus) left you able
    // to walk and unable to face anywhere. Nothing in this piece needs aiming, so
    // nothing in it should need the mouse captured. With these bound, the whole
    // beach is reachable from the keyboard alone.
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
    const dx = (-sin * fwd + cos * strafe) * this.walkSpeed * dt;
    const dz = (-cos * fwd - sin * strafe) * this.walkSpeed * dt;

    // Seaward bound is a wading depth, not a wall. Used to be the static
    // BOUNDS.minZ, -60, which is nowhere near the water — nothing stopped a
    // walker from reaching eye height 3.8 m *underwater*, because the seabed
    // keeps dropping long after the shoreline is behind you. wadeLimitZ solves
    // for the z where the current water surface is WADE_DEPTH deep, so the
    // limit rises and falls with the tide instead of sitting at a fixed spot.
    const minZ = Math.max(this.bounds.minZ, wadeLimitZ(waterLevel, WADE_DEPTH));
    this.pos.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.pos.x + dx));
    this.pos.z = Math.max(minZ, Math.min(this.bounds.maxZ, this.pos.z + dz));

    // Head bob eases in and out
    const targetBob = moving ? 1 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    if (moving) this.bobPhase += dt * 6.5;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmount;

    const ground = this.getGroundHeight(this.pos.x, this.pos.z);
    this.pos.y = ground + this.eyeHeight;

    // How deep the water is where the walker is standing, 0 on dry sand. Camera
    // height already drops "for free" as ground descends toward the clamp above
    // — this is just exposed so audio.js can swell the wash sound as you wade in.
    this.wadeDepth = Math.max(0, waterLevel - ground);
    this.wadeT = Math.min(1, this.wadeDepth / WADE_DEPTH);

    this.camera.position.set(this.pos.x + bobX * cos, this.pos.y + bobY, this.pos.z - bobX * sin);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    // subtle roll with the bob
    this.camera.rotateZ(Math.sin(this.bobPhase) * 0.004 * this.bobAmount);

    return moving;
  }
}
