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
// No page is touched, so the sentences can be made anywhere.

import { findById, findRoom, nameOfRoom } from '../../engine/schema.js';
import { periodName } from '../../engine/bells.js';

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
};

// readerSentences(project, results) → { lines: [{ id, kind, text }], accepted }
//   results   what store.derived.results() answers with, or the same parts:
//             { findings: { findings, accepted }, buildingFindings }
//   lines     one sentence per problem readers will meet, schedule first
//   accepted  how many accepted problems are published as they are as well
export function readerSentences(project, results) {
  const schedule = (results && results.findings) || {};
  const lines = [];
  for (const finding of schedule.findings || []) {
    const say = SAYS[finding.kind];
    if (!say && finding.severity !== 'problem') continue;
    const text = (say && say(project, finding)) || (finding.severity === 'problem' ? finding.text + ' Readers will see it as it is.' : null);
    if (text) lines.push({ id: finding.id, kind: finding.kind, text });
  }
  for (const finding of (results && results.buildingFindings) || []) {
    if (finding.severity !== 'problem') continue;
    lines.push({ id: finding.id, kind: finding.kind, text: finding.text + ' The map and the directions follow the building as it is drawn.' });
  }
  const accepted = (schedule.accepted || []).filter((finding) => finding.severity === 'problem' || Boolean(SAYS[finding.kind])).length;
  return { lines, accepted };
}
