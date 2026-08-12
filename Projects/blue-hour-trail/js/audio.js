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
//
// The class shape is Golden Hour's Soundscape; the instruments are new.

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

  /**
   * Called every frame.
   * state: { moving, surface, fogT, altT, creekDist, waterfallDist, birdsSilent }
   */
  update(dt, state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const { moving, surface, fogT, altT, creekDist, waterfallDist, birdsSilent } = state;

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
