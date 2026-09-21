// node test/wave.mjs
//
// The platoon visualiser's model (M7), on Two Blocks as shipped. Exits
// non-zero on any FAIL (#13). No canvas: drawWave is the browser suite's.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { levelById } = await load('levels/pack-01.js');
const { WAVE, EAST, WEST, arrival, platoonLines, waveModel, WaveHistory } = await load('wave.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const f1 = x => x.toFixed(1);

group('arithmetic');

ok(Math.abs(arrival(-110, 5, 110, 14) - (5 + 220 / 14)) < 1e-9, 'a platoon released at -110 at 5 s reaches +110 at 14 m/s 15.7 s later, at 20.7', f1(arrival(-110, 5, 110, 14)));
ok(arrival(110, 5, -110, 14) === arrival(-110, 5, 110, 14), 'and the same westbound');
{
  const nodes = [{ x: -110, east: [{ from: 0, to: 4, head: 'red' }, { from: 4, to: 26, head: 'green' }], west: [] }, { x: 110, east: [], west: [{ from: 0, to: 10, head: 'green' }, { from: 10, to: 30, head: 'red' }, { from: 30, to: 50, head: 'green' }] }];
  const lines = platoonLines(nodes, 14);
  ok(lines.length === 2 && lines[0].dir === 'east' && lines[0].t0 === 4 && lines[1].dir === 'west' && lines[1].t0 === 30, 'a line per green start to come: the eastbound at 4 s, the westbound at 30 s (the green already running has no start ahead)', lines.map(l => `${l.dir} ${l.t0}`).join(', '));
  ok(Math.abs(lines[0].t1 - (4 + 220 / 14)) < 1e-9 && lines[0].x1 === 110, 'the eastbound line lands on the east box 15.7 s after it left', f1(lines[0].t1));
  ok(platoonLines([nodes[0]], 14).length === 0, 'one box draws no line');
}

group('Two Blocks as shipped');

{
  const w = new World(levelById('two-blocks'), 1);
  w.run(30);
  const m = waveModel(w);
  ok(m.nodes.length === 2 && m.nodes[0].x === -110 && m.nodes[1].x === 110 && m.nodes[0].name === 'West' && m.nodes[1].name === 'East', 'two columns 220 m apart, West and East', m.nodes.map(n => `${n.name} ${n.x}`).join(', '));
  ok(m.extent[0] === -220 && m.extent[1] === 220, 'the extent is a leg past each box', m.extent.join(' to '));
  ok(m.ahead === WAVE.ahead && m.speed === 14, 'fifty seconds ahead at a standard car\'s 14 m/s', `${m.ahead} s, ${m.speed} m/s`);
  const covers = runs => runs.length && runs[0].from === 0 && Math.abs(runs.at(-1).to - m.ahead) < 1e-9 && runs.every((r, i) => i === 0 || r.from === runs[i - 1].to);
  ok(m.nodes.every(n => covers(n.east) && covers(n.west)), 'every column\'s forecast covers the fifty seconds without a gap');
  // the east box runs 16 s behind: its head at t is the west box's at t + 16, to the forecast's quarter second
  const L = w.controllers[0].cycleLength();
  const headAt = (runs, t) => { const r = runs.find(r => t >= r.from && t < r.to); return r ? r.head : null; };
  // seconds from t to the nearest green start in the runs: 220 m at 14 m/s is
  // 15.7 s against a 16 s offset, so a line meeting the wave lands 0.3 s
  // before the green and a real platoon, starting from rest, just after it
  const toGreen = (runs, t) => Math.min(...runs.filter(r => r.head === 'green').map(r => Math.abs(t - r.from)));
  let agree = 0, total = 0;
  for (let t = 0; t + 16 < m.ahead; t += 0.25) { total++; if (headAt(m.nodes[1].east, t) === headAt(m.nodes[0].east, t + 16)) agree++; }
  ok(agree === total && total > 100, 'the east column is the west column 16 s later, at every quarter second in the window', `${agree} of ${total}, cycle ${L} s`);
  // the lines: the eastbound one from the west box's next green lands where the east column is red (the level's known compromise: the wave runs west)
  // where the lines land: judged over two cycles so a line that leaves the
  // page's fifty-second window before it lands still has a head to land in
  const wide = waveModel(w, { ahead: 100 });
  const lands = l => l.t1 < wide.ahead;
  const east = wide.lines.filter(l => l.dir === 'east' && lands(l)), west = wide.lines.filter(l => l.dir === 'west' && lands(l));
  ok(east.length >= 2 && west.length >= 2, 'two lines each way land within a hundred seconds', `${east.length} east, ${west.length} west, ${wide.lines.length} drawn`);
  ok(west.every(l => toGreen(wide.nodes[0].west, l.t1) < 1), 'every westbound platoon from the east box\'s green start lands within a second of a west green\'s start', west.map(l => `${f1(l.t0)} → ${f1(l.t1)}, ${f1(toGreen(wide.nodes[0].west, l.t1))} s off`).join(', '));
  ok(east.every(l => headAt(wide.nodes[1].east, l.t1) === 'red' && toGreen(wide.nodes[1].east, l.t1) > 8), 'and every eastbound one from the west box\'s green start lands in an east red with more than 8 s to the green, which is the picture the slider exists to change', east.map(l => `${f1(l.t0)} → ${f1(l.t1)} ${headAt(wide.nodes[1].east, l.t1)}, ${f1(toGreen(wide.nodes[1].east, l.t1))} s off`).join(', '));
  // move the offset and the model follows once the shift is paid
  w.setOffset(27);
  w.run(60);
  const m2 = waveModel(w);
  agree = 0; total = 0;
  for (let t = 0; t + 27 < m2.ahead; t += 0.25) { total++; if (headAt(m2.nodes[1].east, t) === headAt(m2.nodes[0].east, t + 27)) agree++; }
  ok(agree === total && total > 80, 'after setOffset(27) and a minute the east column is the west column 27 s later', `${agree} of ${total}`);
  const wide2 = waveModel(w, { ahead: 100 });
  const east2 = wide2.lines.filter(l => l.dir === 'east' && l.t1 < wide2.ahead);
  ok(east2.length >= 2 && east2.every(l => toGreen(wide2.nodes[1].east, l.t1) < 1), 'and now the eastbound platoons land within a second of an east green\'s start', east2.map(l => `${f1(l.t0)} → ${f1(l.t1)}, ${f1(toGreen(wide2.nodes[1].east, l.t1))} s off`).join(', '));
  ok(waveModel(w).nodes[0].east.length === m2.nodes[0].east.length && w.controllers[0].log.length === w.controllers[0].log.length, 'building the model does not step the world');
}

group('the history');

{
  const w = new World(levelById('two-blocks'), 1);
  const h = new WaveHistory({ past: 10, every: 0.5 });
  ok(h.sample(w) && !h.sample(w), 'the first sample takes, a second at the same time does not');
  let taken = 0;
  for (let i = 0; i < 60 * 40; i++) { w.step(); if (h.sample(w)) taken++; }
  ok(taken === 80, 'forty seconds at two a second is 80 samples', String(taken));
  ok(h.samples.length === 21 && h.samples[0].t >= w.t - 10 - 1e-6, 'and ten seconds of them are kept', `${h.samples.length}, oldest ${f1(w.t - h.samples[0].t)} s back`);
  const last = h.samples.at(-1);
  ok(last.dots.length > 0 && last.dots.every(d => d.dir === 'east' || d.dir === 'west') && last.dots.every(d => Math.abs(d.x) <= 220), 'the dots are main-street cars with a direction and an x on the corridor', `${last.dots.length} dots`);
  const side = w.cars.filter(c => !c.done && (c.path.entry === 'N' || c.path.entry === 'S')).length;
  ok(side > 0 && last.dots.length < w.cars.filter(c => !c.done).length, 'the side streets\' cars are not in it', `${side} side-street cars on the map`);
  ok(last.heads.length === 2 && last.heads.every(x => [EAST, WEST].length && typeof x.east === 'string' && typeof x.west === 'string'), 'and each box\'s two through heads ride along', JSON.stringify(last.heads));
  h.reset();
  ok(h.samples.length === 0 && h.sample(w), 'reset empties it and the next sample takes');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
