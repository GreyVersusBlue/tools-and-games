// node tools/calibrate.mjs [level-id|all] [cycles]      e.g. node tools/calibrate.mjs stem 18,22,30,55
//
// The calibration table behind a level's target and waitTarget (#540): six
// seeds by four fixed cycles, cleared / average wait / collisions / stars per
// cell. A tool, not a check: it prints and exits 0. The numbers a level ships
// with go in HISTORY.md with the level.
//
// A fixed cycle is one elapsed rule, `next` every N seconds, so every phase
// gets N seconds of green. With `--plan` a four-phase level runs a timed plan
// instead: N for the through phases, N/2 (or `--lefts=8`) for the left phases. With
// `--two-phase` a protected-left level is run on the permissive two-phase set
// instead of its own, to show what the lefts phases buy. A corridor level
// (M6) always runs a timed plan, N for the main street and 0.55 N for the
// side street, and `--offsets=0,8,16,24` adds an axis: one row per cycle
// and offset, the second box's plan shifted by that many seconds.
// Pedestrian calls and loops run as the level ships them. The cycle
// replaces the level's rule list, except with `--rules`, which keeps the
// list (a level's queue rules on its loops) and sets only its elapsed
// rule's seconds to the cycle: that is how a level with sensors is played.
// `--hold` plays a platoon level the way a hand would (M7): the platoon's
// phase asked for as its lead comes within 60 m of the line, and the green
// pressed again every 10 s until the last member is through the box. A
// level with platoons prints a splits column either way.
// `--ring` plays the board as the roundabout converts it (loadout with the
// roundabout bought, #595): one row, no cycle, scored against the level's
// `ring` calibration. A board the roundabout does not convert is skipped.
// `--endless` (M9) plays endless's days hands-off instead, the grid's 20 s
// rule at every box: `node tools/calibrate.mjs endless 1,2,3,12` prints a
// row per day (cleared against the day's target, LOCK for a locked grid)
// and, when the days start at 1 and run on unbroken, each seed's first
// missed day. Twelve boxes cost about 13 s a run. #609 has the table.
// `--baseline` (R1) plays every level exactly as it ships with no input,
// and `--hand` plays it with the reference hand (handStep below), or with
// `--hand=phases,platoons,corridor,offset` only the parts named; both at
// once add a table of the hand against no input. They print markdown tables
// HISTORY.md can quote, one row a level: `node tools/calibrate.mjs all
// --baseline --hand` is about 25 minutes in a cloud container, most of it
// Two Blocks' offset sweep.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { score } = await load('scoring.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { standardPhases } = await load('signals.js');
const { loadout, convertible } = await load('campaign.js');
const { dayLevel, daySeed } = await load('endless.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const which = args[0] || 'all';
const cycles = (args[1] || '18,22,30,55').split(',').map(Number);
const seeds = [1, 2, 3, 4, 5, 6];
const timingArg = flags.find(f => f.startsWith('--allred='));
const allRedOverride = timingArg ? Number(timingArg.split('=')[1]) : null;
const leftsArg = flags.find(f => f.startsWith('--lefts='));
const leftsGreen = leftsArg ? Number(leftsArg.split('=')[1]) : null;
const offsetsArg = flags.find(f => f.startsWith('--offsets='));
const offsets = offsetsArg ? offsetsArg.split('=')[1].split(',').map(Number) : null;

export const isCorridor = level => (level.network && level.network.nodes) > 1;

export function controllerFor(level, cycle, { plan = false, twoPhase = false, allRed = null, rules = false, lefts = null } = {}) {
  const base = { ...(level.controller || {}) };
  if (allRed !== null) base.timing = { ...(base.timing || {}), allRed };
  if (rules && base.rules) {
    return { ...base, mode: 'manual', plan: null, rules: base.rules.map(r => (r.when === 'elapsed' ? { ...r, seconds: cycle } : { ...r })) };
  }
  if (twoPhase) base.phases = standardPhases(level.network.legs);
  const phases = base.phases || standardPhases(level.network.legs, { lefts: base.lefts, peds: base.peds, main: base.main });
  if (isCorridor(level)) {
    return { ...base, mode: 'timed', rules: [], plan: [{ phase: 0, green: cycle }, { phase: 1, green: Math.round(cycle * 0.55) }] };
  }
  if (plan && phases.length === 4) {
    const l = lefts ?? cycle / 2;
    return { ...base, mode: 'timed', rules: [], plan: [{ phase: 0, green: cycle }, { phase: 1, green: l }, { phase: 2, green: cycle }, { phase: 3, green: l }] };
  }
  return { ...base, mode: 'manual', plan: null, rules: [{ when: 'elapsed', seconds: cycle, then: 'next' }] };
}

// The hand under a platoon (M7): once per step. The platoon's phase is the
// one carrying its movement; the green is held (holdGreen, the elapsed
// rule's clock restarted) every 10 s while any member is short of its box
// exit, and the hold stops there, not when the last member leaves the map.
// Returns the node it is holding, or -1.
export function holdPlatoon(w) {
  const p = w.platoon;
  if (!p) return -1;
  const ctl = w.controllers[p.node];
  const lead = p.cars[0];
  if (lead.front < lead.path.stopLine - 60) return -1;
  if (p.cars.length >= p.size && p.cars.every(c => c.done || c.rear > c.path.boxExit)) return -1;
  const want = ctl.phases.findIndex(ph => ph.movements.includes(lead.path.movement));
  if (want < 0) return -1;
  if (ctl.phase !== want || ctl.stage !== 'green') { if (ctl.next !== want) w.requestPhase(want, p.node); return p.node; }
  if (p._heldAt === undefined || w.t - p._heldAt >= 10) { if (w.holdGreen(p.node)) p._heldAt = w.t; }
  return p.node;
}

// One run. `offset` (a corridor only) shifts the second box's plan.
export function cell(level, seed, cycle, opts = {}, offset = null) {
  const lvl = opts.ring ? loadout(level, ['roundabout']) : { ...level, controller: controllerFor(level, cycle, opts) };
  if (offset !== null) lvl.controllers = [{ offset: 0 }, { offset }];
  const w = new World(lvl, seed);
  for (let i = 0; i < level.duration * 60; i++) { w.step(); if (opts.hold) holdPlatoon(w); if (w.stats.gridlock) break; }
  const r = score(w);
  return { cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, gridlock: w.stats.gridlock, stars: r.stars, survived: r.survived, pedLate: r.pedLate, pedServed: r.pedServed, splits: r.splits, platoons: r.platoons };
}

// ---- the reference hand (R1) ------------------------------------------------
//
// One scripted good player, a yardstick for R2 and not a solver. Every
// command goes through the World the way the page's own buttons do; the
// hand decides only when and which. Per step: holdPlatoon under a platoon,
// the corridor for every emergency vehicle or motorcade car the moment it
// is on the map (priorityNearest, without waiting for E), and at the end
// of each green the phase whose queue has waited longest. A timed plan is
// left to run: on a corridor the plan is the lesson, and the hand's part
// there is the offset, swept at load (handOffset).

export const HAND_MAX = 25;   // seconds a green is held for its own queue before the hand serves the next-longest: under boxStall, where a left waiting mid-box locks the board

// What the player sees waiting on a phase: cars stopped short of the box on
// any of its movements, loop or none, each weighed as one plus the seconds
// it has waited. A player reads the screen, not the loops, so this is not
// World.queued, which answers for a sensor. By count alone a lone left
// never outweighs a through queue: Four Ways' W-L trucker waited 180 s and
// locked the board on 4 of 6 seeds.
function waiting(w, node, phase) {
  const mv = [...phase.movements, ...phase.permissive];
  let n = 0;
  for (const c of w.cars) if (!c.done && c.path.node === node && mv.includes(c.path.movement) && c.front < c.path.boxEnter && c.v < 1) n += 1 + c.wait;
  return n;
}

// The queue-greedy choice at one box. A green ends where the controller
// would end it (the elapsed rule's clock, as the page's own timer reads it),
// or on a box with no rule where the hand ends it: its own queue empty and
// another waiting, or HAND_MAX run. The controller keeps the minimum green.
function greedy(w, node, max = HAND_MAX) {
  const ctl = w.controllers[node];
  if (ctl.roundabout || w.powerOut || ctl.mode === 'timed' || ctl.stage !== 'green' || ctl.next !== null || ctl.preemption || ctl.walk) return;
  const left = ctl.timeToYellow(ctl.current.movements[0]);
  const q = ctl.phases.map(p => waiting(w, node, p));
  const others = q.map((n, i) => (i === ctl.phase ? -1 : n));
  const other = others.indexOf(Math.max(...others));
  if (left !== Infinity) {
    // a hold restarts the rule's clock, so the cap is kept here: past max
    // the green goes to the next-longest queue whatever the clock says
    if (ctl.stageT >= max && q[other] > 0) { w.requestPhase(other, node); return; }
    if (left > 1 / 60 + 1e-9) return;
    if (q[ctl.phase] >= q[other] && ctl.stageT < max) { w.holdGreen(node); return; }
    if (q[other] > 0) w.requestPhase(other, node);
    return;
  }
  if (ctl.stageT < ctl.timing.minGreen || q[other] === 0) return;
  if (q[ctl.phase] === 0 || ctl.stageT >= max) w.requestPhase(other, node);
}

export function handStep(w, { platoons = true, corridor = true, phases = true, max = HAND_MAX } = {}) {
  const held = platoons ? holdPlatoon(w) : -1;   // a box held under a platoon is the platoon's, not the greedy's
  if (corridor) for (const c of w.cars) if (!c.done && !c.priority && (c.archetype === 'emergency' || c.archetype === 'motorcade')) w.requestPriority(c);
  if (phases) for (let n = 0; n < w.controllers.length; n++) if (n !== held) greedy(w, n, max);
}

// One run of a level exactly as it ships: no input, or the hand. `offset`
// (a corridor) is set through World.setOffset right after load, the way the
// Timing tab's slider sets it, each box after the first that much further on.
export function played(level, seed, { hand = false, offset = null } = {}) {
  const parts = typeof hand === 'object' ? hand : {};
  const w = new World(level, seed);
  if (offset !== null) for (let n = 1; n < w.controllers.length; n++) w.setOffset(offset * n, n);
  for (let i = 0; i < level.duration * 60; i++) { w.step(); if (hand) handStep(w, parts); if (w.stats.gridlock) break; }
  const r = score(w);
  return { cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, gridlock: w.stats.gridlock, stars: r.stars, ambulanceLate: w.stats.ambulanceLate, splits: r.splits, pedLate: r.pedLate };
}

// The offset the hand plays a corridor at: every 4 s round the second box's
// cycle, six seeds each, and the best kept (most stars, then most cleared,
// then least wait). Every 2 s doubles a sweep that already costs Two Blocks
// 66 runs. Null on a single box.
export function handOffset(level, parts = {}) {
  if (!isCorridor(level)) return null;
  const L = new World(level, 1).controllers[1].cycleLength();
  let best = null;
  const sweep = [];
  for (let o = 0; o < L; o += 4) {
    const rows = seeds.map(s => played(level, s, { hand: parts, offset: o }));
    const key = [rows.reduce((a, r) => a + r.stars, 0), rows.reduce((a, r) => a + r.cleared, 0), -rows.reduce((a, r) => a + r.wait, 0)];
    sweep.push(`${o} s: ${key[0]} stars, ${key[1]} cleared`);
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = { offset: o, key, rows };
  }
  return { ...best, sweep };
}

// A row's cells and its summary, as a markdown table row HISTORY.md can quote.
const cellText = c => `${c.gridlock ? 'LOCK' : c.cleared} ${c.wait.toFixed(0)}s ${'★'.repeat(c.stars) + '☆'.repeat(3 - c.stars)}${c.collisions ? ` ${c.collisions}x` : ''}${c.ambulanceLate ? ` ${c.ambulanceLate}A` : ''}${c.splits ? ` ${c.splits}S` : ''}`;
const range = (xs, f = x => x) => { const a = Math.min(...xs), b = Math.max(...xs); return a === b ? f(a) : `${f(a)} to ${f(b)}`; };
function tableRow(level, rows, note = '') {
  const three = rows.filter(r => r.stars === 3).length;
  const locks = rows.filter(r => r.gridlock).length;
  return `| ${level.name}${note} | ${level.target}, ${level.waitTarget} s | ${rows.map(cellText).join(' | ')} | ${range(rows.map(r => r.cleared))} | ${range(rows.map(r => r.wait), x => x.toFixed(0))} s | ${three}/6 | ${locks}/6 |`;
}
const tableHead = title => `\n${title}\n\n| Level | target, wait | ${seeds.map(s => `seed ${s}`).join(' | ')} | cleared | wait | ★★★ | locks |\n| --- | --- | ${seeds.map(() => '---').join(' | ')} | --- | --- | --- | --- |`;

// Run as a script; importing the file (a suite borrowing controllerFor) does nothing.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const handFlag = flags.find(f => f === '--hand' || f.startsWith('--hand='));
if (isMain && (flags.includes('--baseline') || handFlag)) {
  // `--hand=phases,platoons,corridor,offset` plays only the parts named; `--hand` is all four
  const named = handFlag && handFlag.includes('=') ? handFlag.split('=')[1].split(',') : ['phases', 'platoons', 'corridor', 'offset'];
  const parts = { phases: named.includes('phases'), platoons: named.includes('platoons'), corridor: named.includes('corridor') };
  const partText = { phases: `the longest-waited queue at each green's end (held to ${HAND_MAX} s)`, platoons: 'holdPlatoon', corridor: 'the corridor on spawn', offset: "a corridor's offset swept at load" };
  const list = which === 'all' ? LEVELS : [levelById(which)].filter(Boolean);
  if (!list.length) { console.log(`no level ${which}`); process.exit(1); }
  const mean = rows => ({ cleared: rows.reduce((a, r) => a + r.cleared, 0) / rows.length, wait: rows.reduce((a, r) => a + r.wait, 0) / rows.length });
  const base = new Map(), hand = new Map(), swept = [];
  if (flags.includes('--baseline')) {
    console.log(tableHead('No input: every level as it ships, six seeds. A cell is cleared, average wait, stars; Nx collisions, NA a late ambulance, NS a split platoon.'));
    for (const level of list) { const rows = seeds.map(s => played(level, s)); base.set(level.id, rows); console.log(tableRow(level, rows)); }
  }
  if (handFlag) {
    console.log(tableHead(`The reference hand${named.length < 4 ? ', in part' : ''}: ${named.map(n => partText[n]).join('; ')}.`));
    for (const level of list) {
      const sweep = named.includes('offset') ? handOffset(level, parts) : null;
      const rows = sweep ? sweep.rows : seeds.map(s => played(level, s, { hand: parts }));
      hand.set(level.id, rows);
      console.log(tableRow(level, rows, sweep ? ` (offset ${sweep.offset} s)` : ''));
      if (sweep) swept.push(`${level.name}'s offset sweep, the hand on six seeds: ${sweep.sweep.join('; ')}.`);
    }
  }
  if (swept.length) console.log('\n' + swept.join('\n'));
  if (base.size && hand.size) {
    console.log('\nThe hand against no input, means over six seeds. "default" is a level that ships a rule or a plan.\n');
    console.log('| Level | default | no input: cleared, wait, late ambulances | hand: cleared, wait, late ambulances | hand beats it on |\n| --- | --- | --- | --- | --- |');
    for (const level of list) {
      const b = mean(base.get(level.id)), h = mean(hand.get(level.id));
      const c = level.controller || {};
      const shipsDefault = !!(c.plan || (c.rules && c.rules.length));
      const amb = rows => rows.reduce((a, r) => a + r.ambulanceLate, 0);
      const hasAmb = (level.events || []).some(e => e.kind === 'ambulance');
      const on = [h.cleared > b.cleared ? 'cleared' : '', h.wait < b.wait ? 'wait' : '', hasAmb && amb(hand.get(level.id)) < amb(base.get(level.id)) ? 'the ambulance' : ''].filter(Boolean).join(', ') || 'nothing';
      const a = rows => (hasAmb ? `, ${amb(rows)} of 6` : '');
      console.log(`| ${level.name} | ${shipsDefault ? 'yes' : 'no'} | ${b.cleared.toFixed(1)}, ${b.wait.toFixed(1)} s${a(base.get(level.id))} | ${h.cleared.toFixed(1)}, ${h.wait.toFixed(1)} s${a(hand.get(level.id))} | ${on} |`);
    }
  }
  process.exit(0);
}
if (isMain && flags.includes('--endless')) {
  const days = (args[1] || '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
  const missed = seeds.map(() => null);
  console.log(`Endless, hands-off: a 20 s rule at every box, ${dayLevel(1, 1).duration} s a day`);
  console.log('  day target  ' + seeds.map(s => `seed ${s}`.padEnd(12)).join(''));
  days.forEach((day, j) => {
    const row = seeds.map((seed, i) => {
      const lvl = dayLevel(seed, day);
      const w = new World(lvl, daySeed(seed, day));
      for (let k = 0; k < lvl.duration * 60; k++) { w.step(); if (w.stats.gridlock) break; }
      const r = score(w);
      if (!r.survived && missed[i] === null && days.slice(0, j + 1).every((d, x) => d === x + 1)) missed[i] = day;
      return `${w.stats.gridlock ? 'LOCK' : String(r.cleared).padStart(4)} ${r.avgWait.toFixed(0).padStart(3)}s`.padEnd(12);
    });
    console.log(`  ${String(day).padStart(3)} ${String(dayLevel(1, day).target).padStart(6)}  ${row.join('')}`);
  });
  if (days[0] === 1) console.log('  first missed day: ' + missed.map(m => m ?? `>${days.filter((d, x) => d === x + 1).length}`).join(', '));
  process.exit(0);
}
const levels = !isMain ? [] : which === 'all' ? LEVELS : [levelById(which)].filter(Boolean);
if (isMain && !levels.length) { console.log(`no level ${which}`); process.exit(1); }
const opts = { plan: flags.includes('--plan'), twoPhase: flags.includes('--two-phase'), allRed: allRedOverride, rules: flags.includes('--rules'), lefts: leftsGreen, hold: flags.includes('--hold'), ring: flags.includes('--ring') };
for (const level of levels) {
  if (opts.ring) {
    if (!convertible(level)) continue;
    const r = loadout(level, ['roundabout']);
    console.log(`\n${level.name} (${level.id}) as a roundabout: target ${r.target}, waitTarget ${r.waitTarget}, ${level.duration} s`);
    console.log('       ' + seeds.map(s => `seed ${s}`.padEnd(16)).join('') + ' cleared      wait');
    const row = seeds.map(s => cell(level, s, 0, opts));
    const cl = row.map(c => c.cleared), wt = row.map(c => c.wait);
    console.log(`  ring ${row.map(c => `${c.gridlock ? 'LOCK' : String(c.cleared).padStart(3)} ${c.wait.toFixed(0).padStart(3)}s ${c.collisions}x ${'★'.repeat(c.stars).padEnd(3, '☆')}`.padEnd(16)).join('')} ${Math.min(...cl)} to ${Math.max(...cl)}   ${Math.min(...wt).toFixed(0)} to ${Math.max(...wt).toFixed(0)} s`);
    continue;
  }
  const corridor = isCorridor(level);
  const peds = !!level.pedDemand;
  const platoons = (level.events || []).some(e => e.kind === 'motorcade' || e.kind === 'procession');
  const offs = corridor ? (offsets || [level.controllers && level.controllers[1] ? level.controllers[1].offset || 0 : 0]) : [null];
  console.log(`\n${level.name} (${level.id}): target ${level.target}, waitTarget ${level.waitTarget}, ${level.duration} s${opts.plan || corridor ? ', timed plan' : ''}${opts.rules ? ', the level\'s rules' : ''}${opts.twoPhase ? ', two permissive phases' : ''}${allRedOverride !== null ? `, all-red ${allRedOverride} s` : ''}${peds ? ', pedestrian calls' : ''}${platoons ? (opts.hold ? ', the green held under each platoon' : ', the platoons left to the rule') : ''}`);
  console.log((corridor ? 'cycle offset ' : 'cycle  ') + seeds.map(s => `seed ${s}`.padEnd(peds || platoons ? 20 : 16)).join('') + ' cleared      wait' + (peds ? '        late' : '') + (platoons ? '      split' : ''));
  for (const cycle of cycles) {
    for (const offset of offs) {
      const row = seeds.map(s => cell(level, s, cycle, opts, offset));
      const cl = row.map(c => c.cleared), wt = row.map(c => c.wait), late = row.map(c => c.pedLate), sp = row.map(c => c.splits);
      const txt = row.map(c => `${c.gridlock ? 'LOCK' : String(c.cleared).padStart(3)} ${c.wait.toFixed(0).padStart(3)}s ${c.collisions}x ${'★'.repeat(c.stars).padEnd(3, '☆')}${peds ? ` ${String(c.pedLate).padStart(2)}L` : ''}${platoons ? ` ${c.splits}S` : ''}`.padEnd(peds || platoons ? 20 : 16)).join('');
      const head = corridor ? `${String(cycle).padStart(4)} s ${String(offset).padStart(4)} s ` : `${String(cycle).padStart(4)} s `;
      console.log(`${head}${txt} ${Math.min(...cl)} to ${Math.max(...cl)}   ${Math.min(...wt).toFixed(0)} to ${Math.max(...wt).toFixed(0)} s${peds ? `   ${Math.min(...late)} to ${Math.max(...late)}` : ''}${platoons ? `   ${sp.reduce((a, b) => a + b, 0)} of ${row.reduce((a, c) => a + c.platoons, 0)}` : ''}`);
    }
  }
}
