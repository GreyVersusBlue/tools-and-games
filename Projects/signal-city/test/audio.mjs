// node test/audio.mjs
//
// The sound (R7), against a stub AudioContext that records what it is asked
// to make. Whether it sounds right is H3, a person with ears; this checks
// what a seeded Rush Hour asks to play. Exits non-zero on any FAIL (#13).

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { Sound, HORN_CAP, HORNS } = await load('audio.js');
const { World } = await load('sim.js');
const { levelById } = await load('levels/pack-01.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

// The stub: every node is an object whose params take any automation call,
// and the context counts what it made and what was started.
class Param {
  constructor(v = 0) { this.value = v; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); }
  setTargetAtTime(v, t, k) { this.calls.push(['target', v, t, k]); this.value = v; }
}
let contexts = 0;
class StubCtx {
  constructor() { contexts++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.made = {}; this.started = 0; }
  node(kind, extra = {}) {
    this.made[kind] = (this.made[kind] || 0) + 1;
    const ctx = this;
    return { kind, connect() {}, start() { ctx.started++; }, stop() {}, ...extra };
  }
  createGain() { return this.node('gain', { gain: new Param(1) }); }
  createOscillator() { return this.node('osc', { frequency: new Param(440), type: 'sine' }); }
  createBiquadFilter() { return this.node('filter', { frequency: new Param(350), type: 'lowpass' }); }
  createStereoPanner() { return this.node('pan', { pan: new Param(0) }); }
  createBufferSource() { return this.node('source', { buffer: null, loop: false }); }
  createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  resume() { this.state = 'running'; }
}

group('the context waits for the first input, and the switch');

{
  contexts = 0;
  const s = new Sound({ Ctx: StubCtx });
  const w = new World(levelById('first-light'), 1);
  w.run(5);
  s.take(w, w.t);
  ok(contexts === 0 && s.played.length === 0, 'nothing is made or played before start(): a page may not start audio on its own', `${contexts} contexts`);
  s.start();
  ok(contexts === 1 && s.live, 'the first input makes the context');
  s.start();
  ok(contexts === 1, 'and a second input does not make another');
  const off = new Sound({ Ctx: StubCtx, enabled: false });
  ok(!off.start() && contexts === 1, 'with settings.sound off, an input makes nothing');
  off.setEnabled(true);
  ok(contexts === 2 && off.live, 'switching it on makes the context then');
  w.events.push({ t: w.t, kind: 'honk', car: w.cars[0] ? w.cars[0].id : -1 });
  off.setEnabled(false);
  off.take(w, w.t);
  ok(!off.played.some(p => p.kind === 'horn'), 'and switched off again, a honk plays nothing');
}

group('the horn cap');

{
  const s = new Sound({ Ctx: StubCtx });
  s.start();
  const played = [];
  for (let i = 0; i < 10; i++) played.push(s.horn('standard', 1 + i * 0.01));
  ok(played.filter(Boolean).length === HORN_CAP && s.dropped === 10 - HORN_CAP, `ten honks in a tenth of a second play ${HORN_CAP}`, `${played.filter(Boolean).length} played, ${s.dropped} dropped`);
  ok(s.horn('standard', 2.0), 'and a second later the next one plays');
  ok(HORNS.trucker.notes[0] < HORNS.standard.notes[1] && HORNS.aggressive.times > 1 && HORNS.aggressive.len < HORNS.standard.len, 'the trucker\'s horn is the low one, the aggressive driver\'s short and repeated');
  const before = s.ctx.made.osc;
  s.horn('trucker', 5);
  ok(s.ctx.made.osc - before === HORNS.trucker.notes.length, 'a horn is one oscillator per note of its archetype', `${s.ctx.made.osc - before}`);
}

group('a seeded Rush Hour: what it asks to play');

{
  const lvl = levelById('rush-hour');
  const w = new World(lvl, 1);
  const s = new Sound({ Ctx: StubCtx });
  s.start();
  let honks = 0, spawnAt = null, goneAt = null, ambulance = null, crashes = 0, surgeHonks = 0;
  const surge = lvl.events.find(e => e.kind === 'surge');
  const nears = [];
  for (let i = 0; i < lvl.duration * 60; i++) {
    w.step();
    for (const e of w.events) {
      if (e.kind === 'honk') { honks++; if (w.t >= surge.at && w.t < surge.at + surge.for) surgeHonks++; }
      if (e.kind === 'collision') crashes++;
      if (e.kind === 'spawn' && e.archetype === 'emergency') { spawnAt = w.t; ambulance = e.car; }
    }
    s.take(w, w.t, { x0: -60, x1: 60 });
    if (s.siren) nears.push(s.siren.near);
    if (ambulance !== null && goneAt === null && w.cars.find(c => c.id === ambulance)?.done) goneAt = w.t;
    w.events.length = 0;   // the renderer's drain
    if (w.over) break;
  }
  const starts = s.played.filter(p => p.kind === 'siren-start'), stops = s.played.filter(p => p.kind === 'siren-stop');
  ok(spawnAt !== null && starts.length === 1 && Math.abs(starts[0].t - spawnAt) < 1e-9 && starts[0].car === ambulance, 'the siren starts on the step the ambulance spawns', `spawn ${spawnAt?.toFixed(2)} s, siren ${starts.map(p => p.t.toFixed(2)).join(', ')}`);
  ok(goneAt !== null && stops.length === 1 && Math.abs(stops[0].t - goneAt) < 1e-9, 'and stops on the step it leaves the map', `gone ${goneAt?.toFixed(2)} s, stop ${stops.map(p => p.t.toFixed(2)).join(', ')}`);
  const rose = nears.length > 10 && Math.max(...nears) > 0.9 && nears[0] < Math.max(...nears);
  ok(rose, 'it is louder near the box than where it came in', `from ${nears[0]?.toFixed(2)} to ${Math.max(...nears).toFixed(2)}`);
  const horns = s.played.filter(p => p.kind === 'horn');
  let worst = 0;
  for (const h of horns) worst = Math.max(worst, horns.filter(o => o.t > h.t - 1 && o.t <= h.t).length);
  // seed 1 never asks for more than the cap in a second, so this line holds
  // with the cap removed too (#147); the next group is the one that makes it bite
  ok(honks > 0 && worst <= HORN_CAP, `no second of it plays more than ${HORN_CAP} horns (it never asks for more)`, `${honks} honks (${surgeHonks} in the surge), ${horns.length} played, at most ${worst} in a second`);
  ok(horns.length + s.dropped === honks, 'every honk is either played or dropped by the cap', `${horns.length} + ${s.dropped} of ${honks}`);
  ok(s.played.filter(p => p.kind === 'crash').length === crashes, 'one crash for every collision', `${crashes}`);
  const clicks = s.played.filter(p => p.kind === 'click').length;
  ok(clicks > 10, 'the relay clicks as the signal changes', `${clicks} clicks`);
  ok(s.bed && s.bed.level > 0, 'and the traffic bed follows the cars on the map', s.bed ? s.bed.level.toFixed(3) : 'none');
  s.quiet();
  ok(!s.bed && !s.siren, 'quiet() stops everything continuous');
}

group('a surge is a jam, not a noise');

{
  // the surge seeded and stepped as above can only show the cap holding;
  // this packs a surge's honks into a second to show it biting
  const w = new World(levelById('rush-hour'), 2);
  w.run(90);
  const s = new Sound({ Ctx: StubCtx });
  s.start();
  const cars = w.cars.filter(c => !c.done).slice(0, 8);
  for (const c of cars) w.events.push({ t: w.t, kind: 'honk', car: c.id });
  s.take(w, 100);
  ok(cars.length === 8 && s.played.filter(p => p.kind === 'horn').length === HORN_CAP, `eight cars honking in one frame play ${HORN_CAP} horns`, `${cars.length} cars`);
  ok(s.played.filter(p => p.kind === 'horn').every(p => cars.some(c => c.archetype === p.archetype)), 'each voiced by its own driver');
}

group('the push-button');

{
  const w = new World(levelById('crossing'), 3);
  const s = new Sound({ Ctx: StubCtx });
  s.start();
  let calls = 0, walks = 0;
  for (let i = 0; i < 90 * 60; i++) {
    w.step();
    for (const e of w.events) { if (e.kind === 'call') calls++; if (e.kind === 'walk') walks++; }
    s.take(w, w.t);
    w.events.length = 0;
  }
  const chirps = s.played.filter(p => p.kind === 'chirp');
  ok(calls + walks > 0 && chirps.length === calls + walks, 'Crossing chirps once for every call and every WALK', `${calls} calls, ${walks} walks, ${chirps.length} chirps`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
