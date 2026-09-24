// Signal City: endless (M9, second increment). Pure data, no DOM.
//
// A run is one city, grown a day at a time. Day n is gridLevel(seed, n):
// n boxes, the first n - 1 exactly yesterday's (grid.js, #605), so the
// city the player tuned is still there with one box more. Past the
// district's twelve boxes nothing more is built and the traffic grows
// instead. Every day the traffic is heavier: demand on every leg is
// `GROWTH` more per day than on day one.
//
// A day's target climbs 8 cars a day from 20 and never stops (#609). A
// district tops out: past five boxes it clears 50 to 130 cars in a day
// whatever its demand and whatever its cycle, because a queue backed up to
// the edge stops cars entering, and at three times day one's traffic (day
// 21) no hands-off run locked. So the growing traffic alone cannot end a
// run; the climbing target does, at the district's capacity. With a 20 s
// rule at every box on seeds 1 to 6 a run first misses on day 10 to 12
// (seed 5 locks on day 2), and on day 12 (108) all six fall short.
// Pushing more through than the default is what buys a day. What ends a
// run is the day's own verdict (scoring.js score): the grid locked, or the
// clock ran out short of the target. Collisions cost points and never end
// a run: endless plays soft.

import { gridLevel, GRID_SPACING } from './grid.js';

export const DAY_SECONDS = 180;
export const FULL = 12;           // a 4 by 3 district holds twelve boxes
export const GROWTH = 0.1;        // demand per day, over day one's
export const TARGET = { first: 20, perDay: 8 };
export const WAIT_TARGET = 20;    // seconds, for the day's stars and so its points

const STEPS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export const boxesOn = day => Math.min(day, FULL);
export const demandScale = day => 1 + GROWTH * (day - 1);

// The traffic's seed on day n: another day's cars, the same city.
export const daySeed = (seed, day) => seed * 1000 + day;

export const dayTarget = day => TARGET.first + TARGET.perDay * (day - 1);

// Cars a level's legs send in `seconds`, on average: the demand on every
// leg that faces an empty cell, the legs that spawn (grid.js). The
// calibration's yardstick, not the target's.
export function expectedArrivals(level, seconds = level.duration) {
  const cells = level.network.cells;
  const taken = new Set(cells.map(c => c.at.join(',')));
  let vph = 0;
  cells.forEach((c, i) => {
    for (const l of c.legs) if (!taken.has((c.at[0] + STEPS[l][0]) + ',' + (c.at[1] + STEPS[l][1]))) vph += level.demand[i][l];
  });
  return vph * seconds / 3600;
}

// Day `day` of the city on `seed`: a level the page plays like any other,
// with a target and no stars to keep.
export function dayLevel(seed, day) {
  if (!(day >= 1) || !Number.isInteger(day)) throw new RangeError(`a day is a whole number from 1, not ${day}`);
  const k = demandScale(day);
  const lvl = gridLevel(seed, boxesOn(day), { lo: 150 * k, hi: 260 * k, duration: DAY_SECONDS, spacing: GRID_SPACING });
  return {
    ...lvl,
    id: 'endless',
    name: `Endless, day ${day}`,
    blurb: '',
    hint: day === 1
      ? 'One box today and one more every day you clear the target. Your rules and timing stay on each box overnight. Miss the target or lock the grid and the run is over.'
      : day > FULL ? 'The district is full: no box today, only more traffic. Every box keeps what you set on it.'
      : `Box ${day} is new today. Every other box keeps what you set on it.`,
    target: dayTarget(day),
    waitTarget: WAIT_TARGET,
    sandbox: false,
    endless: true,
    day,
    citySeed: seed,
  };
}

// Overnight: every box that stood yesterday keeps its rules and its
// timing (yellow, all-red, minimum green). A ring has neither. The cars,
// the queues, the phase it was on and a flash mode do not carry: day n + 1
// is a new World, and only what the player set on a box does.
export function carryOver(from, to) {
  let kept = 0;
  const n = Math.min(from.controllers.length, to.controllers.length);
  for (let i = 0; i < n; i++) {
    if (to.nodes[i].roundabout) continue;
    const a = from.controllers[i], b = to.controllers[i];
    b.setTiming({ ...a.timing });
    b.setRules(a.rules.map(r => ({ ...r })));
    kept++;
  }
  return kept;
}
