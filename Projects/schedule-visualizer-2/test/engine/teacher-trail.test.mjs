// A teacher's own movement through a day (SV2-151; ARCHITECTURE 23.6 as
// revised by 23.12): engine/teacher-trail.js.
//
// A small building of three rooms on one corridor and one teacher, whose
// classes each case lays out period by period; the figures come from the
// real pipeline's walks (runResults), so "equal to walks.teachers" is
// asserted against the engine's own answer and not against a copy of it.
// The grown fixture (test/fixtures/big.mjs) holds the same line over every
// teacher at once. Nothing here reads the clock or the zone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { routingGraph, createRouteCache } from '../../engine/routing.js';
import { teacherRoute, teacherWalks, walkingSeconds } from '../../engine/crowd.js';
import { createPipeline, runResults } from '../../engine/worker.js';
import { teacherTrail } from '../../engine/teacher-trail.js';
import { emptySlot, emptyBells } from '../../engine/schema.js';
import { assertValid } from './helpers.mjs';
import { planProject, roomId } from '../fixtures/buildings/plans.mjs';
import { runsOf } from '../../engine/runs.js';
import { bigRunsProject } from '../timing/big-runs.mjs';

const VERSIONS = { geometry: 1, building: 1, schedule: 1 };
const TEACHER = 'tplan00001';
const PERIODS = 7;

function bellTime(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

// periods of 40 minutes with 4 between, from 08:00
function bells(periods) {
  return Array.from({ length: periods }, (unused, p) => ({ start: bellTime(480 + p * 44), end: bellTime(480 + p * 44 + 40) }));
}

// every own day type gets these bells; one that is the same as another has none of its own
function setBells(project, list) {
  for (const dayType of project.dayTypes) dayType.bells = dayType.own ? list.map((bell) => (bell ? { ...bell } : bell)) : emptyBells(PERIODS);
}

// One teacher on the corridor of three rooms. `layout` is, for each period,
// the places taught in it: a room number ('1A'), or { text: '310' } for a
// room that is not in the building. An empty list is a free period. Each place
// is a group of its own, named by the teacher.
function lessons(layout, options) {
  const opts = options || {};
  const project = planProject([['.AAA.BBB.CCC.', '#############']]);
  project.settings.periods = PERIODS;
  setBells(project, bells(PERIODS));
  project.teachers = [{ id: TEACHER, name: opts.name || 'Ms. Okafor', subjectId: null, roomIds: [], notes: '' }];
  if (opts.away) project.teachers[0].away = opts.away;
  const dayId = project.dayTypes[0].id;
  const groups = [];
  layout.forEach((places, period) => {
    for (const place of places) {
      const slot = typeof place === 'string' ? { ...emptySlot(), room: roomId(place), teacherIds: [TEACHER] } : { ...emptySlot(), roomText: place.text, teacherIds: [TEACHER] };
      groups.push({ period, slot });
    }
  });
  project.groups = groups.map(({ period, slot }, index) => {
    const day = Array.from({ length: PERIODS }, () => emptySlot());
    day[period] = slot;
    return { id: 'gplan' + String(index + 1).padStart(5, '0'), name: '7-' + (index + 1), grade: '', headCount: null, colour: '#3366cc', days: { [dayId]: day } };
  });
  if (opts.bellSchedules) project.bellSchedules = opts.bellSchedules;
  assertValid(project);
  return project;
}

function answer(project) {
  return createPipeline().run(project, VERSIONS);
}

function trailOf(project, options) {
  const results = answer(project);
  const dayTypeId = (options && options.dayTypeId) || project.dayTypes[0].id;
  const bellsId = (options && options.bellsId) || null;
  const run = runResults(results, dayTypeId, bellsId);
  return { results, run, trail: teacherTrail(project, null, { teacherId: TEACHER, dayTypeId, bellsId, walks: run.walks.teachers, ...(options || {}) }) };
}

// ---- stops

test('stops: one per period, rooms and groups as the teacher\'s day has them, planning periods with none', () => {
  const project = lessons([['1A'], [], ['1B'], [], [], [], []]);
  const { trail } = trailOf(project);
  assert.equal(trail.teacherId, TEACHER);
  assert.equal(trail.bellsId, null);
  assert.equal(trail.stops.length, PERIODS);
  assert.deepEqual(trail.stops.map((stop) => stop.period), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(trail.stops[0], { period: 0, kind: 'teaching', marked: null, rooms: [{ roomId: roomId('1A'), roomText: '' }], groupIds: ['gplan00001'] });
  assert.deepEqual(trail.stops[1], { period: 1, kind: 'planning', marked: null, rooms: [], groupIds: [] });
  assert.equal(trail.stops[2].rooms[0].roomId, roomId('1B'));
});

test('an unknown teacher or day type gives null', () => {
  const project = lessons([['1A']]);
  assert.equal(teacherTrail(project, null, { teacherId: 'tnobody', dayTypeId: project.dayTypes[0].id }), null);
  assert.equal(teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: 'dnowhere' }), null);
});

// ---- consecutive walks

test('consecutive: two periods in a row in two rooms is one walk, its figures copied from walks.teachers', () => {
  const project = lessons([['1A'], ['1B'], ['1B'], [], [], [], []]);
  const { trail, run } = trailOf(project);
  assert.equal(run.walks.teachers.length, 1, 'the run has the one walk');
  assert.equal(trail.walks.length, 1);
  const [walk] = trail.walks;
  const figure = run.walks.teachers[0];
  assert.equal(walk.period, 0);
  assert.equal(walk.toPeriod, 1);
  assert.deepEqual(walk.across, []);
  assert.equal(walk.fromRoomId, roomId('1A'));
  assert.equal(walk.toRoomId, roomId('1B'));
  assert.equal(walk.walking, figure.walking);
  assert.equal(walk.riding, 0);
  assert.equal(walk.late, figure.late);
  assert.equal(walk.failed, false);
  assert.equal(walk.passingSeconds, figure.passingSeconds);
  assert.equal(walk.passingSeconds, 240, 'the bells\' 4 minutes');
  assert.ok(walk.walking > 0);
});

test('consecutive: the route is the one teacherWalks routed, by teacherRoute', () => {
  const project = lessons([['1A'], ['1C'], [], [], [], [], []]);
  const { trail } = trailOf(project);
  const graph = routingGraph(project);
  const found = teacherRoute(graph, roomId('1A'), roomId('1C'));
  assert.deepEqual(trail.walks[0].route, found);
  assert.equal(trail.walks[0].walking, walkingSeconds(graph, found), 'and its figure is that route\'s own time');
});

test('consecutive: the same room in two periods is no walk', () => {
  const { trail } = trailOf(lessons([['1A'], ['1A'], ['1A'], [], [], [], []]));
  assert.deepEqual(trail.walks, []);
});

test('a walk that is too long for the passing time is late, as walks.teachers says', () => {
  const project = lessons([['1A'], ['1C'], [], [], [], [], []]);
  project.settings.defaultPassingSeconds = 3;
  setBells(project, emptyBells(PERIODS));
  const { trail, run } = trailOf(project);
  assert.equal(run.walks.teachers[0].late, true);
  assert.equal(trail.walks[0].late, true);
  assert.equal(trail.walks[0].passingSeconds, 3);
});

test('a walk the building gives no way through is failed and late, with no time, and still drawn as a failed route', () => {
  const project = planProject([['A#####B', '.......', '..C....']]);
  project.settings.periods = PERIODS;
  setBells(project, bells(PERIODS));
  project.teachers = [{ id: TEACHER, name: 'Mx. Tarn', subjectId: null, roomIds: [], notes: '' }];
  const dayId = project.dayTypes[0].id;
  project.groups = [['1A', 0], ['1C', 1]].map(([room, period], index) => {
    const day = Array.from({ length: PERIODS }, () => emptySlot());
    day[period] = { ...emptySlot(), room: roomId(room), teacherIds: [TEACHER] };
    return { id: 'gplan' + String(index + 1).padStart(5, '0'), name: 'G' + index, grade: '', headCount: null, colour: '#3366cc', days: { [dayId]: day } };
  });
  assertValid(project);
  const { trail, run } = trailOf(project);
  assert.equal(run.walks.teachers[0].failed, true);
  const [walk] = trail.walks;
  assert.equal(walk.route.ok, false);
  assert.equal(walk.failed, true);
  assert.equal(walk.late, true);
  assert.equal(walk.walking, null);
});

// ---- figures and matching

test('figures: no walks handed in, or none that matches, leaves the route and no figure', () => {
  const project = lessons([['1A'], ['1B'], [], [], [], [], []]);
  const { run } = trailOf(project);
  const none = { walking: null, riding: null, late: null, failed: null };
  const pick = (walk) => ({ walking: walk.walking, riding: walk.riding, late: walk.late, failed: walk.failed });

  const nothing = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id });
  assert.deepEqual(pick(nothing.walks[0]), none, 'no walks option');
  assert.equal(nothing.walks[0].route.ok, true, 'the route is drawn all the same');

  const [real] = run.walks.teachers;
  for (const [what, changed] of [
    ['another teacher', { ...real, teacherId: 'tsomebody' }],
    ['another period', { ...real, period: 3 }],
    ['another room to', { ...real, toRoomId: roomId('1C') }],
    ['another room from', { ...real, fromRoomId: roomId('1C') }],
    ['another passing time', { ...real, passingSeconds: real.passingSeconds + 60 }],
  ]) {
    const trail = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, walks: [changed] });
    assert.deepEqual(pick(trail.walks[0]), none, what + ' is not the walk');
  }

  const matched = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, walks: [real] });
  assert.equal(matched.walks[0].walking, real.walking, 'the right one is');
  const wrapped = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, walks: { teachers: [real] } });
  assert.equal(wrapped.walks[0].walking, real.walking, 'and the walks object of runResults is read too');
});

test('figures: a ride is kept as the entry has it', () => {
  const project = lessons([['1A'], ['1B'], [], [], [], [], []]);
  const { run } = trailOf(project);
  const trail = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, walks: [{ ...run.walks.teachers[0], riding: 14 }] });
  assert.equal(trail.walks[0].riding, 14);
});

// The sample and the fixture have teachers with one room each and so no walks
// at all. Every second teacher here takes a second room (the next of a spread
// through the building), which gives them walks to route and to time
// (test/engine/crowd-routes.test.mjs does the same).
function withTeacherWalks(project) {
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  project.teachers.forEach((teacher, i) => {
    if (i % 2) return;
    const other = rooms[(i * 7 + 3) % rooms.length];
    if (!other || teacher.roomIds.includes(other.id)) return;
    teacher.roomIds.push(other.id);
    other.teacherIds = [...(other.teacherIds || []), teacher.id];
  });
  return project;
}

test('figures equal walks.teachers for every teacher of the grown fixture, in the regular runs and the bell schedules\' runs, walk for walk', () => {
  const project = withTeacherWalks(bigRunsProject());
  const results = answer(project);
  const graph = routingGraph(project);
  const runs = runsOf(project).filter((run) => run.dayTypeId === project.dayTypes[0].id || run.dayTypeId === project.dayTypes[1].id);
  assert.ok(runs.some((run) => run.bellsId !== null), 'a bell schedule\'s run is among them');
  let total = 0;
  for (const run of runs) {
    const found = runResults(results, run.dayTypeId, run.bellsId);
    const cache = createRouteCache(16);
    let walked = 0;
    for (const teacher of project.teachers) {
      const trail = teacherTrail(project, graph, { teacherId: teacher.id, dayTypeId: run.dayTypeId, bellsId: run.bellsId, walks: found.walks.teachers, cache });
      assert.ok(trail, teacher.name);
      for (const walk of trail.walks.filter((each) => each.across.length === 0)) {
        const entry = found.walks.teachers.find((each) => each.teacherId === teacher.id && each.period === walk.period);
        assert.ok(entry, 'a walk with no entry in walks.teachers');
        assert.equal(entry.toRoomId, walk.toRoomId);
        assert.equal(entry.fromRoomId, walk.fromRoomId);
        assert.equal(walk.failed, entry.failed === true);
        assert.equal(walk.walking, entry.failed === true ? null : entry.walking);
        assert.equal(walk.riding, entry.failed === true ? null : entry.riding || 0);
        assert.equal(walk.late, entry.late);
        assert.equal(walk.passingSeconds, entry.passingSeconds);
        assert.equal(walk.toPeriod, entry.toPeriod === undefined ? entry.period + 1 : entry.toPeriod);
        walked += 1;
      }
    }
    assert.equal(walked, found.walks.teachers.length, 'every entry of walks.teachers is somebody\'s consecutive walk, and nothing else is');
    total += walked;
  }
  assert.ok(total > 100, 'the fixture has teachers who walk between periods: ' + total);
});

// ---- across a free period

test('across: a walk over one free period is dashed in the map\'s words: toPeriod past it, across naming it, timed by walkingSeconds, never late', () => {
  const project = lessons([['1A'], [], ['1C'], [], [], [], []]);
  const { trail, run } = trailOf(project);
  assert.deepEqual(run.walks.teachers, [], 'the pipeline times no walk across a free period');
  assert.equal(trail.walks.length, 1);
  const [walk] = trail.walks;
  assert.equal(walk.period, 0);
  assert.equal(walk.toPeriod, 2);
  assert.deepEqual(walk.across, [1]);
  assert.equal(walk.fromRoomId, roomId('1A'));
  assert.equal(walk.toRoomId, roomId('1C'));
  const graph = routingGraph(project);
  assert.equal(walk.walking, walkingSeconds(graph, teacherRoute(graph, roomId('1A'), roomId('1C'))));
  assert.equal(walk.late, null);
  assert.equal(walk.failed, false);
  assert.equal(walk.riding, null);
  // from the end of period 0 (08:40) to the start of period 2 (09:28): 48 minutes
  assert.equal(walk.passingSeconds, 48 * 60);
});

test('across: two or more free periods are all named', () => {
  const { trail } = trailOf(lessons([['1A'], [], [], ['1B'], [], [], []]));
  assert.equal(trail.walks.length, 1);
  assert.deepEqual(trail.walks[0].across, [1, 2]);
  assert.equal(trail.walks[0].toPeriod, 3);
});

test('across: with no bells entered the passing time is none', () => {
  const project = lessons([['1A'], [], ['1B'], [], [], [], []]);
  setBells(project, emptyBells(PERIODS));
  const { trail } = trailOf(project);
  assert.equal(trail.walks[0].passingSeconds, null);
  assert.ok(trail.walks[0].walking > 0, 'it is still timed');
});

test('across: the same room before and after a free period is no walk', () => {
  assert.deepEqual(trailOf(lessons([['1B'], [], ['1B'], [], [], [], []])).trail.walks, []);
});

test('across and consecutive together, in period order', () => {
  const { trail } = trailOf(lessons([['1A'], ['1B'], [], ['1C'], ['1A'], [], []]));
  assert.deepEqual(trail.walks.map((walk) => [walk.period, walk.toPeriod, walk.across.length]), [[0, 1, 0], [1, 3, 1], [3, 4, 0]]);
});

test('across: a period that is not free between (away from school) draws no walk over it', () => {
  const project = lessons([['1A'], [], ['1C'], [], [], [], []], { away: [{ periods: [1], weekdays: [], dayTypeIds: [] }] });
  const { trail } = trailOf(project);
  assert.equal(trail.stops[1].marked, 'away');
  assert.deepEqual(trail.walks, []);
});

test('across: a period in two rooms ends the walk before it and begins none after it (it is a taught period, not a free one)', () => {
  const { trail } = trailOf(lessons([['1A'], [], ['1B', '1C'], [], ['1A'], [], []]));
  assert.deepEqual(trail.walks, []);
});

// ---- two rooms, a room not in the building

test('two rooms in one period: no walk into or out of it, and the note says so in the sentence of 23.6', () => {
  const project = lessons([['1A'], ['1B', '1C'], ['1A'], [], [], [], []]);
  const { trail, run } = trailOf(project);
  assert.deepEqual(trail.walks, []);
  assert.deepEqual(run.walks.teachers, [], 'the run draws none either');
  assert.deepEqual(trail.notes.map((note) => [note.period, note.kind, note.roomIds]), [[1, 'two-rooms', [roomId('1B'), roomId('1C')]]]);
  assert.equal(trail.notes[0].text, 'In Period 2 Ms. Okafor is in two rooms (1B and 1C), so no walk is drawn to or from it.');
  assert.equal(trail.stops[1].rooms.length, 2);
});

test('three rooms in one period are counted in words and listed with commas', () => {
  const { trail } = trailOf(lessons([['1A', '1B', '1C'], [], [], [], [], [], []]));
  assert.equal(trail.notes[0].text, 'In Period 1 Ms. Okafor is in three rooms (1A, 1B and 1C), so no walk is drawn to or from it.');
});

test('a note is made of parts with the typed names marked, and its text is the parts joined', () => {
  const project = lessons([['1A'], ['1B', '1C'], [], [], [], [], []], { name: 'Dr. <b>"Q"</b> & Sons' });
  const { trail } = trailOf(project);
  const [note] = trail.notes;
  assert.equal(note.parts.map((part) => part.text).join(''), note.text);
  assert.deepEqual(note.parts.filter((part) => part.name).map((part) => part.text), ['Dr. <b>"Q"</b> & Sons', '1B', '1C']);
  assert.match(note.text, /^In Period 2 Dr\. <b>"Q"<\/b> & Sons is in two rooms/);
});

test('a room not in the building: a note that says so, and no walk is drawn to it', () => {
  const project = lessons([['1A'], [{ text: '310' }], ['1B'], [], [], [], []]);
  const { trail, run } = trailOf(project);
  assert.deepEqual(trail.walks, []);
  assert.deepEqual(run.walks.teachers, []);
  assert.deepEqual(trail.notes.map((note) => [note.period, note.kind, note.roomIds]), [[1, 'room-missing', []]]);
  assert.equal(trail.notes[0].text, 'In Period 2 Ms. Okafor is in 310, which is not in the building, so no route can be drawn to it.');
  assert.deepEqual(trail.stops[1].rooms, [{ roomId: null, roomText: '310' }]);
  assert.equal(trail.stops[1].kind, 'teaching');
});

test('a period with a room of the building and one that is not: the walk into the room is drawn, the missing room is noted', () => {
  const { trail, run } = trailOf(lessons([['1A'], ['1B', { text: '310' }], [], [], [], [], []]));
  assert.equal(run.walks.teachers.length, 1);
  assert.equal(trail.walks.length, 1, 'the building\'s room is the walk, as teacherWalks has it');
  assert.deepEqual(trail.notes.map((note) => note.kind), ['room-missing']);
  assert.deepEqual(trail.stops[1].rooms.map((room) => room.roomId), [roomId('1B'), null]);
});

// ---- the bells' off periods

test('a bell schedule\'s off period: left out of the stops, and the walk over a middle one is timed by the gap between the two periods', () => {
  const schedule = { id: 'bplan000er', name: 'Assembly', short: '', bells: bells(PERIODS).map((bell, p) => (p === 3 ? null : bell)), off: [3] };
  // period 3 has a class (1C) on the day type that does not meet under the schedule
  const project = lessons([['1A'], ['1B'], ['1B'], ['1C'], ['1C'], ['1A'], []], { bellSchedules: [schedule] });
  const { trail, run } = trailOf(project, { bellsId: schedule.id });
  assert.equal(trail.bellsId, schedule.id);
  assert.deepEqual(trail.stops.map((stop) => stop.period), [0, 1, 2, 4, 5, 6], 'period 3 is not a stop');
  assert.deepEqual(trail.walks.map((walk) => [walk.period, walk.toPeriod, walk.across.length]), [[0, 1, 0], [2, 4, 0], [4, 5, 0]]);
  const over = trail.walks[1];
  // from the end of period 2 (10:08) to the start of period 4 (10:56)
  assert.equal(over.passingSeconds, 48 * 60);
  const entry = run.walks.teachers.find((each) => each.period === 2);
  assert.equal(entry.toPeriod, 4, 'walks.teachers keeps it under the period it leaves, with toPeriod');
  assert.equal(over.walking, entry.walking, 'and the trail\'s figure is that entry\'s');
  assert.equal(over.late, entry.late);
  assert.equal(run.walks.teachers.length, 3);
  for (const walk of trail.walks) assert.notEqual(walk.walking, null, 'every walk of the schedule\'s run has its figure');
});

test('a schedule\'s walks are not the regular run\'s: figures of the other run are no match', () => {
  const schedule = { id: 'bplan000er', name: 'Assembly', short: '', bells: bells(PERIODS).map((bell, p) => (p === 3 ? null : bell)), off: [3] };
  const project = lessons([['1A'], ['1B'], ['1B'], ['1C'], ['1C'], ['1A'], []], { bellSchedules: [schedule] });
  const results = answer(project);
  const regular = runResults(results, project.dayTypes[0].id).walks.teachers;
  const trail = teacherTrail(project, null, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, bellsId: schedule.id, walks: regular });
  const over = trail.walks.find((walk) => walk.period === 2);
  assert.equal(over.walking, null, 'the regular run walks 2 to 3, and the schedule\'s walk is 2 to 4');
});

test('off periods at both ends leave only the periods that meet: no stop, no note, no walk outside them', () => {
  const schedule = { id: 'bplan000sh', name: 'Short day', short: '', bells: bells(PERIODS).map((bell, p) => (p === 0 || p >= 5 ? null : bell)), off: [0, 5, 6] };
  const project = lessons([['1B'], ['1A'], ['1B', '1C'], ['1C'], ['1A'], ['1B'], ['1C']], { bellSchedules: [schedule] });
  const { trail } = trailOf(project, { bellsId: schedule.id });
  assert.deepEqual(trail.stops.map((stop) => stop.period), [1, 2, 3, 4]);
  assert.deepEqual(trail.notes.map((note) => note.period), [2], 'the two rooms of period 2 are noted; the periods that do not meet say nothing');
  assert.deepEqual(trail.walks.map((walk) => [walk.period, walk.toPeriod]), [[3, 4]]);
});

// ---- routes and the cache

test('a cache handed in is the one the routes are searched with: a second trail searches nothing', () => {
  const project = lessons([['1A'], ['1B'], [], ['1C'], [], [], []]);
  const cache = createRouteCache(16);
  const graph = routingGraph(project);
  const options = { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, cache };
  teacherTrail(project, graph, options);
  const searched = cache.searches;
  assert.ok(searched > 0);
  teacherTrail(project, graph, options);
  assert.equal(cache.searches, searched);
});

test('the scenario\'s closures reach the trail\'s routes as they reach teacherWalks\'', () => {
  const project = lessons([['1A'], ['1C'], [], [], [], [], []]);
  const graph = routingGraph(project);
  const open = teacherTrail(project, graph, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id });
  assert.equal(open.walks[0].route.ok, true);
  const cells = open.walks[0].route.cells;
  const shut = teacherTrail(project, graph, { teacherId: TEACHER, dayTypeId: project.dayTypes[0].id, shutCells: cells.slice(1, -1) });
  assert.notDeepEqual(shut.walks[0].route.cells, cells, 'a closed cell is gone from the route, or the route fails');
});
