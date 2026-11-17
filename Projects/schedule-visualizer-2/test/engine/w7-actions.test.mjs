// The actions of wish group 7 that are the planner's own (ARCHITECTURE 22.2,
// 22.7, 22.9, 22.10, 22.17): room features, the custom period word, period
// names and when a teacher is not in school; and what removing a feature, a
// period, a day type or a teacher does to every reference to it. Plain Node: no
// clock is read, ids are seeded, and every project is deep-frozen while an
// action runs on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { addFeature, renameFeature, deleteFeature, moveFeature, addCommonFeatures, setRoomFeatures, setPeriodCustom, setPeriodName, setTeacherAway, describeFeatureDelete } from '../../engine/w7-actions.js';
import { createStore } from '../../engine/store.js';
import { COMMON_FEATURES, FEATURES_MOST, AWAY_MOST, roomFeatures } from '../../engine/schema.js';
import { periodName, periodNumberName, periodWordForms } from '../../engine/bells.js';
import { school, ctx, clock, makeIds, room, teacher, assertValid } from './helpers.mjs';

const { ActionError, BUILDING, SCHEDULE } = actions;
const A = 'dsample00a';
const B = 'dsample00b';

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const shared = ctx();

function run(act, project, payload) {
  const after = act(freeze(project), payload, shared);
  assertValid(after, 'the project is still valid after the action');
  return after;
}

function refused(act, project, payload, code) {
  assert.throws(() => act(freeze(project), payload, ctx()), (error) => {
    assert.ok(error instanceof ActionError, 'an ActionError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/, 'the message is a sentence');
    return true;
  });
}

// One store step: the label, the counters the action declares, and undo giving
// back the very project.
function step(project, act, payload, label) {
  const start = freeze(project);
  const store = createStore({ project: start, clock, ids: makeIds(11) });
  store.apply(act, payload);
  assert.equal(store.history.past.length, 1, 'one undo step');
  assert.equal(store.undoLabel, label);
  assertValid(store.project, 'valid after ' + label);
  const after = store.project;
  store.undo();
  assert.deepEqual(store.project, start, 'undo gives back the project as it was');
  return after;
}

const withFeatures = (project, names) => {
  let next = project;
  for (const name of names) next = run(addFeature, next, { name });
  return next;
};

// ---------------------------------------------------------------- features

test('addFeature adds a trimmed name at the end with an "h" id, in one undo step, moving BUILDING', () => {
  const after = step(school(), addFeature, { name: '  Lab ' }, 'Add feature Lab');
  assert.equal(after.building.features.length, 1);
  assert.equal(after.building.features[0].name, 'Lab');
  assert.match(after.building.features[0].id, /^h[a-z0-9]{9}$/);
  assert.deepEqual(addFeature.bumps, [BUILDING]);
  const two = run(addFeature, after, { name: 'Sink' });
  assert.deepEqual(two.building.features.map((feature) => feature.name), ['Lab', 'Sink']);
});

test('addFeature keeps a name as typed: quotes, angle brackets and other scripts', () => {
  const names = ['<b>Lab</b>', 'Sink "deep"', '実験室'];
  const next = withFeatures(school(), names);
  assert.deepEqual(next.building.features.map((feature) => feature.name), names);
});

test('addFeature refuses a blank name, one over 30 characters, a name that is there (any case, any spaces) and the 41st', () => {
  refused(addFeature, school(), { name: '   ' }, 'no-name');
  refused(addFeature, school(), {}, 'no-name');
  refused(addFeature, school(), { name: 'x'.repeat(31) }, 'too-long');
  assert.equal(run(addFeature, school(), { name: 'x'.repeat(30) }).building.features.length, 1, '30 characters is allowed');
  assert.equal(run(addFeature, school(), { name: '実'.repeat(30) }).building.features.length, 1, 'counted in characters, not bytes');
  const lab = run(addFeature, school(), { name: 'Lab' });
  refused(addFeature, lab, { name: ' lab ' }, 'duplicate-name');
  let full = school();
  for (let n = 1; n <= FEATURES_MOST; n += 1) full = run(addFeature, full, { name: 'Feature ' + n });
  assert.equal(full.building.features.length, FEATURES_MOST);
  refused(addFeature, full, { name: 'One more' }, 'limit');
});

test('addFeature takes a free "h" id from the payload and refuses a bad or used one', () => {
  const given = run(addFeature, school(), { name: 'Lab', id: 'hgiven0001' });
  assert.equal(given.building.features[0].id, 'hgiven0001');
  refused(addFeature, given, { name: 'Sink', id: 'hgiven0001' }, 'duplicate-id');
  refused(addFeature, school(), { name: 'Sink', id: 'rsample101' }, 'bad-id');
  refused(addFeature, school(), { name: 'Sink', id: 'hshort' }, 'bad-id');
});

test('renameFeature renames one, refuses a name another has, and the same name changes nothing', () => {
  const start = withFeatures(school(), ['Lab', 'Sink']);
  const [lab, sink] = start.building.features;
  const after = step(start, renameFeature, { id: lab.id, name: 'Science lab' }, 'Rename feature Lab to Science lab');
  assert.deepEqual(after.building.features.map((feature) => feature.name), ['Science lab', 'Sink']);
  refused(renameFeature, start, { id: lab.id, name: 'SINK' }, 'duplicate-name');
  assert.equal(renameFeature(freeze(start), { id: lab.id, name: ' Lab ' }, ctx()), start, 'the same name is no change');
  assert.equal(run(renameFeature, start, { id: sink.id, name: 'sink' }).building.features[1].name, 'sink', 'only the capitals changed: allowed');
  refused(renameFeature, start, { id: 'hnothere00', name: 'X' }, 'missing');
  refused(renameFeature, start, { id: lab.id, name: '' }, 'no-name');
});

test('setRoomFeatures keeps ids once, in the list order, and refuses an id that is not on the list', () => {
  const start = withFeatures(school(), ['Lab', 'Sink', 'Kiln']);
  const [lab, sink, kiln] = start.building.features;
  const roomId = room(start, '101').id;
  const after = step(start, setRoomFeatures, { roomId, featureIds: [kiln.id, lab.id, lab.id] }, 'Change the features of Room 101');
  assert.deepEqual(room(after, '101').featureIds, [lab.id, kiln.id], 'once each, in the list order');
  assert.deepEqual(roomFeatures(after.building, room(after, '101')).map((feature) => feature.name), ['Lab', 'Kiln']);
  assert.deepEqual(setRoomFeatures.bumps, [BUILDING]);
  refused(setRoomFeatures, start, { roomId, featureIds: ['hnothere00'] }, 'missing');
  refused(setRoomFeatures, start, { roomId, featureIds: 'Lab' }, 'bad-value');
  refused(setRoomFeatures, start, { roomId: 'rnothere00', featureIds: [] }, 'missing');
  const cleared = run(setRoomFeatures, after, { roomId, featureIds: [] });
  assert.equal('featureIds' in room(cleared, '101'), false, 'none at all removes the field, as a room that never had one');
  assert.equal(setRoomFeatures(freeze(start), { roomId, featureIds: [] }, ctx()), start, 'none on a room with none is no change');
  void sink;
});

test('setRoomFields takes featureIds with the same rules, and a plain field edit leaves them alone', () => {
  const start = withFeatures(school(), ['Lab', 'Sink']);
  const [lab, sink] = start.building.features;
  const roomId = room(start, '101').id;
  const set = run(actions.setRoomFields, start, { roomId, featureIds: [sink.id, lab.id], wing: 'North' });
  assert.deepEqual(room(set, '101').featureIds, [lab.id, sink.id]);
  assert.equal(room(set, '101').wing, 'North');
  assert.deepEqual(room(run(actions.setRoomFields, set, { roomId, capacity: 20 }), '101').featureIds, [lab.id, sink.id]);
  refused(actions.setRoomFields, start, { roomId, featureIds: ['hnothere00'] }, 'missing');
});

test('clearRoomDetails takes the features off the room too, and keeps the room', () => {
  const start = withFeatures(school(), ['Lab']);
  const roomId = room(start, '101').id;
  const set = run(setRoomFeatures, start, { roomId, featureIds: [start.building.features[0].id] });
  const cleared = run(actions.clearRoomDetails, set, { roomId });
  assert.equal('featureIds' in room(cleared, '103'), false);
  const found = cleared.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === roomId);
  assert.equal(found.number, '');
  assert.equal('featureIds' in found, false);
  assert.equal(cleared.building.features.length, 1, 'the school list keeps the feature');
});

test('deleteFeature takes the feature off every room and says how many, in one undo step', () => {
  const start = withFeatures(school(), ['Lab', 'Sink']);
  const [lab, sink] = start.building.features;
  let project = run(setRoomFeatures, start, { roomId: room(start, '101').id, featureIds: [lab.id, sink.id] });
  project = run(setRoomFeatures, project, { roomId: room(project, '102').id, featureIds: [lab.id] });
  assert.deepEqual(describeFeatureDelete(project, lab.id), { id: lab.id, name: 'Lab', rooms: 2, text: 'Deleted Lab, and took it off 2 rooms' });
  assert.equal(describeFeatureDelete(project, 'hnothere00'), null);
  step(project, deleteFeature, { id: lab.id }, 'Delete feature Lab');
  const after = run(deleteFeature, project, { id: lab.id });
  assert.deepEqual(after.building.features.map((feature) => feature.name), ['Sink']);
  assert.deepEqual(room(after, '101').featureIds, [sink.id]);
  assert.equal('featureIds' in room(after, '102'), false, 'a room left with none has no field');
  assert.equal(actions.scheduleOutcome(after).rooms, 2, 'the entry\'s outcome counts the rooms');
  assert.equal(actions.scheduleOutcome(after).text, 'Deleted Lab, and took it off 2 rooms');
  const one = run(deleteFeature, run(setRoomFeatures, start, { roomId: room(start, '101').id, featureIds: [sink.id] }), { id: sink.id });
  assert.equal(actions.scheduleOutcome(one).text, 'Deleted Sink, and took it off 1 room');
  refused(deleteFeature, start, { id: 'hnothere00' }, 'missing');
});

test('moveFeature reorders the list and every room\'s own list follows it', () => {
  const start = withFeatures(school(), ['Lab', 'Sink', 'Kiln']);
  const [lab, sink, kiln] = start.building.features;
  const project = run(setRoomFeatures, start, { roomId: room(start, '101').id, featureIds: [lab.id, kiln.id] });
  const after = step(project, moveFeature, { id: kiln.id, toIndex: 0 }, 'Move feature Kiln');
  assert.deepEqual(after.building.features.map((feature) => feature.name), ['Kiln', 'Lab', 'Sink']);
  assert.deepEqual(room(after, '101').featureIds, [kiln.id, lab.id]);
  assert.equal(moveFeature(freeze(project), { id: lab.id, toIndex: 0 }, ctx()), project, 'where it already is: no change');
  assert.equal(run(moveFeature, project, { id: lab.id, toIndex: 99 }).building.features[2].id, lab.id, 'past the end is the end');
  refused(moveFeature, project, { id: 'hnothere00', toIndex: 0 }, 'missing');
  refused(moveFeature, project, { id: lab.id, toIndex: 'first' }, 'bad-value');
  void sink;
});

test('addCommonFeatures adds those the list lacks, by name, in order, and refuses when none is new or the list would pass 40', () => {
  const after = step(school(), addCommonFeatures, {}, 'Add the common features');
  assert.deepEqual(after.building.features.map((feature) => feature.name), COMMON_FEATURES);
  refused(addCommonFeatures, after, {}, 'nothing-to-do');
  const some = withFeatures(school(), [' lab ', 'KILN']);
  const rest = run(addCommonFeatures, some, {});
  assert.deepEqual(rest.building.features.map((feature) => feature.name), [' lab '.trim(), 'KILN'].concat(COMMON_FEATURES.filter((name) => !['Lab', 'Kiln'].includes(name))));
  const chosen = run(addCommonFeatures, school(), { names: ['Stage', 'Sink'] });
  assert.deepEqual(chosen.building.features.map((feature) => feature.name), ['Sink', 'Stage'], 'COMMON_FEATURES\' order, not the choice\'s');
  refused(addCommonFeatures, school(), { names: ['Moat'] }, 'bad-value');
  let nearly = school();
  for (let n = 1; n <= FEATURES_MOST - 2; n += 1) nearly = run(addFeature, nearly, { name: 'Feature ' + n });
  refused(addCommonFeatures, nearly, {}, 'limit');
  assert.equal(run(addCommonFeatures, nearly, { names: ['Lab', 'Sink'] }).building.features.length, FEATURES_MOST);
});

// ---------------------------------------------------------------- the period word and names

test('setPeriodCustom sets the word, its plural and how the periods count, and null goes back, each in one undo step', () => {
  const after = step(school(), setPeriodCustom, { word: ' Lesson ', count: 'number' }, 'Use Lesson as the period word');
  assert.deepEqual(after.settings.periodCustom, { word: 'Lesson', plural: 'Lessons', count: 'number' }, 'trimmed; the plural defaults to the word and an s');
  assert.deepEqual(periodWordForms(after.settings), { one: 'Lesson', many: 'Lessons', oneLower: 'Lesson', manyLower: 'Lessons', count: 'number' });
  assert.equal(periodNumberName(after.settings, 2), 'Lesson 3');
  assert.deepEqual(setPeriodCustom.bumps, [SCHEDULE]);
  assert.equal(after.settings.periodWord, school().settings.periodWord, 'periodWord keeps its value');
  const classes = run(setPeriodCustom, after, { word: 'Class', plural: 'Classes', count: 'letter' });
  assert.equal(periodNumberName(classes.settings, 2), 'Class C');
  assert.equal(periodWordForms(classes.settings).many, 'Classes');
  assert.equal(setPeriodCustom(freeze(classes), { word: 'Class', plural: 'Classes', count: 'letter' }, ctx()), classes, 'the same again is no change');
  const back = step(classes, setPeriodCustom, null, 'Go back to the period word of the settings');
  assert.equal('periodCustom' in back.settings, false);
  const plain = freeze(school());
  assert.equal(setPeriodCustom(plain, null, ctx()), plain, 'null with none set is no change');
});

test('setPeriodCustom refuses a blank word, one over 16 characters, a bad count, and keeps a word as typed', () => {
  refused(setPeriodCustom, school(), { word: ' ', count: 'number' }, 'no-name');
  refused(setPeriodCustom, school(), { word: 'x'.repeat(17), count: 'number' }, 'too-long');
  refused(setPeriodCustom, school(), { word: 'Class', plural: 'y'.repeat(17), count: 'number' }, 'too-long');
  refused(setPeriodCustom, school(), { word: 'Class', count: 'roman' }, 'bad-value');
  refused(setPeriodCustom, school(), 'Class', 'bad-value');
  const typed = run(setPeriodCustom, school(), { word: '<i>Slot</i>', plural: 'Slots "all"', count: 'ordinal' });
  assert.equal(typed.settings.periodCustom.word, '<i>Slot</i>');
  assert.equal(periodNumberName(typed.settings, 0), '1st <i>Slot</i>');
  assert.equal(run(setPeriodCustom, school(), { word: 'Class' }).settings.periodCustom.count, 'number', 'count left out is number');
});

test('setPeriodName names a period, "" clears it, and the screens\' words follow', () => {
  const after = step(school(), setPeriodName, { period: 2, name: ' Advisory ' }, 'Name Period 3 Advisory');
  assert.deepEqual(after.settings.periodNames, ['', '', 'Advisory']);
  assert.equal(periodName(after.settings, 2), 'Advisory');
  assert.equal(periodNumberName(after.settings, 2), 'Period 3');
  assert.deepEqual(setPeriodName.bumps, [SCHEDULE]);
  const both = run(setPeriodName, after, { period: 4, name: 'Lunch' });
  assert.deepEqual(both.settings.periodNames, ['', '', 'Advisory', '', 'Lunch']);
  step(both, setPeriodName, { period: 4, name: '' }, 'Clear the name of Period 5');
  const one = run(setPeriodName, both, { period: 4, name: '' });
  assert.deepEqual(one.settings.periodNames, ['', '', 'Advisory'], 'trailing empty names are dropped');
  assert.equal('periodNames' in run(setPeriodName, one, { period: 2, name: '' }).settings, false, 'no names left: the field is gone');
  assert.equal(setPeriodName(freeze(both), { period: 2, name: 'Advisory' }, ctx()), both, 'the same name is no change');
  const plain = freeze(school());
  assert.equal(setPeriodName(plain, { period: 2, name: '' }, ctx()), plain, 'clearing a name there is not is no change');
});

test('setPeriodName refuses a bare number, any period\'s number name, a name over 24 characters and a period not in the day', () => {
  refused(setPeriodName, school(), { period: 0, name: '5' }, 'bad-name');
  refused(setPeriodName, school(), { period: 0, name: ' 12 ' }, 'bad-name');
  refused(setPeriodName, school(), { period: 0, name: 'Period 5' }, 'bad-name');
  refused(setPeriodName, school(), { period: 0, name: 'period5' }, 'bad-name');
  refused(setPeriodName, school(), { period: 2, name: 'Period 3' }, 'bad-name');
  refused(setPeriodName, school(), { period: 0, name: 'x'.repeat(25) }, 'too-long');
  assert.equal(run(setPeriodName, school(), { period: 0, name: 'x'.repeat(24) }).settings.periodNames[0].length, 24);
  refused(setPeriodName, school(), { period: 8, name: 'Lunch' }, 'bad-value');
  refused(setPeriodName, school(), { period: -1, name: 'Lunch' }, 'bad-value');
  refused(setPeriodName, school(), { period: 1.5, name: 'Lunch' }, 'bad-value');
  refused(setPeriodName, school(), { period: 0, name: 7 }, 'bad-value');
  const lessons = run(setPeriodCustom, school(), { word: 'Lesson', count: 'letter' });
  refused(setPeriodName, lessons, { period: 0, name: 'Lesson C' }, 'bad-name');
  assert.equal(run(setPeriodName, lessons, { period: 0, name: 'Period 3' }).settings.periodNames[0], 'Period 3', 'Period 3 is only a number name while the word is Period');
  const typed = run(setPeriodName, school(), { period: 0, name: '<b>"Ho"</b>' });
  assert.equal(typed.settings.periodNames[0], '<b>"Ho"</b>');
});

test('a period name another period has is allowed and warned of in the summary, once, naming the name', () => {
  const lunch = run(setPeriodName, school(), { period: 4, name: 'Lunch' });
  assert.equal(actions.scheduleOutcome(lunch), null, 'a first use says nothing');
  const twice = run(setPeriodName, lunch, { period: 5, name: ' lunch ' });
  assert.deepEqual(twice.settings.periodNames.slice(4), ['Lunch', 'lunch']);
  assert.deepEqual(actions.scheduleOutcome(twice), { duplicate: true, text: 'Two periods are named lunch; imports match them by number.' });
});

// ---------------------------------------------------------------- away

const HALLORAN = 'tsample001';
const entry = (extra) => ({ dayTypeIds: [], weekdays: [], periods: [], ...extra });

test('setTeacherAway stores entries sorted and deduplicated, one undo step, and [] removes the field', () => {
  const start = school();
  const after = step(start, setTeacherAway, { teacherId: HALLORAN, away: [entry({ weekdays: [4, 4, 1], periods: [7, 6, 6] }), entry({ dayTypeIds: [B] })] }, 'Change when Ms. Halloran is not in school');
  assert.deepEqual(teacher(after, 'Ms. Halloran').away, [{ dayTypeIds: [], weekdays: [1, 4], periods: [6, 7] }, { dayTypeIds: [B], weekdays: [], periods: [] }]);
  assert.deepEqual(setTeacherAway.bumps, [BUILDING, SCHEDULE]);
  assert.equal(setTeacherAway(freeze(after), { teacherId: HALLORAN, away: after.teachers[0].away }, ctx()), after, 'the same list is no change');
  const none = run(setTeacherAway, after, { teacherId: HALLORAN, away: [] });
  assert.equal('away' in teacher(none, 'Ms. Halloran'), false);
  assert.equal(setTeacherAway(freeze(start), { teacherId: HALLORAN, away: [] }, ctx()), start);
});

test('setTeacherAway refuses a whole-day every-day entry, in either form of "every day", with the sentence', () => {
  const sentence = 'A teacher who is never in school is not a teacher of this school; remove them instead.';
  assert.throws(() => setTeacherAway(freeze(school()), { teacherId: HALLORAN, away: [entry()] }, ctx()), new RegExp(sentence.replace(/[.;]/g, '\\$&')));
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry()] }, 'never-in-school');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ dayTypeIds: [A, B] })] }, 'never-in-school');
  for (const allowed of [entry({ dayTypeIds: [B] }), entry({ weekdays: [4] }), entry({ periods: [0] }), entry({ dayTypeIds: [A, B], periods: [0] })]) {
    assert.equal(run(setTeacherAway, school(), { teacherId: HALLORAN, away: [allowed] }).teachers[0].away.length, 1);
  }
});

test('setTeacherAway allows at most 12 entries, and refuses a bad teacher, day type, weekday, period or shape', () => {
  const many = (n) => Array.from({ length: n }, (unused, at) => entry({ periods: [at % 8], weekdays: [at % 7] }));
  assert.equal(run(setTeacherAway, school(), { teacherId: HALLORAN, away: many(AWAY_MOST) }).teachers[0].away.length, AWAY_MOST);
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: many(AWAY_MOST + 1) }, 'limit');
  refused(setTeacherAway, school(), { teacherId: 'tnothere00', away: [] }, 'missing');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ dayTypeIds: ['dnothere00'] })] }, 'missing');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ weekdays: [7] })] }, 'bad-value');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ periods: [8] })] }, 'bad-value');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ periods: [0.5] })] }, 'bad-value');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [entry({ periods: 'all' })] }, 'bad-value');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: [null] }, 'bad-value');
  refused(setTeacherAway, school(), { teacherId: HALLORAN, away: 'Fridays' }, 'bad-value');
});

// ---------------------------------------------------------------- what removing things does to every reference

function withAway(project, away) {
  return run(setTeacherAway, project, { teacherId: HALLORAN, away });
}

test('setPeriods trims period names and away periods; an entry whose periods all fall past the end is dropped, never left as the whole day', () => {
  let project = run(setPeriodName, school(), { period: 6, name: 'Study' });
  project = run(setPeriodName, project, { period: 1, name: 'Advisory' });
  project = withAway(project, [entry({ periods: [6, 7] }), entry({ periods: [2, 7] }), entry({ weekdays: [4] }), entry({ dayTypeIds: [B], periods: [7] })]);
  const less = run(actions.setPeriods, project, { periods: 6 });
  assert.deepEqual(less.settings.periodNames, ['', 'Advisory'], 'names past the end go');
  assert.deepEqual(teacher(less, 'Ms. Halloran').away, [entry({ periods: [2] }), entry({ weekdays: [4] })], 'trimmed; the all-past entries are dropped; a whole-day entry stays');
  const store = createStore({ project: freeze(project), clock, ids: makeIds(2) });
  store.apply(actions.setPeriods, { periods: 6 });
  store.undo();
  assert.deepEqual(store.project, project, 'undo brings the names and the entries back');
  const more = run(actions.setPeriods, project, { periods: 10 });
  assert.deepEqual(more.settings.periodNames, project.settings.periodNames, 'raising the count deletes nothing');
  assert.deepEqual(teacher(more, 'Ms. Halloran').away, teacher(project, 'Ms. Halloran').away);
  const gone = run(actions.setPeriods, withAway(school(), [entry({ periods: [7] })]), { periods: 4 });
  assert.equal('away' in teacher(gone, 'Ms. Halloran'), false, 'a teacher left with no entry has no field');
});

test('describePeriodChange counts the names and the away entries that go, and says so', () => {
  let project = run(setPeriodName, school(), { period: 6, name: 'Study' });
  project = run(setPeriodName, project, { period: 7, name: 'Club' });
  project = withAway(project, [entry({ periods: [6, 7] }), entry({ periods: [2, 7] })]);
  const plain = actions.describePeriodChange(school(), 6);
  assert.equal('periodNames' in plain, false);
  assert.equal('away' in plain, false);
  const said = actions.describePeriodChange(project, 6);
  assert.equal(said.periodNames, 2);
  assert.equal(said.away, 1, 'the entry that is only trimmed is not lost');
  assert.deepEqual(said.marksAndDutiesWords, ['2 period names', '1 not-in-school entry']);
  assert.equal(said.losesData, true);
  const onlyNames = actions.describePeriodChange(run(setPeriodName, school(), { period: 7, name: 'Club' }), 6);
  assert.equal(onlyNames.losesData, true, 'a name alone is something to say');
  assert.equal(actions.describePeriodChange(project, 8).losesData, false, 'no change, nothing lost');
});

test('deleteDayType takes the day type out of every away entry; an entry left with none it had is dropped, never widened', () => {
  let project = run(actions.addDayType, school(), { name: 'Testing Day', own: true });
  const testing = project.dayTypes[project.dayTypes.length - 1].id;
  project = withAway(project, [entry({ dayTypeIds: [testing] }), entry({ dayTypeIds: [B, testing], periods: [1] }), entry({ dayTypeIds: [A], weekdays: [0] }), entry({ weekdays: [4] })]);
  const described = actions.describeDayTypeDelete(project, testing);
  assert.equal(described.away, 1);
  assert.match(described.text, /1 not-in-school entry/);
  const after = run(actions.deleteDayType, project, { dayTypeId: testing });
  assert.deepEqual(teacher(after, 'Ms. Halloran').away, [entry({ dayTypeIds: [B], periods: [1] }), entry({ dayTypeIds: [A], weekdays: [0] }), entry({ weekdays: [4] })]);
});

test('mergeTeachers keeps the kept teacher\'s away entries and adds the merged one\'s, once each; written only when either had some', () => {
  const keep = HALLORAN;
  const gone = 'tsample002';
  let project = run(setTeacherAway, school(), { teacherId: keep, away: [entry({ weekdays: [4] }), entry({ periods: [7] })] });
  project = run(setTeacherAway, project, { teacherId: gone, away: [entry({ periods: [7] }), entry({ dayTypeIds: [B] })] });
  const merged = run(actions.mergeTeachers, project, { keepId: keep, mergeId: gone });
  assert.deepEqual(teacher(merged, 'Ms. Halloran').away, [entry({ weekdays: [4] }), entry({ periods: [7] }), entry({ dayTypeIds: [B] })]);
  const reverse = run(actions.mergeTeachers, project, { keepId: gone, mergeId: keep });
  assert.equal(reverse.teachers.find((one) => one.id === gone).away.length, 3);
  const neither = run(actions.mergeTeachers, school(), { keepId: keep, mergeId: gone });
  assert.equal('away' in neither.teachers.find((one) => one.id === keep), false, 'no away on either: no field');
  const onlyGone = run(actions.mergeTeachers, run(setTeacherAway, school(), { teacherId: gone, away: [entry({ weekdays: [0] })] }), { keepId: keep, mergeId: gone });
  assert.deepEqual(onlyGone.teachers.find((one) => one.id === keep).away, [entry({ weekdays: [0] })]);
});
