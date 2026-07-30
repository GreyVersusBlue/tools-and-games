// targets.js — what number can this factory actually make, and what should the
// sink ask for.
//
// The old generator was `Math.floor(Math.random()*ceil)+1` with a ceiling that
// grew with orders filled and knew nothing about the board. That is the bug this
// file exists to remove: an order the player cannot fill is not a hard order, it
// is a broken one, and the game had no way to tell the difference.
//
// The model
// ---------
// A packet leaves a source as a 1 and is transformed once per operator tile it
// crosses. So "can this board make N" is: is there a chain of unlocked operators,
// no longer than the number of cells the board can spare, that takes 1 to N. That
// is a shortest-path problem on the integers, and `buildCosts` is a plain BFS over
// it — uniform cost per tile, so the first time a value is reached is the cheapest
// way to reach it.
//
// Mergers and splitters are deliberately left out. They only ever ADD reachable
// values, never remove one, so a target this file admits is still buildable on a
// board that has them — the model under-promises, which is the safe direction. It
// also means the answer does not depend on the layout currently on the floor: it
// is what the board is CAPABLE of, so an order stays fillable after the player
// tears their line down, which is most of what playing this game is.
//
// Pure: no DOM, no storage, no `Math.random` unless you let it in. Node runs it,
// which is the whole point — test/smoke-targets.mjs is where the range claims in
// the handoff come from.

/** The four single-input operators, with the arithmetic the simulator uses. */
export const OP_TILES = {
  add1: { label: '+1',         unlock: null,   apply: v => v + 1 },
  sub1: { label: '-1',         unlock: 'sub1', apply: v => Math.max(0, v - 1) },
  mul2: { label: '×2',    unlock: 'mul2', apply: v => v * 2 },
  div2: { label: '÷2',    unlock: 'div2', apply: v => Math.floor(v / 2) },
};

/** Ceiling on any order, whatever the board could manage. Was `Math.min(300, …)`. */
export const HARD_CAP = 300;

/** Every order is at least this, so a sink never asks for the 1 a source emits. */
export const MIN_TARGET = 2;

/**
 * Operator cells one production line can have to itself.
 *
 * A line needs one source and one sink of its own, and a straight chain of k
 * operators occupies exactly k cells — an 8x6 grid takes a 48-cell snake, so the
 * bound is tight rather than optimistic. Multiple sinks split the floor between
 * them; dividing is conservative (real lines share a prefix through a splitter)
 * and it stops three sinks all being promised the whole board.
 */
export function opBudget({ cols, rows, sinks = 1 }) {
  const slots = Math.max(1, Math.floor(sinks) || 1);
  return Math.max(0, Math.floor((Math.floor(cols) * Math.floor(rows) - 1 - slots) / slots));
}

/** Sink tiles actually on the floor. 0 counts as 1: the player is about to place one. */
export function countSinks(grid) {
  let n = 0;
  if (!Array.isArray(grid)) return 0;
  for (const row of grid) if (Array.isArray(row)) for (const c of row) if (c && c.type === 'sink') n++;
  return n;
}

const memo = new Map();

/**
 * Cheapest operator-chain from 1 to every value the board can reach.
 *
 * Returns `{ cost, from, ops, max }` — `cost` maps value to tiles needed, `from`
 * maps value to the `{op, prev}` that got there first, `max` is the largest value
 * reachable at all. BFS by tile count, so the first arrival is the cheapest one.
 */
export function buildCosts(unlocked, budget, limit = HARD_CAP) {
  const ops = Object.keys(OP_TILES).filter(k => !OP_TILES[k].unlock || !!(unlocked && unlocked[OP_TILES[k].unlock]));
  const key = ops.join(',') + '|' + budget + '|' + limit;
  const hit = memo.get(key);
  if (hit) return hit;

  const cost = new Map([[1, 0]]);
  const from = new Map([[1, null]]);
  let frontier = [1], max = 1;
  for (let depth = 1; depth <= budget && frontier.length; depth++) {
    const next = [];
    for (const v of frontier) {
      for (const op of ops) {
        const w = OP_TILES[op].apply(v);
        // Nothing routes through 0: the only way out of it is +1 back to a value
        // already reached for free. Above the cap is off the board by definition.
        if (w < 1 || w > limit || cost.has(w)) continue;
        cost.set(w, depth);
        from.set(w, { op, prev: v });
        if (w > max) max = w;
        next.push(w);
      }
    }
    frontier = next;
  }

  const out = { cost, from, ops, max };
  if (memo.size > 64) memo.clear();
  memo.set(key, out);
  return out;
}

/** Everything `buildCosts` needs, read off a game state. */
export function boardPlan(state) {
  const sinks = countSinks(state && state.grid);
  const budget = opBudget({ cols: state.cols, rows: state.rows, sinks });
  return { ...buildCosts(state.unlocked, budget), budget, sinks: Math.max(1, sinks) };
}

/** Tiles needed to build exactly `n`, or Infinity if this board cannot. */
export function minCells(n, plan) {
  const c = plan.cost.get(n);
  return c === undefined ? Infinity : c;
}

/** Can this board be built into a line that delivers exactly `n`? */
export function isReachable(n, plan) {
  return Number.isInteger(n) && n >= MIN_TARGET && plan.cost.has(n);
}

/** The largest order this board could ever fill. */
export function reachableMax(plan) {
  return plan.max;
}

/** The operator chain, source end first, that `buildCosts` found for `n`. */
export function recipe(n, plan) {
  if (!plan.cost.has(n)) return null;
  const out = [];
  let v = n;
  while (plan.from.get(v)) {
    const step = plan.from.get(v);
    out.push(step.op);
    v = step.prev;
  }
  return out.reverse();
}

/** "10x +1" / "x2, +1, x2" — a chain a player can read off a tooltip. */
export function describeRecipe(chain) {
  if (!chain) return '';
  if (!chain.length) return 'a source straight into the sink';
  const runs = [];
  for (const op of chain) {
    const last = runs[runs.length - 1];
    if (last && last.op === op) last.n++;
    else runs.push({ op, n: 1 });
  }
  return runs.map(r => (r.n > 1 ? `${r.n}× ` : '') + OP_TILES[r.op].label).join(', ');
}

/** The reachable value closest to `n`, ties going low. Used to rescue old saves. */
export function nearestReachable(n, plan) {
  if (isReachable(n, plan)) return n;
  let best = null, bestD = Infinity;
  for (const v of plan.cost.keys()) {
    if (v < MIN_TARGET) continue;
    const d = Math.abs(v - n);
    if (d < bestD || (d === bestD && v < best)) { best = v; bestD = d; }
  }
  return best === null ? MIN_TARGET : best;
}

/**
 * Roll the next order.
 *
 * The difficulty ramp is the original one — a ceiling of 5 + 3 per order filled,
 * jittered by up to 7, capped at 300 — so the curve a player feels is unchanged.
 * What is new is the second line: the ceiling is also clamped to what the board
 * can build, and the value is drawn from the reachable set rather than from a
 * bare integer range. With only `+1` unlocked every integer up to the budget is
 * reachable, so early play is bit-for-bit what it was; the clamp only bites once
 * the ramp outruns the floor, which is exactly the case that used to hand out
 * impossible orders.
 */
export function rollTarget(state, rand = Math.random) {
  const plan = boardPlan(state);
  const ramp = Math.min(HARD_CAP, 5 + Math.max(0, Math.floor(state.ordersFilled) || 0) * 3 + Math.floor(rand() * 8));
  const ceil = Math.min(ramp, plan.max);

  const pool = [];
  for (const v of plan.cost.keys()) if (v >= MIN_TARGET && v <= ceil) pool.push(v);
  if (!pool.length) {
    // Only possible on a board too small to hold a line at all, which no shop
    // path can produce. Ask for the cheapest thing that exists rather than for
    // a number that does not.
    const any = [...plan.cost.keys()].filter(v => v >= MIN_TARGET).sort((a, b) => a - b);
    return any.length ? any[0] : MIN_TARGET;
  }
  pool.sort((a, b) => a - b);
  return pool[Math.floor(rand() * pool.length)];
}

export default { OP_TILES, HARD_CAP, MIN_TARGET, opBudget, countSinks, buildCosts,
  boardPlan, minCells, isReachable, reachableMax, recipe, describeRecipe,
  nearestReachable, rollTarget };
