// Every state change is a pure function here: (project, payload, ctx) → project.
// An action copies only the branches it changes, so everything it leaves alone
// is the very same object afterwards. ctx is { ids, clock }.
//
// Each action carries three things the store reads:
//   label  what the undo entry is called: text, or (before, payload, after) → text
//   bumps  which of the store's counters the change moves: a list of
//          GEOMETRY, BUILDING, SCHEDULE, or (before, payload, after) → list
//   focus  optional (before, payload, after) → where the change was, for "Show"
//
// An action that cannot be done throws an ActionError whose message says what
// was wrong and what to do; the interface shows it as it is. An action that
// changes nothing returns the project it was given, and the store then makes
// no undo entry.

import { RANGES, PERIOD_WORDS, TIME_FORMATS, PAPER_SIZES, PAPER_ORIENTATIONS, THEMES, COLOUR_SCALE_MODES, PUBLISH_VIEWS } from './schema.js';
import { defaultSettings, emptySlot, emptyDay, emptyBells, newFloor, nameKey, looseNameKey, isHexColour, isBellTime, isIsoDate, inRange, allRooms, findRoom, nextGroupColour } from './schema.js';
import { isOwnCopy, findDayType, baseDayType } from './day-types.js';
import { periodName } from './bells.js';

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
  return run;
}

// What the store needs to know about one run of an action.
export function describeAction(act, before, payload, after) {
  const read = (value, fallback) => (typeof value === 'function' ? value(before, payload, after) : value === undefined || value === null ? fallback : value);
  return { label: read(act.label, 'Change'), bumps: read(act.bumps, []), focus: read(act.focus, null) };
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

function newId(payload, ctx, prefix) {
  if (payload && typeof payload.id === 'string' && payload.id !== '') return payload.id;
  return ctx.ids(prefix);
}

// ---------------------------------------------------------------- settings

function wholeRule(range, what) {
  return (value) => (inRange(value, range) ? null : what + ' is a whole number from ' + range[0] + ' to ' + range[1] + '.');
}

function choiceRule(allowed, what) {
  return (value) => (allowed.includes(value) ? null : what + ' is one of: ' + allowed.join(', ') + '.');
}

const SETTINGS = {
  schoolName: { label: 'Change the school name', bumps: [], check: (value) => (typeof value === 'string' ? null : 'The school name is text.') },
  periodWord: { label: 'Change the period word', bumps: [SCHEDULE], check: choiceRule(PERIOD_WORDS, 'The period word') },
  defaultPassingSeconds: { label: 'Change the default passing time', bumps: [SCHEDULE], check: wholeRule(RANGES.defaultPassingSeconds, 'The default passing time in seconds') },
  defaultHeadCount: { label: 'Change the default head count', bumps: [SCHEDULE], check: wholeRule(RANGES.headCount, 'The default head count') },
  secondsPerCell: { label: 'Change seconds per corridor cell', bumps: [GEOMETRY, SCHEDULE], check: wholeRule(RANGES.secondsPerCell, 'Seconds per corridor cell') },
  secondsPerStair: { label: 'Change seconds per stair connection', bumps: [GEOMETRY, SCHEDULE], check: wholeRule(RANGES.secondsPerStair, 'Seconds per stair connection') },
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
    check: (value) => (Array.isArray(value) && value.every((kind) => typeof kind === 'string') && new Set(value).size === value.length ? null : 'The checks switched off are a list of check kinds, each once.'),
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
  return a === b;
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
  let scenarioChanges = 0;
  if (project.scenario) {
    for (const change of project.scenario.changes) {
      const used = [change.period, change.periodA, change.periodB].filter((value) => value !== undefined);
      if (used.some((value) => value >= periods)) scenarioChanges += 1;
    }
  }
  return { from, to: periods, removedPeriods, slots, bells, groups, dayTypes, scenarioChanges, losesData: slots + bells + scenarioChanges > 0 };
}

// Periods per day. Going down removes the later periods from every day and
// bell schedule; undo brings them back.
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
    const value = Array.isArray(payload.value) ? payload.value.slice() : payload.value;
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
};

// One publish setting. payload: { key, value }; key is passcode,
// stalenessDays, teacherNamesOnMap, lastPublishedAt or views.<view>.
export const setPublishSetting = action(
  { label: 'Change a publish setting', bumps: [], focus: () => ({ section: 'staff' }) },
  (project, payload) => {
    const key = payload.key;
    if (typeof key === 'string' && key.startsWith('views.')) {
      const view = key.slice(6);
      if (!PUBLISH_VIEWS.includes(view)) refuse('There is no view called "' + view + '".', 'bad-value');
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

// Getting started. payload: any of { step, dismissed, neverShow }.
export const setOnboarding = action(
  { label: 'Change getting started', bumps: [] },
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
      id: newId(payload, ctx, 's'),
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
      id: newId(payload, ctx, 't'),
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
  { label: (before, payload) => 'Change the teachers of Room ' + (findRoom(before, payload.roomId) || { number: '' }).number, bumps: [BUILDING, SCHEDULE], focus: (before, payload) => ({ section: 'building', roomId: payload.roomId }) },
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
      id: newId(payload, ctx, 'g'),
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
      id: typeof payload.newId === 'string' && payload.newId !== '' ? payload.newId : ctx.ids('g'),
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
  if (!isOwnCopy(project, dayTypeId)) refuse(dayType.name + ' is the same as ' + baseDayType(project).name + '. Make it its own copy to change it.', 'same-as-base');
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
// payload: { fromDayTypeId, toDayTypeId } and optionally groupId. Copying onto
// a day type that is the same as the first changes nothing: it already is.
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
    const sourceId = isOwnCopy(project, from.id) ? from.id : baseDayType(project).id;
    if (!isOwnCopy(project, to.id)) {
      if (sourceId === baseDayType(project).id) return project;
      refuse(to.name + ' is the same as ' + baseDayType(project).name + '. Make it its own copy to change it.', 'same-as-base');
    }
    if (sourceId === to.id) return project;
    return withKey(project, 'groups', mapShared(project.groups, (group) => {
      if (payload.groupId !== undefined && group.id !== payload.groupId) return group;
      const source = group.days[sourceId];
      const target = group.days[to.id];
      if (source.every((slot, p) => sameSlot(slot, target[p]))) return group;
      return { ...group, days: { ...group.days, [to.id]: source.map(copySlot) } };
    }));
  },
);

// ---------------------------------------------------------------- day types

function dayTypeFocus(before, payload) {
  return { section: 'schedule', tab: 'day', dayTypeId: payload.dayTypeId };
}

export const renameDayType = action(
  { label: (before, payload) => 'Rename ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' to ' + payload.name, bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    need(project.dayTypes, payload.dayTypeId, 'day type');
    needName(payload.name, 'A day type');
    return withKey(project, 'dayTypes', mapShared(project.dayTypes, (dayType) => (dayType.id === payload.dayTypeId ? withKey(dayType, 'name', payload.name) : dayType)));
  },
);

// Turn "same as A Day" into a copy of A Day that can be edited: its bells and
// every group's day start as the first day type's.
export const makeOwnCopy = action(
  { label: (before, payload) => 'Make ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' its own copy', bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    if (isOwnCopy(project, dayType.id)) return project;
    const base = baseDayType(project);
    return {
      ...project,
      dayTypes: project.dayTypes.map((candidate) => (candidate === dayType ? { ...dayType, own: true, bells: base.bells.map((bell) => (bell === null ? null : { ...bell })) } : candidate)),
      groups: project.groups.map((group) => ({ ...group, days: { ...group.days, [dayType.id]: group.days[base.id].map(copySlot) } })),
    };
  },
);

// Back to "same as A Day". The day type's own bells and days go; undo brings
// them back.
export const revertToBase = action(
  { label: (before, payload) => 'Make ' + (findDayType(before, payload.dayTypeId) || { name: '' }).name + ' the same as ' + baseDayType(before).name, bumps: [SCHEDULE], focus: dayTypeFocus },
  (project, payload) => {
    const dayType = need(project.dayTypes, payload.dayTypeId, 'day type');
    if (dayType === baseDayType(project)) refuse(dayType.name + ' is the first day type. The others can be the same as it; it cannot be the same as another.', 'base');
    if (!dayType.own) return project;
    return {
      ...project,
      dayTypes: project.dayTypes.map((candidate) => (candidate === dayType ? { ...dayType, own: false, bells: emptyBells(project.settings.periods) } : candidate)),
      groups: project.groups.map((group) => {
        const days = { ...group.days };
        delete days[dayType.id];
        return { ...group, days };
      }),
    };
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

// A new floor at the end, the size of the floor being looked at.
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
    const floor = newFloor(newId(payload || {}, ctx, 'f'), name, floors.length + 1, like.width, like.height);
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

// payload: { findingId, reason }. The time comes from ctx.clock.
export const acceptFinding = action(
  { label: 'Accept a finding', bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'checks' }) },
  (project, payload, ctx) => {
    if (typeof payload.findingId !== 'string' || payload.findingId === '') refuse('Pick a finding to accept.', 'bad-value');
    const entry = { findingId: payload.findingId, reason: needText(payload.reason === undefined ? '' : payload.reason, 'A reason'), at: ctx.clock().toISOString() };
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
  (project, payload, ctx) => inBuilding(project, (building) => geometry.placeRoom(building, payload, ctx.ids)),
);

// payload as placeRoom, with label, otherKind and colour.
export const placeOtherSpace = action(
  { label: (before, payload, after) => 'Place other space' + onFloor(before, payload, after) + replacing(after), bumps: geometryBumps, focus: buildingFocus },
  (project, payload, ctx) => inBuilding(project, (building) => geometry.placeOtherSpace(building, payload, ctx.ids)),
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
  (project, payload, ctx) => inBuilding(project, (building) => geometry.connectStairs(building, payload, ctx.ids)),
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

// payload: { connectionId } and any of { label, direction }.
export const setConnection = action(
  { label: (before, payload) => 'Change stairs connection ' + connectionLabel(before, payload.connectionId), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload) => inBuilding(project, (building) => geometry.setConnection(building, payload)),
);

// ---- corridor names

// payload: { floorId, cells, name } and optionally id. An empty name takes
// the name off those cells. Bumps geometry because a route can be asked to
// avoid a named corridor, and this changes which cells that is.
export const nameCorridor = action(
  { label: (before, payload, after) => (payload.name === '' ? 'Take the corridor name off cells' : 'Name a corridor ' + payload.name) + onFloor(before, payload, after), bumps: [GEOMETRY], focus: buildingFocus },
  (project, payload, ctx) => inBuilding(project, (building) => geometry.nameCorridor(building, payload, ctx.ids)),
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
  (project, payload, ctx) => inBuilding(project, (building) => geometry.markExit(building, payload, ctx.ids)),
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
  (project, payload, ctx) => inBuilding(project, (building) => geometry.addZone(building, payload, ctx.ids)),
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

// ================================================================ SV2-04: the building (end)
