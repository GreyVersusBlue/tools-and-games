// haunt.js — how bad is it right now, and what does that look like?
//
// Phase 24. A building that can host a school day can host a bad night, and
// this module is the night's clock: the save record that arms it, the stage
// machine that paces it, the knobs each stage turns, the writing that appears
// on the walls, and the numbers behind the two set pieces — the flicker and
// the fake crash.
//
// The whole mode is a pure function of (finds, elapsed, seed, intensity).
// That is not a nicety, it is the design: the export this ships in opens as
// an innocent walk demo, and everything that makes it stop being one has to
// be deterministic enough to test headless and gradual enough that nobody
// can point at the frame where it turned.
//
// Two invariants the suite pins, because the WISHLIST states them:
//   - The crowd and the creature never share a frame. `stageKnobs` never
//     answers `crowd && creature` at any (stage, t).
//   - The stages only ratchet forward. Finds don't come back and time
//     doesn't either, so `stageFor` is monotone in both.
//
// Pure module: no three.js, no DOM, no clock — the caller owns the frame
// loop and hands elapsed seconds in. Exercised by test/haunt.test.mjs.

import {
  shapesOf, segEnds, isBuilt, isDoorOpening, openingSpec, shapeAt, SEG_WALL,
} from './shapes.js';
import { solidSpans } from './collide.js';
import { rng } from './agents.js';
import { pointEntry, findPath, pathDistance, nearestExit } from './navgraph.js';

// ---------- the record ----------

// What a save file may carry: whether the night is armed, whose night it is,
// and how hard it leans. Everything else is session — a creature's position
// is a fact about a walk, not about a building.
export const DEFAULT_HAUNT = { on: false, seed: 1, intensity: 0.5 };

const clampInt = (v, lo, hi, dflt) =>
  (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
const clamp01 = (v, dflt) =>
  (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt);

export function normalizeHaunt(raw) {
  const h = raw && typeof raw === 'object' ? raw : {};
  return {
    on: h.on === true,
    seed: clampInt(h.seed, 1, 0xffffffff, DEFAULT_HAUNT.seed),
    intensity: clamp01(h.intensity, DEFAULT_HAUNT.intensity),
  };
}

// An off haunt writes no key — the "delete if default" rule save-load.js
// applies to every optional record. The seed and intensity of a night nobody
// armed are not worth a byte.
export const isDefaultHaunt = (h) => !h || h.on !== true;

// ---------- the stages ----------

// The arc, in order. `day` is the innocent demo; `dismissal` is the final
// bell and the building emptying; `dusk` is the sun going and the first
// fixture failing; `company` is no longer being alone; `flight` is the way
// out, and every door but one refusing.
export const STAGES = ['day', 'dismissal', 'dusk', 'company', 'flight'];

// When time alone drags each stage in, in seconds at intensity 0.5 — the
// finds usually get there first, which is the point of gating on both: the
// player paces the descent, and a player who stalls still sinks. Flight is
// Infinity on purpose: the last stage is an achievement, never an ambush —
// the objective has to be met.
export const STAGE_TIMES = [0, 210, 420, 660, Infinity];
// How long the drift inside the last two stages takes to bottom out.
export const DRIFT_S = 180;

// How many stars the haunted hunt deals, and what it deals. Six is enough
// building to learn before the turn and short enough to finish scared.
export const HAUNT_COUNT = 6;
export const HAUNT_ITEM = { key: 'star', name: 'a gold star', icon: '⭐' };

// Which stage `progress` has earned. `progress` is `{ finds, total,
// elapsed }` — finds out of the hunt, elapsed seconds since it started.
// Intensity scales the clock: a hard night sinks half again as fast.
// Returns `{ index, key, t }`, t being the 0..1 drift within the stage.
export function stageFor(haunt, progress) {
  const h = normalizeHaunt(haunt);
  const finds = Math.max(0, progress && progress.finds || 0);
  const total = Math.max(0, progress && progress.total || 0);
  const elapsed = Math.max(0, progress && progress.elapsed || 0);
  const te = elapsed * (0.5 + h.intensity);

  let timeIdx = 0;
  for (let i = 1; i < STAGES.length; i++) if (te >= STAGE_TIMES[i]) timeIdx = i;

  let findIdx = 0;
  if (total > 0) {
    if (finds >= total) findIdx = 4;
    else if (finds >= Math.ceil(total * 0.7)) findIdx = 3;
    else if (finds >= Math.ceil(total * 0.4)) findIdx = 2;
    else if (finds >= 1) findIdx = 1;
  }

  const index = Math.max(timeIdx, findIdx);
  const t0 = STAGE_TIMES[index];
  const span = index < 3 ? STAGE_TIMES[index + 1] - t0 : DRIFT_S;
  const from = Number.isFinite(t0) ? t0 : STAGE_TIMES[3];
  const t = Math.min(1, Math.max(0, (te - from) / span));
  return { index, key: STAGES[index], t };
}

const lerp = (a, b, t) => a + (b - a) * t;

// What each stage asks of the building. One object, every knob, so the
// caller reads a state rather than asking five questions — and so one test
// can sweep the whole (stage, t) plane and hold the invariants.
//
//   crowd / creature / chaseArmed   who is in the building, and how it feels
//                                   about being looked at
//   lockExits                       flight only: every exterior door but the
//                                   chosen one refuses
//   sunMinutes                      where the caller should drift env.minutes
//                                   to (null = leave the design's sky alone)
//   lampScale                       global dimming of what the fixtures give
//   flickerHz / flickerDepth        for `flickerAt` below
//   detuneCents                     how wrong the building's hum runs
//   writings                        0..1 — how much of the written set shows
//   failing                         seeded index of the one fixture that dies
//                                   first and buzzes while it does
//   hud                             the one line the HUD may print, or null
export function stageKnobs(stage, t, haunt) {
  const h = normalizeHaunt(haunt);
  const index = typeof stage === 'number' ? stage : (stage && stage.index) || 0;
  const k = {
    stage: index, key: STAGES[index] || 'day', t,
    seed: h.seed, intensity: h.intensity,
    crowd: index <= 1,
    creature: index >= 3,
    chaseArmed: index === 4 || (index === 3 && t > 0.5),
    lockExits: index === 4,
    sunMinutes: null,
    lampScale: 1,
    flickerHz: 0,
    flickerDepth: 0,
    detuneCents: 0,
    writings: 0,
    failing: Math.floor(hash01(h.seed) * 12),
    hud: null,
  };
  switch (index) {
    case 1:   // dismissal — the light goes long while the building empties
      k.sunMinutes = Math.round(lerp(1020, 1120, t));
      break;
    case 2:   // dusk — the sun goes, the first fixture starts to die
      k.sunMinutes = Math.round(lerp(1120, 1270, t));
      k.lampScale = lerp(1, 0.85, t);
      k.flickerHz = lerp(0.4, 1.0, t);
      k.flickerDepth = lerp(0.1, 0.3, t);
      k.detuneCents = lerp(0, 10, t);
      k.writings = 0.25 * t;
      break;
    case 3:   // company — you are not alone in here
      k.sunMinutes = 1340;
      k.lampScale = lerp(0.8, 0.65, t);
      k.flickerHz = lerp(1.2, 2.0, t);
      k.flickerDepth = lerp(0.3, 0.5, t);
      k.detuneCents = lerp(10, 25, t);
      k.writings = lerp(0.25, 0.75, t);
      break;
    case 4:   // flight — get out
      k.sunMinutes = 1340;
      k.lampScale = lerp(0.55, 0.4, t);
      k.flickerHz = 2.4;
      k.flickerDepth = lerp(0.5, 0.7, t);
      k.detuneCents = lerp(25, 35, t);
      k.writings = 1;
      k.hud = 'Get out.';
      break;
    default:  // day — nothing is wrong. nothing is wrong.
      break;
  }
  return k;
}

// ---------- the flicker ----------

// A deterministic integer hash onto [0, 1). Not `rng` — flicker is asked per
// light per frame and must answer the same for the same (seed, light, time)
// without carrying a stream between callers.
export function hash01(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
}

// The multiplier one light wears right now, 0..1. A curve rather than a
// random walk: time is bucketed at `flickerHz`, each (seed, light, bucket)
// hashes to whether this bucket dips and how deep, so two runs on one seed
// flicker identically and the failing fixture is the same fixture all
// night — it dips more often and all the way down. Light index -1 is "the
// room": the caller uses it for ambient and spill, shallower than any one
// fixture so the corridor dies *with* its lights rather than before them.
export function flickerAt(knobs, timeS, lightIndex) {
  if (!knobs || !(knobs.flickerDepth > 0)) return 1;
  const hz = Math.max(0.1, knobs.flickerHz || 1);
  const bucket = Math.floor(timeS * hz);
  const i = lightIndex | 0;
  const failing = i === knobs.failing;
  const h = hash01(knobs.seed * 7 + i * 131 + bucket * 8191);
  const gate = failing ? 0.55 : 0.1 + knobs.flickerDepth * 0.25;
  if (h >= gate) return 1;
  const h2 = hash01(bucket * 977 + i * 31 + knobs.seed * 3 + 1);
  let depth = knobs.flickerDepth * (failing ? 1 : 0.75);
  if (i === -1) depth *= 0.5;
  return Math.max(0.05, 1 - depth * (0.4 + 0.6 * h2));
}

// ---------- the writing on the walls ----------

// The written set. PG-13 and school-flavoured on purpose — this is a
// school-building tool and somebody's kid may open the file. Unease, not
// gore: tallies, wrong arrows, a roll with one name left. The order is the
// reveal order after `writingPlaces` shuffles it per seed.
export const WRITINGS = [
  'DON’T BE HERE AFTER THE BELL',
  'it takes attendance',
  'hall pass EXPIRED',
  'I stayed for detention. I’m still here.',
  'who turned off the lights\nwho turned them on',
  'the janitor locks 7 doors. count them.',
  'room 1B is not on the map',
  'STOP FINDING THE STARS',
  'it liked the school better full',
  'do not look down the long hall',
  'I can hear you counting',
  'class dismissed.',
  'EXIT ← (this way is wrong)',
  'you are here →',
  'no running. it hears running.',
  'the stars were a mistake',
  'IIII IIII IIII IIII II',
  'absent: everyone.\npresent: you.',
  'the doors remember being slammed',
  'ALL FOUND. ALL FOUND. ALL FOUND.',
];

// How long a wall run must be to carry a writing, and how the plane sits.
export const WRITING_MIN_RUN = 6;    // ft
export const WRITING_W = 7;          // ft, capped by the run it sits on
export const WRITING_INSET = 0.4;    // ft off the wall face, clear of the trim

// Where the writings go: seeded, one per room at most, on a solid interior
// wall run long enough to read. Walks the same rings sightline.js walks and
// cuts the openings out the same way, so a writing never spans a doorway.
// Returns [{ floor, room, x, z, nx, nz, yaw, w, text, order }] sorted by
// `order` — the caller shows the first `ceil(fraction * length)` of them.
export function writingPlaces(state, seed, count = WRITINGS.length) {
  const out = [];
  if (!state || !Array.isArray(state.floors)) return out;
  const rand = rng(clampInt(seed, 1, 0xffffffff, 1));

  const rooms = [];
  for (let f = 0; f < state.floors.length; f++) {
    const floor = state.floors[f];
    if (!floor) continue;
    for (const shape of shapesOf(floor)) {
      const runs = [];
      for (const ring of shape.rings) {
        for (let i = 0; i < ring.pts.length; i++) {
          if (!isBuilt(ring.walls[i])) continue;
          if (ring.walls[i] !== SEG_WALL) continue;
          const [a, b] = segEnds(ring, i);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < WRITING_MIN_RUN) continue;
          const cuts = [];
          for (const o of ring.openings) {
            if (o.seg !== i) continue;
            const spec = openingSpec(o);
            // A window is as bad a place for a writing as a doorway is.
            cuts.push({ a: spec.t * len - spec.w / 2, b: spec.t * len + spec.w / 2 });
          }
          const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
          for (const [s, e] of solidSpans(len, cuts, 0)) {
            if (e - s < WRITING_MIN_RUN) continue;
            runs.push({ a, ux, uz, s, e, len: e - s });
          }
        }
      }
      if (runs.length) rooms.push({ floor: f, floorObj: floor, shape, runs });
    }
  }
  if (!rooms.length) return out;

  // Seeded shuffle of the rooms and of the lines, then deal one line per
  // room until either runs out.
  for (let i = rooms.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = rooms[i]; rooms[i] = rooms[j]; rooms[j] = t;
  }
  const lines = WRITINGS.slice();
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = lines[i]; lines[i] = lines[j]; lines[j] = t;
  }

  const n = Math.min(count, rooms.length, lines.length);
  for (let k = 0; k < n; k++) {
    const r = rooms[k];
    const run = r.runs[Math.floor(rand() * r.runs.length)];
    const w = Math.min(WRITING_W, run.len * 0.8);
    const at = run.s + w / 2 + rand() * Math.max(0, run.len - w);
    const wx = run.a.x + run.ux * at, wz = run.a.z + run.uz * at;
    // The wall's two faces: the writing goes on the side that is inside this
    // room, found by asking which side of the wall the room is on.
    let nx = -run.uz, nz = run.ux;
    const probe = shapeAt(r.floorObj, wx + nx, wz + nz);
    if (!probe || probe.id !== r.shape.id) { nx = -nx; nz = -nz; }
    out.push({
      floor: r.floor,
      room: r.shape.id,
      x: wx + nx * WRITING_INSET,
      z: wz + nz * WRITING_INSET,
      nx, nz,
      yaw: Math.atan2(nx, nz),
      w,
      text: lines[k],
      order: k,
    });
  }
  return out;
}

// ---------- the fake crash ----------

// How long being caught takes, screen-time. Long enough to read as a real
// crash for one honest second, short enough that nobody reaches for the
// power button.
export const CRASH_S = 2.6;

// The crash as numbers, so the canvas that draws it stays a dumb painter
// and this curve gets a test. Phases: `tear` (the frame shears), `static`
// (rolling noise), `black` (the fake error card on black), `wake` (back in
// the building, ringing).
export function crashCurve(t) {
  if (t >= CRASH_S) return { phase: 'wake', noise: 0, bars: 0, text: false };
  const s = Math.max(0, t);
  if (s < 0.5) {
    const k = s / 0.5;
    return { phase: 'tear', noise: 0.15 + 0.45 * k, bars: 2 + Math.floor(k * 6), text: false };
  }
  if (s < 1.3) {
    return { phase: 'static', noise: 0.85, bars: 10, text: false };
  }
  if (s < 2.2) {
    return { phase: 'black', noise: 0.03, bars: 0, text: true };
  }
  const k = (s - 2.2) / 0.4;
  return { phase: 'wake', noise: Math.max(0, 0.12 * (1 - k)), bars: 0, text: false };
}

// ---------- doors that slam ----------

// Which doorway the player just fled through: the segment of their last step
// crossed the door's plane inside its width. `doors` is sightline.js's
// `doorPoints` for the storey. Returns the door, or null — the runtime slams
// the leaf it maps to; the geometry here just names it.
export const SLAM_HALF_W = 2.2;   // ft either side of the centreline
export function slamCandidate(doors, prevAt, at) {
  if (!doors || !prevAt || !at) return null;
  for (const d of doors) {
    const s0 = (prevAt.x - d.x) * d.nx + (prevAt.z - d.z) * d.nz;
    const s1 = (at.x - d.x) * d.nx + (at.z - d.z) * d.nz;
    if ((s0 <= 0) === (s1 <= 0)) continue;         // never crossed the plane
    // Where the step crossed it, and whether that is inside the doorway.
    const k = s0 / (s0 - s1);
    const cx = prevAt.x + (at.x - prevAt.x) * k - d.x;
    const cz = prevAt.z + (at.z - prevAt.z) * k - d.z;
    const along = Math.hypot(cx, cz);
    if (along > Math.max(SLAM_HALF_W, (d.w || 3) / 2 + 0.5)) continue;
    return d;
  }
  return null;
}

// ---------- where you come back, and the way out ----------

// The entrance: the exterior door nearest the walk's spawn, stepped just
// inside. Where a caught player wakes — finds kept, dignity optional.
export function respawnPoint(nav, field, spawn) {
  const from = spawn || { x: 0, z: 0, floor: 0 };
  const near = nav && field
    ? nearestExit(nav, field, from.floor || 0, from.x, from.z) : null;
  const exit = near && near.exit;
  if (!exit) return { x: from.x, z: from.z, floor: from.floor || 0 };
  // `pa` is the standing point on the room's side of the doorway — an
  // exterior portal's `b` is the outdoors, so `pa` is always inside.
  const p = exit.pa || exit;
  return { x: p.x, z: p.z, floor: exit.floor || 0 };
}

// Where the creature goes after a catch: the reachable room node the longest
// walk away from the player. A banished creature starts its stalk from the
// far side of the building, which is the respawn's mercy — and the price of
// an A* per room is paid at most once per catch.
export function banishNode(nav, from) {
  if (!nav || !nav.nodes) return null;
  const entry = pointEntry(nav, from);
  if (!entry) return null;
  const opts = entry.opts || {};
  let best = null, bestD = -1;
  for (const n of nav.nodes.values()) {
    if (n.kind !== 'room') continue;
    const path = findPath(nav, entry.id, n.id, opts);
    if (!path) continue;
    const d = pathDistance(nav, path, opts).dist;
    if (d > bestD) { bestD = d; best = n; }
  }
  return best ? { x: best.x, z: best.z, floor: best.floor, id: best.id, dist: bestD } : null;
}

// The one exterior door that opens during the flight. Rank every exterior
// doorway by the *routed* walk from where the player stood when the flight
// began, keep the `spread` farthest, and let the seed pick one — across the
// building from you, but not always the very far corner, so a second
// playthrough can't head straight for it. Everything else refuses with the
// locked line. A design with one exterior door locks nothing.
export const ESCAPE_SPREAD = 5;
export function escapeDoor(nav, from, seed, opts = {}) {
  if (!nav || !nav.exits || !nav.exits.length) return null;
  const spread = Math.max(1, opts.spread || ESCAPE_SPREAD);
  const entry = pointEntry(nav, from);
  if (!entry) return nav.exits[0] || null;
  const eopts = entry.opts || {};
  const ranked = [];
  for (const e of nav.exits) {
    const path = findPath(nav, entry.id, e.id, eopts);
    if (!path) continue;
    ranked.push({ exit: e, dist: pathDistance(nav, path, eopts).dist });
  }
  if (!ranked.length) return nav.exits[0];
  ranked.sort((a, b) => b.dist - a.dist || String(a.exit.id).localeCompare(String(b.exit.id)));
  const top = ranked.slice(0, Math.min(spread, ranked.length));
  const rand = rng(clampInt(seed, 1, 0xffffffff, 1) ^ 0x5ca1e);
  return top[Math.floor(rand() * top.length)].exit;
}

// The locked line, stated once so the HUD and the tests agree on it.
export const LOCKED_TEXT = 'The door appears to be locked. Find another way.';
