// Signal City: meters and stars. Pure functions over a World's stats and a
// level's targets, so the suite can feed them scripted runs.
//
// Two primary meters and one bonus:
//   throughput    cars cleared against the level's target
//   safety        collisions; a near-miss is a warning, never a fail
//   satisfaction  patience, the bonus: honks cost it, and so does a
//                 pedestrian call left unserved past the level's pedWait
//                 (M6); nothing about it fails a level (Devon's brief:
//                 bonus scoring, not a third fail)
//
// Stars are cumulative:
//   1  survived: the clock ran out with no gridlock, the throughput floor was
//      met, and in hard mode no collision happened
//   2  and the average wait of a cleared car is under the level's target
//   3  and there were no collisions at all
// In hard mode a collision ends the level, so a surviving run has none, and
// 2 and 3 coincide: hard mode's third star is the second. The level select
// says so on its card.

export const MODES = ['soft', 'hard'];

// Live meters for the HUD, any time during the run.
export function meters(world) {
  const s = world.stats;
  const lvl = world.level;
  const target = lvl.target || 1;
  const alive = world.cars.filter(c => !c.done);
  // every car counts, cleared or still queued, or a long red would hide its
  // own damage in the cars it never let through
  const avgWait = (s.cleared + alive.length) ? s.wait / (s.cleared + alive.length) : 0;
  // satisfaction: mean patience left across everyone on the map, less a
  // penalty per honk this run, floored at 0
  let pat = 0, n = 0;
  for (const c of alive) if (c.stats.patience > 0) { pat += Math.max(0, c.patience) / c.stats.patience; n++; }
  const live = n ? pat / n : 1;
  const honkPenalty = Math.min(0.6, (s.honks + (s.pedLate || 0)) * 0.03);
  const satisfaction = Math.max(0, Math.min(1, 0.6 * live + 0.4 * (1 - honkPenalty / 0.6)));
  return {
    cleared: s.cleared, target, throughput: Math.min(1.5, s.cleared / target),
    collisions: s.collisions, honks: s.honks, pedLate: s.pedLate || 0, pedServed: s.pedServed || 0,
    avgWait, maxWait: s.maxWait, gridlock: s.gridlock,
    satisfaction, waiting: alive.filter(c => c.isWaiting).length, onMap: alive.length,
    timeLeft: Math.max(0, world.duration - world.t),
  };
}

// Has the run ended early? Returns null, or { reason }.
export function failedEarly(world) {
  const s = world.stats;
  if (s.gridlock) return { reason: 'gridlock' };
  if ((world.level.mode || 'soft') === 'hard' && s.collisions > 0) return { reason: 'collision' };
  return null;
}

// The end-of-level card. `over` is whether the clock ran out.
export function score(world) {
  const m = meters(world);
  const lvl = world.level;
  const mode = lvl.mode || 'soft';
  const waitTarget = lvl.waitTarget ?? 25;
  const early = failedEarly(world);
  const reasons = [];
  let survived = !early && world.over;
  if (early) reasons.push(early.reason === 'gridlock' ? 'the grid locked' : 'a collision, and this level does not forgive one');
  else if (!world.over) reasons.push('the clock has not run out');
  if (survived && m.cleared < m.target) { survived = false; reasons.push(`${m.cleared} cleared of the ${m.target} the level asked for`); }
  let stars = 0;
  if (survived) {
    stars = 1;
    if (m.avgWait <= waitTarget) stars = 2; else reasons.push(`average wait ${m.avgWait.toFixed(0)} s against a target of ${waitTarget} s`);
    if (stars === 2 && m.collisions === 0) stars = 3; else if (stars === 2) reasons.push(`${m.collisions} collision${m.collisions === 1 ? '' : 's'}`);
  }
  const bonus = Math.round(m.satisfaction * 100);
  const points = Math.round(m.cleared * 10 + (survived ? 200 : 0) + stars * 150 + bonus * 2 - m.collisions * 100 - m.honks * 5 - m.pedLate * 5);
  return { ...m, mode, survived, stars, reasons, bonus, points: Math.max(0, points), waitTarget };
}

export function starString(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
