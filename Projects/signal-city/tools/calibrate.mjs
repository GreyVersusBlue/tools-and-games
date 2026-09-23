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
export function holdPlatoon(w) {
  const p = w.platoon;
  if (!p) return;
  const ctl = w.controllers[p.node];
  const lead = p.cars[0];
  if (lead.front < lead.path.stopLine - 60) return;
  if (p.cars.length >= p.size && p.cars.every(c => c.done || c.rear > c.path.boxExit)) return;
  const want = ctl.phases.findIndex(ph => ph.movements.includes(lead.path.movement));
  if (want < 0) return;
  if (ctl.phase !== want || ctl.stage !== 'green') { if (ctl.next !== want) w.requestPhase(want, p.node); return; }
  if (p._heldAt === undefined || w.t - p._heldAt >= 10) { if (w.holdGreen(p.node)) p._heldAt = w.t; }
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

// Run as a script; importing the file (a suite borrowing controllerFor) does nothing.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
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
