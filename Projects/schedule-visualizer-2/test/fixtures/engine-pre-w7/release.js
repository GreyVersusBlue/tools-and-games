// Staggered dismissal: the rule, once (spec 8.2 and 3.4; ARCHITECTURE 18.2).
//
// project.release is a list of entries, each saying that some groups leave a
// little after the bell:
//
//   { id: "l…",
//     who: { groups: ["g…"] } | { grade: "7" } | { wing: "North" },
//     seconds: 120,            15 to 300; a groups entry may be 0, "on the bell"
//     after: [2, 4] | null,    the periods it follows (0 is the first period);
//                              null is after every period
//     dayTypeIds: ["d…"] | null }   null is every day type
//
// releaseDelay(project, groupId, dayTypeId, period, fromRoomId) answers how
// many seconds a group waits before it starts walking out of `period`. The
// entries that match are ranked: a groups entry beats a grade entry beats a
// wing entry. The most specific rank that has a match wins, and within it
// the largest delay does. So "seventh grade two minutes late, 7-1 on the
// bell" is a grade entry of 120 and a groups entry of 0, and 7-1 gets 0.
//
// A day type matches an entry when the entry names it, or names the own day
// type it is the same as (ARCHITECTURE 17.2). A grade matches ignoring case
// and surrounding spaces. A wing is the wing of the room the group is
// leaving, `fromRoomId`, matched the same way; a group leaving a room with no
// wing, or no room, matches no wing entry.
//
// Pure: the project in, a whole number of seconds out. Nothing is cached.

import { releaseOf, findRoom, nameKey, RELEASE_WHO_KINDS } from './schema.js';
import { effectiveDayType } from './day-types.js';

// Which kind of entry this is, 'groups', 'grade' or 'wing', or null when it
// is none of them or names two.
export function releaseKind(who) {
  if (who === null || typeof who !== 'object' || Array.isArray(who)) return null;
  const present = RELEASE_WHO_KINDS.filter((kind) => who[kind] !== undefined);
  return present.length === 1 ? present[0] : null;
}

// Does the entry apply on this day type, whatever the group?
export function releaseOnDay(project, entry, dayTypeId) {
  if (!Array.isArray(entry.dayTypeIds)) return true;
  if (entry.dayTypeIds.includes(dayTypeId)) return true;
  const own = effectiveDayType(project, dayTypeId);
  return own !== null && entry.dayTypeIds.includes(own.id);
}

// Does the entry apply to the transition out of `period`?
export function releaseAfter(entry, period) {
  return !Array.isArray(entry.after) || entry.after.includes(period);
}

const RANK = { groups: 3, grade: 2, wing: 1 };

export function releaseDelay(project, groupId, dayTypeId, period, fromRoomId) {
  const list = releaseOf(project);
  if (list.length === 0) return 0;
  const group = project.groups.find((candidate) => candidate.id === groupId);
  const grade = group && typeof group.grade === 'string' ? nameKey(group.grade) : '';
  let wing = null;
  if (typeof fromRoomId === 'string') {
    const room = findRoom(project, fromRoomId);
    if (room && typeof room.wing === 'string') wing = nameKey(room.wing);
  }
  let rank = 0;
  let seconds = 0;
  for (const entry of list) {
    const kind = releaseKind(entry.who);
    if (kind === null || !Number.isInteger(entry.seconds)) continue;
    if (RANK[kind] < rank) continue;
    if (!releaseAfter(entry, period) || !releaseOnDay(project, entry, dayTypeId)) continue;
    let matches = false;
    if (kind === 'groups') matches = Array.isArray(entry.who.groups) && entry.who.groups.includes(groupId);
    else if (kind === 'grade') matches = grade !== '' && typeof entry.who.grade === 'string' && nameKey(entry.who.grade) === grade;
    else matches = wing !== null && wing !== '' && typeof entry.who.wing === 'string' && nameKey(entry.who.wing) === wing;
    if (!matches) continue;
    if (RANK[kind] > rank) {
      rank = RANK[kind];
      seconds = entry.seconds;
    } else if (entry.seconds > seconds) {
      seconds = entry.seconds;
    }
  }
  return seconds;
}
