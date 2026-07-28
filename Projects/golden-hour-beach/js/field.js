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

export function groundHeight(x, z) {
  let h;
  if (z < -6) {
    h = (z + 6) * 0.10;                    // underwater slope
  } else {
    h = (z + 6) * 0.055;                   // dry beach, gentle rise
  }
  const duneT = smooth(Math.max(0, Math.min(1, (z - 22) / 22)));
  const dunes = fbm(x * 0.025 + 3.7, z * 0.05) * 5.5 + fbm(x * 0.09, z * 0.13) * 1.2;
  h += duneT * (1.8 + dunes);
  h += Math.sin(x * 0.012) * 0.25 * smooth(Math.max(0, Math.min(1, (z + 4) / 10)));
  return h;
}

/** Where the walker is allowed. Kept here so the layout can be checked against it. */
export const BOUNDS = { minX: -140, maxX: 140, minZ: -60, maxZ: 46 };

/* -------------------------------------------------------------------- layout */

/**
 * Seeded PRNG, so the scatter is a fixed arrangement rather than a fresh one per
 * page load. Two reasons that matters more than it looks: the wrack line is the
 * thing you learn the beach by, and a shoreline that reshuffles every visit is
 * one you can never get to know; and a fixed layout is one a test can make claims
 * about. Same argument the repo already made for vendoring the sand.
 */
function mulberry32(a) {
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
  for (let i = 0; i < 460; i++) {
    const x = -138 + rnd() * 276;
    // Clumped rather than even: real wrack arrives in windrows.
    const clump = Math.sin(x * 0.05) * 1.1 + Math.sin(x * 0.013 + 2) * 1.4;
    const z = -2.4 + clump * 0.5 + (rnd() - 0.5) * 3.0;
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

export const LAYOUT = {
  groyne: groyne(),
  driftwood: driftwood(),
  rocks: rocks(),
  wrack: wrack(),
};
