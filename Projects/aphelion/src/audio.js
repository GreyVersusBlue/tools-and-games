// Minimal procedural audio — no asset files needed.
// A soft ship hum, interaction clicks, and gentle chimes.

let ctx = null;
let humGain = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Ship hum: two detuned low sines through a lowpass.
    humGain = ctx.createGain();
    humGain.gain.value = 0.028;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220;
    humGain.connect(lp).connect(ctx.destination);

    for (const f of [58.27, 58.9, 116.5]) { // ~B-flat, slightly detuned
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f > 100 ? 0.3 : 1;
      o.connect(g).connect(humGain);
      o.start();
    }
  } catch (e) { ctx = null; }
}

export function setHumLevel(x) { // 0..1 comfort — quieter, thinner hum when systems are low
  if (humGain) humGain.gain.setTargetAtTime(0.012 + 0.016 * x, ctx.currentTime, 0.5);
}

function blip(freq, dur, gain, type = 'sine', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  click()  { blip(1400, 0.06, 0.05, 'triangle'); },
  step()   { blip(320, 0.10, 0.06, 'sine'); blip(480, 0.12, 0.04, 'sine', 0.09); },
  done()   { blip(523, 0.25, 0.06); blip(659, 0.3, 0.06, 'sine', 0.12); blip(784, 0.5, 0.05, 'sine', 0.24); },
  chime()  { blip(880, 0.6, 0.04); blip(660, 0.8, 0.03, 'sine', 0.2); },
  water()  { blip(900, 0.08, 0.04, 'sine'); blip(700, 0.1, 0.03, 'sine', 0.06); blip(1100, 0.09, 0.03, 'sine', 0.12); },
  airlock(){ blip(180, 0.9, 0.06, 'sawtooth'); blip(90, 1.2, 0.05, 'sine', 0.1); },
  scan()   { blip(1200, 0.1, 0.03, 'square'); blip(1500, 0.1, 0.03, 'square', 0.15); },
};
