// What makes a noise, and how loud it is where you're standing. Run
// `node --test` from Projects/school-generator.
//
// The level maths is checked against the law rather than against itself: sound
// pressure falls 6 dB per doubling of distance, and that is a number anybody
// can verify without reading the function. The budget is checked for the
// property that makes it worth having — loudness, not nearness, decides who
// gets a voice — and for the stability that keeps a voice from flickering.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REF_DIST, REF_DB, FLOOR_DB, COMPRESS, MAX_VOICES, STRIDE_FT,
  SOUND_KINDS, LOOPED_KINDS,
  soundOf, isSource, soundSources, tagRooms, budgetSounds, pathLoss,
  PATH_OPEN, PATH_WALL, PATH_SLAB, PATH_SHELL,
  dbAt, gainAtRef, dist3,
  FOOTSTEPS, STAIR_STEP, GROUND_STEP, footstepFor, stride,
  doorEvents, DOOR_LATCH, DOOR_SHUT,
  BELL_PARTIALS, BELL_HZ, BELL_DB, BELL_RINGS, PA_CHIME, PA_BAND,
} from '../js/sound.js';
import { PROP_CATALOG, catalogEntry } from '../js/catalog.js';
import { createState } from '../js/grid.js';
import { addProp } from '../js/props.js';
import { FINISH_KEYS } from '../js/finish.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// ---------- the law ----------

test('level falls 6 dB per doubling of distance', () => {
  const src = 80;
  near(dbAt(src, REF_DIST), src, 1e-12, 'at the reference distance it is the rating');
  near(dbAt(src, REF_DIST * 2), src - 6.0206, 1e-3, 'one doubling');
  near(dbAt(src, REF_DIST * 4), src - 12.0412, 1e-3, 'two doublings');
  near(dbAt(src, REF_DIST * 8), src - 18.0618, 1e-3, 'three doublings');
  // Closer than the reference distance doesn't keep getting louder — a point
  // source model goes to infinity there and a room never does.
  assert.equal(dbAt(src, 0), src);
  assert.equal(dbAt(src, 0.01), src);
});

test('the gain map is monotone, compressed, and unity at the reference level', () => {
  near(gainAtRef(REF_DB), 1, 1e-12, 'the reference level plays at unity');
  assert.ok(gainAtRef(60) < gainAtRef(80));
  assert.ok(gainAtRef(0) > 0, 'and it never reaches zero, so nothing clicks out');
  // Compression: a 20 dB drop in the world is less than 20 dB at the speaker.
  const real = Math.pow(10, -20 / 20);
  assert.ok(gainAtRef(REF_DB - 20) > real, 'quiet things are lifted toward audibility');
  near(gainAtRef(REF_DB - 20), Math.pow(10, (COMPRESS * -20) / 20), 1e-12, 'by the stated exponent');
});

// ---------- reading the catalog ----------

test('a sound block is validated, and anything else is silence', () => {
  assert.equal(soundOf(null), null);
  assert.equal(soundOf({}), null);
  assert.equal(soundOf({ sound: { kind: 'hum' } }), null, 'no level, no sound');
  assert.equal(soundOf({ sound: { kind: 'trombone', db: 60 } }), null, 'unknown kind');
  assert.equal(soundOf({ sound: { kind: 'hum', db: -3 } }), null);
  const s = soundOf({ sound: { kind: 'hiss', db: 40 } });
  assert.equal(s.kind, 'hiss');
  assert.equal(s.loop, true);
  assert.ok(s.hz > 0 && s.q > 0, 'defaults rather than undefined');
  assert.equal(soundOf({ sound: { kind: 'pa', db: 88 } }).loop, false, 'a PA idles silent');
  assert.ok(LOOPED_KINDS.every((k) => SOUND_KINDS.includes(k)));
});

test('the catalog only ever names a kind this build can play', () => {
  let withSound = 0;
  for (const row of PROP_CATALOG) {
    if (!row.sound) continue;
    withSound++;
    assert.ok(isSource(row), `${row.type} carries a sound block that doesn't parse`);
    assert.ok(SOUND_KINDS.includes(row.sound.kind), `${row.type}: ${row.sound.kind}`);
    // Real products, real levels: nothing in a school is quieter than a
    // whisper or louder than an alarm.
    assert.ok(row.sound.db >= 30 && row.sound.db <= 110, `${row.type}: ${row.sound.db} dBA`);
  }
  assert.ok(withSound >= 8, 'the phase is not worth having with fewer than this');
  // Exactly one thing in the catalog is a bell, and it is the bell.
  const bells = PROP_CATALOG.filter((r) => r.sound && r.sound.kind === 'bell');
  assert.equal(bells.length, 1);
  assert.equal(bells[0].type, 'bell-corridor');
});

test('an absorption override is a coefficient, not a level', () => {
  for (const row of PROP_CATALOG) {
    if (row.absorb === undefined) continue;
    assert.ok(row.absorb >= 0 && row.absorb <= 1, `${row.type}: ${row.absorb}`);
  }
  // The acoustic panel exists and is the most absorptive thing in the catalog,
  // which is the entire reason to place one.
  const best = PROP_CATALOG.filter((r) => typeof r.absorb === 'number')
    .sort((a, b) => b.absorb - a.absorb)[0];
  assert.ok(best.type.includes('acoustic'), best.type);
});

// ---------- sources in a design ----------

const table = {
  quiet: { type: 'quiet', name: 'Diffuser', category: 'Fixtures', w: 2, d: 2, h: 0.4, mount: 'ceiling', sound: { kind: 'hiss', db: 38, hz: 700 } },
  loud: { type: 'loud', name: 'Fridge', category: 'Cafeteria', w: 4, d: 3, h: 6, mount: 'floor', sound: { kind: 'hum', db: 58, hz: 120, dy: 2 } },
  mute: { type: 'mute', name: 'Chair', category: 'Seating', w: 2, d: 2, h: 3, mount: 'floor' },
};
const entry = (t) => table[t] || null;

function design() {
  const s = createState(20, 20);
  s.floors.push(structuredClone(s.floors[0]));
  return s;
}

test('only rows with a sound block become sources', () => {
  const s = design();
  addProp(s, 'quiet', { floor: 0, x: 10, z: 10, y: 9.6 });
  addProp(s, 'loud', { floor: 0, x: 40, z: 10 });
  addProp(s, 'mute', { floor: 0, x: 12, z: 10 });
  const srcs = soundSources(s, entry);
  assert.equal(srcs.length, 2);
  assert.deepEqual(srcs.map((x) => x.type).sort(), ['loud', 'quiet']);
  // `dy` lifts the emitter off the prop's own origin, and the storey lifts it
  // again — the same two-step lights.js does.
  const fridge = srcs.find((x) => x.type === 'loud');
  assert.equal(fridge.y, 2);
});

test('a bigger machine is louder by area, not by volume', () => {
  const s = design();
  addProp(s, 'loud', { floor: 0, x: 10, z: 10, scale: 2 });
  const [src] = soundSources(s, entry);
  // Doubling the size is +6 dB — sound power goes with radiating area.
  near(src.db, 58 + 6.0206, 1e-3, 'scale');
});

test('a storey lifts a source by the floor-to-floor height', () => {
  const s = design();
  addProp(s, 'quiet', { floor: 1, x: 10, z: 10, y: 9.6 });
  const [src] = soundSources(s, entry, 12);
  assert.equal(src.floor, 1);
  assert.equal(src.y, 12 + 9.6);
});

// ---------- what a wall costs ----------

test('a wall, a slab and the envelope each cost what they cost', () => {
  const ear = { floor: 0, room: 'a' };
  assert.equal(pathLoss({ floor: 0, room: 'a' }, ear), PATH_OPEN, 'same room');
  assert.equal(pathLoss({ floor: 0, room: 'b' }, ear), PATH_WALL, 'next room');
  assert.equal(pathLoss({ floor: 1, room: 'a' }, ear), PATH_SLAB, 'upstairs');
  assert.equal(pathLoss({ floor: 0, room: null }, ear), PATH_SHELL, 'from outside');
  assert.equal(pathLoss({ floor: 0, room: null }, { floor: 0, room: null }), PATH_OPEN,
    'both in the same car park');
  // A slab is a better barrier than a wall, and both muffle as well as quieten.
  assert.ok(PATH_SLAB.db > PATH_WALL.db);
  assert.ok(PATH_SLAB.hz < PATH_WALL.hz);
  assert.ok(PATH_OPEN.db === 0 && PATH_OPEN.hz > 18000);
});

test('rooms are tagged once, off whatever knows where rooms are', () => {
  const s = design();
  addProp(s, 'quiet', { floor: 0, x: 10, z: 10 });
  const srcs = tagRooms(soundSources(s, entry), (floor, x) => (x > 5 ? 'east' : 'west'));
  assert.equal(srcs[0].room, 'east');
  // Handed nothing to ask, it leaves them alone rather than guessing.
  assert.equal(tagRooms([{ room: 'kept' }], null)[0].room, 'kept');
});

// ---------- the budget ----------

const src = (over) => ({ id: 1, x: 0, y: 0, z: 0, floor: 0, room: 'a', db: 50, loop: true, ...over });

test('loudness at the ear decides, not distance', () => {
  const ear = { x: 0, y: 0, z: 0, floor: 0, room: 'a' };
  const near1 = src({ id: 1, x: 6, db: 38 });          // a clock, close
  const far = src({ id: 2, x: 60, db: 85 });           // a gym fan, far
  const b = budgetSounds([near1, far], ear, { cap: 2 });
  assert.equal(b.heard[0].src.id, 2, 'the loud far one is the one you hear');
  assert.ok(b.heard[0].db > b.heard[1].db);
});

test('the cap is a cap, and what it drops is reported rather than hidden', () => {
  const ear = { x: 0, y: 0, z: 0, floor: 0, room: 'a' };
  const many = Array.from({ length: 20 }, (_, i) => src({ id: i + 1, x: i * 0.5, db: 70 }));
  const b = budgetSounds(many, ear, { cap: 4 });
  assert.equal(b.heard.length, 4);
  assert.equal(b.dropped, 16);
  assert.equal(b.total, 20);
  assert.equal(b.heard.length + b.dropped + b.muted, 20, 'every source is accounted for');
});

test('a source below the noise floor is muted rather than budgeted', () => {
  const ear = { x: 0, y: 0, z: 0, floor: 0, room: 'a' };
  const whisper = src({ id: 1, x: 4000, db: 38 });
  const b = budgetSounds([whisper], ear, { cap: MAX_VOICES });
  assert.equal(b.heard.length, 0);
  assert.equal(b.muted, 1);
  assert.equal(b.dropped, 0, 'it did not lose a slot, it was inaudible');
  assert.ok(dbAt(38, dist3(whisper, ear)) < FLOOR_DB);
});

test('a wall between you and a source costs it its place', () => {
  const ear = { x: 0, y: 0, z: 0, floor: 0, room: 'a' };
  const here = src({ id: 1, x: 20, db: 68, room: 'a' });
  const there = src({ id: 2, x: 20, db: 68, room: 'b' });
  const b = budgetSounds([there, here], ear, { cap: 2 });
  assert.equal(b.heard[0].src.id, 1, 'same room wins at equal distance and level');
  near(b.heard[0].db - b.heard[1].db, PATH_WALL.db, 1e-9, 'and the gap is exactly the wall');
});

test('the ranking is stable, so a voice cannot flicker between equals', () => {
  const ear = { x: 0, y: 0, z: 0, floor: 0, room: 'a' };
  const twins = [src({ id: 7, x: 10 }), src({ id: 3, x: 10 })];
  const a = budgetSounds(twins, ear, { cap: 1 });
  const b = budgetSounds([...twins].reverse(), ear, { cap: 1 });
  assert.equal(a.heard[0].src.id, 3);
  assert.equal(b.heard[0].src.id, 3, 'the same one, whatever order props[] is in');
});

// ---------- footsteps ----------

test('every floor finish has a footstep, and they are ordered the way rooms are', () => {
  for (const key of FINISH_KEYS) {
    assert.ok(FOOTSTEPS[key], `no footstep for ${key}`);
  }
  assert.ok(FOOTSTEPS.terrazzo.db > FOOTSTEPS.vct.db);
  assert.ok(FOOTSTEPS.vct.db > FOOTSTEPS.carpet.db, 'carpet is the quiet one');
  assert.ok(FOOTSTEPS.carpet.tone < FOOTSTEPS.tile.tone, 'and the dull one');
});

test('the surface underfoot beats the finish drawn on it', () => {
  assert.equal(footstepFor('stair', 'carpet'), STAIR_STEP, 'a tread is hollow whatever it is finished in');
  assert.equal(footstepFor('ground', 'terrazzo'), GROUND_STEP);
  assert.equal(footstepFor('floor', 'wood'), FOOTSTEPS.wood);
  assert.equal(footstepFor('floor', null), FOOTSTEPS.vct, 'and an unfinished slab is VCT');
});

test('a stride is a distance, so slower walking makes slower footsteps', () => {
  assert.deepEqual(stride(0, 0), { acc: 0, steps: 0 });
  assert.deepEqual(stride(0, STRIDE_FT), { acc: 0, steps: 1 });
  const half = stride(0, STRIDE_FT / 2);
  assert.equal(half.steps, 0);
  // The fraction is carried, so two half-strides are one step and not none.
  assert.equal(stride(half.acc, STRIDE_FT / 2).steps, 1);
  assert.equal(stride(0, STRIDE_FT * 2.5).steps, 2);
  // A stalled frame costs you the footsteps rather than firing all of them.
  const hitch = stride(0, STRIDE_FT * 40);
  assert.equal(hitch.steps, 3);
  assert.equal(hitch.acc, 0);
  assert.equal(stride(NaN, NaN).steps, 0, 'nothing to walk is not a crash');
});

// ---------- doors ----------

const leaf = (key, open, cx = 0, cz = 0) => ({ key, open, cx, cz, len: 3 });

test('a door latches once when it starts and once when it stops', () => {
  let prev = new Map();
  let r = doorEvents([leaf('a#0', 0)], prev);
  assert.deepEqual(r.events, [], 'a shut door that stays shut says nothing');
  prev = r.next;

  r = doorEvents([leaf('a#0', 0.2)], prev);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'latch');
  prev = r.next;

  // Still swinging: already latched, so nothing more.
  r = doorEvents([leaf('a#0', 0.9)], prev);
  assert.deepEqual(r.events, []);
  prev = r.next;

  r = doorEvents([leaf('a#0', 0)], prev);
  assert.equal(r.events[0].kind, 'shut');
});

test('a pair of leaves on one opening is one door', () => {
  const pair = [leaf('d#0', 0.3, 12, 4), leaf('d#1', 0.3, 12, 4)];
  const r = doorEvents(pair, new Map());
  assert.equal(r.events.length, 1, 'two leaves, one latch');
  assert.equal(r.next.size, 2, 'but both are remembered');
  // Two doors in different places are two doors.
  const apart = [leaf('d#0', 0.3, 12, 4), leaf('e#0', 0.3, 40, 4)];
  assert.equal(doorEvents(apart, new Map()).events.length, 2);
});

test('a closing door is a lower, longer sound than a latch releasing', () => {
  assert.ok(DOOR_SHUT.db > DOOR_LATCH.db);
  assert.ok(DOOR_SHUT.hz < DOOR_LATCH.hz);
  assert.ok(DOOR_SHUT.decay > DOOR_LATCH.decay);
  assert.deepEqual(doorEvents(null, null).events, [], 'no leaves is not a crash');
});

// ---------- the bell ----------

test('a bell is inharmonic, which is what makes it a bell', () => {
  const ratios = BELL_PARTIALS.map((p) => p.ratio);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b), 'listed low to high');
  assert.ok(ratios.includes(0.5), 'the hum, an octave below the prime');
  assert.ok(ratios.includes(1.2), 'the tierce — a minor third, and the whole character');
  // Not a harmonic series: if it were, it would be a note.
  assert.ok(ratios.some((r) => Math.abs(r - Math.round(r * 2) / 2) > 0.01 || r === 1.2));
  // Higher partials die first.
  for (let i = 1; i < BELL_PARTIALS.length; i++) {
    assert.ok(BELL_PARTIALS[i].decay < BELL_PARTIALS[i - 1].decay, `partial ${i}`);
  }
  assert.ok(BELL_DB > REF_DB, 'the loudest thing in the building, on purpose');
  assert.ok(BELL_HZ > 200 && BELL_HZ < 2000);
  assert.ok(BELL_RINGS >= 2);
});

test('the PA is a telephone-band device playing a descending triad', () => {
  assert.equal(PA_CHIME.length, 3);
  assert.deepEqual(PA_CHIME, [...PA_CHIME].sort((a, b) => b - a), 'descending');
  assert.ok(PA_BAND.lo >= 250 && PA_BAND.hi <= 4000, 'which is why it sounds like a PA');
  // The catalog agrees that a PA speaker is one.
  assert.equal(catalogEntry('speaker-pa').sound.kind, 'pa');
  assert.equal(catalogEntry('speaker-ceiling').sound.kind, 'pa');
});
