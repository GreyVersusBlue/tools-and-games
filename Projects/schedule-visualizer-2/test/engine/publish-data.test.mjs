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
import { school, clock, clone, room, group, teacher } from './helpers.mjs';

const keys = (value) => Object.keys(value).sort();
const published = (project) => publishedModel(project || school(), { clock });

const TOP = ['building', 'dayTypes', 'format', 'groups', 'id', 'publish', 'publishedAt', 'settings', 'staleAfter', 'subjects', 'teachers', 'version'];
const SETTINGS = ['defaultPassingSeconds', 'periodWord', 'periods', 'schoolName', 'secondsPerCell', 'secondsPerStair', 'timeFormat'];
const FLOOR = ['cells', 'corridors', 'exits', 'height', 'id', 'level', 'name', 'spaces', 'width'];
const ROOM = ['capacity', 'cells', 'doors', 'id', 'kind', 'number', 'shared', 'subjectId', 'teacherIds', 'wing'];
const OTHER = ['cells', 'colour', 'id', 'kind', 'label', 'otherKind'];
const VIEWS = ['common', 'coverage', 'directions', 'free', 'group', 'map', 'now', 'room', 'staffing', 'sub', 'teacher'];

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
    assert.deepEqual(keys(dayType), ['bells', 'id', 'name', 'own']);
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
});

test('what is never published is not in it under any key', () => {
  const project = school();
  project.groups[0].headCount = 31;
  project.building.floors[0].image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 10, height: 10, missing: false };
  project.scenario = { name: 'Move the sixth grade', changes: [], compared: null };
  project.accepted = [{ findingId: 'room-double:dsample00a:1:rsample203', reason: 'Both teachers are there', at: '2026-09-01T12:00:00.000Z' }];
  project.publish.passcode = 'a-passcode-nobody-should-see';
  const text = JSON.stringify(published(project));
  for (const never of ['headCount', 'defaultHeadCount', 'image', 'zones', 'scenario', 'accepted', 'onboarding', 'passcode', 'stalenessDays', 'lastPublishedAt', 'colourScale', 'checks', 'paper', 'theme', 'created', 'modified']) {
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
