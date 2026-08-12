// All-procedural Web Audio soundscape — no external files, loops forever.
//   • Wind: band-passed noise bed that swells with altitude and gusts; a
//     second high-passed layer is the canopy answering the gusts, which is
//     most of what "forest" sounds like.
//   • The fog is audible: a master lowpass closes down as the fog thickens,
//     so the whole world sounds nearer and woollier in the murk.
//   • Birds: three synthesized voices, calling less as the fog closes in,
//     and not at all while the dread system holds them silent.
//   • Footsteps: timbre follows surfaceAt — dirt, undergrowth (with the odd
//     twig), bridge planks, bare rock, creek splash.
//   • Creek and waterfall: looped filtered noise, gained by distance.
//   • Stingers for the wildlife and dread systems: owl, elk, wolf, crow,
//     snapped branch, phantom footsteps, the cairn chime, the low sting.
//   • Music: a drone in D minor that surfaces out of the wind half a minute
//     in and never quite sits still, plus a lonely horn phrase every couple
//     of minutes that always falls back down to the root. The fog thickens
//     the drone, the altitude sours it — a minor 2nd starts beating against
//     the root above the fog line, and a tritone joins near the summit.
//     Foreboding, not haunted house: nothing stabs, everything leans.
//
// The class shape is Golden Hour's Soundscape; the instruments are new.

// The motif engine's pitch tables, D3 to D4. Above the fog line the scale
// turns phrygian — E gives way to E♭, and every phrase that falls through the
// second degree lands a semitone too close to home.
const MOTIF_SCALE = [146.83, 164.81, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66];
const MOTIF_SCALE_HIGH = [146.83, 155.56, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66];
const MOTIF_ROOT = 146.83;      // D3 — where phrases go to die
const MOTIF_FLOOR = 110.0;      // A2 — where the saddest ones go

/**
 * One phrase of foreboding woe: 3-5 notes, biased downhill, always ending on
 * the root or the fifth below it. Pure — rand in, [{freq, dur}] out — so the
 * smoke suite can hold it to the scale without an AudioContext.
 */
export function motifPhrase(rand, altT) {
  const scale = altT > 0.5 ? MOTIF_SCALE_HIGH : MOTIF_SCALE;
  const count = 3 + Math.floor(rand() * 3);
  let idx = 2 + Math.floor(rand() * 4);        // start mid-scale, F3..B♭3
  const notes = [];
  for (let i = 0; i < count - 1; i++) {
    notes.push({ freq: scale[idx], dur: 1.4 + rand() * 1.2 });
    const r = rand();                           // mostly down, sometimes a lift
    idx += r < 0.4 ? -1 : r < 0.75 ? -2 : 1;
    idx = Math.max(0, Math.min(scale.length - 1, idx));
  }
  notes.push({
    freq: rand() < 0.65 ? MOTIF_ROOT : MOTIF_FLOOR,
    dur: (1.4 + rand() * 1.2) * 1.8,
  });
  return notes;
}

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this._birdTimer = 6;
    this._stepPhase = 0;
    this._gust = 0;
    this._gustTarget = 0;
    this._gustTimer = 3;
    this.onFootstep = null;
    this._motifTimer = 90;       // the first phrase waits out the fade-in
    this._duckTimer = 0;
    this._duckHeld = false;
    this._musicStart = 0;
    this._musicInfo = null;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // The fog filter: everything the walker hears passes through this.
    this._fogFilter = ctx.createBiquadFilter();
    this._fogFilter.type = 'lowpass';
    this._fogFilter.frequency.value = 12000;
    this._fogFilter.Q.value = 0.3;
    this.master.connect(this._fogFilter).connect(ctx.destination);
    this._noiseBuf = this._makeNoise(4);
    this._startWind();
    this._startWater();
    this._startMusic();
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

  _startWind() {
    const ctx = this.ctx;
    const bed = this._noiseSource();
    const bedFilt = ctx.createBiquadFilter();
    bedFilt.type = 'bandpass'; bedFilt.frequency.value = 240; bedFilt.Q.value = 0.8;
    this._windGain = ctx.createGain(); this._windGain.gain.value = 0.05;
    bed.connect(bedFilt).connect(this._windGain).connect(this.master);
    this._windFilt = bedFilt;

    // Canopy: thousands of needles answering the same gust.
    const canopy = this._noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200; hp.Q.value = 0.4;
    this._canopyGain = ctx.createGain(); this._canopyGain.gain.value = 0;
    canopy.connect(hp).connect(this._canopyGain).connect(this.master);
  }

  _startWater() {
    const ctx = this.ctx;
    const creek = this._noiseSource();
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass'; cf.frequency.value = 1100; cf.Q.value = 0.6;
    this._creekGain = ctx.createGain(); this._creekGain.gain.value = 0;
    creek.connect(cf).connect(this._creekGain).connect(this.master);

    const fall = this._noiseSource();
    const ff = ctx.createBiquadFilter();
    ff.type = 'lowpass'; ff.frequency.value = 320; ff.Q.value = 0.5;
    this._fallGain = ctx.createGain(); this._fallGain.gain.value = 0;
    fall.connect(ff).connect(this._fallGain).connect(this.master);
  }

  /* ---------------------------------------------------------------- music */

  _startMusic() {
    const ctx = this.ctx, t0 = ctx.currentTime;

    // Two gains between the music and the master: the duck, which the dread
    // stingers pull down so they land on silence instead of harmony, and the
    // bus, a 35-second fade from the first click — the drone surfaces out of
    // the wind rather than arriving with it.
    this._musicBus = ctx.createGain();
    this._musicBus.gain.setValueAtTime(0.0001, t0);
    this._musicBus.gain.linearRampToValueAtTime(1, t0 + 35);
    this._musicDuck = ctx.createGain();
    this._musicDuck.gain.value = 1;
    this._musicDuck.connect(this._musicBus).connect(this.master);
    this._musicStart = t0;

    // The drone: eight oscillators in D minor, none of them loud enough to
    // notice alone. Detuned pairs on the root and fifth throb at a tenth of
    // a hertz; the E♭ against the root beats at 4.4 Hz once the walker is
    // above the fog line, which is the altitude turning into a feeling.
    this._droneFilter = ctx.createBiquadFilter();
    this._droneFilter.type = 'lowpass';
    this._droneFilter.frequency.value = 900;
    this._droneFilter.Q.value = 0.7;
    this._droneGain = ctx.createGain();
    this._droneGain.gain.value = 1;
    this._droneFilter.connect(this._droneGain).connect(this._musicDuck);

    this._drone = {};
    const voice = (name, freq, type, cents = 0) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(this._droneFilter);
      osc.start();
      this._drone[name] = g;
    };
    voice('d2a', 73.42, 'sine', -3);      // the floor, always on
    voice('d2b', 73.42, 'triangle', 3);
    voice('a2a', 110.0, 'sawtooth', -4);  // the fifth, thickening with fog
    voice('a2b', 110.0, 'sawtooth', 4);
    voice('d3', 146.83, 'triangle');      // body for the murk
    voice('f3', 174.61, 'sine', 2);       // the minor 3rd, said out loud
    voice('eb2', 77.78, 'sine');          // minor 2nd — the altitude unease
    voice('ab2', 103.83, 'sine');         // the tritone, saved for the summit

    // The filter never sits still, and the whole bed breathes — two LFOs so
    // slow they read as weather, not tremolo.
    const wander = ctx.createOscillator();
    wander.frequency.value = 0.03;
    const wanderAmt = ctx.createGain();
    wanderAmt.gain.value = 120;
    wander.connect(wanderAmt).connect(this._droneFilter.frequency);
    wander.start();
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.05;
    const breathAmt = ctx.createGain();
    breathAmt.gain.value = 0.12;
    breath.connect(breathAmt).connect(this._droneGain.gain);
    breath.start();
  }

  /** Dread pulls the music down to a fifth of itself; it climbs back slowly. */
  _duckMusic(seconds) {
    if (!this._musicDuck) return;
    this._duckTimer = Math.max(this._duckTimer, seconds);
    this._musicDuck.gain.setTargetAtTime(0.15, this.ctx.currentTime, 0.4);
  }

  /** One phrase — a horn a long way off, bowed noise on top, sent down the
   *  same cheap valley the wolf uses. */
  _motif(altT) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.1;
    const notes = motifPhrase(Math.random, altT);

    const out = ctx.createGain();
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    out.connect(delay); delay.connect(wet);
    const pan = this._pan(0.5);
    const sink = pan || this._musicDuck;
    out.connect(sink); wet.connect(sink);
    if (pan) pan.connect(this._musicDuck);

    // The bow: one narrow band of noise retuned note to note, breath on brass.
    const bow = this._noiseSource();
    const bowF = ctx.createBiquadFilter();
    bowF.type = 'bandpass'; bowF.Q.value = 30;
    bowF.frequency.value = notes[0].freq;
    const bowG = ctx.createGain(); bowG.gain.value = 0;
    bow.connect(bowF).connect(bowG).connect(out);
    bowG.gain.setValueAtTime(0, t0);
    bowG.gain.linearRampToValueAtTime(0.006, t0 + 1.2);

    let st = t0, lastRel = 0;
    for (const n of notes) {
      const attack = n.dur * 0.4;                 // a bow drawn, not a key hit
      const rel = 2.5 + Math.random();
      for (const cents of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = n.freq;
        osc.detune.value = cents;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 720; f.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(0.02, st + attack);
        g.gain.setValueAtTime(0.02, st + n.dur);
        g.gain.exponentialRampToValueAtTime(0.001, st + n.dur + rel);
        osc.connect(f).connect(g).connect(out);
        osc.start(st); osc.stop(st + n.dur + rel + 0.1);
      }
      bowF.frequency.setTargetAtTime(n.freq, st, 0.3);
      st += n.dur;
      lastRel = rel;
    }
    bowG.gain.setTargetAtTime(0, st, 1.5);
    bow.stop(st + lastRel + 4);
  }

  /** Read-only targets for the debug hook and the browser suite. */
  musicState() { return this._musicInfo; }

  /**
   * Called every frame.
   * state: { moving, surface, fogT, altT, creekDist, waterfallDist,
   *          birdsSilent, watched }
   */
  update(dt, state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const { moving, surface, fogT, altT, creekDist, waterfallDist, birdsSilent, watched } = state;

    // The fog closes the world's top end down.
    this._fogFilter.frequency.setTargetAtTime(12000 - fogT * 9200, t, 0.8);

    // Gusts: pick a new target every so often, ease toward it.
    this._gustTimer -= dt;
    if (this._gustTimer <= 0) {
      this._gustTimer = 8 + Math.random() * 12;
      this._gustTarget = Math.random() * Math.random();  // mostly small, sometimes big
    }
    this._gust += (this._gustTarget - this._gust) * Math.min(1, dt * 0.35);

    const wind = 0.035 + altT * 0.1 + this._gust * 0.07 - fogT * 0.012;
    this._windGain.gain.setTargetAtTime(Math.max(0.02, wind), t, 0.4);
    this._windFilt.frequency.setTargetAtTime(220 + this._gust * 160 + altT * 120, t, 0.5);
    this._canopyGain.gain.setTargetAtTime(this._gust * this._gust * 0.075, t, 0.3);

    // Water by distance.
    const creekNear = Math.max(0, 1 - (isFinite(creekDist) ? creekDist : 999) / 40);
    this._creekGain.gain.setTargetAtTime(creekNear * creekNear * 0.17, t, 0.4);
    const fallNear = Math.max(0, 1 - waterfallDist / 55);
    this._fallGain.gain.setTargetAtTime(fallNear * fallNear * 0.24, t, 0.4);

    // Birdsong thins as the fog thickens, stops when the woods hold their
    // breath, and gives way to nothing at all up in the summit air.
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 5 + fogT * 18 + Math.random() * 8;
      if (!birdsSilent && altT < 0.6) this._birdCall();
    }

    // Footsteps.
    if (moving) {
      this._stepPhase += dt * 2.05;
      if (this._stepPhase >= 1) {
        this._stepPhase = 0;
        this._footstep(surface);
        this.onFootstep?.();
      }
    } else {
      this._stepPhase = 0.7;
    }

    // The drone follows the weather the way the lights do: fog thickens it
    // and darkens it, altitude sours it. Being watched from the lookout
    // leans on the tritone and closes the filter a little further — tension
    // out of voices already running, not a stinger.
    const dr = this._drone;
    const set = (g, v, tau = 2) => g.gain.setTargetAtTime(v, t, tau);
    const d2 = 0.045 + fogT * 0.012;
    set(dr.d2a, d2 * 0.6, 2.5); set(dr.d2b, d2 * 0.4, 2.5);
    const a2 = 0.01 + fogT * 0.018;
    set(dr.a2a, a2 * 0.5, 2.5); set(dr.a2b, a2 * 0.5, 2.5);
    set(dr.d3, fogT * 0.014, 3);
    set(dr.f3, 0.006 + fogT * 0.01, 3);
    set(dr.eb2, altT * altT * 0.03, 2);
    const tritone = Math.max(0, (altT - 0.55) / 0.45) * 0.018 * (watched ? 1.6 : 1);
    set(dr.ab2, tritone, 1.5);
    const droneHz = 900 - fogT * 420 - altT * 180 - (watched ? 120 : 0);
    this._droneFilter.frequency.setTargetAtTime(droneHz, t, 2);

    // Ducking: stingers set a timer; the silence beat holds the music down
    // for as long as the woods hold their breath.
    if (this._duckTimer > 0) {
      this._duckTimer -= dt;
      if (this._duckTimer <= 0 && !birdsSilent) {
        this._musicDuck.gain.setTargetAtTime(1, t, 3);
      }
    }
    if (birdsSilent && !this._duckHeld) {
      this._duckHeld = true;
      this._musicDuck.gain.setTargetAtTime(0.15, t, 0.4);
    } else if (!birdsSilent && this._duckHeld) {
      this._duckHeld = false;
      if (this._duckTimer <= 0) this._musicDuck.gain.setTargetAtTime(1, t, 3);
    }

    // A phrase every couple of minutes, and never while dread has the floor.
    this._motifTimer -= dt;
    if (this._motifTimer <= 0) {
      this._motifTimer = 70 + Math.random() * 70;
      if (!birdsSilent && !this._duckHeld && this._duckTimer <= 0 &&
          t > this._musicStart + 45) {
        this._motif(altT);
      }
    }

    this._musicInfo = {
      bus: this._musicBus.gain.value,
      duck: this._musicDuck.gain.value,
      ducked: this._duckTimer > 0 || this._duckHeld,
      droneHz,
      motifIn: this._motifTimer,
      voices: {
        d2, a2, d3: fogT * 0.014, f3: 0.006 + fogT * 0.01,
        eb2: altT * altT * 0.03, ab2: tritone,
      },
    };
  }

  /* ------------------------------------------------------------- birdsong */

  _pan(spread = 0.8) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * spread;
    return p;
  }

  _birdCall() {
    const kind = Math.random();
    if (kind < 0.5) this.bird('chirp');
    else if (kind < 0.8) this.bird('jay');
    else this.bird('woodpecker');
  }

  bird(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain();
    const pan = this._pan();
    if (pan) out.connect(pan).connect(this.master); else out.connect(this.master);
    out.gain.value = 1;

    if (kind === 'woodpecker') {
      // a dry click train, somewhere off in the trunks
      const clicks = 8 + (Math.random() * 5 | 0);
      for (let i = 0; i < clicks; i++) {
        const st = t0 + i * 0.072;
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.03, st);
        g.gain.exponentialRampToValueAtTime(0.001, st + 0.03);
        src.connect(f).connect(g).connect(out);
        src.start(st, Math.random() * 2); src.stop(st + 0.04);
      }
      return;
    }

    const notes = kind === 'jay' ? 2 : 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < notes; i++) {
      const st = t0 + i * (kind === 'jay' ? 0.24 : 0.16 + Math.random() * 0.06);
      const osc = ctx.createOscillator();
      osc.type = kind === 'jay' ? 'sawtooth' : 'sine';
      const f0 = kind === 'jay' ? 1150 + Math.random() * 200 : 2400 + Math.random() * 900;
      osc.frequency.setValueAtTime(f0, st);
      osc.frequency.exponentialRampToValueAtTime(
        kind === 'jay' ? f0 * 0.8 : f0 * (1.15 + Math.random() * 0.2), st + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(kind === 'jay' ? 0.02 : 0.016, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, st + (kind === 'jay' ? 0.2 : 0.12));
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = f0; filt.Q.value = 2.2;
      osc.connect(filt).connect(g).connect(out);
      osc.start(st); osc.stop(st + 0.25);
    }
  }

  /* ------------------------------------------------------------ footsteps */

  _footstep(surface) {
    const ctx = this.ctx, t0 = ctx.currentTime;

    if (surface === 'bridge') {
      // plank thump: a low sine knock with a woody click on top
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(88 + Math.random() * 14, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      osc.connect(g).connect(this.master);
      osc.start(t0); osc.stop(t0 + 0.18);
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 3;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.03, t0);
      g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      src.connect(f).connect(g2).connect(this.master);
      src.start(t0, Math.random() * 2); src.stop(t0 + 0.06);
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.25;
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let dur = 0.16, vol = 0.045;

    if (surface === 'creek') {
      filt.type = 'bandpass'; filt.frequency.value = 1500 + Math.random() * 400; filt.Q.value = 0.8;
      dur = 0.3; vol = 0.075;
    } else if (surface === 'undergrowth') {
      filt.type = 'lowpass'; filt.frequency.value = 460 + Math.random() * 160;
      dur = 0.22; vol = 0.055;
      if (Math.random() < 0.18) this._twigSnap(0.5);
    } else if (surface === 'rock') {
      filt.type = 'bandpass'; filt.frequency.value = 2100; filt.Q.value = 2.5;
      dur = 0.07; vol = 0.04;
    } else {   // packed trail dirt
      filt.type = 'lowpass'; filt.frequency.value = 850 + Math.random() * 350;
    }

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + dur + 0.05);
  }

  _twigSnap(vol = 1) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 1.6;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 600; f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.06);
  }

  /* ------------------------------------------------------------- stingers */

  /** A branch breaking somewhere it shouldn't. Panned hard, quiet, dry. */
  branchSnap() {
    if (!this.ctx) return;
    this._duckMusic(5);
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain();
    const pan = this._pan(1);
    if (pan) out.connect(pan).connect(this.master); else out.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 1.3;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.1);
  }

  /** Two or three footsteps that are not yours, after yours have stopped. */
  phantomSteps(count = 3) {
    if (!this.ctx) return;
    this._duckMusic(8);
    const ctx = this.ctx;
    const pan = this._pan(0.9);
    for (let i = 0; i < count; i++) {
      const t0 = ctx.currentTime + 0.5 + i * (0.52 + Math.random() * 0.08);
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.55;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.035 * (1 - i * 0.2), t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      if (pan) src.connect(f).connect(g).connect(pan), pan.connect(this.master);
      else src.connect(f).connect(g).connect(this.master);
      src.start(t0, Math.random() * 2); src.stop(t0 + 0.25);
    }
  }

  /** Barely audible pressure under the floor of the mix. */
  lowSting() {
    if (!this.ctx) return;
    // Load-bearing: a 45 Hz sting under a D2/E♭2 drone is mud, not dread.
    this._duckMusic(6);
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.055, t0 + 1.4);
    g.gain.linearRampToValueAtTime(0, t0 + 3.2);
    osc.connect(g).connect(this.master);
    osc.start(t0); osc.stop(t0 + 3.3);
  }

  owlHoot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = this._pan(0.7);
    for (let i = 0; i < 2; i++) {
      const st = t0 + i * 0.55;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(312, st);
      osc.frequency.linearRampToValueAtTime(282, st + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.05, st + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.42);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 600;
      osc.connect(f).connect(g);
      if (pan) g.connect(pan), pan.connect(this.master); else g.connect(this.master);
      osc.start(st); osc.stop(st + 0.5);
    }
  }

  /** An elk, a long way off. Mournful and strange the first time, every time. */
  elkBugle() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(680, t0 + 1.1);
    osc.frequency.exponentialRampToValueAtTime(430, t0 + 1.9);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 2.5);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5;
    const vibGain = ctx.createGain(); vibGain.gain.value = 14;
    vib.connect(vibGain).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.028, t0 + 0.5);
    g.gain.linearRampToValueAtTime(0.02, t0 + 1.9);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
    const pan = this._pan(1);
    osc.connect(f).connect(g);
    if (pan) g.connect(pan), pan.connect(this.master); else g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 2.7);
    vib.start(t0); vib.stop(t0 + 2.7);
  }

  wolfHowl() {
    if (!this.ctx) return;
    this._duckMusic(8);
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(290, t0);
    osc.frequency.linearRampToValueAtTime(420, t0 + 0.9);
    osc.frequency.linearRampToValueAtTime(395, t0 + 2.6);
    osc.frequency.linearRampToValueAtTime(240, t0 + 3.6);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.2;
    const vibGain = ctx.createGain(); vibGain.gain.value = 7;
    vib.connect(vibGain).connect(osc.frequency);
    // a cheap valley: one feedback delay behind the dry voice
    const delay = ctx.createDelay(); delay.delayTime.value = 0.31;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    delay.connect(fb).connect(delay);
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.02, t0 + 0.7);
    g.gain.linearRampToValueAtTime(0.016, t0 + 2.8);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.8);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const pan = this._pan(1);
    osc.connect(f).connect(g);
    g.connect(delay); delay.connect(wet);
    const sink = pan || this.master;
    g.connect(sink); wet.connect(sink);
    if (pan) pan.connect(this.master);
    osc.start(t0); osc.stop(t0 + 3.9);
    vib.start(t0); vib.stop(t0 + 3.9);
  }

  crowCaw() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = this._pan();
    const caws = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < caws; i++) {
      const st = t0 + i * 0.34;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(620 + Math.random() * 80, st);
      osc.frequency.exponentialRampToValueAtTime(430, st + 0.18);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.03, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.22);
      osc.connect(f).connect(g);
      if (pan) g.connect(pan), pan.connect(this.master); else g.connect(this.master);
      osc.start(st); osc.stop(st + 0.25);
    }
  }

  /** Leaves and small claws — squirrel dashes, deer steps in litter. */
  rustle(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 1.2;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.03 * vol, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(t0 + 0.4);
  }

  /** Hooves hitting ground, fading fast — a deer deciding against you. */
  deerThump() {
    if (!this.ctx) return;
    this._duckMusic(4);
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const t0 = ctx.currentTime + i * 0.21;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, t0);
      osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 * (1 - i * 0.16), t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      osc.connect(g).connect(this.master);
      osc.start(t0); osc.stop(t0 + 0.12);
    }
    this.rustle(1.4);
  }

  /** Two clear notes for a cairn found — the one unambiguously kind sound. */
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [[659.3, 0], [987.8, 0.16]].forEach(([freq, off]) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + off);
      g.gain.linearRampToValueAtTime(0.04, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.9);
      osc.connect(g).connect(this.master);
      osc.start(t0 + off); osc.stop(t0 + off + 1);
    });
  }
}
