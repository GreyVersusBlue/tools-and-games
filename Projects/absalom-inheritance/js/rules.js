// rules.js — the PF2e Remaster math, and nothing else.
//
// No DOM, no content, no game state. Everything here is a pure function of its
// arguments plus an injected RNG, which is what makes test/balance.mjs able to
// play ten thousand encounters under Node and get the same answer twice.
//
// Page references are to the Remaster books, and they are load-bearing: when a
// number in content/vault.json looks wrong, the argument is settled here.

/* ---------------------------------------------------------------------------
   Randomness

   Every roll in this game goes through an rng passed down from the caller. The
   browser passes Math.random; the tests pass a seeded generator. A module that
   reaches for Math.random itself is a module the balance harness cannot measure.
--------------------------------------------------------------------------- */

/** mulberry32 — small, fast, good enough for dice, identical across runs. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One die. `die(20, rng)` → 1..20. */
export function die(size, rng) {
  return 1 + Math.floor(rng() * size);
}

/** `rollDice(2, 6, rng)` → { rolls: [4,1], total: 5 }. */
export function rollDice(count, size, rng) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(die(size, rng));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

/**
 * Parse a damage string into a spec. "1d6+2" → {n:1, s:6, plus:2}.
 * Content files write damage the way a stat block does; the engine wants
 * numbers. A malformed string throws rather than quietly rolling 0 damage —
 * a sentinel that hits for nothing is the silent-failure class this repo has
 * been bitten by before (v7 §2, the staffer with a NaN walking speed).
 */
export function parseDamage(text) {
  const m = /^\s*(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(String(text));
  if (!m) throw new Error(`parseDamage: cannot read "${text}" (want e.g. "1d6+2")`);
  const plus = m[3] ? (m[3] === "-" ? -Number(m[4]) : Number(m[4])) : 0;
  return { n: Number(m[1]), s: Number(m[2]), plus };
}

export function rollDamage(spec, rng) {
  const dice = rollDice(spec.n, spec.s, rng);
  const total = Math.max(0, dice.total + spec.plus);
  const math = `${spec.n}d${spec.s}(${dice.rolls.join("+")})` +
    (spec.plus ? ` ${spec.plus > 0 ? "+" : "-"}${Math.abs(spec.plus)}` : "") +
    ` = ${total}`;
  return { total, math };
}

/* ---------------------------------------------------------------------------
   Degrees of success — Player Core p.404
--------------------------------------------------------------------------- */

export const DEG = { CRIT_FAIL: 0, FAIL: 1, SUCC: 2, CRIT_SUCC: 3 };
export const DEG_NAME = ["CRITICAL FAILURE", "Failure", "Success", "CRITICAL SUCCESS"];

/**
 *   total >= DC + 10  → critical success
 *   total >= DC       → success
 *   total <= DC - 10  → critical failure
 *   otherwise         → failure
 * A natural 20 improves the degree one step; a natural 1 worsens it one step.
 */
export function degreeOfSuccess(natural, total, dc) {
  let deg;
  if (total >= dc + 10) deg = DEG.CRIT_SUCC;
  else if (total >= dc) deg = DEG.SUCC;
  else if (total <= dc - 10) deg = DEG.CRIT_FAIL;
  else deg = DEG.FAIL;
  if (natural === 20) deg = Math.min(DEG.CRIT_SUCC, deg + 1);
  if (natural === 1) deg = Math.max(DEG.CRIT_FAIL, deg - 1);
  return deg;
}

/** A d20 check. Returns the parts so a caller can log the full breakdown. */
export function check(bonus, dc, rng) {
  const natural = die(20, rng);
  const total = natural + bonus;
  return {
    natural, total, dc, bonus,
    deg: degreeOfSuccess(natural, total, dc),
    math: `d20(${natural}) ${bonus >= 0 ? "+" : "-"}${Math.abs(bonus)} = ${total} vs DC ${dc}`,
  };
}

/** Basic save damage scaling — Player Core p.406. */
export function basicSaveDamage(deg, dmg) {
  if (deg === DEG.CRIT_SUCC) return 0;
  if (deg === DEG.SUCC) return Math.floor(dmg / 2);
  if (deg === DEG.FAIL) return dmg;
  return dmg * 2;
}

/**
 * Multiple Attack Penalty — Player Core p.407.
 *
 * −5 on the second attack of a turn, −10 on the third and later. An *agile*
 * weapon reduces that to −4/−8, and the dagger this PC carries is agile, so
 * `agile` is a real parameter rather than a comment apologising for ignoring
 * it. The original single-file build hardcoded −5/−10 and said so in a note;
 * a dagger wielder loses a measurable amount of damage to that.
 */
export function mapPenalty(attacksThisTurn, agile = false) {
  if (attacksThisTurn <= 0) return 0;
  if (attacksThisTurn === 1) return agile ? 4 : 5;
  return agile ? 8 : 10;
}

/* ---------------------------------------------------------------------------
   Distance and movement — Player Core p.421

   Diagonals alternate 5 ft / 10 ft. Every distance in this game runs through
   feetBetween, including spell ranges and the aggro radius, so "within 30 ft"
   means the same thing everywhere.
--------------------------------------------------------------------------- */

export function feetBetween(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  const diag = Math.min(dx, dy), straight = Math.max(dx, dy) - diag;
  return straight * 5 + diag * 5 + Math.floor(diag / 2) * 5;
}

export const isAdjacent = (a, b) =>
  feetBetween(a.x, a.y, b.x, b.y) <= 5 && (a.x !== b.x || a.y !== b.y);

/** Strides needed to cover `feet` at a given Speed. Player Core p.438. */
export function stridesFor(feet, speed) {
  if (feet <= 0) return 0;
  return Math.ceil(feet / speed);
}
