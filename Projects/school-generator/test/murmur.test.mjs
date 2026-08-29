// The crowd as sound: emitters derived from who is where, the room tone, and
// the PA's script. Two kinds of test, per the house rule: hand-built rooms
// and agents for the properties (the levels' arithmetic, the kinds, the
// clustering), and one simulation on the sample school, because an emitter
// derivation is only as honest as the agent states its tests put it in.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MURMUR_KINDS, MURMUR_VOICES, MOUTH_H, RUSH_CELL, RUSH_MIN, MURMUR_CAP,
  TALK_DB, LESSON_DB, CHAT_DB,
  murmurDb, murmurKindFor, murmurEmitters, roomToneSpec, paScript,
  SCHOOL_NAMES,
} from '../js/murmur.js';
import { budgetSounds, FLOOR_DB } from '../js/sound.js';
import { defaultSchedule, blocks, normalizeSchedule } from '../js/schedule.js';
import { buildSampleSchool } from '../js/sample.js';
import { catalogEntry } from '../js/catalog.js';
import { buildCollider } from '../js/collide.js';
import { terrainField } from '../js/terrain.js';
import { buildNav } from '../js/navgraph.js';
import { buildingOccupancy } from '../js/occupancy.js';
import { makePopulation, makeContext, retargetAll, stepAgents } from '../js/agents.js';

const SCHED = defaultSchedule();
// A minute inside a class block, and one inside lunch, read off the blocks
// rather than hard-coded, so a changed default schedule moves the tests with it.
const CLASS_MIN = blocks(SCHED).find((b) => b.kind === 'class' && b.index === 2).start + 5;
const LUNCH_MIN = blocks(SCHED).find((b) => b.kind === 'lunch').start + 5;
const PASSING_MIN = blocks(SCHED).find((b) => b.kind === 'passing' && b.index === 2).start + 1;

// A hand-built room row, in occupancy.js's shape — the fields murmur reads.
const room = (id, use, opts = {}) => ({
  id, use, floor: opts.floor ?? 0, x: opts.x ?? 50, z: opts.z ?? 50,
  name: opts.name ?? id, area: opts.area ?? 800,
});

// A hand-built agent, in agents.js's shape — the fields murmur reads.
const agent = (id, state, opts = {}) => ({
  id, state,
  x: opts.x ?? 50, z: opts.z ?? 50, floorIndex: opts.floor ?? 0,
  goal: opts.goal ?? null, home: opts.home ?? null, chat: opts.chat ?? null,
});

// ---------- the levels ----------

test('a crowd sums like a crowd: +3 dB per doubling of heads', () => {
  for (const kind of ['chatter', 'gym', 'rush']) {
    const one = murmurDb(kind, 8);
    const two = murmurDb(kind, 16);
    assert.ok(Math.abs((two - one) - 3.01) < 0.1, `${kind}: ${two - one} dB per doubling`);
  }
});

test('a lesson is one voice, and thirty listeners barely raise it', () => {
  const five = murmurDb('lesson', 5);
  const thirty = murmurDb('lesson', 30);
  assert.ok(thirty > five, 'a bigger class rustles more');
  assert.ok(thirty - five < 4, 'but a lecture never sums like a cafeteria');
  assert.ok(five >= LESSON_DB, 'never quieter than the teacher alone');
});

test('two people talking is a fixed, modest level', () => {
  assert.equal(murmurDb('chat', 2), CHAT_DB);
  assert.ok(CHAT_DB < TALK_DB + 3.5, 'a chat is quieter than a room chattering');
});

test('the kinds: the gym is always the gym; class is a lesson; lunch is chatter', () => {
  assert.equal(murmurKindFor('gym', 'class'), 'gym');
  assert.equal(murmurKindFor('gym', 'lunch'), 'gym');
  assert.equal(murmurKindFor('classroom', 'class'), 'lesson');
  assert.equal(murmurKindFor('lab', 'class'), 'lesson');
  assert.equal(murmurKindFor('classroom', 'lunch'), 'chatter');
  assert.equal(murmurKindFor('assembly-tables', 'homeroom'), 'chatter');
  for (const use of ['classroom', 'gym', 'lab']) {
    for (const block of ['class', 'lunch', 'passing']) {
      assert.ok(MURMUR_KINDS.includes(murmurKindFor(use, block)));
    }
  }
});

// ---------- the emitters ----------

test('a seated class is one lesson emitter, at the room, with the headcount', () => {
  const rooms = [room('r1', 'classroom', { x: 30, z: 40 })];
  const agents = Array.from({ length: 24 }, (_, i) => agent(i + 1, 'sit', { goal: 'r1' }));
  const out = murmurEmitters(rooms, agents, SCHED, CLASS_MIN, { floorHt: 12 });
  assert.equal(out.length, 1);
  const e = out[0];
  assert.equal(e.kind, 'lesson');
  assert.equal(e.count, 24);
  assert.equal(e.x, 30);
  assert.equal(e.z, 40);
  assert.equal(e.y, MOUTH_H, 'ground storey, mouth height');
  assert.equal(e.room, 'r1');
  assert.equal(e.db, murmurDb('lesson', 24));
  assert.equal(e.hz, MURMUR_VOICES.lesson.hz);
  assert.ok(e.loop, 'a murmur is a continuous source');
  assert.equal(e.id, 'mur:0:r1', 'the id is stable frame to frame');
});

test('the same room at lunch is chatter, and louder for the crowd it holds', () => {
  const rooms = [room('caf', 'assembly-tables')];
  const few = Array.from({ length: 10 }, (_, i) => agent(i + 1, 'sit', { goal: 'caf' }));
  const many = Array.from({ length: 80 }, (_, i) => agent(i + 1, 'sit', { goal: 'caf' }));
  const a = murmurEmitters(rooms, few, SCHED, LUNCH_MIN)[0];
  const b = murmurEmitters(rooms, many, SCHED, LUNCH_MIN)[0];
  assert.equal(a.kind, 'chatter');
  assert.equal(b.kind, 'chatter');
  assert.ok(b.db - a.db > 8, 'eight times the crowd is about nine dB');
});

test('idle bodies count toward their room; out and riding count nowhere', () => {
  const rooms = [room('r1', 'classroom')];
  const agents = [
    agent(1, 'sit', { goal: 'r1' }),
    agent(2, 'idle', { goal: null, home: 'r1' }),
    agent(3, 'out', { goal: 'r1' }),
    agent(4, 'ride', { goal: 'r1' }),
    agent(5, 'sit', { goal: 'nowhere' }),   // a goal the building no longer has
  ];
  const out = murmurEmitters(rooms, agents, SCHED, CLASS_MIN);
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 2);
});

test('walkers cluster into rush knots, and a knot needs three', () => {
  const two = [
    agent(1, 'walk', { x: 10, z: 10 }),
    agent(2, 'walk', { x: 12, z: 10 }),
  ];
  assert.equal(murmurEmitters([], two, SCHED, PASSING_MIN).length, 0,
    'two walkers are not a crowd');
  const five = Array.from({ length: 5 }, (_, i) =>
    agent(i + 1, 'walk', { x: 8 + i, z: 10 }));
  const out = murmurEmitters([], five, SCHED, PASSING_MIN);
  assert.equal(out.length, 1);
  const e = out[0];
  assert.equal(e.kind, 'rush');
  assert.equal(e.count, 5);
  assert.equal(e.x, 10, 'the emitter sits at the knot\'s centroid');
  assert.equal(e.db, murmurDb('rush', 5));
  // A queue at a lift is a knot of people too.
  const queue = Array.from({ length: 4 }, (_, i) =>
    agent(i + 1, 'queue', { x: 8, z: 10 }));
  assert.equal(murmurEmitters([], queue, SCHED, CLASS_MIN)[0].kind, 'rush');
});

test('knots on different storeys never merge', () => {
  const agents = [
    ...Array.from({ length: 3 }, (_, i) => agent(i + 1, 'walk', { x: 10, z: 10, floor: 0 })),
    ...Array.from({ length: 3 }, (_, i) => agent(i + 4, 'walk', { x: 10, z: 10, floor: 1 })),
  ];
  const out = murmurEmitters([], agents, SCHED, PASSING_MIN, { floorHt: 12 });
  assert.equal(out.length, 2);
  const floors = out.map((e) => e.floor).sort();
  assert.deepEqual(floors, [0, 1]);
  const upper = out.find((e) => e.floor === 1);
  assert.equal(upper.y, 12 + MOUTH_H);
});

test('a chatting pair is one emitter, at their midpoint, once', () => {
  const agents = [
    agent(7, 'chat', { x: 10, z: 10, chat: { with: 9, t: 2, x: 14, z: 10 } }),
    agent(9, 'chat', { x: 14, z: 10, chat: { with: 7, t: 2, x: 10, z: 10 } }),
  ];
  const out = murmurEmitters([], agents, SCHED, PASSING_MIN);
  assert.equal(out.length, 1, 'a pair emits once, not twice');
  const e = out[0];
  assert.equal(e.kind, 'chat');
  assert.equal(e.x, 12);
  assert.equal(e.count, 2);
  assert.equal(e.id, 'chat:7~9');
});

test('the emitters ride the existing budget as ordinary sources', () => {
  const rooms = [room('r1', 'classroom', { x: 10, z: 10 })];
  const agents = Array.from({ length: 20 }, (_, i) => agent(i + 1, 'sit', { goal: 'r1' }));
  const emitters = murmurEmitters(rooms, agents, SCHED, CLASS_MIN);
  const ear = { x: 12, y: 5, z: 10, floor: 0, room: 'r1' };
  const b = budgetSounds(emitters, ear);
  assert.equal(b.heard.length, 1, 'a lesson six feet away is heard');
  assert.ok(b.heard[0].db > FLOOR_DB);
});

test('the cap keeps the loudest and the list bounded', () => {
  // Two hundred one-room crowds, all different sizes.
  const rooms = [];
  const agents = [];
  let id = 1;
  for (let r = 0; r < 200; r++) {
    rooms.push(room(`r${r}`, 'classroom', { x: r * 30, z: 0 }));
    for (let i = 0; i < 1 + (r % 30); i++) agents.push(agent(id++, 'sit', { goal: `r${r}` }));
  }
  const out = murmurEmitters(rooms, agents, SCHED, LUNCH_MIN);
  assert.equal(out.length, MURMUR_CAP);
  const kept = Math.min(...out.map((e) => e.count));
  assert.ok(kept >= 21, `the crowds kept are the big ones (smallest kept held ${kept})`);
});

test('an empty school is silent, and junk inputs are nothing rather than a crash', () => {
  assert.deepEqual(murmurEmitters([], [], SCHED, CLASS_MIN), []);
  assert.deepEqual(murmurEmitters(null, null, null, 0), []);
});

// ---------- room tone ----------

test('a bigger room breathes more air, and a soft one swallows it', () => {
  const hard = roomToneSpec({ volume: 40000, meanAlpha: 0.08 });
  const small = roomToneSpec({ volume: 3000, meanAlpha: 0.08 });
  const soft = roomToneSpec({ volume: 40000, meanAlpha: 0.4 });
  assert.ok(hard.gain > small.gain, 'volume carries the plant');
  assert.ok(hard.gain > soft.gain, 'absorption quiets the bed');
  assert.ok(hard.hz > soft.hz, 'absorption dulls it too');
  for (const t of [hard, small, soft]) {
    assert.ok(t.gain >= 0.2 && t.gain <= 1.2);
    assert.ok(t.hz >= 160 && t.hz <= 360);
  }
});

test('outdoors has no room tone', () => {
  assert.equal(roomToneSpec({ volume: 0, meanAlpha: 0 }), null);
  assert.equal(roomToneSpec(null), null);
});

// ---------- the PA's script ----------

test('the announcement is deterministic for a seed and a date', () => {
  const opts = { date: new Date(2026, 7, 28), rooms: ['Room 101', 'Gym', 'Library'] };
  const a = paScript(7, opts);
  const b = paScript(7, opts);
  assert.deepEqual(a, b);
  assert.ok(a.lines.length >= 3);
  for (const line of a.lines) assert.ok(typeof line === 'string' && line.length > 0);
});

test('it says the school\'s name, the date, and a room the building actually has', () => {
  const s = paScript(3, {
    school: 'Kestrel Ridge High',
    date: new Date(2026, 7, 28),           // a Friday in August
    rooms: ['Room 204'],
  });
  assert.equal(s.school, 'Kestrel Ridge High');
  assert.ok(s.lines[0].includes('Kestrel Ridge High'));
  assert.ok(s.lines.some((l) => l.includes('Friday') && l.includes('August 28')));
  assert.ok(s.lines.some((l) => l.includes('Room 204')));
});

test('a school nobody named gets one from the seed, the same one every morning', () => {
  const a = paScript(5, {});
  const b = paScript(5, {});
  assert.equal(a.school, b.school);
  assert.ok(SCHOOL_NAMES.some((n) => a.school.startsWith(n)));
});

test('no rooms means a shorter announcement, not a broken one', () => {
  const s = paScript(1, { date: new Date(2026, 7, 28), rooms: [] });
  assert.ok(s.lines.length >= 3, 'greeting, date, sign-off');
  assert.ok(s.lines[s.lines.length - 1].includes('day'));
});

test('the drill announcement is the drill announcement', () => {
  const s = paScript(1, { kind: 'drill' });
  assert.ok(s.lines.some((l) => /fire drill/i.test(l)));
  assert.ok(s.lines.some((l) => /exit/i.test(l)));
});

// ---------- the simulation ----------

test('the sample school in session murmurs where its people are', () => {
  const state = buildSampleSchool();
  const nav = buildNav(state);
  const site = terrainField(state);
  const colliders = new Map();
  const colliderFor = (i) => {
    let c = colliders.get(i);
    if (!c) { c = buildCollider(state, i, catalogEntry, { site }); colliders.set(i, c); }
    return c;
  };
  const schedule = normalizeSchedule(SCHED);
  const agents = makePopulation(state, nav, { seed: 5, students: 40, schedule });
  const ctx = makeContext(state, nav, {
    site, schedule, colliderFor, catalogGet: catalogEntry, minutes: CLASS_MIN,
  });
  retargetAll(ctx, agents);
  for (let t = 0; t < 90 * 30; t++) stepAgents(ctx, agents, 1 / 30);

  const occ = buildingOccupancy(state, { nav });
  const settled = murmurEmitters(occ.rooms, agents, schedule, CLASS_MIN, {
    floorHt: state.floorHt,
  });
  assert.ok(settled.length > 0, 'a school in session makes noise');
  const roomIds = new Set(occ.rooms.map((r) => r.id));
  for (const e of settled) {
    assert.ok(MURMUR_KINDS.includes(e.kind));
    assert.ok(Number.isFinite(e.db) && e.db > 0);
    assert.ok(e.loop);
    if (e.room !== null) assert.ok(roomIds.has(e.room), 'a room emitter names a real room');
  }
  assert.ok(settled.some((e) => e.kind === 'lesson' || e.kind === 'chat'),
    'a class block sounds like teaching');

  // Ring the bell: the corridors get their rush.
  ctx.minutes = PASSING_MIN;
  retargetAll(ctx, agents);
  let rushed = false;
  for (let t = 0; t < 20 * 30 && !rushed; t++) {
    stepAgents(ctx, agents, 1 / 30);
    const now = murmurEmitters(occ.rooms, agents, schedule, PASSING_MIN, {
      floorHt: state.floorHt,
    });
    rushed = now.some((e) => e.kind === 'rush');
  }
  assert.ok(rushed, 'a forty-student passing period fills a corridor cell somewhere');
});
