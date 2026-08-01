// smoke-targets.mjs — the arithmetic behind "the sink cannot ask for the
// impossible", and the loader that has to rescue saves written before it did.
//
//   node Projects/integer-foundry/test/smoke-targets.mjs
//
// Exits non-zero on any failure (locked decision #13). No browser, no DOM: this
// is the reachable-range calculation and the repair pass, which are pure and are
// where the claims in the handoff come from.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OP_TILES, HARD_CAP, MIN_TARGET, opBudget, countSinks, buildCosts, boardPlan,
  minCells, isReachable, reachableMax, recipe, describeRecipe, nearestReachable, rollTarget,
} from '../js/targets.js';
import {
  BASE_COLS, BASE_ROWS, SAVE_KEY, freshState, makeEmptyGrid, validState, repairState, foundrySlot,
} from '../js/state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, name, note = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}${note ? '  ' + note : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? '  ' + note : ''}`); }
};
const eq = (a, b, name) => ok(a === b, name, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const group = t => console.log('\n' + t);

/** Deterministic Math.random stand-in, so a "random" roll is a fixed sequence. */
const seq = values => { let i = 0; return () => values[i++ % values.length]; };

/* ------------------------------------------------------ the reachable range -- */

group('Reachable range');

const OPENING = { cols: BASE_COLS, rows: BASE_ROWS, unlocked: {}, ordersFilled: 0, grid: makeEmptyGrid(BASE_COLS, BASE_ROWS) };

eq(opBudget({ cols: 8, rows: 6, sinks: 1 }), 46, 'an 8x6 floor spares 46 operator cells for one line');
eq(opBudget({ cols: 8, rows: 6, sinks: 2 }), 22, 'two sinks halve the floor between them');
eq(opBudget({ cols: 12, rows: 8, sinks: 1 }), 94, 'both floor expansions bought: 94 cells');

const opening = boardPlan(OPENING);
eq(reachableMax(opening), 47,
  'opening board, only +1 unlocked: the largest fillable order is 47');
eq(minCells(47, opening), 46, '...and it costs every spare cell to build');
eq(minCells(12, opening), 11, 'an order of 12 needs eleven +1 tiles');
ok([...Array(46)].every((_, i) => isReachable(i + 2, opening)),
  'every integer from 2 to 47 is reachable with +1 alone');
ok(!isReachable(48, opening), '48 is not: there is no 47th cell to put a +1 in');

// This is the number play-games.mjs ran into. A straight row of 8 holds a source,
// six +1s and a sink, so 7 is the most a single row can deliver — and the old
// generator could ask for 12 on turn one.
const oneRow = boardPlan({ ...OPENING, rows: 1, grid: makeEmptyGrid(8, 1) });
eq(reachableMax(oneRow), 7, 'a straight 8-cell row tops out at 7, which is the suite\'s problem');

const withDoubler = boardPlan({ ...OPENING, unlocked: { mul2: true } });
eq(reachableMax(withDoubler), HARD_CAP, 'unlock x2 and the cap, not the board, is the limit');
eq(minCells(300, withDoubler), 11, '300 is eleven tiles by the binary route');
// Not the exact chain: several 11-tile routes reach 300 and which one BFS meets
// first is a tie-break, not a promise. What has to hold is that the route it
// hands the player is the length it claims and actually lands on the number.
eq(recipe(300, withDoubler).length, 11, '...and the route it prints is that long');
ok(recipe(300, withDoubler).reduce((v, op) => OP_TILES[op].apply(v), 1) === 300,
  'walking the recipe through the simulator\'s own arithmetic lands on 300');
ok([2, 7, 12, 47, 99, 255, 300].every(n => {
  const r = recipe(n, withDoubler);
  return r.length === minCells(n, withDoubler) && r.reduce((v, op) => OP_TILES[op].apply(v), 1) === n;
}), 'every printed recipe is exactly minCells long and lands on its target');

// -1 beats the binary route for anything just under a power of two.
const withSub = boardPlan({ ...OPENING, unlocked: { mul2: true, sub1: true } });
eq(minCells(255, withDoubler), 14, '255 costs 14 tiles with +1 and x2');
eq(minCells(255, withSub), 9, '...and 9 once -1 is unlocked: eight doublings and a step back');

eq(describeRecipe(recipe(12, opening)), '11× +1', 'a long run of one tile compresses');
eq(describeRecipe(recipe(1, opening)), 'a source straight into the sink', 'and 1 needs no tiles at all');

/* ------------------------------------------------------------- rolling one -- */

group('Rolling an order');

{
  // The whole point: 20000 rolls across a rising order count, none unfillable.
  let worst = 0, impossible = 0, seen = new Set();
  const s = { ...OPENING, ordersFilled: 0 };
  for (let i = 0; i < 20000; i++) {
    s.ordersFilled = i % 200;                       // ramp well past the board's 47
    const plan = boardPlan(s);
    const t = rollTarget(s);
    seen.add(t);
    if (t > worst) worst = t;
    if (!isReachable(t, plan)) impossible++;
  }
  eq(impossible, 0, '20000 rolls on the opening board, none of them unfillable');
  eq(worst, 47, '...and none above 47, which is what the board can make');
  ok(seen.size === 46, 'every value from 2 to 47 came up', `${seen.size} distinct`);
}

{
  // The ramp is now in tile cost, not magnitude, but on a board with only +1
  // unlocked the two are the same thing (cost(v) is v-1), so the ceiling a
  // roll is bounded by should still land on the old formula, value for value.
  const legacyCeil = (boost, r1) => Math.min(HARD_CAP, 5 + boost * 3 + Math.floor(r1 * 8));
  let over = 0, under = 0;
  for (let boost = 0; boost < 12; boost++) {
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 40; b++) {
        const r1 = a / 8, r2 = b / 40;
        const ceil = legacyCeil(boost, r1);
        const mine = rollTarget({ ...OPENING, ordersFilled: boost }, seq([r1, r2]));
        if (mine > ceil) over++;
        if (mine < MIN_TARGET) under++;
      }
    }
  }
  eq(over, 0, 'no roll in the first dozen orders exceeds the old ramp ceiling');
  eq(under, 0, 'and none is below 2');
}

{
  // The actual fix, measured. The old generator ramped magnitude, and on a
  // board with x2 unlocked that stopped meaning anything: buildCosts prices
  // a value on a log2 curve once doubling exists, so climbing magnitude by 3
  // a roll left the tiles a player had to place flat for a long stretch
  // (round 1's finding: orders 15 to 30). This ramps tile cost directly, so
  // it has to actually keep demanding more tiles once x2 is bought, not just
  // bigger numbers.
  const withDoubler = { ...OPENING, unlocked: { mul2: true } };
  const maxCostOf = plan => { let m = 0; for (const c of plan.cost.values()) if (c > m) m = c; return m; };
  const avgCostAt = (ord, n = 1500) => {
    const s = { ...withDoubler, ordersFilled: ord };
    const plan = boardPlan(s);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += minCells(rollTarget(s), plan);
    return sum / n;
  };
  const maxCost = maxCostOf(boardPlan(withDoubler));
  ok(maxCost < 20, 'x2 alone caps this board\'s hardest tile count well under its 46-cell budget',
    `maxCost ${maxCost}`);

  const ord0 = avgCostAt(0), ord3 = avgCostAt(3), ord30 = avgCostAt(30);
  ok(ord0 < maxCost * 0.7, 'turn one with x2 already owned is not yet demanding the toolset\'s max',
    `avg ${ord0.toFixed(1)} vs a cap of ${maxCost}`);
  ok(ord3 > ord0, 'and it climbs by order 3', `${ord0.toFixed(1)} -> ${ord3.toFixed(1)}`);
  ok(ord30 > maxCost * 0.7,
    'by order 30 -- the stretch that used to be flat -- rolls average most of this board\'s hardest tile count',
    `avg ${ord30.toFixed(1)} vs a cap of ${maxCost}`);

  // The property that matters even more than the number: it holds however far
  // out ordersFilled goes, because maxCost is a fact about the board and the
  // unlocked ops, not about ordersFilled.
  const ord200 = avgCostAt(200);
  ok(ord200 > maxCost * 0.7, 'and it holds at order 200, long after the old ramp would have hit the 300 cap',
    `avg ${ord200.toFixed(1)} vs a cap of ${maxCost}`);
}

{
  const tiny = { cols: 3, rows: 1, unlocked: {}, ordersFilled: 90, grid: makeEmptyGrid(3, 1) };
  const t = rollTarget(tiny);
  ok(isReachable(t, boardPlan(tiny)), 'a floor with room for one +1 asks for 2, not for 275', `asked ${t}`);
}

{
  const s = { ...OPENING, ordersFilled: 400 };
  const t = rollTarget({ ...s, unlocked: { mul2: true } });
  ok(t <= HARD_CAP, 'the 300 cap still holds once the board can outrun it', `asked ${t}`);
}

/* -------------------------------------- reintroducing the bug it guards (#34) -- */

group('The bug, put back on purpose');

{
  // The old generator, verbatim from the pre-change file. If the guard is real,
  // this produces orders the board cannot fill and the new one does not.
  const randomTarget = (difficultyBoost, rand = Math.random) => {
    const ceil = Math.min(300, 5 + difficultyBoost * 3 + Math.floor(rand() * 8));
    return Math.max(2, Math.floor(rand() * ceil) + 1);
  };
  const plan = boardPlan({ ...OPENING, ordersFilled: 30 });
  let oldBad = 0, newBad = 0;
  for (let i = 0; i < 5000; i++) {
    if (!isReachable(randomTarget(30), plan)) oldBad++;
    if (!isReachable(rollTarget({ ...OPENING, ordersFilled: 30 }), plan)) newBad++;
  }
  ok(oldBad > 200, 'the old generator hands out impossible orders after 30 fills',
    `${oldBad}/5000 unfillable, up to ${5 + 30 * 3 + 7} against a board that stops at 47`);
  eq(newBad, 0, 'the new one hands out none');

  // Exactly when a real player could first meet one. The old ceiling was
  // 5 + 3k + up to 7, so the largest order it could ask for at k fills is 12 + 3k;
  // the opening floor stops at 47. Worth a number rather than "eventually".
  const worstOld = k => 12 + 3 * k;
  const ceiling = reachableMax(boardPlan(OPENING));
  let first = 0;
  while (worstOld(first) <= ceiling) first++;
  eq(first, 12, 'the twelfth order is the first that could be unfillable', `worst roll ${worstOld(12)} vs ceiling ${ceiling}`);
  ok(worstOld(11) <= ceiling, 'and the eleventh never could', `worst roll ${worstOld(11)}`);

  // ...unless the player bought x2, the one purchase that lifts the modelled
  // ceiling. Everything else in the shop leaves it at 47, which is why an
  // impossible order was reachable on a real save and not only in a test: nothing
  // makes a player spend the 80 ingots.
  for (const key of ['sub1', 'div2', 'split', 'merge_add', 'merge_mul']) {
    const max = reachableMax(boardPlan({ ...OPENING, unlocked: { [key]: true } }));
    eq(max, 47, `${key} leaves the modelled ceiling where it was`);
  }
  eq(reachableMax(boardPlan({ ...OPENING, unlocked: { mul2: true } })), HARD_CAP,
    'x2 takes it straight to the cap');

  // merge_mul is the one place the model is knowingly pessimistic. Two lines of
  // +1 into a Merge x really does reach (1+a)(1+b) — about 529 on this floor — but
  // the model is single-chain and cannot see it, so it keeps asking for 47 or less
  // on a board that could do more. That is under-promising, which is the safe
  // direction: it means an order stays easier than it could be, never impossible.
  const mergeOnly = boardPlan({ ...OPENING, unlocked: { merge_mul: true } });
  ok(reachableMax(mergeOnly) < 529,
    'and the merger case stays conservative rather than optimistic', `modelled max ${reachableMax(mergeOnly)}`);
}

/* ------------------------------------------------------------------ repair -- */

group('Loading a save');

{
  const s = freshState();
  ok(validState(s), 'a fresh state validates');
  ok(isReachable(s.sinks[0].target, boardPlan(s)), 'and its first order is fillable',
    `wants ${s.sinks[0].target}`);
  eq(countSinks(s.grid), 0, 'with nothing on the floor yet');
}

ok(!validState(null), 'null is refused');
ok(!validState({ hello: 'world' }), 'a blob with no grid is refused');
ok(!validState([]), 'an array is refused');
ok(!validState({ grid: [], cols: 'eight' }), 'a non-numeric width is refused');
ok(validState({ grid: [] }), 'but a save that is merely missing fields is not');

{
  // The crash. `cols` says 10, the grid holds 8 — renderGrid reads .type off
  // undefined on the first frame and the page never draws.
  const s = repairState({ cols: 10, rows: 6, grid: makeEmptyGrid(8, 6), sinks: [{ target: 3 }] });
  eq(s.grid[0].length, 10, 'a grid narrower than cols is padded, not left to crash the render');
  eq(s.grid.length, 6, 'row count intact');
  ok(s.grid.every(r => r.every(c => c && typeof c === 'object')), 'every cell is a real cell');
}

{
  // The other direction. Twelve columns of factory, a counter that says 8: the
  // old loader rendered 8 and the player's right-hand four columns vanished.
  const wide = makeEmptyGrid(12, 8);
  wide[0][11].type = 'belt';
  const s = repairState({ cols: 8, rows: 6, grid: wide, sinks: [{ target: 3 }] });
  eq(s.cols, 12, 'a grid wider than cols grows the counter instead of dropping tiles');
  eq(s.rows, 8, 'same for rows');
  eq(s.grid[0][11].type, 'belt', 'and the far corner tile survived');
}

{
  const s = repairState({ cols: 8, rows: 6, grid: makeEmptyGrid(8, 6), unlocked: { mul2: true } });
  eq(s.unlocked.mul2, true, 'an unlock that was set stays set');
  eq(s.unlocked.fastSource, false, 'one the save predates comes back false, not undefined');
  ok(Object.keys(s.unlocked).length === 11, 'every unlock key is present', Object.keys(s.unlocked).join(' '));
}

{
  // An order from before the generator knew about the board.
  const s = repairState({ cols: 8, rows: 6, grid: makeEmptyGrid(8, 6), sinks: [{ target: 260 }] });
  ok(isReachable(s.sinks[0].target, boardPlan(s)),
    'an unfillable order in an old save is pulled down to one that fits',
    `260 became ${s.sinks[0].target}`);
  eq(s.sinks[0].target, 47, '...to the nearest the board can reach');
}

{
  const grid = makeEmptyGrid(8, 6);
  grid[2][3] = { ...grid[2][3], type: 'sink', sinkIndex: 0 };
  grid[4][5] = { ...grid[4][5], type: 'sink', sinkIndex: 0 };   // both claim slot 0
  const s = repairState({ cols: 8, rows: 6, grid, sinks: [{ target: 3 }] });
  ok(s.grid[2][3].sinkIndex !== s.grid[4][5].sinkIndex, 'two sinks cannot share one order');
  eq(s.sinks.length, 2, 'and the second one gets an entry of its own');
  ok(s.sinks.every(k => Number.isFinite(k.target)), 'both with a real number in it');
}

{
  const grid = makeEmptyGrid(8, 6);
  grid[1][1] = { type: 'belt', dir: 'UP', packet: { value: 'seven' }, mergeBuf: 'nope', sourceTimer: NaN, sinkIndex: 3 };
  grid[1][2] = { type: 'wormhole' };
  const s = repairState({ cols: 8, rows: 6, grid, ingots: 'lots', prestigeMult: null, log: 'nope' });
  eq(s.grid[1][1].dir, 'E', 'a direction that is not a direction resets');
  eq(s.grid[1][1].packet, null, 'a packet holding a string is dropped');
  ok(Array.isArray(s.grid[1][1].mergeBuf), 'a merge buffer that is not an array becomes one');
  eq(s.grid[1][1].sourceTimer, 0, 'a NaN timer becomes 0');
  eq(s.grid[1][1].sinkIndex, null, 'a sink index on a belt is cleared');
  eq(s.grid[1][2].type, null, 'a tile type this build has never heard of is cleared');
  eq(s.ingots, 0, 'ingots that will not coerce become 0 rather than NaN');
  eq(s.prestigeMult, 1, 'and the multiplier falls back to 1');
  ok(Array.isArray(s.log), 'the log is an array');
}

/* ---------------------------------------------------------------- the slot -- */

group('The save slot');

const stub = () => {
  const mem = new Map();
  return {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    __raw: mem,
  };
};

{
  const store = stub();
  const slot = foundrySlot(store);
  eq(slot.key, 'integer-foundry-save-v1', 'the storage key is unchanged (locked decision #36)');
  eq(slot.game, 'integer-foundry', 'and the export envelope is stamped with the game');

  const s = freshState();
  s.ingots = 40;
  ok(slot.save(s), 'a state saves');
  const back = slot.load();
  eq(back.ingots, 40, 'and loads back');
  eq(back.__v, undefined, 'with the version stamp stripped off the state');

  store.setItem(SAVE_KEY, '{not json');
  eq(slot.load(), null, 'corrupt JSON loads as null instead of booting the game on it');
  store.setItem(SAVE_KEY, JSON.stringify({ hello: 'world' }));
  eq(slot.load(), null, 'so does somebody else\'s save');

  const fresh = slot.reset();
  ok(fresh && Array.isArray(fresh.grid), 'reset hands back a real fresh state, not null');
  eq(store.getItem(SAVE_KEY), null, 'and clears the key');
}

{
  const slot = foundrySlot(stub());
  const s = freshState();
  s.ordersFilled = 9;
  const text = slot.serialize(s);
  const round = slot.deserialize(text);
  eq(round.ordersFilled, 9, 'export and re-import round-trips the state');
  eq(JSON.parse(text).format, 'gvb-save', 'in the shared envelope');
  eq(slot.deserialize(JSON.stringify({ format: 'gvb-save', game: 'closing-time', version: 1, state: s })), null,
    'a save from another game is refused');
  eq(slot.deserialize('not json at all'), null, 'and so is a file that is not a save');
}

/* ------------------------------------------- a save the OLD build wrote ------ */

group('A save written by the pre-gvb-save build');

{
  const file = path.join(HERE, 'fixtures', 'legacy-save-v0.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(!('__v' in raw), 'the fixture carries no version stamp, as an old save would not');

  const store = stub();
  store.setItem(SAVE_KEY, JSON.stringify(raw));
  const s = foundrySlot(store).load();
  ok(!!s, 'it loads');
  eq(s.cols, 8, 'the floor came back');
  eq(s.grid.length, 6, 'with its rows');
  const placed = s.grid.flat().filter(c => c.type).length;
  eq(placed, 9, 'and the nine tiles that were on it');
  eq(s.grid[2][0].type, 'source', 'source where it was left');
  eq(s.grid[2][7].type, 'sink', 'sink where it was left');
  ok(isReachable(s.sinks[0].target, boardPlan(s)), 'and its order is one the board can fill',
    `wants ${s.sinks[0].target}`);
  eq(s.unlocked.fastSource, false, 'every unlock key present after the load');
}

/* ---------------------------------------------------------------------------- */

console.log(`\n${pass + fail} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
