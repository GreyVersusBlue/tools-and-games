// The night's clock. Pure module, so the whole descent runs headless: the
// record a save carries, the stages and their ratchet, the knobs, the
// writings, the crash and the way out.
//
// The claims worth holding are the WISHLIST's two invariants — the crowd and
// the creature never share a frame, and the stages only ratchet forward —
// plus the one every set piece leans on: the same seed makes the same night.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav, egressField } from '../js/navgraph.js';
import { shapeAt } from '../js/shapes.js';
import {
  DEFAULT_HAUNT, normalizeHaunt, isDefaultHaunt,
  STAGES, STAGE_TIMES, stageFor, stageKnobs, HAUNT_COUNT, HAUNT_ITEM,
  hash01, flickerAt,
  WRITINGS, WRITING_MIN_RUN, WRITING_W, writingPlaces,
  CRASH_S, crashCurve,
  slamCandidate, respawnPoint, banishNode, escapeDoor, ESCAPE_SPREAD,
  LOCKED_TEXT,
} from '../js/haunt.js';

const school = () => buildSampleSchool(createState(40, 40));

// ---------- the record ----------

test('the record normalizes to off, and hostile input to a night that opens', () => {
  assert.deepEqual(normalizeHaunt(null), DEFAULT_HAUNT);
  assert.deepEqual(normalizeHaunt({}), DEFAULT_HAUNT);
  assert.equal(normalizeHaunt({ on: 'yes' }).on, false, 'on is true or it is nothing');
  const h = normalizeHaunt({ on: true, seed: 7.9, intensity: 3 });
  assert.equal(h.on, true);
  assert.equal(h.seed, 8, 'seed is an integer');
  assert.equal(h.intensity, 1, 'intensity clamps to 0..1');
  assert.equal(normalizeHaunt({ on: true, seed: -5 }).seed, 1);
  assert.equal(normalizeHaunt({ on: true, intensity: NaN }).intensity, 0.5);
});

test('an off haunt is the default, and writes no key', () => {
  assert.ok(isDefaultHaunt(null));
  assert.ok(isDefaultHaunt(undefined));
  assert.ok(isDefaultHaunt({ on: false, seed: 99, intensity: 1 }),
    'the seed of a night nobody armed is not worth a byte');
  assert.ok(!isDefaultHaunt({ on: true }));
});

// ---------- the stages ----------

test('the descent starts at day and flight is an achievement, never an ambush', () => {
  const h = { on: true, seed: 1, intensity: 0.5 };
  assert.equal(stageFor(h, { finds: 0, total: 6, elapsed: 0 }).key, 'day');
  // Time alone reaches company and stops there — the objective must be met.
  const stalled = stageFor(h, { finds: 0, total: 6, elapsed: 1e6 });
  assert.equal(stalled.key, 'company');
  // All found is flight, however fast it happened.
  assert.equal(stageFor(h, { finds: 6, total: 6, elapsed: 1 }).key, 'flight');
});

test('the stages ratchet: monotone in finds and in time, with t inside 0..1', () => {
  const h = { on: true, seed: 3, intensity: 0.5 };
  const total = HAUNT_COUNT;
  let prevByElapsed = -1;
  for (let finds = 0; finds <= total; finds++) {
    let prev = -1;
    for (let elapsed = 0; elapsed <= 1200; elapsed += 30) {
      const s = stageFor(h, { finds, total, elapsed });
      assert.ok(s.index >= prev, `time went forward and the stage went back at ${finds}/${elapsed}`);
      assert.ok(s.t >= 0 && s.t <= 1, `t out of range at ${finds}/${elapsed}`);
      prev = s.index;
      // And monotone in finds at fixed elapsed, checked on the first column.
      if (elapsed === 0) {
        assert.ok(s.index >= prevByElapsed, `a find took the stage back at ${finds}`);
        prevByElapsed = s.index;
      }
    }
  }
  // Intensity is a throttle on the clock: the harder night is never behind.
  for (let elapsed = 0; elapsed <= 1200; elapsed += 60) {
    const soft = stageFor({ on: true, seed: 1, intensity: 0.1 }, { finds: 0, total, elapsed });
    const hard = stageFor({ on: true, seed: 1, intensity: 0.9 }, { finds: 0, total, elapsed });
    assert.ok(hard.index >= soft.index, `intensity slowed the night at ${elapsed}`);
  }
});

test('the crowd and the creature never share a frame, at any stage and any t', () => {
  const h = { on: true, seed: 5, intensity: 0.7 };
  for (let i = 0; i < STAGES.length; i++) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const k = stageKnobs(i, t, h);
      assert.ok(!(k.crowd && k.creature), `${STAGES[i]}@${t}: both in the building`);
      assert.ok(k.lampScale > 0 && k.lampScale <= 1, `${STAGES[i]}@${t}: lampScale`);
      assert.ok(k.writings >= 0 && k.writings <= 1, `${STAGES[i]}@${t}: writings`);
      assert.ok(k.flickerDepth >= 0 && k.flickerDepth < 1, `${STAGES[i]}@${t}: depth`);
      if (k.chaseArmed) assert.ok(k.creature, 'nothing chases that is not here');
      if (k.lockExits) assert.equal(STAGES[i], 'flight', 'only the flight locks doors');
    }
  }
  // Day is pristine — the demo has to be innocent to the last pixel.
  const day = stageKnobs(0, 0.5, h);
  assert.ok(day.crowd && !day.creature && !day.chaseArmed && !day.lockExits);
  assert.equal(day.flickerDepth, 0);
  assert.equal(day.detuneCents, 0);
  assert.equal(day.sunMinutes, null, 'the design keeps its own sky');
  // Flight says the one line.
  assert.equal(stageKnobs(4, 0, h).hud, 'Get out.');
});

// ---------- the flicker ----------

test('the flicker is a curve, not a coin: deterministic, bounded, worst at the failing fixture', () => {
  const h = { on: true, seed: 11, intensity: 0.8 };
  const k = stageKnobs(3, 0.5, h);
  assert.equal(flickerAt(k, 12.34, 3), flickerAt(k, 12.34, 3), 'same args, same light');
  assert.equal(flickerAt(stageKnobs(0, 0.5, h), 12.34, 3), 1, 'day does not flicker');
  let dipsFailing = 0, dipsOther = 0;
  const other = (k.failing + 1) % 12;
  for (let t = 0; t < 240; t += 0.25) {
    const f = flickerAt(k, t, k.failing);
    const o = flickerAt(k, t, other);
    assert.ok(f > 0 && f <= 1 && o > 0 && o <= 1, 'bounded');
    if (f < 1) dipsFailing++;
    if (o < 1) dipsOther++;
  }
  assert.ok(dipsFailing > dipsOther, 'the failing fixture fails hardest');
  assert.ok(dipsOther > 0, 'but nothing is steady at company');
  // The room dips shallower than any one fixture, so spill dies with its
  // lights rather than before them.
  for (let t = 0; t < 60; t += 0.5) {
    assert.ok(flickerAt(k, t, -1) >= 1 - k.flickerDepth * (0.4 + 0.6), 'ambient stays shallow');
  }
});

// ---------- the writings ----------

test('the writings land on real walls, one per room, the same night every time', () => {
  const s = school();
  const places = writingPlaces(s, 9);
  assert.ok(places.length >= 8, `a school has walls to write on (got ${places.length})`);
  const rooms = new Set();
  for (const p of places) {
    assert.ok(!rooms.has(`${p.floor}:${p.room}`), 'one writing per room at most');
    rooms.add(`${p.floor}:${p.room}`);
    assert.ok(WRITINGS.includes(p.text), 'the set is authored, never improvised');
    assert.ok(p.w > 0 && p.w <= WRITING_W);
    assert.ok(Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-9, 'unit normal');
    // The inset put it inside the room it claims.
    const at = shapeAt(s.floors[p.floor], p.x, p.z);
    assert.ok(at && at.id === p.room, `writing floats outside its room at ${p.x},${p.z}`);
  }
  assert.deepEqual(writingPlaces(s, 9), places, 'the same seed writes the same walls');
  assert.notDeepEqual(writingPlaces(s, 10).map((p) => p.text), places.map((p) => p.text),
    'a different seed is a different night');
  // The reveal order is the deal order.
  places.forEach((p, i) => assert.equal(p.order, i));
});

// ---------- the crash ----------

test('the crash tears, rolls, goes black with the card, and wakes', () => {
  const phases = [];
  for (let t = 0; t <= CRASH_S + 0.01; t += 0.05) {
    const c = crashCurve(t);
    assert.ok(c.noise >= 0 && c.noise <= 1);
    assert.ok(c.bars >= 0);
    if (phases[phases.length - 1] !== c.phase) phases.push(c.phase);
    if (c.text) assert.equal(c.phase, 'black', 'the card shows on black, nowhere else');
  }
  assert.deepEqual(phases, ['tear', 'static', 'black', 'wake']);
  assert.ok(crashCurve(1.5).text, 'there is one honest second of error card');
  assert.equal(crashCurve(CRASH_S).noise, 0, 'and it ends clean');
});

// ---------- the slam ----------

test('a doorway is slammed by crossing it, not by walking past it', () => {
  const door = { x: 10, z: 0, nx: 0, nz: 1, w: 3 };
  assert.equal(slamCandidate([door], { x: 10, z: -1 }, { x: 10.4, z: 1 }), door,
    'through the middle');
  assert.equal(slamCandidate([door], { x: 30, z: -1 }, { x: 30, z: 1 }), null,
    'through the wall ten feet along is not this door');
  assert.equal(slamCandidate([door], { x: 9, z: 1 }, { x: 11, z: 2 }), null,
    'walking past on one side crosses nothing');
  assert.equal(slamCandidate(null, { x: 0, z: 0 }, { x: 1, z: 1 }), null);
});

// ---------- where you come back, and the way out ----------

test('the respawn is just inside a door, the banished creature is far away', () => {
  const s = school();
  const nav = buildNav(s);
  const field = egressField(nav);
  assert.ok(nav.exits.length >= 2, 'the fixture needs more than one way out');
  const spawn = { x: nav.exits[0].pa.x, z: nav.exits[0].pa.z, floor: 0 };
  const back = respawnPoint(nav, field, spawn);
  assert.ok(nav.roomIdAt(back.floor, back.x, back.z), 'the respawn is indoors');
  const far = banishNode(nav, back);
  assert.ok(far && far.id, 'somewhere to banish to');
  assert.ok(far.dist > 60, `banishment is a long walk, not the next room (${far.dist})`);
});

test('the way out is exterior, distant, seeded — and the locked line is stated once', () => {
  const s = school();
  const nav = buildNav(s);
  const from = { x: nav.exits[0].pa.x, z: nav.exits[0].pa.z, floor: 0 };
  const a = escapeDoor(nav, from, 21);
  const b = escapeDoor(nav, from, 21);
  assert.ok(a && nav.exits.some((e) => e.id === a.id), 'the way out is a real exterior door');
  assert.equal(a.id, b.id, 'the same seed opens the same door');
  // It is among the ESCAPE_SPREAD farthest by the routed walk: never the door
  // you are standing at, unless the school hardly has doors.
  if (nav.exits.length > ESCAPE_SPREAD) {
    assert.notEqual(a.id, nav.exits[0].id, 'not the door behind you');
  }
  const seeds = new Set();
  for (let seed = 1; seed <= 12; seed++) seeds.add(escapeDoor(nav, from, seed).id);
  if (nav.exits.length >= 3) {
    assert.ok(seeds.size > 1, 'different seeds can open different doors');
  }
  assert.ok(LOCKED_TEXT.includes('locked') && LOCKED_TEXT.includes('another way'));
});

// ---------- the haunted hunt's own constants ----------

test('the haunted hunt deals stars, six of them', () => {
  assert.equal(HAUNT_ITEM.key, 'star');
  assert.ok(HAUNT_ITEM.name && HAUNT_ITEM.icon);
  assert.ok(HAUNT_COUNT >= 3 && HAUNT_COUNT <= 8, 'long enough to learn, short enough to finish scared');
  assert.ok(STAGE_TIMES[STAGE_TIMES.length - 1] === Infinity, 'flight has no timer');
  assert.ok(WRITING_MIN_RUN > 0 && hash01(1) !== hash01(2));
});

// ---------- save v12 ----------

test('a building nobody haunted writes no haunt key, and an armed one survives the trip', async () => {
  const { serialize, deserialize, SAVE_VERSION } = await import('../js/save-load.js');
  assert.equal(SAVE_VERSION, 12);
  const s = createState(10, 10);
  assert.ok(!('haunt' in JSON.parse(serialize(s))), 'no haunt, no key');
  s.haunt = { on: false, seed: 40, intensity: 0.9 };
  assert.ok(!('haunt' in JSON.parse(serialize(s))), 'an off haunt is no haunt');
  s.haunt = { on: true, seed: 7, intensity: 0.8 };
  const back = deserialize(serialize(s));
  assert.deepEqual(back.haunt, { on: true, seed: 7, intensity: 0.8 });
  assert.equal(back.version, 12);
});

test('a v11 file loads hauntless, and a hostile haunt normalizes or vanishes', async () => {
  const { deserialize } = await import('../js/save-load.js');
  const v11 = deserialize(JSON.stringify({
    version: 11, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [],
  }));
  assert.equal(v11.haunt, undefined);
  const hostile = deserialize(JSON.stringify({
    version: 12, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [],
    haunt: { on: true, seed: 'DROP TABLE', intensity: 99, extra: 'x' },
  }));
  assert.deepEqual(hostile.haunt, { on: true, seed: 1, intensity: 1 },
    'unreadable fields default, unknown fields drop');
  const offHostile = deserialize(JSON.stringify({
    version: 12, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [],
    haunt: { on: 'maybe' },
  }));
  assert.equal(offHostile.haunt, undefined, 'an unreadable haunt is no haunt at all');
});
