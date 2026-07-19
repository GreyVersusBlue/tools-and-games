// All-procedural Web Audio soundscape — no external files, loops forever.
//   • Ocean: two filtered-noise layers; the "wash" layer swells in sync
//     with the visual swash cycle passed in from the ocean sim.
//   • Wind: faint band-passed noise with slow wander.
//   • Gulls: synthesized descending cries at random intervals.
//   • Footsteps: soft sand scuffs while walking.
//   • Plane: low rumble that pans and swells across the flyover.
//   • Splash: short noise burst for dolphin entries.
//
// To swap in a real recording later: replace startOcean() with an
// <audio loop> element or fetch+decodeAudioData of your file, and keep
// the rest as-is.

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this._gullTimer = 4;
    this._stepPhase = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this._noiseBuf = this._makeNoise(4);
    this._startOcean();
    this._startWind();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      lp = lp * 0.86 + w * 0.14;      // pre-soften: pinkish
      d[i] = lp * 2.4;
    }
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.start();
    return src;
  }

  _startOcean() {
    const ctx = this.ctx;
    // Bed: constant deep surf
    const bed = this._noiseSource();
    const bedFilt = ctx.createBiquadFilter();
    bedFilt.type = 'lowpass'; bedFilt.frequency.value = 420; bedFilt.Q.value = 0.4;
    const bedGain = ctx.createGain(); bedGain.gain.value = 0.16;
    bed.connect(bedFilt).connect(bedGain).connect(this.master);

    // Wash: brighter layer that swells with each slap
    const wash = this._noiseSource();
    const washFilt = ctx.createBiquadFilter();
    washFilt.type = 'bandpass'; washFilt.frequency.value = 1400; washFilt.Q.value = 0.5;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0.0;
    wash.connect(washFilt).connect(this.washGain).connect(this.master);
    this.washFilt = washFilt;
  }

  _startWind() {
    const ctx = this.ctx;
    const wind = this._noiseSource();
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 300; filt.Q.value = 1.2;
    const gain = ctx.createGain(); gain.gain.value = 0.05;
    wind.connect(filt).connect(gain).connect(this.master);
    // slow wander
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filt.frequency);
    lfo.start();
  }

  // called every frame; swash 0..1 from the ocean sim, moving = walking
  update(dt, swash, moving) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Ocean wash follows the visual wave: louder + brighter at run-up
    const target = 0.03 + Math.pow(swash, 1.6) * 0.22;
    this.washGain.gain.setTargetAtTime(target, t, 0.25);
    this.washFilt.frequency.setTargetAtTime(900 + swash * 1300, t, 0.3);

    // Gull cries
    this._gullTimer -= dt;
    if (this._gullTimer <= 0) {
      this._gullTimer = 5 + Math.random() * 14;
      this._gullCry();
    }

    // Footsteps
    if (moving) {
      this._stepPhase += dt * 2.1;
      if (this._stepPhase >= 1) {
        this._stepPhase = 0;
        this._footstep();
      }
    } else {
      this._stepPhase = 0.7;
    }
  }

  _gullCry() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 0;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); }
    else out.connect(this.master);

    const cries = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < cries; i++) {
      const start = t0 + i * (0.32 + Math.random() * 0.1);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f0 = 950 + Math.random() * 350;
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, start + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.035 + Math.random() * 0.02, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = f0; filt.Q.value = 2.5;
      osc.connect(filt).connect(g).connect(out);
      osc.start(start); osc.stop(start + 0.35);
    }
    out.gain.setValueAtTime(1, t0);
  }

  _footstep() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.2;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 700 + Math.random() * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.2);
  }

  splash(vol = 0.15) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 1800; filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * 0.25, t0 + 0.05);  // distant → quiet
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.7);
  }

  startPlane() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this._planeSrc = ctx.createBufferSource();
    this._planeSrc.buffer = this._noiseBuf; this._planeSrc.loop = true;
    this._planeFilt = ctx.createBiquadFilter();
    this._planeFilt.type = 'lowpass'; this._planeFilt.frequency.value = 160; this._planeFilt.Q.value = 0.6;
    this._planeGain = ctx.createGain(); this._planeGain.gain.value = 0;
    this._planePan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this._planePan) this._planeSrc.connect(this._planeFilt).connect(this._planeGain).connect(this._planePan).connect(this.master);
    else this._planeSrc.connect(this._planeFilt).connect(this._planeGain).connect(this.master);
    this._planeSrc.start();
  }

  updatePlane(p, planePos, camPos) {
    if (!this.ctx || !this._planeGain) return;
    const t = this.ctx.currentTime;
    // loudness peaks mid-flight (closest approach), gentle attack/decay
    const env = Math.pow(Math.sin(Math.PI * p), 2.2);
    this._planeGain.gain.setTargetAtTime(env * 0.12, t, 0.4);
    // brighter when overhead, duller at horizon
    this._planeFilt.frequency.setTargetAtTime(90 + env * 220, t, 0.5);
    if (this._planePan) {
      const rel = Math.max(-1, Math.min(1, (planePos.x - camPos.x) / 300));
      this._planePan.pan.setTargetAtTime(rel, t, 0.3);
    }
  }

  stopPlane() {
    if (!this._planeSrc) return;
    const t = this.ctx.currentTime;
    this._planeGain.gain.setTargetAtTime(0, t, 0.5);
    const src = this._planeSrc;
    setTimeout(() => { try { src.stop(); } catch (e) {} }, 2500);
    this._planeSrc = null;
  }
}
