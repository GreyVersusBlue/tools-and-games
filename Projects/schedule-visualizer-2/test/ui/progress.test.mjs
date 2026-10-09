// Getting started: which of the five steps a project has done.
//
//   node test/ui/progress.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { progress, showGettingStarted, STEPS } from '../../ui/help/progress.js';
import { newProject, newRoom } from '../../engine/schema.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';

const clock = () => new Date('2026-09-01T12:00:00Z');
const empty = () => newProject(createIds(seededRandom(1)), clock);
const done = (project) => Object.fromEntries(progress(project).map((step) => [step.id, step.done]));

// Floor 1 with a corridor along row 2 and one room above it.
function withFloor(project, number) {
  const floor = project.building.floors[0];
  const cells = floor.cells.split('');
  for (let x = 0; x < 6; x += 1) cells[2 * floor.width + x] = '#';
  const room = newRoom('rtest00001', [floor.width + 1]);
  room.number = number;
  project.building.floors[0] = { ...floor, cells: cells.join(''), spaces: [room] };
  return project;
}

test('the five steps of spec 14, in order, each with an address', () => {
  assert.deepEqual(STEPS.map((step) => [step.id, step.label, step.hash]), [
    ['floor', 'Draw or trace a floor', '#building'],
    ['rooms', 'Number the rooms', '#building'],
    ['teachers', 'Add teachers', '#schedule/teachers'],
    ['groups', 'Add groups', '#schedule/groups'],
    ['movement', 'Look at the movement view', '#movement'],
  ]);
});

test('an empty project has nothing ticked', () => {
  assert.deepEqual(done(empty()), { floor: false, rooms: false, teachers: false, groups: false, movement: false });
});

test('the sample school has everything but the movement view', () => {
  assert.deepEqual(done(sampleSchool()), { floor: true, rooms: true, teachers: true, groups: true, movement: false });
});

test('a floor needs a corridor and a room; one without the other is not drawn', () => {
  const corridorOnly = withFloor(empty(), '101');
  corridorOnly.building.floors[0].spaces = [];
  assert.equal(done(corridorOnly).floor, false);
  const roomOnly = withFloor(empty(), '101');
  roomOnly.building.floors[0].cells = '.'.repeat(roomOnly.building.floors[0].cells.length);
  assert.equal(done(roomOnly).floor, false);
  assert.equal(done(withFloor(empty(), '101')).floor, true);
});

test('the rooms are numbered when there is a room and none is without a number', () => {
  assert.equal(done(empty()).rooms, false, 'no rooms at all is not "every room numbered"');
  assert.equal(done(withFloor(empty(), '')).rooms, false);
  assert.equal(done(withFloor(empty(), '   ')).rooms, false, 'spaces are not a number');
  assert.equal(done(withFloor(empty(), '101')).rooms, true);
});

test('an other space is not a room: it needs no number and does not make a floor drawn', () => {
  const project = withFloor(empty(), '101');
  project.building.floors[0].spaces.push({ id: 'otest00001', kind: 'other', cells: [3], label: '', otherKind: 'office', colour: '#9aa3ad' });
  assert.equal(done(project).rooms, true);
  project.building.floors[0].spaces.shift();
  assert.equal(done(project).floor, false);
  assert.equal(done(project).rooms, false);
});

test('a teacher ticks teachers', () => {
  const project = empty();
  project.teachers.push({ id: 'ttest00001', name: 'Mx. Quillfeather', subjectId: null, roomIds: [], notes: '' });
  assert.equal(done(project).teachers, true);
});

test('a group counts once it has a room that is in the building', () => {
  const project = withFloor(empty(), '101');
  const dayTypeId = project.dayTypes[0].id;
  const slots = () => Array.from({ length: project.settings.periods }, () => ({ room: null, roomText: '', label: '', teacherIds: [] }));
  project.groups.push({ id: 'gtest00001', name: '7-1', grade: '7', headCount: null, colour: '#d1495b', days: { [dayTypeId]: slots() } });
  assert.equal(done(project).groups, false, 'a group with no rooms');
  project.groups[0].days[dayTypeId][2] = { room: null, roomText: '999', label: '', teacherIds: [] };
  assert.equal(done(project).groups, false, 'a room number that is not in the building');
  project.groups[0].days[dayTypeId][2] = { room: 'rgone00001', roomText: '204', label: '', teacherIds: [] };
  assert.equal(done(project).groups, false, 'a room that was deleted');
  project.groups[0].days[dayTypeId][2] = { room: 'rtest00001', roomText: '', label: '', teacherIds: [] };
  assert.equal(done(project).groups, true);
});

test('the movement step is ticked by the movement view, through onboarding.steps', () => {
  const project = empty();
  project.onboarding.steps.movement = true;
  assert.equal(done(project).movement, true);
  project.onboarding.steps.movement = 'yes';
  assert.equal(done(project).movement, false, 'only true counts');
});

test('the card shows until it is dismissed or never wanted again', () => {
  const project = empty();
  assert.equal(showGettingStarted(project), true);
  project.onboarding.dismissed = true;
  assert.equal(showGettingStarted(project), false);
  project.onboarding.dismissed = false;
  project.onboarding.neverShow = true;
  assert.equal(showGettingStarted(project), false);
});
