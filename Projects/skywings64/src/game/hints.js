// First-flight tutorial + contextual flight hints, shown in a small banner above the HUD's bottom edge.
// Each vehicle's intro sequence plays until that vehicle has completed one flight (localStorage);
// contextual hints (stall, thermal, low fuel, landing approach...) show at most once per mission attempt.
const KEY = 'skywings64.tutorial.v1';

function loadSeen() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveSeen(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

// kb = keyboard/gamepad wording, tc = touch wording
const T = {
  hangGlider: {
    launch: { kb: 'Press SPACE (or push W) to run off the launch ramp', tc: 'Tap LAUNCH to run off the ramp' },
    steer: { kb: 'A / D bank to turn  ·  W dives for speed, S slows you down', tc: 'Tilt the stick to bank and pitch' },
    stall: { kb: 'Stalling! Push W to lower the nose and regain speed', tc: 'Stalling! Push the stick forward' },
    thermal: { kb: 'Rising air! Circle tightly inside the thermal to climb', tc: 'Rising air! Circle inside the thermal to climb' },
    approach: { kb: 'Line up with the pad and hold S just before touchdown to flare', tc: 'Line up with the pad; pull back just before touchdown' },
    high: { kb: 'Too high for the pad: hold X (air brake) and circle down', tc: 'Too high for the pad: hold BRAKE and circle down' },
  },
  gyrocopter: {
    launch: { kb: 'Hold SHIFT (or R) to spool up the rotor and lift off', tc: 'Hold THR+ to spool up the rotor' },
    steer: { kb: 'W / S tilt forward / back  ·  A / D bank  ·  Q / E yaw', tc: 'Stick tilts and banks  ·  THR+/THR- climb and descend' },
    bomb: { kb: 'Fly over a red target and press SPACE to drop a bomb', tc: 'Fly over a red target and tap BOMB' },
    approach: { kb: 'Slow down over the pad, then ease off with CTRL (or F) to land', tc: 'Slow down over the pad, then hold THR- to land' },
  },
  rocketBelt: {
    launch: { kb: 'Hold SHIFT (or R) for thrust  ·  SPACE gives a quick burst', tc: 'Hold THR+ for thrust' },
    steer: { kb: 'W / S / A / D lean to move  ·  Q / E turn  ·  fuel is limited!', tc: 'Stick leans you around  ·  watch the fuel gauge' },
    fuel: { kb: 'Fuel low! Head for the landing pad', tc: 'Fuel low! Head for the landing pad' },
    approach: { kb: 'Hover over the pad and throttle down gently (CTRL / F)', tc: 'Hover over the pad and hold THR- gently' },
  },
};

export class FlightHints {
  constructor() {
    this.el = null;
    this.seen = loadSeen();
    this.shown = new Set();
    this.queue = [];
    this.cur = null; this.curT = 0;
    this.key = null; this.touch = false;
    this.t = 0;
  }

  _ensure() {
    if (this.el || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'sw-hint';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translate(-50%,10px);max-width:min(92vw,720px);padding:10px 18px;'
      + 'border-radius:14px;background:rgba(8,20,40,.72);border:1px solid rgba(160,210,255,.35);color:#fff;text-align:center;'
      + "font:600 17px/1.3 'Rajdhani',sans-serif;letter-spacing:1px;text-shadow:0 2px 4px rgba(0,0,0,.6);pointer-events:none;"
      + 'opacity:0;transition:opacity .35s,transform .35s;z-index:12';
    document.body.appendChild(el);
    this.el = el;
  }

  // Call when a flight begins.
  start(vehicleKey, opts = {}) {
    this.key = vehicleKey; this.touch = !!opts.touch; this.t = 0;
    this.shown.clear(); this.queue.length = 0; this.cur = null;
    this.firstFlight = !this.seen[vehicleKey];
    this.bombs = !!opts.bombs;
    this._hide();
    this.push('launch', 0.6);
  }

  stop() { this.queue.length = 0; this.cur = null; this._hide(); }

  // Mark the tutorial done for this vehicle (call on any completed flight).
  complete() { if (this.key && !this.seen[this.key]) { this.seen[this.key] = 1; saveSeen(this.seen); } }

  // id: hint key; delay: seconds before showing; force: show even after the first flight
  push(id, delay = 0, force = false) {
    if (this.shown.has(id)) return;
    const intro = id === 'launch' || id === 'steer' || id === 'bomb';
    if (intro && !this.firstFlight && !force) return;
    const tx = T[this.key] && T[this.key][id];
    if (!tx) return;
    this.shown.add(id);
    this.queue.push({ text: this.touch ? tx.tc : tx.kb, delay, dur: 4.2 });
  }

  // ctx: {vehicle, course, events:[vehicle event names this frame]}
  update(dt, ctx) {
    this.t += dt;
    const v = ctx.vehicle, c = ctx.course;
    if (v) {
      if (v.state === 'flying' && this.t > 1) this.push('steer', 1.2);
      if (this.bombs && v.state === 'flying' && this.t > 6) this.push('bomb', 0.5);
      for (const e of ctx.events || []) {
        if (e === 'stall') this.push('stall', 0, true);
        if (e === 'thermal') this.push('thermal', 0, true);
      }
      if (this.key === 'rocketBelt' && v.fuel != null && v.fuel < 0.3 && v.state === 'flying') this.push('fuel', 0, true);
      // grounded glider that never launched: nudge again
      if (this.key === 'hangGlider' && v.state === 'grounded' && this.t > 8 && !this.shown.has('launch2')) {
        this.shown.add('launch2'); const tx = T.hangGlider.launch; this.queue.push({ text: this.touch ? tx.tc : tx.kb, delay: 0, dur: 4 });
      }
      if (c && c.landing && !(c.openRing && c.openRing()) && !(c.targets && c.targets.length && c.aliveTargets > 0) && v.state === 'flying') {
        const d = Math.hypot(v.position.x - c.landing.position.x, v.position.z - c.landing.position.z);
        if (d < 220) this.push('approach', 0, this.firstFlight);
        if (this.key === 'hangGlider' && d < 300 && (v.altitude || 0) > d * 0.45 + 40) this.push('high', 0, true);
      }
    }
    // playback
    if (this.cur) {
      this.curT += dt;
      if (this.curT > this.cur.dur) { this.cur = null; this._hide(); }
      return;
    }
    const n = this.queue[0];
    if (n) {
      n.delay -= dt;
      if (n.delay <= 0) { this.queue.shift(); this.cur = n; this.curT = 0; this._show(n.text); }
    }
  }

  _show(text) {
    this._ensure(); if (!this.el) return;
    this.el.textContent = text;
    this.el.style.opacity = '1'; this.el.style.transform = 'translate(-50%,0)';
  }
  _hide() { if (this.el) { this.el.style.opacity = '0'; this.el.style.transform = 'translate(-50%,10px)'; } }
}
