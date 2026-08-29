// murmur.js — the crowd as sound.
//
// The simulation knows where every person is. The air, until Phase 28, had no
// idea: the walker's shoes, the doors and the machinery were the whole of the
// daytime soundtrack, in a building whose model can already say which rooms
// hold a class this period, how many are at lunch, and who is in the corridor
// between bells. This module turns that occupancy into *emitters* — positions,
// levels, kinds — and stops there. No audio, no three.js, no Web Audio: what a
// murmur emitter sounds like is audio.js's business, exactly the way sound.js
// describes a bell without ringing one.
//
// The shape it hands back is deliberately sound.js's own source shape
// (`{ id, kind, floor, x, y, z, db, hz, q, room, loop }`), because the whole
// point is that these ride the existing plumbing: the same `budgetSounds`
// ranking, the same voice cap, the same `pathLossRay` pricing through walls —
// so a lesson behind a shut door is muffled by the door being shut, and an
// open one lets it spill into the corridor, with not one new rule anywhere.
//
// **Levels are dBA at three feet**, like every source in sound.js, and the
// crowd's arithmetic is the real one: n incoherent talkers are
// `10·log10(n)` dB over one talker — +3 dB per doubling — which is why a
// cafeteria at thirty is a presence and at three hundred is a roar, without a
// single hand-tuned "cafeteria volume" anywhere.
//
// Three smaller answers live here too, because they are all "derive it from
// the model" answers to sound questions:
//   `roomToneSpec` — the near-silent HVAC bed a room deserves, from its
//                    volume and finishes;
//   `paScript`     — the morning announcement, as text, seeded from the
//                    school's name, the date and the day's rooms;
//   the chat pair  — two agents who stopped to talk, as one emitter.
//
// Pure module. Exercised by test/murmur.test.mjs.

import { FLOOR_H } from './grid.js';
import { blockAt } from './schedule.js';
import { rng } from './agents.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- the kinds ----------

// Five ways a crowd sounds, and no more: a room being taught in, a room
// talking over itself, a gym, a corridor at passing, and two people who
// stopped in the hall. Everything a school's people do lands in one of them.
export const MURMUR_KINDS = ['lesson', 'chatter', 'gym', 'rush', 'chat'];

// The voice each kind gets — centre frequency and how peaky it is — stated
// here beside the levels so the whole voicing of the crowd is one table.
// A lesson is one adult voice, low and narrow; chatter is many voices wide;
// a gym is shouts and shoe-squeak, bright; a rush is mostly feet.
export const MURMUR_VOICES = {
  lesson:  { hz: 420, q: 1.1 },
  chatter: { hz: 800, q: 0.8 },
  gym:     { hz: 1300, q: 0.6 },
  rush:    { hz: 950, q: 0.7 },
  chat:    { hz: 520, q: 1.2 },
};

// ---------- the levels ----------

// One talker at conversational effort is about 54 dBA at three feet; a
// teacher pitching to the back row runs louder. The formulas below are the
// crowd sum over those two numbers, per kind:
//
//   lesson   one raised voice, plus the rustle of n listeners — the rustle
//            counts a twentieth of a talker each, which is what keeps a
//            lecture for five and a lecture for thirty within a few dB.
//   chatter  half the room talking at once (the other half is listening,
//            for now), summed incoherently.
//   gym      everybody making noise — shouting, bouncing, squeaking — at a
//            level per head that starts above conversation, because nobody
//            uses a gym quietly.
//   rush     a knot of walkers: feet and cross-talk, per head over a low base.
//   chat     exactly two people, flat.
export const TALK_DB = 54;      // one conversational voice, dBA at 3ft
export const LESSON_DB = 58;    // one teaching voice, dBA at 3ft
export const GYM_HEAD_DB = 60;  // one person's worth of gym, dBA at 3ft
export const RUSH_HEAD_DB = 48; // one walker's worth of corridor, dBA at 3ft
export const CHAT_DB = 50;      // two people keeping it down

export function murmurDb(kind, count) {
  const n = Math.max(1, Math.round(count || 1));
  switch (kind) {
    case 'lesson': return LESSON_DB + 10 * Math.log10(1 + n * 0.05);
    case 'chatter': return TALK_DB + 10 * Math.log10(Math.max(1, n / 2));
    case 'gym': return GYM_HEAD_DB + 10 * Math.log10(n);
    case 'rush': return RUSH_HEAD_DB + 10 * Math.log10(n);
    case 'chat': return CHAT_DB;
    default: return 0;
  }
}

// Which kind a room full of people is. The gym is the gym whatever the clock
// says — PE is a class and it is still loud. Every other room is a lesson
// while a class block is running (one voice, everyone else listening) and
// chatter the rest of the time: homeroom, lunch, the minutes either side of
// a bell — the difference between a school at ten past nine and at noon is
// exactly this line.
export function murmurKindFor(use, blockKind) {
  if (use === 'gym') return 'gym';
  return blockKind === 'class' ? 'lesson' : 'chatter';
}

// ---------- the emitters ----------

// Where a mouth is, above the storey's floor. Seated and standing split the
// difference; nothing at ear-level cares about the half-foot.
export const MOUTH_H = 4;       // ft

// The corridor rush is clustered rather than per-person: forty walkers are
// a handful of knots of crowd, not forty voices. The cell is about a
// corridor-width; a cell needs this many walkers before it is a sound.
export const RUSH_CELL = 20;    // ft
export const RUSH_MIN = 3;

// The most emitters worth handing to the budget. It only ever voices a
// handful; past this the rest were never going to place, and the sort they
// cost the mixer four times a second is real.
export const MURMUR_CAP = 48;

// The storeys' sound emitters, from who is where and what the clock says.
//
// `rooms` is occupancy.js's own rows (`buildingOccupancy(...).rooms` — id,
// floor, x, z, use), because the classification problem is already solved
// there and solving it twice would give the two answers Phase 12 warned
// about. `agents` is agents.js's own array, read and never written. The
// hour arrives as `sched` + `minutes`, the same pair every schedule reader
// takes.
//
// Who counts where:
//   sit / idle   the room they answered the bell to (`goal`, falling back
//                to `home`) — seated bodies are that room's headcount;
//   walk / queue the corridor: clustered into rush knots per storey;
//   chat         a pair emitter at the midpoint, once per pair;
//   out / ride   nobody — outdoors is the wind's, and a lift car is a box.
export function murmurEmitters(rooms, agents, sched, minutes, opts = {}) {
  const floorHt = opts.floorHt || FLOOR_H;
  const cap = opts.cap ?? MURMUR_CAP;
  const block = blockAt(sched, minutes);

  const roomRows = new Map();
  for (const r of rooms || []) roomRows.set(r.id, r);
  const byId = new Map();
  for (const a of agents || []) byId.set(a.id, a);

  const seated = new Map();     // roomId -> headcount
  const rush = new Map();       // `${floor}|${cx}|${cz}` -> { floor, sx, sz, n }
  const out = [];

  for (const a of agents || []) {
    if (a.state === 'sit' || a.state === 'idle') {
      const roomId = a.goal ?? a.home;
      if (roomId === null || roomId === undefined || !roomRows.has(roomId)) continue;
      seated.set(roomId, (seated.get(roomId) || 0) + 1);
    } else if (a.state === 'walk' || a.state === 'queue') {
      const f = a.floorIndex ?? 0;
      const key = `${f}|${Math.floor(a.x / RUSH_CELL)}|${Math.floor(a.z / RUSH_CELL)}`;
      let cell = rush.get(key);
      if (!cell) { cell = { key, floor: f, sx: 0, sz: 0, n: 0 }; rush.set(key, cell); }
      cell.sx += a.x; cell.sz += a.z; cell.n++;
    } else if (a.state === 'chat' && a.chat) {
      // One emitter per pair, claimed by the lower id so it is emitted once
      // and its identity is stable for the whole conversation.
      if (a.chat.with < a.id && byId.has(a.chat.with)) continue;
      const b = byId.get(a.chat.with);
      const bx = b ? b.x : a.chat.x, bz = b ? b.z : a.chat.z;
      out.push({
        id: `chat:${Math.min(a.id, a.chat.with)}~${Math.max(a.id, a.chat.with)}`,
        kind: 'chat',
        floor: a.floorIndex ?? 0,
        x: (a.x + bx) / 2,
        y: (a.floorIndex ?? 0) * floorHt + MOUTH_H,
        z: (a.z + bz) / 2,
        db: murmurDb('chat', 2),
        hz: MURMUR_VOICES.chat.hz, q: MURMUR_VOICES.chat.q,
        count: 2, room: null, loop: true,
      });
    }
  }

  for (const [roomId, n] of seated) {
    const r = roomRows.get(roomId);
    const kind = murmurKindFor(r.use, block.kind);
    const v = MURMUR_VOICES[kind];
    out.push({
      id: `mur:${r.floor}:${roomId}`,
      kind,
      floor: r.floor,
      x: r.x,
      y: r.floor * floorHt + MOUTH_H,
      z: r.z,
      db: murmurDb(kind, n),
      hz: v.hz, q: v.q,
      count: n, room: roomId, loop: true,
    });
  }

  for (const cell of rush.values()) {
    if (cell.n < RUSH_MIN) continue;
    out.push({
      id: `rush:${cell.key}`,
      kind: 'rush',
      floor: cell.floor,
      x: cell.sx / cell.n,
      y: cell.floor * floorHt + MOUTH_H,
      z: cell.sz / cell.n,
      db: murmurDb('rush', cell.n),
      hz: MURMUR_VOICES.rush.hz, q: MURMUR_VOICES.rush.q,
      count: cell.n, room: null, loop: true,
    });
  }

  if (out.length > cap) {
    out.sort((a, b) => b.db - a.db || (a.id < b.id ? -1 : 1));
    out.length = cap;
  }
  return out;
}

// ---------- room tone ----------

// The near-silent HVAC bed a room deserves, as a scale on the listener bed
// audio.js already runs: `gain` multiplies the bed's level, `hz` moves the
// lowpass corner. Derived from the acoustics record the reverb already
// derives (`roomAcoustics`), so the quiet between periods is *this* room's
// quiet: a big hard gym breathes more plant, brighter; a small carpeted
// office barely registers, and dull. Null outdoors — outside there is wind,
// and the bed's crossfade already owns that.
export function roomToneSpec(ac) {
  if (!ac || !(ac.volume > 0)) return null;
  // The same 0..1 "how big" handle reverbSpec keeps.
  const size = clamp(Math.cbrt(ac.volume / 100000), 0, 1);
  const alpha = clamp(ac.meanAlpha || 0, 0, 0.6);
  return {
    // Bigger rooms carry more air; soft rooms swallow what there is.
    gain: clamp((0.55 + 0.65 * size) * (1 - 0.75 * alpha), 0.2, 1.2),
    // Absorption eats the hiss first, so a soft room's tone is duller.
    hz: clamp(360 - 420 * alpha, 160, 360),
  };
}

// ---------- the PA's script ----------

// A school that has never been named gets one from the seed, so the morning
// announcement is about *a* school rather than about a software project —
// and the same seed names it the same thing tomorrow.
export const SCHOOL_NAMES = [
  'Kestrel Ridge', 'Fair Harbor', 'Maple Hollow', 'Ninth Street',
  'Granite Bay', 'Larkspur', 'Cedar Field', 'Whitewater',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// The middle of the announcement: one or two of these, rooms spliced in.
// Written to survive any room name a design holds — the room is quoted, not
// parsed.
const NOTICES = [
  (r) => `${r} is closed for cleaning during lunch today.`,
  (r) => `Chess club meets after school in ${r}.`,
  (r) => `Yearbook photos continue this week in ${r}.`,
  (r) => `Please keep the corridor outside ${r} clear this morning.`,
  (r) => `Lost property may be collected from ${r} at lunch.`,
  (r) => `Auditions sign-up sheets are posted outside ${r}.`,
];

// The morning announcement, as text. Deterministic for a seed and a date:
// the same school says the same things on the same morning, which is what
// makes it the school's voice rather than a random-line generator. `kind`
// 'drill' swaps the notices for the one announcement a drill makes.
//
// `opts`: { school, date (a Date), rooms (names), kind }
export function paScript(seed, opts = {}) {
  const rand = rng(((seed ?? 1) >>> 0) * 7919 + 17);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const school = (typeof opts.school === 'string' && opts.school.trim())
    ? opts.school.trim()
    : `${pick(SCHOOL_NAMES)} School`;

  if (opts.kind === 'drill') {
    return {
      school,
      lines: [
        'Attention please. This is a fire drill.',
        'Leave by the nearest exit and gather at the muster point.',
        'Walk, do not run.',
      ],
    };
  }

  const lines = [`Good morning, students of ${school}.`];
  const d = opts.date instanceof Date && !Number.isNaN(opts.date.getTime())
    ? opts.date : null;
  if (d) {
    lines.push(`Today is ${WEEKDAYS[d.getDay()]}, `
      + `${MONTHS[d.getMonth()]} ${d.getDate()}.`);
  }
  const rooms = (opts.rooms || []).filter((r) => typeof r === 'string' && r.trim());
  const notices = Math.min(rooms.length, 2);
  // Deal notices and rooms without repeats: the rand walks both lists.
  const dealtN = new Set(); const dealtR = new Set();
  for (let i = 0; i < notices; i++) {
    let ni = Math.floor(rand() * NOTICES.length);
    while (dealtN.has(ni)) ni = (ni + 1) % NOTICES.length;
    dealtN.add(ni);
    let ri = Math.floor(rand() * rooms.length);
    while (dealtR.has(ri)) ri = (ri + 1) % rooms.length;
    dealtR.add(ri);
    lines.push(NOTICES[ni](rooms[ri].trim()));
  }
  lines.push('Have a good day.');
  return { school, lines };
}
