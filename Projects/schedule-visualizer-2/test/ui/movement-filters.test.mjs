// Movement's filters and addresses, the pure parts (SV2-151; ARCHITECTURE 23.7
// and 23.12): ui/movement/filters.js (`walkMatches`, `filteredRoutes`,
// `destinationWords`) and ui/movement/address.js (`readMovementAddress`,
// `movementHash`, `movementRest`). No page: plain Node.
//
// The building is the two-halls fixture (test/fixtures/buildings/two-halls.mjs):
// eight groups crossing between a west hall of four rooms and an east hall of
// four, with subjects given to the rooms here so the filters have something to
// tell apart. The loads of a filtered result are checked against loads() of
// routes picked out by a second rule that reads the route objects themselves
// (where each route ends) and not the slots the filter reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { loads } from '../../engine/load.js';
import { createPipeline, runResults } from '../../engine/worker.js';
import { emptySlot, findRoom } from '../../engine/schema.js';
import { routesOfRun } from '../../ui/movement/model.js';
import { walkMatches, filteredRoutes, destinationWords } from '../../ui/movement/filters.js';
import { readMovementAddress, movementHash, movementRest, MOVEMENT_HASH } from '../../ui/movement/address.js';
import { assertValid } from '../engine/helpers.mjs';
import { roomId } from '../fixtures/buildings/plans.mjs';
import { twoHalls } from '../fixtures/buildings/two-halls.mjs';

const VERSIONS = { geometry: 1, building: 1, schedule: 1 };

// Science in 1A and the east hall's 1E and 1F, Art in 1G, no subject in the rest
function withSubjects(project) {
  const [science, art] = project.subjects;
  const set = (number, subject) => { findRoom(project, roomId(number)).subjectId = subject.id; };
  set('1A', science);
  set('1E', science);
  set('1F', science);
  set('1G', art);
  project.subjects[0].name = 'Sci <i>& "Tech"</i>';
  return { project, science, art };
}

function plan(options) {
  const made = withSubjects(twoHalls({ periods: 4, ...(options || {}) }));
  assertValid(made.project);
  return made;
}

function textOf(parts) {
  return parts.map((part) => part.text).join('');
}

function slotIn(number) {
  return { ...emptySlot(), room: roomId(number) };
}

// ---- walkMatches

test('walkMatches: with neither filter every slot passes, the empty one and the missing room too', () => {
  const { project } = plan();
  for (const filter of [{}, { toRoomId: null, subjectId: null }, undefined, { toRoomId: '' }]) {
    assert.equal(walkMatches(project, slotIn('1A'), filter), true);
    assert.equal(walkMatches(project, emptySlot(), filter), true);
    assert.equal(walkMatches(project, { ...emptySlot(), roomText: '999' }, filter), true);
  }
});

test('walkMatches: a destination room passes only that room', () => {
  const { project } = plan();
  assert.equal(walkMatches(project, slotIn('1E'), { toRoomId: roomId('1E') }), true);
  assert.equal(walkMatches(project, slotIn('1F'), { toRoomId: roomId('1E') }), false);
  assert.equal(walkMatches(project, emptySlot(), { toRoomId: roomId('1E') }), false, 'a slot with no room');
  assert.equal(walkMatches(project, { ...emptySlot(), roomText: '999' }, { toRoomId: roomId('1E') }), false, 'a room not in the building matches no room');
});

test('walkMatches: a subject passes the rooms of that subject, and "" the rooms with none', () => {
  const { project, science, art } = plan();
  assert.equal(walkMatches(project, slotIn('1E'), { subjectId: science.id }), true);
  assert.equal(walkMatches(project, slotIn('1G'), { subjectId: science.id }), false);
  assert.equal(walkMatches(project, slotIn('1G'), { subjectId: art.id }), true);
  assert.equal(walkMatches(project, slotIn('1B'), { subjectId: '' }), true, '1B has no subject');
  assert.equal(walkMatches(project, slotIn('1E'), { subjectId: '' }), false, '1E has one');
  assert.equal(walkMatches(project, slotIn('1B'), { subjectId: science.id }), false);
});

test('walkMatches: a room not in the building passes the "" subject only, an empty slot passes neither', () => {
  const { project, science } = plan();
  const missing = { ...emptySlot(), roomText: '999' };
  assert.equal(walkMatches(project, missing, { subjectId: '' }), true);
  assert.equal(walkMatches(project, missing, { subjectId: science.id }), false);
  assert.equal(walkMatches(project, emptySlot(), { subjectId: '' }), false);
  assert.equal(walkMatches(project, emptySlot(), { subjectId: science.id }), false);
});

test('walkMatches: both filters together are both, a room and its subject', () => {
  const { project, science, art } = plan();
  const both = (number, subjectId) => walkMatches(project, slotIn(number), { toRoomId: roomId('1E'), subjectId });
  assert.equal(both('1E', science.id), true);
  assert.equal(both('1E', art.id), false, 'the room is Science');
  assert.equal(both('1F', science.id), false, 'the subject is right, the room is not');
  assert.equal(both('1E', ''), false);
});

test('walkMatches: a room with a subject id the list does not hold is a room of that id, and is not "no subject"', () => {
  const { project } = plan();
  findRoom(project, roomId('1B')).subjectId = 'sgone00000';
  assert.equal(walkMatches(project, slotIn('1B'), { subjectId: 'sgone00000' }), true);
  assert.equal(walkMatches(project, slotIn('1B'), { subjectId: '' }), false);
});

// ---- filteredRoutes

function runOf(project, bellsId) {
  const results = createPipeline().run(project, VERSIONS);
  const found = runResults(results, project.dayTypes[0].id, bellsId || null);
  return { results, entry: found.routes };
}

// Which routes end in a room that passes, read off the route objects: the
// second rule the filter is held to. A walk is a route that goes somewhere.
function endsIn(project, choice) {
  const subjectOf = (id) => {
    const room = findRoom(project, id);
    return typeof room.subjectId === 'string' ? room.subjectId : '';
  };
  return (found) => {
    if (!found || found.same === true) return false;
    if (found.ok === false) return found.reason === 'room-missing' && found.end === 'to' && choice.toRoomId === undefined && choice.subjectId === '';
    if (choice.toRoomId !== undefined && found.toRoomId !== choice.toRoomId) return false;
    if (choice.subjectId !== undefined && subjectOf(found.toRoomId) !== choice.subjectId) return false;
    return true;
  };
}

function picked(entry, matches) {
  return entry.groups.map((group) => ({ ...group, routes: group.routes.map((found) => (matches(found) ? found : null)) }));
}

function asserted(project, run, choice) {
  const graph = buildGraph(project);
  const result = filteredRoutes(project, run, run.groups, choice);
  assert.equal(result.days.length, 1);
  const kept = result.days[0];
  const rule = endsIn(project, choice);
  kept.groups.forEach((group, g) => {
    group.routes.forEach((found, t) => {
      const was = run.groups[g].routes[t];
      if (rule(was)) assert.equal(found, was, 'a route that passes is the run\'s own object');
      else assert.equal(found, null, 'group ' + g + ' transition ' + t + ' does not pass');
    });
  });
  const dayTypeId = run.dayTypeId;
  assert.deepEqual(loads(project, result, dayTypeId, graph), loads(project, routesOfRun(run, picked(run, rule)), dayTypeId, graph), 'the loads are those of the matching routes alone');
  return { result, graph, count: kept.groups.reduce((n, group) => n + group.routes.filter(Boolean).length, 0) };
}

test('filteredRoutes: a destination room keeps the walks into it, the run\'s own route objects, and loads() counts only them', () => {
  const { project } = plan();
  const { entry } = runOf(project);
  const { count } = asserted(project, entry, { toRoomId: roomId('1E') });
  // West 1 walks into 1E in the first and third transitions (1A, 1E, 1A, 1E) and East 1, whose own room it is, in the second
  assert.equal(count, 3);
});

test('filteredRoutes: a subject keeps the walks into rooms of it, "" the walks into rooms with none', () => {
  const { project, science, art } = plan();
  const { entry } = runOf(project);
  const into = (choice) => asserted(project, entry, choice).count;
  const everyWalk = entry.groups.reduce((n, group) => n + group.routes.filter((found) => found && found.ok && found.same !== true).length, 0);
  const sci = into({ subjectId: science.id });
  const arts = into({ subjectId: art.id });
  const none = into({ subjectId: '' });
  assert.ok(sci > 0 && arts > 0 && none > 0, 'each kind has walks: ' + [sci, arts, none]);
  assert.equal(sci + arts + none, everyWalk, 'every walk goes into a room of exactly one of the three');
});

test('filteredRoutes: both filters are both', () => {
  const { project, science } = plan();
  const { entry } = runOf(project);
  assert.equal(asserted(project, entry, { toRoomId: roomId('1E'), subjectId: science.id }).count, asserted(project, entry, { toRoomId: roomId('1E') }).count);
  assert.equal(asserted(project, entry, { toRoomId: roomId('1G'), subjectId: science.id }).count, 0, '1G is Art');
});

test('filteredRoutes: a room that is not in the building (a deleted one) keeps nothing, and the loads are empty', () => {
  const { project } = plan();
  const { entry } = runOf(project);
  const { result, graph, count } = asserted(project, entry, { toRoomId: 'rgone000000' });
  assert.equal(count, 0);
  assert.equal(loads(project, result, entry.dayTypeId, graph).max.busiest, 0);
});

test('filteredRoutes: a group already in the room is not walking into it', () => {
  const { project } = plan({ pattern: 'hhhh' });
  const { entry } = runOf(project);
  assert.ok(entry.groups.every((group) => group.routes.every((found) => found.same === true)), 'nobody walks');
  assert.equal(asserted(project, entry, { toRoomId: roomId('1A') }).count, 0);
});

test('filteredRoutes: a slot whose room is not in the building matches the "" subject only, and its failed route is kept for route health', () => {
  const { project, science } = plan({ pattern: 'hahh' });
  project.groups[0].days[project.dayTypes[0].id][1] = { ...emptySlot(), roomText: '999' };
  const { entry } = runOf(project);
  const failed = entry.groups[0].routes[0];
  assert.equal(failed.reason, 'room-missing');
  const keep = (choice) => filteredRoutes(project, entry, entry.groups, choice).days[0].groups[0].routes[0];
  assert.equal(keep({ subjectId: '' }), failed, 'a room with no subject');
  assert.equal(keep({ subjectId: science.id }), null);
  assert.equal(keep({ toRoomId: roomId('1E') }), null);
});

test('filteredRoutes: a period with no room is nothing walked out of or into', () => {
  const { project } = plan({ pattern: 'hahh' });
  project.groups[0].days[project.dayTypes[0].id][1] = emptySlot();
  const { entry } = runOf(project);
  assert.equal(entry.groups[0].routes[0].reason, 'no-room');
  for (const choice of [{ subjectId: '' }, { toRoomId: roomId('1A') }]) {
    assert.deepEqual(filteredRoutes(project, entry, entry.groups, choice).days[0].groups[0].routes.slice(0, 2), [null, null]);
  }
});

test('filteredRoutes: groups left out are left out, and the project\'s group objects are read by id', () => {
  const { project } = plan();
  const { entry } = runOf(project);
  const choice = { subjectId: '' };
  const some = filteredRoutes(project, entry, entry.groups.slice(0, 2), choice).days[0].groups;
  assert.deepEqual(some.map((group) => group.groupId), [entry.groups[0].groupId, entry.groups[1].groupId]);
  const byProject = filteredRoutes(project, entry, [project.groups[1], project.groups[0]], choice).days[0].groups;
  assert.deepEqual(byProject.map((group) => group.groupId), [project.groups[1].id, project.groups[0].id]);
  assert.deepEqual(byProject[0].routes, some[1].routes);
});

test('filteredRoutes: with no filter the run\'s own entries come back, and the run\'s fields with them', () => {
  const { project } = plan();
  const { entry } = runOf(project);
  const result = filteredRoutes(project, entry, entry.groups, { toRoomId: null, subjectId: null });
  assert.equal(result.days[0].groups[0], entry.groups[0]);
  assert.equal(result.days[0].dayTypeId, entry.dayTypeId);
});

test('filteredRoutes: a bell schedule\'s run is { days: [], bells: [entry] }, and a walk over a period that does not meet is judged by the period it reaches', () => {
  const { project } = plan({ pattern: 'hhah' });
  const dayType = project.dayTypes[0];
  project.bellSchedules = [{ id: 'bplan000as', name: 'Assembly', short: '', bells: dayType.bells.map(() => null), off: [1] }];
  assertValid(project);
  const { entry } = runOf(project, 'bplan000as');
  assert.equal(entry.bellsId, 'bplan000as');
  const west1 = entry.groups[0];
  assert.equal(west1.routes[0].toRoomId, roomId('1E'), 'West 1 walks from period 0 to period 2, over the one that does not meet');
  const result = filteredRoutes(project, entry, entry.groups, { toRoomId: roomId('1E') });
  assert.deepEqual(result.days, []);
  assert.equal(result.bells.length, 1);
  const routes = result.bells[0].groups[0].routes;
  assert.equal(routes[0], west1.routes[0], 'into 1E, kept');
  assert.equal(routes[1], null, 'out of the period that does not meet is no walk');
  assert.equal(routes[2], null, 'period 2 to 3 is into 1A');
  assert.deepEqual(loads(project, result, entry.dayTypeId, buildGraph(project), 'bplan000as').transitions, 3);
});

// ---- destinationWords

test('destinationWords: nothing without a filter', () => {
  const { project } = plan();
  assert.deepEqual(destinationWords(project, {}), []);
  assert.deepEqual(destinationWords(project, { toRoomId: null, subjectId: null }), []);
});

test('destinationWords: a room, a subject, no subject; the names typed are marked and given as typed', () => {
  const { project, science } = plan();
  const room = destinationWords(project, { toRoomId: roomId('1E') });
  assert.equal(textOf(room), 'into Room 1E');
  assert.deepEqual(room.filter((part) => part.name).map((part) => part.text), ['1E']);
  const subject = destinationWords(project, { subjectId: science.id });
  assert.equal(textOf(subject), 'into Sci <i>& "Tech"</i> rooms');
  assert.deepEqual(subject.filter((part) => part.name).map((part) => part.text), ['Sci <i>& "Tech"</i>']);
  assert.equal(textOf(destinationWords(project, { subjectId: '' })), 'into rooms with no subject');
});

test('destinationWords: a room named by a word is given as typed, and one with no number says so', () => {
  const { project } = plan();
  findRoom(project, roomId('1E')).number = 'Gym';
  assert.equal(textOf(destinationWords(project, { toRoomId: roomId('1E') })), 'into Gym');
  findRoom(project, roomId('1E')).number = '';
  assert.equal(textOf(destinationWords(project, { toRoomId: roomId('1E') })), 'into a room with no number');
  findRoom(project, roomId('1E')).number = 'Room 204';
  assert.equal(textOf(destinationWords(project, { toRoomId: roomId('1E') })), 'into Room 204', 'typed whole, never "Room Room 204"');
});

test('destinationWords: both together, and ids that are gone are said so and never skipped', () => {
  const { project, science } = plan();
  assert.equal(textOf(destinationWords(project, { toRoomId: roomId('1E'), subjectId: science.id })), 'into Room 1E, if it is a Sci <i>& "Tech"</i> room');
  assert.equal(textOf(destinationWords(project, { toRoomId: roomId('1E'), subjectId: '' })), 'into Room 1E, if it is a room with no subject');
  assert.equal(textOf(destinationWords(project, { toRoomId: 'rgone000000' })), 'into a room that is no longer in the building');
  assert.equal(textOf(destinationWords(project, { subjectId: 'sgone00000' })), 'into rooms of a subject that is no longer listed');
});

// ---- addresses

function teacherProject() {
  const { project } = plan();
  project.teachers = [{ id: 'tplan00001', name: 'Ms. Okafor', subjectId: null, roomIds: [], notes: '' }, { id: 'tplan/2 ?#', name: 'Mx. Tarn', subjectId: null, roomIds: [], notes: '' }];
  return project;
}

test('address: a teacher, with a day type, with a period; the transition out of the period', () => {
  const project = teacherProject();
  const day = project.dayTypes[0].id;
  assert.deepEqual(readMovementAddress(project, 'teacher/tplan00001'), { who: 'teacher', teacherId: 'tplan00001' });
  assert.deepEqual(readMovementAddress(project, 'teacher/tplan00001/' + day), { who: 'teacher', teacherId: 'tplan00001', dayTypeId: day });
  assert.deepEqual(readMovementAddress(project, 'teacher/tplan00001/' + day + '/2'), { who: 'teacher', teacherId: 'tplan00001', dayTypeId: day, transition: 2 });
});

test('address: a room to go to', () => {
  const project = teacherProject();
  assert.deepEqual(readMovementAddress(project, 'to/' + roomId('1E')), { toRoomId: roomId('1E') });
});

test('address: unknown ids read as null; an unknown day type or period is left out and the teacher is still read', () => {
  const project = teacherProject();
  const day = project.dayTypes[0].id;
  assert.equal(readMovementAddress(project, 'teacher/tgone000000'), null);
  assert.equal(readMovementAddress(project, 'teacher/'), null);
  assert.equal(readMovementAddress(project, 'to/rgone000000'), null);
  assert.equal(readMovementAddress(project, 'to/'), null);
  assert.deepEqual(readMovementAddress(project, 'teacher/tplan00001/dgone000000/1'), { who: 'teacher', teacherId: 'tplan00001' }, 'a day type that is gone takes its period with it');
  for (const period of ['3', '7', '-1', 'x', '1.5', '']) {
    assert.deepEqual(readMovementAddress(project, 'teacher/tplan00001/' + day + '/' + period), { who: 'teacher', teacherId: 'tplan00001', dayTypeId: day }, 'period ' + JSON.stringify(period) + ' has no walk out of it (4 periods)');
  }
});

test('address: nothing else is an address of the view', () => {
  const project = teacherProject();
  for (const rest of ['', 'groups', 'teacher', 'to', 'who/tplan00001', 'Teacher/tplan00001']) assert.equal(readMovementAddress(project, rest), null, JSON.stringify(rest));
  assert.equal(readMovementAddress(project, undefined), null);
  assert.equal(readMovementAddress(project, null), null);
});

test('address: a day type that is the same as another gives the day it copies', () => {
  const project = teacherProject();
  const follower = project.dayTypes.find((dayType) => !dayType.own);
  assert.ok(follower, 'the fixture has one');
  assert.equal(readMovementAddress(project, 'teacher/tplan00001/' + follower.id).dayTypeId, project.dayTypes[0].id);
});

test('address: movementHash writes them, and a read written and read again is the same', () => {
  const project = teacherProject();
  const day = project.dayTypes[0].id;
  const cases = [
    ['teacher/tplan00001', '#movement/teacher/tplan00001'],
    ['teacher/tplan00001/' + day, '#movement/teacher/tplan00001/' + day],
    ['teacher/tplan00001/' + day + '/0', '#movement/teacher/tplan00001/' + day + '/0'],
    ['teacher/tplan00001/' + day + '/2', '#movement/teacher/tplan00001/' + day + '/2'],
    ['to/' + roomId('1E'), '#movement/to/' + roomId('1E')],
  ];
  for (const [rest, hash] of cases) {
    const read = readMovementAddress(project, rest);
    assert.equal(movementHash(read), hash);
    assert.equal(movementRest(hash), rest);
    assert.deepEqual(readMovementAddress(project, movementRest(movementHash(read))), read);
  }
});

test('address: an id with a slash, a question mark or a hash in it is encoded and comes back whole', () => {
  const project = teacherProject();
  const hash = movementHash({ who: 'teacher', teacherId: 'tplan/2 ?#' });
  assert.equal(hash, '#movement/teacher/tplan%2F2%20%3F%23');
  assert.deepEqual(readMovementAddress(project, movementRest(hash)), { who: 'teacher', teacherId: 'tplan/2 ?#' });
});

test('address: a whole choice of the view is written as the teacher\'s address, or the room\'s, or the view\'s own', () => {
  const project = teacherProject();
  const day = project.dayTypes[0].id;
  assert.equal(movementHash({ who: 'teacher', teacherId: 'tplan00001', dayTypeId: day, transition: null, toRoomId: roomId('1E') }), '#movement/teacher/tplan00001/' + day, 'a teacher\'s day hides the destination');
  assert.equal(movementHash({ who: 'all', teacherId: null, toRoomId: roomId('1E'), dayTypeId: day }), '#movement/to/' + roomId('1E'));
  assert.equal(movementHash({ who: 'teacher', teacherId: null, toRoomId: roomId('1E') }), '#movement', 'who is teacher with nobody chosen: nothing to write');
  assert.equal(movementHash({ who: 'all', toRoomId: null }), MOVEMENT_HASH);
  assert.equal(movementHash({ who: 'teacher', teacherId: 'tplan00001', transition: 2 }), '#movement/teacher/tplan00001', 'a transition with no day type is not written');
  assert.equal(movementHash(null), MOVEMENT_HASH);
});

test('address: movementRest tells the section\'s addresses from the others', () => {
  assert.equal(movementRest('#movement'), '');
  assert.equal(movementRest('#movement/'), '');
  assert.equal(movementRest('#/movement/to/r1'), 'to/r1');
  assert.equal(movementRest('#movement/teacher/t1/d1/2'), 'teacher/t1/d1/2');
  assert.equal(movementRest('#schedule/groups'), null);
  assert.equal(movementRest('#movements'), null);
  assert.equal(movementRest(''), null);
});
