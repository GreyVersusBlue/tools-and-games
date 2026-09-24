// Signal City: the grid generator (M9). Pure data, no DOM.
//
// A district is `cols` by `rows` cells, each cell a place a box can stand,
// `spacing` metres apart (network.js buildCells). growCells(seed, count)
// places `count` boxes one at a time from one seeded generator (rng.js),
// so the first n boxes of a seed are the same whatever count is asked for:
// endless (endless.js) adds a box per survived day without moving or
// re-rolling the ones already built. test/grid.mjs holds that.
//
// The rules, one step per box:
//   the first box stands in the middle cell (the lower middle when a side
//   is even), and is always a signal, so day one has something to press
//   each later box goes on an empty cell next to one already built,
//   picked with weight (built neighbours) squared, so the district grows
//   as a block rather than a snake
//   a box on the district's edge may be a T: with chance `tee` it drops
//   one leg facing out of the district. A T never faces a cell inside it,
//   so no later box meets a missing leg and every cell stays reachable
//   a box after the first is a roundabout with chance `ring` (#595: one
//   lane, which is every box here)
//   every leg of the new box gets a demand in vehicles per hour, `lo` to
//   `hi`; it only spawns while nothing is built on the cell it faces
//
// Every box is one lane each way: two joined boxes must agree on lanes
// (buildCells throws), and a ring is built with one.

import { makeRng } from './rng.js';

export const GRID_SPACING = 220;   // two 110 m legs laid end to end, as on Two Blocks
const STEPS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const LEG_ORDER = ['N', 'E', 'S', 'W'];

export function growCells(seed, count, { cols = 4, rows = 3, tee = 0.25, ring = 0.2, lo = 150, hi = 260 } = {}) {
  if (!(count >= 1) || count > cols * rows) throw new RangeError(`a ${cols} by ${rows} district holds 1 to ${cols * rows} boxes, not ${count}`);
  const rng = makeRng(seed);
  const cells = [];
  const at = new Map();
  const inside = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
  const place = (c, r, first) => {
    let legs = LEG_ORDER.slice();
    const out = legs.filter(l => !inside(c + STEPS[l][0], r + STEPS[l][1]));
    if (out.length && rng.chance(tee)) { const drop = rng.pick(out); legs = legs.filter(l => l !== drop); }
    const roundabout = !first && rng.chance(ring);
    const demand = {};
    for (const l of legs) demand[l] = Math.round(rng.range(lo, hi));
    const cell = { at: [c, r], legs, demand };
    if (roundabout) cell.roundabout = true;
    cells.push(cell);
    at.set(c + ',' + r, cell);
  };
  place(Math.floor((cols - 1) / 2), Math.floor((rows - 1) / 2), true);
  while (cells.length < count) {
    // the empty cells next to a built one, in a fixed order (row, then column)
    const frontier = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (at.has(c + ',' + r)) continue;
      let n = 0;
      for (const l of LEG_ORDER) if (at.has((c + STEPS[l][0]) + ',' + (r + STEPS[l][1]))) n++;
      if (n) frontier.push({ c, r, w: n * n });
    }
    const pick = rng.weighted(frontier);
    place(pick.c, pick.r, false);
  }
  return cells;
}

// A runnable level from a grown district: every signal on the same timing
// and a 20 s elapsed rule, so a grid runs itself until someone presses
// something; demand per node from the cells, no target and no stars.
// Endless (endless.js) builds each day on it with a target of its own,
// and the sandbox (districtLevel, below) grows Free Play into one. The
// suites, the calibration and the page's debug hook run it bare.
export function gridLevel(seed, count, opts = {}) {
  const cells = growCells(seed, count, opts);
  return {
    id: 'grid',
    name: `Grid of ${count}`,
    blurb: '',
    hint: 'Click a box, or pick it above the phases, to drive its signals.',
    network: { cells: cells.map(({ at, legs, roundabout }) => (roundabout ? { at, legs, roundabout } : { at, legs })), spacing: opts.spacing ?? GRID_SPACING, lanesPerDir: 1 },
    controller: { timing: { yellow: 3, allRed: 1, minGreen: 4 }, rules: [{ when: 'elapsed', seconds: opts.green ?? 20, then: 'next' }] },
    demand: cells.map(c => c.demand),
    mix: opts.mix || { standard: 6, granny: 1, aggressive: 1, tourist: 1, trucker: 0.5, student: 0.5, rideshare: 1 },
    turns: opts.turns || { T: 0.6, L: 0.2, R: 0.2 },
    duration: opts.duration ?? 240,
    mode: 'soft',
    sandbox: true,
    unlocks: ['phases', 'auto', 'allred'],
  };
}

// The legs of a district's boxes that spawn: a box's leg spawns while the
// cell it faces is empty (network.js linkedIn is the World's version of
// the same fact). [{ node, leg }] in box order, then N E S W.
export function spawningLegs(cells) {
  const taken = new Set(cells.map(c => c.at.join(',')));
  const out = [];
  cells.forEach((c, node) => {
    for (const leg of LEG_ORDER) {
      if (!c.legs.includes(leg)) continue;
      if (!taken.has((c.at[0] + STEPS[leg][0]) + ',' + (c.at[1] + STEPS[leg][1]))) out.push({ node, leg });
    }
  });
  return out;
}

// The sandbox (M9, third increment, #614): a one-box board grown into a
// generated district of `count` boxes on `seed`. One box is the board
// itself, the same object, so Free Play with no district chosen is the
// run it always was. A district is gridLevel's (its 20 s rule at every
// signal, its demand, no target) with the board's name, drivers,
// duration, controls and scripted arrivals. A scripted arrival names a
// leg of box 1, which a district may have joined to a neighbour, and
// spawnCar never checks: it moves to the first box, in build order, that
// spawns on that leg, or failing that to the first leg that spawns at
// all (#616). Nothing a district plays is recorded: it is a sandbox.
export function districtLevel(base, seed, count) {
  if (count === 1) return base;
  const lvl = gridLevel(seed, count, { mix: base.mix, duration: base.duration });
  const open = spawningLegs(lvl.network.cells);
  const spawns = (base.spawns || []).map(s => {
    const at = open.find(o => o.leg === s.leg) || open[0];
    return { ...s, node: at.node, leg: at.leg };
  });
  return {
    ...lvl,
    id: base.id,
    name: `${base.name}, ${count} boxes`,
    blurb: base.blurb,
    hint: `${count} boxes on city ${seed}, every signal on a 20 s rule until you change it. Click a box, or pick it above the phases, to drive it. ${base.hint}`,
    spawns,
    unlocks: (base.unlocks || []).slice(),
    sandbox: true,
    district: count,
    citySeed: seed,
  };
}
