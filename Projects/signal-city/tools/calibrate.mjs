// node tools/calibrate.mjs [level-id|all] [cycles]      e.g. node tools/calibrate.mjs stem 18,22,30,55
//
// The calibration table behind a level's target and waitTarget (#540): six
// seeds by four fixed cycles, cleared / average wait / collisions / stars per
// cell. A tool, not a check: it prints and exits 0. The numbers a level ships
// with go in HISTORY.md with the level.
//
// A fixed cycle is one elapsed rule, `next` every N seconds, so every phase
// gets N seconds of green. With `--plan` a four-phase level runs a timed plan
// instead: N for the through phases, N/2 for the left phases. With
// `--two-phase` a protected-left level is run on the permissive two-phase set
// instead of its own, to show what the lefts phases buy.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { score } = await load('scoring.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { standardPhases } = await load('signals.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const which = args[0] || 'all';
const cycles = (args[1] || '18,22,30,55').split(',').map(Number);
const seeds = [1, 2, 3, 4, 5, 6];
const timingArg = flags.find(f => f.startsWith('--allred='));
const allRedOverride = timingArg ? Number(timingArg.split('=')[1]) : null;

export function controllerFor(level, cycle, { plan = false, twoPhase = false, allRed = null } = {}) {
  const base = { ...(level.controller || {}) };
  if (allRed !== null) base.timing = { ...(base.timing || {}), allRed };
  if (twoPhase) base.phases = standardPhases(level.network.legs);
  const phases = base.phases || standardPhases(level.network.legs);
  if (plan && phases.length === 4) {
    return { ...base, mode: 'timed', rules: [], plan: [{ phase: 0, green: cycle }, { phase: 1, green: cycle / 2 }, { phase: 2, green: cycle }, { phase: 3, green: cycle / 2 }] };
  }
  return { ...base, mode: 'manual', plan: null, rules: [{ when: 'elapsed', seconds: cycle, then: 'next' }] };
}

export function cell(level, seed, cycle, opts) {
  const w = new World({ ...level, controller: controllerFor(level, cycle, opts) }, seed);
  for (let i = 0; i < level.duration * 60; i++) { w.step(); if (w.stats.gridlock) break; }
  const r = score(w);
  return { cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, gridlock: w.stats.gridlock, stars: r.stars, survived: r.survived };
}

// Run as a script; importing the file (a suite borrowing controllerFor) does nothing.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const levels = !isMain ? [] : which === 'all' ? LEVELS : [levelById(which)].filter(Boolean);
if (isMain && !levels.length) { console.log(`no level ${which}`); process.exit(1); }
const opts = { plan: flags.includes('--plan'), twoPhase: flags.includes('--two-phase'), allRed: allRedOverride };
for (const level of levels) {
  console.log(`\n${level.name} (${level.id}): target ${level.target}, waitTarget ${level.waitTarget}, ${level.duration} s${opts.plan ? ', timed plan' : ''}${opts.twoPhase ? ', two permissive phases' : ''}${allRedOverride !== null ? `, all-red ${allRedOverride} s` : ''}`);
  console.log('cycle  ' + seeds.map(s => `seed ${s}`.padEnd(16)).join('') + ' cleared      wait');
  for (const cycle of cycles) {
    const row = seeds.map(s => cell(level, s, cycle, opts));
    const cl = row.map(c => c.cleared), wt = row.map(c => c.wait);
    const txt = row.map(c => `${c.gridlock ? 'LOCK' : String(c.cleared).padStart(3)} ${c.wait.toFixed(0).padStart(3)}s ${c.collisions}x ${'★'.repeat(c.stars).padEnd(3, '☆')}`.padEnd(16)).join('');
    console.log(`${String(cycle).padStart(4)} s ${txt} ${Math.min(...cl)} to ${Math.max(...cl)}   ${Math.min(...wt).toFixed(0)} to ${Math.max(...wt).toFixed(0)} s`);
  }
}
