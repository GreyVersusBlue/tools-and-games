// Runs: a day type with a set of bells. Which classes meet is a day type's
// question; which times ring is a bell schedule's (ARCHITECTURE 17). A run is
// { dayTypeId, bellsId }, bellsId null for the day type's regular bells, and
// a run with regular bells is keyed exactly as a day type was before bell
// schedules existed.

import { emptySlot, bellSchedulesOf } from './schema.js';
import { effectiveSchedule, ownDayTypes } from './day-types.js';
import { offPeriods } from './bells.js';

// Where is group G on day type D under bells B, for movement and checks? One
// slot per period: effectiveSchedule, with every period that does not meet
// under B emptied, so it books no room, moves nobody and is nobody's lesson.
// (SV2-83 empties no-class marks here too.) With no B, or a B that leaves
// every period meeting, it is effectiveSchedule's very array. Null when the
// group or the day type does not exist.
export function meetingSlots(project, groupId, dayTypeId, bellsId) {
  const day = effectiveSchedule(project, groupId, dayTypeId);
  if (day === null) return null;
  const off = offPeriods(project, bellsId);
  if (off.size === 0) return day;
  return day.map((slot, period) => (off.has(period) ? emptySlot() : slot));
}

// The runs movement and the checks need: each own day type with its regular
// bells, in display order; then each of those with each bell schedule, day
// type by day type. (SV2-83 adds a day type that is the same as another but
// is named directly by a mark, since its meeting slots differ.) A project
// with no bell schedules has exactly one run per own day type.
export function runsOf(project) {
  const days = ownDayTypes(project).map((dayType) => dayType.id);
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
  const runs = days.map((dayTypeId) => ({ dayTypeId, bellsId: null }));
  for (const dayTypeId of days) for (const schedule of schedules) runs.push({ dayTypeId, bellsId: schedule.id });
  return runs;
}
