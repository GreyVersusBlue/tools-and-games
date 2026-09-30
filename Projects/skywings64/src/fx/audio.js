// SkyWings 64 - audio.js : 100% WebAudio synthesis.
// Layered wind / rotor / rocket engines, procedural convolution reverb, positional SFX, and an
// orchestral-lite music engine (see music.js) with dynamic intensity layers.
import { MusicEngine } from './music.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioManager {
  // opts.ctx lets tests inject an OfflineAudioContext.
  constructor(opts) {
    this.ctx = null;
    this.muted = false;
    this._eng = null;
    this._volMaster = 0.8;
    this._sfxDest = null;
    this._speedN = 0; this._alt = 0; this._th = 0; this._manualInt = null;
    this.music = null;
    try {
      const inj = opts && opts.ctx;
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (inj) this._build(inj); else if (AC) this._build(new AC());
    } catch (e) {
      this.ctx = null;
    }
  }

  _build(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._volMaster;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.engineBus = ctx.createGain(); this.engineBus.gain.value = 0.6; this.engineBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);

    // shared noise buffers
    const sr = ctx.sampleRate, len = sr * 2;
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // crackle: sparse random impulses with tiny decays (rocket)
    const cb = ctx.createBuffer(1, len, sr), cd = cb.getChannelData(0);
    let env = 0;
    for (let i = 0; i < len; i++) { if (Math.random() < 0.0009) env = 0.6 + Math.random() * 0.8; cd[i] = (Math.random() * 2 - 1) * env; env *= 0.985; }
    this.crackleBuf = cb;

    // procedural convolution reverb (stereo exponentially decaying noise with darkening tail)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 1;
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.42; this.musicSend.connect(this.reverbIn);
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.22; this.sfxSend.connect(this.reverbIn);
    this.sfxBus.connect(this.sfxSend);
    this.engineSend = ctx.createGain(); this.engineSend.gain.value = 0.08; this.engineSend.connect(this.reverbIn);
    this.engineBus.connect(this.engineSend);

    // music slapback echo
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.31;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const wet = ctx.createGain(); wet.gain.value = 0.14;
    this.musicBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(this.master);

    this.music = new MusicEngine(this);
  }

  _makeImpulse(seconds, decay) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * seconds);
    const b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const k = 0.15 + 0.8 * t;                // one-pole lowpass darkens over time
        lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
        const pre = i < sr * 0.012 ? i / (sr * 0.012) : 1;
        d[i] = lp * Math.pow(1 - t, decay * 1.6) * pre * 1.6;
      }
    }
    return b;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.resume) {
      try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }
  }

  suspend() { if (this.ctx && this.ctx.suspend) { try { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this._volMaster, this.ctx.currentTime, 0.05);
  }
  setVolume(v) { this._volMaster = clamp(v, 0, 1); if (this.master && !this.muted) this.master.gain.setTargetAtTime(this._volMaster, this.ctx.currentTime, 0.05); }
  setMusicVolume(v) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.05); }
  setSfxVolume(v) { if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.05); }

  // ------------------------------------------------------------------ listener / positional helpers
  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener; if (!L) return;
    const t = this.ctx.currentTime;
    fwd = fwd || { x: 0, y: 0, z: -1 }; up = up || { x: 0, y: 1, z: 0 };
    try {
      if (L.positionX) {
        L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
        L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
        L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
      } else if (L.setPosition) { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    } catch (e) { /* ignore */ }
  }

  // accepts a THREE.Camera (uses matrixWorld) -- call once per frame
  setListenerFromCamera(cam) {
    if (!cam || !this.ctx) return;
    const e = cam.matrixWorld.elements;
    this.setListener({ x: e[12], y: e[13], z: e[14] }, { x: -e[8], y: -e[9], z: -e[10] }, { x: e[4], y: e[5], z: e[6] });
  }

  // Build an output node for a one-shot: opts {position:{x,y,z}, pan:-1..1, volume}
  _route(opts) {
    const c = this.ctx;
    if (!opts || (!opts.position && opts.pan === undefined && opts.volume === undefined)) return null;
    const g = c.createGain(); g.gain.value = opts.volume !== undefined ? opts.volume : 1;
    let last = g, extra = null;
    if (opts.position && c.createPanner) {
      const p = c.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.refDistance || 30; p.maxDistance = 6000; p.rolloffFactor = opts.rolloff !== undefined ? opts.rolloff : 1.1;
      const pos = opts.position;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); last = p; extra = p;
    } else if (opts.pan !== undefined && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = clamp(opts.pan, -1, 1);
      g.connect(p); last = p; extra = p;
    }
    last.connect(this.sfxBus);
    setTimeout(() => { try { g.disconnect(); if (extra) extra.disconnect(); } catch (e) { /* ignore */ } }, 4500);
    return g;
  }

  playSfx(name, opts) {
    if (!this.ctx || !this._live()) return;
    const r = this._route(opts);
    this._sfxDest = r;
    try { this._playSfxRaw(name); } finally { this._sfxDest = null; }
  }

  playSfxAt(name, position, volume) { this.playSfx(name, { position, volume }); }

  // ------------------------------------------------------------------ primitives
  _noiseLoop() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  _tone(f, dur, type, vol, fEnd, delay, dest, attack) {
    const c = this.ctx; const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = c.createGain(); const a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this._sfxDest || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noise(dur, ftype, f0, f1, vol, delay, q, dest, attack) {
    const c = this.ctx; const t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = ftype || 'lowpass'; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); const a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this._sfxDest || this.sfxBus);
    s.start(t, Math.random() * 0.4, dur + 0.05);
  }

  // ------------------------------------------------------------------ engine loops
  _bp(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; }

  startEngine(kind) {
    if (!this.ctx) return;
    kind = kind || 'wind';
    if (this._eng && this._eng.kind === kind) return;
    this.stopEngine();
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0.0001; out.connect(this.engineBus);
    out.gain.setTargetAtTime(1, c.currentTime, 0.25);
    const e = { kind, out, src: [] };

    // --- layered wind: low rumble + mid body + high hiss, with slow gust LFO on the hiss (doppler-ish flutter)
    const rn = this._noiseLoop(), rlp = this._bp('lowpass', 180, 0.6), rg = c.createGain(); rg.gain.value = 0;
    rn.connect(rlp); rlp.connect(rg); rg.connect(out);
    const wn = this._noiseLoop(), wbp = this._bp('bandpass', 400, 0.7), wg = c.createGain(); wg.gain.value = 0;
    wn.connect(wbp); wbp.connect(wg); wg.connect(out);
    const hn = this._noiseLoop(), hhp = this._bp('highpass', 3200, 0.5), hg = c.createGain(); hg.gain.value = 0;
    hn.connect(hhp); hhp.connect(hg); hg.connect(out);
    const gust = c.createOscillator(); gust.type = 'sine'; gust.frequency.value = 0.31;
    const gust2 = c.createOscillator(); gust2.type = 'sine'; gust2.frequency.value = 1.7;
    const ga = c.createGain(); ga.gain.value = 0; const ga2 = c.createGain(); ga2.gain.value = 0;
    gust.connect(ga); ga.connect(hg.gain); gust2.connect(ga2); ga2.connect(wbp.detune);
    gust.start(); gust2.start();
    e.src.push(rn, wn, hn, gust, gust2);
    Object.assign(e, { rlp, rg, wbp, wg, hhp, hg, ga, ga2 });

    if (kind === 'rotor') {
      // blade-pass: noise through a gain driven by a pulse-shaped PeriodicWave => real thwump-thwump modulation
      const n = this._noiseLoop();
      const bp = this._bp('bandpass', 600, 1.1);
      const chop = c.createGain(); chop.gain.value = 0.08;
      const lfo = c.createOscillator();
      const N = 24, re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++) im[k] = Math.sin(Math.PI * k * 0.22) / k * (1 / (1 + k * 0.08));   // ~22% duty pulse
      try { lfo.setPeriodicWave(c.createPeriodicWave(re, im)); } catch (er) { lfo.type = 'sine'; }
      lfo.frequency.value = 10;
      const lfoAmt = c.createGain(); lfoAmt.gain.value = 0.9;
      lfo.connect(lfoAmt); lfoAmt.connect(chop.gain);
      const crg = c.createGain(); crg.gain.value = 0.3;
      n.connect(bp); bp.connect(chop); chop.connect(crg); crg.connect(out);
      // low thump at blade-pass rate
      const th = c.createOscillator(); th.type = 'triangle'; th.frequency.value = 55;
      const thg = c.createGain(); thg.gain.value = 0.02;
      const thm = c.createOscillator(); thm.setPeriodicWave(c.createPeriodicWave(re, im)); thm.frequency.value = 10;
      const thma = c.createGain(); thma.gain.value = 0.9; thm.connect(thma); thma.connect(thg.gain);
      const thl = this._bp('lowpass', 200, 0.7);
      th.connect(thl); thl.connect(thg); thg.connect(out);
      // turbine whine
      const wh = c.createOscillator(); wh.type = 'sawtooth'; wh.frequency.value = 180;
      const whl = this._bp('bandpass', 900, 3);
      const whg = c.createGain(); whg.gain.value = 0.01;
      wh.connect(whl); whl.connect(whg); whg.connect(out);
      lfo.start(); th.start(); thm.start(); wh.start();
      e.src.push(n, lfo, th, thm, wh);
      Object.assign(e, { lfo, thm, bp, crg, th, thg, wh, whg });
    } else if (kind === 'rocket') {
      const n = this._noiseLoop();
      const lp = this._bp('lowpass', 700, 0.8);
      const roar = c.createGain(); roar.gain.value = 0.05;
      n.connect(lp); lp.connect(roar); roar.connect(out);
      const n2 = this._noiseLoop();
      const hp = this._bp('highpass', 2500, 0.6);
      const hiss = c.createGain(); hiss.gain.value = 0;
      n2.connect(hp); hp.connect(hiss); hiss.connect(out);
      const cr = c.createBufferSource(); cr.buffer = this.crackleBuf; cr.loop = true; cr.start(0, Math.random() * 1.5);
      const cbp = this._bp('bandpass', 2400, 0.9), crk = c.createGain(); crk.gain.value = 0;
      cr.connect(cbp); cbp.connect(crk); crk.connect(out);
      const th = c.createOscillator(); th.type = 'sawtooth'; th.frequency.value = 55;
      const thl = this._bp('lowpass', 300, 0.7);
      const thg = c.createGain(); thg.gain.value = 0.05;
      th.connect(thl); thl.connect(thg); thg.connect(out);
      const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38;
      const subg = c.createGain(); subg.gain.value = 0.03; sub.connect(subg); subg.connect(out);
      th.start(); sub.start();
      e.src.push(n, n2, cr, th, sub);
      Object.assign(e, { lp, roar, hiss, crk, th, thg, sub, subg });
    }
    this._eng = e;
  }

  stopEngine() {
    const e = this._eng; if (!e || !this.ctx) { this._eng = null; return; }
    this._eng = null;
    const c = this.ctx;
    e.out.gain.cancelScheduledValues(c.currentTime);
    e.out.gain.setTargetAtTime(0.0001, c.currentTime, 0.12);
    setTimeout(() => {
      for (let i = 0; i < e.src.length; i++) { try { e.src[i].stop(); } catch (er) { /* ignore */ } }
      try { e.out.disconnect(); } catch (er) { /* ignore */ }
    }, 900);
  }

  // state: {speed (m/s), throttle 0..1, kind, altitude (m, optional), intensity (optional override)}
  setEngine(state) {
    if (!this.ctx || !state) return;
    if (state.kind && (!this._eng || this._eng.kind !== state.kind)) this.startEngine(state.kind);
    const e = this._eng; if (!e) return;
    const now = this.ctx.currentTime;
    const s = clamp((state.speed || 0) / 45, 0, 1);
    const th = clamp(state.throttle || 0, 0, 1);
    const alt = state.altitude !== undefined ? state.altitude : this._alt;
    this._speedN = s; this._th = th; this._alt = alt;
    const s15 = Math.pow(s, 1.3);
    const wind = e.kind === 'wind' ? 1 : 0.42;
    e.rg.gain.setTargetAtTime((0.02 + 0.34 * s15) * wind, now, 0.15);
    e.rlp.frequency.setTargetAtTime(120 + s * 260, now, 0.15);
    e.wg.gain.setTargetAtTime((0.01 + 0.3 * s15) * wind, now, 0.1);
    e.wbp.frequency.setTargetAtTime(250 + s * 1500, now, 0.1);
    e.hg.gain.setTargetAtTime((0.004 + 0.16 * s * s) * wind, now, 0.12);
    e.hhp.frequency.setTargetAtTime(2400 + s * 3000, now, 0.12);
    e.ga.gain.setTargetAtTime(0.01 + 0.06 * s * wind, now, 0.3);
    e.ga2.gain.setTargetAtTime(25 + 220 * s, now, 0.3);
    if (e.kind === 'rotor') {
      const bp = 8 + th * 10;              // blade-pass Hz
      e.lfo.frequency.setTargetAtTime(bp, now, 0.15);
      e.thm.frequency.setTargetAtTime(bp, now, 0.15);
      e.bp.frequency.setTargetAtTime(450 + th * 650, now, 0.15);
      e.crg.gain.setTargetAtTime(0.16 + th * 0.28, now, 0.15);
      e.th.frequency.setTargetAtTime(46 + th * 30, now, 0.2);
      e.thg.gain.setTargetAtTime(0.05 + th * 0.1, now, 0.2);
      e.wh.frequency.setTargetAtTime(160 + th * 300, now, 0.2);
      e.whg.gain.setTargetAtTime(0.006 + th * 0.02, now, 0.2);
    } else if (e.kind === 'rocket') {
      e.lp.frequency.setTargetAtTime(500 + th * 2600, now, 0.08);
      e.roar.gain.setTargetAtTime(0.03 + th * 0.4, now, 0.08);
      e.hiss.gain.setTargetAtTime(th * th * 0.09, now, 0.08);
      e.crk.gain.setTargetAtTime(th * 0.16, now, 0.08);
      e.th.frequency.setTargetAtTime(50 + th * 55, now, 0.1);
      e.thg.gain.setTargetAtTime(0.04 + th * 0.16, now, 0.1);
      e.sub.frequency.setTargetAtTime(34 + th * 14, now, 0.15);
      e.subg.gain.setTargetAtTime(0.03 + th * 0.12, now, 0.15);
    }
    if (state.intensity !== undefined) this._manualInt = state.intensity;
    if (this.music && this.music.name) {
      const iv = this._manualInt !== null ? this._manualInt : clamp(0.12 + s * 0.5 + th * 0.12 + clamp(alt / 400, 0, 1) * 0.26, 0, 1);
      this.music.setIntensity(iv);
    }
  }

  setIntensity(v) { this._manualInt = v === null || v === undefined ? null : clamp(v, 0, 1); if (this.music && this._manualInt !== null) this.music.setIntensity(this._manualInt); }

  // ------------------------------------------------------------------ SFX
  _playSfxRaw(name) {
    const T = (f, d, ty, v, fe, dl, at) => this._tone(f, d, ty, v, fe, dl, null, at);
    const N = (d, ft, f0, f1, v, dl, q, at) => this._noise(d, ft, f0, f1, v, dl, q, null, at);
    switch (name) {
      case 'ring':
        T(880, 0.35, 'sine', 0.22); T(880, 0.25, 'triangle', 0.12);
        T(1318, 0.5, 'sine', 0.22, 0, 0.07); T(1760, 0.6, 'sine', 0.12, 0, 0.14);
        T(2637, 0.3, 'triangle', 0.05, 0, 0.14);
        break;
      case 'crash':
        N(1.0, 'lowpass', 2200, 90, 0.9, 0, 0.7);
        T(90, 0.7, 'sine', 0.8, 30);
        N(0.3, 'bandpass', 3000, 800, 0.4, 0, 2);
        T(140, 0.4, 'sawtooth', 0.15, 40, 0.05);
        break;
      case 'splash':
        N(0.8, 'bandpass', 1400, 400, 0.6, 0, 0.8, 0.03);
        N(0.5, 'highpass', 4000, 1500, 0.2, 0, 0.5);
        for (let i = 0; i < 4; i++) T(500 + Math.random() * 500, 0.1, 'sine', 0.08, 1400, 0.1 + i * 0.09);
        T(120, 0.3, 'sine', 0.3, 50);
        break;
      case 'touchdown':
        T(110, 0.25, 'sine', 0.6, 45);
        N(0.18, 'lowpass', 900, 200, 0.45, 0, 0.7);
        N(0.5, 'bandpass', 1800, 900, 0.1, 0.05, 1);
        break;
      case 'boost':
        N(0.7, 'bandpass', 400, 4000, 0.4, 0, 1.5, 0.1);
        T(200, 0.6, 'sawtooth', 0.12, 700, 0, 0.1);
        T(400, 0.6, 'square', 0.04, 1400, 0, 0.1);
        break;
      case 'menu':
        T(660, 0.07, 'square', 0.09);
        break;
      case 'select':
        T(660, 0.08, 'square', 0.1); T(990, 0.18, 'square', 0.1, 0, 0.07); T(990, 0.25, 'triangle', 0.12, 0, 0.07);
        break;
      case 'countdown':
        T(440, 0.22, 'square', 0.12); T(440, 0.22, 'sine', 0.2);
        break;
      case 'go':
        T(880, 0.7, 'square', 0.1); T(880, 0.7, 'sine', 0.22); T(1320, 0.7, 'triangle', 0.14);
        T(1760, 0.5, 'sine', 0.06, 0, 0.05);
        break;
      case 'medal': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (let i = 0; i < 4; i++) { T(notes[i], 0.35, 'square', 0.07, 0, i * 0.11); T(notes[i], 0.4, 'triangle', 0.14, 0, i * 0.11); }
        T(1046.5, 1.2, 'triangle', 0.16, 0, 0.5); T(783.99, 1.2, 'triangle', 0.12, 0, 0.5);
        T(1318.5, 1.2, 'sine', 0.1, 0, 0.5); T(2093, 0.8, 'sine', 0.05, 0, 0.6);
        break;
      }
      case 'bomb':
        T(1400, 0.7, 'sine', 0.16, 250); T(1410, 0.7, 'triangle', 0.06, 260);
        N(0.5, 'highpass', 3000, 800, 0.05, 0, 1);
        break;
      case 'explosion':
        N(1.5, 'lowpass', 3500, 60, 1.0, 0, 0.6);
        N(2.2, 'lowpass', 300, 40, 0.5, 0.1, 0.7, 0.05);
        T(85, 1.0, 'sine', 0.9, 25);
        N(0.5, 'bandpass', 2500, 500, 0.5, 0, 1.5);
        for (let i = 0; i < 6; i++) N(0.08, 'highpass', 3000, 0, 0.15, 0.2 + Math.random() * 0.6, 1);
        T(60, 1.2, 'sawtooth', 0.2, 20, 0.05);
        break;
      case 'stall':
        for (let i = 0; i < 3; i++) { T(330, 0.16, 'square', 0.09, 240, i * 0.2); T(335, 0.16, 'sawtooth', 0.05, 245, i * 0.2); }
        break;
      case 'thermal':
        T(400, 0.9, 'sine', 0.13, 800, 0, 0.15); T(600, 0.9, 'sine', 0.08, 1200, 0.1, 0.15);
        T(1200, 0.5, 'triangle', 0.04, 1800, 0.3, 0.1);
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ music (see music.js)
  startMusic(name) { if (this.ctx && this.music) this.music.start(name); }
  stopMusic(fade) { if (this.ctx && this.music) this.music.stop(fade); }
  // schedule music ahead of currentTime (used by tests with an OfflineAudioContext)
  // nothing is scheduled until a user gesture has let the context run (avoids Chrome's autoplay warning spam)
  _pump(look) { if (this.music && this.ctx && this._live()) this.music.pump(look); }
  _live() { return this.ctx.state !== 'suspended' || typeof this.ctx.startRendering === 'function'; }
}
