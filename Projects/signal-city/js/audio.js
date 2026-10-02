// Signal City: the sound (R7). Web Audio, every sound synthesized here, so
// nothing is vendored and nothing is fetched. The world never sees this file:
// the page hands it the world once a frame, before the renderer drains the
// world's events, and it plays what those events and the board's state ask
// for.
//
//   horn      a 'honk' event, voiced by the driver's archetype: the trucker's
//             low two-note air horn, the aggressive driver's short and
//             repeated. At most HORN_CAP in any second of wall time, so Rush
//             Hour's surge is a jam and not a noise; the rest are dropped
//   click     the relay in the cabinet, once for every box whose signal
//             changed stage or phase since the last frame (capped too)
//   siren     while an emergency vehicle is on the map: louder and higher as
//             it nears the box it is heading for, panned by its x across the
//             view. It starts when the ambulance spawns and stops when it
//             leaves
//   crash     a 'collision' event
//   chirp     the push-button: a 'call' (a button pressed) or a 'walk' (the
//             WALK coming up)
//   bed       a filtered noise whose level follows the cars on the map
//
// The context is made on the first input (`start`), never before: a page
// may not start audio on its own. `settings.sound` in the save is the mute
// switch, already there and defaulting to true (save.js fresh), so the key
// is unchanged. `played` is what was asked of the context, in order, for
// the suite (test/audio.mjs) to count against a stub.

export const HORN_CAP = 3;          // horns in any one second
export const CLICK_CAP = 6;         // relay clicks in any one second (a district has twelve boxes)
export const SIREN_NEAR = 30;       // metres from its box at which the siren is at full level
export const SIREN_FAR = 160;       // and at which it is at its quietest
export const BED_FULL = 40;         // cars on the map at which the traffic bed is at full level

// The horns: notes in Hz, each note's length, how many times the figure
// repeats, the gap between repeats, and the wave.
export const HORNS = {
  standard:   { notes: [415, 349], len: 0.32, times: 1, gap: 0, wave: 'square', gain: 0.10 },
  granny:     { notes: [523], len: 0.18, times: 1, gap: 0, wave: 'triangle', gain: 0.08 },
  aggressive: { notes: [466, 392], len: 0.09, times: 3, gap: 0.06, wave: 'sawtooth', gain: 0.09 },
  tourist:    { notes: [440], len: 0.4, times: 1, gap: 0, wave: 'square', gain: 0.08 },
  trucker:    { notes: [110, 147], len: 0.8, times: 1, gap: 0, wave: 'sawtooth', gain: 0.12 },
  student:    { notes: [494], len: 0.12, times: 2, gap: 0.1, wave: 'triangle', gain: 0.07 },
  rideshare:  { notes: [392, 330], len: 0.14, times: 2, gap: 0.05, wave: 'square', gain: 0.08 },
  motorcade:  { notes: [349, 294], len: 0.25, times: 1, gap: 0, wave: 'square', gain: 0.09 },
  procession: { notes: [262], len: 0.5, times: 1, gap: 0, wave: 'triangle', gain: 0.06 },
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Sound {
  // `Ctx` is the AudioContext constructor (a stub in the suite); `enabled`
  // is settings.sound.
  constructor({ Ctx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null, enabled = true } = {}) {
    this.Ctx = Ctx;
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.noise = null;      // one second of white noise, shared by the crash, the click and the bed
    this.siren = null;      // { car, osc, lfo, gain, pan } while one sounds
    this.bed = null;        // { src, gain }
    this.horns = [];        // wall times of the horns in the last second
    this.clicks = [];
    this.signals = new Map();   // controller -> 'stage|phase' at the last frame
    this.played = [];       // [{ kind, t, ... }] what was asked of the context
    this.dropped = 0;       // horns over the cap
  }

  // The first input: make the context (once) and resume it. Nothing plays
  // before this, and nothing is made while the switch is off.
  start() {
    if (!this.enabled || !this.Ctx) return false;
    if (!this.ctx) {
      this.ctx = new this.Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate || 44100;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 2147483648) - 1; }
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
    return true;
  }

  get live() { return !!(this.enabled && this.ctx); }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.quiet();
    else this.start();
  }

  // Everything continuous off: the select screen, a pause, the switch.
  quiet() {
    this.stopSiren(this.ctx ? this.ctx.currentTime : 0);
    if (this.bed) { try { this.bed.src.stop(); } catch (e) { /* already stopped */ } this.bed = null; }
    this.signals.clear();
  }

  // One frame of a running world. `now` is seconds of wall time (the caps
  // are a listener's seconds, not the world's, so 2x does not double the
  // honking); `view` is the world x at the board's left and right edges,
  // for the siren's pan.
  take(world, now, view = null) {
    if (!this.live) return;
    for (const e of world.events) {
      if (e.kind === 'honk') {
        const car = world.cars.find(c => c.id === e.car);
        this.horn(car ? car.archetype : 'standard', now);
      } else if (e.kind === 'collision') this.crash(now);
      else if (e.kind === 'call' || e.kind === 'walk') this.chirp(now, e.kind);
    }
    world.controllers.forEach((c, i) => {
      const sig = `${c.stage}|${c.phase}|${c.preemption ? 'P' : ''}`;
      const was = this.signals.get(i);
      this.signals.set(i, sig);
      if (was !== undefined && was !== sig && !c.roundabout) this.click(now);
    });
    this.followSiren(world, now, view);
    this.followBed(world);
  }

  // ---- the voices -----------------------------------------------------------

  horn(archetype, now) {
    this.horns = this.horns.filter(t => now - t < 1);
    if (this.horns.length >= HORN_CAP) { this.dropped++; return false; }
    this.horns.push(now);
    const h = HORNS[archetype] || HORNS.standard;
    const t0 = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.master);
    g.gain.setValueAtTime(0, t0);
    for (let k = 0; k < h.times; k++) {
      const a = t0 + k * (h.len + h.gap);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(h.gain, a + 0.01);
      g.gain.setValueAtTime(h.gain, a + h.len - 0.02);
      g.gain.linearRampToValueAtTime(0, a + h.len);
    }
    const end = t0 + h.times * (h.len + h.gap);
    for (const f of h.notes) {
      const o = this.ctx.createOscillator();
      o.type = h.wave;
      o.frequency.value = f;
      o.connect(g);
      o.start(t0);
      o.stop(end);
    }
    this.played.push({ kind: 'horn', t: now, archetype });
    return true;
  }

  click(now) {
    this.clicks = this.clicks.filter(t => now - t < 1);
    if (this.clicks.length >= CLICK_CAP) return false;
    this.clicks.push(now);
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t0, (this.clicks.length * 0.137) % 0.5);   // a different stretch of the noise each time, without Math.random
    src.stop(t0 + 0.04);
    this.played.push({ kind: 'click', t: now });
    return true;
  }

  crash(now) {
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t0);
    lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.75);
    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, t0);
    thud.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.6, t0);
    tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    thud.connect(tg); tg.connect(this.master);
    thud.start(t0);
    thud.stop(t0 + 0.32);
    this.played.push({ kind: 'crash', t: now });
  }

  // The accessible push-button's chirp: two quick falling sweeps.
  chirp(now, why) {
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    for (let k = 0; k < 2; k++) {
      const a = t0 + k * 0.09;
      o.frequency.setValueAtTime(3200, a);
      o.frequency.exponentialRampToValueAtTime(1800, a + 0.05);
      g.gain.setValueAtTime(0.07, a);
      g.gain.exponentialRampToValueAtTime(0.001, a + 0.06);
    }
    o.connect(g); g.connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.2);
    this.played.push({ kind: 'chirp', t: now, why });
  }

  // The siren follows the first emergency vehicle on the map. Its level
  // and pitch climb as the car closes on the box it is heading for; its
  // pan is the car's x across the view.
  followSiren(world, now, view) {
    const car = world.cars.find(c => !c.done && c.archetype === 'emergency');
    if (!car) { if (this.siren) this.stopSiren(now); return; }
    if (this.siren && this.siren.car !== car.id) this.stopSiren(now);
    if (!this.siren) this.startSiren(car, now);
    const p = car.path.at(car.s);
    const node = world.nodes[car.path.node] || world.nodes[0];
    const d = Math.hypot(p.x - node.origin[0], p.y - node.origin[1]);
    const near = 1 - clamp((d - SIREN_NEAR) / (SIREN_FAR - SIREN_NEAR), 0, 1);
    const pan = view && view.x1 > view.x0 ? clamp(((p.x - view.x0) / (view.x1 - view.x0)) * 2 - 1, -1, 1) : 0;
    const s = this.siren, t0 = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(0.03 + 0.12 * near, t0, 0.1);
    s.osc.frequency.setTargetAtTime(700 + 160 * near, t0, 0.1);
    if (s.pan) s.pan.pan.setTargetAtTime(pan, t0, 0.1);
    s.near = near; s.panAt = pan;
  }

  startSiren(car, now) {
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 700;
    // the wail: a slow LFO on the pitch
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.35;
    const depth = this.ctx.createGain();
    depth.gain.value = 260;
    lfo.connect(depth); depth.connect(osc.frequency);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    osc.connect(lp); lp.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
    osc.start(t0); lfo.start(t0);
    this.siren = { car: car.id, osc, lfo, gain, pan, near: 0, panAt: 0 };
    this.played.push({ kind: 'siren-start', t: now, car: car.id });
  }

  stopSiren(now) {
    if (!this.siren) return;
    const s = this.siren;
    this.siren = null;
    const t0 = this.ctx ? this.ctx.currentTime : 0;
    try { s.gain.gain.setTargetAtTime(0, t0, 0.05); s.osc.stop(t0 + 0.3); s.lfo.stop(t0 + 0.3); } catch (e) { /* already stopped */ }
    this.played.push({ kind: 'siren-stop', t: now, car: s.car });
  }

  followBed(world) {
    if (!this.bed) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(lp); lp.connect(gain); gain.connect(this.master);
      src.start(this.ctx.currentTime);
      this.bed = { src, gain, level: 0 };
      this.played.push({ kind: 'bed', t: 0 });
    }
    let n = 0;
    for (const c of world.cars) if (!c.done) n++;
    const level = 0.12 * Math.min(1, n / BED_FULL);
    this.bed.level = level;
    this.bed.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.5);
  }
}
