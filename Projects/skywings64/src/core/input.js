import { getSettings } from './settings.js';
// Input: keyboard + gamepad (+ optional touch via setTouch()).
// pitch: + = nose down (stick forward). roll: + = roll right. yaw: + = turn right.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Space',
  'KeyR', 'KeyF', 'KeyC', 'KeyB', 'KeyX', 'Tab',
]);

const dz = (v, d = 0.15) => {
  const a = Math.abs(v);
  if (a < d) return 0;
  return Math.sign(v) * (a - d) / (1 - d);
};
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class InputState {
  constructor(domElement) {
    this.dom = domElement || (typeof window !== 'undefined' ? window : null);
    this.pitch = 0; this.roll = 0; this.yaw = 0;
    this.throttle = 0;
    this.boost = false; this.brake = false;
    this.action = false; this.action2 = false;
    this.camToggle = false; this.pause = false;
    this.keys = new Set();
    this.throttleRate = 0.6; // per second
    this.gamepadConnected = false;
    this._camLatch = false; this._pauseLatch = false;
    this._touch = null;
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onBlur = () => { this.keys.clear(); };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
    this._prevPad = { cam: false, pause: false };
  }

  _onDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyC') this._camLatch = true;
      if (e.code === 'KeyP' || e.code === 'Escape') this._pauseLatch = true;
    }
    this.keys.add(e.code);
  }

  _onUp(e) {
    this.keys.delete(e.code);
  }

  isDown(code) { return this.keys.has(code); }

  // Optional touch/virtual stick: {pitch, roll, yaw, throttle, action, action2, boost, brake} any subset.
  setTouch(state) { this._touch = state || null; }

  reset() {
    this.pitch = this.roll = this.yaw = 0;
    this.throttle = 0;
    this.boost = this.brake = this.action = this.action2 = false;
    this.camToggle = this.pause = false;
    this._camLatch = this._pauseLatch = false;
  }

  update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    // Edges latched since last frame become visible now; previous frame's edges are dropped.
    this.camToggle = this._camLatch;
    this.pause = this._pauseLatch;
    this._camLatch = false;
    this._pauseLatch = false;

    const k = this.keys;
    const down = (a, b) => k.has(a) || (b ? k.has(b) : false);
    let tp = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
    let tr = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    let ty = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    let thrDelta = ((k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyR')) ? 1 : 0)
      - ((k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyF')) ? 1 : 0);
    let boost = k.has('KeyB') || k.has('Tab');
    let brake = k.has('KeyX');
    let action = k.has('Space');
    let action2 = k.has('Enter');
    let analog = false;

    // Gamepad
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    } catch (e) { pad = null; }
    this.gamepadConnected = !!pad;
    if (pad) {
      const ax = pad.axes || [];
      const bt = (i) => (pad.buttons[i] ? pad.buttons[i].pressed : false);
      const bv = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const gp = -dz(ax[1] || 0), gr = dz(ax[0] || 0), gy = dz(ax[2] || 0);
      if (gp || gr || gy) {
        analog = true;
        if (gp) tp = gp;
        if (gr) tr = gr;
        if (gy) ty = gy;
      }
      // D-pad for pitch/roll fallback
      if (bt(12)) tp = 1; if (bt(13)) tp = -1;
      if (bt(14)) tr = -1; if (bt(15)) tr = 1;
      const rt = bv(7), lt = bv(6);
      if (rt > 0.05 || lt > 0.05) thrDelta += rt - lt;
      if (bt(0)) action = true;
      if (bt(2)) action2 = true;
      if (bt(1)) brake = true;
      if (bt(5)) boost = true;
      const cam = bt(3), pz = bt(9);
      if (cam && !this._prevPad.cam) this.camToggle = true;
      if (pz && !this._prevPad.pause) this.pause = true;
      this._prevPad.cam = cam; this._prevPad.pause = pz;
    }

    const t = this._touch;
    if (t) {
      if (t.pitch) tp = t.pitch;
      if (t.roll) tr = t.roll;
      if (t.yaw) ty = t.yaw;
      if (t.throttle) thrDelta += t.throttle;
      if (t.action) action = true;
      if (t.action2) action2 = true;
      if (t.boost) boost = true;
      if (t.brake) brake = true;
      analog = true;
    }

    if (getSettings().invertPitch) tp = -tp;
    tp = clamp(tp, -1, 1); tr = clamp(tr, -1, 1); ty = clamp(ty, -1, 1);
    // Keyboard ramps smoothly; analog is nearly direct. Faster return to centre.
    const rate = (target, cur) => (analog ? 25 : (target === 0 ? 12 : (Math.sign(target) !== Math.sign(cur) && cur !== 0 ? 16 : 7)));
    this.pitch = approach(this.pitch, tp, rate(tp, this.pitch), dt);
    this.roll = approach(this.roll, tr, rate(tr, this.roll), dt);
    this.yaw = approach(this.yaw, ty, rate(ty, this.yaw), dt);
    if (Math.abs(this.pitch) < 0.001) this.pitch = 0;
    if (Math.abs(this.roll) < 0.001) this.roll = 0;
    if (Math.abs(this.yaw) < 0.001) this.yaw = 0;

    this.throttle = clamp(this.throttle + clamp(thrDelta, -1, 1) * this.throttleRate * dt, 0, 1);
    this.boost = boost;
    this.brake = brake;
    this.action = action;
    this.action2 = action2;
  }

  // Clear one-shot edge flags after the game has read them.
  consumeEdges() {
    this.camToggle = false;
    this.pause = false;
    this._camLatch = false;
    this._pauseLatch = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}

export function createInput(domElement) {
  return new InputState(domElement);
}
