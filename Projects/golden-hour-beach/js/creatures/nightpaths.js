import { groundHeight, trailX, regionAt, mulberry32, CAMP } from '../field.js';

// Where the night's two movers go, as pure functions of a clock: the fireflies
// that leave the dune hollows for the fire as the dark comes down, and the
// owl's one swoop over the dunes. No three.js, so test/smoke.mjs can hold the
// paths to the ground and the camp without a browser; nightlife.js turns them
// into points and meshes.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const sstep = (a, b, t) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u); };

/* ---------------------------------------------------------------- fireflies */

// The fire is always lit, but it only draws them once it is the brightest
// thing left: the pull starts a little after the flies rise (nightT 0.15) and
// every drawn fly has arrived by nightT 0.60, while their window still has
// them lit. They come in ones and twos, each on its own onset, not as a flock.
export const FIREFLY = {
  count: 40,
  drawn: 14,                 // the fourteen nearest the camp; the hollows keep the rest
  ringMin: 3.0, ringMax: 6.5, // metres from the fire's centre, clear of the logs and the flames
  onsetLo: 0.2, onsetHi: 0.46, span: 0.14,   // each fly takes about two walking minutes
  bow: 4,                    // most sideways a fly strays from the straight line in
  wanderHome: 1.6, wanderFire: 0.9,
};

/**
 * The forty flies, same positions as ever (the 0xf1fe draw is unchanged), and
 * for the fourteen nearest the fire a spot beside it and an onset. `h` is the
 * height over the ground, carried along the drift so a fly crossing a dune
 * crest goes over it rather than into it.
 */
export function fireflyField() {
  const F = FIREFLY;
  const rnd = mulberry32(0xf1fe);
  const flies = [];
  for (let i = 0; i < F.count; i++) {
    const z = 56 + rnd() * 50;
    const x = trailX(z) + (rnd() - 0.5) * 26;
    const y = groundHeight(x, z) + 0.4 + rnd() * 1.4;
    flies.push({ x, y, z, h: y - groundHeight(x, z), blink: rnd() * 6.28, wander: rnd() * 6.28, fire: null });
  }
  const byDist = flies.map((f, i) => ({ i, d: Math.hypot(f.x - CAMP.x, f.z - CAMP.z) }))
    .sort((a, b) => a.d - b.d);
  const pick = mulberry32(0xf12e);
  for (let k = 0; k < F.drawn; k++) {
    const f = flies[byDist[k].i];
    // Evenly round the ring and jittered, so they circle the fire rather than
    // bunching on the side they came in from. ringMin keeps them 1.3 m outside
    // the log seats even at the far end of their wander.
    const a = (k / F.drawn) * Math.PI * 2 + (pick() - 0.5) * 0.4;
    const r = lerp(F.ringMin, F.ringMax, pick());
    const onset = lerp(F.onsetLo, F.onsetHi, pick());
    f.fire = {
      x: CAMP.x + Math.cos(a) * r, z: CAMP.z + Math.sin(a) * r,
      h: 0.8 + pick() * 1.4,
      onset, bow: (pick() - 0.5) * 2 * F.bow,
    };
  }
  return flies;
}

/** How far along its drift to the fire a fly is at this nightT: 0 home, 1 there. */
export function fireflyPull(fly, nightT) {
  if (!fly.fire) return 0;
  return sstep(fly.fire.onset, fly.fire.onset + FIREFLY.span, nightT);
}

/** The point a fly hovers round at this nightT, before its own small wander. */
export function fireflyAnchor(fly, nightT, out = {}) {
  const k = fireflyPull(fly, nightT);
  if (k === 0) { out.x = fly.x; out.y = fly.y; out.z = fly.z; out.k = 0; return out; }
  const f = fly.fire;
  const dx = f.x - fly.x, dz = f.z - fly.z;
  const len = Math.hypot(dx, dz) || 1;
  const b = Math.sin(k * Math.PI) * f.bow;       // a curve in, not a beeline
  out.x = lerp(fly.x, f.x, k) - (dz / len) * b;
  out.z = lerp(fly.z, f.z, k) + (dx / len) * b;
  out.y = groundHeight(out.x, out.z) + lerp(fly.h, f.h, k);
  out.k = k;
  return out;
}

/* --------------------------------------------------------------------- owl */

/** The two dead snags, trail-relative; y is where the owl sits, 3.4 m up. */
export function owlPerches() {
  return [
    { x: trailX(88) - 9, z: 88 },
    { x: trailX(64) + 11, z: 66 },
  ].map(p => ({ ...p, y: groundHeight(p.x, p.z) + 3.4 }));
}

// One swoop over the dunes and no kill shown: the owl leaves its snag in a
// shallow glide that steepens into a stoop, drops into the grass, stays down
// for a little over a second, and climbs back to the nearer snag. Silent the
// whole way, like the flight it already had.
export const HUNT = {
  dur: 10,                    // seconds, snag to grass to snag
  dropEnd: 0.45, riseAt: 0.57, // fractions of dur: the stoop ends, the climb begins
  reachLo: 12, reachHi: 20,   // metres from the snag to where it drops
  grass: 0.15,                // how high it sits once down: under the grass tops
  clear: 0.6,                 // the least it clears the dunes by in flight
  firstLo: 30, firstHi: 50,   // seconds after it comes out, the first hunt
  everyLo: 80, everyHi: 140,  // and between hunts after that
};

/**
 * Where the owl drops. Six bearings at a random turn and a random reach; only
 * dry dune sand counts; of those, the one furthest from the walker, because an
 * owl hunts the ground nobody is standing on. Null if none qualifies.
 */
export function huntTarget(perch, player, rnd) {
  const turn = rnd() * Math.PI * 2;
  const reach = lerp(HUNT.reachLo, HUNT.reachHi, rnd());
  let best = null, bestD = -1;
  for (let k = 0; k < 6; k++) {
    const a = turn + k * Math.PI / 3;
    const x = perch.x + Math.cos(a) * reach, z = perch.z + Math.sin(a) * reach;
    if (regionAt(x, z) !== 'dunes' || groundHeight(x, z) < 1.5) continue;
    const d = Math.hypot(x - player.x, z - player.z);
    if (d > bestD) { bestD = d; best = { x, z }; }
  }
  return best;
}

/** The snag of the two the owl climbs back to: whichever is nearer where it dropped. */
export function huntReturn(perches, target) {
  const d = p => Math.hypot(p.x - target.x, p.z - target.z);
  return d(perches[0]) <= d(perches[1]) ? 0 : 1;
}

/**
 * The owl's position at fraction p of a hunt from `from` (a perch with y) to
 * `target` (x, z on the sand) and back up to `to` (a perch with y).
 */
export function huntPos(from, target, to, p, out = {}) {
  const H = HUNT;
  const gT = groundHeight(target.x, target.z);
  let x, z, y, floor;
  if (p < H.dropEnd) {
    const u = p / H.dropEnd;
    x = lerp(from.x, target.x, u); z = lerp(from.z, target.z, u);
    y = lerp(from.y, gT + H.grass, u * u);         // a glide that steepens into the stoop
    floor = lerp(H.clear, H.grass, sstep(0.75, 1, u));
  } else if (p < H.riseAt) {
    x = target.x; z = target.z; y = gT + H.grass; floor = H.grass;
  } else {
    const u = Math.min(1, (p - H.riseAt) / (1 - H.riseAt));
    x = lerp(target.x, to.x, u); z = lerp(target.z, to.z, u);
    y = lerp(gT + H.grass, to.y, 1 - (1 - u) * (1 - u)) + Math.sin(u * Math.PI) * 1.2;
    floor = lerp(H.grass, H.clear, sstep(0, 0.25, u));
  }
  out.x = x; out.z = z;
  out.y = Math.max(y, groundHeight(x, z) + floor);
  return out;
}
