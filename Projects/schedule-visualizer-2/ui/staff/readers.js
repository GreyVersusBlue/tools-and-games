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
// A kind the checks call a problem has a sentence of its own here, and
// test/engine/readers.test.mjs fails when one does not: the engine's own
// sentence ends in advice to the planner ("One of them needs another room"),
// which is not what a reader sees.
//
// No page is touched, so the sentences can be made anywhere.

import { findById, findRoom, nameOfRoom } from '../../engine/schema.js';
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

// The kinds with a sentence of their own.
export const READER_KINDS = Object.keys(SAYS);

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
    // a sentence that comes back empty names something the project no longer has
    const text = say ? say(project, finding) : NO_SENTENCE;
    if (text) lines.push({ id: finding.id, kind: finding.kind, text });
  }
  for (const finding of (results && results.buildingFindings) || []) {
    if (finding.severity !== 'problem') continue;
    lines.push({ id: finding.id, kind: finding.kind, text: finding.text + ' The map and the directions follow the building as it is drawn.' });
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
