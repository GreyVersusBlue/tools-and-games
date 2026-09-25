// Signal City: endless (M9, second increment). Pure data, no DOM.
//
// A run is one city, grown a day at a time. Day n is gridLevel(seed, n + 2):
// n + 2 boxes, all but one exactly yesterday's (grid.js, #605), so the
// city the player tuned is still there with one box more. Past the
// district's twelve boxes nothing more is built and the traffic grows
// instead. Every day the traffic is heavier: demand on every leg is
// `GROWTH` more per day than on day one.
//
// A day's target climbs 8 cars a day and never stops (#609), from 36: a
// run starts on the district's third day (R4, #642, the ramp below). A
// district tops out: past five boxes it clears 50 to 130 cars in a day
// whatever its demand and whatever its cycle, because a queue backed up to
// the edge stops cars entering, and at three times day one's traffic (day
// 21) no hands-off run locked. So the growing traffic alone cannot end a
// run; the climbing target does, at the district's capacity. With a 20 s
// rule at every box on seeds 1 to 6 a run first misses on day 10, 10, 6,
// 8, 2 and 8, and the reference hand's on 9, 10, 6, 8, 6 and 9 (#642).
// Pushing more through than the default would buy a day; choosing phases
// box by box, as the reference hand does, does not. What ends a
// run is the day's own verdict (scoring.js score): the grid locked, or the
// clock ran out short of the target. Collisions cost points and never end
// a run: endless plays soft.

import { gridLevel, spawningLegs, GRID_SPACING } from './grid.js';
import { makeRng } from './rng.js';

export const DAY_SECONDS = 180;
export const FULL = 12;           // a 4 by 3 district holds twelve boxes
export const GROWTH = 0.1;        // demand per day, over day one's
export const TARGET = { first: 20, perDay: 8 };
export const WAIT_TARGET = 20;    // seconds, for the day's stars and so its points

// The ramp (R4, #642). A run starts on the district's day `start`, not its
// first: the box count, the traffic and the target of day n are the
// district's day n + start - 1, so day one is three boxes and 36 cars and
// the target still climbs 8 a day. From day `events` of the run every day
// would bring one seeded event (dayEvent); it ships off, because a surge
// box-blocked the reference hand's district on day 4 of seeds 4 and 5, and
// no input got through seed 4's day 4: the events punished playing. The
// calibration plays them (`--events`), and the ramp as M9 shipped it
// (#609, `--m9`).
export const RAMP = { start: 3, events: Infinity };
export const M9_RAMP = { start: 1, events: Infinity };
export const EVENTS_RAMP = { start: 3, events: 4 };
const districtDay = (day, ramp = RAMP) => day + ramp.start - 1;

const STEPS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const NUMBER = { 1: 'One box', 2: 'Two boxes', 3: 'Three boxes', 4: 'Four boxes' };

export const boxesOn = (day, ramp = RAMP) => Math.min(districtDay(day, ramp), FULL);
export const demandScale = (day, ramp = RAMP) => 1 + GROWTH * (districtDay(day, ramp) - 1);

// The traffic's seed on day n: another day's cars, the same city.
export const daySeed = (seed, day) => seed * 1000 + day;

export const dayTarget = (day, ramp = RAMP) => TARGET.first + TARGET.perDay * (districtDay(day, ramp) - 1);

// The day's one event (R4), or null before the ramp's `events` day. Rolled
// from the day's own seed, so a city's day n has the same event every run:
// a surge, a blackout, or an ambulance in from a leg that spawns.
export const EVENT_KINDS = ['surge', 'outage', 'ambulance'];
export function dayEvent(seed, day, level, ramp = RAMP) {
  if (day < ramp.events) return null;
  const rng = makeRng(daySeed(seed, day) * 7 + 3);
  const kind = rng.pick(EVENT_KINDS);
  const at = Math.round(rng.range(30, 120));
  if (kind === 'surge') return { kind, at, for: 60, scale: 1.5 };
  if (kind === 'outage') return { kind, at, for: 20 };
  const { node, leg } = rng.pick(spawningLegs(level.network.cells));
  return { kind, at, node, leg, turn: 'T', within: 60 };
}

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
export function dayLevel(seed, day, ramp = RAMP) {
  if (!(day >= 1) || !Number.isInteger(day)) throw new RangeError(`a day is a whole number from 1, not ${day}`);
  const k = demandScale(day, ramp);
  const lvl = gridLevel(seed, boxesOn(day, ramp), { lo: 150 * k, hi: 260 * k, duration: DAY_SECONDS, spacing: GRID_SPACING });
  const event = dayEvent(seed, day, lvl, ramp);
  return {
    ...lvl,
    id: 'endless',
    name: `Endless, day ${day}`,
    blurb: '',
    hint: day === 1
      ? `${NUMBER[boxesOn(1, ramp)] || boxesOn(1, ramp)} today and one more every day you clear the target. Your rules and timing stay on each box overnight. Miss the target or lock the grid and the run is over.`
      : boxesOn(day, ramp) === boxesOn(day - 1, ramp) ? 'The district is full: no box today, only more traffic. Every box keeps what you set on it.'
      : `Box ${boxesOn(day, ramp)} is new today. Every other box keeps what you set on it.`,
    events: event ? [event] : [],
    target: dayTarget(day, ramp),
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
