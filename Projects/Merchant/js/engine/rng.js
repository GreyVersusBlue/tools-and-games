// The game's one source of chance (ARCHITECTURE 2.2). mulberry32 over a 32-bit
// integer kept in state.rng. Every helper advances state.rng in place, so call
// them on the clone an engine function works on, never on a state a caller holds.
// Draw order is part of the contract: a new draw before an old one changes every
// seeded game.

/** One draw in [0, 1). */
export function next(state) {
  const a = (state.rng + 0x6D2B79F5) | 0;
  state.rng = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whole number from lo to hi, both included. One draw. */
export function int(state, lo, hi) {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new Error(`int: bad range ${lo}..${hi}`);
  return lo + Math.floor(next(state) * (hi - lo + 1));
}

/** One item of a list. One draw. */
export function pick(state, list) {
  if (!list.length) throw new Error('pick: empty list');
  return list[Math.floor(next(state) * list.length)];
}

/** One item by weight (weightOf defaults to item.weight, and a missing weight is 1). One draw. */
export function weighted(state, items, weightOf = it => it.weight ?? 1) {
  const ws = items.map(weightOf);
  if (ws.some(w => !(w >= 0))) throw new Error('weighted: a weight is negative or not a number');
  const total = ws.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error('weighted: no item has weight');
  let r = next(state) * total;
  for (let i = 0; i < items.length; i++) {
    if (ws[i] === 0) continue;
    if (r < ws[i]) return items[i];
    r -= ws[i];
  }
  return items[ws.findLastIndex(w => w > 0)];
}

/** True with probability p. One draw. */
export function chance(state, p) {
  return next(state) < p;
}

/** Standard normal (Box-Muller). Two draws. */
export function normal(state) {
  const u1 = 1 - next(state);
  const u2 = next(state);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
