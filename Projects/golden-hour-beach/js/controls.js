import * as THREE from 'three';
import { BOUNDS, walkLimits } from './field.js';

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
    this._eye = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.touchWalking = false;
    this._lastTouch = null;

    // World edges come straight from field.js's BOUNDS; the live seaward limit
    // is computed every frame from the current water level (walkLimits below).
    this.bounds = BOUNDS;
    this.wadeDepth = 0;
    this.wadeT = 0;

    // Sitting (at the campfire, main.js decides where). Seated keeps the look
    // free and drops the eye to log height; any walk key stands back up, which
    // is the only way standing up should ever work — nobody reads a "press X to
    // stand" prompt, everybody just pushes forward.
    this.seated = false;

    // True while the journal (or anything else modal) is open: input is
    // ignored but the world keeps breathing behind the page.
    this.frozen = false;

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
    if (!this.frozen) {
      if (this.keys['KeyW']) fwd += 1;
      if (this.keys['KeyS']) fwd -= 1;
      if (this.keys['KeyA']) strafe -= 1;
      if (this.keys['KeyD']) strafe += 1;
      if (this.touchWalking) fwd += 1;
    }

    // Arrows look, they don't walk.
    //
    // They used to be a second copy of WASD, which made them the least useful
    // keys on the board — and it left mouse-look as the only way to turn, so
    // losing pointer lock (Esc, alt-tab, anything that takes focus) left you able
    // to walk and unable to face anywhere. Nothing in this piece needs aiming, so
    // nothing in it should need the mouse captured. With these bound, the whole
    // beach is reachable from the keyboard alone.
    const lookRate = this.frozen ? 0 : this.keyLookSpeed * dt;
    if (this.keys['ArrowLeft'])  this.yaw += lookRate;
    if (this.keys['ArrowRight']) this.yaw -= lookRate;
    if (this.keys['ArrowUp'])    this.pitch += lookRate * 0.7;
    if (this.keys['ArrowDown'])  this.pitch -= lookRate * 0.7;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));

    if (this.seated && (fwd !== 0 || strafe !== 0 || this.touchWalking)) this.seated = false;
    if (this.seated) { fwd = 0; strafe = 0; }

    const moving = (fwd !== 0 || strafe !== 0);
    const len = Math.hypot(fwd, strafe) || 1;
    fwd /= len; strafe /= len;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dx = (-sin * fwd + cos * strafe) * this.walkSpeed * dt;
    const dz = (-cos * fwd - sin * strafe) * this.walkSpeed * dt;

    // Seaward bound is a wading depth, not a wall — and it now varies along
    // the coast (steeper seabed off the headland stops a wader sooner).
    // walkLimits solves for the z where the current water surface is
    // WADE_DEPTH deep at this x, so the limit breathes with the tide and
    // bends with the shoreline.
    const lim = walkLimits(this.pos.x, waterLevel, WADE_DEPTH);
    let nx = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.pos.x + dx));
    let nz = Math.max(lim.minZ, Math.min(lim.maxZ, this.pos.z + dz));

    // The step rule: a stride that would rise more than 0.9 m is refused.
    // This one line is what makes the headland's cliff face, and everything
    // else built tall, solid — no colliders anywhere. Probed a stride ahead
    // (0.8 m) rather than at the destination, because per-frame movement is
    // centimetres and a per-frame height difference would never trip.
    if (moving) {
      const mdx = nx - this.pos.x, mdz = nz - this.pos.z;
      const mlen = Math.hypot(mdx, mdz);
      if (mlen > 1e-9) {
        const here = this.getGroundHeight(this.pos.x, this.pos.z);
        const ahead = this.getGroundHeight(
          this.pos.x + (mdx / mlen) * 0.8, this.pos.z + (mdz / mlen) * 0.8);
        if (ahead - here > 0.9) { nx = this.pos.x; nz = this.pos.z; }
      }
    }
    this.pos.x = nx;
    this.pos.z = nz;

    // Head bob eases in and out
    const targetBob = moving ? 1 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    if (moving) this.bobPhase += dt * 6.5;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmount;

    const ground = this.getGroundHeight(this.pos.x, this.pos.z);
    // Eased between standing and seated so sitting is a settle, not a cut.
    const targetEye = this.seated ? 0.95 : this.eyeHeight;
    this._eye += (targetEye - this._eye) * Math.min(1, dt * 4);
    this.pos.y = ground + this._eye;

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
