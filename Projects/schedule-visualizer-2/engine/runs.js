// Runs: a day type with a set of bells. Which classes meet is a day type's
// question; which times ring is a bell schedule's (ARCHITECTURE 17). A run is
// { dayTypeId, bellsId }, bellsId null for the day type's regular bells, and
// a run with regular bells is keyed exactly as a day type was before bell
// schedules existed.

import { emptySlot, bellSchedulesOf, marksOf } from './schema.js';
import { effectiveSchedule, isOwnCopy } from './day-types.js';
import { offPeriods } from './bells.js';
import { markFor, hasMarks } from './marks.js';

// Where is group G on day type D under bells B, for movement and checks? One
// slot per period: effectiveSchedule, with every period that does not meet
// emptied, so it books no room, moves nobody and is nobody's lesson. A period
// does not meet when B turns it off or when a No class mark takes the group
// then (marks.js); other marks leave the slot as it is. With nothing emptied
// it is effectiveSchedule's very array. Null when the group or the day type
// does not exist.
export function meetingSlots(project, groupId, dayTypeId, bellsId) {
  const day = effectiveSchedule(project, groupId, dayTypeId);
  if (day === null) return null;
  const off = offPeriods(project, bellsId);
  const marked = hasMarks(project);
  if (off.size === 0 && !marked) return day;
  let slots = day;
  day.forEach((slot, period) => {
    const mark = marked ? markFor(project, groupId, dayTypeId, period) : null;
    if (!off.has(period) && !(mark && mark.kind === 'noclass')) return;
    if (slots === day) slots = day.slice();
    slots[period] = emptySlot();
  });
  return slots;
}

// The runs movement and the checks need: each own day type with its regular
// bells, in display order, and each day type that is the same as another but
// is named directly by a mark (its meeting slots can differ); then each of
// those with each bell schedule, day type by day type. A project with no
// bell schedules and no such mark has exactly one run per own day type.
export function runsOf(project) {
  const named = new Set();
  for (const mark of marksOf(project)) {
    if (mark && Array.isArray(mark.dayTypeIds)) for (const id of mark.dayTypeIds) if (typeof id === 'string') named.add(id);
  }
  const days = project.dayTypes.filter((dayType) => isOwnCopy(project, dayType.id) || named.has(dayType.id)).map((dayType) => dayType.id);
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
  const runs = days.map((dayTypeId) => ({ dayTypeId, bellsId: null }));
  for (const dayTypeId of days) for (const schedule of schedules) runs.push({ dayTypeId, bellsId: schedule.id });
  return runs;
}
