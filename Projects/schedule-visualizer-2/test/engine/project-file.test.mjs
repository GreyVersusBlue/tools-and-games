// The project file, the building file and the schedule file: each written
// and read back identical, older and malformed and newer files handled as
// FORMATS.md says, and each import one action that changes nothing when it
// is refused.
//
// The files under test/fixtures/formats/ stand for files already saved on
// somebody's disk. The three `-v1.json` files were written by this module at
// format 1 and are compared byte for byte; do not regenerate them to make a
// test pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDING_FORMAT, SCHEDULE_FORMAT, NOT_JSON_MESSAGE, NOT_A_BUILDING_MESSAGE, NOT_A_SCHEDULE_MESSAGE, FileError, fileKind, summarise, writeProjectFile, readProjectFile, writeBuildingFile, readBuildingFile, applyBuilding, writeScheduleFile, readScheduleFile, applySchedule } from '../../engine/project-file.js';
import { NOT_A_PROJECT_MESSAGE } from '../../engine/migrate.js';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { validate } from '../../engine/validate.js';
import { school, emptyProject, clone, clock, makeIds, tickingClock, assertValid, group, room, teacher } from './helpers.mjs';

const FORMATS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'formats');
const fixture = (name) => readFileSync(path.join(FORMATS_DIR, name), 'utf8');
// project-malformed.txt is cut-off JSON on purpose; it is not named .json because
// the site's integrity sweep parses every .json it serves and would report it.

// The sentence ARCHITECTURE 5 gives, written out here so a change to it in
// the code is a failure here.
const NEWER = 'This file was made by a newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file saved in format 1.';

const A = 'dsample00a';
const B = 'dsample00b';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const IMAGES = { isample001: { data: PNG, type: 'image/png' } };

function traced() {
  const project = school();
  project.building.floors[0].image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 1, height: 1, missing: false };
  assertValid(project);
  return project;
}

function hostile() {
  const project = traced();
  project.settings.schoolName = 'Écôle <"Nord"> & Söhne 北校';
  project.groups[0].name = 'The "Owls", <9A>';
  project.groups[1].name = '七年级一班';
  project.teachers[0].name = 'Г-жа Соколова';
  project.building.floors[0].name = '</script><b>Ground</b>';
  room(project, '101').number = 'Ω-1 "lab"';
  assertValid(project);
  return project;
}

// The sample school as another project would hold it: the same room numbers
// and names, every id different.
function sibling() {
  const text = JSON.stringify(school()).replace(/"([a-z])sample([a-z0-9]{3})"/g, '"$1other0$2"');
  const project = JSON.parse(text);
  assertValid(project);
  return project;
}

function refusal(code, pattern) {
  return (error) => {
    assert.ok(error instanceof FileError, 'a FileError, got ' + error);
    assert.equal(error.code, code);
    if (typeof pattern === 'string') assert.equal(error.message, pattern);
    else if (pattern) assert.match(error.message, pattern);
    return true;
  };
}

function storeOf(project) {
  return createStore({ project, clock: tickingClock(), ids: makeIds(3) });
}

const context = () => ({ ids: makeIds(9), unnumberedText: actions.UNNUMBERED_ROOM_TEXT });

// ---------------------------------------------------------------- the project file

test('project file: export, import, export gives the same file', () => {
  for (const [name, project, images] of [['the sample school', school()], ['an empty project', emptyProject()], ['a traced floor and hostile names', hostile(), IMAGES]]) {
    const first = writeProjectFile(project, { images });
    const read = readProjectFile(first);
    assert.deepEqual(read.project, project, name);
    assert.equal(writeProjectFile(read.project, { images: read.images }), first, name);
    assert.deepEqual(read.notes, [], name);
    assert.equal(read.migratedFrom, 1, name);
  }
});

test('project file: the file says its format and version first', () => {
  const text = writeProjectFile(school());
  assert.ok(text.startsWith('{\n  "format": "sv2-project",\n  "version": 1,\n'));
  assert.ok(text.endsWith('}\n'));
});

test('project file: a file saved at format 1 still reads, and writes back byte for byte', () => {
  const text = fixture('project-v1.json');
  const read = readProjectFile(text);
  assert.equal(writeProjectFile(read.project, { images: read.images }), text);
  assert.deepEqual(read.summary, { floors: 3, rooms: 13, otherSpaces: 10, images: 1, subjects: 9, teachers: 12, groups: 8, dayTypes: 2 });
  assert.equal(read.project.groups[0].name, 'The "Owls", <6A>');
  assert.equal(read.project.groups[1].name, '七年级一班');
  assert.deepEqual(read.project.groups[0].days[A][0], { room: 'rsample201', roomText: '', label: 'Algebra', teacherIds: ['tsample001'] });
});

test('project file: traced image bytes travel in the file and come back apart from the project', () => {
  const project = traced();
  const text = writeProjectFile(project, { images: IMAGES });
  assert.equal(JSON.parse(text).building.floors[0].image.data, PNG);
  const read = readProjectFile(text);
  assert.deepEqual(read.images, IMAGES);
  assert.equal('data' in read.project.building.floors[0].image, false);
  assert.equal('type' in read.project.building.floors[0].image, false);
  assert.equal(read.project.building.floors[0].image.missing, false);
});

test('project file: an image whose bytes are not in the file is marked missing and keeps its position', () => {
  const project = traced();
  project.building.floors[0].image.x = 4.5;
  const read = readProjectFile(writeProjectFile(project));
  assert.deepEqual(read.images, {});
  assert.equal(read.project.building.floors[0].image.missing, true);
  assert.equal(read.project.building.floors[0].image.x, 4.5);
  assert.equal(read.notes.length, 1);
});

test('project file: image bytes that are not base64 are refused', () => {
  const value = JSON.parse(writeProjectFile(traced(), { images: IMAGES }));
  value.building.floors[0].image.data = '<svg onload=alert(1)>';
  assert.throws(() => readProjectFile(JSON.stringify(value)), refusal('invalid', /building\.floors\[0\]\.image\.data: The bytes of a traced image are base64 text\./));
});

test('project file: a file from before files carried a version is migrated', () => {
  const read = readProjectFile(fixture('project-v0.json'), { ids: makeIds(5), clock });
  assert.equal(read.migratedFrom, 0);
  assert.deepEqual(validate(read.project), []);
  assert.equal(read.project.format, 'sv2-project');
  assert.equal(read.project.version, 1);
  assert.deepEqual(read.project.scenario.changes[0], { kind: 'move', groupId: 'gsample08a', period: 6, roomId: 'rsample101', dayTypeId: A });
  assert.equal('dayTypeId' in read.project.scenario, false);
  assert.deepEqual(read.project.building.floors.map((floor) => floor.level), [1, 2, 3]);
  assert.equal(read.project.settings.checks.consecutiveLimit, 4);
  assert.deepEqual(read.project.groups, school().groups, 'nothing that was entered is lost');
  assert.deepEqual(read.project.teachers, school().teachers);
});

test('project file: a file cut short is refused, and the refusal says what to do', () => {
  assert.throws(() => readProjectFile(fixture('project-malformed.txt')), refusal('not-json', NOT_JSON_MESSAGE));
  assert.match(NOT_JSON_MESSAGE, /Export it again/);
  for (const text of ['', 'PK\u0003\u0004', '{"format": "sv2-project",', undefined, null, 42]) assert.throws(() => readProjectFile(text), refusal('not-json'));
});

test('project file: a file that breaks a rule is refused whole, naming where', () => {
  assert.throws(() => readProjectFile(fixture('project-invalid.json')), (error) => {
    refusal('invalid', /^This project file cannot be imported, and nothing was changed\. 1 thing in it is not as the format says\. The first: groups\[0\]\.days\.dsample00a\[0\]\.room: /)(error);
    assert.deepEqual(error.findings.map((finding) => finding.path), ['groups[0].days.dsample00a[0].room']);
    return true;
  });
});

test('project file: each rule validate knows is a refusal on import', () => {
  const cases = [
    ['17 periods', (p) => { p.settings.periods = 17; }, /settings\.periods/],
    ['two groups with one name', (p) => { p.groups[1].name = p.groups[0].name.toLowerCase(); }, /groups\[1\]\.name/],
    ['a cells string of the wrong length', (p) => { p.building.floors[0].cells += '.'; }, /building\.floors\[0\]\.cells/],
    ['no day types', (p) => { p.dayTypes = []; }, /dayTypes/],
    ['a missing building', (p) => { delete p.building; }, /building/],
  ];
  for (const [name, breakIt, where] of cases) {
    const project = school();
    breakIt(project);
    assert.throws(() => readProjectFile(JSON.stringify(project)), refusal('invalid', where), name);
  }
});

test('project file: a newer format is refused with the exact sentence, whatever else is in it', () => {
  assert.throws(() => readProjectFile(fixture('project-newer.json')), refusal('newer-version', NEWER));
  assert.throws(() => readProjectFile('{"format":"sv2-project","version":99}'), refusal('newer-version', NEWER));
});

test('project file: something that is not a project is refused', () => {
  for (const text of ['[]', '"sv2-project"', '7', 'null', '{}', '{"hello":"world"}', '{"format":"sv2-project"}', '{"format":"other","version":1}', '{"format":"sv2-project","version":-1}', '{"format":"sv2-project","version":1.5}', '{"version":"1","building":{}}']) {
    assert.throws(() => readProjectFile(text), refusal('not-a-project', NOT_A_PROJECT_MESSAGE), text);
  }
});

test('project file: a building, schedule or published file is refused by name, with where it belongs', () => {
  assert.throws(() => readProjectFile(writeBuildingFile(school())), refusal('wrong-kind', 'This is a building file, not a project file. It holds a building and no schedule: import it as a building.'));
  assert.throws(() => readProjectFile(writeScheduleFile(school())), refusal('wrong-kind', 'This is a schedule file, not a project file. It holds a schedule and no building: import it as a schedule.'));
  assert.throws(() => readProjectFile('{"format":"sv2-published","version":1}'), refusal('wrong-kind', /^This is a published file for staff, not a project file\. It is for reading/));
  assert.throws(() => readProjectFile('{"format":"sv2-published-locked","version":1}'), refusal('wrong-kind'));
});

test('project file: reading takes a byte-order mark in its stride', () => {
  assert.deepEqual(readProjectFile('﻿' + writeProjectFile(school())).project, school());
});

test('project file: importing one is one undo entry, and a refused file changes nothing', () => {
  const store = storeOf(emptyProject());
  const before = store.project;
  assert.throws(() => readProjectFile(fixture('project-invalid.json')), FileError);
  assert.throws(() => store.apply(actions.replaceProject, {}), actions.ActionError);
  assert.equal(store.project, before);
  assert.equal(store.history.past.length, 0);
  const read = readProjectFile(fixture('project-v1.json'));
  store.apply(actions.replaceProject, { project: read.project, label: 'Import a project file' });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import a project file');
  assert.equal(store.project.groups.length, 8);
  store.undo();
  assert.deepEqual(store.project.groups, []);
});

test('fileKind tells the files apart without reading them in full', () => {
  assert.equal(fileKind(writeProjectFile(school())), 'project');
  assert.equal(fileKind(fixture('project-v0.json')), 'project');
  assert.equal(fileKind(fixture('project-newer.json')), 'project');
  assert.equal(fileKind(writeBuildingFile(school())), 'building');
  assert.equal(fileKind(writeScheduleFile(school())), 'schedule');
  assert.equal(fileKind('{"format":"sv2-published","version":1}'), 'published');
  for (const text of [fixture('project-malformed.txt'), '{}', '[]', 'Group,Grade\n6A,6\n']) assert.equal(fileKind(text), null);
});

test('summarise counts what a project holds', () => {
  assert.deepEqual(summarise(school()), { floors: 3, rooms: 13, otherSpaces: 10, images: 0, subjects: 9, teachers: 12, groups: 8, dayTypes: 2 });
});

// ---------------------------------------------------------------- the building file

test('building file: export, import, export gives the same file', () => {
  for (const [project, images] of [[school()], [hostile(), IMAGES], [emptyProject()]]) {
    const first = writeBuildingFile(project, { images });
    const read = readBuildingFile(first);
    const applied = applyBuilding(project, read.file, context());
    assert.deepEqual(applied.project, project);
    assert.equal(writeBuildingFile(applied.project, { images: read.images }), first);
  }
});

test('building file: it holds the building and the subjects its rooms use, and no schedule', () => {
  const value = JSON.parse(writeBuildingFile(school()));
  assert.deepEqual(Object.keys(value), ['format', 'version', 'building', 'subjects']);
  assert.deepEqual([value.format, value.version], [BUILDING_FORMAT, 1]);
  assert.deepEqual(value.subjects.map((subject) => subject.code), ['MATH', 'ENG', 'SCI', 'SOC', 'LANG', 'ART', 'MUS', 'PE', 'LIB']);
  const unused = school();
  for (const floor of unused.building.floors) for (const space of floor.spaces) if (space.subjectId === 'ssample006') space.subjectId = null;
  assert.equal(JSON.parse(writeBuildingFile(unused)).subjects.some((subject) => subject.code === 'ART'), false);
});

test('building file: a file saved at format 1 still reads, and writes back byte for byte', () => {
  const text = fixture('building-v1.json');
  const read = readBuildingFile(text);
  assert.deepEqual(read.images, IMAGES);
  assert.equal(read.summary.rooms, 13);
  const applied = applyBuilding(school(), read.file, context());
  assert.equal(writeBuildingFile(applied.project, { images: read.images }), text);
});

test('building file: a newer one, a cut one, another kind and a shapeless one are each refused', () => {
  const value = JSON.parse(writeBuildingFile(school()));
  assert.throws(() => readBuildingFile(JSON.stringify({ ...value, version: 2 })), refusal('newer-version', NEWER));
  assert.throws(() => readBuildingFile(writeBuildingFile(school()).slice(0, 900)), refusal('not-json', NOT_JSON_MESSAGE));
  assert.throws(() => readBuildingFile(writeProjectFile(school())), refusal('wrong-kind', 'This is a project file, not a building file. It holds a whole project: import it as a project.'));
  assert.throws(() => readBuildingFile(fixture('project-v0.json')), refusal('wrong-kind'));
  assert.throws(() => readBuildingFile(writeScheduleFile(school())), refusal('wrong-kind', /^This is a schedule file, not a building file\./));
  for (const text of ['{}', '[]', '{"format":"sv2-building"}', '{"format":"sv2-building","version":0,"building":{}}']) assert.throws(() => readBuildingFile(text), refusal('not-this-kind', NOT_A_BUILDING_MESSAGE), text);
  assert.throws(() => readBuildingFile('{"format":"sv2-building","version":1}'), refusal('invalid', /building: A building file holds a building\./));
  assert.throws(() => readBuildingFile('{"format":"sv2-building","version":1,"building":{},"subjects":{}}'), refusal('invalid', /subjects/));
});

test('building file: a building that breaks a rule is refused whole, naming where', () => {
  const cases = [
    ['a door facing a wall', (b) => { const space = b.floors[0].spaces[0]; space.doors.push({ cell: space.cells[0], side: 'n' }); }, /building\.floors\[0\]\.spaces\[0\]\.doors\[1\]/],
    ['two rooms with one number', (b) => { b.floors[1].spaces[0].number = '101'; }, /building\.floors\[1\]\.spaces\[0\]\.number/],
    ['a connection off the stairs', (b) => { b.connections[0].a.cell += 1; }, /building\.connections\[0\]\.a\.cell/],
    ['no floors', (b) => { b.floors = []; }, /building\.floors/],
    ['floors that are not a list', (b) => { b.floors = 'three'; }, /building\.floors/],
    ['teachers of a room that are not a list', (b) => { b.floors[0].spaces[0].teacherIds = 'tsample001'; }, /spaces\[0\]\.teacherIds/],
    ['a subject that is a number', (b) => { b.floors[0].spaces[0].subjectId = 7; }, /spaces\[0\]\.subjectId/],
  ];
  for (const [name, breakIt, where] of cases) {
    const value = JSON.parse(writeBuildingFile(school()));
    breakIt(value.building);
    assert.throws(() => readBuildingFile(JSON.stringify(value)), refusal('invalid', where), name);
  }
});

test('building file: into a project with other ids, slots follow their rooms by number', () => {
  const project = school();
  const read = readBuildingFile(writeBuildingFile(sibling()));
  const applied = applyBuilding(project, read.file, context());
  assertValid(applied.project);
  assert.deepEqual([applied.summary.slotsKept, applied.summary.slotsMoved, applied.summary.slotsLost], [0, 128, 0]);
  assert.equal(group(applied.project, '6A').days[A][0].room, 'rother0201');
  assert.equal(room(applied.project, '201').id, 'rother0201');
  // subjects are matched by code and name, so none is added twice
  assert.deepEqual(applied.summary.subjectsAdded, []);
  assert.equal(room(applied.project, '101').subjectId, 'ssample001');
  // the other project's teachers are not this project's: the rooms list nobody
  assert.deepEqual(room(applied.project, '101').teacherIds, []);
  assert.deepEqual(teacher(applied.project, 'Ms. Halloran').roomIds, []);
});

test('building file: a slot whose room is not in the new building keeps the number as text', () => {
  const project = school();
  const other = school();
  other.building.floors[1].spaces = other.building.floors[1].spaces.filter((space) => space.number !== '203');
  room(other, '204').number = '';
  group(project, '6A').days[A][1] = { room: 'rsample204', roomText: '', label: 'French', teacherIds: ['tsample008'] };
  const applied = applyBuilding(project, readBuildingFile(writeBuildingFile(other)).file, context());
  assertValid(applied.project);
  assert.deepEqual(group(applied.project, '6A').days[A][7], { room: null, roomText: '203', label: '', teacherIds: [] });
  assert.deepEqual(applied.summary.lostRooms, ['203']);
  assert.ok(applied.summary.slotsLost > 0);
  assert.deepEqual(teacher(applied.project, 'Ms. Vandermeer').roomIds, [], 'her room is gone, she is not');
  // the room that lost its number is still the same room
  assert.deepEqual(group(applied.project, '6A').days[A][1], { room: 'rsample204', roomText: '', label: 'French', teacherIds: ['tsample008'] });
});

test('building file: a slot holding only a number is given the room with that number', () => {
  const project = school();
  project.building.floors[1].spaces = project.building.floors[1].spaces.filter((space) => space.number !== '203');
  project.teachers[6].roomIds = [];
  for (const one of project.groups) {
    for (const dayTypeId of [A, B]) one.days[dayTypeId] = one.days[dayTypeId].map((slot) => (slot.room === 'rsample203' ? { ...slot, room: null, roomText: ' 203 ' } : slot));
  }
  assertValid(project);
  const applied = applyBuilding(project, readBuildingFile(writeBuildingFile(school())).file, context());
  assert.deepEqual(group(applied.project, '6A').days[A][7], { room: 'rsample203', roomText: '', label: '', teacherIds: [] });
  assert.deepEqual(applied.project.groups, school().groups);
});

test('building file: a subject the project does not have is added, once', () => {
  const project = emptyProject();
  const read = readBuildingFile(writeBuildingFile(school()));
  const applied = applyBuilding(project, read.file, context());
  assertValid(applied.project);
  assert.deepEqual(applied.summary.subjectsAdded, ['Library']);
  assert.equal(applied.project.subjects.length, project.subjects.length + 1);
  const math = project.subjects.find((subject) => subject.code === 'MATH');
  assert.equal(room(applied.project, '101').subjectId, math.id, 'Mathematics is matched by code and name');
  assert.equal(room(applied.project, 'Library').subjectId, 'ssample009', 'a new subject keeps the id it came with');
});

test('building file: importBuilding is one undo entry, and undo puts the old building and slots back', () => {
  const project = school();
  const store = storeOf(project);
  const read = readBuildingFile(writeBuildingFile(sibling()));
  const after = store.apply(actions.importBuilding, { file: read.file });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import a building file: 3 floors, 13 rooms');
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [1, 1, 1]);
  assertValid(after);
  store.undo();
  assert.equal(store.project.building, project.building);
  assert.equal(store.project.groups, project.groups);
});

test('building file: an import that cannot be done is an ActionError and changes nothing', () => {
  const project = school();
  const store = storeOf(project);
  assert.throws(() => store.apply(actions.importBuilding, {}), (error) => error instanceof actions.ActionError && /no building file/.test(error.message));
  // a file whose ids are already used here by something that is not a room
  const read = readBuildingFile(writeBuildingFile(school()));
  read.file.building.floors[0].id = 'tsample001';
  assert.throws(() => store.apply(actions.importBuilding, { file: read.file }), (error) => error instanceof actions.ActionError && error.code === 'invalid' && /nothing was changed/.test(error.message));
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
});

// ---------------------------------------------------------------- the schedule file

test('schedule file: export, import, export gives the same file', () => {
  for (const project of [school(), hostile(), emptyProject()]) {
    const first = writeScheduleFile(project);
    const read = readScheduleFile(first);
    const applied = applySchedule(project, read.file, { policy: { all: 'overwrite' }, ids: makeIds(9) });
    assert.equal(applied.project, project, 'its own schedule changes nothing');
    assert.equal(writeScheduleFile(applied.project), first);
  }
});

test('schedule file: export, import into a project with the building and no schedule, export gives the same file', () => {
  const project = hostile();
  const first = writeScheduleFile(project);
  const bare = clone(project);
  bare.groups = [];
  bare.teachers = [];
  bare.subjects = [];
  bare.dayTypes = [{ id: 'dblank000a', name: 'Day', own: true, bells: Array(8).fill(null) }];
  for (const floor of bare.building.floors) for (const space of floor.spaces) if (space.kind === 'room') Object.assign(space, { teacherIds: [], subjectId: null });
  assertValid(bare);
  const applied = applySchedule(bare, readScheduleFile(first).file, { ids: makeIds(9) });
  assertValid(applied.project);
  assert.deepEqual(applied.project.teachers, project.teachers);
  assert.deepEqual(applied.project.subjects, project.subjects);
  assert.deepEqual(applied.project.dayTypes.slice(1), project.dayTypes);
  assert.deepEqual(room(applied.project, 'Ω-1 "lab"').teacherIds, ['tsample001']);
  // the day type that was here stays, empty; leave it out to compare
  const again = { ...applied.project, dayTypes: applied.project.dayTypes.slice(1), groups: applied.project.groups.map((one) => ({ ...one, days: { [A]: one.days[A], [B]: one.days[B] } })) };
  assert.deepEqual(again.groups, project.groups);
  assert.equal(writeScheduleFile(again), first);
});

test('schedule file: it holds the school day, a room index, subjects, teachers, groups and day types', () => {
  const value = JSON.parse(writeScheduleFile(school()));
  assert.deepEqual(Object.keys(value), ['format', 'version', 'settings', 'rooms', 'subjects', 'teachers', 'groups', 'dayTypes']);
  assert.deepEqual([value.format, value.version], [SCHEDULE_FORMAT, 1]);
  assert.deepEqual(value.settings, { periods: 8, periodWord: 'Period', defaultPassingSeconds: 240, defaultHeadCount: 25 });
  assert.equal(value.rooms.length, 13);
  assert.deepEqual(value.rooms[0], { id: 'rsample101', number: '101' });
  assert.equal('building' in value, false);
});

test('schedule file: the room index lists only rooms the schedule names', () => {
  const project = school();
  for (const one of project.groups) for (const dayTypeId of [A, B]) one.days[dayTypeId] = one.days[dayTypeId].map((slot) => (slot.room === 'rsample303' ? { ...slot, room: null } : slot));
  teacher(project, 'Ms. O\'Fennimore').roomIds = [];
  room(project, '303').teacherIds = [];
  assertValid(project);
  assert.equal(JSON.parse(writeScheduleFile(project)).rooms.some((entry) => entry.number === '303'), false);
});

test('schedule file: a file saved at format 1 still reads, and writes back byte for byte', () => {
  const text = fixture('schedule-v1.json');
  const read = readScheduleFile(text);
  assert.deepEqual(read.summary, { periods: 8, subjects: 9, teachers: 12, groups: 8, dayTypes: 2 });
  const bare = { ...school(), groups: [] };
  const applied = applySchedule(bare, read.file, { ids: makeIds(9) });
  assert.equal(writeScheduleFile(applied.project), text);
});

test('schedule file: a newer one, a cut one, another kind and a shapeless one are each refused', () => {
  const value = JSON.parse(writeScheduleFile(school()));
  assert.throws(() => readScheduleFile(JSON.stringify({ ...value, version: 2 })), refusal('newer-version', NEWER));
  assert.throws(() => readScheduleFile(writeScheduleFile(school()).slice(0, 900)), refusal('not-json', NOT_JSON_MESSAGE));
  assert.throws(() => readScheduleFile(writeProjectFile(school())), refusal('wrong-kind', 'This is a project file, not a schedule file. It holds a whole project: import it as a project.'));
  assert.throws(() => readScheduleFile(writeBuildingFile(school())), refusal('wrong-kind', /^This is a building file, not a schedule file\./));
  for (const text of ['{}', '7', '{"format":"sv2-schedule","version":"1"}']) assert.throws(() => readScheduleFile(text), refusal('not-this-kind', NOT_A_SCHEDULE_MESSAGE), text);
  assert.throws(() => readScheduleFile('{"format":"sv2-schedule","version":1}'), refusal('invalid', /6 things in it are not as the format says\. The first: settings: /));
});

test('schedule file: a schedule that breaks a rule is refused whole, naming where', () => {
  const cases = [
    ['a slot in a room the index does not have', (v) => { v.groups[0].days[A][0].room = 'rnowhere00'; }, /groups\[0\]\.days\.dsample00a\[0\]\.room/],
    ['a day of 7 slots in a day of 8 periods', (v) => { v.groups[0].days[A].pop(); }, /groups\[0\]\.days\.dsample00a/],
    ['17 periods', (v) => { v.settings.periods = 17; }, /settings\.periods/],
    ['a missing setting', (v) => { delete v.settings.periodWord; }, /settings\.periodWord: This setting is missing\./],
    ['two teachers with one name', (v) => { v.teachers[1].name = v.teachers[0].name; }, /teachers\[1\]\.name/],
    ['a teacher in a room the index does not have', (v) => { v.teachers[0].roomIds.push('rnowhere00'); }, /teachers\[0\]\.roomIds\[1\]/],
    ['a slot naming a teacher who is not in the file', (v) => { v.groups[0].days[A][0].teacherIds = ['tnobody000']; }, /groups\[0\]\.days\.dsample00a\[0\]\.teacherIds\[0\]/],
    ['an index entry with no number', (v) => { delete v.rooms[2].number; }, /rooms\[2\]: A room in the index is \{ id, number \}\./],
    ['two index entries with one number', (v) => { v.rooms[1].number = '101'; }, /rooms\[1\]\.number/],
    ['a head count of 1000', (v) => { v.groups[0].headCount = 1000; }, /groups\[0\]\.headCount/],
    ['no day types', (v) => { v.dayTypes = []; }, /dayTypes/],
    ['groups that are not a list', (v) => { v.groups = {}; }, /groups: A schedule file holds a list here\./],
  ];
  for (const [name, breakIt, where] of cases) {
    const value = JSON.parse(writeScheduleFile(school()));
    breakIt(value);
    assert.throws(() => readScheduleFile(JSON.stringify(value)), refusal('invalid', where), name);
  }
});

test('schedule file: into an empty project, rooms that are not in the building are kept as text', () => {
  const project = emptyProject();
  const read = readScheduleFile(writeScheduleFile(school()));
  const applied = applySchedule(project, read.file, { ids: makeIds(9) });
  assertValid(applied.project);
  assert.deepEqual(applied.summary.created, ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B']);
  assert.equal(applied.summary.teachersAdded.length, 12);
  assert.deepEqual(applied.summary.subjectsAdded, ['Library']);
  assert.deepEqual(applied.summary.dayTypesAdded, []);
  assert.equal(applied.summary.roomsLeftOff, 12);
  assert.equal(applied.summary.unknownRooms.length, 13);
  const first = group(applied.project, '6A');
  assert.equal(first.id, 'gsample06a', 'a new group keeps the id it came with');
  assert.deepEqual(first.days[project.dayTypes[0].id][0], { room: null, roomText: '201', label: '', teacherIds: [] });
  assert.deepEqual(first.days[project.dayTypes[0].id][3], { room: null, roomText: 'Cafeteria', label: 'Lunch', teacherIds: [] });
  // B Day was the same as A Day here and has its own rooms in the file
  assert.equal(applied.project.dayTypes[1].own, true);
  assert.equal(first.days[project.dayTypes[1].id][1].roomText, '204');
  assert.deepEqual(applied.project.dayTypes[1].bells, school().dayTypes[1].bells);
  assert.deepEqual(teacher(applied.project, 'Ms. Halloran').roomIds, []);
});

test('schedule file: into a building with other ids, rooms are matched by number', () => {
  const project = sibling();
  project.groups = [];
  const read = readScheduleFile(writeScheduleFile(school()));
  const applied = applySchedule(project, read.file, { ids: makeIds(9) });
  assertValid(applied.project);
  assert.deepEqual(applied.summary.unknownRooms, []);
  assert.equal(group(applied.project, '6A').days.dother000a[0].room, 'rother0201');
  assert.deepEqual(applied.summary.teachersAdded, [], 'teachers are matched by name');
  assert.deepEqual(applied.summary.dayTypesAdded, [], 'day types are matched by name');
});

test('schedule file: a clash is answered by skip, overwrite or rename, as for a CSV', () => {
  const project = school();
  const other = school();
  group(other, '6A').grade = 'Sixth';
  group(other, '6A').days[A][0] = { room: 'rsample101', roomText: '', label: 'Maths', teacherIds: ['tsample002'] };
  const file = readScheduleFile(writeScheduleFile(other)).file;

  const skipped = applySchedule(project, file, { ids: makeIds(9) });
  assert.equal(skipped.project, project);
  assert.equal(skipped.summary.skipped.length, 8);

  const overwritten = applySchedule(project, file, { policy: { all: 'skip', per: { '6a': 'overwrite' } }, ids: makeIds(9) });
  const after = group(overwritten.project, '6A');
  assert.deepEqual([after.id, after.grade], ['gsample06a', 'Sixth']);
  assert.deepEqual(after.days[A][0], { room: 'rsample101', roomText: '', label: 'Maths', teacherIds: ['tsample002'] });
  assert.equal(after.days[A][1], group(project, '6A').days[A][1], 'a slot that is the same stays the same object');
  assert.deepEqual(overwritten.summary.overwritten, ['6A']);

  const renamed = applySchedule(project, file, { policy: { all: 'skip', per: { '6a': 'rename' } }, ids: makeIds(9) });
  assert.equal(renamed.project.groups.length, 9);
  const copy = group(renamed.project, '6A (2)');
  assert.notEqual(copy.id, 'gsample06a');
  assert.match(copy.id, /^g[a-z0-9]{9}$/);
  assert.equal(copy.days[A][0].label, 'Maths');
  assertValid(renamed.project);
});

test('schedule file: a longer school day in the file makes the day here longer and cuts nothing', () => {
  const project = school();
  const other = school();
  other.settings.periods = 9;
  for (const dayType of other.dayTypes) dayType.bells.push(null);
  for (const one of other.groups) for (const dayTypeId of [A, B]) one.days[dayTypeId].push({ room: 'rsamplelib', roomText: '', label: 'Study', teacherIds: [] });
  assertValid(other);
  const applied = applySchedule(project, readScheduleFile(writeScheduleFile(other)).file, { policy: { all: 'overwrite' }, ids: makeIds(9) });
  assertValid(applied.project);
  assert.equal(applied.project.settings.periods, 9);
  assert.deepEqual(applied.summary.periodsRaised, { from: 8, to: 9 });
  assert.equal(group(applied.project, '8B').days[B][8].label, 'Study');
});

test('schedule file: a shorter school day in the file leaves the later periods as they are', () => {
  const project = school();
  const other = school();
  other.settings.periods = 6;
  for (const dayType of other.dayTypes) dayType.bells.length = 6;
  for (const one of other.groups) for (const dayTypeId of [A, B]) one.days[dayTypeId].length = 6;
  group(other, '6A').days[A][0].label = 'New';
  assertValid(other);
  const applied = applySchedule(project, readScheduleFile(writeScheduleFile(other)).file, { policy: { all: 'overwrite' }, ids: makeIds(9) });
  assert.equal(applied.project.settings.periods, 8);
  assert.equal(group(applied.project, '6A').days[A][0].label, 'New');
  assert.equal(group(applied.project, '6A').days[A][7], group(project, '6A').days[A][7]);
  assertValid(applied.project);
});

test('schedule file: a bell time entered here is never changed, and an empty one is filled', () => {
  const project = school();
  project.dayTypes[0].bells[0] = { start: '07:30', end: '08:10' };
  project.dayTypes[0].bells[1] = null;
  const applied = applySchedule(project, readScheduleFile(writeScheduleFile(school())).file, { ids: makeIds(9) });
  assert.deepEqual(applied.project.dayTypes[0].bells[0], { start: '07:30', end: '08:10' });
  assert.deepEqual(applied.project.dayTypes[0].bells[1], school().dayTypes[0].bells[1]);
  assert.equal(applied.project.groups, project.groups);
});

test('schedule file: the period word and the defaults are taken only when asked', () => {
  const other = school();
  other.settings.periodWord = 'Block';
  other.settings.defaultHeadCount = 30;
  const file = readScheduleFile(writeScheduleFile(other)).file;
  assert.equal(applySchedule(school(), file, { ids: makeIds(9) }).project.settings.periodWord, 'Period');
  const taken = applySchedule(school(), file, { takeSettings: true, ids: makeIds(9) });
  assert.deepEqual([taken.project.settings.periodWord, taken.project.settings.defaultHeadCount, taken.project.settings.defaultPassingSeconds], ['Block', 30, 240]);
  assert.deepEqual(taken.summary.settingsTaken, ['periodWord', 'defaultHeadCount']);
});

test('schedule file: a day type the project does not have is added, with its bells and every group\'s day', () => {
  const project = school();
  const other = school();
  other.dayTypes[1] = { ...other.dayTypes[1], id: 'dhalfday00', name: 'Half Day' };
  for (const one of other.groups) {
    one.days.dhalfday00 = one.days[B];
    delete one.days[B];
  }
  group(other, '6A').days.dhalfday00[0].label = 'Assembly';
  assertValid(other);
  const applied = applySchedule(project, readScheduleFile(writeScheduleFile(other)).file, { policy: { all: 'overwrite' }, ids: makeIds(9) });
  assertValid(applied.project);
  assert.deepEqual(applied.summary.dayTypesAdded, ['Half Day']);
  assert.equal(applied.project.dayTypes.length, 3);
  const added = applied.project.dayTypes[2];
  assert.equal(added.own, true);
  assert.deepEqual(added.bells, other.dayTypes[1].bells);
  assert.equal(group(applied.project, '6A').days[added.id][0].label, 'Assembly');
  assert.equal(added.id, 'dhalfday00');
  assert.equal(group(applied.project, '6A').days[B][0], group(project, '6A').days[B][0], 'B Day here is untouched');
});

test('schedule file: a day type renamed in the file is still the day type with that id here', () => {
  const other = school();
  other.dayTypes[1].name = 'Half Day';
  const applied = applySchedule(school(), readScheduleFile(writeScheduleFile(other)).file, { policy: { all: 'overwrite' }, ids: makeIds(9) });
  assert.deepEqual(applied.summary.dayTypesAdded, []);
  assert.equal(applied.project.dayTypes[1].name, 'B Day', 'what matches is left as it is here');
});

test('schedule file: names with quotes and in a non-Latin script survive unchanged', () => {
  const project = hostile();
  const applied = applySchedule(emptyProject(), readScheduleFile(writeScheduleFile(project)).file, { ids: makeIds(9) });
  assert.deepEqual(applied.project.groups.map((one) => one.name).slice(0, 2), ['The "Owls", <9A>', '七年级一班']);
  assert.equal(applied.project.teachers[0].name, 'Г-жа Соколова');
  assert.ok(applied.summary.unknownRooms.includes('Ω-1 "lab"'));
});

test('schedule file: importSchedule is one undo entry, and undo puts everything back', () => {
  const project = emptyProject();
  const store = storeOf(project);
  const file = readScheduleFile(fixture('schedule-v1.json')).file;
  const after = store.apply(actions.importSchedule, { file });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import a schedule file: 8 groups added');
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 1, 1]);
  assertValid(after);
  assert.equal(after.groups.length, 8);
  store.undo();
  assert.deepEqual([store.project.groups, store.project.teachers, store.project.dayTypes], [project.groups, project.teachers, project.dayTypes]);
});

test('schedule file: an import that cannot be done is an ActionError and changes nothing', () => {
  const project = school();
  const store = storeOf(project);
  assert.throws(() => store.apply(actions.importSchedule, {}), (error) => error instanceof actions.ActionError && /no schedule file/.test(error.message));
  const file = readScheduleFile(writeScheduleFile(school())).file;
  assert.throws(() => store.apply(actions.importSchedule, { file, policy: { all: 'replace' } }), (error) => error instanceof actions.ActionError && error.code === 'bad-policy');
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
  // and one that changes nothing makes no entry
  store.apply(actions.importSchedule, { file });
  assert.equal(store.history.past.length, 0);
});

test('no reader or writer changes what it is given', () => {
  const project = hostile();
  const before = clone(project);
  const building = readBuildingFile(writeBuildingFile(project, { images: IMAGES }));
  const schedule = readScheduleFile(writeScheduleFile(project));
  const frozen = [clone(building.file), clone(schedule.file)];
  applyBuilding(project, building.file, context());
  applySchedule(project, schedule.file, { policy: { all: 'rename' }, ids: makeIds(9) });
  writeProjectFile(project, { images: IMAGES });
  assert.deepEqual(project, before);
  assert.deepEqual([building.file, schedule.file], frozen);
});
