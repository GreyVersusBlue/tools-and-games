// Signal City: meters and stars. Pure functions over a World's stats and a
// level's targets, so the suite can feed them scripted runs.
//
// Two primary meters and one bonus:
//   throughput    cars cleared against the level's target
//   safety        collisions; a near-miss is a warning, never a fail
//   satisfaction  patience, the bonus: honks cost it, and so does a
//                 pedestrian call left unserved past the level's pedWait
//                 (M6), an ambulance still on the map past its timer and a
//                 motorcade or procession the light split (M7, five honks'
//                 worth and 50 points each); nothing about it fails a level
//                 (Devon's brief: bonus scoring, not a third fail)
//
// Stars are cumulative:
//   1  survived: the clock ran out with no gridlock, the throughput floor was
//      met, and in hard mode no collision happened
//   2  and the average wait of a cleared car is under the level's target,
//      or on a level with a `lesson` (R2), the lesson was played
//   3  and there were no collisions at all
// In hard mode a collision ends the level, so a surviving run has none, and
// 2 and 3 coincide: hard mode's third star is the second. The level select
// says so on its card.
//
// The lesson (R2). A level may carry `lesson: { kind, ... }`, and then the
// move it teaches, not the wait target, is the second star: with its
// default left alone, a level's wait target was met by watching it. Kinds:
//   ambulance    every ambulance off the map on time with its corridor
//                called (a lucky green is on time and not the lesson)
//   platoons     no motorcade or procession split by the light
//   progression  at most `stops` of the cars one box hands to the next
//                wait again there: the offset carries the platoon
//   walks        no walk call waits longer than `within` seconds
// Stars stay 0 to 3, so the save's shape does not change (#36, #37).

export const MODES = ['soft', 'hard'];

// What a level's lesson asks, for its card and its end card.
export function lessonName(lesson) {
  if (!lesson) return '';
  switch (lesson.kind) {
    case 'ambulance': return 'the ambulance on time, on its corridor';
    case 'platoons': return 'no platoon split by the light';
    case 'progression': return `at most ${Math.round(lesson.stops * 100)}% of cars stopping again at the next box`;
    case 'walks': return `no walk call waiting over ${lesson.within} s`;
    default: throw new Error(`no lesson kind ${lesson.kind}`);
  }
}

// Was the level's lesson played? null on a level with none, else
// { met, why }: `why` is the end card's reason line when it was not.
export function lessonMet(world) {
  const lesson = world.level.lesson;
  if (!lesson) return null;
  const s = world.stats;
  switch (lesson.kind) {
    case 'ambulance': {
      const clock = world.ambulanceClock();
      const late = Math.max(s.ambulanceLateBy || 0, clock !== null && clock < 0 ? -clock : 0);
      if (late > 0) return { met: false, why: `the ambulance was ${Math.max(1, Math.round(late))} s late` };
      if (s.ambulanceEscorted < s.ambulances) return { met: false, why: 'the ambulance made it without its corridor' };
      return { met: true, why: '' };
    }
    case 'platoons': {
      const n = s.platoonSplits || 0;
      return { met: n === 0, why: n === 0 ? '' : `the light split ${n === 1 ? 'a platoon' : `${n} platoons`}` };
    }
    case 'progression': {
      const share = s.carried ? s.carriedStops / s.carried : 1;
      const met = s.carried > 0 && share <= lesson.stops + 1e-9;
      return { met, why: met ? '' : `${Math.round(share * 100)}% of the cars one box sent on stopped again at the next, against ${Math.round(lesson.stops * 100)}%` };
    }
    case 'walks': {
      let most = s.pedMaxWait || 0;
      for (const calls of world.pedCalls) for (const c of Object.values(calls)) if (c) most = Math.max(most, world.t - c.since);
      const met = most <= lesson.within;
      return { met, why: met ? '' : `a walk call waited ${Math.round(most)} s, against ${lesson.within} s` };
    }
    default: throw new Error(`no lesson kind ${lesson.kind}`);
  }
}

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
  // an ambulance late past its timer, or a platoon the light split (M7),
  // costs five honks' worth
  const honkPenalty = Math.min(0.6, (s.honks + (s.pedLate || 0) + 5 * ((s.ambulanceLate || 0) + (s.platoonSplits || 0))) * 0.03);
  const satisfaction = Math.max(0, Math.min(1, 0.6 * live + 0.4 * (1 - honkPenalty / 0.6)));
  return {
    cleared: s.cleared, target, throughput: Math.min(1.5, s.cleared / target),
    collisions: s.collisions, honks: s.honks, pedLate: s.pedLate || 0, pedServed: s.pedServed || 0,
    ambulances: s.ambulances || 0, ambulanceLate: s.ambulanceLate || 0,
    platoons: s.platoons || 0, splits: s.platoonSplits || 0,
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
  const lesson = lessonMet(world);
  let stars = 0;
  if (survived) {
    stars = 1;
    if (lesson) { if (lesson.met) stars = 2; else reasons.push(lesson.why); }
    else if (m.avgWait <= waitTarget) stars = 2; else reasons.push(`average wait ${m.avgWait.toFixed(0)} s against a target of ${waitTarget} s`);
    if (stars === 2 && m.collisions === 0) stars = 3; else if (stars === 2) reasons.push(`${m.collisions} collision${m.collisions === 1 ? '' : 's'}`);
  }
  const bonus = Math.round(m.satisfaction * 100);
  const points = Math.round(m.cleared * 10 + (survived ? 200 : 0) + stars * 150 + bonus * 2 - m.collisions * 100 - m.honks * 5 - m.pedLate * 5 - m.ambulanceLate * 50 - m.splits * 50);
  return { ...m, mode, survived, stars, reasons, bonus, points: Math.max(0, points), waitTarget, lesson };
}

export function starString(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
