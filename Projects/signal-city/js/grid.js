// Signal City: the grid generator (M9). Pure data, no DOM.
//
// A district is `cols` by `rows` cells, each cell a place a box can stand,
// `spacing` metres apart (network.js buildCells). growCells(seed, count)
// places `count` boxes one at a time from one seeded generator (rng.js),
// so the first n boxes of a seed are the same whatever count is asked for:
// endless (M9's next increment) adds a box per survived day without moving
// or re-rolling the ones already built. test/grid.mjs holds that.
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
// something; demand per node from the cells. No stars and no card yet:
// endless and the sandbox are the next increment. The suite, the
// calibration and the page's debug hook run it.
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
