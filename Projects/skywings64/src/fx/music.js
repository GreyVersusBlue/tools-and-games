// SkyWings 64 - music.js : procedural orchestral-lite score with dynamic intensity layers.
// Everything is synthesised from oscillators + noise. Layers fade in/out with an "intensity" value (0..1)
// that the game drives from speed / throttle / altitude through AudioManager.setIntensity / setEngine.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

const CH = { maj: [0, 4, 7], min: [0, 3, 7], sus: [0, 2, 7], add9: [0, 4, 7, 14], dom: [0, 4, 7, 10], min7: [0, 3, 7, 10] };

// chord = [rootPitchClass, quality]. melody entries [midi, sixteenths] (midi 0 = rest).
export const TRACKS = {
  title: {
    bpm: 96, fixed: 0.86,
    chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [4, 'min'], [5, 'add9'], [0, 'maj'], [5, 'maj'], [7, 'dom'],
      [0, 'maj'], [7, 'maj'], [9, 'min'], [4, 'min'], [5, 'add9'], [0, 'maj'], [7, 'dom'], [0, 'maj']],
    melody: [
      [72, 4], [76, 4], [79, 4], [84, 4],   [83, 6], [81, 2], [79, 8],   [81, 4], [84, 4], [88, 4], [84, 4],   [83, 4], [79, 4], [76, 8],
      [77, 4], [81, 4], [84, 6], [81, 2],   [79, 4], [84, 4], [88, 8],   [86, 4], [84, 4], [81, 4], [77, 4],   [79, 12], [0, 4],
      [84, 6], [88, 2], [91, 8],            [86, 4], [91, 4], [88, 4], [86, 4],  [88, 6], [84, 2], [81, 4], [84, 4],  [83, 8], [79, 4], [83, 4],
      [84, 4], [81, 4], [84, 4], [89, 4],   [88, 6], [84, 2], [79, 8],   [86, 4], [83, 4], [79, 4], [74, 4],   [84, 10], [0, 6],
    ],
    layers: { pad: 0, harp: 0, brass: 0, bass: 0.1, timp: 0, perc: 0.5, strings: 0.7, choir: 0.8 },
    drums: { kick: [], snare: [], hat: 0, timp: true },
    bassPat: 'half', arpPat: 'harp8',
  },
  flight: {
    bpm: 126, fixed: null,
    chords: [[2, 'maj'], [9, 'maj'], [11, 'min'], [7, 'add9'], [2, 'maj'], [9, 'maj'], [7, 'maj'], [9, 'dom'],
      [2, 'maj'], [9, 'maj'], [11, 'min'], [6, 'min'], [7, 'add9'], [2, 'maj'], [7, 'maj'], [9, 'dom']],
    melody: [
      [81, 3], [81, 1], [86, 4], [83, 4], [81, 4],  [85, 3], [85, 1], [88, 4], [85, 4], [81, 4],  [83, 3], [83, 1], [86, 4], [90, 4], [86, 4],  [83, 4], [86, 4], [83, 4], [79, 4],
      [78, 4], [81, 4], [86, 8],                    [88, 4], [85, 4], [81, 8],                    [86, 4], [83, 4], [79, 4], [83, 4],           [85, 4], [88, 4], [85, 4], [0, 4],
      [86, 4], [90, 4], [93, 6], [90, 2],           [88, 4], [85, 4], [81, 8],                    [90, 4], [86, 4], [83, 4], [86, 4],           [85, 4], [81, 4], [78, 8],
      [79, 4], [83, 4], [86, 4], [91, 4],           [90, 4], [86, 4], [81, 8],                    [83, 4], [86, 4], [91, 4], [88, 4],           [85, 8], [88, 4], [85, 4],
    ],
    layers: { pad: 0, harp: 0.1, bass: 0.3, timp: 0.28, perc: 0.42, brass: 0.5, strings: 0.68, choir: 0.85 },
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: 2, timp: false },
    bassPat: 'drive', arpPat: 'harp16',
  },
  results: {
    bpm: 92, fixed: 0.7,
    chords: [[5, 'maj'], [10, 'maj'], [0, 'dom'], [5, 'maj'], [2, 'min'], [10, 'maj'], [0, 'dom'], [5, 'maj']],
    melody: [
      [84, 2], [84, 2], [89, 4], [84, 4], [81, 4],  [86, 2], [86, 2], [89, 4], [86, 4], [82, 4],  [88, 4], [86, 4], [84, 4], [79, 4],  [81, 4], [84, 4], [89, 8],
      [86, 4], [81, 4], [86, 4], [89, 4],           [86, 4], [82, 4], [89, 4], [86, 4],           [88, 4], [79, 4], [84, 4], [88, 4],  [89, 12], [0, 4],
    ],
    layers: { pad: 0, harp: 0, brass: 0, bass: 0.1, timp: 0.2, perc: 0.4, strings: 0.55, choir: 0.9 },
    drums: { kick: [0, 8], snare: [12], hat: 4, timp: true },
    bassPat: 'half', arpPat: 'harp8',
  },
};

function compile(def) {
  if (def.mel) return def;
  def.bars = def.chords.length;
  def.total = def.bars * 16;
  def.mel = new Array(def.total).fill(null);
  let s = 0;
  for (let i = 0; i < def.melody.length; i++) {
    const n = def.melody[i];
    if (n[0] > 0 && s < def.total) def.mel[s] = n;
    s += n[1];
  }
  return def;
}

export class MusicEngine {
  constructor(audio) {
    this.a = audio;
    this.ctx = audio.ctx;
    this.name = null; this.def = null; this.timer = 0;
    this.step = 0; this.next = 0; this.sd = 0.125;
    this.int = 0.3; this.target = 0.3;
    this.layers = null; this.out = null;
  }

  start(name, opts) {
    const def = TRACKS[name]; if (!def || !this.ctx) return false;
    if (this.name === name && (this.timer || (opts && opts.manual))) return true;
    this.stop(0.6);
    compile(def);
    const c = this.ctx;
    this.def = def; this.name = name;
    this.out = c.createGain();
    this.out.gain.setValueAtTime(0.0001, c.currentTime);
    this.out.gain.linearRampToValueAtTime(1, c.currentTime + 0.5);
    this.out.connect(this.a.musicBus);
    const send = c.createGain(); send.gain.value = 1; send.connect(this.a.musicSend);
    this.out.connect(send);
    this.layers = {};
    const sends = { pad: 0.9, harp: 0.8, brass: 0.6, bass: 0.15, timp: 0.5, perc: 0.35, strings: 0.7, choir: 1.0 };
    const base = { pad: 0.85, harp: 0.8, brass: 0.9, bass: 0.9, timp: 1.0, perc: 0.9, strings: 0.75, choir: 0.7 };
    for (const k in def.layers) {
      const g = c.createGain(); g.gain.value = 0.0001; g.connect(this.out);
      this.layers[k] = { g, th: def.layers[k], lvl: 0, base: base[k] || 0.8 };
    }
    this.sd = 60 / def.bpm / 4;
    this.step = 0; this.next = c.currentTime + 0.15;
    this.int = def.fixed !== null && def.fixed !== undefined ? def.fixed : this.int;
    this.target = this.int;
    this._send = send;
    if (!opts || !opts.manual) this.timer = setInterval(() => this.pump(), 60);
    this.pump();
    return true;
  }

  stop(fade) {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const out = this.out; this.out = null; this.name = null; this.def = null;
    const send = this._send; this._send = null; this.layers = null;
    if (!out || !this.ctx) return;
    const f = fade === undefined ? 0.5 : fade, now = this.ctx.currentTime;
    try {
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.linearRampToValueAtTime(0.0001, now + f);
    } catch (e) { /* ignore */ }
    setTimeout(() => { try { out.disconnect(); if (send) send.disconnect(); } catch (e) { /* ignore */ } }, (f + 2.5) * 1000);
  }

  setIntensity(v) { this.target = clamp(v, 0, 1); }

  // schedule notes up to `look` seconds ahead of currentTime
  pump(look) {
    const def = this.def; if (!def || !this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    // a live context waiting for a user gesture: schedule nothing yet (offline test contexts render regardless)
    if (c.state === 'suspended' && typeof c.startRendering !== 'function') return;
    if (def.fixed === null || def.fixed === undefined) this.int += (this.target - this.int) * 0.12;
    else this.int = def.fixed;
    for (const k in this.layers) {
      const L = this.layers[k];
      L.lvl = smooth((this.int - L.th) / 0.16);
      L.g.gain.setTargetAtTime(Math.max(0.0001, L.lvl * L.base), now, 0.35);
    }
    if (this.next < now - 0.3) this.next = now + 0.05;
    const horizon = now + (look || 0.9);
    let guard = 0;
    while (this.next < horizon && guard++ < 512) {
      this._schedule(this.step, this.next);
      this.next += this.sd;
      this.step = (this.step + 1) % def.total;
    }
  }

  // ------------------------------------------------------------------ instruments
  _note(dest, midi, t, dur, o) {
    const c = this.ctx, f = mtof(midi);
    const a = o.a || 0.01, rel = o.r || 0.08, vol = o.vol;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + a);
    if (o.sus !== undefined) env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * o.sus), t + Math.max(a + 0.01, dur));
    else env.gain.setValueAtTime(vol, t + Math.max(a, dur));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    let head = env;
    let lp = null;
    if (o.lp) {
      lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = o.q || 0.7;
      lp.frequency.setValueAtTime(o.lp0 || o.lp, t);
      lp.frequency.exponentialRampToValueAtTime(o.lp, t + (o.lpT || a + 0.05));
      lp.connect(env); head = lp;
    }
    env.connect(dest);
    const dets = o.det || [0];
    const end = t + dur + rel + 0.05;
    for (let i = 0; i < dets.length; i++) {
      const os = c.createOscillator(); os.type = o.type || 'sawtooth';
      os.frequency.setValueAtTime(f * (o.mult || 1), t);
      if (o.glide) os.frequency.setValueAtTime(f * (o.mult || 1) * o.glide, t), os.frequency.exponentialRampToValueAtTime(f * (o.mult || 1), t + 0.07);
      os.detune.value = dets[i];
      os.connect(head);
      if (o.vib) {
        const l = c.createOscillator(); l.frequency.value = 5.2 + i * 0.3;
        const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(dur * 0.6, 0.5));
        l.connect(lg); lg.connect(os.detune); l.start(t); l.stop(end);
      }
      os.start(t); os.stop(end);
    }
  }

  _noiseHit(dest, t, dur, ftype, f0, f1, vol, q) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.a.noiseBuf;
    const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  _kick(dest, t, vol) {
    const c = this.ctx, o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
  }

  _timpani(dest, t, midi, vol) {
    const c = this.ctx, f = mtof(midi);
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(); o.type = i ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f * (i ? 2.0 : 1.5), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      const g = c.createGain(); g.gain.setValueAtTime(vol * (i ? 0.35 : 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + (i ? 0.5 : 1.1));
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.2);
    }
    this._noiseHit(dest, t, 0.09, 'lowpass', 900, 200, vol * 0.5, 0.7);
  }

  _snare(dest, t, vol) {
    this._noiseHit(dest, t, 0.16, 'bandpass', 2000, 900, vol, 0.9);
    const c = this.ctx, o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.15);
  }

  _cymbal(dest, t, vol, dur) {
    this._noiseHit(dest, t, dur, 'highpass', 5500, 3500, vol, 0.5);
    this._noiseHit(dest, t, dur * 0.6, 'bandpass', 9000, 6000, vol * 0.6, 1.5);
  }

  // ------------------------------------------------------------------ per-step composition
  _schedule(idx, t) {
    const d = this.def, L = this.layers, sd = this.sd;
    const bar = (idx / 16) | 0, st = idx % 16;
    const chord = d.chords[bar];
    const pc = chord[0], tones = CH[chord[1]] || CH.maj;
    const on = (k) => L[k] && L[k].lvl > 0.02;
    const first = idx === 0;

    // ---- pad / string bed (sustained, slow attack) once per bar
    if (st === 0 && on('pad')) {
      const dur = sd * 16;
      for (let i = 0; i < 3; i++) {
        this._note(L.pad.g, 48 + pc + tones[i], t, dur * 0.98, { type: 'sawtooth', vol: 0.028, a: 0.5, r: 0.5, sus: 0.8, lp: 1300, lp0: 500, lpT: 0.9, det: [-9, 8] });
      }
      this._note(L.pad.g, 60 + pc + tones[0], t, dur * 0.98, { type: 'triangle', vol: 0.05, a: 0.6, r: 0.5, sus: 0.8 });
      this._note(L.pad.g, 36 + pc, t, dur, { type: 'sine', vol: 0.09, a: 0.3, r: 0.4, sus: 0.9 });
    }

    // ---- harp / pluck arpeggio
    if (on('harp')) {
      const p16 = d.arpPat === 'harp16';
      const every = p16 ? 1 : 2;
      if (st % every === 0) {
        const k = (st / every) | 0;
        const seq = p16 ? [0, 1, 2, 3, 2, 1, 3, 2] : [0, 1, 2, 3, 2, 1, 2, 3];
        const ti = seq[k % 8];
        const tone = tones[ti % tones.length] + (ti >= 3 ? 12 : 0);
        const m = 60 + pc + tone + ((k & 4) ? 12 : 0) - (pc > 6 ? 12 : 0);
        this._note(L.harp.g, m, t, sd * every * 1.6, { type: 'triangle', vol: p16 ? 0.05 : 0.06, a: 0.004, r: 0.25, sus: 0.15 });
        this._note(L.harp.g, m, t, sd * every * 1.0, { type: 'sine', vol: 0.05, a: 0.003, r: 0.2, sus: 0.1, mult: 2 });
      }
    }

    // ---- bass
    if (on('bass')) {
      const root = 36 + pc + (pc > 6 ? -12 : 0);
      if (d.bassPat === 'drive') {
        if (st % 2 === 0) {
          const off = [0, 0, 12, 0, 7, 0, 12, 7][st >> 1];
          this._note(L.bass.g, root + off, t, sd * 1.7, { type: 'sawtooth', vol: 0.07, a: 0.005, r: 0.06, sus: 0.4, lp: 700, lp0: 1600, lpT: 0.12 });
          this._note(L.bass.g, root + off, t, sd * 1.7, { type: 'sine', vol: 0.14, a: 0.005, r: 0.06, sus: 0.5 });
        }
      } else if (st === 0 || st === 8) {
        const off = st === 8 ? 7 : 0;
        this._note(L.bass.g, root + off, t, sd * 7, { type: 'sawtooth', vol: 0.05, a: 0.02, r: 0.2, sus: 0.6, lp: 500 });
        this._note(L.bass.g, root + off, t, sd * 7, { type: 'sine', vol: 0.15, a: 0.02, r: 0.2, sus: 0.7 });
      }
    }

    // ---- melody: brass (+ octave-doubled choir and strings at higher intensities)
    const m = d.mel[idx];
    if (m) {
      const dur = Math.max(0.1, m[1] * sd * 0.94);
      if (on('brass')) {
        this._note(L.brass.g, m[0] - 12, t, dur, { type: 'sawtooth', vol: 0.06, a: 0.05, r: 0.12, sus: 0.75, lp: 3200, lp0: 500, lpT: 0.14, q: 1.2, det: [-6, 7], vib: m[1] >= 6 ? 14 : 0 });
        this._note(L.brass.g, m[0] - 12, t, dur, { type: 'square', vol: 0.02, a: 0.06, r: 0.1, sus: 0.7, lp: 2000, lp0: 400, lpT: 0.16 });
      }
      if (on('choir')) {
        this._note(L.choir.g, m[0], t, dur, { type: 'sine', vol: 0.06, a: 0.09, r: 0.25, sus: 0.8, vib: 18 });
        this._note(L.choir.g, m[0] + 12, t, dur, { type: 'triangle', vol: 0.03, a: 0.1, r: 0.25, sus: 0.8, vib: 22, det: [4] });
        this._note(L.choir.g, m[0] - 5, t, dur, { type: 'sine', vol: 0.03, a: 0.12, r: 0.25, sus: 0.8, vib: 16 });
      }
    }

    // ---- driving string ostinato
    if (on('strings') && st % 2 === 0) {
      const tone = tones[(st >> 1) % tones.length] + ((st & 4) ? 12 : 0);
      this._note(L.strings.g, 60 + pc + tone - (pc > 6 ? 12 : 0), t, sd * 1.5, { type: 'sawtooth', vol: 0.032, a: 0.012, r: 0.05, sus: 0.5, lp: 2600, lp0: 900, lpT: 0.08, det: [-8, 8] });
    }

    // ---- percussion
    const dr = d.drums;
    if (on('timp') || (dr.timp && on('perc'))) {
      const lt = L.timp || L.perc;
      if (dr.timp) {
        if (st === 0 || st === 8) this._timpani(lt.g, t, 36 + pc + (pc > 6 ? -12 : 0) + 12, st === 0 ? 0.42 : 0.3);
        if (bar % 4 === 3 && st >= 12) this._timpani(lt.g, t, 43 + (pc > 6 ? 0 : 0), 0.22 + (st - 12) * 0.05);   // roll into next phrase
      }
    }
    if (on('perc')) {
      const g = L.perc.g;
      for (let i = 0; i < dr.kick.length; i++) if (dr.kick[i] === st) this._kick(g, t, 0.42);
      for (let i = 0; i < dr.snare.length; i++) if (dr.snare[i] === st) this._snare(g, t, 0.2);
      if (dr.hat && st % dr.hat === 0) this._noiseHit(g, t, 0.04, 'highpass', 7500, 0, (st % (dr.hat * 2) === 0) ? 0.05 : 0.09, 0.8);
      if (bar % 4 === 3 && st >= 12 && !dr.timp) this._snare(g, t, 0.1 + (st - 12) * 0.03);
      if (st === 0 && bar % 8 === 0) this._cymbal(g, t, 0.16, 2.2);
    } else if (first && on('pad')) {
      this._cymbal(L.pad.g, t, 0.05, 1.5);
    }
  }
}
