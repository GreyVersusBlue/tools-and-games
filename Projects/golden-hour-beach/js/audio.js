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
    // Night layers (set every frame by main.js from the palette's nightT).
    this._nightT = 0;
    this._cricketTimer = 2;
    this._owlTimer = 70;
    // Campfire (proximity 0..1, set every frame by main.js).
    this._fireProx = 0;
    this._crackleTimer = 0;
    // Set by main.js. Fired on the same phase counter that triggers the
    // footstep sound, so footprints land in step with the sound that already
    // exists rather than carrying a second counter of their own.
    this.onFootstep = null;
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
    this.bedFilt = bedFilt;
    this.bedGain = bedGain;

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
    this.windGain = gain;
    wind.connect(filt).connect(gain).connect(this.master);
    // slow wander
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filt.frequency);
    lfo.start();
  }

  // called every frame; swash 0..1 from the ocean sim, moving = walking,
  // wadeT 0..1 = how close to the knee-depth wading limit controls.js has let
  // the walker go (0 on dry sand)
  update(dt, swash, moving, wadeT = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Ocean wash follows the visual wave (louder + brighter at run-up) and now
    // also the walker wading in — standing in the water should sound different
    // from standing on the sand watching it, not just look different.
    const target = 0.03 + Math.pow(swash, 1.6) * 0.22 + wadeT * 0.18;
    this.washGain.gain.setTargetAtTime(target, t, 0.25);
    this.washFilt.frequency.setTargetAtTime(900 + swash * 1300 + wadeT * 500, t, 0.3);

    // Gull cries — gulls roost as real dusk sets in, so the cries thin out and
    // stop rather than carrying on over a starfield.
    if (this._nightT < 0.5) {
      this._gullTimer -= dt;
      if (this._gullTimer <= 0) {
        this._gullTimer = (5 + Math.random() * 14) * (1 + this._nightT * 3);
        this._gullCry();
      }
    }

    // Crickets take over from the gulls. Chirp trains from random stereo spots,
    // starting sparse at dusk and settling into the steady night bed.
    if (this._nightT > 0.4) {
      this._cricketTimer -= dt;
      if (this._cricketTimer <= 0) {
        this._cricketTimer = 0.9 + Math.random() * (3.5 - this._nightT * 2);
        this._cricketChirp();
      }
    }

    // One owl, far off, rarely. The night's landmark sound.
    if (this._nightT > 0.85) {
      this._owlTimer -= dt;
      if (this._owlTimer <= 0) {
        this._owlTimer = 60 + Math.random() * 80;
        this._owlHoot();
      }
    }

    // Wind eases off after dark — the day's onshore breeze lying down.
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0.05 * (1 - this._nightT * 0.55), t, 0.5);
    }

    // Surf on rocks (the headland) is deeper and heavier than surf on sand.
    if (this.bedFilt) {
      const mix = this._headlandMix || 0;
      this.bedFilt.frequency.setTargetAtTime(420 - mix * 150, t, 0.8);
      this.bedGain.gain.setTargetAtTime(0.16 + mix * 0.06, t, 0.8);
    }

    // Campfire crackle: sparse filtered pops, rate and level scaled by how close
    // the walker is standing. The low fire rumble is a lazy-built bed.
    if (this._fireProx > 0.02) {
      if (!this._fireBed) this._startFireBed();
      this._crackleTimer -= dt;
      if (this._crackleTimer <= 0) {
        this._crackleTimer = 0.05 + Math.random() * 0.3;
        this._cracklePop();
      }
    }
    if (this._fireBed) {
      this._fireBed.gain.setTargetAtTime(this._fireProx * 0.05, t, 0.3);
    }

    // Footsteps
    if (moving) {
      this._stepPhase += dt * 2.1;
      if (this._stepPhase >= 1) {
        this._stepPhase = 0;
        this._footstep();
        this.onFootstep?.();
      }
    } else {
      this._stepPhase = 0.7;
    }
  }

  // vol: per-cry peak. panSpread: how far off-centre the cry may sit — the
  // squabble on the sand in front of you is loud and centred, the wheeling
  // cries overhead are quiet and anywhere.
  _gullCry(vol = 0.035, panSpread = 0.8) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 0;
    if (pan) { pan.pan.value = (Math.random() * 2 - 1) * panSpread; out.connect(pan).connect(this.master); }
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
      g.gain.linearRampToValueAtTime(vol + Math.random() * vol * 0.6, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = f0; filt.Q.value = 2.5;
      osc.connect(filt).connect(g).connect(out);
      osc.start(start); osc.stop(start + 0.35);
    }
    out.gain.setValueAtTime(1, t0);
  }

  // main.js writes these once per frame from the single palette writer, so the
  // soundscape can never disagree with the sky about what time it is.
  setNight(nightT) { this._nightT = nightT; }
  setFire(proximity) { this._fireProx = proximity; }

  _cricketChirp() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = 1;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); }
    else out.connect(this.master);
    const f = 4100 + Math.random() * 500;
    const pulses = 4 + (Math.random() * 4 | 0);
    const vol = (0.006 + Math.random() * 0.006) * this._nightT;
    for (let i = 0; i < pulses; i++) {
      const start = t0 + i * 0.055;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
      osc.connect(g).connect(out);
      osc.start(start); osc.stop(start + 0.05);
    }
  }

  _owlHoot() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = 1;
    if (pan) { pan.pan.value = Math.random() < 0.5 ? -0.6 : 0.6; out.connect(pan).connect(this.master); }
    else out.connect(this.master);
    // Two notes, hoo-HOOO, each a soft sine pair with a breathy attack.
    const notes = [[370, 0, 0.28], [330, 0.42, 0.55]];
    for (const [f, off, dur] of notes) {
      const start = t0 + off;
      for (const mult of [1, 0.5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f * mult, start);
        osc.frequency.linearRampToValueAtTime(f * mult * 0.93, start + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(mult === 1 ? 0.028 : 0.012, start + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0005, start + dur);
        osc.connect(g).connect(out);
        osc.start(start); osc.stop(start + dur + 0.05);
      }
    }
  }

  // Squabbling gulls on the sand right in front of you: louder, centred.
  squabble() {
    if (!this.ctx) return;
    this._gullCry(0.05, 0.3);
  }

  // Sanderling contact peeps: a quick run of very high, very short chirps.
  peep(pan = 0, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 1;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const start = t0 + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = 3400 + Math.random() * 600;
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * 1.25, start + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.014 * vol, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0003, start + 0.06);
      osc.connect(g).connect(out);
      osc.start(start); osc.stop(start + 0.08);
    }
  }

  // One low pelican croak — half frog, half door.
  croak(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 1;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.linearRampToValueAtTime(88, t0 + 0.3);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.03, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.35);
    osc.connect(filt).connect(g).connect(out);
    osc.start(t0); osc.stop(t0 + 0.4);
  }

  // A seal's bark: two rough pulses through a vowel-ish bandpass.
  bark(pan = 0, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 1;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    for (let i = 0; i < 2; i++) {
      const start = t0 + i * 0.28;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150 + Math.random() * 30, start);
      osc.frequency.exponentialRampToValueAtTime(95, start + 0.18);
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 620; filt.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.045 * vol, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, start + 0.22);
      osc.connect(filt).connect(g).connect(out);
      osc.start(start); osc.stop(start + 0.26);
    }
  }

  // The soundscape's sense of place: 0..1 how "headland" it is here. Surf on
  // rocks is deeper and heavier than surf on sand — the bed filter opens down
  // and the bed gain leans in as the weights shift. One writer per frame, from
  // main.js, off field.js's regionWeights.
  setRegionMix(headland) {
    this._headlandMix = headland;
  }

  // A stone touching water on its way past — a bright little tap, panned to
  // where it happened. Higher and quieter as the skips die off (the caller
  // passes vol down each skip).
  plink(pan = 0, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 1;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(this.master); }
    else out.connect(this.master);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 900 + Math.random() * 300 + (1 - vol) * 500;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05 * vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
    osc.connect(g).connect(out);
    osc.start(t0); osc.stop(t0 + 0.15);
    // and the smallest splash under it
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 2400; filt.Q.value = 1;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t0);
    g2.gain.linearRampToValueAtTime(0.02 * vol, t0 + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.09);
    src.connect(filt).connect(g2).connect(out);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.1);
  }

  // A stone coming down on sand instead: dull, low, done.
  thud() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    src.playbackRate.value = 0.5;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.14);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.16);
  }

  _startFireBed() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 180; filt.Q.value = 0.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(this.master);
    this._fireBed = gain;
  }

  _cracklePop() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    src.playbackRate.value = 1.5 + Math.random() * 1.5;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1400 + Math.random() * 2600;
    filt.Q.value = 1.5;
    const g = ctx.createGain();
    const vol = (0.015 + Math.random() * 0.035) * this._fireProx;
    const dur = 0.02 + Math.random() * 0.05;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + dur + 0.02);
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
