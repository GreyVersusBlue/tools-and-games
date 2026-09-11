/* stunt.js — the stunt run's geometry, and what a scale is worth.
 *
 * Imports nothing, on purpose. All of it is arithmetic over one number, so
 * test/smoke-save.mjs can prove three cows and thirteen buses are three
 * different stunts without opening a browser, the way money.js lets the
 * economy be checked under plain Node.
 *
 * Phase 7. Before this, `SCALES` carried `{n, unit, label}` and nothing else:
 * ramp angle, gravity, green speed band, landing tolerance and drift were
 * identical at Milestone 1 and Milestone 4, and thirteen buses was three cows
 * with ten more silhouettes drawn between the ramps. Everything a tier changes
 * is derived from `n` here, so a fourth scale is one row in SCALES.
 *
 * The one derivation worth reading twice is `GREEN_C`. The required launch
 * speed is not a number somebody picked per tier: it is solved out of the
 * geometry — the speed that puts the wheel down 52.7% of the way along the
 * landing ramp. A longer gap therefore demands a faster approach by
 * construction, and the two cannot drift apart, which is the failure mode a
 * second hand-kept table has. At three cows it solves to 485, the constant the
 * game shipped with, so Milestone 1 rides exactly as it did.
 */

export const SCALES = {
  cows:  { n: 3,  unit: 'cows',  label: 'Milestone 1 · Cows' },
  cars:  { n: 9,  unit: 'cars',  label: 'Milestone 3 · Cars' },
  buses: { n: 13, unit: 'buses', label: 'Milestone 4 · Bus Stack' },
};

/* The world that does not move. Ramp angle and gravity are the physics of the
 * place rather than of the stunt; the far side of the gap and the run-up are
 * what a tier moves. */
export const GEO = {
  GY: 420, RAMP_START: 760, LIP: 980,
  RAMP_DEG: 36, LAND_DEG: 18, GRAV: 340, WB: 46, WR: 13, LAND_LIP_H: 70,
  ACCEL: 235, BRAKE: 300, FRICT: 26,
  DRIFT_F1: 2.1, DRIFT_F2: 3.7, WMAX: 160,
};

/* Three cows is the floor and thirteen buses the ceiling the run-up was solved
 * for; TIER_FLOOR and TIER_SPAN are those two, named. A scale past thirteen
 * clamps rather than extrapolating off the end of the ramp, and smoke-save.mjs
 * fails the moment a row is added that clamps onto another one. */
export const TIER_FLOOR = 3, TIER_SPAN = 10;

/* Where on the landing ramp a perfectly judged approach puts the wheel. 0.527
 * is not a taste: it is where 485 already landed at three cows, read back off
 * the old constants so Milestone 1 does not move. */
export const LAND_FRAC = 0.527;

const D2R = Math.PI / 180;
const sin = d => Math.sin(d * D2R), cos = d => Math.cos(d * D2R), tan = d => Math.tan(d * D2R);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const tierOf = n => clamp((n - TIER_FLOOR) / TIER_SPAN, 0, 1);

/** The lip's height, which the ramp's length and angle fix. */
export const lipTopY = () => GEO.GY - (GEO.LIP - GEO.RAMP_START) * tan(GEO.RAMP_DEG);

/**
 * Where a launch at `v` puts the wheel, for a landing ramp starting at
 * `landTop`. Closed form: the flight is a parabola and the landing ramp is a
 * line, so contact is the positive root of one quadratic.
 *
 * A speed too slow to reach the ramp at all has no root; that returns the lip,
 * which is short of every landing zone and keeps `speedForContact` monotonic.
 */
export function contactXFor(v, landTop) {
  const { GY, LIP, RAMP_DEG, LAND_DEG, GRAV, WR, LAND_LIP_H } = GEO;
  const y0 = lipTopY() - WR, vx = v * cos(RAMP_DEG), vy = -v * sin(RAMP_DEG), tb = tan(LAND_DEG);
  const a = GRAV / 2;
  const b = vy - vx * tb;
  const c = y0 + WR - (GY - LAND_LIP_H) - (LIP - landTop) * tb;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return LIP;
  return LIP + vx * ((-b + Math.sqrt(disc)) / (2 * a));
}

/** The launch speed that lands at `x`. Bisection — `contactXFor` rises with v. */
export function speedForContact(x, landTop) {
  let lo = 100, hi = 1200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (contactXFor(mid, landTop) < x) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Everything one stunt run needs, for one scale and one set of skills.
 *
 * `skills` is the 0-100 form the engine keeps (`SKILLS`, stats times twenty),
 * and every skill term is exactly the one the run carried before — the tier
 * multiplies them, it does not replace them.
 */
export function stuntTuning(scale, skills) {
  const S = SCALES[scale] || SCALES.cows;
  const t = tierOf(S.n);
  const nerve = skills.nerve, prec = skills.precision, cond = skills.condition;

  // The run-up lengthens and the bike gets more top end, because the gap that
  // follows demands a speed the Milestone 1 straight cannot build. Both are
  // what keeps the required speed reachable; smoke-save.mjs checks the margin.
  const START = 80 - Math.round(t * 260);
  const VMAX = 590 + Math.round(t * 90);

  // The gap, and the landing zone that closes around it.
  const LAND_TOP = GEO.LIP + 620 + Math.round(t * 520);
  const LAND_END = LAND_TOP + (400 - Math.round(t * 90));
  const FINISH = LAND_END + 300, WORLD_END = FINISH + 180;
  // Where the ground polygon and the camera's left stop begin. Zero unless the
  // start line has moved left of it, so three cows keeps the exact camera pan
  // it shipped with and only the tiers that lengthen the run-up move it.
  const WORLD_START = START > 0 ? 0 : START - 120;

  const GREEN_C = Math.round(speedForContact(LAND_TOP + LAND_FRAC * (LAND_END - LAND_TOP), LAND_TOP));
  // 0.2025 is the old `(nerve/100) * 0.45 * 100 * 0.45`, multiplied out. Same
  // number at every skill level; smoke-save.mjs pins it against the original
  // expression so the arithmetic cannot quietly drift.
  const greenHalf = (30 + nerve * 0.2025) * (1 - 0.35 * t);

  return {
    S, tier: t, scale: SCALES[scale] ? scale : 'cows',
    START, VMAX, LAND_TOP, LAND_END, FINISH, WORLD_END, WORLD_START,
    LIP_TOP_Y: lipTopY(),
    GREEN_C, greenHalf, yellowHalf: greenHalf * 2.0,
    // Body angle at touchdown. The window the landing is judged in narrows a
    // quarter across the three tiers; the air gets rougher by a third.
    TOL: (16 + (prec / 100) * 22) * (1 - 0.25 * t),
    DRIFT_A: (52 + (1 - cond / 100) * 150) * (1 + 0.35 * t),
    BAL_BAND: 22 + (prec / 100) * 14,
    CTRL: 150 + (nerve / 100) * 170,
    TARGET_ANG: -GEO.LAND_DEG,
  };
}

/* ------------------------------------------------------------- the retry */
/* "Try Again" restarted any run for free, so the outcome that decides
 * `GS.flags.stuntOutcome` and three chapters of framing was re-rollable until
 * the player liked it. One retry, and it costs a point of Condition — the stat
 * the run's own drift term reads, so a second attempt is measurably shakier
 * than the first. A player with no Condition left has nothing to spend and the
 * result stands (#291). */
export const RETRY_LIMIT = 1;
export const RETRY_CONDITION_COST = 1;

/** Can this result be re-ridden? `condition` is the 0-5 stat, not the 0-100 skill. */
export function canRetry(gameId, retriesUsed, condition) {
  if (gameId === 'recovery') return false;   // the body is not a re-roll
  return retriesUsed < RETRY_LIMIT && condition >= RETRY_CONDITION_COST;
}
