// Sub-bass drone plus your own heartbeat, slightly too fast. Under all of it,
// the room: HVAC, twelve people breathing, and the specific sound of a chair.
export function createAudio() {
  let ctx = null, droneGain = null, beatTimer = null, active = false;
  let hvacGain = null, murmurGain = null, murmurFilter = null, noiseBuf = null;
  let murmurTarget = 0;
  let whisperGate = null, whisperPanner = null, whisperActive = false;

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

  // A soft asymmetric clip — enough harmonic garbage to read as a bad radio,
  // not distortion-pedal fuzz.
  function crackleCurve() {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2) * 0.9;
    }
    return curve;
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

      // T8 — a whisper conversation you cannot make out normally. Withitness
      // is what turns it from room noise into a directional, panned, crackly
      // thing you can place. One voice: the schedule never runs two whispers
      // at once, and if a future one did, they'd share it rather than stack.
      const whisperSrc = ctx.createBufferSource();
      whisperSrc.buffer = noiseBuf; whisperSrc.loop = true;
      const voiceFilter = ctx.createBiquadFilter();
      voiceFilter.type = 'bandpass'; voiceFilter.frequency.value = 1050; voiceFilter.Q.value = 3.4;
      const crackle = ctx.createWaveShaper();
      crackle.curve = crackleCurve();
      const pulseGain = ctx.createGain(); pulseGain.gain.value = 0.028;   // the murmur, always "there"
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 3.1;
      const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.02;      // the "fragments" stutter
      lfo.connect(lfoDepth).connect(pulseGain.gain);
      lfo.start();
      whisperGate = ctx.createGain(); whisperGate.gain.value = 0;         // on/off + distance falloff
      whisperPanner = ctx.createStereoPanner();
      whisperSrc.connect(voiceFilter).connect(crackle).connect(pulseGain)
        .connect(whisperGate).connect(whisperPanner).connect(ctx.destination);
      whisperSrc.start();
    } catch (e) { /* audio is optional */ }
  }

  // Called every frame with whatever the room's one live whisper resolves to.
  // level 0..1 is distance falloff; the caller has already decided whether
  // Withitness is even on.
  function setWhisper(pan, level) {
    if (!ctx || !whisperGate) return;
    const on = level > 0;
    if (on !== whisperActive) {
      whisperActive = on;
      whisperPanner.pan.setTargetAtTime(pan, ctx.currentTime, 0.05);
    } else if (on) {
      whisperPanner.pan.setTargetAtTime(pan, ctx.currentTime, 0.15);
    }
    whisperGate.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, level)), ctx.currentTime + 0.12);
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

  return { init, setDrone, setMurmur, scrape, blip, chime, bell, setWhisper };
}
