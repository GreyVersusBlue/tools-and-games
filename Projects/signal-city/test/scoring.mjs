// node test/scoring.mjs
//
// Stars and meters against scripted runs, and the save's repair. Exits
// non-zero on any FAIL (#13). Imports through pathToFileURL (Windows rule).

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { meters, score, failedEarly, starString } = await load('scoring.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { repair, fresh, recordResult, totalStars, SAVE_KEY } = await load('save.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

// A tidy controller for scripted runs: alternate phases every 22 s.
const auto = { rules: [{ when: 'elapsed', seconds: 22, then: 'next' }], timing: { yellow: 3, allRed: 1, minGreen: 4 } };

group('the level pack');

{
  ok(LEVELS.length >= 2 && levelById('first-light') && levelById('free-play'), 'level 1 and free play exist');
  const l1 = levelById('first-light');
  ok(l1.duration === 180 && l1.target > 0 && l1.waitTarget > 0 && l1.mode === 'soft', 'level 1 is 3 minutes, soft, with a target and a wait target', `${l1.target} cars, ${l1.waitTarget} s`);
  ok(Object.keys(l1.mix).every(k => ['standard', 'granny'].includes(k)), 'and only standard and granny drive it', Object.keys(l1.mix).join(', '));
  let bad = null;
  for (const l of LEVELS) { try { new World(l, 1); } catch (e) { bad = `${l.id}: ${e.message}`; } }
  ok(!bad, 'every level builds a world', bad || '');
}

group('stars on level 1');

{
  // a clean run with the automatic controller earns three stars
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  const r = score(w);
  ok(w.over, 'the clock ran out');
  ok(r.cleared >= l1.target, `it cleared the target of ${l1.target}`, `${r.cleared}`);
  ok(r.collisions === 0, 'with no collisions', `${r.collisions}`);
  ok(r.avgWait <= l1.waitTarget, `average wait under ${l1.waitTarget} s`, `${r.avgWait.toFixed(1)} s`);
  ok(r.survived && r.stars === 3, 'three stars', `${starString(r.stars)} ${r.reasons.join('; ')}`);
  ok(r.points > 0 && r.bonus >= 0 && r.bonus <= 100, 'points and a satisfaction bonus in 0 to 100', `${r.points} pts, bonus ${r.bonus}`);

  // the same run with one collision injected is two stars, not a fail
  const w2 = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  w2.stats.collisions = 1;
  const r2 = score(w2);
  ok(r2.survived && r2.stars === 2 && /1 collision/.test(r2.reasons.join(' ')), 'one collision in soft mode: two stars, and the card says why', `${starString(r2.stars)} ${r2.reasons.join('; ')}`);

  // in hard mode that collision ends the level
  const w3 = new World({ ...l1, mode: 'hard', controller: { ...l1.controller, ...auto } }, 3).run(60);
  w3.stats.collisions = 1;
  ok(failedEarly(w3) && failedEarly(w3).reason === 'collision', 'hard mode: a collision fails the level early');
  const r3 = score(w3);
  ok(!r3.survived && r3.stars === 0, 'zero stars', r3.reasons.join('; '));

  // a controller that never changes gridlocks: zero stars
  const w4 = new World({ ...l1, controller: { ...l1.controller, rules: [] } }, 3);
  for (let i = 0; i < l1.duration * 60 && !failedEarly(w4); i++) w4.step();
  const r4 = score(w4);
  ok(w4.stats.gridlock && !r4.survived && r4.stars === 0 && /locked/.test(r4.reasons.join(' ')), 'never changing the light gridlocks, for zero stars', `at ${w4.stats.gridlockAt.toFixed(0)} s: ${r4.reasons.join('; ')}`);

  // a slow but safe run: one star for surviving, no second for the wait
  const w5 = new World({ ...l1, controller: { ...l1.controller, rules: [{ when: 'elapsed', seconds: 30, then: 'next' }] } }, 3).run(l1.duration);
  const r5 = score(w5);
  ok(r5.avgWait > l1.waitTarget, 'a 30 s cycle leaves the average wait above target', `${r5.avgWait.toFixed(1)} s`);
  ok(r5.stars <= 1 || r5.avgWait <= l1.waitTarget, 'and it earns at most one star', `${starString(r5.stars)} ${r5.reasons.join('; ')}`);
}

group('satisfaction never fails a level');

{
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  w.stats.honks = 500;
  for (const c of w.cars) c.patience = 0;
  const r = score(w);
  ok(r.survived && r.stars >= 1, 'five hundred honks and nobody patient still survives', `${starString(r.stars)} bonus ${r.bonus}`);
  ok(r.bonus < 30, 'but the bonus is poor', String(r.bonus));
  const m = meters(w);
  ok(m.satisfaction >= 0 && m.satisfaction <= 1, 'satisfaction stays in 0 to 1', m.satisfaction.toFixed(2));
}

group('meters mid-run');

{
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 5).run(40);
  const m = meters(w);
  ok(m.timeLeft > 139 && m.timeLeft < 141, 'time left counts down', m.timeLeft.toFixed(1));
  ok(m.onMap > 0 && m.cleared >= 0 && m.throughput === Math.min(1.5, m.cleared / l1.target), 'throughput is cleared over target', `${m.cleared}/${l1.target}`);
  const r = score(w);
  ok(!r.survived && /clock/.test(r.reasons.join(' ')), 'a score before the clock runs out is not a survival');
}

group('the save');

{
  ok(SAVE_KEY === 'signal_city_v1', 'the storage key is signal_city_v1 (#36)');
  const f = fresh();
  ok(f.levels && f.unlocks.includes('phases') && f.settings.sound === true, 'a fresh save has empty levels, the phases unlock and sound on');
  const r = repair({ levels: { 'first-light': { stars: '7', best: -3, plays: 'x' }, junk: null }, unlocks: ['phases', 'sensors', 5], settings: { sound: false }, lastLevel: 'first-light' });
  ok(r.levels['first-light'].stars === 3 && r.levels['first-light'].best === 0 && r.levels['first-light'].plays === 0, 'repair clamps stars to 3 and floors bad numbers at 0', JSON.stringify(r.levels['first-light']));
  ok(!('junk' in r.levels), 'and drops a null record');
  ok(r.unlocks.join() === 'phases,sensors' && r.settings.sound === false && r.lastLevel === 'first-light', 'keeps string unlocks, settings and the last level', r.unlocks.join());
  ok(JSON.stringify(repair(null)) === JSON.stringify(fresh()), 'repair of nothing is a fresh save');
  ok(JSON.stringify(repair(repair(r))) === JSON.stringify(repair(r)), 'repair is idempotent');
  const st = fresh();
  recordResult(st, 'first-light', { stars: 2, points: 900 });
  recordResult(st, 'first-light', { stars: 1, points: 1200 });
  ok(st.levels['first-light'].stars === 2 && st.levels['first-light'].best === 1200 && st.levels['first-light'].plays === 2, 'a result keeps the best stars and the best points separately', JSON.stringify(st.levels['first-light']));
  ok(totalStars(st) === 2, 'total stars sums the levels');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
