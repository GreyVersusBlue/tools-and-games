// Marked periods and duties (ARCHITECTURE 17.5, 17.6): which mark applies to a
// group in a period, which duties a teacher has, who a duty covers. A mark
// lies over a slot and a duty over a teacher's day; neither moves anybody
// (the movement engines read marks through meetingSlots in runs.js).
//
// Every function treats an absent or malformed list as none and a malformed
// item as not there, because the staff browser never runs repair (17.1). This
// module is one of those a published file carries, so it keeps to the linker
// rule: one-line named imports, `export` only directly before a declaration.

import { marksOf, dutiesOf, spacelessKey } from './schema.js';
import { findDayType, effectiveDayType } from './day-types.js';
import { weekdayOf, isCalendarDate } from './calendar.js';

const SCOPE_RANK = { groups: 0, grades: 1, school: 2 };

function strings(list) {
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
}

// Does a list of day type ids (empty meaning every day type) take D? It does
// when it is empty, names D, or names the own day type D is the same as.
function takesDay(project, ids, dayTypeId) {
  const named = strings(ids);
  if (named.length === 0) return true;
  if (named.includes(dayTypeId)) return true;
  const own = effectiveDayType(project, dayTypeId);
  return own !== null && own.id !== dayTypeId && named.includes(own.id);
}

// The marks of a project that can apply to anyone, in list order, each with
// its sort key; kept per project object so a lookup is a Map read.
const indexes = new WeakMap();

function indexOf(project) {
  const cached = indexes.get(project);
  if (cached) return cached;
  const byKey = new Map();
  const marks = marksOf(project);
  marks.forEach((mark, order) => {
    if (!mark || typeof mark !== 'object' || !Number.isInteger(mark.period) || mark.period < 0) return;
    if (mark.kind !== 'lunch' && mark.kind !== 'advisory' && mark.kind !== 'activity' && mark.kind !== 'noclass') return;
    const scope = SCOPE_RANK[mark.scope] === undefined ? 'school' : mark.scope;
    const entry = {
      mark,
      order,
      scope,
      named: strings(mark.dayTypeIds).length > 0,
      grades: new Set(strings(mark.grades).map(spacelessKey)),
      groupIds: new Set(strings(mark.groupIds)),
    };
    for (const dayType of Array.isArray(project.dayTypes) ? project.dayTypes : []) {
      if (!takesDay(project, mark.dayTypeIds, dayType.id)) continue;
      const key = dayType.id + '\u0000' + mark.period;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
    }
  });
  const index = { byKey, any: byKey.size > 0 };
  indexes.set(project, index);
  return index;
}

// Does any mark exist that could change a slot? A project with none skips the
// per-slot work altogether.
export function hasMarks(project) {
  return indexOf(project).any;
}

// The better of two applicable marks: No class outright, then one naming day
// types over an every-day one, then groups over grades over the school, then
// the earlier in the list.
function better(a, b) {
  if (b === null) return true;
  const noclass = (a.mark.kind === 'noclass' ? 0 : 1) - (b.mark.kind === 'noclass' ? 0 : 1);
  if (noclass !== 0) return noclass < 0;
  const named = (a.named ? 0 : 1) - (b.named ? 0 : 1);
  if (named !== 0) return named < 0;
  const scope = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
  if (scope !== 0) return scope < 0;
  return a.order < b.order;
}

function entriesFor(project, dayTypeId, period) {
  if (!findDayType(project, dayTypeId)) return [];
  return indexOf(project).byKey.get(dayTypeId + '\u0000' + period) || [];
}

// Which mark applies to group G in period p on day type D? The mark, or null.
export function markFor(project, groupId, dayTypeId, period) {
  const entries = entriesFor(project, dayTypeId, period);
  if (entries.length === 0) return null;
  const group = Array.isArray(project.groups) ? project.groups.find((candidate) => candidate && candidate.id === groupId) : null;
  if (!group) return null;
  const grade = typeof group.grade === 'string' ? spacelessKey(group.grade) : '';
  let best = null;
  for (const entry of entries) {
    const takes = entry.scope === 'school' || (entry.scope === 'groups' && entry.groupIds.has(groupId)) || (entry.scope === 'grades' && grade !== '' && entry.grades.has(grade));
    if (takes && better(entry, best)) best = entry;
  }
  return best === null ? null : best.mark;
}

// The school-scope mark in period p on D, by the same precedence. It is what
// colours a teacher's free period.
export function schoolMarkFor(project, dayTypeId, period) {
  let best = null;
  for (const entry of entriesFor(project, dayTypeId, period)) {
    if (entry.scope === 'school' && better(entry, best)) best = entry;
  }
  return best === null ? null : best.mark;
}

// ---------------------------------------------------------------- duties

// The teacher ids a duty covers, in the teachers' order: those it names, the
// teachers of the subjects it names, or every teacher when `everyone`. Ids
// that name nobody are not there.
export function dutyTeachers(project, duty) {
  const teachers = Array.isArray(project.teachers) ? project.teachers.filter((teacher) => teacher && typeof teacher.id === 'string') : [];
  if (!duty || typeof duty !== 'object') return [];
  if (duty.everyone === true) return teachers.map((teacher) => teacher.id);
  const named = new Set(strings(duty.teacherIds));
  const subjects = new Set(strings(duty.subjectIds));
  return teachers.filter((teacher) => named.has(teacher.id) || (typeof teacher.subjectId === 'string' && subjects.has(teacher.subjectId))).map((teacher) => teacher.id);
}

// Does the duty hold only on some days (weekdays or dates set)?
export function dutyIsSometimes(duty) {
  const weekdays = Array.isArray(duty.weekdays) ? duty.weekdays : [];
  return weekdays.length > 0 || isCalendarDate(duty.from) || isCalendarDate(duty.to);
}

// Does the duty hold on this date? A malformed date matches only a duty that
// is not sometimes.
export function dutyHoldsOn(duty, date) {
  if (!dutyIsSometimes(duty)) return true;
  if (!isCalendarDate(date)) return false;
  const weekdays = Array.isArray(duty.weekdays) ? duty.weekdays : [];
  if (weekdays.length > 0 && !weekdays.includes(weekdayOf(date))) return false;
  if (isCalendarDate(duty.from) && date < duty.from) return false;
  if (isCalendarDate(duty.to) && date > duty.to) return false;
  return true;
}

// Every duty that applies on day type D, given a date or not: the duties that
// take D, and, with a date, those that hold on it.
export function dutiesOn(project, dayTypeId, date) {
  if (!findDayType(project, dayTypeId)) return [];
  const periods = project.settings && Number.isInteger(project.settings.periods) ? project.settings.periods : 0;
  return dutiesOf(project).filter((duty) => {
    if (!duty || typeof duty !== 'object') return false;
    if (duty.when !== 'before' && duty.when !== 'period' && duty.when !== 'after') return false;
    if (duty.when === 'period' && !(Number.isInteger(duty.period) && duty.period >= 0 && duty.period < periods)) return false;
    if (!takesDay(project, duty.dayTypeIds, dayTypeId)) return false;
    return date === undefined || date === null ? true : dutyHoldsOn(duty, date);
  });
}

// Every teacher's duties on D in one pass: a Map of teacher id to
// { before, byPeriod, after } as teacherDuties gives, for the teachers who
// have any. Null when D is not a day type of this project.
export function dutiesByTeacher(project, dayTypeId, date) {
  if (!findDayType(project, dayTypeId)) return null;
  const periods = project.settings.periods;
  const found = new Map();
  for (const duty of dutiesOn(project, dayTypeId, date)) {
    for (const teacherId of dutyTeachers(project, duty)) {
      if (!found.has(teacherId)) found.set(teacherId, { before: [], byPeriod: Array.from({ length: periods }, () => []), after: [] });
      const mine = found.get(teacherId);
      if (duty.when === 'before') mine.before.push(duty);
      else if (duty.when === 'after') mine.after.push(duty);
      else mine.byPeriod[duty.period].push(duty);
    }
  }
  return found;
}

// What duties has teacher T on D? { before, byPeriod, after }: byPeriod has
// one list per period of the school day. `options.date` (YYYY-MM-DD) leaves
// out a duty that does not hold that day; without it every duty that could
// hold on D is listed. Null when the teacher or the day type does not exist.
export function teacherDuties(project, teacherId, dayTypeId, options) {
  if (!findDayType(project, dayTypeId)) return null;
  if (!Array.isArray(project.teachers) || !project.teachers.some((teacher) => teacher && teacher.id === teacherId)) return null;
  const date = options && typeof options.date === 'string' ? options.date : null;
  const mine = dutiesByTeacher(project, dayTypeId, date).get(teacherId);
  return mine || { before: [], byPeriod: Array.from({ length: project.settings.periods }, () => []), after: [] };
}
