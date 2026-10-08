// Shared by the engine tests: a pinned clock, seeded ids, and small ways to
// get a project to work on. Nothing here reads the machine's time or zone.

import assert from 'node:assert/strict';
import { createIds, seededRandom } from '../../engine/ids.js';
import { newProject } from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { sampleSchool } from '../../data/sample-school.js';

export const PINNED = '2026-09-01T12:00:00.000Z';

export function clock() {
  return new Date('2026-09-01T12:00:00Z');
}

// A clock that moves on one second every time it is read.
export function tickingClock() {
  let seconds = 0;
  return () => {
    seconds += 1;
    return new Date(Date.parse('2026-09-01T12:00:00Z') + seconds * 1000);
  };
}

export function makeIds(seed) {
  return createIds(seededRandom(seed === undefined ? 1 : seed));
}

export function ctx(seed) {
  return { ids: makeIds(seed === undefined ? 7 : seed), clock };
}

export function emptyProject() {
  return newProject(makeIds(), clock);
}

export function school() {
  return sampleSchool();
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function assertValid(project, message) {
  assert.deepEqual(validate(project), [], message);
}

export function room(project, number) {
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room' && space.number === number) return space;
  }
  throw new Error('no room ' + number);
}

export function group(project, name) {
  const found = project.groups.find((candidate) => candidate.name === name);
  if (!found) throw new Error('no group ' + name);
  return found;
}

export function teacher(project, name) {
  const found = project.teachers.find((candidate) => candidate.name === name);
  if (!found) throw new Error('no teacher ' + name);
  return found;
}

// One way to break each rule validate() knows, on a copy of the sample
// school. `path` is where the finding has to be. validate.test.mjs checks
// each is found there; repair.test.mjs checks repair() puts each right.
export const BREAKS = [
  ['a format that is not ours', (p) => { p.format = 'something-else'; }, /^format$/],
  ['a version that is not current', (p) => { p.version = 3; }, /^version$/],
  ['a created date that is not a date', (p) => { p.created = 'yesterday'; }, /^created$/],
  ['no settings', (p) => { delete p.settings; }, /^settings$/],
  ['a school name that is not text', (p) => { p.settings.schoolName = 7; }, /^settings\.schoolName$/],
  ['17 periods', (p) => { p.settings.periods = 17; }, /^settings\.periods$/],
  ['an unknown period word', (p) => { p.settings.periodWord = 'Lesson'; }, /^settings\.periodWord$/],
  ['a default head count of 0', (p) => { p.settings.defaultHeadCount = 0; }, /^settings\.defaultHeadCount$/],
  ['11 seconds per cell', (p) => { p.settings.secondsPerCell = 11; }, /^settings\.secondsPerCell$/],
  ['1 second per stair', (p) => { p.settings.secondsPerStair = 1; }, /^settings\.secondsPerStair$/],
  ['a negative passing time', (p) => { p.settings.defaultPassingSeconds = -1; }, /^settings\.defaultPassingSeconds$/],
  ['colour bands that do not rise', (p) => { p.settings.colourScale.bands = [10, 10, 50, 100]; }, /^settings\.colourScale\.bands$/],
  ['an unknown colour scale', (p) => { p.settings.colourScale.mode = 'log'; }, /^settings\.colourScale\.mode$/],
  ['a consecutive limit of 0', (p) => { p.settings.checks.consecutiveLimit = 0; }, /^settings\.checks\.consecutiveLimit$/],
  ['a check switched off twice', (p) => { p.settings.checks.off = ['room-unused', 'room-unused']; }, /^settings\.checks\.off$/],
  ['an unknown time format', (p) => { p.settings.timeFormat = 'am'; }, /^settings\.timeFormat$/],
  ['an unknown paper size', (p) => { p.settings.paper.size = 'legal'; }, /^settings\.paper\.size$/],
  ['an unknown theme', (p) => { p.settings.theme = 'sepia'; }, /^settings\.theme$/],
  ['two things with one id', (p) => { p.teachers[1].id = p.teachers[0].id; }, /^teachers\[1\]\.id$/],
  ['a room and a group with one id', (p) => { p.groups[0].id = 'rsample101'; }, /^groups\[0\]\.id$/],
  ['a subject colour that is not a colour', (p) => { p.subjects[0].colour = 'blue'; }, /^subjects\[0\]\.colour$/],
  ['no floors', (p) => { p.building.floors = []; }, /^building\.floors$/],
  ['a floor 4 cells wide', (p) => { p.building.floors[0].width = 4; }, /^building\.floors\[0\]\.width$/],
  ['a floor 201 cells tall', (p) => { p.building.floors[0].height = 201; }, /^building\.floors\[0\]\.height$/],
  ['a cells string of the wrong length', (p) => { p.building.floors[0].cells += '.'; }, /^building\.floors\[0\]\.cells$/],
  ['a cell that is not a cell', (p) => { p.building.floors[0].cells = 'R' + p.building.floors[0].cells.slice(1); }, /^building\.floors\[0\]\.cells$/],
  ['a floor level that is not whole', (p) => { p.building.floors[1].level = 1.5; }, /^building\.floors\[1\]\.level$/],
  ['a room cell that is also corridor', (p) => { const f = p.building.floors[0]; const c = f.spaces[0].cells[0]; f.cells = f.cells.slice(0, c) + '#' + f.cells.slice(c + 1); }, /^building\.floors\[0\]\.spaces\[0\]\.cells\[0\]$/],
  ['a cell owned by two spaces', (p) => { const f = p.building.floors[0]; f.spaces[1].cells.push(f.spaces[0].cells[0]); }, /^building\.floors\[0\]\.spaces\[1\]\.cells\[\d+\]$/],
  ['a space with no cells', (p) => { p.building.floors[0].spaces[0].cells = []; }, /^building\.floors\[0\]\.spaces\[0\]\.cells$/],
  ['a space cell off the floor', (p) => { p.building.floors[0].spaces[0].cells.push(99999); }, /^building\.floors\[0\]\.spaces\[0\]\.cells\[\d+\]$/],
  ['a space of no kind', (p) => { p.building.floors[0].spaces[0].kind = 'hall'; }, /^building\.floors\[0\]\.spaces\[0\]\.kind$/],
  ['two rooms numbered alike but for case and spaces', (p) => { p.building.floors[1].spaces[0].number = ' GYM '; }, /^building\.floors\[1\]\.spaces\[0\]\.number$/],
  ['a room teacher who is not on the list', (p) => { p.building.floors[0].spaces[0].teacherIds.push('tnobody000'); }, /^building\.floors\[0\]\.spaces\[0\]\.teacherIds\[1\]$/],
  ['a room subject that is not on the list', (p) => { p.building.floors[0].spaces[0].subjectId = 'snothing00'; }, /^building\.floors\[0\]\.spaces\[0\]\.subjectId$/],
  ['a capacity of 1000', (p) => { p.building.floors[0].spaces[0].capacity = 1000; }, /^building\.floors\[0\]\.spaces\[0\]\.capacity$/],
  ['a door on an inner cell facing the room itself', (p) => { const s = p.building.floors[0].spaces[0]; s.doors.push({ cell: s.cells[0], side: 'e' }); }, /^building\.floors\[0\]\.spaces\[0\]\.doors\[1\]$/],
  ['a door facing the wall away from the corridor', (p) => { const s = p.building.floors[0].spaces[0]; s.doors.push({ cell: s.cells[0], side: 'n' }); }, /^building\.floors\[0\]\.spaces\[0\]\.doors\[1\]$/],
  ['a door on a cell that is not the room\'s', (p) => { p.building.floors[0].spaces[0].doors.push({ cell: 0, side: 's' }); }, /^building\.floors\[0\]\.spaces\[0\]\.doors\[1\]$/],
  ['an other space of an unknown kind', (p) => { p.building.floors[0].spaces[5].otherKind = 'lounge'; }, /^building\.floors\[0\]\.spaces\[5\]\.otherKind$/],
  ['a corridor name over a cell that is not corridor', (p) => { p.building.floors[0].corridors[0].cells.push(0); }, /^building\.floors\[0\]\.corridors\[0\]\.cells\[\d+\]$/],
  ['an exit in the middle of a corridor', (p) => { p.building.floors[0].exits[1].cell = 7 * 40 + 3; }, /^building\.floors\[0\]\.exits\[1\]\.cell$/],
  ['an exit on a cell that is not corridor', (p) => { p.building.floors[0].exits[0].cell = 0; }, /^building\.floors\[0\]\.exits\[0\]\.cell$/],
  ['a connection on a cell that is not stairs', (p) => { p.building.connections[0].a.cell += 1; }, /^building\.connections\[0\]\.a\.cell$/],
  ['a connection to a floor that is not there', (p) => { p.building.connections[1].b.floorId = 'fnowhere00'; }, /^building\.connections\[1\]\.b\.floorId$/],
  ['a connection from a stairs cell to itself', (p) => { p.building.connections[0].b = { ...p.building.connections[0].a }; }, /^building\.connections\[0\]\.b$/],
  ['a connection with no letter', (p) => { p.building.connections[0].label = ' '; }, /^building\.connections\[0\]\.label$/],
  ['a zone past the edge of its floor', (p) => { p.building.zones[0].w = 100; }, /^building\.zones\[0\]$/],
  ['a zone on a floor that is not there', (p) => { p.building.zones[0].floorId = 'fnowhere00'; }, /^building\.zones\[0\]\.floorId$/],
  ['two teachers with one name but for case', (p) => { p.teachers[1].name = p.teachers[0].name.toUpperCase(); }, /^teachers\[1\]\.name$/],
  ['a teacher with no name', (p) => { p.teachers[0].name = '  '; }, /^teachers\[0\]\.name$/],
  ['a teacher in a room that is not there', (p) => { p.teachers[0].roomIds.push('rnowhere00'); }, /^teachers\[0\]\.roomIds\[1\]$/],
  ['a teacher listing a room that does not list the teacher', (p) => { p.teachers[0].roomIds.push('rsample102'); }, /^teachers\[0\]\.roomIds\[1\]$/],
  ['a room listing a teacher who does not list the room', (p) => { p.teachers[0].roomIds = []; }, /^teachers\[0\]\.roomIds$/],
  ['two groups with one name but for case', (p) => { p.groups[1].name = p.groups[0].name.toLowerCase(); }, /^groups\[1\]\.name$/],
  ['a group with no name', (p) => { p.groups[0].name = ''; }, /^groups\[0\]\.name$/],
  ['a head count of 1000', (p) => { p.groups[0].headCount = 1000; }, /^groups\[0\]\.headCount$/],
  ['a group colour that is not a colour', (p) => { p.groups[0].colour = '#12345'; }, /^groups\[0\]\.colour$/],
  ['a day with 7 slots in a school of 8 periods', (p) => { p.groups[0].days.dsample00a.pop(); }, /^groups\[0\]\.days\.dsample00a$/],
  ['a group missing its day for an own day type', (p) => { delete p.groups[0].days.dsample00b; }, /^groups\[0\]\.days\.dsample00b$/],
  ['a day for a day type that is not there', (p) => { p.groups[0].days.dnowhere00 = p.groups[0].days.dsample00a; }, /^groups\[0\]\.days\.dnowhere00$/],
  ['a slot in a room that is not in the building', (p) => { p.groups[0].days.dsample00a[0].room = 'rnowhere00'; }, /^groups\[0\]\.days\.dsample00a\[0\]\.room$/],
  ['a slot naming a teacher who is not on the list', (p) => { p.groups[0].days.dsample00a[0].teacherIds = ['tnobody000']; }, /^groups\[0\]\.days\.dsample00a\[0\]\.teacherIds\[0\]$/],
  ['a first day type that is not its own copy', (p) => { p.dayTypes[0].own = false; }, /^dayTypes\[0\]\.own$/],
  ['a bell schedule of 9 entries in a school of 8 periods', (p) => { p.dayTypes[0].bells.push(null); }, /^dayTypes\[0\]\.bells$/],
  ['a bell time that is not a time', (p) => { p.dayTypes[0].bells[0].start = '8am'; }, /^dayTypes\[0\]\.bells\[0\]$/],
  ['no day types', (p) => { p.dayTypes = []; }, /^dayTypes$/],
  ['an accepted finding that names nothing', (p) => { p.accepted = [{ findingId: '', reason: '', at: PINNED }]; }, /^accepted\[0\]\.findingId$/],
  ['a scenario change of an unknown kind', (p) => { p.scenario = { name: 'x', changes: [{ kind: 'teleport' }], compared: null }; }, /^scenario\.changes\[0\]$/],
  ['a scenario change with no day type of its own', (p) => { p.scenario = { name: 'x', changes: [{ kind: 'move', groupId: 'gsample06a', period: 1, roomId: 'rsample101' }], compared: null }; }, /^scenario\.changes\[0\]\.dayTypeId$/],
  ['a staleness period of 0 days', (p) => { p.publish.stalenessDays = 0; }, /^publish\.stalenessDays$/],
  ['a published view that is neither on nor off', (p) => { delete p.publish.views.map; }, /^publish\.views\.map$/],
  ['a passcode that is not text', (p) => { p.publish.passcode = 2015; }, /^publish\.passcode$/],
  ['a getting-started record that is not there', (p) => { p.onboarding = null; }, /^onboarding$/],
];
