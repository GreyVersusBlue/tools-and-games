// What readers will see of the problems still in the schedule (spec 12.5).
// A published file never drops a group, a teacher or a room: a double-booking
// is shown as it is. So before publishing the planner says so, one sentence
// for each problem that remains: "Room 204 has two groups in Block 2 on A Day:
// both will be shown."
//
// Nothing is checked here. The findings are the ones the engine already made
// (checkSchedule and buildingChecks, through the engine client); this only
// says, per kind, what the finding looks like from the staff browser. Kinds a
// reader cannot see (a walk that is too long, a room over its capacity: head
// counts and travel times are never published) are left out.
//
// A kind the checks call a problem has a sentence of its own here, for the
// schedule and for the building alike, and test/engine/readers.test.mjs fails
// when one does not: the engine's own sentence ends in advice to the planner
// ("One of them needs another room", "Paint a corridor up to one of its
// sides"), which is not what a reader sees. A finding that names something
// the project no longer has, and a kind with no sentence, get NO_SENTENCE:
// a problem is never passed over in silence.
//
// No page is touched, so the sentences can be made anywhere.

import { findById, findFloor, findRoom, nameOfRoom } from '../../engine/schema.js';
import { periodName } from '../../engine/bells.js';

export const NOTHING_REMAINS = 'The checks found no problem that readers will see.';
// For a problem of a kind this file has no sentence for. The reader test keeps
// that from happening to a kind the checks make.
export const NO_SENTENCE = 'The checks found a problem this form has no sentence for. Look at Schedule › Checks before you publish.';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function howMany(n) {
  return NUMBER_WORDS[n] || String(n);
}

// "in Block 2 on A Day", from where a finding points.
function whenOf(project, where) {
  const dayType = where.dayTypeId ? findById(project.dayTypes, where.dayTypeId) : null;
  const period = Number.isInteger(where.period) ? ' in ' + periodName(project.settings, where.period) : '';
  return period + (dayType ? ' on ' + dayType.name : '');
}

const SAYS = {
  'room-double'(project, finding) {
    const room = finding.where.roomId ? findRoom(project, finding.where.roomId) : null;
    const groups = finding.where.groupIds.length;
    if (!room || groups < 2) return null;
    return nameOfRoom(room, true) + ' has ' + howMany(groups) + ' groups' + whenOf(project, finding.where) + ': ' + (groups === 2 ? 'both' : 'all ' + howMany(groups)) + ' will be shown.';
  },
  'teacher-double'(project, finding) {
    const teacher = finding.where.teacherId ? findById(project.teachers, finding.where.teacherId) : null;
    if (!teacher) return null;
    return teacher.name + ' is in more than one room' + whenOf(project, finding.where) + ': every room will be shown.';
  },
  'room-missing'(project, finding) {
    const group = finding.where.groupIds.length > 0 ? findById(project.groups, finding.where.groupIds[0]) : null;
    if (!group) return null;
    return group.name + ' has a room that is not in the building' + whenOf(project, finding.where) + ': it will be shown as typed, marked "not in the building".';
  },
  'teacher-multi-room'(project, finding) {
    const teacher = finding.where.teacherId ? findById(project.teachers, finding.where.teacherId) : null;
    if (!teacher) return null;
    const rooms = (Array.isArray(teacher.roomIds) ? teacher.roomIds : []).filter((roomId) => findRoom(project, roomId)).length;
    if (rooms < 2) return null;
    return teacher.name + ' is based in ' + howMany(rooms) + ' rooms: ' + (rooms === 2 ? 'both' : 'all ' + howMany(rooms)) + ' are shown on the teacher\'s page.';
  },
};

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const NO_WAY = 'it is on the map, and Directions has no way to it.';

function placed(project, finding) {
  const room = finding.where.roomId ? findRoom(project, finding.where.roomId) : null;
  const floor = finding.where.floorId ? findFloor(project, finding.where.floorId) : null;
  return room && floor ? nameOfRoom(room, true) + ' on ' + floor.name : null;
}

// The building's problems, as a reader meets them: on the map and in
// Directions, the two places a published file shows the building.
const BUILDING_SAYS = {
  'room-duplicate-number'(project, finding) {
    const rooms = (Array.isArray(finding.where.roomIds) ? finding.where.roomIds : []).map((roomId) => findRoom(project, roomId)).filter(Boolean);
    if (rooms.length < 2) return null;
    return capital(howMany(rooms.length)) + ' rooms are numbered ' + rooms[0].number.trim() + ': ' + (rooms.length === 2 ? 'both' : 'all ' + howMany(rooms.length)) + ' are shown under that number.';
  },
  'room-no-corridor'(project, finding) {
    const where = placed(project, finding);
    return where ? where + ' touches no corridor or stairs: ' + NO_WAY : null;
  },
  'door-nowhere'(project, finding) {
    const where = placed(project, finding);
    return where ? where + ' has no door onto a corridor or stairs: ' + NO_WAY : null;
  },
  'floor-unconnected'(project, finding) {
    const floor = finding.where.floorId ? findFloor(project, finding.where.floorId) : null;
    return floor ? 'Nothing connects ' + floor.name + ' to the rest of the building: Directions has no way to or from it.' : null;
  },
  'part-unreachable'(project, finding) {
    const floor = finding.where.floorId ? findFloor(project, finding.where.floorId) : null;
    if (!floor) return null;
    const rooms = (Array.isArray(finding.where.roomIds) ? finding.where.roomIds : []).filter((roomId) => findRoom(project, roomId)).length;
    return 'Part of ' + floor.name + ' cannot be reached from the rest of the building' + (rooms === 0 ? '' : ', with ' + howMany(rooms) + (rooms === 1 ? ' room' : ' rooms') + ' on it') + ': Directions has no way to or from it.';
  },
};

// Building problems a reader never meets: a published file has no evacuation
// routes in it.
const BUILDING_UNSEEN = ['room-no-exit-route'];

// The kinds with a sentence of their own.
export const READER_KINDS = Object.keys(SAYS);
export const READER_BUILDING_KINDS = Object.keys(BUILDING_SAYS);
export const READER_BUILDING_UNSEEN = BUILDING_UNSEEN;

// Does a reader meet a finding of this kind?
function readerSees(finding) {
  return finding.severity === 'problem' || READER_KINDS.includes(finding.kind);
}

// readerSentences(project, results) → { lines: [{ id, kind, text }], accepted, off }
//   results   what store.derived.results() answers with, or the same parts:
//             { findings: { findings, accepted }, buildingFindings }
//   lines     one sentence per problem readers will meet, schedule first
//   accepted  how many accepted problems are published as they are as well
//   off       how many checks with a sentence here are switched off in the
//             project's settings, so what they would have found was not
//             looked for
export function readerSentences(project, results) {
  const schedule = (results && results.findings) || {};
  const lines = [];
  for (const finding of schedule.findings || []) {
    if (!readerSees(finding)) continue;
    const say = SAYS[finding.kind];
    // a sentence that comes back empty names something the project no longer
    // has: the problem is still there, so it is still a line
    const text = say && finding.where ? say(project, finding) : null;
    lines.push({ id: finding.id, kind: finding.kind, text: text || NO_SENTENCE });
  }
  for (const finding of (results && results.buildingFindings) || []) {
    if (finding.severity !== 'problem' || BUILDING_UNSEEN.includes(finding.kind)) continue;
    const say = BUILDING_SAYS[finding.kind];
    const text = say && finding.where ? say(project, finding) : null;
    lines.push({ id: finding.id, kind: finding.kind, text: text || NO_SENTENCE });
  }
  const accepted = (schedule.accepted || []).filter(readerSees).length;
  const checks = (project && project.settings && project.settings.checks) || {};
  const off = new Set((Array.isArray(checks.off) ? checks.off : []).filter((kind) => READER_KINDS.includes(kind))).size;
  return { lines, accepted, off };
}

// The line under the sentences, from what readerSentences gave: that nothing
// is left, how many accepted problems go out as they are, and how many checks
// were switched off. '' when there is nothing to add.
export function readerSummary(read) {
  const parts = [];
  const none = read.lines.length === 0;
  if (none) parts.push(NOTHING_REMAINS);
  if (read.accepted > 0) parts.push((read.accepted === 1 ? 'One problem you accepted is' : read.accepted + ' problems you accepted are') + ' published as ' + (read.accepted === 1 ? 'it is' : 'they are') + (none ? '.' : ' too.'));
  if (read.off > 0) parts.push((read.off === 1 ? 'One check is switched off and was' : read.off + ' checks are switched off and were') + ' not looked at.');
  return parts.join(' ');
}
