import { CFG } from './config.js';

// Sub-bass drone plus your own heartbeat, slightly too fast. Under all of it,
// the room: HVAC, twelve people breathing, and the specific sound of a chair.
export function createAudio() {
  let ctx = null, droneGain = null, beatTimer = null, active = false;
  let hvacGain = null, murmurGain = null, murmurFilter = null, noiseBuf = null;
  let murmurTarget = 0;
  const whispers = new Map();

  function noise(seconds = 2) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function bed(buffer, freq, q, gainValue, type = 'lowpass') {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gainValue;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
    return { gain: g, filter: f };
  }

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      const drone = ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 52;
      droneGain = ctx.createGain();
      droneGain.gain.value = 0;
      drone.connect(droneGain).connect(ctx.destination);
      drone.start();
      beatTimer = setInterval(beat, 620);

      noiseBuf = noise(3);
      hvacGain = bed(noiseBuf, 220, 0.6, 0.014).gain;          // the ceiling unit
      const m = bed(noiseBuf, 700, 1.6, 0.0, 'bandpass');       // twelve people
      murmurGain = m.gain; murmurFilter = m.filter;
    } catch (e) { /* audio is optional */ }
  }

  function beat() {
    if (!ctx || !active) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 44; g.gain.value = 0;
    o.connect(g).connect(ctx.destination); o.start();
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.linearRampToValueAtTime(0, t + 0.22);
    o.stop(t + 0.25);
  }

  function setDrone(on) {
    active = on;
    if (droneGain && ctx) droneGain.gain.linearRampToValueAtTime(on ? 0.05 : 0, ctx.currentTime + 0.08);
    // Withitness ducks the room: everything drops out for half a second.
    if (hvacGain && ctx) hvacGain.gain.linearRampToValueAtTime(on ? 0.002 : 0.014, ctx.currentTime + 0.14);
  }

  // Ambient murmur scales with how restless the room is. In Withitness it is
  // replaced by the drone, so it ducks out.
  function setMurmur(level, ducked) {
    if (!ctx || !murmurGain) return;
    const want = ducked ? 0.001 : 0.004 + level * 0.03;
    if (Math.abs(want - murmurTarget) < 0.0006) return;
    murmurTarget = want;
    murmurGain.gain.linearRampToValueAtTime(want, ctx.currentTime + 0.4);
    murmurFilter.frequency.linearRampToValueAtTime(620 + level * 500, ctx.currentTime + 0.4);
  }

  // A chair. Twelve-year-olds move in chairs constantly and you stop hearing it
  // until the day it stops.
  function scrape(amount = 1) {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 900; f.Q.value = 5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(ctx.destination);
    const t = ctx.currentTime;
    src.start(t, Math.random() * 2);
    g.gain.linearRampToValueAtTime(0.035 * amount, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.1);
    src.stop(t + 0.35);
  }

  function tone(freq, dur, gainValue, type = 'sine') {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = 0;
    o.connect(g).connect(ctx.destination); o.start();
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(gainValue, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.stop(t + dur + 0.05);
  }

  // ---- the whisper ------------------------------------------------------
  //
  // Treatment §3.2: "conversations you couldn't hear normally arrive as
  // intelligible fragments with a slight radio-comms crackle, panned to their
  // position in the room." Panned is a PannerNode; intelligible is not, and
  // deliberately: a fragment in data/tells.json is a phrase, and what gets
  // rendered is one band-passed noise burst per syllable at a vowel-derived
  // centre frequency. You hear the rhythm of a sentence and its shape and you
  // never hear a word, which is what it is like to stand eight metres from two
  // twelve-year-olds who are not talking to you.

  // Roughly where each vowel sits. Not phonetics, just enough spread that two
  // fragments do not sound like the same fragment.
  const VOWEL = { a: 760, e: 560, i: 380, o: 480, u: 340, y: 420 };

  // A syllable is a vowel group. "listen" is two, "wait" is one, which is the
  // only thing about a phrase this needs to get right.
  function syllables(phrase) {
    const out = [];
    for (const m of phrase.toLowerCase().matchAll(/[aeiouy]+/g)) {
      out.push(VOWEL[m[0][0]] || 460);
    }
    return out.length ? out : [460];
  }

  // One fragment: a burst per syllable, falling slightly the way a sentence
  // does, with the crackle riding on top of it rather than beside it.
  function speak(w, phrase) {
    const parts = syllables(phrase);
    let at = ctx.currentTime + 0.05;
    parts.forEach((freq, i) => {
      const dur = 0.075 + Math.random() * 0.06;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * (1 - i / (parts.length * 3));   // the fall
      f.Q.value = 7;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(w.gain);
      src.start(at, Math.random() * 2);
      g.gain.linearRampToValueAtTime(0.85 + Math.random() * 0.3, at + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.stop(at + dur + 0.02);
      at += dur + 0.02 + Math.random() * 0.05;
    });
    return at - ctx.currentTime;
  }

  function scheduleNext(w) {
    const [lo, hi] = CFG.whisper.gapSeconds;
    const spoken = w.fragments.length ? speak(w, w.fragments[Math.floor(Math.random() * w.fragments.length)]) : 0.4;
    const gap = lo + Math.random() * (hi - lo);
    w.timer = setTimeout(() => { if (whispers.has(w.id)) scheduleNext(w); }, (spoken + gap) * 1000);
  }

  // Start a conversation at a point in the room. Silent until setWhisperLevel
  // says otherwise, so a whisper that is born behind you does not announce
  // itself at full volume.
  function startWhisper(id, pos, fragments) {
    if (!ctx || !noiseBuf || whispers.has(id)) return;
    const W = CFG.whisper;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = W.refDistance;
    panner.rolloffFactor = W.rolloff;
    panner.maxDistance = W.maxDistance;
    if (panner.positionX) {
      panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(panner).connect(ctx.destination);
    const w = { id, gain, panner, fragments: fragments || [], timer: null, level: 0 };
    whispers.set(id, w);
    scheduleNext(w);
  }

  // How audible this one is right now. Withitness ducks the room down and the
  // whisper UP; furniture in the way attenuates it and never removes it, which
  // makes it the one cue in the game that survives a blind spot.
  function setWhisperLevel(id, { withitness, occluded }) {
    const w = whispers.get(id);
    if (!w || !ctx) return;
    const W = CFG.whisper;
    const want = (withitness ? W.gain : W.ambientGain) * (occluded ? W.occludedScale : 1);
    if (Math.abs(want - w.level) < 0.002) return;
    w.level = want;
    w.gain.gain.linearRampToValueAtTime(want, ctx.currentTime + 0.25);
  }

  function stopWhisper(id) {
    const w = whispers.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    if (ctx) w.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    whispers.delete(id);
  }

  // The listener is the teacher. Without this every panner would sit relative
  // to the origin and the room would stay stubbornly in front of you no matter
  // which way you turned.
  //
  // The forward vector comes out of the camera's world matrix rather than from
  // getWorldDirection(), which wants a THREE.Vector3 to write into and throws
  // on anything else — audio.js does not import three and is not going to
  // start. Columns 0/1/2 of matrixWorld are the camera's right/up/back axes,
  // so forward is the negated third one.
  function setListener(camera) {
    if (!ctx) return;
    const L = ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld?.elements;
    const f = e ? { x: -e[8], y: -e[9], z: -e[10] } : { x: 0, y: 0, z: -1 };
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  const blip = () => tone(1320, 0.09, 0.028, 'triangle');
  const chime = () => { tone(784, 0.5, 0.03); tone(1176, 0.55, 0.018); };

  function bell() {
    if (!ctx) return;
    [880, 1180].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f; g.gain.value = 0;
      o.connect(g).connect(ctx.destination); o.start();
      const t = ctx.currentTime + i * 0.02;
      g.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.stop(t + 1.7);
    });
  }

  return { init, setDrone, setMurmur, scrape, blip, chime, bell,
           startWhisper, setWhisperLevel, stopWhisper, setListener };
}
