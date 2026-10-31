// Every state change is a pure function here: (project, payload, ctx) → project.
// An action copies only the branches it changes, so everything it leaves alone
// is the very same object afterwards. ctx is { ids, clock }.
//
// Each action carries three things the store reads:
//   label  what the undo entry is called: text, or (before, payload, after) → text
//   bumps  which of the store's counters the change moves: a list of
//          GEOMETRY, BUILDING, SCHEDULE, or (before, payload, after) → list
//   focus  optional (before, payload, after) → where the change was, for "Show"
//   quiet  true for a change that is not the user's work on the school (the
//          getting-started card): the store makes no undo entry for it and
//          does not set `modified`, and undo and redo never take it back
//
// An action that cannot be done throws an ActionError whose message says what
// was wrong and what to do; the interface shows it as it is. An action that
// changes nothing returns the project it was given, and the store then makes
// no undo entry.

import { RANGES, PERIOD_WORDS, TIME_FORMATS, PAPER_SIZES, PAPER_ORIENTATIONS, THEMES, COLOUR_SCALE_MODES, PUBLISH_VIEWS, CHECK_KINDS, CELL_SCALE_UNITS, CELL_LENGTH_MOST } from './schema.js';
import { defaultSettings, isCellScale, emptySlot, emptyDay, emptyBells, newFloor, nameKey, looseNameKey, isHexColour, isBellTime, isIsoDate, inRange, allRooms, findRoom, nextGroupColour, nameOfRoom, newAcceptedFinding } from './schema.js';
import { checkSchedule } from './checks.js';
import { isOwnCopy, findDayType, baseDayType, effectiveDayType, followersOf } from './day-types.js';
import { periodName } from './bells.js';
import { DAY_TYPES_MOST, BELL_SCHEDULES_MOST, NAME_MOST, SHORT_MOST, CALENDAR_DAYS_MOST, ROTATION_RANGE, DATE_LABEL_MOST, DAY_ROTATION, DAY_CLOSED, BELLS_REGULAR, WEEKDAY_NAMES, LATER_PUBLISH_VIEWS } from './schema.js';
import { spacelessKey, textLength, bellSchedulesOf, calendarOf, newBellSchedule, defaultWeekdays } from './schema.js';
import { isCalendarDate, daysBetween, datesFrom, weekdayOf, dateWords, calendarDays } from './calendar.js';
import { isId, collectIds } from './ids.js';
import { importedCalendar, calendarImportText } from './import-calendar.js';

export const GEOMETRY = 'geometry';
export const BUILDING = 'building';
export const SCHEDULE = 'schedule';

export const UNNUMBERED_ROOM_TEXT = 'unnumbered room';

export class ActionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ActionError';
    this.code = code || 'refused';
  }
}

function refuse(message, code) {
  throw new ActionError(message, code);
}

export function action(spec, run) {
  run.label = spec.label;
  run.bumps = spec.bumps || [];
  run.focus = spec.focus || null;
  run.quiet = spec.quiet === true;
  return run;
}

// What the store needs to know about one run of an action. `outcome` is what
// a building action or an import reported for the project it returned
// (buildingOutcome, importOutcome), or null; the store keeps it on the undo
// entry, because the project the store holds afterwards is a stamped copy.
export function describeAction(act, before, payload, after) {
  const read = (value, fallback) => (typeof value === 'function' ? value(before, payload, after) : value === undefined || value === null ? fallback : value);
  return { label: read(act.label, 'Change'), bumps: read(act.bumps, []), focus: read(act.focus, null), outcome: buildingOutcome(after) || importOutcome(after) || scheduleOutcome(after) };
}

// ---------------------------------------------------------------- sharing

// patch(target, path, fn): a copy of target with fn applied at path, sharing
// every branch off the path. When fn returns what it was given, target itself
// comes back.
export function patch(target, path, fn) {
  if (path.length === 0) return fn(target);
  const key = path[0];
  const child = target[key];
  const next = patch(child, path.slice(1), fn);
  if (next === child) return target;
  if (Array.isArray(target)) {
    const copy = target.slice();
    copy[key] = next;
    return copy;
  }
  return { ...target, [key]: next };
}

// map() that returns the list it was given when no item changed.
export function mapShared(list, fn) {
  let changed = false;
  const next = list.map((item, index) => {
    const result = fn(item, index);
    if (result !== item) changed = true;
    return result;
  });
  return changed ? next : list;
}

function filterShared(list, keep) {
  const next = list.filter(keep);
  return next.length === list.length ? list : next;
}

function withKey(target, key, value) {
  return target[key] === value ? target : { ...target, [key]: value };
}

export function mapRooms(project, fn) {
  return patch(project, ['building', 'floors'], (floors) => mapShared(floors, (floor) => withKey(floor, 'spaces', mapShared(floor.spaces, (space) => (space.kind === 'room' ? fn(space, floor) : space)))));
}

export function mapSlots(project, fn) {
  return withKey(project, 'groups', mapShared(project.groups, (group) => {
    let days = group.days;
    for (const dayTypeId of Object.keys(group.days)) {
      const day = mapShared(group.days[dayTypeId], (slot, period) => fn(slot, group, dayTypeId, period));
      if (day !== group.days[dayTypeId]) days = { ...days, [dayTypeId]: day };
    }
    return withKey(group, 'days', days);
  }));
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function moveItem(list, id, toIndex, what) {
  const from = list.findIndex((item) => item.id === id);
  if (from === -1) refuse('That ' + what + ' is no longer in the project.', 'missing');
  if (!Number.isInteger(toIndex)) refuse('A position in the list is a whole number.', 'bad-value');
  const to = Math.min(list.length - 1, Math.max(0, toIndex));
  if (to === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function need(list, id, what) {
  const found = list.find((item) => item.id === id);
  if (!found) refuse('That ' + what + ' is no longer in the project.', 'missing');
  return found;
}

function needText(value, what) {
  if (typeof value !== 'string') refuse(what + ' is text.', 'bad-value');
  return value;
}

function needName(value, what) {
  if (typeof value !== 'string' || value.trim() === '') refuse(what + ' needs a name. Type one and try again.', 'no-name');
  return value;
}

function needColour(value) {
  if (!isHexColour(value)) refuse('A colour is written #rrggbb, for example #2a6f97.', 'bad-value');
  return value.toLowerCase();
}

// An id a caller gives for the thing an action adds has to be an id of that
// kind that nothing in the project has. Anything else is refused: two things
// with one id cannot be told apart by what names them.
function needFreeId(project, id, prefix) {
  if (!isId(id, prefix)) refuse('"' + id + '" cannot be the id of this: an id is 10 lowercase letters and digits and starts with "' + prefix + '". Leave the id out and one is made.', 'bad-id');
  if (collectIds(project).includes(id)) refuse('The id "' + id + '" is already used in this project. Leave the id out and a new one is made.', 'duplicate-id');
  return id;
}

// The id for the thing an add action makes: the one the payload gives under
// `key` when it gives one, else a new one.
function newId(project, payload, ctx, prefix, key) {
  const given = payload ? payload[key || 'id'] : undefined;
  if (typeof given === 'string' && given !== '') return needFreeId(project, given, prefix);
  return ctx.ids(prefix);
}

// The same check for the actions whose thing engine/building.js makes.
function checkGivenId(project, payload, prefix) {
  if (payload && typeof payload.id === 'string' && payload.id !== '') needFreeId(project, payload.id, prefix);
}

// ---------------------------------------------------------------- settings

function wholeRule(range, what) {
  return (value) => (inRange(value, range) ? null : what + ' is a whole number from ' + range[0] + ' to ' + range[1] + '.');
}

function choiceRule(allowed, what) {
  return (value) => (allowed.includes(value) ? null : what + ' is one of: ' + allowed.join(', ') + '.');
}

const CELL_SCALE_RULE = 'One cell is a length above 0 and at most ' + CELL_LENGTH_MOST + ', in ' + CELL_SCALE_UNITS.join(' or ') + ', or the cell scale is not set.';

const SETTINGS = {
  schoolName: { label: 'Change the school name', bumps: [], check: (value) => (typeof value === 'string' ? null : 'The school name is text.') },
  periodWord: { label: 'Change the period word', bumps: [SCHEDULE], check: choiceRule(PERIOD_WORDS, 'The period word') },
  defaultPassingSeconds: { label: 'Change the default passing time', bumps: [SCHEDULE], check: wholeRule(RANGES.defaultPassingSeconds, 'The default passing time in seconds') },
  defaultHeadCount: { label: 'Change the default head count', bumps: [SCHEDULE], check: wholeRule(RANGES.headCount, 'The default head count') },
  secondsPerCell: { label: 'Change seconds per corridor cell', bumps: [GEOMETRY, SCHEDULE], check: wholeRule(RANGES.secondsPerCell, 'Seconds per corridor cell') },
  secondsPerStair: { label: 'Change seconds per stair connection', bumps: [GEOMETRY, SCHEDULE], check: wholeRule(RANGES.secondsPerStair, 'Seconds per stair connection') },
  cellScale: { label: 'Change the cell scale', bumps: [], check: (value) => (isCellScale(value) ? null : CELL_SCALE_RULE) },
  'colourScale.mode': { label: 'Change the colour scale', bumps: [], check: choiceRule(COLOUR_SCALE_MODES, 'The colour scale') },
  'colourScale.bands': {
    label: 'Change the colour bands',
    bumps: [],
    check: (value) => (Array.isArray(value) && value.length === 4 && value.every((band, i) => inRange(band, RANGES.colourBand) && (i === 0 || band > value[i - 1])) ? null : 'The bands are four whole numbers, each larger than the one before.'),
  },
  'checks.consecutiveLimit': { label: 'Change the consecutive-periods limit', bumps: [SCHEDULE], check: wholeRule(RANGES.consecutiveLimit, 'The consecutive-periods limit') },
  'checks.passingMarginSeconds': { label: 'Change the passing margin', bumps: [SCHEDULE], check: wholeRule(RANGES.passingMarginSeconds, 'The passing margin in seconds') },
  'checks.off': {
    label: 'Change which checks are switched off',
    bumps: [SCHEDULE],
    check: (value) => {
      if (!Array.isArray(value) || !value.every((kind) => typeof kind === 'string') || new Set(value).size !== value.length) return 'The checks switched off are a list of check kinds, each once.';
      const unknown = value.find((kind) => !CHECK_KINDS.includes(kind));
      return unknown === undefined ? null : '"' + unknown + '" is not one of the checks, so it cannot be switched off.';
    },
  },
  timeFormat: { label: 'Change the time format', bumps: [], check: choiceRule(TIME_FORMATS, 'The time format') },
  'paper.size': { label: 'Change the paper size', bumps: [], check: choiceRule(PAPER_SIZES, 'The paper size') },
  'paper.orientation': { label: 'Change the paper orientation', bumps: [], check: choiceRule(PAPER_ORIENTATIONS, 'The paper orientation') },
  theme: { label: 'Change the theme', bumps: [], check: choiceRule(THEMES, 'The theme') },
};

// Every key setSetting takes, plus 'periods', which it hands to setPeriods.
export const SETTING_KEYS = ['periods'].concat(Object.keys(SETTINGS));

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return sameList(a, b);
  // a Cell scale: the same unit and length is the same setting
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);
  return a === b;
}

// A setting's value as it is kept: a copy, so the caller's object is not the project's.
function keptValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function resizeDays(project, periods) {
  let next = withKey(project, 'groups', mapShared(project.groups, (group) => {
    let days = group.days;
    for (const dayTypeId of Object.keys(group.days)) {
      const day = group.days[dayTypeId];
      if (day.length === periods) continue;
      const resized = day.slice(0, periods);
      while (resized.length < periods) resized.push(emptySlot());
      days = { ...days, [dayTypeId]: resized };
    }
    return withKey(group, 'days', days);
  }));
  next = withKey(next, 'dayTypes', mapShared(next.dayTypes, (dayType) => {
    if (dayType.bells.length === periods) return dayType;
    const bells = dayType.bells.slice(0, periods);
    while (bells.length < periods) bells.push(null);
    return { ...dayType, bells };
  }));
  // bell schedules are sized as day types are, and a period past the end is
  // no longer one that does not meet
  if (Array.isArray(next.bellSchedules)) {
    next = withKey(next, 'bellSchedules', mapShared(next.bellSchedules, (schedule) => {
      let resized = schedule;
      if (schedule.bells.length !== periods) {
        const bells = schedule.bells.slice(0, periods);
        while (bells.length < periods) bells.push(null);
        resized = { ...resized, bells };
      }
      const off = schedule.off.filter((period) => period < periods);
      return off.length === schedule.off.length ? resized : { ...resized, off };
    }));
  }
  return next;
}

function slotIsEmpty(slot) {
  return slot.room === null && slot.roomText === '' && slot.label === '' && slot.teacherIds.length === 0;
}

// What changing periods per day to `periods` would remove, so the interface
// can say it and ask first. Nothing is changed here. The data itself stays in
// the undo entry (the entry holds the project as it was).
export function describePeriodChange(project, periods) {
  if (!inRange(periods, RANGES.periods)) refuse('Periods per day is a whole number from ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '.', 'bad-value');
  const from = project.settings.periods;
  const removedPeriods = [];
  for (let p = periods; p < from; p += 1) removedPeriods.push({ period: p, name: periodName(project.settings, p) });
  const groups = [];
  let slots = 0;
  for (const group of project.groups) {
    let count = 0;
    for (const day of Object.values(group.days)) count += day.slice(periods).filter((slot) => !slotIsEmpty(slot)).length;
    if (count > 0) groups.push({ groupId: group.id, name: group.name, slots: count });
    slots += count;
  }
  const dayTypes = [];
  let bells = 0;
  for (const dayType of project.dayTypes) {
    const count = dayType.bells.slice(periods).filter((bell) => bell !== null).length;
    if (count > 0) dayTypes.push({ dayTypeId: dayType.id, name: dayType.name, bells: count });
    bells += count;
  }
  const bellSchedules = [];
  for (const schedule of bellSchedulesOf(project)) {
    const count = schedule.bells.slice(periods).filter((bell) => bell !== null).length;
    const off = schedule.off.filter((period) => period >= periods).length;
    if (count > 0 || off > 0) bellSchedules.push({ bellScheduleId: schedule.id, name: schedule.name, bells: count, off });
    bells += count;
  }
  const offLost = bellSchedules.reduce((sum, entry) => sum + entry.off, 0);
  let scenarioChanges = 0;
  if (project.scenario) {
    for (const change of project.scenario.changes) {
      const used = [change.period, change.periodA, change.periodB].filter((value) => value !== undefined);
      if (used.some((value) => value >= periods)) scenarioChanges += 1;
    }
  }
  return { from, to: periods, removedPeriods, slots, bells, groups, dayTypes, bellSchedules, scenarioChanges, losesData: slots + bells + offLost + scenarioChanges > 0 };
}

// Periods per day. Going down removes the later periods from every day, every
// day type's bells and every bell schedule, and the later periods from each
// schedule's list of those that do not meet; undo brings them back.
export const setPeriods = action(
  {
    label: (before, payload) => 'Change periods per day to ' + payload.periods,
    bumps: [SCHEDULE],
    focus: () => ({ section: 'project' }),
  },
  (project, payload) => {
    const periods = payload.periods;
    if (!inRange(periods, RANGES.periods)) refuse('Periods per day is a whole number from ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '.', 'bad-value');
    if (periods === project.settings.periods) return project;
    return resizeDays(patch(project, ['settings', 'periods'], () => periods), periods);
  },
);

// One setting. payload: { key, value }, key one of SETTING_KEYS.
export const setSetting = action(
  {
    label: (before, payload) => (payload.key === 'periods' ? 'Change periods per day to ' + payload.value : SETTINGS[payload.key].label),
    bumps: (before, payload) => (payload.key === 'periods' ? [SCHEDULE] : SETTINGS[payload.key].bumps),
    focus: () => ({ section: 'project' }),
  },
  (project, payload, ctx) => {
    if (payload.key === 'periods') return setPeriods(project, { periods: payload.value }, ctx);
    const rule = SETTINGS[payload.key];
    if (!rule) refuse('There is no setting called "' + payload.key + '".', 'bad-value');
    const problem = rule.check(payload.value);
    if (problem) refuse(problem, 'bad-value');
    const value = keptValue(payload.value);
    return patch(project, ['settings'].concat(payload.key.split('.')), (current) => (sameValue(current, value) ? current : value));
  },
);

// Reset to defaults resets settings only. Periods per day stays as it is,
// because it shapes the schedule and this never touches the schedule.
export const resetSettings = action(
  { label: 'Reset settings to defaults', bumps: [GEOMETRY, SCHEDULE], focus: () => ({ section: 'project' }) },
  (project, payload) => {
    const defaults = defaultSettings();
    defaults.periods = project.settings.periods;
    if (payload && PAPER_SIZES.includes(payload.paperSize)) defaults.paper.size = payload.paperSize;
    if (JSON.stringify(defaults) === JSON.stringify(project.settings)) return project;
    return { ...project, settings: defaults };
  },
);

const PUBLISH = {
  passcode: (value) => (typeof value === 'string' ? null : 'The passcode is text. Leave it empty to turn protection off.'),
  stalenessDays: wholeRule(RANGES.stalenessDays, 'The staleness period in days'),
  teacherNamesOnMap: (value) => (typeof value === 'boolean' ? null : 'Teacher names on the map is on or off.'),
  lastPublishedAt: (value) => (value === null || isIsoDate(value) ? null : 'The last published time is a date.'),
  staleAtCalendarEnd: (value) => (typeof value === 'boolean' ? null : 'Whether a published file is stale the day after the calendar ends is on or off.'),
};

// One publish setting. payload: { key, value }; key is passcode,
// stalenessDays, teacherNamesOnMap, lastPublishedAt, staleAtCalendarEnd or
// views.<view>, the calendar view included.
export const setPublishSetting = action(
  { label: 'Change a publish setting', bumps: [], focus: () => ({ section: 'staff' }) },
  (project, payload) => {
    const key = payload.key;
    if (typeof key === 'string' && key.startsWith('views.')) {
      const view = key.slice(6);
      if (!PUBLISH_VIEWS.includes(view) && !LATER_PUBLISH_VIEWS.includes(view)) refuse('There is no view called "' + view + '".', 'bad-value');
      if (typeof payload.value !== 'boolean') refuse('A view is on or off.', 'bad-value');
      return patch(project, ['publish', 'views', view], () => payload.value);
    }
    const rule = PUBLISH[key];
    if (!rule) refuse('There is no publish setting called "' + key + '".', 'bad-value');
    const problem = rule(payload.value);
    if (problem) refuse(problem, 'bad-value');
    return patch(project, ['publish', key], () => payload.value);
  },
);

// When a file was last published. payload: { at }, an ISO time. Quiet: when
// the file was made is not the user's work on the school, so it is not an
// undo step, and undoing something else does not bring an older time back.
export const notePublished = action(
  { label: 'Note when the file was published', bumps: [], quiet: true },
  (project, payload) => setPublishSetting(project, { key: 'lastPublishedAt', value: payload.at }),
);

// Getting started. payload: any of { step, dismissed, neverShow }. Quiet:
// ticking a step or hiding the card is not a change to the school, so it is
// not an undo step and does not count as the project being modified.
export const setOnboarding = action(
  { label: 'Change getting started', bumps: [], quiet: true },
  (project, payload) => {
    let onboarding = project.onboarding;
    if (typeof payload.step === 'string' && payload.step !== '' && onboarding.steps[payload.step] !== true) onboarding = { ...onboarding, steps: { ...onboarding.steps, [payload.step]: true } };
    if (typeof payload.dismissed === 'boolean') onboarding = withKey(onboarding, 'dismissed', payload.dismissed);
    if (typeof payload.neverShow === 'boolean') onboarding = withKey(onboarding, 'neverShow', payload.neverShow);
    return withKey(project, 'onboarding', onboarding);
  },
);

// ---------------------------------------------------------------- subjects

// How many rooms and teachers use a subject, for the sentence before deleting.
export function describeSubjectUse(project, subjectId) {
  return {
    rooms: allRooms(project).filter((room) => room.subjectId === subjectId).length,
    teachers: project.teachers.filter((teacher) => teacher.subjectId === subjectId).length,
  };
}

export const addSubject = action(
  {
    label: (before, payload) => 'Add subject ' + (payload.name || payload.code || ''),
    bumps: [BUILDING, SCHEDULE],
    focus: () => ({ section: 'schedule', tab: 'subjects' }),
  },
  (project, payload, ctx) => {
    const subject = {
      id: newId(project, payload, ctx, 's'),
      code: needText(payload.code === undefined ? '' : payload.code, 'A subject code'),
      name: needText(payload.name === undefined ? '' : payload.name, 'A subject name'),
      colour: needColour(payload.colour === undefined ? '#5a6b7b' : payload.colour),
    };
    return { ...project, subjects: project.subjects.concat([subject]) };
  },
);

function editSubject(project, payload, fields) {
  need(project.subjects, payload.id, 'subject');
  return withKey(project, 'subjects', mapShared(project.subjects, (subject) => {
    if (subject.id !== payload.id) return subject;
    let next = subject;
    for (const key of fields) {
      if (payload[key] === undefined) continue;
      next = withKey(next, key, key === 'colour' ? needColour(payload[key]) : needText(payload[key], 'A subject ' + key));
    }
    return next;
  }));
}

// payload: { id, name, code } with either or both.
export const renameSubject = action(
  { label: (before, payload) => 'Rename subject to ' + (payload.name !== undefined ? payload.name : payload.code), bumps: [BUILDING, SCHEDULE], focus: () => ({ section: 'schedule', tab: 'subjects' }) },
  (project, payload) => editSubject(project, payload, ['name', 'code']),
);

export const recolourSubject = action(
  { label: (before, payload) => 'Recolour subject ' + (before.subjects.find((subject) => subject.id === payload.id) || { name: '' }).name, bumps: [BUILDING, SCHEDULE], focus: () => ({ section: 'schedule', tab: 'subjects' }) },
  (project, payload) => editSubject(project, payload, ['colour']),
);

// payload: { id, toIndex }.
export const reorderSubject = action(
  { label: (before, payload) => 'Move subject ' + (before.subjects.find((subject) => subject.id === payload.id) || { name: '' }).name, bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'subjects' }) },
  (project, payload) => withKey(project, 'subjects', moveItem(project.subjects, payload.id, payload.toIndex, 'subject')),
);

// Rooms and teachers that used the subject are left with no subject.
export const deleteSubject = action(
  { label: (before, payload) => 'Delete subject ' + (before.subjects.find((subject) => subject.id === payload.id) || { name: '' }).name, bumps: [BUILDING, SCHEDULE], focus: () => ({ section: 'schedule', tab: 'subjects' }) },
  (project, payload) => {
    need(project.subjects, payload.id, 'subject');
    let next = { ...project, subjects: project.subjects.filter((subject) => subject.id !== payload.id) };
    next = mapRooms(next, (room) => (room.subjectId === payload.id ? { ...room, subjectId: null } : room));
    next = withKey(next, 'teachers', mapShared(next.teachers, (teacher) => (teacher.subjectId === payload.id ? { ...teacher, subjectId: null } : teacher)));
    return next;
  },
);

// ---------------------------------------------------------------- teachers

function teacherName(project, id) {
  const teacher = project.teachers.find((candidate) => candidate.id === id);
  return teacher ? teacher.name : '';
}

function needFreeTeacherName(project, name, exceptId) {
  needName(name, 'A teacher');
  const clash = project.teachers.find((teacher) => teacher.id !== exceptId && nameKey(teacher.name) === nameKey(name));
  if (clash) refuse('There is already a teacher called "' + clash.name + '". Each teacher is on the list once; use that one, or type a different name.', 'duplicate-name');
  return name;
}

function needSubjectRef(project, subjectId) {
  if (subjectId === null) return null;
  need(project.subjects, subjectId, 'subject');
  return subjectId;
}

function needRoomRefs(project, roomIds) {
  if (!Array.isArray(roomIds)) refuse('The rooms of a teacher are a list of rooms.', 'bad-value');
  const unique = Array.from(new Set(roomIds));
  for (const roomId of unique) if (!findRoom(project, roomId)) refuse('One of those rooms is no longer in the building. Pick the rooms again.', 'missing');
  return unique;
}

function needTeacherRefs(project, teacherIds) {
  if (!Array.isArray(teacherIds)) refuse('The teachers are a list of teachers.', 'bad-value');
  const unique = Array.from(new Set(teacherIds));
  for (const teacherId of unique) need(project.teachers, teacherId, 'teacher');
  return unique;
}

// Make the rooms' own lists agree with "this teacher is based in these rooms".
function syncRoomsToTeacher(project, teacherId, roomIds) {
  return mapRooms(project, (room) => {
    const wanted = roomIds.includes(room.id);
    const listed = room.teacherIds.includes(teacherId);
    if (wanted === listed) return room;
    return { ...room, teacherIds: wanted ? room.teacherIds.concat([teacherId]) : room.teacherIds.filter((id) => id !== teacherId) };
  });
}

// Teachers whose names differ only by spaces, full stops and the like
// ("Ms. Okafor", "Ms Okafor"): lists of two or more, to offer a merge.
export function findNearDuplicateTeachers(project) {
  const byKey = new Map();
  for (const teacher of project.teachers) {
    const key = looseNameKey(teacher.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(teacher);
  }
  return Array.from(byKey.values()).filter((list) => list.length > 1);
}

// payload: { name, subjectId, roomIds, notes } and optionally id.
export const addTeacher = action(
  { label: (before, payload) => 'Add teacher ' + payload.name, bumps: [BUILDING, SCHEDULE], focus: (before, payload, after) => ({ section: 'schedule', tab: 'teachers', teacherId: after.teachers[after.teachers.length - 1].id }) },
  (project, payload, ctx) => {
    const teacher = {
      id: newId(project, payload, ctx, 't'),
      name: needFreeTeacherName(project, payload.name, null),
      subjectId: needSubjectRef(project, payload.subjectId === undefined ? null : payload.subjectId),
      roomIds: needRoomRefs(project, payload.roomIds === undefined ? [] : payload.roomIds),
      notes: needText(payload.notes === undefined ? '' : payload.notes, 'A teacher\'s notes'),
    };
    return syncRoomsToTeacher({ ...project, teachers: project.teachers.concat([teacher]) }, teacher.id, teacher.roomIds);
  },
);

// payload: { id } and any of { name, subjectId, roomIds, notes }.
export const editTeacher = action(
  { label: (before, payload) => 'Edit teacher ' + teacherName(before, payload.id), bumps: [BUILDING, SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'teachers', teacherId: payload.id }) },
  (project, payload) => {
    const teacher = need(project.teachers, payload.id, 'teacher');
    let next = teacher;
    if (payload.name !== undefined) next = withKey(next, 'name', needFreeTeacherName(project, payload.name, teacher.id));
    if (payload.subjectId !== undefined) next = withKey(next, 'subjectId', needSubjectRef(project, payload.subjectId));
    if (payload.notes !== undefined) next = withKey(next, 'notes', needText(payload.notes, 'A teacher\'s notes'));
    let roomIds = teacher.roomIds;
    if (payload.roomIds !== undefined) {
      const wanted = needRoomRefs(project, payload.roomIds);
      if (!sameList(wanted, teacher.roomIds)) roomIds = wanted;
      next = withKey(next, 'roomIds', roomIds);
    }
    if (next === teacher) return project;
    const updated = { ...project, teachers: project.teachers.map((candidate) => (candidate === teacher ? next : candidate)) };
    return roomIds === teacher.roomIds ? updated : syncRoomsToTeacher(updated, teacher.id, roomIds);
  },
);

// The teachers based in a room, main teacher first. payload: { roomId, teacherIds }.
export const setRoomTeachers = action(
  { label: (before, payload) => 'Change the teachers of ' + nameOfRoom(findRoom(before, payload.roomId), false), bumps: [BUILDING, SCHEDULE], focus: (before, payload) => ({ section: 'building', roomId: payload.roomId }) },
  (project, payload) => {
    const room = findRoom(project, payload.roomId);
    if (!room) refuse('That room is no longer in the building.', 'missing');
    const teacherIds = needTeacherRefs(project, payload.teacherIds);
    if (sameList(teacherIds, room.teacherIds)) return project;
    const next = mapRooms(project, (candidate) => (candidate.id === room.id ? { ...candidate, teacherIds } : candidate));
    return withKey(next, 'teachers', mapShared(next.teachers, (teacher) => {
      const wanted = teacherIds.includes(teacher.id);
      const listed = teacher.roomIds.includes(room.id);
      if (wanted === listed) return teacher;
      return { ...teacher, roomIds: wanted ? teacher.roomIds.concat([room.id]) : teacher.roomIds.filter((id) => id !== room.id) };
    }));
  },
);

function dropTeacherRefs(project, teacherId) {
  const without = (list) => (list.includes(teacherId) ? list.filter((id) => id !== teacherId) : list);
  const next = mapRooms(project, (room) => withKey(room, 'teacherIds', without(room.teacherIds)));
  return mapSlots(next, (slot) => withKey(slot, 'teacherIds', without(slot.teacherIds)));
}

export const deleteTeacher = action(
  { label: (before, payload) => 'Delete teacher ' + teacherName(before, payload.id), bumps: [BUILDING, SCHEDULE], focus: () => ({ section: 'schedule', tab: 'teachers' }) },
  (project, payload) => {
    need(project.teachers, payload.id, 'teacher');
    return dropTeacherRefs({ ...project, teachers: project.teachers.filter((teacher) => teacher.id !== payload.id) }, payload.id);
  },
);

// Merge one teacher into another. payload: { keepId, mergeId }. Every room
// and slot that named the merged teacher names the kept one; the kept
// teacher's subject and notes win, and the merged teacher's fill any gap.
export const mergeTeachers = action(
  { label: (before, payload) => 'Merge ' + teacherName(before, payload.mergeId) + ' into ' + teacherName(before, payload.keepId), bumps: [BUILDING, SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'teachers', teacherId: payload.keepId }) },
  (project, payload) => {
    const keep = need(project.teachers, payload.keepId, 'teacher');
    const gone = need(project.teachers, payload.mergeId, 'teacher');
    if (keep === gone) refuse('Pick two different teachers to merge.', 'bad-value');
    const swap = (list) => {
      if (!list.includes(gone.id)) return list;
      return Array.from(new Set(list.map((id) => (id === gone.id ? keep.id : id))));
    };
    let next = mapRooms(project, (room) => withKey(room, 'teacherIds', swap(room.teacherIds)));
    next = mapSlots(next, (slot) => withKey(slot, 'teacherIds', swap(slot.teacherIds)));
    const notes = keep.notes === '' ? gone.notes : gone.notes === '' || gone.notes === keep.notes ? keep.notes : keep.notes + '\n' + gone.notes;
    const merged = {
      ...keep,
      subjectId: keep.subjectId === null ? gone.subjectId : keep.subjectId,
      roomIds: Array.from(new Set(keep.roomIds.concat(gone.roomIds))),
      notes,
    };
    next = { ...next, teachers: next.teachers.filter((teacher) => teacher.id !== gone.id).map((teacher) => (teacher.id === keep.id ? merged : teacher)) };
    return next;
  },
);

// ---------------------------------------------------------------- groups

function groupName(project, id) {
  const group = project.groups.find((candidate) => candidate.id === id);
  return group ? group.name : '';
}

function needFreeGroupName(project, name, exceptId) {
  needName(name, 'A group');
  const clash = project.groups.find((group) => group.id !== exceptId && nameKey(group.name) === nameKey(name));
  if (clash) refuse('There is already a group called "' + clash.name + '". Group names are unique, whatever the capitals; type a different name.', 'duplicate-name');
  return name;
}

function needHeadCount(value) {
  if (value !== null && !inRange(value, RANGES.headCount)) refuse('A head count is a whole number from ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + ', or empty to use the school default.', 'bad-value');
  return value;
}

function ownDayTypeIds(project) {
  return project.dayTypes.filter((dayType, index) => index === 0 || dayType.own).map((dayType) => dayType.id);
}

// payload: { name, grade, headCount, colour } and optionally id. A group with
// no colour given takes the next unused preset.
export const addGroup = action(
  { label: (before, payload) => 'Add group ' + payload.name, bumps: [SCHEDULE], focus: (before, payload, after) => ({ section: 'schedule', tab: 'groups', groupId: after.groups[after.groups.length - 1].id }) },
  (project, payload, ctx) => {
    const days = {};
    for (const dayTypeId of ownDayTypeIds(project)) days[dayTypeId] = emptyDay(project.settings.periods);
    const group = {
      id: newId(project, payload, ctx, 'g'),
      name: needFreeGroupName(project, payload.name, null),
      grade: needText(payload.grade === undefined ? '' : payload.grade, 'A grade'),
      headCount: needHeadCount(payload.headCount === undefined ? null : payload.headCount),
      colour: payload.colour === undefined ? nextGroupColour(project.groups) : needColour(payload.colour),
      days,
    };
    return { ...project, groups: project.groups.concat([group]) };
  },
);

// payload: { id } and any of { name, grade, headCount, colour }.
export const editGroup = action(
  { label: (before, payload) => 'Edit group ' + groupName(before, payload.id), bumps: [SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'groups', groupId: payload.id }) },
  (project, payload) => {
    const group = need(project.groups, payload.id, 'group');
    let next = group;
    if (payload.name !== undefined) next = withKey(next, 'name', needFreeGroupName(project, payload.name, group.id));
    if (payload.grade !== undefined) next = withKey(next, 'grade', needText(payload.grade, 'A grade'));
    if (payload.headCount !== undefined) next = withKey(next, 'headCount', needHeadCount(payload.headCount));
    if (payload.colour !== undefined) next = withKey(next, 'colour', needColour(payload.colour));
    if (next === group) return project;
    return { ...project, groups: project.groups.map((candidate) => (candidate === group ? next : candidate)) };
  },
);

// "7-1" gives "7-1 (Copy)", then "7-1 (Copy) 2", "7-1 (Copy) 3". Copying a
// copy counts on from the same name rather than stacking "(Copy) (Copy)".
export function copyName(project, name) {
  const base = name.replace(/ \(Copy\)( \d+)?$/, '');
  const used = new Set(project.groups.map((group) => nameKey(group.name)));
  for (let n = 1; ; n += 1) {
    const candidate = base + ' (Copy)' + (n === 1 ? '' : ' ' + n);
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

// payload: { id } and optionally newId. The copy sits straight after the
// original, with the same days and the next unused colour.
export const duplicateGroup = action(
  { label: (before, payload) => 'Duplicate group ' + groupName(before, payload.id), bumps: [SCHEDULE], focus: (before, payload, after) => ({ section: 'schedule', tab: 'groups', groupId: after.groups[before.groups.findIndex((group) => group.id === payload.id) + 1].id }) },
  (project, payload, ctx) => {
    const group = need(project.groups, payload.id, 'group');
    const copy = {
      ...group,
      id: newId(project, payload, ctx, 'g', 'newId'),
      name: copyName(project, group.name),
      colour: nextGroupColour(project.groups),
    };
    const index = project.groups.indexOf(group);
    const groups = project.groups.slice();
    groups.splice(index + 1, 0, copy);
    return { ...project, groups };
  },
);

export const deleteGroup = action(
  { label: (before, payload) => 'Delete group ' + groupName(before, payload.id), bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'groups' }) },
  (project, payload) => {
    need(project.groups, payload.id, 'group');
    return { ...project, groups: project.groups.filter((group) => group.id !== payload.id) };
  },
);

function needOwnDayType(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) refuse('That day type is no longer in the project.', 'missing');
  if (!isOwnCopy(project, dayTypeId)) refuse(dayType.name + ' is the same as ' + effectiveDayType(project, dayTypeId).name + '. Make it its own copy to change it.', 'same-as-base');
  return dayType;
}

function needPeriod(project, period) {
  if (!Number.isInteger(period) || period < 0 || period >= project.settings.periods) refuse('That period is not in the school day. The day has ' + project.settings.periods + '.', 'bad-value');
  return period;
}

function slotFocus(before, payload) {
  return { section: 'schedule', tab: 'groups', groupId: payload.groupId, dayTypeId: payload.dayTypeId || payload.toDayTypeId, period: payload.period === undefined ? payload.to : payload.period };
}

// One slot of one group. payload: { groupId, dayTypeId, period, slot } where
// slot has any of { room, roomText, label, teacherIds }. Naming a room clears
// the kept room text; { room: null, roomText: "204" } is a room that is not
// in the building; { room: null } empties the room.
export const setSlot = action(
  {
    label: (before, payload) => 'Change ' + groupName(before, payload.groupId) + ' in ' + periodName(before.settings, payload.period) + ' on ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name,
    bumps: [SCHEDULE],
    focus: slotFocus,
  },
  (project, payload) => {
    const group = need(project.groups, payload.groupId, 'group');
    needOwnDayType(project, payload.dayTypeId);
    const period = needPeriod(project, payload.period);
    const change = payload.slot || {};
    const current = group.days[payload.dayTypeId][period];
    let next = current;
    if (change.room !== undefined) {
      if (change.room !== null && !findRoom(project, change.room)) refuse('That room is no longer in the building. Pick another room.', 'missing');
      next = withKey(next, 'room', change.room);
      if (change.roomText === undefined) next = withKey(next, 'roomText', '');
    }
    if (change.roomText !== undefined) next = withKey(next, 'roomText', needText(change.roomText, 'The room text'));
    if (change.label !== undefined) next = withKey(next, 'label', needText(change.label, 'A label'));
    if (change.teacherIds !== undefined) {
      const teacherIds = needTeacherRefs(project, change.teacherIds);
      if (!sameList(teacherIds, current.teacherIds)) next = { ...next, teacherIds };
    }
    if (next === current) return project;
    const index = project.groups.indexOf(group);
    return patch(project, ['groups', index, 'days', payload.dayTypeId, period], () => next);
  },
);

// Move a group's assignment to another period of the same day. The two
// periods trade places, so nothing is overwritten.
// payload: { groupId, dayTypeId, from, to }.
export const moveSlot = action(
  {
    label: (before, payload) => 'Move ' + groupName(before, payload.groupId) + '\'s ' + periodName(before.settings, payload.from) + ' to ' + periodName(before.settings, payload.to),
    bumps: [SCHEDULE],
    focus: slotFocus,
  },
  (project, payload) => {
    const group = need(project.groups, payload.groupId, 'group');
    needOwnDayType(project, payload.dayTypeId);
    const from = needPeriod(project, payload.from);
    const to = needPeriod(project, payload.to);
    if (from === to) return project;
    const index = project.groups.indexOf(group);
    return patch(project, ['groups', index, 'days', payload.dayTypeId], (day) => {
      const next = day.slice();
      next[from] = day[to];
      next[to] = day[from];
      return next;
    });
  },
);

function copySlot(slot) {
  return { ...slot, teacherIds: slot.teacherIds.slice() };
}

function sameSlot(a, b) {
  return a.room === b.room && a.roomText === b.roomText && a.label === b.label && sameList(a.teacherIds, b.teacherIds);
}

// Copy one day type's days onto another, for one group or for every group.
// payload: { fromDayTypeId, toDayTypeId } and optionally groupId. A day type
// that is the same as another gives that one's days. Copying onto a day type
// that is already the same as the source changes nothing; onto one that is
// the same as anything else is refused, since it has no days of its own.
export const copyDay = action(
  {
    label: (before, payload) => 'Copy ' + (findDayType(before, payload.fromDayTypeId) || { name: '' }).name + ' to ' + (findDayType(before, payload.toDayTypeId) || { name: '' }).name + (payload.groupId ? ' for ' + groupName(before, payload.groupId) : ' for every group'),
    bumps: [SCHEDULE],
    focus: slotFocus,
  },
  (project, payload) => {
    const from = findDayType(project, payload.fromDayTypeId);
    const to = findDayType(project, payload.toDayTypeId);
    if (!from || !to) refuse('That day type is no longer in the project.', 'missing');
    if (payload.groupId !== undefined) need(project.groups, payload.groupId, 'group');
    const sourceId = effectiveDayType(project, from.id).id;
    if (!isOwnCopy(project, to.id)) {
      if (sourceId === effectiveDayType(project, to.id).id) return project;
      refuse(to.name + ' is the same as ' + effectiveDayType(project, to.id).name + '. Make it its own copy to change it.', 'same-as-base');
    }
    if (sourceId === to.id) return project;
    return withKey(project, 'groups', mapShared(project.groups, (group) => {
      if (payload.groupId !== undefined && group.id !== payload.groupId) return group;
      const source = group.days[sourceId] || emptyDay(project.settings.periods);
      const target = group.days[to.id] || emptyDay(project.settings.periods);
      if (group.days[to.id] && source.every((slot, p) => sameSlot(slot, target[p]))) return group;
      return { ...group, days: { ...group.days, [to.id]: source.map(copySlot) } };
    }));
  },
);

// ---------------------------------------------------------------- day types

function dayTypeFocus(before, payload) {
  return { section: 'schedule', tab: 'day', dayTypeId: payload.dayTypeId };
}

// payload: { dayTypeId, name }. Refused when the name is blank, longer than
// NAME_MOST characters, or another day type's, ignoring case and spaces
// (ARCHITECTURE 17.2; old files with two alike are left as they are).
export const renameDayType = action(
  { label: (before, payload) => 'Rename ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' to ' + payload.name, bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    // a field left as it was asks nothing, even of a file with two alike
    if (payload.name === dayType.name) return project;
    needDayTypeName(project, payload.name, payload.dayTypeId);
    return withKey(project, 'dayTypes', mapShared(project.dayTypes, (dayType) => (dayType.id === payload.dayTypeId ? withKey(dayType, 'name', payload.name) : dayType)));
  },
);

// Turn "same as" into a copy that can be edited: its bells and every group's
// day start as those of the day type it was the same as.
export const makeOwnCopy = action(
  { label: (before, payload) => 'Make ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' its own copy', bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    need(project.dayTypes, payload.dayTypeId, 'day type');
    return changeDayTypeKind(project, payload.dayTypeId, true, null);
  },
);

// Back to "same as A Day". The day type's own bells and days go, with the
// open scenario's changes on them, and the day types that were the same as it
// are the same as A Day too; undo brings them back. One that is the same as
// another day type is made the same as A Day. The outcome is
// describeDayTypeKind's, as setDayTypeKind's.
export const revertToBase = action(
  { label: (before, payload) => 'Make ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' the same as ' + baseDayType(before).name, bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    if (dayType === baseDayType(project)) refuse(dayType.name + ' is the first day type. The others can be the same as it; it cannot be the same as another.', 'base');
    return reporting(project, changeDayTypeKind(project, payload.dayTypeId, false, null), describeDayTypeKind(project, { dayTypeId: payload.dayTypeId, own: false }));
  },
);

// How much a day type would lose by going back to "same as A Day".
export function describeRevert(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType || !isOwnCopy(project, dayTypeId) || dayType === baseDayType(project)) return { bells: 0, slots: 0, groups: 0, losesData: false };
  const bells = dayType.bells.filter((bell) => bell !== null).length;
  let slots = 0;
  let groups = 0;
  for (const group of project.groups) {
    const count = (group.days[dayTypeId] || []).filter((slot) => !slotIsEmpty(slot)).length;
    slots += count;
    if (count > 0) groups += 1;
  }
  return { bells, slots, groups, losesData: bells + slots > 0 };
}

function needBell(bell) {
  if (bell === null) return null;
  if (!bell || !isBellTime(bell.start) || !isBellTime(bell.end)) refuse('A bell time is a start and an end on the 24-hour clock, written HH:MM, for example 08:05 and 08:53.', 'bad-value');
  return { start: bell.start, end: bell.end };
}

function sameBell(a, b) {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

// One period's bell. payload: { dayTypeId, period, bell } with bell
// { start, end } or null. An end before its start is allowed: the bell checks
// warn about it and never block.
export const setBell = action(
  { label: (before, payload) => 'Change the bell for ' + periodName(before.settings, payload.period) + ' on ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name, bumps: [SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'day', dayTypeId: payload.dayTypeId, period: payload.period }) },
  (project, payload) => {
    const dayType = needOwnDayType(project, payload.dayTypeId);
    const period = needPeriod(project, payload.period);
    const bell = needBell(payload.bell);
    if (sameBell(bell, dayType.bells[period])) return project;
    return patch(project, ['dayTypes', project.dayTypes.indexOf(dayType), 'bells', period], () => bell);
  },
);

// A whole bell schedule. payload: { dayTypeId, bells } with one entry per period.
export const setBells = action(
  { label: (before, payload) => 'Change the bell schedule of ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name, bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = needOwnDayType(project, payload.dayTypeId);
    if (!Array.isArray(payload.bells) || payload.bells.length !== project.settings.periods) refuse('A bell schedule has one entry per period: ' + project.settings.periods + '.', 'bad-value');
    const bells = payload.bells.map(needBell);
    if (bells.every((bell, p) => sameBell(bell, dayType.bells[p]))) return project;
    return patch(project, ['dayTypes', project.dayTypes.indexOf(dayType), 'bells'], (current) => bells.map((bell, p) => (sameBell(bell, current[p]) ? current[p] : bell)));
  },
);

// ================================================================ SV2-75: day types, bell schedules, the calendar (start)
//
// ARCHITECTURE 17.2 to 17.4. Every action here is one undo step and bumps
// SCHEDULE, since findings and movement read all of it. The limits on names
// and counts live here and nowhere else (17.1). An action whose result needs
// saying (what a delete took, how many school days a break closed) reports
// it as the entry's outcome: scheduleOutcome(after).

const scheduleOutcomes = new WeakMap();

function reporting(project, next, outcome) {
  if (next !== project) scheduleOutcomes.set(next, outcome);
  return next;
}

// What a day-type, bell-schedule or calendar action here reported for the
// project it returned, or null.
export function scheduleOutcome(project) {
  return scheduleOutcomes.get(project) || null;
}

// "a", "a and b", "a, b and c".
function listWords(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function count(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function dayTypeName(project, dayTypeId) {
  return (findDayType(project, dayTypeId) || { name: '' }).name;
}

// A name for a thing in `list`: not blank, at most NAME_MOST characters, and
// no other's, ignoring case and spaces.
function needUniqueName(list, name, exceptId, what, whats) {
  needName(name, what);
  if (textLength(name) > NAME_MOST) refuse(what + '\'s name is at most ' + NAME_MOST + ' characters; this one has ' + textLength(name) + '. Type a shorter one.', 'too-long');
  const clash = list.find((item) => item.id !== exceptId && spacelessKey(item.name) === spacelessKey(name));
  if (clash) refuse('There is already ' + what.replace(/^A /, 'a ') + ' called "' + clash.name + '". ' + whats + ' names are unique, whatever the capitals and spaces; type a different name.', 'duplicate-name');
  return name;
}

// Words the calendar and its CSV use beside the names (import-calendar.js,
// the calendar's choices). A day type or bell schedule called one of them
// could not be told apart from it, so the name is refused, ignoring
// capitals and spaces. The reader keeps taking the word first (FORMATS.md).
const RESERVED_DAY_TYPE_NAMES = [
  ['No school', 'is what the calendar says for a date with no school'],
  ['Next in the rotation', 'is what the calendar says for a date that takes the next day type in the rotation'],
  ['As the calendar says', 'is what a date says when it follows the calendar'],
];
const RESERVED_SCHEDULE_NAMES = [
  ['Regular', 'is what the calendar says for a day type\'s own bells'],
  ['Regular bells', 'is what the calendar CSV reads as a day type\'s own bells'],
  ['As the weekday says', 'is what a date says when it takes its weekday\'s bells'],
];

function needUnreserved(name, reserved, what) {
  if (typeof name !== 'string') return;
  const word = reserved.find(([text]) => spacelessKey(text) === spacelessKey(name));
  if (word) refuse('"' + word[0] + '" ' + word[1] + ', so ' + what + ' cannot be called that: the calendar and its CSV could not tell the two apart. Type a different name.', 'reserved-name');
}

function needDayTypeName(project, name, exceptId) {
  needUnreserved(name, RESERVED_DAY_TYPE_NAMES, 'a day type');
  return needUniqueName(project.dayTypes, name, exceptId, 'A day type', 'Day type');
}

// A typed short name: 0 to SHORT_MOST characters, and no other's in `list`,
// ignoring case. "" means it is worked out from the name (dayShort).
function needShort(list, short, exceptId, what) {
  if (typeof short !== 'string') refuse('A short name is text.', 'bad-value');
  if (textLength(short) > SHORT_MOST) refuse('A short name is at most ' + SHORT_MOST + ' characters, so it fits on a date in the calendar.', 'too-long');
  if (short === '') return short;
  const clash = list.find((item) => item.id !== exceptId && typeof item.short === 'string' && item.short.toLowerCase() === short.toLowerCase());
  if (clash) refuse('"' + clash.short + '" is already the short name of ' + clash.name + '. Each ' + what + ' has its own; type another, or leave it empty to have one worked out.', 'duplicate-short');
  return short;
}

function copyBells(bells) {
  return bells.map((bell) => (bell === null ? null : { start: bell.start, end: bell.end }));
}

// The own day type `sameAs` may name for day type `dayTypeId`: null (the
// first day type) or another own day type. The first is kept as null.
function needSameAsTarget(project, sameAs, dayTypeId) {
  if (sameAs === null || sameAs === undefined) return null;
  const target = findDayType(project, sameAs);
  if (!target) refuse('That day type is no longer in the project.', 'missing');
  if (target.id === dayTypeId) refuse('A day type cannot be the same as itself. Choose another day type.', 'bad-value');
  if (!isOwnCopy(project, target.id)) refuse(target.name + ' is the same as ' + effectiveDayType(project, target.id).name + ', so nothing can be the same as it. Choose a day type with its own classes.', 'not-own');
  return target.id === baseDayType(project).id ? null : target.id;
}

// Every group's day on `toId` as a copy of its day on `fromId`.
function copyDaysTo(project, fromId, toId) {
  return project.groups.map((group) => ({ ...group, days: { ...group.days, [toId]: (group.days[fromId] || emptyDay(project.settings.periods)).map(copySlot) } }));
}

function withoutDays(groups, dayTypeId) {
  return mapShared(groups, (group) => {
    if (!(dayTypeId in group.days)) return group;
    const days = { ...group.days };
    delete days[dayTypeId];
    return { ...group, days };
  });
}

// What changing D's kind would take with it, for the sentence on the button
// ("Make C Day the same as A Day (14 groups' days on C Day go; Undo brings
// them back)"). payload as setDayTypeKind's. Nothing is changed here.
export function describeDayTypeKind(project, payload) {
  const dayType = findDayType(project, payload.dayTypeId);
  const none = { from: null, to: null, slots: 0, groups: 0, bells: 0, followers: [], scenarioChanges: 0, losesData: false };
  if (!dayType) return none;
  if (payload.own === true) {
    if (isOwnCopy(project, dayType.id)) return none;
    return { ...none, from: effectiveDayType(project, dayType.id).name };
  }
  const target = findDayType(project, payload.sameAs) || baseDayType(project);
  if (!isOwnCopy(project, dayType.id) || dayType === baseDayType(project)) return { ...none, to: target.name };
  const revert = describeRevert(project, dayType.id);
  const followers = followersOf(project, dayType.id).map((follower) => follower.name);
  // the scenario's changes on its own days go with them, as deleteDayType's do
  const scenarioChanges = scenarioChangesOn(project, dayType.id);
  return { from: null, to: target.name, slots: revert.slots, groups: revert.groups, bells: revert.bells, followers, scenarioChanges, losesData: revert.losesData || scenarioChanges > 0 };
}

function scenarioChangesOn(project, dayTypeId) {
  return project.scenario ? project.scenario.changes.filter((change) => change.dayTypeId === dayTypeId).length : 0;
}

// The project with the open scenario's changes on `dayTypeId` taken out.
function withoutScenarioChanges(project, dayTypeId) {
  if (scenarioChangesOn(project, dayTypeId) === 0) return project;
  return { ...project, scenario: { ...project.scenario, changes: project.scenario.changes.filter((change) => change.dayTypeId !== dayTypeId) } };
}

// The one rule for turning a day type into its own copy or into "same as":
// to own, a copy of what it was the same as; to same, its days and bells go,
// with the open scenario's changes on them, and the day types that were the
// same as it follow what it is now the same as.
function changeDayTypeKind(project, dayTypeId, own, sameAs) {
  const dayType = findDayType(project, dayTypeId);
  const index = project.dayTypes.indexOf(dayType);
  if (own) {
    if (isOwnCopy(project, dayTypeId)) return project;
    const from = effectiveDayType(project, dayTypeId);
    return {
      ...project,
      dayTypes: project.dayTypes.map((candidate) => (candidate === dayType ? { ...dayType, own: true, sameAs: null, bells: copyBells(from.bells) } : candidate)),
      groups: copyDaysTo(project, from.id, dayType.id),
    };
  }
  if (index === 0) refuse(dayType.name + ' is the first day type. The others can be the same as it; it cannot be the same as another.', 'base');
  const target = needSameAsTarget(project, sameAs, dayTypeId);
  if (!isOwnCopy(project, dayTypeId)) {
    if (effectiveDayType(project, dayTypeId).id === (target || project.dayTypes[0].id)) return project;
    return patch(project, ['dayTypes', index], (current) => ({ ...current, sameAs: target }));
  }
  const followers = new Set(followersOf(project, dayTypeId));
  return {
    ...withoutScenarioChanges(project, dayTypeId),
    dayTypes: project.dayTypes.map((candidate) => {
      if (candidate === dayType) return { ...dayType, own: false, sameAs: target, bells: emptyBells(project.settings.periods) };
      if (followers.has(candidate)) return { ...candidate, sameAs: target };
      return candidate;
    }),
    groups: withoutDays(project.groups, dayTypeId),
  };
}

// payload: { name, own, sameAs, copyOf, short } and optionally id. An own day
// type starts as a copy of `copyOf` (any day type: what it gives is what it
// means; left out, the first), every group's day and the bells; one that is
// not own is the same as `sameAs`, an own day type (left out, the first). It
// goes at the end of the list. At most DAY_TYPES_MOST.
export const addDayType = action(
  { label: (before, payload) => 'Add day type ' + payload.name, bumps: [SCHEDULE], focus: (before, payload, after) => ({ section: 'schedule', tab: 'day', dayTypeId: after.dayTypes[after.dayTypes.length - 1].id }) },
  (project, payload, ctx) => {
    const data = payload || {};
    if (project.dayTypes.length >= DAY_TYPES_MOST) refuse('A project has at most ' + DAY_TYPES_MOST + ' day types, and this one has ' + project.dayTypes.length + '. Delete one to add another.', 'limit');
    const name = needDayTypeName(project, data.name, null);
    const short = needShort(project.dayTypes, data.short === undefined ? '' : data.short, null, 'day type');
    const id = newId(project, data, ctx, 'd');
    if (data.own === true) {
      const source = data.copyOf === undefined || data.copyOf === null ? baseDayType(project) : findDayType(project, data.copyOf);
      if (!source) refuse('That day type is no longer in the project.', 'missing');
      const from = effectiveDayType(project, source.id);
      const dayType = { id, name, own: true, sameAs: null, short, bells: copyBells(from.bells) };
      return { ...project, dayTypes: project.dayTypes.concat([dayType]), groups: copyDaysTo(project, from.id, id) };
    }
    const dayType = { id, name, own: false, sameAs: needSameAsTarget(project, data.sameAs, id), short, bells: emptyBells(project.settings.periods) };
    return { ...project, dayTypes: project.dayTypes.concat([dayType]) };
  },
);

// What deleting D takes with it (ARCHITECTURE 17.12): its groups' days and
// its bells when it is its own copy; the day types the same as it go back to
// being the same as the first; the scenario's changes on it; its place in the
// calendar's rotation, its dated changes, and a weekday that was always it
// goes back to the rotation. Accepted findings are left: the checks list one
// that no longer arises as gone. Nothing is changed here.
export function describeDayTypeDelete(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType || dayType === baseDayType(project)) return null;
  const own = isOwnCopy(project, dayTypeId);
  const revert = own ? describeRevert(project, dayTypeId) : { slots: 0, groups: 0, bells: 0 };
  const followers = own ? followersOf(project, dayTypeId).map((follower) => follower.name) : [];
  const scenarioChanges = scenarioChangesOn(project, dayTypeId);
  const calendar = calendarOf(project);
  const dates = calendar && Array.isArray(calendar.dates) ? calendar.dates.filter((entry) => entry.day === dayTypeId).length : 0;
  const weekdays = calendar && Array.isArray(calendar.weekdays) ? calendar.weekdays.map((rule, w) => (rule && rule.day === dayTypeId ? w : -1)).filter((w) => w !== -1) : [];
  const rotation = calendar && Array.isArray(calendar.rotation) ? calendar.rotation.filter((id) => id === dayTypeId).length : 0;
  const parts = [];
  if (revert.slots > 0) parts.push('its classes for ' + count(revert.groups, 'group', 'groups'));
  if (revert.bells > 0) parts.push('its bells');
  if (dates > 0) parts.push(count(dates, 'date', 'dates') + ' in the calendar');
  if (weekdays.length > 0) parts.push(listWords(weekdays.map((w) => WEEKDAY_NAMES[w] + 's')) + ' in the calendar');
  if (rotation > 0) parts.push('its place in the rotation');
  if (scenarioChanges > 0) parts.push(count(scenarioChanges, 'change', 'changes') + ' in the scenario');
  let text = 'Deleted ' + dayType.name + (parts.length > 0 ? ', ' + listWords(parts) : '');
  if (followers.length > 0) text += '. ' + listWords(followers) + (followers.length === 1 ? ' is' : ' are') + ' now the same as ' + baseDayType(project).name;
  return { dayTypeId, name: dayType.name, own, slots: revert.slots, groups: revert.groups, bells: revert.bells, followers, scenarioChanges, dates, weekdays, rotation, text };
}

// payload: { dayTypeId }. The first day type cannot be deleted. The outcome
// is describeDayTypeDelete's, said in its `text` ("Deleted Testing Day, its
// bells and 3 dates in the calendar").
export const deleteDayType = action(
  { label: (before, payload) => 'Delete day type ' + dayTypeName(before, payload.dayTypeId), bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'day' }) },
  (project, payload, ctx) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    if (dayType === baseDayType(project)) refuse(dayType.name + ' comes first and cannot be deleted. Every other day type can be the same as it.', 'base');
    const outcome = describeDayTypeDelete(project, dayType.id);
    const followers = new Set(isOwnCopy(project, dayType.id) ? followersOf(project, dayType.id) : []);
    let next = {
      ...withoutScenarioChanges(project, dayType.id),
      dayTypes: project.dayTypes.filter((candidate) => candidate !== dayType).map((candidate) => (followers.has(candidate) ? { ...candidate, sameAs: null } : candidate)),
      groups: withoutDays(project.groups, dayType.id),
    };
    const calendar = calendarOf(project);
    if (calendar && (outcome.dates > 0 || outcome.weekdays.length > 0 || outcome.rotation > 0)) {
      const rotation = calendar.rotation.filter((id) => id !== dayType.id);
      next = withCalendar(next, {
        ...calendar,
        rotation: rotation.length > 0 ? rotation : [project.dayTypes[0].id],
        weekdays: calendar.weekdays.map((rule) => (rule.day === dayType.id ? { ...rule, day: DAY_ROTATION } : rule)),
        dates: calendar.dates.filter((entry) => entry.day !== dayType.id),
      }, ctx);
    }
    return reporting(project, next, outcome);
  },
);

// payload: { dayTypeId, toIndex }. The first day type stays first, so the
// others move among places 1 and on. The order is the display order
// everywhere and a new calendar's rotation.
export const reorderDayType = action(
  { label: (before, payload) => 'Move ' + dayTypeName(before, payload.dayTypeId) + ' in the list of day types', bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    if (dayType === baseDayType(project)) refuse(dayType.name + ' comes first and stays first.', 'base');
    if (!Number.isInteger(payload.toIndex)) refuse('A position in the list is a whole number.', 'bad-value');
    return withKey(project, 'dayTypes', moveItem(project.dayTypes, dayType.id, Math.max(1, payload.toIndex), 'day type'));
  },
);

// payload: { dayTypeId, own, sameAs }. own true: its own classes, starting as
// a copy of what it was the same as. own false: the same as `sameAs`, an own
// day type (null or left out: the first); its own days and bells go, and the
// day types that were the same as it are the same as `sameAs` too. Undo
// brings everything back. The outcome is describeDayTypeKind's.
export const setDayTypeKind = action(
  {
    label: (before, payload) => (payload.own === true ? 'Make ' + dayTypeName(before, payload.dayTypeId) + ' its own copy' : 'Make ' + dayTypeName(before, payload.dayTypeId) + ' the same as ' + (findDayType(before, payload.sameAs) || baseDayType(before)).name),
    bumps: [SCHEDULE],
    focus: dayTypeFocus,
  },
  (project, payload) => {
    need(project.dayTypes, payload.dayTypeId, 'day type');
    if (typeof payload.own !== 'boolean') refuse('A day type has its own classes, or is the same as another: own is true or false.', 'bad-value');
    const outcome = describeDayTypeKind(project, payload);
    return reporting(project, changeDayTypeKind(project, payload.dayTypeId, payload.own, payload.sameAs), outcome);
  },
);

// payload: { dayTypeId, short }: up to SHORT_MOST characters, "" to have one
// worked out from the name (dayShort).
export const setDayTypeShort = action(
  { label: (before, payload) => 'Change the short name of ' + dayTypeName(before, payload.dayTypeId), bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    const short = needShort(project.dayTypes, payload.short, dayType.id, 'day type');
    if ((dayType.short === undefined ? '' : dayType.short) === short) return project;
    return patch(project, ['dayTypes', project.dayTypes.indexOf(dayType)], (current) => ({ ...current, short }));
  },
);

// ---------------------------------------------------------------- bell schedules

function bellScheduleName(project, bellScheduleId) {
  return (bellSchedulesOf(project).find((schedule) => schedule.id === bellScheduleId) || { name: '' }).name;
}

function bellsFocus(before, payload, after) {
  const list = bellSchedulesOf(after);
  const id = payload.bellScheduleId || (list.length > 0 ? list[list.length - 1].id : undefined);
  return { section: 'schedule', tab: 'day', bellsId: id };
}

function needScheduleName(project, name, exceptId) {
  needUnreserved(name, RESERVED_SCHEDULE_NAMES, 'a bell schedule');
  return needUniqueName(bellSchedulesOf(project), name, exceptId, 'A bell schedule', 'Bell schedule');
}

// payload: { name, short, fromDayTypeId } and optionally id: another set of
// times for the same classes, starting as a copy of a day type's regular
// bells (left out, the first day type's), every period meeting. At most
// BELL_SCHEDULES_MOST.
export const addBellSchedule = action(
  { label: (before, payload) => 'Add bell schedule ' + payload.name, bumps: [SCHEDULE], focus: bellsFocus },
  (project, payload, ctx) => {
    const data = payload || {};
    const list = bellSchedulesOf(project);
    if (list.length >= BELL_SCHEDULES_MOST) refuse('A project has at most ' + BELL_SCHEDULES_MOST + ' bell schedules, and this one has ' + list.length + '. Delete one to add another.', 'limit');
    const name = needScheduleName(project, data.name, null);
    const short = needShort(list, data.short === undefined ? '' : data.short, null, 'bell schedule');
    const source = data.fromDayTypeId === undefined || data.fromDayTypeId === null ? baseDayType(project) : findDayType(project, data.fromDayTypeId);
    if (!source) refuse('That day type is no longer in the project.', 'missing');
    const schedule = { ...newBellSchedule(newId(project, data, ctx, 'b'), name, copyBells(effectiveDayType(project, source.id).bells)), short };
    return { ...project, bellSchedules: list.concat([schedule]) };
  },
);

function bellScheduleLabel(before, payload) {
  const name = bellScheduleName(before, payload.bellScheduleId);
  const keys = ['name', 'short', 'bell', 'off'].filter((key) => payload[key] !== undefined);
  if (keys.length !== 1) return 'Change bell schedule ' + name;
  if (keys[0] === 'name') return 'Rename bell schedule ' + name + ' to ' + payload.name;
  if (keys[0] === 'short') return 'Change the short name of ' + name;
  if (keys[0] === 'bell') return 'Change the bell for ' + periodName(before.settings, payload.period) + ' on ' + name;
  if (typeof payload.off === 'boolean') return (payload.off ? 'Make ' : 'Let ') + periodName(before.settings, payload.period) + (payload.off ? ' not meet on ' : ' meet on ') + name;
  return 'Change the periods that do not meet on ' + name;
}

// payload: { bellScheduleId } and any of: name; short; period with bell
// ({ start, end } or null); period with off true or false (that period does
// not meet, or meets); off as the whole list of periods that do not meet.
export const setBellSchedule = action(
  { label: bellScheduleLabel, bumps: [SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'day', bellsId: payload.bellScheduleId, period: payload.period }) },
  (project, payload) => {
    const list = bellSchedulesOf(project);
    const schedule = need(list, payload.bellScheduleId, 'bell schedule');
    let next = schedule;
    if (payload.name !== undefined) next = withKey(next, 'name', needScheduleName(project, payload.name, schedule.id));
    if (payload.short !== undefined) next = withKey(next, 'short', needShort(list, payload.short, schedule.id, 'bell schedule'));
    if (payload.bell !== undefined) {
      const period = needPeriod(project, payload.period);
      const bell = needBell(payload.bell);
      if (!sameBell(bell, next.bells[period])) next = { ...next, bells: next.bells.map((current, p) => (p === period ? bell : current)) };
    }
    if (typeof payload.off === 'boolean') {
      const period = needPeriod(project, payload.period);
      const off = payload.off ? Array.from(new Set(next.off.concat([period]))).sort((a, b) => a - b) : next.off.filter((p) => p !== period);
      if (!sameList(off, next.off)) next = { ...next, off };
    } else if (payload.off !== undefined) {
      if (!Array.isArray(payload.off) || !payload.off.every((p) => Number.isInteger(p) && p >= 0 && p < project.settings.periods)) refuse('The periods that do not meet are a list of periods of the school day.', 'bad-value');
      const off = Array.from(new Set(payload.off)).sort((a, b) => a - b);
      if (!sameList(off, next.off)) next = { ...next, off };
    }
    if (next === schedule) return project;
    return { ...project, bellSchedules: list.map((candidate) => (candidate === schedule ? next : candidate)) };
  },
);

// Where bell schedule B is named in the calendar, for the toast after
// deleting it ("Wednesdays in the calendar"). Nothing is changed here.
export function describeBellScheduleDelete(project, bellScheduleId) {
  const schedule = bellSchedulesOf(project).find((candidate) => candidate.id === bellScheduleId);
  if (!schedule) return null;
  const calendar = calendarOf(project);
  const weekdays = calendar ? calendar.weekdays.map((rule, w) => (rule.bells === bellScheduleId ? w : -1)).filter((w) => w !== -1) : [];
  const dates = calendar ? calendar.dates.filter((entry) => entry.bells === bellScheduleId).length : 0;
  const parts = [];
  if (weekdays.length > 0) parts.push(listWords(weekdays.map((w) => WEEKDAY_NAMES[w] + 's')));
  if (dates > 0) parts.push(count(dates, 'date', 'dates'));
  const text = 'Deleted ' + schedule.name + (parts.length > 0 ? ', used on ' + listWords(parts) + ' in the calendar' : '');
  return { bellScheduleId, name: schedule.name, weekdays, dates, text };
}

// payload: { bellScheduleId }. Wherever the calendar named it, the regular
// bells ring instead, in the same step.
export const deleteBellSchedule = action(
  { label: (before, payload) => 'Delete bell schedule ' + bellScheduleName(before, payload.bellScheduleId), bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'day' }) },
  (project, payload, ctx) => {
    const list = bellSchedulesOf(project);
    const schedule = need(list, payload.bellScheduleId, 'bell schedule');
    const outcome = describeBellScheduleDelete(project, schedule.id);
    let next = { ...project, bellSchedules: list.filter((candidate) => candidate !== schedule) };
    const calendar = calendarOf(project);
    if (calendar && (outcome.weekdays.length > 0 || outcome.dates > 0)) {
      next = withCalendar(next, {
        ...calendar,
        weekdays: calendar.weekdays.map((rule) => (rule.bells === schedule.id ? { ...rule, bells: null } : rule)),
        dates: calendar.dates.map((entry) => (entry.bells === schedule.id ? { ...entry, bells: null } : entry)),
      }, ctx);
    }
    return reporting(project, next, outcome);
  },
);

// payload: { bellScheduleId, toIndex }.
export const reorderBellSchedule = action(
  { label: (before, payload) => 'Move ' + bellScheduleName(before, payload.bellScheduleId) + ' in the list of bell schedules', bumps: [SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'day', bellsId: payload.bellScheduleId }) },
  (project, payload) => {
    const list = bellSchedulesOf(project);
    const next = moveItem(list, payload.bellScheduleId, payload.toIndex, 'bell schedule');
    return next === list ? project : { ...project, bellSchedules: next };
  },
);

// ---------------------------------------------------------------- the calendar

function calendarFocus() {
  return { section: 'schedule', tab: 'calendar' };
}

function needCalendar(project) {
  const calendar = calendarOf(project);
  if (!calendar) refuse('There is no calendar yet. Make one first.', 'no-calendar');
  return calendar;
}

function needDate(value, what) {
  if (!isCalendarDate(value)) refuse(what + ' is a date written YYYY-MM-DD, for example 2026-08-31.', 'bad-value');
  return value;
}

function needRange(start, end) {
  needDate(start, 'The first day');
  needDate(end, 'The last day');
  const days = daysBetween(start, end) + 1;
  if (days < 1) refuse('The last day of the calendar is before its first. Swap them, or choose another date.', 'bad-value');
  if (days > CALENDAR_DAYS_MOST) refuse('A calendar covers at most ' + CALENDAR_DAYS_MOST + ' days, two school years; this would cover ' + days + '.', 'too-long');
}

// What a weekday or a dated change says the day is.
function needDayValue(project, value) {
  if (value === DAY_ROTATION || value === DAY_CLOSED) return value;
  if (!findDayType(project, value)) refuse('That day type is no longer in the project.', 'missing');
  return value;
}

function needCalendarBells(project, value, regular) {
  if (value === null || (regular && value === BELLS_REGULAR)) return value;
  if (!bellSchedulesOf(project).some((schedule) => schedule.id === value)) refuse('That bell schedule is no longer in the project.', 'missing');
  return value;
}

function needWeekdays(project, weekdays) {
  if (!Array.isArray(weekdays) || weekdays.length !== 7) refuse('The calendar has a rule for each of the seven weekdays, Monday first.', 'bad-value');
  return weekdays.map((rule) => {
    if (!rule || typeof rule !== 'object') refuse('A weekday\'s rule says its day and its bells.', 'bad-value');
    return { day: needDayValue(project, rule.day), bells: needCalendarBells(project, rule.bells === undefined ? null : rule.bells, false) };
  });
}

function needRotation(project, rotation) {
  if (!Array.isArray(rotation) || rotation.length < ROTATION_RANGE[0] || rotation.length > ROTATION_RANGE[1]) refuse('The rotation is ' + ROTATION_RANGE[0] + ' to ' + ROTATION_RANGE[1] + ' day types, in the order they come round.', 'bad-value');
  for (const id of rotation) if (!findDayType(project, id)) refuse('That day type is no longer in the project.', 'missing');
  return rotation.slice();
}

function needDateLabel(value) {
  if (typeof value !== 'string') refuse('A note is text.', 'bad-value');
  const trimmed = value.trim();
  if (textLength(trimmed) > DATE_LABEL_MOST) refuse('A note on a date is at most ' + DATE_LABEL_MOST + ' characters.', 'too-long');
  return trimmed;
}

// A dated change that says nothing its weekday does not (the weekday's
// bells and no note, with day null, or with the rotation on a weekday that
// takes the rotation) is taken out, as repair takes it out.
function tidyDates(calendar) {
  const dates = calendar.dates.filter((entry) => !(entry.bells === null && entry.label === '' && (entry.day === null || (entry.day === DAY_ROTATION && calendar.weekdays[weekdayOf(entry.date)].day === DAY_ROTATION))));
  return dates.length === calendar.dates.length ? calendar : { ...calendar, dates };
}

// The project with `calendar` in place, tidied and stamped with the store's
// clock, which the publish form compares with the last publish.
function withCalendar(project, calendar, ctx) {
  return { ...project, calendar: { ...tidyDates(calendar), changedAt: ctx.clock().toISOString() } };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Write `change` ({ day, bells, label }) on each date, replacing its change.
function writeDates(calendar, dates, change) {
  const byDate = new Map(calendar.dates.map((entry) => [entry.date, entry]));
  for (const date of dates) byDate.set(date, { date, day: change.day, bells: change.bells, label: change.label });
  return { ...calendar, dates: Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

// The school days among `dates`, by the calendar as it stands.
function schoolDaysAmong(project, calendar, dates) {
  const days = calendarDays({ ...project, calendar });
  const first = days.length > 0 ? days[0].date : null;
  return dates.filter((date) => {
    const offset = first === null ? -1 : daysBetween(first, date);
    return offset >= 0 && offset < days.length && days[offset].school;
  });
}

// payload: { start, end } and optionally weekdays (seven { day, bells },
// Monday first; left out, Monday to Friday in the rotation and no school at
// the weekend), rotation (left out, every day type in order), breaks
// ([{ from, to, label }], each writing "closed" with its label on the dates
// from..to that would otherwise be school days) and replace (true to make a
// new one over a calendar there already is). The outcome counts each break's
// school days ("Winter break: 8 school days"); with no breaks there is none.
export const makeCalendar = action(
  { label: 'Make the calendar', bumps: [SCHEDULE], focus: calendarFocus },
  (project, payload, ctx) => {
    const data = payload || {};
    if (calendarOf(project) && data.replace !== true) refuse('There is already a calendar. Change it, or remove it first.', 'calendar-exists');
    needRange(data.start, data.end);
    const weekdays = data.weekdays === undefined ? defaultWeekdays() : needWeekdays(project, data.weekdays);
    const rotation = data.rotation === undefined ? project.dayTypes.slice(0, ROTATION_RANGE[1]).map((dayType) => dayType.id) : needRotation(project, data.rotation);
    let calendar = { start: data.start, end: data.end, weekdays, rotation, dates: [], changedAt: null };
    const breaks = [];
    if (data.breaks !== undefined) {
      if (!Array.isArray(data.breaks)) refuse('The breaks are a list of first and last dates with a name.', 'bad-value');
      for (const item of data.breaks) {
        if (!item || typeof item !== 'object') refuse('A break has a first date, a last date and a name.', 'bad-value');
        const from = needDate(item.from, 'A break\'s first day');
        const to = item.to === undefined || item.to === null || item.to === '' ? from : needDate(item.to, 'A break\'s last day');
        if (to < from) refuse('A break ends before it starts. Swap the two dates.', 'bad-value');
        const label = needDateLabel(item.label === undefined ? '' : item.label);
        const inside = datesFrom(from < calendar.start ? calendar.start : from, to > calendar.end ? calendar.end : to);
        const closing = schoolDaysAmong(project, calendar, inside);
        calendar = writeDates(calendar, closing, { day: DAY_CLOSED, bells: null, label });
        breaks.push({ from, to, label, schoolDays: closing.length });
      }
    }
    const next = withCalendar(project, calendar, ctx);
    // with no breaks there is nothing to report
    if (breaks.length === 0) return next;
    return reporting(project, next, { breaks, text: breaks.map((item) => (item.label === '' ? dateWords(item.from, { year: false }) + ' to ' + dateWords(item.to, { year: false }) : item.label) + ': ' + count(item.schoolDays, 'school day', 'school days')).join('; ') });
  },
);

// payload: { start, end }. Dated changes outside the new range are kept, so
// lengthening it again loses nothing.
export const setCalendarRange = action(
  { label: (before, payload) => 'Change the calendar to ' + dateWords(payload.start) + ' to ' + dateWords(payload.end), bumps: [SCHEDULE], focus: calendarFocus },
  (project, payload, ctx) => {
    const calendar = needCalendar(project);
    needRange(payload.start, payload.end);
    if (calendar.start === payload.start && calendar.end === payload.end) return project;
    return withCalendar(project, { ...calendar, start: payload.start, end: payload.end }, ctx);
  },
);

// payload: { weekday, day, bells }: weekday 0 (Monday) to 6; day "rotation",
// "closed" or a day type id; bells null (the regular bells) or a bell
// schedule id. Either may be left out.
export const setCalendarWeekday = action(
  { label: (before, payload) => 'Change ' + (WEEKDAY_NAMES[payload.weekday] || 'a weekday') + 's in the calendar', bumps: [SCHEDULE], focus: calendarFocus },
  (project, payload, ctx) => {
    const calendar = needCalendar(project);
    if (!Number.isInteger(payload.weekday) || payload.weekday < 0 || payload.weekday > 6) refuse('A weekday is 0 (Monday) to 6 (Sunday).', 'bad-value');
    const current = calendar.weekdays[payload.weekday];
    const rule = {
      day: payload.day === undefined ? current.day : needDayValue(project, payload.day),
      bells: payload.bells === undefined ? current.bells : needCalendarBells(project, payload.bells, false),
    };
    if (rule.day === current.day && rule.bells === current.bells) return project;
    return withCalendar(project, { ...calendar, weekdays: calendar.weekdays.map((one, w) => (w === payload.weekday ? { ...one, ...rule } : one)) }, ctx);
  },
);

// payload: { rotation }: 1 to 24 day type ids, repeats allowed, in the order
// they come round.
export const setCalendarRotation = action(
  { label: 'Change the rotation', bumps: [SCHEDULE], focus: calendarFocus },
  (project, payload, ctx) => {
    const calendar = needCalendar(project);
    const rotation = needRotation(project, payload.rotation);
    if (sameList(rotation, calendar.rotation)) return project;
    return withCalendar(project, { ...calendar, rotation }, ctx);
  },
);

function datesWords(dates, schoolDays) {
  if (dates.length === 1) return dateWords(dates[0], { year: false });
  return schoolDays ? count(dates.length, 'school day', 'school days') : count(dates.length, 'date', 'dates');
}

function setDatesLabel(before, payload, after) {
  const outcome = scheduleOutcome(after);
  const written = outcome ? outcome.written : [];
  const words = datesWords(written.length > 0 ? written : outcome ? outcome.removed : [], payload.day === DAY_CLOSED);
  if (payload.day === null) return 'Set ' + words + ' as the calendar says';
  if (payload.day === DAY_CLOSED) return 'Set ' + words + ' to No school';
  if (payload.day === DAY_ROTATION) return 'Set ' + words + ' to Next in the rotation';
  if (payload.day !== undefined) return 'Set ' + words + ' to ' + dayTypeName(before, payload.day);
  return 'Change ' + words + ' in the calendar';
}

// payload: { dates, day, bells, label }. dates: a list of dates, or
// { from, to }, inside the calendar. day: a day type id, "closed" (no school),
// "rotation" (next in the rotation), or null for "as the calendar says",
// which takes each date's change away; left out, each date keeps its day (a
// date with no change of its own gets day null: as its weekday says).
// bells: null (as the weekday says), "regular" or a bell schedule id; label:
// the note. Either left out keeps what each date has. "closed" is written
// only on dates that are school days (and on dates already closed by a
// change of their own, which keep being closed with the new note), and the
// outcome counts them. The outcome also says the first later date whose day
// type moved (`movedFrom`), for the toast "The rotation moves back a day
// from 27 November".
export const setCalendarDates = action(
  { label: setDatesLabel, bumps: [SCHEDULE], focus: calendarFocus },
  (project, payload, ctx) => {
    const calendar = needCalendar(project);
    let dates = payload.dates;
    if (dates && typeof dates === 'object' && !Array.isArray(dates)) {
      needDate(dates.from, 'The first date');
      needDate(dates.to === undefined ? dates.from : dates.to, 'The last date');
      dates = datesFrom(dates.from, dates.to === undefined ? dates.from : dates.to);
    }
    if (!Array.isArray(dates) || dates.length === 0) refuse('Choose the dates to change.', 'bad-value');
    for (const date of dates) {
      needDate(date, 'A date');
      if (date < calendar.start || date > calendar.end) refuse(dateWords(date) + ' is outside the calendar, which runs from ' + dateWords(calendar.start) + ' to ' + dateWords(calendar.end) + '.', 'outside');
    }
    dates = Array.from(new Set(dates)).sort();
    const own = new Map(calendar.dates.map((entry) => [entry.date, entry]));
    let next;
    let written = [];
    let removed = [];
    if (payload.day === null) {
      removed = dates.filter((date) => own.has(date));
      next = { ...calendar, dates: calendar.dates.filter((entry) => !removed.includes(entry.date)) };
    } else {
      const day = payload.day === undefined ? undefined : needDayValue(project, payload.day);
      const bells = payload.bells === undefined ? undefined : needCalendarBells(project, payload.bells, true);
      const label = payload.label === undefined ? undefined : needDateLabel(payload.label);
      written = day === DAY_CLOSED ? dates.filter((date) => schoolDaysAmong(project, calendar, [date]).length === 1 || (own.has(date) && own.get(date).day === DAY_CLOSED)) : dates;
      next = calendar;
      for (const date of written) {
        const had = own.get(date);
        // with no day given, a date with no change of its own stays as its
        // weekday says (day null), so a bells-only change moves nothing
        next = writeDates(next, [date], {
          day: day !== undefined ? day : had ? had.day : null,
          bells: bells !== undefined ? bells : had ? had.bells : null,
          label: label !== undefined ? label : had ? had.label : '',
        });
      }
    }
    const schoolDays = payload.day === DAY_CLOSED ? schoolDaysAmong(project, calendar, written).length : 0;
    if (sameJson(tidyDates(next).dates, calendar.dates)) return project;
    const after = withCalendar(project, next, ctx);
    const changed = new Set(dates);
    const beforeDays = calendarDays(project);
    const afterDays = calendarDays(after);
    const moved = afterDays.find((entry, i) => !changed.has(entry.date) && entry.date > dates[0] && (entry.dayTypeId !== beforeDays[i].dayTypeId || entry.bellsId !== beforeDays[i].bellsId));
    return reporting(project, after, { written, removed, schoolDays, skipped: payload.day === null ? 0 : dates.length - written.length, movedFrom: moved ? moved.date : null });
  },
);

// Takes the calendar away; undo brings it back.
export const removeCalendar = action(
  { label: 'Remove the calendar', bumps: [SCHEDULE], focus: calendarFocus },
  (project) => {
    needCalendar(project);
    return { ...project, calendar: null };
  },
);

// ================================================================ SV2-75 (end)

// ================================================================ SV2-77b: Import dates (start)

// payload: { changes, counts }: what readCalendarCsv returned for a calendar
// CSV (`counts` optional, for the label). The calendar becomes
// importedCalendar(project, changes) as one undo step, stamped with the
// store's clock, labelled "Import dates: 3 dates change; …". Each change is
// checked as setCalendarDates checks its payload, since the project may have
// moved on since the file was read. Changes that leave the calendar as it is
// make no step.
export const importCalendarDates = action(
  {
    label: (before, payload) => 'Import dates: ' + calendarImportText(before, { counts: importCounts(payload) }),
    bumps: [SCHEDULE],
    focus: calendarFocus,
  },
  (project, payload, ctx) => {
    const calendar = needCalendar(project);
    if (!Array.isArray(payload.changes)) refuse('There are no dates to import. Choose a calendar CSV first.', 'bad-value');
    const seen = new Set();
    const changes = [];
    for (const change of payload.changes) {
      if (!change || typeof change !== 'object') refuse('A date to import is a date with its day type, bells and note.', 'bad-value');
      needDate(change.date, 'A date');
      if (seen.has(change.date)) refuse(dateWords(change.date) + ' is in the list twice. Each date is imported once.', 'bad-value');
      seen.add(change.date);
      if (change.date < calendar.start || change.date > calendar.end) refuse(dateWords(change.date) + ' is outside the calendar, which runs from ' + dateWords(calendar.start) + ' to ' + dateWords(calendar.end) + '.', 'outside');
      if (change.day !== null) needDayValue(project, change.day);
      needCalendarBells(project, change.bells, true);
      changes.push({ ...change, label: needDateLabel(change.label) });
    }
    const next = importedCalendar(project, changes);
    if (sameJson(tidyDates(next).dates, calendar.dates)) return project;
    return withCalendar(project, next, ctx);
  },
);

function importCounts(payload) {
  const counts = payload && payload.counts;
  if (counts && typeof counts === 'object') return counts;
  const changes = payload && Array.isArray(payload.changes) ? payload.changes.length : 0;
  return { rows: changes, changes, same: 0, outside: 0 };
}

// ================================================================ SV2-77b: Import dates (end)

// ---------------------------------------------------------------- floors

function floorName(project, id) {
  const floor = project.building.floors.find((candidate) => candidate.id === id);
  return floor ? floor.name : '';
}

function floorFocus(before, payload) {
  return { section: 'building', floorId: payload.id };
}

// Slots that named these rooms keep the room's number as text and are shown
// as "not in the building"; teachers stop listing the rooms. For every
// change that takes rooms out of the building.
export function detachRooms(project, rooms) {
  if (rooms.length === 0) return project;
  const numbers = new Map(rooms.map((room) => [room.id, room.number.trim() === '' ? UNNUMBERED_ROOM_TEXT : room.number]));
  let next = mapSlots(project, (slot) => (slot.room !== null && numbers.has(slot.room) ? { ...slot, room: null, roomText: numbers.get(slot.room) } : slot));
  next = withKey(next, 'teachers', mapShared(next.teachers, (teacher) => withKey(teacher, 'roomIds', filterShared(teacher.roomIds, (roomId) => !numbers.has(roomId)))));
  return next;
}

// A new floor at the end, the size of the floor being looked at, one level
// above the highest floor there is: counting the floors would give a level
// twice once a floor in the middle has been deleted.
// payload: { likeFloorId, name } and optionally id; all may be left out.
export const addFloor = action(
  { label: (before, payload, after) => 'Add ' + after.building.floors[after.building.floors.length - 1].name, bumps: [GEOMETRY], focus: (before, payload, after) => ({ section: 'building', floorId: after.building.floors[after.building.floors.length - 1].id }) },
  (project, payload, ctx) => {
    const floors = project.building.floors;
    const like = (payload && floors.find((floor) => floor.id === payload.likeFloorId)) || floors[floors.length - 1];
    let name = payload && payload.name !== undefined ? needText(payload.name, 'A floor name') : null;
    if (name === null) {
      const used = new Set(floors.map((floor) => floor.name));
      for (let n = floors.length + 1; ; n += 1) {
        if (!used.has('Floor ' + n)) {
          name = 'Floor ' + n;
          break;
        }
      }
    }
    const floor = newFloor(newId(project, payload, ctx, 'f'), name, Math.max(...floors.map((candidate) => candidate.level)) + 1, like.width, like.height);
    return patch(project, ['building', 'floors'], (list) => list.concat([floor]));
  },
);

export const renameFloor = action(
  { label: (before, payload) => 'Rename ' + floorName(before, payload.id) + ' to ' + payload.name, bumps: [BUILDING], focus: floorFocus },
  (project, payload) => {
    need(project.building.floors, payload.id, 'floor');
    needText(payload.name, 'A floor name');
    return patch(project, ['building', 'floors'], (floors) => mapShared(floors, (floor) => (floor.id === payload.id ? withKey(floor, 'name', payload.name) : floor)));
  },
);

// Display order only. A floor's level, which is what stairs cost by, does not
// change, so no route changes. payload: { id, toIndex }.
export const reorderFloor = action(
  { label: (before, payload) => 'Move ' + floorName(before, payload.id), bumps: [BUILDING], focus: floorFocus },
  (project, payload) => patch(project, ['building', 'floors'], (floors) => moveItem(floors, payload.id, payload.toIndex, 'floor')),
);

export const setFloorLevel = action(
  { label: (before, payload) => 'Change the level of ' + floorName(before, payload.id), bumps: [GEOMETRY], focus: floorFocus },
  (project, payload) => {
    need(project.building.floors, payload.id, 'floor');
    if (!Number.isInteger(payload.level)) refuse('A level is a whole number: 1 for the ground floor, 2 for the one above, 0 or -1 for a basement.', 'bad-value');
    return patch(project, ['building', 'floors'], (floors) => mapShared(floors, (floor) => (floor.id === payload.id ? withKey(floor, 'level', payload.level) : floor)));
  },
);

// What deleting a floor takes with it, for the sentence before deleting.
export function describeFloorDelete(project, floorId) {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId);
  if (!floor) return null;
  const rooms = floor.spaces.filter((space) => space.kind === 'room');
  const roomIds = new Set(rooms.map((room) => room.id));
  let slots = 0;
  for (const group of project.groups) for (const day of Object.values(group.days)) slots += day.filter((slot) => roomIds.has(slot.room)).length;
  return {
    name: floor.name,
    last: project.building.floors.length === 1,
    rooms: rooms.length,
    otherSpaces: floor.spaces.length - rooms.length,
    connections: project.building.connections.filter((connection) => connection.a.floorId === floorId || connection.b.floorId === floorId).length,
    zones: project.building.zones.filter((zone) => zone.floorId === floorId).length,
    exits: floor.exits.length,
    slots,
  };
}

// The last floor cannot be deleted. The stair connections that touch the
// floor and its zones go with it, and slots in its rooms are kept as "not in
// the building", all in the one undo step.
export const deleteFloor = action(
  { label: (before, payload) => 'Delete ' + floorName(before, payload.id), bumps: [GEOMETRY, SCHEDULE], focus: () => ({ section: 'building' }) },
  (project, payload) => {
    const floors = project.building.floors;
    const floor = need(floors, payload.id, 'floor');
    if (floors.length === 1) refuse(floor.name + ' is the only floor, and a building has at least one. Clear it instead, or add another floor first.', 'last-floor');
    const building = {
      ...project.building,
      floors: floors.filter((candidate) => candidate !== floor),
      connections: filterShared(project.building.connections, (connection) => connection.a.floorId !== floor.id && connection.b.floorId !== floor.id),
      zones: filterShared(project.building.zones, (zone) => zone.floorId !== floor.id),
    };
    return detachRooms({ ...project, building }, floor.spaces.filter((space) => space.kind === 'room'));
  },
);

// ---------------------------------------------------------------- findings

// Who a finding names now, for acceptFinding: the `about` of the finding with
// that id as the checks make it without walk figures. Empty when there is no
// such finding. A walk finding is never found this way and needs no list: the
// group or teacher it names is in its id.
function aboutNow(project, findingId) {
  const result = checkSchedule(project, null);
  const finding = result.findings.concat(result.accepted).find((candidate) => candidate.id === findingId);
  return finding ? finding.about : [];
}

// payload: { findingId, reason, about }. The time comes from ctx.clock.
// `about` is the finding's own `about`, kept sorted on the record so that a
// later run of the checks can tell the finding names somebody else. A caller
// that leaves it out gets what the finding names now.
export const acceptFinding = action(
  { label: 'Accept a finding', bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'checks' }) },
  (project, payload, ctx) => {
    if (typeof payload.findingId !== 'string' || payload.findingId === '') refuse('Pick a finding to accept.', 'bad-value');
    if (payload.about !== undefined && !(Array.isArray(payload.about) && payload.about.every((id) => typeof id === 'string'))) refuse('Who a finding is about is a list of ids.', 'bad-value');
    const reason = needText(payload.reason === undefined ? '' : payload.reason, 'A reason');
    const entry = newAcceptedFinding(payload.findingId, reason, ctx.clock().toISOString(), payload.about === undefined ? aboutNow(project, payload.findingId) : payload.about);
    return { ...project, accepted: project.accepted.filter((accepted) => accepted.findingId !== payload.findingId).concat([entry]) };
  },
);

export const unacceptFinding = action(
  { label: 'Stop accepting a finding', bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'checks' }) },
  (project, payload) => withKey(project, 'accepted', filterShared(project.accepted, (accepted) => accepted.findingId !== payload.findingId)),
);

// ---------------------------------------------------------------- the whole project

// Put another project in place of this one as one undo step: loading the
// sample school, and later every import. The caller has already run migrate,
// repair and validate on payload.project. payload: { project, label }.
export const replaceProject = action(
  { label: (before, payload) => payload.label || 'Replace the project', bumps: [GEOMETRY, SCHEDULE], focus: () => ({ section: 'project' }) },
  (project, payload) => {
    if (!payload.project || typeof payload.project !== 'object') refuse('There is no project to load.', 'bad-value');
    return payload.project;
  },
);

// ================================================================ SV2-04: the building (start)
//
// The building editor's actions. The geometry is engine/building.js, which
// works on the Building object alone; each action here runs one of its
// functions, turns its refusal into an ActionError, and rewrites the slots
// of any room the change took out of the building (detachRooms), so that is
// one undo step. A placement that goes over something replaces it, and the
// label says what it replaced.

import * as geometry from './building.js';

// What the building.js function reported for the project an action returned,
// so the label and the focus can read it (the store calls them with that
// very object).
const outcomes = new WeakMap();

function inBuilding(project, run) {
  let result;
  try {
    result = run(project.building);
  } catch (error) {
    if (error instanceof geometry.BuildingError) refuse(error.message, error.code);
    throw error;
  }
  if (result.building === project.building) return project;
  let next = { ...project, building: result.building };
  if (result.removedRooms && result.removedRooms.length > 0) next = detachRooms(next, result.removedRooms);
  outcomes.set(next, result);
  return next;
}

// What building.js reported for a project an action here returned: the loss,
// the new space's id, the cells. Null for any other project.
export function buildingOutcome(project) {
  return outcomes.get(project) || null;
}

function replacing(after, word) {
  const outcome = outcomes.get(after);
  const text = outcome && outcome.loss ? geometry.lossText(outcome.loss) : '';
  return text === '' ? '' : ', ' + (word || 'replacing') + ' ' + text;
}

function onFloor(before, payload, after) {
  const outcome = outcomes.get(after);
  const name = floorName(before, (outcome && outcome.floorId) || payload.floorId);
  return name === '' ? '' : ' on ' + name;
}

// Geometry always; the schedule too when the change took a room away.
function geometryBumps(before, payload, after) {
  return before.groups !== after.groups || before.teachers !== after.teachers ? [GEOMETRY, SCHEDULE] : [GEOMETRY];
}

function buildingFocus(before, payload, after) {
  const outcome = outcomes.get(after) || {};
  const focus = { section: 'building', floorId: outcome.floorId || payload.floorId };
  const spaceId = outcome.spaceId || (outcome.spaceIds && outcome.spaceIds[0]) || payload.roomId || payload.spaceId;
  if (spaceId) focus.roomId = spaceId;
  return focus;
}

function spaceLabel(project, spaceId) {
  const found = geometry.findSpace(project.building, spaceId);
  return found ? geometry.spaceName(found.space) : 'a space';
}

function spacesLabel(project, spaceIds) {
  if (!Array.isArray(spaceIds) || spaceIds.length === 0) return 'nothing';
  return spaceIds.length === 1 ? spaceLabel(project, spaceIds[0]) : spaceIds.length + ' spaces';
}

// How many slots name these rooms, and how many groups those are in.
function slotUse(project, roomIds) {
  const wanted = new Set(roomIds);
  let slots = 0;
  let groups = 0;
  for (const group of project.groups) {
    let own = 0;
    for (const day of Object.values(group.days)) own += day.filter((slot) => slot.room !== null && wanted.has(slot.room)).length;
    slots += own;
    if (own > 0) groups += 1;
  }
  return { slots, groups };
}

function withSlots(project, part) {
  return { ...part, ...slotUse(project, part.removedRooms.map((room) => room.id)) };
}

function describing(run) {
  try {
    return run();
  } catch (error) {
    if (error instanceof geometry.BuildingError) refuse(error.message, error.code);
    throw error;
  }
}

// ---- place and paint

// What drawing on these cells would replace: { cells, loss, removedRooms,
// slots, groups }. payload: { floorId } with cells, rect or from/to.
export function describePlace(project, payload) {
  return describing(() => withSlots(project, geometry.describePlace(project.building, payload)));
}

// A room on one cell or a rectangle. payload: { floorId } with rect
// { x, y, w, h } or cells; optionally id, number, and over: 'replace' (the
// default), 'skip' or 'refuse'. buildingOutcome(after).spaceId is the room.
export const placeRoom = action(
  { label: (before, payload, after) => 'Place a room' + onFloor(before, payload, after) + replacing(after), bumps: geometryBumps, focus: buildingFocus },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'r');
    return inBuilding(project, (building) => geometry.placeRoom(building, payload, ctx.ids));
  },
);

// payload as placeRoom, with label, otherKind and colour.
export const placeOtherSpace = action(
  { label: (before, payload, after) => 'Place other space' + onFloor(before, payload, after) + replacing(after), bumps: geometryBumps, focus: buildingFocus },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'o');
    return inBuilding(project, (building) => geometry.placeOtherSpace(building, payload, ctx.ids));
  },
);

// payload: { floorId } with cells, or from and to for a straight line; over.
export const paintCorridor = action(
  { label: (before, payload, after) => 'Paint corridor' + onFloor(before, payload, after) + replacing(after), bumps: geometryBumps, focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.paintCorridor(building, payload)),
);

export const placeStairs = action(
  { label: (before, payload, after) => 'Place stairs' + onFloor(before, payload, after) + replacing(after), bumps: geometryBumps, focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.placeStairs(building, payload)),
);

// ---- erase and delete

// What erasing these cells would do, as the whole space and as the cells
// only: { ambiguous, spaces, whole, cellsOnly }, each of the two with its
// loss and the slots and groups that would be left "not in the building".
// Ask when `ambiguous`; the default is the whole space.
export function describeErase(project, payload) {
  return describing(() => {
    const described = geometry.describeErase(project.building, payload);
    return { ...described, whole: withSlots(project, described.whole), cellsOnly: withSlots(project, described.cellsOnly) };
  });
}

// payload: { floorId, cells } and whole (default true): a cell of a room or
// other space takes the whole space, or with whole: false only that cell.
// Erasing a stairs cell removes its connection in the same step.
export const eraseCells = action(
  {
    label: (before, payload, after) => {
      const outcome = outcomes.get(after);
      const text = outcome ? geometry.lossText(outcome.loss) : '';
      return 'Erase' + (text === '' ? '' : ' ' + text) + onFloor(before, payload, after);
    },
    bumps: geometryBumps,
    focus: buildingFocus,
  },
  (project, payload) => inBuilding(project, (building) => geometry.erase(building, payload)),
);

// What deleting these rooms and spaces takes with it.
export function describeSpaceDelete(project, payload) {
  return describing(() => {
    const result = geometry.deleteSpaces(project.building, payload);
    return withSlots(project, { loss: result.loss, removedRooms: result.removedRooms });
  });
}

// payload: { spaceIds }. Slots in a deleted room keep its number as text and
// show as "not in the building".
export const deleteSpaces = action(
  { label: (before, payload) => 'Delete ' + spacesLabel(before, payload.spaceIds), bumps: geometryBumps, focus: (before, payload) => ({ section: 'building', floorId: (geometry.findSpace(before.building, payload.spaceIds[0]) || { floor: {} }).floor.id }) },
  (project, payload) => inBuilding(project, (building) => geometry.deleteSpaces(building, payload)),
);

// ---- move, paste

// payload: { spaceIds, dx, dy } and optionally toFloorId, over ('refuse' by
// default, or 'replace'). Every moved space keeps its id, so its number,
// teachers, subject and every slot that names it stay as they were.
export const moveSpaces = action(
  {
    label: (before, payload, after) => {
      const to = payload.toFloorId !== undefined && (geometry.findSpace(before.building, payload.spaceIds[0]) || { floor: {} }).floor.id !== payload.toFloorId ? ' to ' + floorName(before, payload.toFloorId) : '';
      return 'Move ' + spacesLabel(before, payload.spaceIds) + to + replacing(after, 'removing');
    },
    bumps: geometryBumps,
    focus: buildingFocus,
  },
  (project, payload) => inBuilding(project, (building) => geometry.moveSpaces(building, payload)),
);

// payload: { floorId, clip, x, y } and over; clip is from
// building.js copySpaces(project.building, { spaceIds }). A subject the clip
// names that is no longer on the list is left empty.
export const pasteSpaces = action(
  {
    label: (before, payload, after) => {
      const count = payload.clip && Array.isArray(payload.clip.spaces) ? payload.clip.spaces.length : 0;
      return 'Paste ' + (count === 1 ? '1 space' : count + ' spaces') + onFloor(before, payload, after) + replacing(after);
    },
    bumps: geometryBumps,
    focus: buildingFocus,
  },
  (project, payload, ctx) => {
    let clip = payload.clip;
    if (clip && Array.isArray(clip.spaces)) {
      const known = new Set(project.subjects.map((subject) => subject.id));
      clip = { ...clip, spaces: clip.spaces.map((space) => (space.kind === 'room' && space.subjectId !== null && !known.has(space.subjectId) ? { ...space, subjectId: null } : space)) };
    }
    return inBuilding(project, (building) => geometry.pasteSpaces(building, { ...payload, clip }, ctx.ids));
  },
);

// ---- fields

const roomBumps = [BUILDING, SCHEDULE];

// payload: { roomId } and any of { number, subjectId, wing, capacity, shared }.
// The teachers of a room are setRoomTeachers.
export const setRoomFields = action(
  { label: (before, payload) => 'Edit ' + spaceLabel(before, payload.roomId), bumps: roomBumps, focus: buildingFocus },
  (project, payload) => {
    if (payload.subjectId !== undefined && payload.subjectId !== null) need(project.subjects, payload.subjectId, 'subject');
    return inBuilding(project, (building) => geometry.setRoomFields(building, payload));
  },
);

// Clearing a room's details keeps the room, its cells and its doors, and
// every slot that names it. payload: { roomId }.
export const clearRoomDetails = action(
  { label: (before, payload) => 'Clear the details of ' + spaceLabel(before, payload.roomId), bumps: roomBumps, focus: buildingFocus },
  (project, payload, ctx) => {
    const cleared = inBuilding(project, (building) => geometry.setRoomFields(building, { roomId: payload.roomId, number: '', subjectId: null, wing: '', capacity: null, shared: false }));
    return setRoomTeachers(cleared, { roomId: payload.roomId, teacherIds: [] }, ctx);
  },
);

// payload: { spaceId } and any of { label, otherKind, colour }.
export const setOtherSpaceFields = action(
  { label: (before, payload) => 'Edit ' + spaceLabel(before, payload.spaceId), bumps: [BUILDING], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.setOtherSpaceFields(building, payload)),
);

// ---- doors

// payload: { roomId, cell, side }. Refused, with the side named and what is
// there, when the edge faces nothing that can be walked on.
export const addDoor = action(
  { label: (before, payload) => 'Add a door to ' + spaceLabel(before, payload.roomId), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.addDoor(building, payload)),
);

export const removeDoor = action(
  { label: (before, payload) => 'Remove a door from ' + spaceLabel(before, payload.roomId), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.removeDoor(building, payload)),
);

// ---- stairs connections

// Whether two stairs cells can be connected, and whether they are on one
// floor, which the interface confirms first: { sameFloor, fromFloor,
// toFloor, label }. payload: { a: { floorId, cell }, b: { floorId, cell } }.
export function describeConnect(project, payload) {
  return describing(() => geometry.describeConnect(project.building, payload));
}

export const connectStairs = action(
  {
    label: (before, payload, after) => {
      const outcome = outcomes.get(after);
      if (!outcome) return 'Connect stairs';
      return 'Connect stairs ' + outcome.label + ': ' + (outcome.sameFloor ? 'two places on ' + outcome.fromFloor : outcome.fromFloor + ' to ' + outcome.toFloor);
    },
    bumps: [GEOMETRY],
    focus: (before, payload) => ({ section: 'building', floorId: payload.b.floorId }),
  },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'c');
    return inBuilding(project, (building) => geometry.connectStairs(building, payload, ctx.ids));
  },
);

function connectionLabel(project, connectionId) {
  const connection = project.building.connections.find((candidate) => candidate.id === connectionId);
  return connection ? connection.label : '';
}

// payload: { connectionId }.
export const disconnectStairs = action(
  { label: (before, payload) => 'Disconnect stairs ' + connectionLabel(before, payload.connectionId), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.disconnectStairs(building, payload)),
);

// payload: { connectionId } and any of { label, direction }. A label another
// connection already has is refused: two stairs called A cannot be told apart
// in directions or on the plan.
export const setConnection = action(
  { label: (before, payload) => 'Change stairs connection ' + connectionLabel(before, payload.connectionId), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => {
    if (typeof payload.label === 'string' && project.building.connections.some((other) => other.id !== payload.connectionId && other.label === payload.label)) {
      refuse('There is already a stairs connection ' + payload.label + '. Each has its own letter or name; type a different one.', 'duplicate-label');
    }
    return inBuilding(project, (building) => geometry.setConnection(building, payload));
  },
);

// ---- corridor names

// payload: { floorId, cells, name } and optionally id. An empty name takes
// the name off those cells. Bumps geometry because a route can be asked to
// avoid a named corridor, and this changes which cells that is.
export const nameCorridor = action(
  { label: (before, payload, after) => (payload.name === '' ? 'Take the corridor name off cells' : 'Name a corridor ' + payload.name) + onFloor(before, payload, after), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'k');
    return inBuilding(project, (building) => geometry.nameCorridor(building, payload, ctx.ids));
  },
);

function corridorLabel(project, payload) {
  const floor = project.building.floors.find((candidate) => candidate.id === payload.floorId);
  const corridor = floor ? floor.corridors.find((candidate) => candidate.id === payload.corridorId) : null;
  return corridor ? corridor.name : '';
}

// payload: { floorId, corridorId, name }.
export const renameCorridor = action(
  { label: (before, payload) => 'Rename the corridor ' + corridorLabel(before, payload) + ' to ' + payload.name, bumps: [BUILDING], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.renameCorridor(building, payload)),
);

// payload: { floorId, corridorId }. The cells stay corridor.
export const removeCorridorName = action(
  { label: (before, payload) => 'Remove the corridor name ' + corridorLabel(before, payload), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.removeCorridorName(building, payload)),
);

// ---- exits

function exitLabel(project, payload) {
  const floor = project.building.floors.find((candidate) => candidate.id === payload.floorId);
  const exit = floor ? floor.exits.find((candidate) => (payload.exitId !== undefined ? candidate.id === payload.exitId : candidate.cell === payload.cell)) : null;
  return exit && exit.doorName.trim() !== '' ? 'the exit ' + exit.doorName : 'an exit';
}

// payload: { floorId, cell } and optionally doorName, assembly, id. Only a
// corridor cell on the building's edge; anything else is refused with the reason.
export const markExit = action(
  { label: (before, payload, after) => 'Mark an exit' + (payload.doorName ? ', ' + payload.doorName + ',' : '') + onFloor(before, payload, after), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'x');
    return inBuilding(project, (building) => geometry.markExit(building, payload, ctx.ids));
  },
);

// payload: { floorId, exitId } and any of { doorName, assembly }.
export const setExit = action(
  { label: (before, payload) => 'Edit ' + exitLabel(before, payload), bumps: [BUILDING], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.setExit(building, payload)),
);

// payload: { floorId } and exitId or cell.
export const unmarkExit = action(
  { label: (before, payload) => 'Remove ' + exitLabel(before, payload), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.unmarkExit(building, payload)),
);

// ---- exclusion zones

// payload: { floorId, x, y, w, h } and optionally label, id.
export const addZone = action(
  { label: (before, payload, after) => 'Add an exclusion zone' + onFloor(before, payload, after), bumps: [BUILDING], focus: buildingFocus },
  (project, payload, ctx) => {
    checkGivenId(project, payload, 'z');
    return inBuilding(project, (building) => geometry.addZone(building, payload, ctx.ids));
  },
);

// payload: { zoneId } and any of { label, x, y, w, h }.
export const setZone = action(
  { label: 'Edit an exclusion zone', bumps: [BUILDING], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.setZone(building, payload)),
);

export const removeZone = action(
  { label: 'Remove an exclusion zone', bumps: [BUILDING], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.removeZone(building, payload)),
);

// ---- resize

// What resizing a floor would cut, before it happens: { width, height, loss,
// removedRooms, losesData, slots, groups }. loss.spaces lists each room and
// space removed or cut, with how many of its cells go. payload as resizeFloor.
export function describeResize(project, payload) {
  return describing(() => withSlots(project, geometry.describeResize(project.building, payload)));
}

// Resize a floor from any edge. payload: { floorId } and any of { left,
// right, top, bottom }: cells added at that edge, or taken away when
// negative. Call describeResize first and ask when it loses data.
export const resizeFloor = action(
  {
    label: (before, payload, after) => {
      const outcome = outcomes.get(after);
      return 'Resize ' + floorName(before, payload.floorId) + (outcome ? ' to ' + outcome.width + ' by ' + outcome.height : '') + replacing(after, 'removing');
    },
    bumps: geometryBumps,
    focus: buildingFocus,
  },
  (project, payload) => inBuilding(project, (building) => geometry.resizeFloor(building, payload)),
);

// ---- the traced image

// The opacity a traced image starts at: faint enough to draw over.
export const DEFAULT_TRACE_OPACITY = 0.4;

const TRACE_NUMBERS = ['opacity', 'scale', 'rotation', 'x', 'y'];
const TRACE_FLAGS = ['visible', 'locked', 'missing'];
const TRACE_SIZES = ['width', 'height'];

// Set, adjust or remove a floor's traced image (the TraceImage of
// ARCHITECTURE 4; ui/building/trace.js says what its numbers mean).
// payload: { floorId, image }
//   image: null             take the image off the floor
//   image: { … }            these fields over the ones the floor has. A floor
//                           with no image needs imageId, width and height;
//                           the rest take their defaults
// The bytes are not this action's business: they are stored before it runs.
export const setTraceImage = action(
  {
    label: (before, payload) => {
      const floor = before.building.floors.find((candidate) => candidate.id === payload.floorId);
      const name = floor ? floor.name : 'the floor';
      if (payload.image === null) return 'Remove the traced image from ' + name;
      if (!floor || !floor.image || (payload.image.imageId !== undefined && payload.image.imageId !== floor.image.imageId)) return 'Trace over an image on ' + name;
      return 'Adjust the traced image on ' + name;
    },
    bumps: [BUILDING],
    focus: (before, payload) => ({ section: 'building', floorId: payload.floorId }),
  },
  (project, payload) => {
    const floors = project.building.floors;
    const floor = floors.find((candidate) => candidate.id === payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    const bad = (message) => refuse(message, 'bad-value');
    let next;
    if (payload.image === null) {
      next = null;
    } else {
      const given = payload.image;
      if (!given || typeof given !== 'object') bad('A traced image is null or an object.');
      const base = floor.image || { imageId: '', opacity: DEFAULT_TRACE_OPACITY, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 0, height: 0, missing: false };
      next = base;
      for (const key of ['imageId', ...TRACE_NUMBERS, ...TRACE_FLAGS, ...TRACE_SIZES]) {
        if (given[key] !== undefined && given[key] !== next[key]) next = { ...next, [key]: given[key] };
      }
      if (typeof next.imageId !== 'string' || next.imageId === '') bad('A traced image names its stored image.');
      if (typeof next.opacity !== 'number' || !(next.opacity >= 0 && next.opacity <= 1)) bad('Opacity is from 0% to 100%.');
      if (typeof next.scale !== 'number' || !Number.isFinite(next.scale) || !(next.scale > 0)) bad('The image needs a width above 0 cells.');
      for (const key of ['rotation', 'x', 'y']) if (!Number.isFinite(next[key])) bad('The ' + key + ' of a traced image is a number.');
      for (const key of TRACE_FLAGS) if (typeof next[key] !== 'boolean') bad('The ' + key + ' flag of a traced image is on or off.');
      for (const key of TRACE_SIZES) if (!Number.isInteger(next[key]) || next[key] < 1) bad('The ' + key + ' of a traced image is a whole number of pixels.');
    }
    if (next === floor.image) return project;
    return patch(project, ['building', 'floors'], (list) => mapShared(list, (candidate) => (candidate === floor ? { ...floor, image: next } : candidate)));
  },
);

// Scale a floor's traced image from a line drawn on it (SV2-73a): the new
// scale and top left corner, which ui/building/scale-tool.js works out so the
// line's first point stays where it was, and, when the length was given in
// feet or metres before the project had a Cell scale, that setting as well,
// in the same undo step. Refused while the image is locked.
// payload: { floorId, image: { scale, x, y }, cellScale? }
export const scaleTraceImage = action(
  {
    label: (before, payload) => {
      const floor = before.building.floors.find((candidate) => candidate.id === payload.floorId);
      return 'Scale the traced image on ' + (floor ? floor.name : 'the floor');
    },
    bumps: [BUILDING],
    focus: (before, payload) => ({ section: 'building', floorId: payload.floorId }),
  },
  (project, payload, ctx) => {
    const floor = project.building.floors.find((candidate) => candidate.id === payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    if (!floor.image) refuse('There is no image under ' + floor.name + ' to scale.', 'missing');
    if (floor.image.locked) refuse('The image is locked, so it cannot be scaled. Untick "Lock the image" on the Floor tab first.', 'locked');
    const given = payload.image;
    if (!given || typeof given !== 'object') refuse('A scaled image has a scale and a place.', 'bad-value');
    let next = setTraceImage(project, { floorId: floor.id, image: { scale: given.scale, x: given.x, y: given.y } }, ctx);
    if (payload.cellScale !== undefined) {
      if (payload.cellScale === null || !isCellScale(payload.cellScale)) refuse(CELL_SCALE_RULE, 'bad-value');
      const kept = { unit: payload.cellScale.unit, length: payload.cellScale.length };
      next = patch(next, ['settings', 'cellScale'], (current) => (current && sameValue(current, kept) ? current : kept));
    }
    return next;
  },
);

// The box a traced image covers on its floor, in cells, turned or not: its
// left, top, right and bottom edges { x0, y0, x1, y1 }. The image turns about
// its middle (ui/building/trace.js says what each number means).
export function traceImageBox(image) {
  const w = image.width * image.scale;
  const hgt = image.height * image.scale;
  const turn = (image.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const halfW = (w * cos + hgt * sin) / 2;
  const halfH = (w * sin + hgt * cos) / 2;
  const cx = image.x + w / 2;
  const cy = image.y + hgt / 2;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

// A box edge that is a whole number but for the sums' last digits is that
// whole number, so a fitted image does not grow its floor by a cell.
const EDGE_SLACK = 1e-6;

// The resize that makes a floor the image's box, rounded out to whole cells
// so every drawn cell stays under the same part of the image:
// { left, right, top, bottom, width, height } as resizeFloor takes them.
export function floorForImage(floor, image) {
  const box = traceImageBox(image);
  const x0 = Math.floor(box.x0 + EDGE_SLACK);
  const y0 = Math.floor(box.y0 + EDGE_SLACK);
  const x1 = Math.ceil(box.x1 - EDGE_SLACK);
  const y1 = Math.ceil(box.y1 - EDGE_SLACK);
  return { left: -x0, top: -y0, right: x1 - floor.width, bottom: y1 - floor.height, width: x1 - x0, height: y1 - y0 };
}

const PLACE_HOW = {
  points: 'Place the traced image by two points on ',
  fit: 'Fit the traced image to ',
  corner: 'Resize the traced image on ',
  keys: 'Resize the traced image on ',
};

// Place a floor's traced image (SV2-73b): its scale, turn and top left corner
// in one step, worked out by ui/building/scale-tool.js (two points on the
// image and the two places they belong) or ui/building/trace.js (fit to the
// floor, a corner handle, + and -). Refused while the image is locked.
// payload: { floorId, image: { scale, rotation?, x, y }, how: 'points' | 'fit' | 'corner' | 'keys' }
export const placeTraceImage = action(
  {
    label: (before, payload) => {
      const floor = before.building.floors.find((candidate) => candidate.id === payload.floorId);
      return (PLACE_HOW[payload.how] || PLACE_HOW.corner) + (floor ? floor.name : 'the floor');
    },
    bumps: [BUILDING],
    focus: (before, payload) => ({ section: 'building', floorId: payload.floorId }),
  },
  (project, payload, ctx) => {
    const floor = project.building.floors.find((candidate) => candidate.id === payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    if (!floor.image) refuse('There is no image under ' + floor.name + ' to place.', 'missing');
    if (floor.image.locked) refuse('The image is locked, so it cannot be moved or resized. Untick "Lock the image" on the Floor tab first.', 'locked');
    const given = payload.image;
    if (!given || typeof given !== 'object') refuse('A placed image has a scale and a place.', 'bad-value');
    const image = { scale: given.scale, x: given.x, y: given.y };
    if (given.rotation !== undefined) image.rotation = given.rotation;
    return setTraceImage(project, { floorId: floor.id, image }, ctx);
  },
);

// Make a floor the size of its traced image (SV2-73b): its width and height
// become the image's box rounded out to whole cells (floorForImage), the
// drawing and the image staying where they are on each other. Refused while
// the image is locked, when the box is outside a floor's sizes, and when it
// would cut anything drawn, saying what. payload: { floorId }
export const fitFloorToImage = action(
  {
    label: (before, payload, after) => {
      const outcome = outcomes.get(after);
      return 'Fit ' + floorName(before, payload.floorId) + ' to its traced image' + (outcome ? ', ' + outcome.width + ' by ' + outcome.height : '');
    },
    bumps: geometryBumps,
    focus: buildingFocus,
  },
  (project, payload) => {
    const floor = project.building.floors.find((candidate) => candidate.id === payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    if (!floor.image) refuse('There is no image under ' + floor.name + ' to fit it to.', 'missing');
    if (floor.image.locked) refuse('The image is locked, so the floor is not fitted to it. Untick "Lock the image" on the Floor tab first.', 'locked');
    const edges = floorForImage(floor, floor.image);
    const [least, most] = RANGES.floorSize;
    if (!inRange(edges.width, RANGES.floorSize) || !inRange(edges.height, RANGES.floorSize)) {
      refuse('The image covers ' + edges.width + ' by ' + edges.height + ' cells, and a floor is from ' + least + ' to ' + most + ' cells each way, so ' + floor.name + ' cannot be fitted to it. Resize the image first.', 'bad-size');
    }
    const resize = { floorId: floor.id, left: edges.left, right: edges.right, top: edges.top, bottom: edges.bottom };
    const described = describing(() => geometry.describeResize(project.building, resize));
    if (described.losesData) refuse('Fitting ' + floor.name + ' to the image would cut ' + geometry.lossText(described.loss) + ', outside the image. Move them over the image first, or resize the floor by its edges instead.', 'cuts');
    return inBuilding(project, (building) => geometry.resizeFloor(building, resize));
  },
);

// ================================================================ SV2-04: the building (end)

// ================================================================ SV2-10: imports (start)
//
// Every import is one action and one undo entry. The work is in
// import-groups.js and project-file.js, which read and check the file in full
// before any of these runs; each action here puts the result in place and
// turns a refusal into an ActionError. (A project file is put in place with
// replaceProject, above, after readProjectFile.) importOutcome(after) is the
// summary of what an import did, for the project the action itself returned;
// the store keeps a stamped copy, so the label carries the summary there.

import { applyGroupImport, summaryText, ImportError } from './import-groups.js';
import { applyBuilding, applySchedule, FileError } from './project-file.js';
import { applyTeacherImport, teacherSummaryText } from './import-teachers.js';
import { applySubjectImport, subjectSummaryText } from './import-subjects.js';

const importOutcomes = new WeakMap();

function importing(project, run) {
  let result;
  try {
    result = run();
  } catch (error) {
    if (error instanceof ImportError || error instanceof FileError) refuse(error.message, error.code);
    throw error;
  }
  if (result.project !== project) importOutcomes.set(result.project, result.summary);
  return result.project;
}

// The summary of the import that returned this project, or null.
export function importOutcome(project) {
  return importOutcomes.get(project) || null;
}

function importLabel(what) {
  return (before, payload, after) => {
    const summary = importOutcome(after);
    return 'Import ' + what + (summary && summary.created ? ': ' + summaryText(summary) : '');
  };
}

// Groups from a CSV file. payload: { rows, mapping, policy }: the rows
// csv.js parsed, the column mapping the user settled on, and the answer to
// name clashes, { all, per, names } (import-groups.js). Without a policy a
// group whose name is already here is skipped.
export const importGroups = action(
  { label: importLabel('groups'), bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'groups' }) },
  (project, payload, ctx) => importing(project, () => applyGroupImport(project, payload.rows, payload.mapping, payload.policy, ctx.ids)),
);

// Teachers from a CSV file (import-teachers.js). payload: { rows }: the rows
// csv.js parsed, the header row first. A name already on the list is that
// teacher, whatever the capitals; any other is a new teacher. Nothing is
// deleted, and a file that changes nothing makes no undo entry.
export const importTeachers = action(
  {
    label: (before, payload, after) => {
      const summary = importOutcome(after);
      return 'Import teachers' + (summary ? ': ' + teacherSummaryText(summary) : '');
    },
    bumps: [BUILDING, SCHEDULE],
    focus: () => ({ section: 'schedule', tab: 'teachers' }),
  },
  (project, payload, ctx) => importing(project, () => applyTeacherImport(project, payload.rows, ctx.ids)),
);

// Subjects from a CSV file (import-subjects.js). payload: { rows }: the rows
// csv.js parsed, the header row first. A code already on the list is that
// subject, whatever the capitals, and keeps its id; any other is a new
// subject at the end of the list. Nothing is deleted, and a file that changes
// nothing makes no undo entry.
export const importSubjects = action(
  {
    label: (before, payload, after) => {
      const summary = importOutcome(after);
      return 'Import subjects' + (summary ? ': ' + subjectSummaryText(summary) : '');
    },
    bumps: [BUILDING, SCHEDULE],
    focus: () => ({ section: 'schedule', tab: 'subjects' }),
  },
  (project, payload, ctx) => importing(project, () => applySubjectImport(project, payload.rows, ctx.ids)),
);

// A schedule file. payload: { file, policy, takeSettings }, where `file` is
// what readScheduleFile returned. A calendar the file replaces is stamped
// with the store's clock, so the publish form knows staff copies are old.
export const importSchedule = action(
  { label: importLabel('a schedule file'), bumps: [BUILDING, SCHEDULE], focus: () => ({ section: 'schedule', tab: 'groups' }) },
  (project, payload, ctx) => {
    if (!payload.file || typeof payload.file !== 'object') refuse('There is no schedule file to import.', 'bad-value');
    return importing(project, () => applySchedule(project, payload.file, { policy: payload.policy, takeSettings: payload.takeSettings === true, ids: ctx.ids, clock: ctx.clock }));
  },
);

// A building file, in place of the building here. payload: { file }, where
// `file` is what readBuildingFile returned.
export const importBuilding = action(
  {
    label: (before, payload, after) => {
      const summary = importOutcome(after);
      return 'Import a building file' + (summary ? ': ' + summary.floors + (summary.floors === 1 ? ' floor, ' : ' floors, ') + summary.rooms + (summary.rooms === 1 ? ' room' : ' rooms') : '');
    },
    bumps: [GEOMETRY, BUILDING, SCHEDULE],
    focus: () => ({ section: 'building' }),
  },
  (project, payload, ctx) => {
    if (!payload.file || typeof payload.file !== 'object') refuse('There is no building file to import.', 'bad-value');
    return importing(project, () => applyBuilding(project, payload.file, { ids: ctx.ids, unnumberedText: UNNUMBERED_ROOM_TEXT }));
  },
);

// ================================================================ SV2-10: imports (end)

// ================================================================ SV2-12: the grid editor (start)

// How two states of the schedule differ, counted in groups: { changed, added,
// removed }. A group counts as changed when anything about it differs: its
// name, grade, head count, colour or any slot.
export function countGroupChanges(before, after) {
  const was = new Map(before.groups.map((group) => [group.id, group]));
  const counts = { changed: 0, added: 0, removed: 0 };
  for (const group of after.groups) {
    if (!was.has(group.id)) counts.added += 1;
    else if (was.get(group.id) !== group) counts.changed += 1;
    was.delete(group.id);
  }
  counts.removed = was.size;
  return counts;
}

// "3 groups changed, 1 added, 1 removed". The first part that is there says
// "group"; the rest go without. Nothing at all is "no changes".
export function groupChangesText(counts) {
  const parts = [];
  for (const word of ['changed', 'added', 'removed']) {
    const n = counts[word];
    if (n === 0) continue;
    parts.push(n + (parts.length === 0 ? (n === 1 ? ' group ' : ' groups ') : ' ') + word);
  }
  return parts.length === 0 ? 'no changes' : parts.join(', ');
}

// New names for several groups at once. One at a time would refuse a trade
// (7-1 becomes 7-2 while 7-2 becomes 7-1), so a group whose new name is still
// held by another group that is about to give it up waits its turn, and a
// ring of them is opened by parking one under a name nobody has.
function renameGroups(project, edits) {
  let next = project;
  let waiting = edits.filter((edit) => edit.name !== undefined);
  const parked = new Set();
  const holder = (edit) => next.groups.find((group) => group.id !== edit.id && nameKey(group.name) === nameKey(edit.name));
  while (waiting.length > 0) {
    const free = waiting.filter((edit) => !holder(edit));
    if (free.length > 0) {
      for (const edit of free) next = editGroup(next, { id: edit.id, name: edit.name });
      waiting = waiting.filter((edit) => !free.includes(edit));
      continue;
    }
    const stuck = waiting.find((edit) => !parked.has(edit.id) && waiting.some((other) => other.id === holder(edit).id));
    // held by a group that is keeping its name: the refusal is editGroup's
    if (!stuck) return editGroup(next, { id: waiting[0].id, name: waiting[0].name });
    let spare = stuck.id;
    while (next.groups.some((group) => nameKey(group.name) === nameKey(spare))) spare += ' (moving)';
    next = editGroup(next, { id: stuck.id, name: spare });
    parked.add(stuck.id);
  }
  return next;
}

// Everything the grid editor staged, as one step. payload:
//   removed  [groupId]
//   groups   [{ id } with any of { name, grade, headCount, colour }]
//   added    [{ id, name, grade, headCount, colour }]
//   slots    [{ groupId, dayTypeId, period, slot }], slot as setSlot takes it
// Each part runs the action that does that one thing (deleteGroup, editGroup,
// addGroup, setSlot), in that order, so a removed group's name is free for an
// added one and a slot can be in a group added here. Any refusal refuses the
// whole step and nothing changes.
export const applyGridEdits = action(
  {
    label: (before, payload, after) => 'Apply grid edits: ' + groupChangesText(countGroupChanges(before, after)),
    bumps: [SCHEDULE],
    focus: () => ({ section: 'schedule', tab: 'grid' }),
  },
  (project, payload, ctx) => {
    if (!payload || typeof payload !== 'object') refuse('There are no grid edits to apply.', 'bad-value');
    const list = (key) => (Array.isArray(payload[key]) ? payload[key] : []);
    let next = project;
    for (const id of list('removed')) next = deleteGroup(next, { id }, ctx);
    next = renameGroups(next, list('groups'));
    for (const edit of list('groups')) next = editGroup(next, { id: edit.id, grade: edit.grade, headCount: edit.headCount, colour: edit.colour }, ctx);
    for (const group of list('added')) next = addGroup(next, group, ctx);
    for (const change of list('slots')) next = setSlot(next, change, ctx);
    return next;
  },
);

// ================================================================ SV2-12: the grid editor (end)

// ================================================================ SV2-61: scenario actions (start)
//
// The scenario lab's actions (spec 9, ARCHITECTURE 6.6). One scenario is open
// at a time, in project.scenario: { name, changes, compared }. Every action
// here but applyScenario changes the scenario alone, so each moves no
// counter (bumps: []); each is an undo step all the same. The rules about
// changes are engine/scenario.js's, used here and never re-implemented:
// normalise when a change is added, reconcile when the scenario is applied,
// applyChanges for the schedule itself, scenarioFromDiff for a file.
//
//   newScenario           { name?, replace? }
//   renameScenario        { name }
//   addScenarioChange     { change }
//   removeScenarioChange  { index }, an index into project.scenario.changes
//   discardScenario       {}
//   setScenarioFromFile   { project, fileName?, name?, replace? }
//   applyScenario         {}
//
// A scenario that is open is never replaced unless the payload says
// `replace: true`. Reconcile's `changes` and `dropped[*].change` are the
// scenario's own change objects, so a chip finds its index with indexOf.

import { CHANGE_KINDS } from './schema.js';
import { applyChanges, normalise, reconcile, scenarioFromDiff, changeWords } from './scenario.js';

export const NEW_SCENARIO_NAME = 'New scenario';

function scenarioFocus() {
  return { section: 'scenarios' };
}

// A payload left out or null reads as {}, so each action's own refusal applies.
function payloadOf(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

// A name is blank when nothing is left of it after white space and the
// zero-width characters (U+200B to U+200D, U+2060, U+FEFF) are taken out.
// A name that is not blank is kept exactly as typed. Exported (SV2-72d) so
// the screens and prints that name a scenario use this rule, not a copy.
export function blankName(value) {
  return typeof value === 'string' && value.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '') === '';
}

function needScenario(project) {
  if (!project.scenario) refuse('There is no scenario open. Start one first.', 'no-scenario');
  return project.scenario;
}

function needNoScenario(project, payload) {
  if (project.scenario && !(payload && payload.replace === true)) refuse('A scenario is already open: ' + project.scenario.name + '. Apply it or discard it first.', 'scenario-open');
}

// The scenario's name as a label says it: NEW_SCENARIO_NAME when the stored
// one is blank, which a file can hold (repair keeps name: '').
function scenarioName(project) {
  if (!project.scenario) return '';
  const name = project.scenario.name;
  return typeof name !== 'string' || blankName(name) ? NEW_SCENARIO_NAME : name;
}

function changesWord(n) {
  return n + (n === 1 ? ' change' : ' changes');
}

function withScenario(project, scenario) {
  return { ...project, scenario };
}

// A change as the scenario keeps it: its own fields and no others. Refused
// when it is not one of the three kinds with every field it needs.
function scenarioChange(change) {
  const bad = () => refuse('A scenario change is a move, a swap of two periods or a swap of two rooms, with every field it needs.', 'bad-value');
  if (!change || typeof change !== 'object' || !CHANGE_KINDS.includes(change.kind)) bad();
  const text = (value) => (typeof value === 'string' && value !== '' ? value : bad());
  const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : bad());
  if (change.kind === 'move') return { kind: 'move', dayTypeId: text(change.dayTypeId), groupId: text(change.groupId), period: whole(change.period), roomId: text(change.roomId) };
  if (change.kind === 'swapPeriods') return { kind: 'swapPeriods', dayTypeId: text(change.dayTypeId), groupId: text(change.groupId), periodA: whole(change.periodA), periodB: whole(change.periodB) };
  return { kind: 'swapRooms', dayTypeId: text(change.dayTypeId), groupA: text(change.groupA), groupB: text(change.groupB), period: whole(change.period) };
}

function sameChange(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function chipText(project, change) {
  return changeWords(project, change).text;
}

// Start a scenario with no changes. payload: { name } (left out or blank,
// NEW_SCENARIO_NAME) and replace, to put it in place of an open one.
export const newScenario = action(
  { label: (before, payload, after) => 'Start scenario ' + scenarioName(after), bumps: [], focus: scenarioFocus },
  (project, payload) => {
    needNoScenario(project, payload);
    const given = payloadOf(payload).name;
    const name = given === undefined || blankName(given) ? NEW_SCENARIO_NAME : needText(given, 'A scenario name');
    return withScenario(project, { name, changes: [], compared: null });
  },
);

// payload: { name }.
export const renameScenario = action(
  { label: (before, payload) => 'Rename scenario ' + scenarioName(before) + ' to ' + payloadOf(payload).name, bumps: [], focus: scenarioFocus },
  (project, payload) => {
    const scenario = needScenario(project);
    const given = payloadOf(payload).name;
    const name = needName(blankName(given) ? '' : given, 'A scenario');
    if (name === scenario.name) return project;
    return withScenario(project, { ...scenario, name });
  },
);

// One more change. It is refused in the schedule editor's words when it
// could not be applied to the schedule as it is now (a "same as" day type, a
// group, period or room that is not there). Then the changes are normalised
// with this one as the one added: a later change on a slot replaces an
// earlier one, and this one goes when it leaves its slots as the schedule
// has them, which is how "move 7-1 to 204 and back" leaves nothing. An older
// change the schedule has caught up with stays (reconcile hides it). Adding
// what changes nothing makes no undo step, and so does adding a change the
// scenario already holds, compared field by field. When the change added
// leaves its slots as the schedule has them it goes too, taking with it the
// changes it replaced, and the label says how many went. payload: { change }.
export const addScenarioChange = action(
  {
    label: (before, payload, after) => {
      const name = scenarioName(before);
      const change = scenarioChange(payloadOf(payload).change);
      const list = after.scenario.changes;
      const added = 'Add to scenario ' + name + ': ' + chipText(before, change);
      if (list.length > 0 && sameChange(list[list.length - 1], change)) return added;
      const gone = before.scenario.changes.filter((old) => !list.includes(old));
      return added + ', which puts back the schedule there and takes ' + changesWord(gone.length) + ' out of the scenario';
    },
    bumps: [],
    focus: scenarioFocus,
  },
  (project, payload) => {
    const scenario = needScenario(project);
    const change = scenarioChange(payloadOf(payload).change);
    applyChanges(project, [change]);
    const list = scenario.changes.concat([change]);
    const changes = normalise(project, list, { added: list.length - 1 });
    if (changes.length === scenario.changes.length && changes.every((kept, i) => sameChange(kept, scenario.changes[i]))) return project;
    return withScenario(project, { ...scenario, changes });
  },
);

// payload: { index }, the change's place in project.scenario.changes.
export const removeScenarioChange = action(
  { label: (before, payload) => 'Remove from scenario ' + scenarioName(before) + ': ' + chipText(before, before.scenario.changes[payloadOf(payload).index]), bumps: [], focus: scenarioFocus },
  (project, payload) => {
    const scenario = needScenario(project);
    const index = payloadOf(payload).index;
    if (!Number.isInteger(index) || index < 0 || index >= scenario.changes.length) refuse('That change is no longer in the scenario.', 'missing');
    return withScenario(project, { ...scenario, changes: scenario.changes.filter((change, i) => i !== index) });
  },
);

// The scenario goes, changes and all; undo brings it back. With none open
// this changes nothing.
export const discardScenario = action(
  { label: (before) => 'Discard scenario ' + scenarioName(before), bumps: [], focus: scenarioFocus },
  (project) => (project.scenario ? withScenario(project, null) : project),
);

// What scenarioFromDiff reads of the other project, each the shape it reads
// it as: a building whose floors are a list of floors each with a list of
// spaces, settings, and lists of groups and day types.
function readableProject(other) {
  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const listOf = (value) => Array.isArray(value) && value.every(isObject);
  if (Array.isArray(other) || !isObject(other.building) || !isObject(other.settings)) return false;
  if (!listOf(other.building.floors) || !other.building.floors.every((floor) => listOf(floor.spaces))) return false;
  return listOf(other.groups) && listOf(other.dayTypes);
}

// "Compare with another project file": the scenario is what would make this
// schedule the file's, matched by room number and group name
// (scenarioFromDiff), with the file's name and the groups only one side has
// in `compared`. A different building is refused with the count of rooms
// that differ. The slots it could not compare (scenarioFromDiff's `skipped`)
// are for the lab to show; the scenario does not keep them.
// A project that is not the shape scenarioFromDiff reads (the building's
// floors and their spaces, the groups, the day types, the settings) is
// refused before it is read. payload: { project, fileName, name } and
// replace, as newScenario.
export const setScenarioFromFile = action(
  {
    label: (before, payload, after) => 'Compare with ' + (after.scenario.compared.fileName === '' ? 'another file' : after.scenario.compared.fileName) + ': ' + changesWord(after.scenario.changes.length),
    bumps: [],
    focus: scenarioFocus,
  },
  (project, payload) => {
    const given = payloadOf(payload);
    needNoScenario(project, given);
    const other = given.project;
    if (!other || typeof other !== 'object') refuse('There is no project file to compare with.', 'bad-value');
    if (!readableProject(other)) refuse('This file is not a project file this tool can read, so there is nothing to compare with.', 'bad-value');
    const options = { fileName: typeof given.fileName === 'string' ? given.fileName : '' };
    if (typeof given.name === 'string' && !blankName(given.name)) options.name = given.name;
    return withScenario(project, scenarioFromDiff(project, other, options).scenario);
  },
);

// Write the scenario into the real schedule as one undo step, and close it.
// Only the changes that still apply go in (reconcile); each is applied by
// setSlot or moveSlot (applyChanges). Any refusal refuses the whole step and
// nothing changes. Undo brings back the schedule and the scenario together.
export const applyScenario = action(
  {
    label: (before) => 'Apply scenario ' + scenarioName(before) + ': ' + changesWord(reconcile(before, before.scenario).changes.length),
    bumps: [SCHEDULE],
    focus: scenarioFocus,
  },
  (project) => {
    const scenario = needScenario(project);
    const applied = applyChanges(project, reconcile(project, scenario).changes);
    return withScenario(applied, null);
  },
);

// ================================================================ SV2-61: scenario actions (end)

// ================================================================ SV2-72d: removeScenarioChanges (start)
//
// Several changes out of the open scenario as one step of undo: the lab's
// "Remove them", for the changes that no longer apply. payload: { indexes },
// places in project.scenario.changes, each once, in any order. A list with
// no index makes no entry; an index that is not a change of the scenario
// refuses the whole step, as removeScenarioChange does for one.

export const removeScenarioChanges = action(
  {
    label: (before, payload) => {
      const indexes = payloadOf(payload).indexes;
      const name = scenarioName(before);
      if (indexes.length === 1) return 'Remove from scenario ' + name + ': ' + chipText(before, before.scenario.changes[indexes[0]]);
      return 'Remove from scenario ' + name + ': ' + changesWord(indexes.length);
    },
    bumps: [],
    focus: scenarioFocus,
  },
  (project, payload) => {
    const scenario = needScenario(project);
    const indexes = payloadOf(payload).indexes;
    if (!Array.isArray(indexes)) refuse('Say which changes to take out of the scenario.', 'bad-value');
    if (indexes.length === 0) return project;
    const out = new Set();
    for (const index of indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= scenario.changes.length) refuse('That change is no longer in the scenario.', 'missing');
      if (out.has(index)) refuse('Each change is taken out once: the same one is named twice.', 'bad-value');
      out.add(index);
    }
    return withScenario(project, { ...scenario, changes: scenario.changes.filter((change, i) => !out.has(i)) });
  },
);

// ================================================================ SV2-72d: removeScenarioChanges (end)
