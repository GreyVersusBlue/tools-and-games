// weather.js — what the sky is doing, and what that costs, as numbers.
//
// Phase 29. Phase 20 gave the sky moods and clouds worth having; what the sky
// still could not do was *do* anything. This module is the state — a kind, an
// intensity, a wind — and every consequence of it the rest of the build
// reads: how fast the deck drifts, how much the daylight dims, how dark wet
// paving goes, how deep the snow lies, how loud the rain is through a slab or
// against the glazing, and when the thunder comes. All of it deterministic
// from the record plus a seed and the design's own clock, because a weather
// that re-rolls itself between a screenshot and its retake is a worse tool
// than one that repeats.
//
// The shape of the thing is sky.js's shape on purpose: a small normalized
// record on the state (optional, defaulting to the weather every design has
// always had — none), and one derivation call that answers everything a
// renderer or a mixer needs so nothing downstream has to remember how the
// pieces go together. The record is three fields; the consequences are all
// derived, never stored.
//
// Pure module: no three.js, no Web Audio, no DOM. The two imports are pure
// siblings — sound.js for the transmission constants the rain re-uses (the
// cross-slab figure was already in the acoustics; inventing a second one
// would be the two-numbers-same-units bug the conventions warn about), and
// shapes.js to read the glazing off a storey. Exercised by
// test/weather.test.mjs.

import { PATH_SLAB, PATH_SHELL, dbAt } from './sound.js';
import { shapesOf, segEnds, shapeAt, isWindowOpening, SEG_GLASS } from './shapes.js';

// ---------- the record ----------

export const WEATHER_KINDS = ['clear', 'overcast', 'rain', 'snow'];

// The default is the weather every design before Phase 29 was drawn in:
// the fair-weather deck Phase 20 hung (cover 0.44) and nothing falling out
// of it. A design with this record writes no `weather` key — the same
// bargain `env` struck in v6.
export const DEFAULT_WEATHER = { kind: 'clear', intensity: 0.7, wind: 0.35 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt, lo, hi) =>
  clamp(typeof v === 'number' && Number.isFinite(v) ? v : dflt, lo, hi);

// Any candidate out of a save file or a click, made canonical. Never throws
// and never returns null — weather is not something a design can fail to
// have, only something it can decline to mention.
export function normalizeWeather(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    kind: WEATHER_KINDS.includes(src.kind) ? src.kind : DEFAULT_WEATHER.kind,
    intensity: num(src.intensity, DEFAULT_WEATHER.intensity, 0.05, 1),
    wind: num(src.wind, DEFAULT_WEATHER.wind, 0, 1),
  };
}

export const defaultWeather = () => ({ ...DEFAULT_WEATHER });

export const isDefaultWeather = (w) => {
  const c = normalizeWeather(w);
  return Object.keys(DEFAULT_WEATHER).every((k) => c[k] === DEFAULT_WEATHER[k]);
};

// The three that join the mood row (the phase's own words). Clear is not a
// button: clicking the active kind again puts the sky back, the way a toggle
// reads, and `applyWeatherMood` says so with `clears`.
export const WEATHER_MOODS = [
  { key: 'overcast', label: 'Overcast', icon: '☁️' },
  { key: 'rain', label: 'Rain', icon: '🌧️' },
  { key: 'snow', label: 'Snow', icon: '❄️' },
];

export const weatherMoodEntry = (key) => WEATHER_MOODS.find((m) => m.key === key) || null;

// One click on the mood row: a fresh normalized record, never a mutation of
// the one handed in — `applyMood`'s contract. Clicking the kind already up
// returns the default (clear) record, so the row is three toggles rather
// than three one-way doors.
export function applyWeatherMood(weather, key) {
  const cur = normalizeWeather(weather);
  if (!weatherMoodEntry(key)) return cur;
  if (cur.kind === key) return defaultWeather();
  return normalizeWeather({ ...cur, kind: key });
}

// A line for the status bar and the HUD.
export function weatherLabel(weather) {
  const w = normalizeWeather(weather);
  const pct = Math.round(w.intensity * 100);
  switch (w.kind) {
    case 'overcast': return 'Overcast';
    case 'rain': return `Rain, ${pct}%`;
    case 'snow': return `Snow, ${pct}%`;
    default: return 'Clear';
  }
}

// ---------- the seeded wobble ----------

// A tiny integer hash onto [0, 1). Not a stream: every consumer asks for its
// own lane by index, so the thunder cannot re-time itself because the snow
// asked a question first — the property agents.js's per-agent seeds bought
// the crowd.
export function weatherHash(seed, lane) {
  let h = (seed | 0) + 0x9e3779b9 * ((lane | 0) + 1);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------- the consequences ----------

// The fair-weather deck Phase 20 hung, to the digit — `clear` answers this so
// a design with no weather record renders byte-identically to how it did
// before this phase.
export const CLEAR_COVER = 0.44;

// Past this much sky dim the sun is a glow, not a lamp, and crisp shadows
// under a full overcast read as a bug. The renderer switches the shadow map
// off at the same threshold everywhere rather than each caller inventing one.
export const OVERCAST_SHADOW = 0.3;

// How deep the snow lies, 0..1 of the blend's full depth. Deterministic from
// seed and the design's own clock: it deepens through the day — scrub the
// hour forward and the site whitens under you — with a seeded wobble so two
// seeds are two storms rather than one storm twice.
export function snowDepth(seed, minutes, intensity = 0.7) {
  const m = clamp(Number.isFinite(minutes) ? minutes : 600, 0, 1439);
  const i = clamp(intensity, 0.05, 1);
  const base = 0.3 + 0.6 * (m / 1439);
  const wobble = (weatherHash(seed, 77) - 0.5) * 0.2;
  return clamp(i * (base + wobble), 0.08, 1);
}

// Everything a renderer needs for one weather, in one call — `skyState`'s
// promise, kept here. `opts` carries the seed and the clock; both default so
// a caller without a design still gets an answer.
//
//   cover      how much of the sky is cloud, 0..1 — the deck's own uniform
//   drift      multiplier on the deck's drift rate; the wind, made visible
//   skyDim     0..1 — how much of the sun, sky fill and exposure the cover
//              eats; the renderer scales, this only says how much
//   flat       true when the light has gone shadowless (skyDim past
//              OVERCAST_SHADOW)
//   wet        0..1 — how dark and how sheeny wet paving reads
//   snow       0..1 — accumulation depth for the ground blend
//   fogScale   multiplier on the palette's fog distances; rain closes in
//   wind       0..1, echoed for the outside bed's benefit
//   fall       what falls: null, or { kind, amount 0..1, speed ft/s, size,
//              sway ft, slant ft-per-ft-of-drop toward +x }
export function weatherState(weather, opts = {}) {
  const w = normalizeWeather(weather);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const minutes = Number.isFinite(opts.minutes) ? opts.minutes : 600;
  const i = w.intensity;
  const base = {
    ...w,
    // Clear is the deck Phase 20 hung, drift included — a design with no
    // weather record renders exactly as it always did, wind field or not.
    cover: CLEAR_COVER, drift: 1, skyDim: 0, flat: false,
    wet: 0, snow: 0, fogScale: 1, fall: null,
  };
  if (w.kind === 'overcast') {
    base.cover = 0.74 + 0.16 * i;
    base.drift = 1 + w.wind * 5;
    base.skyDim = 0.28 + 0.2 * i;
    base.fogScale = 0.85;
  } else if (w.kind === 'rain') {
    base.cover = 0.82 + 0.13 * i;
    base.drift = 1.5 + w.wind * 6;
    base.skyDim = 0.38 + 0.24 * i;
    base.wet = 0.45 + 0.55 * i;
    base.fogScale = 0.62 - 0.12 * i;
    base.fall = {
      kind: 'rain',
      amount: 0.3 + 0.7 * i,
      speed: 30 + 16 * i,        // ft/s — terminal velocity territory
      size: 1.4,
      sway: 0,
      slant: 0.12 + 0.5 * w.wind, // wind lays the streaks over
    };
  } else if (w.kind === 'snow') {
    base.cover = 0.78 + 0.14 * i;
    base.drift = 1 + w.wind * 4;
    base.skyDim = 0.26 + 0.18 * i;
    base.snow = snowDepth(seed, minutes, i);
    base.fogScale = 0.58 - 0.1 * i;
    base.fall = {
      kind: 'snow',
      amount: 0.28 + 0.72 * i,
      speed: 3.2 + 2.4 * i,      // ft/s — a flake, not a drop
      size: 2.6,
      sway: 1.4 + 1.8 * w.wind,
      slant: 0.05 + 0.3 * w.wind,
    };
  }
  base.flat = base.skyDim >= OVERCAST_SHADOW;
  return base;
}

// ---------- what the rain sounds like ----------

// Broadband rain heard in the open, dBA at the ear, at full intensity. Quieter
// than a diffuser is close-up and everywhere at once, which is what rain is.
export const RAIN_DB = 58;
// The patter's brightness by path: open sky, through the roof slab, through
// glass. The slab keeps the thump and eats the hiss — PATH_SLAB's own corner —
// and glazing keeps most of the brightness, which is why a window seat is
// where you hear the weather from.
export const RAIN_HZ_OPEN = 5200;
export const RAIN_HZ_GLASS = 2600;

// How loud the rain arrives at an ear, and through what. `at` is the three
// facts the mixer already knows:
//
//   outside      standing in it
//   slabsAbove   slabs between the ear and the sky — the top storey is 1
//                (the roof deck), each storey down adds one; the cross-slab
//                constant the acoustics already own prices each
//   glazeDist    ft to the nearest exterior glazing on this storey, Infinity
//                when the storey has none — the leak around the slab's answer
//
// Returns { db, hz } — dBA at the ear and the low-pass corner — or null when
// this weather makes no rain noise at all. Snow is silent on purpose; what
// snow does to the soundtrack is the wind, and the bed already owns the wind.
export function rainSound(weather, at = {}) {
  const w = normalizeWeather(weather);
  if (w.kind !== 'rain') return null;
  const src = RAIN_DB - 16 * (1 - w.intensity);
  if (at.outside) return { db: src, hz: RAIN_HZ_OPEN };
  const slabs = Math.max(1, Math.round(Number.isFinite(at.slabsAbove) ? at.slabsAbove : 1));
  // Diminishing after the first, the ray's own argument: the flanking paths
  // that let sound around one slab let it around three of them too.
  const roofDb = src - PATH_SLAB.db - (slabs - 1) * (PATH_SLAB.db * 0.5);
  const gd = Number.isFinite(at.glazeDist) ? Math.max(at.glazeDist, 3) : Infinity;
  const glassDb = gd === Infinity ? -Infinity : dbAt(src, gd) - PATH_SHELL.db * 0.55;
  return glassDb > roofDb
    ? { db: glassDb, hz: RAIN_HZ_GLASS }
    : { db: roofDb, hz: PATH_SLAB.hz };
}

// ---------- the glazing, read off a storey ----------

// How far either side of a boundary the "is there a room here" probe lands.
export const GLAZE_PROBE = 1.5;

// Every stretch of exterior glass on one storey — curtain-wall segments for
// their whole length, windows as their own spans — as bare segments the
// mixer can measure a distance to. Exterior is decided the way daylight.js
// decides it: probe both sides of the boundary, and if one of them is in no
// room at all, the glass faces the weather.
export function glazeSegments(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return [];
  const out = [];
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let s = 0; s < ring.pts.length; s++) {
        const glassWall = ring.walls[s] === SEG_GLASS;
        const windows = (ring.openings || []).filter((o) => o.seg === s && isWindowOpening(o));
        if (!glassWall && !windows.length) continue;
        const [a, b] = segEnds(ring, s);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.01) continue;
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const s0 = shapeAt(floor, mx - uz * GLAZE_PROBE, mz + ux * GLAZE_PROBE);
        const s1 = shapeAt(floor, mx + uz * GLAZE_PROBE, mz - ux * GLAZE_PROBE);
        if (s0 && s1) continue;               // glass onto another room — borrowed light
        if (glassWall) {
          out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
          continue;
        }
        for (const o of windows) {
          const t = clamp(Number.isFinite(o.t) ? o.t : 0.5, 0, 1);
          const half = Math.min((o.w || 3) / 2, len / 2);
          const c = t * len;
          const lo = clamp(c - half, 0, len), hi = clamp(c + half, 0, len);
          out.push({
            ax: a.x + ux * lo, az: a.z + uz * lo,
            bx: a.x + ux * hi, bz: a.z + uz * hi,
          });
        }
      }
    }
  }
  return out;
}

// Distance from a point to the nearest of those segments, in ft — Infinity
// on a storey with no exterior glass, which `rainSound` reads as "no leak".
export function glazeDistance(segs, x, z) {
  let best = Infinity;
  for (const s of segs || []) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((x - s.ax) * dx + (z - s.az) * dz) / len2, 0, 1) : 0;
    const px = s.ax + dx * t, pz = s.az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

// ---------- thunder ----------

// Rare and far, the phase's own words. Strikes are a seeded schedule —
// cumulative gaps, each drawn from its own hash lane — so the same seed is
// the same storm, and no amount of asking moves a strike. Intensity shortens
// the gaps a little; it never makes thunder frequent.
export const THUNDER_GAP_MIN = 55;    // s between strikes at full intensity
export const THUNDER_GAP_MAX = 240;
export const THUNDER_DIST_MIN = 2500; // ft — far on purpose
export const THUNDER_DIST_MAX = 9000;
// A close strike would be this loud at the reference distance; nothing here
// ever arrives at less than half a mile, so what reaches the ear is a rumble.
export const THUNDER_DB = 118;

// The first strike after `after` seconds into the walk: { at, dist, pan, db }
// — when, how far, which side of the sky (-1..1), and how loud it arrives
// after the distance has taken its toll. Deterministic in (seed, k).
export function nextThunder(seed, after = 0, intensity = 0.7) {
  const i = clamp(intensity, 0.05, 1);
  const scale = 1.5 - 0.7 * i;      // gentler storm, longer gaps
  let t = 20 + weatherHash(seed, 0) * 60;
  let k = 0;
  while (t <= after && k < 5000) {
    k++;
    t += (THUNDER_GAP_MIN + weatherHash(seed, k) * (THUNDER_GAP_MAX - THUNDER_GAP_MIN)) * scale;
  }
  const dist = THUNDER_DIST_MIN
    + weatherHash(seed, k * 2 + 1) * (THUNDER_DIST_MAX - THUNDER_DIST_MIN);
  return {
    at: t,
    dist,
    pan: weatherHash(seed, k * 2 + 2) * 2 - 1,
    db: dbAt(THUNDER_DB, dist),
  };
}
