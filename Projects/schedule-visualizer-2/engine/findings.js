// Findings: what a check reports. This module holds what every check shares:
// the severity of each kind, how a finding's id is built, the order findings
// are listed in, how accepted findings are set apart, and the small helpers
// that turn names and numbers into the words of a sentence.
//
// A finding is
//
//   { id, kind, severity, text, where, fixable }
//
//   id        a stable string: the kind, then the ids the finding is about in
//             a fixed order, joined by ":". The same problem has the same id
//             tomorrow, after a rename, and after the lists are reordered, so
//             an accepted finding stays accepted.
//   kind      one of CHECK_KINDS in schema.js.
//   severity  "problem" (the schedule cannot run as written), "warning" (it
//             runs and somebody pays) or "note" (a fact worth knowing).
//   text      one or two full sentences built from the names as they are at
//             the time of the run. Names are put in exactly as typed; the
//             page shows the text with textContent and never as markup.
//   where     { dayTypeId, period, groupIds, roomId, teacherId }, every key
//             always present, null (or an empty list) when it does not apply.
//             Enough for "Show" to jump to the slot.
//   fixable   true when a change to the schedule of the kinds in spec 5.8
//             could clear it, so "Fix…" has something to offer.
//
// The ids, kind by kind (d is a day type id, p a period index from 0):
//
//   room-double:d:p:<room>             teacher-double:d:p:<teacher>
//   over-capacity:d:p:<room>           no-planning:d:<teacher>
//   consecutive:d:p:<teacher>          (p is the first period of the run)
//   teacher-walk:d:p:<teacher>         group-walk:d:p:<group>
//                                      (p is the period walked out of)
//   room-missing:d:p:<group>           empty-period:d:p:<group>
//   empty-period:d:<group>             (the group has no room all day)
//   teacher-multi-room:<teacher>       teacher-room-unused:d:<teacher>:<room>
//   room-unused:d:<room>               room-no-subject:<room>
//   room-no-teacher:<room>
//
// Walk results. The two walk-time checks do no routing and no timing of their
// own: they are handed the figures, so this module and checks.js never need
// the crowd model. The argument is null (nothing is known yet, and the two
// checks report nothing) or
//
//   {
//     groups:   [{ dayTypeId, groupId, period, total, walking, waiting, late, arrived }],
//     teachers: [{ dayTypeId, teacherId, period, walking, late }],
//   }
//
//   period    the period walked out of: the walk is from `period` into
//             `period + 1`.
//   total, walking, waiting   whole seconds, as the crowd model gives them. A
//             teacher's walk is the plain walking time, with no crowd.
//   late      whether it fits the passing time plus the school's margin,
//             decided by whoever made the figures (the crowd model's isLate).
//             Only entries with late === true become findings.
//   arrived   false when the crowd model stopped the group before it got
//             there; the sentence then says it did not arrive.
//
// An entry may be in any order and may be out of date: one that names a day
// type, group, teacher or walk the project no longer has is passed over.

import { CHECK_KINDS, nameOfRoom } from './schema.js';

export const SEVERITIES = ['problem', 'warning', 'note'];

export const KIND_SEVERITY = {
  'room-double': 'problem',
  'teacher-double': 'problem',
  'over-capacity': 'warning',
  'no-planning': 'warning',
  'consecutive': 'warning',
  'teacher-walk': 'warning',
  'group-walk': 'warning',
  'room-missing': 'warning',
  'empty-period': 'note',
  'teacher-multi-room': 'note',
  'teacher-room-unused': 'note',
  'room-unused': 'note',
  'room-no-subject': 'note',
  'room-no-teacher': 'note',
};

// The kinds a reordered day or a different room could clear.
export const FIXABLE_KINDS = ['room-double', 'teacher-double', 'over-capacity', 'no-planning', 'consecutive', 'teacher-walk', 'group-walk'];

export function severityOf(kind) {
  return KIND_SEVERITY[kind] || null;
}

// findingId('room-double', 'd…', 3, 'r…') is "room-double:d…:3:r…".
export function findingId(kind, ...parts) {
  return [kind].concat(parts.map((part) => String(part))).join(':');
}

export function makeFinding(kind, parts, text, where) {
  const at = where || {};
  return {
    id: findingId(kind, ...parts),
    kind,
    severity: KIND_SEVERITY[kind],
    text,
    where: {
      dayTypeId: at.dayTypeId === undefined ? null : at.dayTypeId,
      period: at.period === undefined ? null : at.period,
      groupIds: at.groupIds === undefined ? [] : at.groupIds,
      roomId: at.roomId === undefined ? null : at.roomId,
      teacherId: at.teacherId === undefined ? null : at.teacherId,
    },
    fixable: FIXABLE_KINDS.includes(kind),
  };
}

// The order of the findings table: problems, then warnings, then notes; within
// a severity the order of spec 5.7's table; then by day type as the school
// lists them, by period, and last by id so the order never depends on the
// order groups, teachers or rooms happen to be stored in.
export function sortFindings(findings, project) {
  const dayOrder = new Map(project.dayTypes.map((dayType, index) => [dayType.id, index]));
  const rank = (finding) => [
    SEVERITIES.indexOf(finding.severity),
    CHECK_KINDS.indexOf(finding.kind),
    finding.where.dayTypeId === null ? -1 : dayOrder.get(finding.where.dayTypeId),
    finding.where.period === null ? -1 : finding.where.period,
  ];
  const keyed = findings.map((finding) => ({ finding, rank: rank(finding) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i += 1) {
      if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    }
    return a.finding.id < b.finding.id ? -1 : a.finding.id > b.finding.id ? 1 : 0;
  });
  return keyed.map((entry) => entry.finding);
}

// Sets the accepted findings apart. `findings` keeps the ones that count;
// `accepted` holds the ones the school has accepted, each with its
// `accepted: { reason, at }`; `gone` holds the accepted records that match no
// finding of this run (the thing they were about has been put right, or a
// check is switched off). Nothing is dropped from the project here.
export function splitAccepted(findings, acceptedRecords) {
  const records = new Map();
  for (const record of Array.isArray(acceptedRecords) ? acceptedRecords : []) records.set(record.findingId, record);
  const open = [];
  const accepted = [];
  const seen = new Set();
  for (const finding of findings) {
    const record = records.get(finding.id);
    if (record) {
      seen.add(finding.id);
      accepted.push({ ...finding, accepted: { reason: record.reason, at: record.at } });
    } else {
      open.push(finding);
    }
  }
  const gone = Array.from(records.values()).filter((record) => !seen.has(record.findingId));
  return { findings: open, accepted, gone };
}

// { problem, warning, note } for the counts on the findings panel.
export function countBySeverity(findings) {
  const counts = { problem: 0, warning: 0, note: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

// ---------------------------------------------------------------- words

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// "two", "three" … "ten", then "11".
export function countWord(n) {
  return n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

// ["a"] is "a"; ["a", "b"] is "a and b"; ["a", "b", "c"] is "a, b and c".
export function listWords(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

// The school's period word inside a sentence: "period", "mod", "block",
// "hour"; with `many`, "periods" and so on.
export function periodWord(settings, many) {
  return String(settings.periodWord).toLowerCase() + (many ? 's' : '');
}

// A room as a sentence names it: "Room 204", "Gym", "a room with no number".
// The rule is schema.js's, so that the building's labels and a published file
// use it without this module; it is handed on here, the very same function,
// for the checks and the screens that already ask for it here.
export const roomName = nameOfRoom;

// Seconds as a length of time: "45 s", "4 min", "4 min 35 s".
export function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return rest + ' s';
  return rest === 0 ? minutes + ' min' : minutes + ' min ' + rest + ' s';
}
