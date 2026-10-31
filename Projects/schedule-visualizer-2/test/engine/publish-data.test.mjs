// What the staff browser receives (ARCHITECTURE 6.7): the key set at every
// level, what is never there, and that the engine gives the same answers on a
// published model as on the project it came from.

import test from 'node:test';
import assert from 'node:assert/strict';

import { publishedModel, isProtected, PUBLISHED_VERSION } from '../../engine/publish-data.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { teacherDay } from '../../engine/teacher-day.js';
import { bellsFor } from '../../engine/bells.js';
import { meetingSlots } from '../../engine/runs.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph, route } from '../../engine/routing.js';
import { directions } from '../../engine/directions.js';
import { allRooms } from '../../engine/schema.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { seededRandom } from '../../engine/ids.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { MODULES } from '../../staff/manifest.js';
import { diskReader, partsOf } from '../publish/reader.mjs';
import { school, clock, clone, room, group, teacher, assertValid } from './helpers.mjs';
import { staleness } from '../../engine/publish-data.js';
import { withEverything, B, C, D, ER } from '../fixtures/day-types-calendar.mjs';
import { dayOn, calendarDays } from '../../engine/calendar.js';

const keys = (value) => Object.keys(value).sort();
const published = (project) => publishedModel(project || school(), { clock });

// SV2-77 added bellSchedules, calendar, the day-type fields sameAs and short,
// and the calendar view, on purpose (ARCHITECTURE 17.9); SV2-84 added marks
// and duties.
const TOP = ['bellSchedules', 'building', 'calendar', 'dayTypes', 'duties', 'format', 'groups', 'id', 'marks', 'publish', 'publishedAt', 'settings', 'staleAfter', 'subjects', 'teachers', 'version'];
const SETTINGS = ['defaultPassingSeconds', 'periodWord', 'periods', 'schoolName', 'secondsPerCell', 'secondsPerStair', 'timeFormat'];
const FLOOR = ['cells', 'corridors', 'exits', 'height', 'id', 'level', 'name', 'spaces', 'width'];
const ROOM = ['capacity', 'cells', 'doors', 'id', 'kind', 'number', 'shared', 'subjectId', 'teacherIds', 'wing'];
const OTHER = ['cells', 'colour', 'id', 'kind', 'label', 'otherKind'];
const VIEWS = ['calendar', 'common', 'coverage', 'directions', 'free', 'group', 'map', 'now', 'room', 'staffing', 'sub', 'teacher'];
const DAY_TYPE = ['bells', 'id', 'name', 'own', 'sameAs', 'short'];
const BELL_SCHEDULE = ['bells', 'id', 'name', 'off', 'short'];
const MARK = ['dayTypeIds', 'grades', 'groupIds', 'id', 'kind', 'label', 'period', 'scope'];
const DUTY = ['dayTypeIds', 'end', 'everyone', 'from', 'id', 'kind', 'label', 'period', 'place', 'roomId', 'start', 'subjectIds', 'teacherIds', 'to', 'weekdays', 'when'];
const CALENDAR = ['changedAt', 'dates', 'end', 'rotation', 'start', 'weekdays'];

test('the published model has exactly the keys of ARCHITECTURE 6.7 at every level', () => {
  const model = published();
  assert.deepEqual(keys(model), TOP);
  assert.deepEqual(keys(model.settings), SETTINGS);
  assert.deepEqual(keys(model.building), ['connections', 'floors']);
  assert.equal(model.building.floors.length, 3);
  let rooms = 0;
  let others = 0;
  for (const floor of model.building.floors) {
    assert.deepEqual(keys(floor), FLOOR, floor.name);
    for (const space of floor.spaces) {
      if (space.kind === 'room') rooms += 1;
      else others += 1;
      assert.deepEqual(keys(space), space.kind === 'room' ? ROOM : OTHER, floor.name + ' ' + space.id);
      for (const door of space.doors || []) assert.deepEqual(keys(door), ['cell', 'side']);
    }
    for (const corridor of floor.corridors) assert.deepEqual(keys(corridor), ['cells', 'id', 'name']);
    for (const exit of floor.exits) assert.deepEqual(keys(exit), ['assembly', 'cell', 'doorName', 'id']);
  }
  assert.equal(rooms, 13, 'every room of the sample school');
  assert.ok(others > 0, 'the sample school has other spaces');
  assert.ok(model.building.floors.some((floor) => floor.corridors.length > 0), 'a named corridor');
  assert.equal(model.building.floors.reduce((n, floor) => n + floor.exits.length, 0), 2);
  assert.equal(model.building.connections.length, 2);
  for (const connection of model.building.connections) {
    assert.deepEqual(keys(connection), ['a', 'b', 'direction', 'id', 'label']);
    assert.deepEqual(keys(connection.a), ['cell', 'floorId']);
    assert.deepEqual(keys(connection.b), ['cell', 'floorId']);
  }
  assert.equal(model.subjects.length, 9);
  for (const subject of model.subjects) assert.deepEqual(keys(subject), ['code', 'colour', 'id', 'name']);
  assert.equal(model.teachers.length, 12);
  for (const one of model.teachers) assert.deepEqual(keys(one), ['id', 'name', 'notes', 'roomIds', 'subjectId']);
  assert.equal(model.dayTypes.length, 2);
  for (const dayType of model.dayTypes) {
    assert.deepEqual(keys(dayType), DAY_TYPE);
    for (const bell of dayType.bells) if (bell !== null) assert.deepEqual(keys(bell), ['end', 'start']);
  }
  assert.equal(model.groups.length, 8);
  for (const one of model.groups) {
    assert.deepEqual(keys(one), ['colour', 'days', 'grade', 'id', 'name']);
    assert.deepEqual(keys(one.days), ['dsample00a', 'dsample00b']);
    for (const day of Object.values(one.days)) {
      assert.equal(day.length, 8);
      for (const slot of day) assert.deepEqual(keys(slot), ['label', 'room', 'roomText', 'teacherIds']);
    }
  }
  assert.deepEqual(keys(model.publish), ['teacherNamesOnMap', 'views']);
  assert.deepEqual(keys(model.publish.views), VIEWS);
  // a project saved before bell schedules and the calendar publishes none
  assert.deepEqual([model.bellSchedules, model.calendar], [[], null]);
  assert.deepEqual(model.dayTypes.map((dayType) => [dayType.sameAs, dayType.short]), [[null, ''], [null, '']]);
});

test('what is never published is not in it under any key', () => {
  const project = school();
  project.groups[0].headCount = 31;
  project.building.floors[0].image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 10, height: 10, missing: false };
  project.scenario = { name: 'Move the sixth grade', changes: [], compared: null };
  project.accepted = [{ findingId: 'room-double:dsample00a:1:rsample203', reason: 'Both teachers are there', at: '2026-09-01T12:00:00.000Z' }];
  project.publish.passcode = 'a-passcode-nobody-should-see';
  project.publish.staleAtCalendarEnd = true;
  const text = JSON.stringify(published(project));
  for (const never of ['headCount', 'defaultHeadCount', 'image', 'zones', 'scenario', 'accepted', 'onboarding', 'passcode', 'stalenessDays', 'staleAtCalendarEnd', 'lastPublishedAt', 'colourScale', 'checks', 'paper', 'theme', 'created', 'modified']) {
    assert.ok(!text.includes('"' + never + '"'), never + ' is in the published data');
  }
  assert.ok(!text.includes('a-passcode-nobody-should-see'));
  assert.ok(!text.includes('Both teachers are there'));
  assert.ok(!text.includes('Move the sixth grade'));
});

test('a field the planner gains later is not published until it is named', () => {
  const project = school();
  project.building.floors[0].spaces[0].keyCode = '4411';
  project.teachers[0].homePhone = '555 0100';
  project.groups[0].roster = ['a student'];
  project.settings.somethingNew = true;
  project.somethingElse = { secret: true };
  const text = JSON.stringify(published(project));
  for (const leaked of ['keyCode', 'homePhone', 'roster', 'somethingNew', 'somethingElse']) assert.ok(!text.includes(leaked), leaked);
});

test('validate accepts a published model, and repair hands it back as it came', () => {
  const model = published();
  assert.deepEqual(validate(model), []);
  const repaired = repair(model, { clock });
  assert.deepEqual(repaired.notes, []);
  assert.equal(repaired.project, model);
  const again = repair(clone(model), { clock });
  assert.deepEqual(again.project, model);
});

test('it says what it is, whose it is and when it was published', () => {
  const model = published();
  assert.equal(model.format, 'sv2-published');
  assert.equal(model.version, 1);
  assert.equal(PUBLISHED_VERSION, 1);
  assert.equal(model.id, 'psample001');
  assert.equal(model.publishedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(model.staleAfter, '2026-10-31T12:00:00.000Z', '60 days on');
  assert.equal(model.settings.schoolName, 'Marrowby Middle School (sample)');
});

test('the staleness period is the project\'s, and a bad one falls back to 60 days', () => {
  const project = school();
  project.publish.stalenessDays = 7;
  assert.equal(published(project).staleAfter, '2026-09-08T12:00:00.000Z');
  project.publish.stalenessDays = 'soon';
  assert.equal(published(project).staleAfter, '2026-10-31T12:00:00.000Z');
});

test('publishing needs a clock and takes none of its own', () => {
  assert.throws(() => publishedModel(school()), /needs a clock/);
  assert.throws(() => publishedModel(school(), {}), /needs a clock/);
});

test('a teacher\'s day is the same on the published model as on the project', () => {
  const project = school();
  const model = published(project);
  let teaching = 0;
  for (const one of project.teachers) {
    for (const dayType of project.dayTypes) {
      const day = teacherDay(project, one.id, dayType.id);
      assert.deepEqual(teacherDay(model, one.id, dayType.id), day, one.name + ' on ' + dayType.name);
      teaching += day.filter((entry) => entry.kind === 'teaching').length;
    }
  }
  assert.ok(teaching > 50, 'the sample school has teaching periods to compare, found ' + teaching);
});

test('bells and every group\'s day are the same on the published model', () => {
  const project = school();
  const model = published(project);
  for (const dayType of project.dayTypes) {
    const bells = bellsFor(project, dayType.id);
    assert.match(bells[0].start, /^0\d:\d\d$/, 'the sample school has bell times');
    assert.equal(bells[0].passingAfter, 240);
    assert.deepEqual(bellsFor(model, dayType.id), bells);
    for (const one of project.groups) assert.deepEqual(effectiveSchedule(model, one.id, dayType.id), effectiveSchedule(project, one.id, dayType.id));
  }
});

test('a day type that is the same as A Day is published as that, not copied', () => {
  const project = school();
  project.dayTypes[1].own = false;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  for (const one of project.groups) delete one.days.dsample00b;
  assert.deepEqual(validate(project), []);
  const model = published(project);
  assert.equal(model.dayTypes[1].own, false);
  assert.deepEqual(keys(model.groups[0].days), ['dsample00a']);
  assert.deepEqual(validate(model), []);
  assert.deepEqual(teacherDay(model, 'tsample001', 'dsample00b'), teacherDay(project, 'tsample001', 'dsample00a'));
});

test('the graph, every route and its directions are the same on the published model', () => {
  const project = school();
  const model = published(project);
  const graph = buildGraph(project);
  assert.deepEqual(buildGraph(model), graph);
  const a = routingGraph(project, graph);
  const b = routingGraph(model);
  const rooms = allRooms(project);
  let found = 0;
  for (const from of rooms) {
    for (const to of rooms) {
      const there = route(a, from.id, to.id);
      const here = route(b, from.id, to.id);
      assert.deepEqual(here, there, from.number + ' to ' + to.number);
      if (there.ok && !there.same) {
        found += 1;
        assert.deepEqual(directions(model, here), directions(project, there), from.number + ' to ' + to.number);
      }
    }
  }
  assert.equal(found, 13 * 12, 'every pair of rooms has a route');
  const long = route(b, SAMPLE_PROBLEMS.longWalk.fromRoomId, SAMPLE_PROBLEMS.longWalk.toRoomId);
  assert.equal(long.seconds, 259);
  assert.equal(route(b, 'rsample101', 'rsample101', { avoidStairs: true }).same, true);
});

test('a double-booked room is published as it is, with both groups', () => {
  const model = published();
  const { dayTypeId, period, roomId, groupIds } = SAMPLE_PROBLEMS.roomDouble;
  for (const groupId of groupIds) assert.equal(model.groups.find((one) => one.id === groupId).days[dayTypeId][period].room, roomId);
});

test('a slot whose room is not in the building keeps the number that was typed', () => {
  const project = school();
  group(project, '6A').days.dsample00a[0] = { room: null, roomText: 'Annex 9', label: 'Band', teacherIds: ['tsample012'] };
  const model = published(project);
  assert.deepEqual(model.groups.find((one) => one.name === '6A').days.dsample00a[0], { room: null, roomText: 'Annex 9', label: 'Band', teacherIds: ['tsample012'] });
});

test('every name is published exactly as typed', () => {
  const project = school();
  const hostile = '</script><img src=x onerror=alert(1)> "quoted" \'single\' &amp; 東京   مدرسة';
  project.settings.schoolName = hostile;
  teacher(project, 'Ms. Halloran').name = hostile + ' T';
  project.teachers[0].notes = hostile;
  group(project, '6A').name = hostile + ' G';
  const first = room(project, '101');
  first.number = hostile;
  first.wing = hostile;
  project.subjects[0].name = hostile;
  project.building.floors[0].name = hostile;
  project.building.floors[0].corridors[0].name = hostile;
  project.building.floors[0].exits[0].doorName = hostile;
  project.building.floors[0].exits[0].assembly = hostile;
  project.dayTypes[0].name = hostile;
  const model = JSON.parse(JSON.stringify(published(project)));
  assert.equal(model.settings.schoolName, hostile);
  assert.equal(model.teachers[0].name, hostile + ' T');
  assert.equal(model.teachers[0].notes, hostile);
  assert.equal(model.groups[0].name, hostile + ' G');
  assert.equal(model.building.floors[0].spaces.find((space) => space.id === 'rsample101').number, hostile);
  assert.equal(model.building.floors[0].spaces.find((space) => space.id === 'rsample101').wing, hostile);
  assert.equal(model.subjects[0].name, hostile);
  assert.equal(model.building.floors[0].name, hostile);
  assert.equal(model.building.floors[0].corridors[0].name, hostile);
  assert.equal(model.building.floors[0].exits[0].doorName, hostile);
  assert.equal(model.building.floors[0].exits[0].assembly, hostile);
  assert.equal(model.dayTypes[0].name, hostile);
});

test('a view switched off is published as off, and the map setting travels', () => {
  const project = school();
  project.publish.views.coverage = false;
  project.publish.teacherNamesOnMap = false;
  const model = published(project);
  assert.equal(model.publish.views.coverage, false);
  assert.equal(model.publish.views.teacher, true);
  assert.equal(model.publish.teacherNamesOnMap, false);
  assert.equal(model.teachers.length, 12, 'a view switched off drops nobody');
});

test('the published model shares nothing with the project that can be changed', () => {
  const project = school();
  const before = clone(project);
  const model = published(project);
  model.building.floors[0].spaces[0].cells.push(0);
  model.building.floors[0].spaces[0].teacherIds.push('tx');
  model.building.floors[0].spaces[0].doors[0].side = 'x';
  model.building.floors[0].corridors[0].cells.push(0);
  model.building.connections[0].a.cell = -1;
  model.teachers[0].roomIds.push('rx');
  model.dayTypes[0].bells[0].start = '00:00';
  model.groups[0].days.dsample00a[0].teacherIds.push('tx');
  model.groups[0].days.dsample00a[0].room = 'rx';
  model.publish.views.map = false;
  model.settings.periods = 99;
  assert.deepEqual(project, before);
});

// ---------------------------------------------------------------- ARCHITECTURE 17 (SV2-77)

test('bell schedules, the calendar and the day-type fields are published key by key', () => {
  const project = withEverything();
  const model = published(project);
  assert.deepEqual(keys(model), TOP);
  for (const dayType of model.dayTypes) assert.deepEqual(keys(dayType), DAY_TYPE, dayType.name);
  assert.deepEqual(model.dayTypes.slice(2).map((dayType) => [dayType.id, dayType.own, dayType.sameAs, dayType.short]), [[C, false, B, 'C'], [D, false, null, '']], 'an absent sameAs is published as null: the first');
  assert.equal(model.bellSchedules.length, 2);
  for (const schedule of model.bellSchedules) {
    assert.deepEqual(keys(schedule), BELL_SCHEDULE);
    for (const bell of schedule.bells) if (bell !== null) assert.deepEqual(keys(bell), ['end', 'start']);
  }
  assert.deepEqual(model.bellSchedules, project.bellSchedules);
  assert.deepEqual(keys(model.calendar), CALENDAR);
  for (const rule of model.calendar.weekdays) assert.deepEqual(keys(rule), ['bells', 'day']);
  for (const entry of model.calendar.dates) assert.deepEqual(keys(entry), ['bells', 'date', 'day', 'label']);
  assert.deepEqual(model.calendar, project.calendar, 'as it is, with changedAt');
  assert.equal(model.publish.views.calendar, false, 'the fixture switches the calendar page off');
  assert.deepEqual(validate(model), []);
  assert.equal(repair(model, { clock }).project, model, 'repair hands it back as it came');
});

// ---------------------------------------------------------------- marks and duties (SV2-84)

const markOf = (extra) => ({ id: 'mpub000001', kind: 'lunch', label: '', period: 3, dayTypeIds: [], scope: 'school', grades: [], groupIds: [], ...extra });
const dutyOf = (extra) => ({ id: 'upub000001', kind: 'duty', label: '', when: 'before', period: 0, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [], subjectIds: [], everyone: false, ...extra });

function withMarksAndDuties() {
  const project = school();
  project.marks = [
    markOf({ id: 'mpub000001', kind: 'lunch', scope: 'grades', grades: ['6'] }),
    markOf({ id: 'mpub000002', kind: 'noclass', label: 'Testing', period: 5, scope: 'groups', groupIds: ['gsample06a'], dayTypeIds: ['dsample00b'] }),
    markOf({ id: 'mpub000003', kind: 'activity', period: 12 }),
  ];
  project.duties = [
    dutyOf({ id: 'upub000001', label: 'Bus duty', when: 'after', start: '14:45', end: '15:05', teacherIds: ['tsample001'], roomId: 'rsample101', weekdays: [2], from: '2026-12-01', to: '2026-12-18' }),
    dutyOf({ id: 'upub000002', kind: 'meeting', label: 'Science', when: 'period', period: 6, subjectIds: ['ssample003'], place: 'Library annex' }),
    dutyOf({ id: 'upub000003', kind: 'lunch', when: 'period', period: 3, everyone: true }),
    dutyOf({ id: 'upub000004', label: 'Nobody on it', when: 'before' }),
  ];
  assertValid(project);
  return project;
}

test('a project with no marks and no duties publishes two empty lists', () => {
  const model = published();
  assert.deepEqual([model.marks, model.duties], [[], []]);
  const odd = school();
  odd.marks = 'marks';
  odd.duties = [null, 5, 'x'];
  const strange = published(odd);
  assert.deepEqual([strange.marks, strange.duties], [[], []], 'a malformed list is none, and nothing throws');
});

test('marks and duties are published key by key, as they are, with every period and every duty kept', () => {
  const project = withMarksAndDuties();
  const model = published(project);
  assert.deepEqual(keys(model), TOP);
  assert.equal(model.marks.length, 3);
  assert.equal(model.duties.length, 4);
  for (const mark of model.marks) assert.deepEqual(keys(mark), MARK, mark.id);
  for (const duty of model.duties) assert.deepEqual(keys(duty), DUTY, duty.id);
  assert.deepEqual(model.marks, project.marks);
  assert.deepEqual(model.duties, project.duties);
  assert.equal(model.marks[2].period, 12, 'a mark past the end of the day is kept: a setting never truncates data');
  assert.deepEqual(model.duties[3].teacherIds, [], 'a duty with nobody on it is published with nobody on it');
  assert.deepEqual(validate(model), []);
  assert.equal(repair(model, { clock }).project, model, 'repair hands it back as it came');
});

test('the lists are copies: changing the planner\'s later does not change a model made earlier', () => {
  const project = withMarksAndDuties();
  const model = published(project);
  project.marks[0].grades.push('7');
  project.duties[0].teacherIds.push('tsample002');
  assert.deepEqual(model.marks[0].grades, ['6']);
  assert.deepEqual(model.duties[0].teacherIds, ['tsample001']);
});

test('what the planner adds to a mark or a duty later is not published until it is named', () => {
  const project = withMarksAndDuties();
  project.marks[0].secret = 'staff party';
  project.duties[0].note = 'Ms. Halloran dislikes this';
  const text = JSON.stringify(published(project));
  for (const leaked of ['staff party', 'dislikes']) assert.ok(!text.includes(leaked), leaked);
});

test('the engine gives the same marks, duties and teacher days on the published model as on the project', () => {
  const project = withMarksAndDuties();
  const model = published(project);
  for (const dayType of project.dayTypes) {
    for (const one of project.teachers) {
      assert.deepEqual(teacherDay(model, one.id, dayType.id), teacherDay(project, one.id, dayType.id), one.name + ' ' + dayType.name);
      assert.deepEqual(teacherDay(model, one.id, dayType.id, { date: '2026-12-02' }), teacherDay(project, one.id, dayType.id, { date: '2026-12-02' }));
    }
    for (const one of project.groups) {
      assert.deepEqual(meetingSlots(model, one.id, dayType.id), meetingSlots(project, one.id, dayType.id), one.name + ' ' + dayType.name);
    }
  }
});

test('a view the project has no switch for yet is on, the calendar\'s too', () => {
  const project = school();
  delete project.publish.views.calendar;
  assert.equal(published(project).publish.views.calendar, true);
});

test('what the planner adds to a bell schedule or the calendar later is not published until it is named', () => {
  const project = withEverything();
  project.bellSchedules[0].where = 'a-room-nobody-should-see';
  project.calendar.secret = 'staff party';
  project.calendar.dates[0].who = 'Ms. Halloran';
  project.calendar.weekdays[0].why = 'a reason';
  project.dayTypes[2].colour = '#123456';
  const text = JSON.stringify(published(project));
  for (const leaked of ['a-room-nobody-should-see', 'staff party', '"who"', '"why"', '#123456']) assert.ok(!text.includes(leaked), leaked);
});

test('the engine gives the same days, bells and classes on the published model as on the project', () => {
  const project = withEverything();
  const model = published(project);
  assert.deepEqual(calendarDays(model), calendarDays(project));
  assert.equal(calendarDays(model).length, 285);
  assert.deepEqual(dayOn(model, '2026-10-14'), { known: true, school: true, dayTypeId: C, bellsId: 'bsample0as', why: 'date', label: 'Assembly', changed: true });
  for (const dayType of project.dayTypes) {
    assert.deepEqual(bellsFor(model, dayType.id), bellsFor(project, dayType.id), dayType.name);
    assert.deepEqual(bellsFor(model, dayType.id, ER), bellsFor(project, dayType.id, ER), dayType.name + ' with Early Release');
    for (const one of project.groups) assert.deepEqual(effectiveSchedule(model, one.id, dayType.id), effectiveSchedule(project, one.id, dayType.id));
  }
  assert.deepEqual(effectiveSchedule(model, 'gsample006', C), effectiveSchedule(project, 'gsample006', B), 'C Day is B Day\'s classes');
});

test('with a calendar, a published file is stale the day after its last date at noon UTC', () => {
  const project = withEverything();
  project.publish.staleAtCalendarEnd = true;
  assert.equal(published(project).staleAfter, '2027-06-12T12:00:00.000Z', 'the calendar ends on 11 June 2027');
  assert.deepEqual(staleness(project, clock()), { staleAfter: '2027-06-12T12:00:00.000Z', why: 'calendar' });
  delete project.publish.staleAtCalendarEnd;
  assert.equal(published(project).staleAfter, '2027-06-12T12:00:00.000Z', 'absent is on');
});

test('the staleness period applies with the calendar\'s end switched off, with no calendar, and after a calendar has ended', () => {
  const project = withEverything();
  assert.equal(project.publish.staleAtCalendarEnd, false);
  assert.deepEqual(staleness(project, clock()), { staleAfter: '2026-10-31T12:00:00.000Z', why: 'days' });
  project.publish.staleAtCalendarEnd = true;
  project.publish.stalenessDays = 7;
  const after = new Date('2027-06-12T12:00:00.000Z');
  assert.deepEqual(staleness(project, after), { staleAfter: '2027-06-19T12:00:00.000Z', why: 'calendar-ended' }, 'published at the very moment it would be stale');
  assert.equal(staleness(project, new Date('2027-06-12T11:59:59.000Z')).why, 'calendar', 'a second before it');
  assert.equal(publishedModel(project, { clock: () => after }).staleAfter, '2027-06-19T12:00:00.000Z');
  project.calendar = null;
  assert.deepEqual(staleness(project, clock()), { staleAfter: '2026-09-08T12:00:00.000Z', why: 'days' });
});

test('protection is on for any passcode and off for an empty one', () => {
  const project = school();
  assert.equal(project.publish.passcode, 'bulldogs2015');
  assert.equal(isProtected(project), true);
  project.publish.passcode = '';
  assert.equal(isProtected(project), false);
});

// SV2-36 item 9. A published file carries the source of every module on the
// staff manifest. While the default passcode was a constant in schema.js,
// every file locked with it spelt it out in its own script.
test('a file locked with the default passcode does not hold that passcode in its code', async () => {
  const project = school();
  assert.equal(project.publish.passcode, DEFAULT_PASSCODE);
  const made = await publishDocument(diskReader(), project, { clock, random: seededRandom('sv2-item-9'), iterations: 1000 });
  assert.equal(made.locked, true);
  const parts = partsOf(made.html);
  assert.ok(parts.script.length > 100000, 'the script of the assembled file was read');
  assert.equal(parts.script.includes(DEFAULT_PASSCODE), false, 'the default passcode can be read in the published file\'s script');
  assert.equal(made.html.includes(DEFAULT_PASSCODE), false, 'the default passcode can be read somewhere in the published file');
  assert.equal(MODULES.includes('engine/publish-defaults.js'), false, 'the module that holds the default is not one a published file carries');
});
