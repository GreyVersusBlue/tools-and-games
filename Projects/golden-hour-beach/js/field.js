// The beach as numbers: the heightfield, and the fixed layout of everything
// standing on it. No three.js import, on purpose — this file is the half of the
// world that can be checked without a browser, and `test/smoke.mjs` imports it
// directly. terrain.js, ocean.js, props.js and controls.js all read the ground
// height from here.
//
// Coordinate convention:
//   +Z = inland (dunes), -Z = out to sea. The waterline swings between z ≈ -9.5
//   and z ≈ -3.6 over the swash cycle. Sea level is y = 0.

/* --------------------------------------------------------------- heightfield */

// Tiny deterministic value noise. Same input, same dune, every visit.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * vnoise(x * f, y * f);
    amp *= 0.5; f *= 2.1;
  }
  return sum;
}

/* ---------------------------------------------------------------- the coast */

// The world is 1.6 km of coastline now, and the one decision everything else
// hangs off is that the shoreline stays a curve parameterized by x:
// `shorelineZ(x)`. The home beach keeps its waterline at exactly z = -6; the
// headland in the far west bulges the land seaward, pushing it to z ≈ -40.
// Every system that used to assume "the waterline is near -6" now works in the
// signed shore distance s = z - shorelineZ(x) instead.
//
// Inside the original beach (x within ±140), shorelineZ is exactly -6, every
// region feature is exactly zero, and groundHeight reduces to the formula it
// has had since round 1 — bit-identical. The smoke suite holds twelve golden
// heights against that claim, so the home beach can never quietly move.

const clamp01 = t => Math.max(0, Math.min(1, t));
const sstep = (e0, e1, t) => smooth(clamp01((t - e0) / (e1 - e0)));

export function shorelineZ(x) {
  // The headland bulges the line seaward in the west; the estuary notches it
  // inland in the east. Curvature stays gentle by construction — smoothsteps
  // over 120+ m — and the smoke suite asserts the cap, because the foam strip
  // folds over itself if this ever bends sharply.
  return -6
    - 34 * sstep(0, 1, (-x - 420) / 140)
    + 18 * sstep(0, 1, (x - 460) / 130) * sstep(0, 1, (760 - x) / 90);
}

export function seabedSlope(x) {
  // Rockier, steeper water off the headland: wading stops sooner there, which
  // is what a shelf under a cliff should do.
  return 0.10 + 0.06 * sstep(0, 1, (-x - 420) / 140);
}

export function beachSlope() {
  return 0.055;
}

/** Named stretch of coast. z only matters where the dunes sit behind home. */
export function regionAt(x, z = 0) {
  if (x < -420) return 'headland';
  if (x > 420) return 'estuary';
  if (x > 180) return 'pier';
  if (z > 50) return 'dunes';
  return 'home';
}

/**
 * Blend weights for the audio crossfade (and anything else that wants "how
 * headland is it here"). Sums to 1. By x only — the soundscape of the dunes is
 * the home beach's, quieter, which audio gets from distance already.
 */
export function regionWeights(x) {
  const headland = sstep(0, 1, (-x - 300) / 140);
  const estuary = sstep(0, 1, (x - 300) / 140);
  const home = 1 - headland - estuary;
  return { headland, home, estuary };
}

// The tide pools on the headland shelf. Defined before groundHeight because
// the heightfield carves each pool's basin; rendered by props.js; checked by
// smoke.mjs. z is shore-relative s turned absolute at generation time.
const POOLS = (() => {
  const rnd = mulberry32(0x9001);
  const out = [];
  for (const px of [-472, -498, -524, -551, -577]) {
    const s = 2 + rnd() * 2.4;
    out.push({
      x: px + (rnd() - 0.5) * 6,
      z: shorelineZ(px) + s,
      r: 1.7 + rnd() * 1.5,
      depth: 0.35 + rnd() * 0.25,
    });
  }
  return out;
})();

// The dune trail's centreline: a winding walkable trough carved through the
// dune field behind the home beach. Pure function of z so props (the fence)
// and the heightfield can both follow it.
export function trailX(z) {
  return 18 * Math.sin(z * 0.045) + 26 * Math.sin(z * 0.012 + 1);
}

// The river's centreline through the estuary, mouth to marsh. Pure for the
// same reason as trailX: the channel carve, the water ribbon, the reed beds
// and the heron all follow the same curve.
export function riverX(z) {
  return 610 + 14 * Math.sin(z * 0.03 + 1);
}

/**
 * The old pier: a ruined timber deck walking out over the water at x = 300.
 * The deck is real ground — groundHeight returns the deck surface inside its
 * rectangle, which is what makes it walkable with no special cases anywhere
 * else. It ends at a collapsed span (deckEnd); the stumps continue seaward,
 * for the cormorants and for the eye.
 */
export const PIER = {
  x: 300, halfW: 1.9,
  deckStart: 9, deckEnd: -18,   // walkable planking
  stumpEnd: -36,                // broken piles continue to here
  y0: 1.25, y1: 2.05,           // deck height, shore end → sea end
};

export function onPier(x, z) {
  return Math.abs(x - PIER.x) <= PIER.halfW && z <= PIER.deckStart && z >= PIER.deckEnd;
}

export function pierDeckY(z) {
  const t = clamp01((PIER.deckStart - z) / (PIER.deckStart - PIER.deckEnd));
  return PIER.y0 + (PIER.y1 - PIER.y0) * t;
}

// The sea cave: a recess scooped out of the headland mass at the cliff base,
// entered from the tide-pool shelf. Kept as data so the audio zone, the
// arrival card and the smoke checks agree on where it is.
export const CAVE = { x: -536, z: shorelineZ(-536) + 8, r: 9 };

export function groundHeight(x, z) {
  const sz = shorelineZ(x);
  const s = z - sz;
  let h;
  if (s < 0) {
    h = s * seabedSlope(x);                // underwater slope
  } else {
    h = s * beachSlope();                  // dry beach, gentle rise
  }
  // Dunes rise where the beach has run s ≈ 28 m inland — the same (z - 22)/22
  // ramp as ever where the shoreline sits at -6.
  const duneT = smooth(clamp01((s - 28) / 22));
  const dunes = fbm(x * 0.025 + 3.7, z * 0.05) * 5.5 + fbm(x * 0.09, z * 0.13) * 1.2;
  h += duneT * (1.8 + dunes);
  h += Math.sin(x * 0.012) * 0.25 * smooth(clamp01((s - 2) / 10));

  // ---- region features, all exactly zero on the home beach ----

  // The headland: 18 m of shoulder. Its seaward face sharpens from a walkable
  // ramp on the east flank (climb it from the dunes) to a real cliff in the
  // west (the 0.9 m step rule in controls.js is the fence); the strip along
  // the waterline under it stays low the whole way — that is the tide-pool
  // shelf, and the way down is to walk around, not over.
  if (x < -400) {
    const massX = sstep(0, 1, (-x - 450) / 110);
    if (massX > 0) {
      const faceW = 50 - 36 * sstep(0, 1, (-x - 500) / 90);
      const massS = Math.pow(sstep(0, 1, (s - 6) / faceW), 1.15);
      // The sea cave: a recess scooped from the mass at the cliff base. The
      // scoop's floor stays near shelf level (mass is small there anyway), so
      // you can walk in; its sides rise fast enough that the step rule keeps
      // you from climbing out through the roof.
      const dcx = x - CAVE.x, dcs = s - 8;
      const scoop = 1 - 0.85 * Math.exp(-(dcx * dcx / 90 + dcs * dcs / 40));
      h += 18 * massX * massS * scoop;
    }
    // Pool basins, only worth computing anywhere near the shelf.
    if (x > -620 && s > -1 && s < 8) {
      for (const p of POOLS) {
        const dx = x - p.x, dz = z - p.z;
        const d2 = (dx * dx + dz * dz) / (p.r * p.r);
        if (d2 < 1) {
          const bump = 1 - d2;
          h -= p.depth * bump * bump;
        }
      }
    }
  }

  // The dune trail: a carved trough, starting past the old inland wall (z 48,
  // outside the golden rectangle) and winding to the back of the dune field.
  if (z > 44 && x > -300 && x < 300) {
    const ramp = sstep(0, 1, (z - 48) / 12) * sstep(0, 1, (118 - z) / 8);
    if (ramp > 0) {
      const dx = x - trailX(z);
      h -= 3.2 * ramp * Math.exp(-(dx * dx) / 40);
    }
  }

  // The river: a shallow channel wound through the estuary. Shallow on
  // purpose — nowhere deeper than a determined wade, so the far bank is a
  // squelch away, and the sand bar at the mouth barely covers your ankles.
  if (x > 555 && x < 665 && z > sz - 6 && z < 112) {
    const drx = x - riverX(z);
    const depth = 0.45 + 0.3 * sstep(0, 1, (z - 14) / 40);
    const ramp = sstep(0, 1, (z - (sz - 5)) / 5) * sstep(0, 1, (110 - z) / 8);
    h -= depth * ramp * Math.exp(-(drx * drx) / 50);
  }

  // The pier deck is ground. That single fact is what makes it walkable —
  // the step rule lets you stroll on where the planks meet the beach, and
  // walkLimits (below) is what keeps you from strolling off the broken end.
  if (onPier(x, z)) {
    h = Math.max(h, pierDeckY(z));
  }

  return h;
}

/** Where the walker is allowed. Kept here so the layout can be checked against it. */
export const BOUNDS = { minX: -780, maxX: 780, minZ: -60, maxZ: 118 };

/**
 * How far seaward a walker can wade before the water reaches `wadeDepth` metres
 * deep (default 0.45, knee-ish). The real limit is a depth, not a position, and
 * it moves with the tide AND with the coast: solve
 * `waterLevel - groundHeight = wadeDepth` on the local underwater slope, which
 * now starts at `shorelineZ(x)` and steepens off the headland. `waterLevel` is
 * the ocean's current surface height (`ocean.js`'s `water.position.y`, which
 * breathes with the swash cycle), so the wading limit breathes with it too.
 * x defaults to 0 — the home beach — so every pre-coast call site and check
 * still means what it always meant.
 */
export function wadeLimitZ(waterLevel, wadeDepth = 0.45, x = 0) {
  return shorelineZ(x) + (waterLevel - wadeDepth) / seabedSlope(x);
}

/**
 * The walkable strip at this x, this instant. Replaces the old rectangle clamp:
 * the seaward side is the live wading limit, the inland side is the world edge.
 * The cliffs are not fenced here — the step rule in controls.js refuses any
 * stride that rises more than 0.9 m, which is what makes rock faces solid
 * without a collider in sight.
 */
export function walkLimits(x, waterLevel, wadeDepth = 0.45) {
  let minZ = Math.max(BOUNDS.minZ, wadeLimitZ(waterLevel, wadeDepth, x));
  // On the pier the deck carries you out over water far past wading depth —
  // to the edge of the collapsed span, and not a plank further.
  if (Math.abs(x - PIER.x) <= PIER.halfW) minZ = Math.min(minZ, PIER.deckEnd);
  return { minZ, maxZ: BOUNDS.maxZ };
}

/* -------------------------------------------------------------------- layout */

/**
 * Seeded PRNG, so the scatter is a fixed arrangement rather than a fresh one per
 * page load. Two reasons that matters more than it looks: the wrack line is the
 * thing you learn the beach by, and a shoreline that reshuffles every visit is
 * one you can never get to know; and a fixed layout is one a test can make claims
 * about. Same argument the repo already made for vendoring the sand.
 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A groyne: a line of weathered posts walking out of the dry sand and into the
 * water, tops descending until the last few are awash. It is the west end's
 * reason to exist, and it reads as a silhouette from the starting position
 * because the sun bears roughly (-0.26, -0.96) in x/z from there.
 */
function groyne() {
  const rnd = mulberry32(0x6f5d);
  const posts = [];
  const N = 16;
  const headY = groundHeight(-44, 10) + 2.3;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = lerp(-44, -60, t) + (rnd() - 0.5) * 0.5;
    const z = lerp(10, -34, t) + (rnd() - 0.5) * 0.8;
    const g = groundHeight(x, z);
    posts.push({
      x, z,
      base: g - 1.2,                              // sunk well in, no floating
      // Tops descend toward SEA LEVEL, not toward the ground under each post.
      // Measuring the exposed height off the local ground looked right and was
      // wrong: the seabed drops 3.7 m across this row, so the tops followed it
      // straight down and the last six posts finished entirely underwater, where
      // nobody would ever see them. The picture wanted is a row wading out until
      // the sea closes over it, and that is a claim about y = 0.
      top: lerp(headY, -0.25, t * t) + (rnd() - 0.5) * 0.22,
      r: 0.17 + rnd() * 0.06,
      lean: (rnd() - 0.5) * 0.16,
    });
  }
  return posts;
}

/**
 * Driftwood. Hand-placed rather than scattered — four logs across 280 m is few
 * enough that where each one sits is a composition decision, not a statistic.
 */
function driftwood() {
  const rnd = mulberry32(0xd21f);
  return [
    { x: 30, z: 5, len: 6.4, r: 0.38, yaw: 0.7, roll: 0.12, sink: 0.16, branches: 2 },
    { x: -92, z: 14, len: 5.0, r: 0.30, yaw: -1.9, roll: -0.2, sink: 0.10, branches: 3 },
    { x: 68, z: -2, len: 4.2, r: 0.26, yaw: 2.6, roll: 0.05, sink: 0.30, branches: 1 },
    { x: -18, z: 25, len: 3.4, r: 0.22, yaw: 0.25, roll: 0.3, sink: 0.08, branches: 2 },
  ].map(d => ({ ...d, seed: (rnd() * 1e6) | 0 }));
}

/**
 * A boulder cluster half in the shallows: the east end's destination.
 *
 * Centred at z = -9, not the -16 it started at. At -16 the seabed is 1.0 m down
 * and every boulder in the cluster finished under the surface — an underwater
 * rock pile is not a landmark, it is nothing. Here the big ones stand better than
 * a metre clear and the small ones just break the water, which is the thing worth
 * walking to.
 */
function rocks() {
  const rnd = mulberry32(0x30cc);
  const out = [];
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 7.5;
    const x = 100 + Math.cos(a) * d;
    const z = -8 + Math.sin(a) * d * 0.7;
    const r = 0.45 + rnd() * 2.55;
    out.push({
      x, z, r,
      sink: r * (0.14 + rnd() * 0.3),
      // How much the sphere is squashed vertically. Lives here rather than in
      // props.js because the height of a boulder above the water is a claim the
      // test makes, and a flatten factor sitting in the geometry file is one the
      // test would have to hardcode a copy of and then silently disagree with.
      flat: 0.72 + rnd() * 0.23,
      yaw: rnd() * 6.28,
      seed: (rnd() * 1e6) | 0,
    });
  }
  return out;
}

/**
 * The wrack line: shells, pebbles and weed strung along the high-tide mark.
 *
 * This is the one that answers "is there any reason to look down". The swash
 * reaches z ≈ -3.6 at its highest, so the wrack sits just above that and runs the
 * whole width of the walkable beach.
 */
function wrack() {
  const rnd = mulberry32(0xa17e);
  const out = [];
  // 1,300 pieces along the whole 1.6 km coast now, following the shoreline
  // curve — the tide mark bends around the headland with the water. Still
  // three instanced draws whatever the count.
  for (let i = 0; i < 1300; i++) {
    const x = -720 + rnd() * 1440;
    // Clumped rather than even: real wrack arrives in windrows.
    const clump = Math.sin(x * 0.05) * 1.1 + Math.sin(x * 0.013 + 2) * 1.4;
    const z = shorelineZ(x) + 3.6 + clump * 0.5 + (rnd() - 0.5) * 3.0;
    out.push({
      x, z,
      // 9–30 cm. The first pass used 5–18 cm, which is closer to life and read as
      // nothing: at the 16 m from the start position to the tide line a real
      // cockle shell is two pixels, so the whole line looked like a smudge in the
      // sand rather than things lying on it.
      s: 0.09 + rnd() * 0.21,
      yaw: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.9,
      kind: rnd() < 0.62 ? 'shell' : (rnd() < 0.6 ? 'pebble' : 'weed'),
    });
  }
  return out;
}

/**
 * Flat-stone patches: where the skipping stones live. Three patches on the dry
 * sand just above the wrack line, each a loose scatter of half a dozen stones.
 * Fixed places, same argument as the wrack — a good skipping spot is a thing
 * you remember and come back to.
 */
function stonePatches() {
  const rnd = mulberry32(0x570e);
  const out = [];
  for (const [px, pz] of [[-24, 2.5], [52, 1.5], [-70, 4]]) {
    const stones = [];
    for (let i = 0; i < 6; i++) {
      stones.push({
        x: px + (rnd() - 0.5) * 3.2,
        z: pz + (rnd() - 0.5) * 2.2,
        s: 0.05 + rnd() * 0.03,
        yaw: rnd() * 6.28,
      });
    }
    out.push({ x: px, z: pz, stones });
  }
  return out;
}

/**
 * The special shells: forty fixed finds worth crouching for, scattered along
 * the wrack line (most) and up into the dry sand (the rest, harder to spot
 * against the ripples). Distinct from the 460-piece wrack scatter, which is
 * texture; these are the ones with names.
 */
export const SHELL_KINDS = ['cockle', 'whelk', 'sanddollar', 'seaglass'];

function shellFinds() {
  const rnd = mulberry32(0xbe11);
  const out = [];
  for (let i = 0; i < 40; i++) {
    const x = -136 + rnd() * 272;
    const nearWrack = rnd() < 0.7;
    const z = nearWrack ? -2 + (rnd() - 0.5) * 4 : 4 + rnd() * 24;
    out.push({
      x, z,
      kind: SHELL_KINDS[(rnd() * SHELL_KINDS.length) | 0],
      s: 0.13 + rnd() * 0.09,
      yaw: rnd() * 6.28,
      seed: (rnd() * 1e6) | 0,
    });
  }
  return out;
}

/**
 * The fence along the dune trail: weathered posts pacing the walker's right
 * side. Follows trailX, so the path and its fence can't disagree.
 */
function fence() {
  const rnd = mulberry32(0xfe9c);
  const out = [];
  for (let z = 52; z <= 112; z += 4.5) {
    out.push({
      x: trailX(z) + 5 + (rnd() - 0.5) * 0.8,
      z: z + (rnd() - 0.5) * 0.8,
      h: 0.85 + rnd() * 0.25,
      lean: (rnd() - 0.5) * 0.2,
    });
  }
  return out;
}

export const LAYOUT = {
  groyne: groyne(),
  driftwood: driftwood(),
  rocks: rocks(),
  wrack: wrack(),
  stones: stonePatches(),
  shells: shellFinds(),
  headland: { pools: POOLS },
  dunes: { fence: fence() },
};
