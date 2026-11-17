// The actions of wish group 7 that change what a school types: room features,
// the custom period word and period names, and when a teacher is not in school
// (ARCHITECTURE 22.2, 22.7, 22.10, 22.17). Each is an `action` from actions.js
// with its label, its counters and its refusals; each is one undo step.
//
// The other W7 changes live where they were: setPeriods, deleteDayType,
// mergeTeachers, clearRoomDetails and setRoomFields keep every reference true
// in actions.js itself.

import { action, ActionError, patch, mapRooms, mapShared, reporting, withRoomFeatureIds, clearNumberNames, normalAway, awayKey, awayIsNever, BUILDING, SCHEDULE } from './actions.js';
import { RANGES, PERIOD_WORDS, FEATURES_MOST, FEATURE_NAME_MOST, COMMON_FEATURES, PERIOD_COUNTS, PERIOD_WORD_MOST, PERIOD_NAME_MOST, AWAY_MOST, WEEKDAY_NAMES } from './schema.js';
import { nameKey, spacelessKey, textLength, findRoom, nameOfRoom, allRooms } from './schema.js';
import { periodNumberName } from './bells.js';
import { periodByNumber, columnRoleOf, roleWords } from './import-groups.js';
import { isId, collectIds } from './ids.js';
import { awayWords } from './teacher-day.js';

function refuse(message, code) {
  throw new ActionError(message, code);
}

function featuresOf(project) {
  return Array.isArray(project.building.features) ? project.building.features : [];
}

function withFeatures(project, features) {
  return patch(project, ['building'], (building) => ({ ...building, features }));
}

function featureNamed(project, id) {
  return (featuresOf(project).find((feature) => feature.id === id) || { name: '' }).name;
}

function needFeature(project, id) {
  const found = featuresOf(project).find((feature) => feature.id === id);
  if (!found) refuse('That feature is no longer on the list.', 'missing');
  return found;
}

// A feature's name: 1 to FEATURE_NAME_MOST characters, trimmed, and not the
// name of another feature, whatever the capitals or the spaces round it.
function needFeatureName(project, value, exceptId) {
  if (typeof value !== 'string' || value.trim() === '') refuse('A feature needs a name. Type one, like Lab or Sink, and try again.', 'no-name');
  const name = value.trim();
  if (textLength(name) > FEATURE_NAME_MOST) refuse('A feature name is at most ' + FEATURE_NAME_MOST + ' characters, and this one has ' + textLength(name) + '. Shorten it.', 'too-long');
  const clash = featuresOf(project).find((feature) => feature.id !== exceptId && nameKey(feature.name) === nameKey(name));
  if (clash) refuse('There is already a feature called "' + clash.name + '". Each feature is on the list once; use that one, or type a different name.', 'duplicate-name');
  return name;
}

function needFeatureSlot(project) {
  if (featuresOf(project).length >= FEATURES_MOST) refuse('A school has at most ' + FEATURES_MOST + ' features, and this one has ' + featuresOf(project).length + '. Delete one to add another.', 'limit');
}

// The id for a new feature: the one the payload gives when it is a free "h"
// id, else a new one that nothing in the project has.
function newFeatureId(project, payload, ctx) {
  const taken = new Set(collectIds(project).concat(featuresOf(project).map((feature) => feature.id)));
  const given = payload ? payload.id : undefined;
  if (typeof given === 'string' && given !== '') {
    if (!isId(given, 'h')) refuse('"' + given + '" cannot be the id of a feature: an id is 10 lowercase letters and digits and starts with "h". Leave the id out and one is made.', 'bad-id');
    if (taken.has(given)) refuse('The id "' + given + '" is already used in this project. Leave the id out and a new one is made.', 'duplicate-id');
    return given;
  }
  let id = ctx.ids('h');
  for (let tries = 0; taken.has(id) && tries < 20; tries += 1) id = ctx.ids('h');
  return id;
}

// ---------------------------------------------------------------- features

// payload: { name } and optionally id. It goes at the end of the list.
export const addFeature = action(
  { label: (before, payload) => 'Add feature ' + (payload && typeof payload.name === 'string' ? payload.name.trim() : ''), bumps: [BUILDING], focus: () => ({ section: 'building' }) },
  (project, payload, ctx) => {
    const data = payload || {};
    needFeatureSlot(project);
    const name = needFeatureName(project, data.name, null);
    return withFeatures(project, featuresOf(project).concat([{ id: newFeatureId(project, data, ctx), name }]));
  },
);

// payload: { id, name }.
export const renameFeature = action(
  { label: (before, payload) => 'Rename feature ' + featureNamed(before, payload.id) + ' to ' + (typeof payload.name === 'string' ? payload.name.trim() : ''), bumps: [BUILDING], focus: () => ({ section: 'building' }) },
  (project, payload) => {
    const found = needFeature(project, payload.id);
    const name = needFeatureName(project, payload.name, found.id);
    if (name === found.name) return project;
    return withFeatures(project, featuresOf(project).map((feature) => (feature === found ? { ...feature, name } : feature)));
  },
);

// What deleting a feature does, said before it is done so the dialog can count
// the rooms: { id, name, rooms, text }. Nothing is changed here.
export function describeFeatureDelete(project, id) {
  const found = featuresOf(project).find((feature) => feature.id === id);
  if (!found) return null;
  const rooms = allRooms(project).filter((room) => Array.isArray(room.featureIds) && room.featureIds.includes(id)).length;
  return { id, name: found.name, rooms, text: 'Deleted ' + found.name + (rooms > 0 ? ', and took it off ' + rooms + (rooms === 1 ? ' room' : ' rooms') : '') };
}

// payload: { id }. The feature leaves every room that had it.
export const deleteFeature = action(
  { label: (before, payload) => 'Delete feature ' + featureNamed(before, payload.id), bumps: [BUILDING], focus: () => ({ section: 'building' }) },
  (project, payload) => {
    const found = needFeature(project, payload.id);
    const outcome = describeFeatureDelete(project, found.id);
    let next = withFeatures(project, featuresOf(project).filter((feature) => feature !== found));
    next = mapRooms(next, (room) => {
      if (!Array.isArray(room.featureIds) || !room.featureIds.includes(found.id)) return room;
      const featureIds = room.featureIds.filter((held) => held !== found.id);
      if (featureIds.length > 0) return { ...room, featureIds };
      const { featureIds: dropped, ...rest } = room;
      return rest;
    });
    return reporting(project, next, outcome);
  },
);

// Every room's featureIds in the list's order again, after the list moved.
function reorderRoomFeatures(project) {
  const order = featuresOf(project).map((feature) => feature.id);
  return mapRooms(project, (room) => {
    if (!Array.isArray(room.featureIds) || room.featureIds.length < 2) return room;
    const sorted = order.filter((id) => room.featureIds.includes(id));
    return sorted.every((id, at) => id === room.featureIds[at]) ? room : { ...room, featureIds: sorted };
  });
}

// payload: { id, toIndex }. The rooms' own lists follow the list's order.
export const moveFeature = action(
  { label: (before, payload) => 'Move feature ' + featureNamed(before, payload.id), bumps: [BUILDING], focus: () => ({ section: 'building' }) },
  (project, payload) => {
    const list = featuresOf(project);
    const from = list.findIndex((feature) => feature.id === payload.id);
    if (from === -1) refuse('That feature is no longer on the list.', 'missing');
    if (!Number.isInteger(payload.toIndex)) refuse('A position in the list is a whole number.', 'bad-value');
    const to = Math.min(list.length - 1, Math.max(0, payload.toIndex));
    if (to === from) return project;
    const next = list.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return reorderRoomFeatures(withFeatures(project, next));
  },
);

// payload: optionally { names }, a choice from COMMON_FEATURES (left out: all of
// them). Those the list does not hold yet, by name, are added in COMMON_FEATURES'
// order; when none is new, or the list would pass its most, it is refused.
export const addCommonFeatures = action(
  { label: 'Add the common features', bumps: [BUILDING], focus: () => ({ section: 'building' }) },
  (project, payload, ctx) => {
    const data = payload || {};
    const chosen = data.names === undefined ? COMMON_FEATURES : data.names;
    if (!Array.isArray(chosen) || chosen.some((name) => !COMMON_FEATURES.includes(name))) refuse('The common features are: ' + COMMON_FEATURES.join(', ') + '.', 'bad-value');
    const held = new Set(featuresOf(project).map((feature) => nameKey(feature.name)));
    const fresh = COMMON_FEATURES.filter((name) => chosen.includes(name) && !held.has(nameKey(name)));
    if (fresh.length === 0) refuse('Every one of those is on the list already.', 'nothing-to-do');
    if (featuresOf(project).length + fresh.length > FEATURES_MOST) refuse('Adding ' + fresh.length + ' features would pass the most a school can have, ' + FEATURES_MOST + ', and it has ' + featuresOf(project).length + '. Delete some first, or add fewer.', 'limit');
    let next = project;
    for (const name of fresh) next = withFeatures(next, featuresOf(next).concat([{ id: newFeatureId(next, null, ctx), name }]));
    return next;
  },
);

// payload: { roomId, featureIds }. Each id once, each on the list; kept in the
// list's order.
export const setRoomFeatures = action(
  { label: (before, payload) => 'Change the features of ' + nameOfRoom(findRoom(before, payload.roomId), false), bumps: [BUILDING], focus: (before, payload) => ({ section: 'building', roomId: payload.roomId }) },
  (project, payload) => withRoomFeatureIds(project, payload.roomId, payload.featureIds),
);

// ---------------------------------------------------------------- period words

function withSetting(project, key, value) {
  if (value === undefined) {
    if (!(key in project.settings)) return project;
    const { [key]: dropped, ...rest } = project.settings;
    return { ...project, settings: rest };
  }
  return patch(project, ['settings', key], () => value);
}

function needWord(value, what) {
  if (typeof value !== 'string' || value.trim() === '') refuse(what + ' needs a word. Type one, like Lesson or Class, and try again.', 'no-name');
  const word = value.trim();
  if (textLength(word) > PERIOD_WORD_MOST) refuse(what + ' is at most ' + PERIOD_WORD_MOST + ' characters, and this one has ' + textLength(word) + '. Shorten it.', 'too-long');
  return word;
}

// payload: { word, plural, count } or null, which goes back to the period word
// of the settings. `plural` left out is the word with "s"; `count` is how the
// periods are numbered: number, letter or ordinal. { clear: true, periodWord }
// is null and also sets that period word, in one step.
export const setPeriodCustom = action(
  { label: (before, payload) => (payload && !payload.clear ? 'Use ' + (typeof payload.word === 'string' ? payload.word.trim() : '') + ' as the period word' : 'Go back to the period word of the settings'), bumps: [SCHEDULE], focus: () => ({ section: 'project' }) },
  (project, payload) => {
    // a new word has new number names: a period name equal to one is cleared
    if (payload === null) return clearNumberNames(project, withSetting(project, 'periodCustom', undefined));
    // { clear: true, periodWord? } goes back and, in the same step, sets one of
    // the four words: leaving Other word for another word is one undo step
    if (payload && typeof payload === 'object' && payload.clear === true) {
      const word = payload.periodWord;
      if (word !== undefined && !PERIOD_WORDS.includes(word)) refuse('The period word is one of ' + PERIOD_WORDS.join(', ') + '.', 'bad-value');
      let next = withSetting(project, 'periodCustom', undefined);
      if (word !== undefined) next = withSetting(next, 'periodWord', word);
      return clearNumberNames(project, next);
    }
    if (typeof payload !== 'object' || Array.isArray(payload)) refuse('The custom period word is a word, its plural and how the periods are counted, or null.', 'bad-value');
    const word = needWord(payload.word, 'The period word');
    const plural = payload.plural === undefined || (typeof payload.plural === 'string' && payload.plural.trim() === '') ? word + 's' : needWord(payload.plural, 'The plural of the period word');
    const count = payload.count === undefined ? 'number' : payload.count;
    if (!PERIOD_COUNTS.includes(count)) refuse('The periods are counted by number, letter or ordinal.', 'bad-value');
    const held = project.settings.periodCustom;
    if (held && held.word === word && held.plural === plural && held.count === count) return project;
    return clearNumberNames(project, withSetting(project, 'periodCustom', { word, plural, count }));
  },
);

function describeName(project, period, name) {
  const settings = project.settings;
  const others = [];
  const names = Array.isArray(settings.periodNames) ? settings.periodNames : [];
  for (let at = 0; at < settings.periods; at += 1) {
    if (at !== period && typeof names[at] === 'string' && spacelessKey(names[at]) === spacelessKey(name)) others.push(at);
  }
  return others;
}

// payload: { period, name }. "" clears the name. A name that is a bare number
// or any period's number name ("Period 5") is refused: an import could not tell
// it from the period it names. A name another period has is allowed and said:
// imports match those periods by number.
export const setPeriodName = action(
  { label: (before, payload) => (typeof payload.name === 'string' && payload.name.trim() !== '' ? 'Name ' + periodNumberName(before.settings, payload.period) + ' ' + payload.name.trim() : 'Clear the name of ' + periodNumberName(before.settings, payload.period)), bumps: [SCHEDULE], focus: () => ({ section: 'schedule', tab: 'day' }) },
  (project, payload) => {
    const settings = project.settings;
    if (!Number.isInteger(payload.period) || payload.period < 0 || payload.period >= settings.periods) refuse('That period is not in the school day. The day has ' + settings.periods + ' periods.', 'bad-value');
    if (typeof payload.name !== 'string') refuse('A period name is text. Leave it empty to clear it.', 'bad-value');
    const name = payload.name.trim();
    if (textLength(name) > PERIOD_NAME_MOST) refuse('A period name is at most ' + PERIOD_NAME_MOST + ' characters, and this one has ' + textLength(name) + '. Shorten it.', 'too-long');
    const held = settings.periodNames;
    const names = Array.isArray(held) ? held.slice() : [];
    while (names.length < settings.periods) names.push('');
    if ((names[payload.period] || '') === name) return project;
    if (name !== '') {
      if (/^[0-9]+$/.test(name)) refuse('A period name cannot be just a number: "' + name + '" would be taken for period ' + name + ' when a file is read. Add a word, like "Lunch" or "Advisory".', 'bad-name');
      // every period a day could have counts, not only today's: a longer day
      // would make the name the number name of a period that has it
      for (let at = 0; at < RANGES.periods[1]; at += 1) {
        if (spacelessKey(periodNumberName(settings, at)) === spacelessKey(name)) {
          const which = at === payload.period ? 'this period' : at < settings.periods ? 'another period' : 'a period a longer day would have';
          refuse('"' + name + '" is the number name of ' + which + ', and a file would match it to ' + (at === payload.period ? 'it' : 'that one') + '. Type another name.', 'bad-name');
        }
      }
      const role = columnRoleOf(name);
      if (role !== null) refuse('"' + name + '" is a column heading an import reads as the ' + roleWords(role) + ', so a period called that would never be matched. Type another name.', 'bad-name');
      const reads = periodByNumber(name, settings);
      if (reads !== -1) refuse('"' + name + '" would be read as ' + periodNumberName(settings, reads) + ' when a file is read, whatever this period is called. Type another name.', 'bad-name');
    }
    names[payload.period] = name;
    while (names.length > 0 && names[names.length - 1] === '') names.pop();
    const next = withSetting(project, 'periodNames', names.length > 0 ? names : undefined);
    const same = name === '' ? [] : describeName(next, payload.period, name);
    if (same.length === 0) return next;
    return reporting(project, next, { duplicate: true, text: 'Two periods are named ' + name + '; imports match them by number.' });
  },
);

// ---------------------------------------------------------------- away

function teacherNamed(project, id) {
  return (project.teachers.find((teacher) => teacher.id === id) || { name: '' }).name;
}

// One away entry in its stored form, or a refusal: day types the project has,
// weekdays 0 to 6, periods inside the day, each once and sorted.
function needAwayEntry(project, entry, at) {
  const which = 'Entry ' + (at + 1);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse(which + ' of when the teacher is not in school is not an entry. Each is day types, weekdays and periods.', 'bad-value');
  const lists = { dayTypeIds: entry.dayTypeIds === undefined ? [] : entry.dayTypeIds, weekdays: entry.weekdays === undefined ? [] : entry.weekdays, periods: entry.periods === undefined ? [] : entry.periods };
  for (const key of Object.keys(lists)) if (!Array.isArray(lists[key])) refuse(which + ': ' + key + ' is a list.', 'bad-value');
  for (const id of lists.dayTypeIds) if (!project.dayTypes.some((dayType) => dayType.id === id)) refuse(which + ' names a day type that is no longer in the project. Pick the day types again.', 'missing');
  for (const day of lists.weekdays) if (!Number.isInteger(day) || day < 0 || day >= WEEKDAY_NAMES.length) refuse(which + ': a weekday is 0 (Monday) to 6 (Sunday).', 'bad-value');
  for (const period of lists.periods) if (!Number.isInteger(period) || period < 0 || period >= project.settings.periods) refuse(which + ' names a period that is not in the school day. The day has ' + project.settings.periods + ' periods.', 'bad-value');
  const normal = normalAway(project, lists);
  if (awayIsNever(project.dayTypes, project.settings.periods, normal)) refuse('A teacher who is never in school is not a teacher of this school; remove them instead.', 'never-in-school');
  return { dayTypeIds: normal.dayTypeIds, weekdays: normal.weekdays, periods: normal.periods };
}

// payload: { teacherId, away }, away the teacher's whole list of entries (at
// most AWAY_MOST), [] for none. An entry that names no day types is every day
// type, no weekdays every day, no periods the whole day; one that is all three
// is refused.
export const setTeacherAway = action(
  { label: (before, payload) => 'Change when ' + teacherNamed(before, payload.teacherId) + ' is not in school', bumps: [BUILDING, SCHEDULE], focus: (before, payload) => ({ section: 'schedule', tab: 'teachers', teacherId: payload.teacherId }) },
  (project, payload) => {
    const teacher = project.teachers.find((candidate) => candidate.id === payload.teacherId);
    if (!teacher) refuse('That teacher is no longer in the project.', 'missing');
    if (!Array.isArray(payload.away)) refuse('When a teacher is not in school is a list of entries, or an empty list for always.', 'bad-value');
    if (payload.away.length > AWAY_MOST) refuse('A teacher has at most ' + AWAY_MOST + ' entries for when they are not in school, and this is ' + payload.away.length + '. Combine some.', 'limit');
    const given = payload.away.map((entry, at) => needAwayEntry(project, entry, at));
    // an entry that says what an earlier one says is kept once
    const seen = new Set();
    const away = given.filter((entry) => !seen.has(awayKey(entry)) && seen.add(awayKey(entry)));
    // the stored list in the same form, so saving what is there changes nothing
    const held = (Array.isArray(teacher.away) ? teacher.away : []).map((entry) => normalAway(project, entry));
    if (away.length === held.length && away.every((entry, at) => awayKey(entry) === awayKey(held[at]))) return project;
    return { ...project, teachers: mapShared(project.teachers, (candidate) => {
      if (candidate !== teacher) return candidate;
      if (away.length > 0) return { ...candidate, away };
      const { away: dropped, ...rest } = candidate;
      return rest;
    }) };
  },
);

// An entry in words for a dialog or a summary: "Not in school on Fridays".
export function describeAway(project, entry) {
  return awayWords(project.settings, entry, project.dayTypes);
}
