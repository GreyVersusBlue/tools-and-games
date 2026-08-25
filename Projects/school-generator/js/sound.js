// sound.js — what makes noise, how loud it is where you are standing, and
// which of it the mixer can afford to play.
//
// This is Phase 4's answer to lights.js, and deliberately the same shape,
// because the problem is the same one: a design can contain far more sources
// than a browser can carry at once, so something has to rank them and
// something has to be honest about what it dropped.
//
// **Which props make noise is catalog data**, exactly the way `emit` says
// which ones are lights. A row with a `sound` block hums, ticks, hisses,
// burbles or carries the PA; a row without one is silent furniture, however
// mechanical it looks. So adding a noise source stays "add a row", and a save
// file still never has to know this module exists.
//
// **Levels are in dBA at three feet**, because that is how the products are
// specified — a ceiling diffuser is 38 dBA at 3ft, a refrigerated fountain 52,
// a vending machine 55, a corridor gong 100. Phase 1 committed to real
// dimensions and Phase 3 to real lumens; there is no reason sound should be
// the exception, and it means the drop-off is a law rather than a taste:
//
//     L(d) = L(3ft) - 20 * log10(d / 3)
//
// which is -6 dB per doubling of distance, and is a thing a test can check.
//
// The one artistic constant, stated once rather than smeared over a dozen
// hand-tuned gains: **playback compresses**. The real span from a ceiling
// diffuser to a school bell is about 62 dB, and a laptop speaker has neither
// the floor nor the ceiling for that — the diffuser would be silent or the
// bell would clip. `COMPRESS` raises everything toward the middle, so the
// ordering and the ratios survive and the extremes fit through the speaker.
//
// **Distance is not applied twice.** The dB math here decides *which* sources
// are worth a voice and what the readout says; once a source has a voice, the
// Web Audio PannerNode's own inverse-square law is what makes it quieter as
// you walk away. audio.js therefore takes `gain` from `gainAtRef` — the level
// at the reference distance — and lets the panner do the rest.
//
// Pure module: no three.js, no Web Audio. Exercised by test/sound.test.mjs.

import { FLOOR_H } from './grid.js';

// ---------- the units ----------

// Where a source's rating is quoted, and the distance the panner is told to
// treat as unity.
export const REF_DIST = 3;         // ft
// The level that plays at full scale. A school bell is louder than this and is
// allowed to be — it is the loudest thing in the building on purpose.
export const REF_DB = 92;          // dBA at REF_DIST
// Below this at the ear, a source isn't worth a voice. Roughly the noise floor
// of an empty room.
export const FLOOR_DB = 22;        // dBA
// See the header. 1.0 would be physically exact and unlistenable.
export const COMPRESS = 0.55;
// How many positional voices the mixer carries at once. Smaller than the light
// pool because each voice is a live node graph rather than a uniform, and
// because a school has fewer things making noise than making light.
export const MAX_VOICES = 8;

// A walking stride. Two steps to a stride would be 5ft; this is per *step*,
// which is what fires a sound.
export const STRIDE_FT = 2.5;

export const dbAt = (db, dist) =>
  db - 20 * Math.log10(Math.max(dist, REF_DIST) / REF_DIST);

// The gain a source rated `db` plays at when it is at the reference distance.
// Everything past that is the panner's job — see the note about not applying
// distance twice.
export const gainAtRef = (db) => Math.pow(10, (COMPRESS * (db - REF_DB)) / 20);

// ---------- reading the catalog ----------

// The `sound` block a catalog row may carry:
//   { kind, db, hz, q, dy, every }
//     kind   'hum' | 'hiss' | 'burble' | 'tick' | 'pa' | 'bell'
//            'hum' and 'hiss' and 'burble' run continuously; 'tick' fires on a
//            schedule; 'pa' and 'bell' are silent until something rings them.
//     db     dBA at REF_DIST
//     hz     the voice's centre frequency — a compressor hum is 120, a
//            diffuser's airflow 700, an aquarium's bubbler 900
//     q      how narrow that centre is: a motor is peaky, moving air isn't
//     dy     ft from the prop's origin to where the noise comes from
//     every  seconds between shots, for 'tick'
export const SOUND_KINDS = ['hum', 'hiss', 'burble', 'tick', 'pa', 'bell'];
export const LOOPED_KINDS = ['hum', 'hiss', 'burble'];

export function soundOf(entry) {
  const s = entry && entry.sound;
  if (!s || typeof s !== 'object') return null;
  if (!SOUND_KINDS.includes(s.kind)) return null;
  const db = typeof s.db === 'number' && Number.isFinite(s.db) ? s.db : 0;
  if (db <= 0) return null;
  return {
    kind: s.kind,
    db,
    hz: typeof s.hz === 'number' && s.hz > 0 ? s.hz : 400,
    q: typeof s.q === 'number' && s.q > 0 ? s.q : 1,
    dy: typeof s.dy === 'number' && Number.isFinite(s.dy) ? s.dy : 0,
    every: typeof s.every === 'number' && s.every > 0 ? s.every : 1,
    loop: LOOPED_KINDS.includes(s.kind),
  };
}

export const isSource = (entry) => soundOf(entry) !== null;

// ---------- the sources in a design ----------

// Every noise-making prop, in world feet. Same signature and same reasons as
// lights.js's `lightSources`.
export function soundSources(state, catalogEntry, floorHt = null) {
  if (!state || !Array.isArray(state.props)) return [];
  const ht = floorHt || state.floorHt || FLOOR_H;
  const out = [];
  for (const p of state.props) {
    const entry = catalogEntry(p.type);
    const snd = soundOf(entry);
    if (!snd) continue;
    const scale = p.scale > 0 ? p.scale : 1;
    out.push({
      id: p.id,
      type: p.type,
      name: (entry && entry.name) || p.type,
      floor: p.floor,
      x: p.x,
      y: p.floor * ht + (p.y || 0) + snd.dy * scale,
      z: p.z,
      kind: snd.kind,
      // A machine twice the size is louder, but nothing like four times: sound
      // power goes with radiating area, so doubling the prop is +6 dB, not
      // +12. `20*log10(scale)` is that.
      db: snd.db + 20 * Math.log10(scale),
      hz: snd.hz,
      q: snd.q,
      every: snd.every,
      loop: snd.loop,
      outdoor: !!(entry && entry.site),
      room: null,   // filled in by whoever knows the rooms — see `tagRooms`
    });
  }
  return out;
}

// Which room each source is in. Split out from `soundSources` because working
// it out costs a flood fill per source and the answer only changes when the
// design does, while the budget below runs several times a second.
export function tagRooms(sources, roomIdAt) {
  if (typeof roomIdAt !== 'function') return sources;
  for (const s of sources) s.room = roomIdAt(s.floor, s.x, s.z);
  return sources;
}

// ---------- what a wall costs ----------

// How much of a source survives the trip to an ear in a different room. This
// is deliberately one number per situation rather than a count of walls: the
// model could tell us how many partitions a straight line crosses, but the
// real path through a school is under a door and down a corridor, and a
// careful ray cast would give a *more precise* answer to the wrong question.
//
// The figures are one partition's worth of transmission loss as it actually
// arrives — a gypsum wall is rated near STC 40, but the door in it and the
// corridor around it mean you hear far more than that rating suggests.
export const PATH_OPEN = { db: 0, hz: 20000 };
export const PATH_WALL = { db: 17, hz: 900 };
export const PATH_SLAB = { db: 24, hz: 500 };
// Through the building envelope, either direction. Windows are the weak point,
// which is why this is closer to a wall than to a slab.
export const PATH_SHELL = { db: 20, hz: 700 };

export function pathLoss(src, ear) {
  if (!src || !ear) return PATH_OPEN;
  if (src.floor !== ear.floor) return PATH_SLAB;
  const a = src.room || null, b = ear.room || null;
  if (a && b) return a === b ? PATH_OPEN : PATH_WALL;
  // One of them is outdoors and the other isn't — unless neither is, in which
  // case they are both standing in the same car park.
  if (!a && !b) return PATH_OPEN;
  return PATH_SHELL;
}

// ---------- the budget ----------

export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// The `cap` sources worth a voice, loudest at the ear first, plus what was
// dropped. Loudness rather than nearness is the ranking, and the difference
// matters: a gym high bay's worth of ventilation forty feet away beats a
// ticking clock in the next room, which a distance sort would get backwards.
//
// Ties break on id so the list is stable frame to frame — the same property
// lights.js froze its cluster seeds for, and for the same reason: a voice that
// starts and stops as two sources trade places is worse than either choice.
export function budgetSounds(sources, ear, opts = {}) {
  const cap = opts.cap ?? MAX_VOICES;
  const floorDb = opts.floorDb ?? FLOOR_DB;
  const at = ear && Number.isFinite(ear.x) ? ear : { x: 0, y: 0, z: 0, floor: 0, room: null };

  const ranked = [];
  for (const s of sources) {
    const d = dist3(s, at);
    const path = pathLoss(s, at);
    const db = dbAt(s.db, d) - path.db;
    ranked.push({ src: s, dist: d, db, path });
  }
  ranked.sort((a, b) => b.db - a.db || (a.src.id || 0) - (b.src.id || 0));

  const heard = [];
  let dropped = 0, muted = 0;
  for (const r of ranked) {
    if (r.db < floorDb) { muted++; continue; }
    if (heard.length >= cap) { dropped++; continue; }
    heard.push(r);
  }
  return { heard, dropped, muted, total: sources.length, cap };
}

// ---------- footsteps ----------

// One step's worth of sound, per material. `db` is at the walker's own ear, so
// these are the levels you hear your own shoes at, not what the room hears.
// `hz` is the thump, `tone` the corner the slap sits under, `decay` how long
// the whole thing lasts, `scuff` how much of it is skin rather than heel.
//
// The ordering is the real one: terrazzo and ceramic are the loudest and
// brightest surfaces in a school, carpet the quietest and dullest, and the
// gap between them is most of what a corridor sounds like.
export const FOOTSTEPS = {
  vct:      { db: 62, hz: 190, tone: 3200, decay: 0.10, scuff: 0.35 },
  carpet:   { db: 48, hz: 120, tone: 900,  decay: 0.07, scuff: 0.55 },
  tile:     { db: 66, hz: 210, tone: 4200, decay: 0.13, scuff: 0.30 },
  wood:     { db: 64, hz: 150, tone: 2400, decay: 0.14, scuff: 0.30 },
  rubber:   { db: 54, hz: 140, tone: 1400, decay: 0.07, scuff: 0.42 },
  concrete: { db: 65, hz: 175, tone: 3600, decay: 0.11, scuff: 0.30 },
  terrazzo: { db: 68, hz: 200, tone: 4600, decay: 0.14, scuff: 0.28 },
};

// A stair tread is a plate over a void, so it rings where a slab thuds — and
// what the tread is finished in matters much less than the fact that it is
// hollow underneath.
export const STAIR_STEP = { db: 68, hz: 230, tone: 5000, decay: 0.17, scuff: 0.25 };
// Outside: asphalt and grit, dead and dull, with more scuff than strike.
export const GROUND_STEP = { db: 56, hz: 130, tone: 1800, decay: 0.08, scuff: 0.6 };

// Out on the site, keyed on the `step` column every surface row in site.js
// carries. Three voices rather than ten, because the ear does not distinguish
// a concrete walk from an asphalt drive and very much does distinguish either
// from grass — and bare graded earth, where no region has been drawn, keeps
// the plain GROUND_STEP it always had.
export const SITE_STEPS = {
  hard: { db: 60, hz: 150, tone: 2600, decay: 0.09, scuff: 0.42 },
  soft: { db: 48, hz: 100, tone: 900, decay: 0.06, scuff: 0.72 },
  gravel: { db: 58, hz: 120, tone: 3400, decay: 0.07, scuff: 0.9 },
};

// `surface` is `supportAt`'s own answer — 'floor', 'stair' or 'ground' — so
// the sound and the collision agree about what you are standing on by
// construction rather than by coincidence. `site` is the third argument Phase
// 5 of the second arc added: when the answer is 'ground', *which* ground.
export function footstepFor(surface, finish, site = null) {
  if (surface === 'stair') return STAIR_STEP;
  if (surface === 'ground') return (site && SITE_STEPS[site]) || GROUND_STEP;
  return FOOTSTEPS[finish] || FOOTSTEPS.vct;
}

// Distance walked, turned into steps. Returns the leftover so the caller can
// carry it: a stride is a distance, not a timer, so walking slowly makes
// slower footsteps for free and stopping mid-stride doesn't lose the fraction.
//
// The step cap is a stalled-frame guard, the same idea as walkthrough's
// MAX_STEP: a two-second hitch should cost you the footsteps, not fire nine of
// them at once.
export function stride(acc, dist, strideFt = STRIDE_FT) {
  const s = strideFt > 0 ? strideFt : STRIDE_FT;
  let a = (Number.isFinite(acc) ? acc : 0) + Math.max(0, Number.isFinite(dist) ? dist : 0);
  let steps = 0;
  while (a >= s && steps < 3) { a -= s; steps++; }
  if (a >= s) a = 0;
  return { acc: a, steps };
}

// ---------- doors ----------

// What the leaves did since last time. openings.js hands the same array to the
// renderer to pose and to the collider to resolve against; this reads the same
// objects a third time and says which of them just started moving or just shut,
// so no third party has to describe a door to anyone.
//
// A double door's two leaves share a centre, so a pair latches once rather
// than twice — which is what a pair of doors with a single push bar does.
export function doorEvents(leaves, prev) {
  const next = new Map();
  const events = [];
  const fired = new Set();
  for (const leaf of leaves || []) {
    const was = prev && prev.has(leaf.key) ? prev.get(leaf.key) : 0;
    const now = leaf.open || 0;
    next.set(leaf.key, now);
    const kind = was <= 0 && now > 0 ? 'latch' : (was > 0 && now <= 0 ? 'shut' : null);
    if (!kind) continue;
    const at = `${kind}@${leaf.cx.toFixed(2)},${leaf.cz.toFixed(2)}`;
    if (fired.has(at)) continue;
    fired.add(at);
    events.push({ kind, x: leaf.cx, z: leaf.cz, wide: (leaf.len || 3) > 2.6 });
  }
  return { events, next };
}

export const DOOR_LATCH = { db: 64, hz: 2600, decay: 0.07 };
export const DOOR_SHUT  = { db: 70, hz: 160,  decay: 0.16 };

// ---------- the bell ----------

// A struck bell is not a note, it is a handful of partials that are not
// harmonics — which is why a sine at 660 Hz sounds like a test tone and this
// sounds like a bell. The ratios are the campanologist's: hum an octave below
// the prime, a minor third above it (the tierce, which is what makes a bell
// sound melancholy), a fifth, an octave, and a thin tail above that. Higher
// partials die first, which is the other half of the character.
export const BELL_PARTIALS = [
  { ratio: 0.5,  gain: 0.55, decay: 4.6 },   // hum
  { ratio: 1.0,  gain: 1.00, decay: 3.2 },   // prime
  { ratio: 1.2,  gain: 0.72, decay: 2.4 },   // tierce — the minor third
  { ratio: 1.5,  gain: 0.52, decay: 1.8 },   // quint
  { ratio: 2.0,  gain: 0.58, decay: 1.3 },   // nominal
  { ratio: 2.5,  gain: 0.28, decay: 0.8 },   // deciem
  { ratio: 3.0,  gain: 0.20, decay: 0.55 },  // undecime
];
// A corridor gong sits about here, and runs about this loud — loud enough that
// the code that governs it is fire-alarm code.
export const BELL_HZ = 660;
export const BELL_DB = 100;      // dBA at REF_DIST
export const BELL_RINGS = 3;     // strikes in one bell
export const BELL_GAP = 0.42;    // s between strikes

// The three-note descending chime a PA plays before it says anything: a major
// triad down from the fifth, which is the one every intercom in the country
// has agreed on.
export const PA_CHIME = [784, 659, 523];
export const PA_DB = 88;
// A PA is a telephone-band device, and that is most of why an announcement
// down a corridor sounds like an announcement rather than like a person.
export const PA_BAND = { lo: 320, hi: 3200 };
