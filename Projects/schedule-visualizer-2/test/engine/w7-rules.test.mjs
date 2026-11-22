// W7's rule functions in the modules a published file carries (ARCHITECTURE
// 22.3, 22.4, 22.7, 22.10, 22.17): period words and names, a room's features,
// stairwells and their letter, who is away, and directions through a
// stairwell. Every function reads an absent or malformed new field as its
// default, because the staff browser never runs repair. The clock and the
// zone are never read: dates are plain strings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FEATURES_MOST, FEATURE_NAME_MOST, COMMON_FEATURES, PERIOD_COUNTS, PERIOD_WORD_MOST, PERIOD_NAME_MOST, AWAY_MOST, WELL_MOST, DEAD_END_CELLS, DEAD_END_METRES,
  newRoom, newProject, roomFeatures, stairwells, stairsLetter, nextConnectionLabel, defaultSettings,
} from '../../engine/schema.js';
import { periodWordForms, periodName, periodNumberName, periodLabel } from '../../engine/bells.js';
import { periodWord } from '../../engine/findings.js';
import { awayFor, awayEntries } from '../../engine/marks.js';
import { teacherDays, teacherDay, isFree, awayWords } from '../../engine/teacher-day.js';
import { buildGraph } from '../../engine/graph.js';
import { route, routingGraph } from '../../engine/routing.js';
import { directions } from '../../engine/directions.js';
import { publishedModel } from '../../engine/publish-data.js';
import { openSchool, letterOfStairs, oneWayGroups } from '../../staff/model.js';
import { routeFloors, routeCrossings, floorIsPassed } from '../../staff/views/directions.js';
import { oneWayStairs } from '../../staff/views/map.js';
import { sampleSchool } from '../../data/sample-school.js';
import { school, clone, makeIds, clock } from './helpers.mjs';
import { planProject, threeFloors, roomId, cellAt } from '../fixtures/buildings/plans.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const C = 'dsample00c';
const MONDAY = '2026-09-07';
const FRIDAY = '2026-09-11';
const HALLORAN = 'tsample001';

// ---------------------------------------------------------------- constants

test('the W7 constants are the numbers the design fixes', () => {
  assert.equal(FEATURES_MOST, 40);
  assert.equal(FEATURE_NAME_MOST, 30);
  assert.deepEqual(COMMON_FEATURES, ['Lab', 'Sink', 'Projector', 'Computers', 'Stage', 'Kiln', 'Ovens', 'Studio sound']);
  assert.deepEqual(PERIOD_COUNTS, ['number', 'letter', 'ordinal']);
  assert.equal(PERIOD_WORD_MOST, 16);
  assert.equal(PERIOD_NAME_MOST, 24);
  assert.equal(AWAY_MOST, 12);
  assert.equal(WELL_MOST, 8);
  assert.equal(DEAD_END_CELLS, 6);
  assert.equal(DEAD_END_METRES, 6.1);
});

test('newRoom gives featureIds only when asked, so the sample and newProject are byte for byte as they were', () => {
  assert.equal('featureIds' in newRoom('r1', [1, 2]), false);
  assert.deepEqual(newRoom('r1', [1, 2], []).featureIds, []);
  const given = ['h1'];
  const room = newRoom('r1', [1], given);
  assert.deepEqual(room.featureIds, ['h1']);
  assert.notEqual(room.featureIds, given, 'the list is the room\'s own');
  const sample = sampleSchool();
  const everyRoom = sample.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room');
  assert.ok(everyRoom.length > 0 && everyRoom.every((space) => !('featureIds' in space)), 'the sample has no featureIds');
  assert.equal('features' in sample.building, false);
  assert.equal('periodCustom' in sample.settings || 'periodNames' in sample.settings, false);
  const fresh = newProject(makeIds(), clock);
  assert.equal('features' in fresh.building || 'periodCustom' in fresh.settings || 'periodNames' in fresh.settings, false);
});

// ---------------------------------------------------------------- period words

const settingsWith = (extra) => ({ ...defaultSettings(), ...extra });
const names = (settings, from, to, fn) => Array.from({ length: to - from }, (_, i) => fn(settings, from + i));

test('the four built-in words name their periods as they always did', () => {
  assert.deepEqual(names(settingsWith({}), 0, 3, periodName), ['Period 1', 'Period 2', 'Period 3']);
  assert.deepEqual(names(settingsWith({ periodWord: 'Mod' }), 0, 2, periodName), ['Mod 1', 'Mod 2']);
  assert.deepEqual(names(settingsWith({ periodWord: 'Block' }), 0, 3, periodName), ['Block A', 'Block B', 'Block C']);
  assert.equal(periodName(settingsWith({ periodWord: 'Block' }), 26), 'Block AA');
  assert.deepEqual(names(settingsWith({ periodWord: 'Hour' }), 0, 4, periodName), ['1st Hour', '2nd Hour', '3rd Hour', '4th Hour']);
  assert.equal(periodName(settingsWith({ periodWord: 'Hour' }), 10), '11th Hour');
  assert.deepEqual(names(settingsWith({ periodWord: 'Block' }), 0, 3, periodLabel), ['A', 'B', 'C']);
  assert.deepEqual(names(settingsWith({ periodWord: 'Hour' }), 0, 3, periodLabel), ['1st', '2nd', '3rd']);
  assert.deepEqual(periodWordForms(settingsWith({ periodWord: 'Block' })), { one: 'Block', many: 'Blocks', oneLower: 'block', manyLower: 'blocks', count: 'letter' });
  assert.deepEqual(periodWordForms(settingsWith({ periodWord: 'Hour' })), { one: 'Hour', many: 'Hours', oneLower: 'hour', manyLower: 'hours', count: 'ordinal' });
  assert.deepEqual(periodWordForms(settingsWith({})), { one: 'Period', many: 'Periods', oneLower: 'period', manyLower: 'periods', count: 'number' });
});

test('a custom word counting by number, letter and ordinal, as typed', () => {
  const number = settingsWith({ periodCustom: { word: 'Lesson', count: 'number', plural: 'Lessons' } });
  assert.deepEqual(periodWordForms(number), { one: 'Lesson', many: 'Lessons', oneLower: 'Lesson', manyLower: 'Lessons', count: 'number' });
  assert.deepEqual(names(number, 0, 3, periodName), ['Lesson 1', 'Lesson 2', 'Lesson 3']);
  assert.deepEqual(names(number, 0, 3, periodLabel), ['1', '2', '3']);
  const letter = settingsWith({ periodCustom: { word: 'Lesson', count: 'letter', plural: 'Lessons' } });
  assert.deepEqual(names(letter, 0, 3, periodName), ['Lesson A', 'Lesson B', 'Lesson C']);
  assert.deepEqual(names(letter, 0, 3, periodLabel), ['A', 'B', 'C']);
  const ordinal = settingsWith({ periodCustom: { word: 'Lesson', count: 'ordinal', plural: 'Lessons' } });
  assert.deepEqual(names(ordinal, 0, 4, periodName), ['1st Lesson', '2nd Lesson', '3rd Lesson', '4th Lesson']);
  assert.deepEqual(names(ordinal, 0, 3, periodLabel), ['1st', '2nd', '3rd']);
});

test('a custom word wins over periodWord, which keeps its value; the word is used as typed in every form', () => {
  const settings = settingsWith({ periodWord: 'Block', periodCustom: { word: 'Class', count: 'number', plural: 'Classes' } });
  assert.equal(settings.periodWord, 'Block');
  assert.equal(periodName(settings, 1), 'Class 2');
  assert.equal(periodWord(settings, false), 'Class', 'findings.periodWord delegates: the singular as typed');
  assert.equal(periodWord(settings, true), 'Classes', 'and the plural as typed, not the word and an s');
  assert.equal(periodWord(settingsWith({ periodWord: 'Mod' }), true), 'mods', 'a built-in word still reads lower-case');
  assert.equal(periodWord(settingsWith({ periodWord: 'Mod' }), false), 'mod');
});

test('the plural of a custom word is its own, defaulting to the word and an s', () => {
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: 'Class', count: 'number' } })).many, 'Classs', 'no plural typed: the word and an s');
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: 'Class', count: 'number', plural: '  ' } })).many, 'Classs');
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: 'Class', count: 'number', plural: 'Classes' } })).many, 'Classes');
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: 'Session', count: 'number', plural: 'Sessions' } })).manyLower, 'Sessions');
});

test('names: a period\'s own name wins, else the number name; periodNumberName never takes the name', () => {
  const settings = settingsWith({ periodNames: ['', '', 'Advisory', '', 'Lunch'] });
  assert.equal(periodName(settings, 0), 'Period 1');
  assert.equal(periodName(settings, 2), 'Advisory');
  assert.equal(periodName(settings, 4), 'Lunch');
  assert.equal(periodName(settings, 7), 'Period 8', 'an index past the list has no name');
  assert.equal(periodNumberName(settings, 2), 'Period 3');
  assert.equal(periodNumberName(settingsWith({ periodWord: 'Hour', periodNames: ['Homeroom'] }), 0), '1st Hour');
  const custom = settingsWith({ periodCustom: { word: 'Lesson', count: 'letter', plural: 'Lessons' }, periodNames: ['', 'Choir'] });
  assert.equal(periodName(custom, 0), 'Lesson A');
  assert.equal(periodName(custom, 1), 'Choir');
  assert.equal(periodNumberName(custom, 1), 'Lesson B');
  assert.equal(periodName(settingsWith({ periodNames: ['  <b>Art</b> & Co '] }), 0), '<b>Art</b> & Co', 'a name comes back as typed, trimmed');
  assert.equal(periodName(settingsWith({ periodNames: ['   '] }), 0), 'Period 1', 'a blank name is no name');
});

test('absent or malformed word and name fields read as today\'s words', () => {
  const plain = settingsWith({});
  for (const bad of [null, undefined, 5, 'Lesson', [], { word: '' }, { word: '   ', count: 'number' }, { word: 7 }, { count: 'letter' }]) {
    const settings = settingsWith({ periodCustom: bad });
    assert.equal(periodName(settings, 2), 'Period 3', 'periodCustom ' + JSON.stringify(bad));
    assert.deepEqual(periodWordForms(settings), periodWordForms(plain));
  }
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: 'Class', count: 'sideways' } })).count, 'number', 'an unknown count is a number');
  for (const bad of [null, 'Advisory', 4, {}, [null, 3, {}, ['x']]]) {
    assert.equal(periodName(settingsWith({ periodNames: bad }), 1), 'Period 2', 'periodNames ' + JSON.stringify(bad));
  }
  assert.equal(periodName({}, 0), 'Period 1', 'settings with no period fields at all');
  assert.equal(periodName(settingsWith({ periodWord: 'Nonsense' }), 0), 'Period 1', 'a word outside the four is read as Period, as it always was');
  assert.equal(periodWordForms(settingsWith({ periodWord: 7 })).one, 'Period');
});

// ---------------------------------------------------------------- features

test('roomFeatures: the names in the list\'s order, unknown ids skipped, each once', () => {
  const building = { features: [{ id: 'h1', name: 'Lab' }, { id: 'h2', name: 'Sink' }, { id: 'h3', name: 'Kiln' }] };
  assert.deepEqual(roomFeatures(building, { featureIds: ['h3', 'h1'] }), [{ id: 'h1', name: 'Lab' }, { id: 'h3', name: 'Kiln' }]);
  assert.deepEqual(roomFeatures(building, { featureIds: ['h2', 'hgone', 'h2'] }), [{ id: 'h2', name: 'Sink' }]);
  assert.deepEqual(roomFeatures(building, { featureIds: [] }), []);
});

test('roomFeatures reads an absent or malformed field as none', () => {
  const building = { features: [{ id: 'h1', name: 'Lab' }] };
  for (const room of [null, undefined, {}, { featureIds: null }, { featureIds: 'h1' }, { featureIds: [4, null, {}] }]) assert.deepEqual(roomFeatures(building, room), []);
  for (const bad of [null, undefined, {}, { features: null }, { features: 'Lab' }, { features: [null, 4, { id: 'h1' }, { name: 'Lab' }] }]) assert.deepEqual(roomFeatures(bad, { featureIds: ['h1'] }), []);
});

// ---------------------------------------------------------------- stairwells

// Floors 1, 2 and 3 with stairs at column 0 of row 2; flights A (1 to 2) and
// B (2 to 3), each given the well letter W.
function well(change) {
  const project = threeFloors();
  for (const connection of project.building.connections) connection.well = 'W';
  if (change) change(project);
  return project;
}

test('a well of three stops: the letter, the flights, the stops by level', () => {
  const project = well();
  const found = stairwells(project.building);
  assert.equal(found.length, 1);
  assert.equal(found[0].letter, 'W');
  assert.deepEqual(found[0].connectionIds, ['cplan00001', 'cplan00002']);
  assert.equal(found[0].parts, 1);
  assert.deepEqual(found[0].stops.map((stop) => [stop.floorId, stop.cell, stop.level]), [
    ['fplan00001', cellAt(project, 1, 0, 2), 1], ['fplan00002', cellAt(project, 2, 0, 2), 2], ['fplan00003', cellAt(project, 3, 0, 2), 3],
  ]);
});

test('stops come out lowest level first even when the flights are stored the other way round', () => {
  const project = well((built) => {
    built.building.connections.reverse();
    for (const connection of built.building.connections) [connection.a, connection.b] = [connection.b, connection.a];
  });
  assert.deepEqual(stairwells(project.building)[0].stops.map((stop) => stop.level), [1, 2, 3]);
  assert.equal(stairwells(project.building)[0].parts, 1);
});

test('a well in two parts: an older planner pulled the middle flight out of a four-floor well', () => {
  const floor = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  const project = planProject([floor, floor, floor, floor], { connections: [[1, 0, 2, 2, 0, 2], [2, 0, 2, 3, 0, 2], [3, 0, 2, 4, 0, 2]] });
  for (const connection of project.building.connections) connection.well = 'W';
  assert.equal(stairwells(project.building)[0].parts, 1);
  project.building.connections.splice(1, 1);
  const found = stairwells(project.building);
  assert.equal(found.length, 1, 'still one letter');
  assert.equal(found[0].parts, 2, 'two groups of flights that share no cell');
  assert.equal(found[0].stops.length, 4);
});

test('letters are compared by name: "w" and " W " are one well; an elevator and a plain flight are never in one', () => {
  const project = well((built) => { built.building.connections[1].well = ' w '; });
  const found = stairwells(project.building);
  assert.equal(found.length, 1);
  assert.equal(found[0].connectionIds.length, 2);
  const withLift = well((built) => {
    built.building.connections.push({ id: 'clift00001', label: 'D', kind: 'elevator', car: 'D', well: 'W', a: built.building.connections[0].a, b: built.building.connections[1].b, direction: 'both' });
  });
  assert.deepEqual(stairwells(withLift.building)[0].connectionIds, ['cplan00001', 'cplan00002'], 'an elevator carries no well');
  const plain = threeFloors();
  assert.deepEqual(stairwells(plain.building), [], 'plain flights are no stairwell');
});

test('stairwells reads an absent or malformed field as none', () => {
  for (const bad of [null, undefined, {}, { floors: null }, { floors: [], connections: 'x' }, { floors: [], connections: [null, 4, {}] }]) assert.deepEqual(stairwells(bad), []);
  const project = well((built) => {
    built.building.connections[0].well = '';
    built.building.connections[1].well = 4;
  });
  assert.deepEqual(stairwells(project.building), []);
  const noEnds = well((built) => { built.building.connections[0].a = null; });
  assert.equal(stairwells(noEnds.building)[0].connectionIds.length, 1, 'a flight with no ends is not a stop');
});

test('stairsLetter: the well when set, else the label; malformed is the label', () => {
  assert.equal(stairsLetter({ label: 'A' }), 'A');
  assert.equal(stairsLetter({ label: 'A', well: 'W' }), 'W');
  assert.equal(stairsLetter({ label: 'A', well: '' }), 'A');
  assert.equal(stairsLetter({ label: 'A', well: '  ' }), 'A');
  assert.equal(stairsLetter({ label: 'A', well: 3 }), 'A');
  assert.equal(stairsLetter({ well: 'W' }), 'W');
  assert.equal(stairsLetter({}), '');
  assert.equal(stairsLetter(null), '');
  assert.equal(stairsLetter(undefined), '');
});

test('nextConnectionLabel takes well letters too: no plain flight takes a letter a well shows', () => {
  assert.equal(nextConnectionLabel([]), 'A');
  assert.equal(nextConnectionLabel([{ label: 'A' }, { label: 'B' }]), 'C');
  assert.equal(nextConnectionLabel([{ label: 'A', well: 'B' }]), 'C', 'A is a label and B is a well');
  assert.equal(nextConnectionLabel([{ label: 'A', well: 'C' }, { label: 'B', well: 'C' }]), 'D');
  assert.equal(nextConnectionLabel([{ label: 'A', well: ' b ' }]), 'C', 'wells compare by name');
  assert.equal(nextConnectionLabel([{ label: 'A', well: 'Stair 1' }]), 'B', 'a well that is not a letter takes none');
  assert.equal(nextConnectionLabel([{ label: 'X' }, { label: 'A', car: 'B' }]), 'B', 'today\'s answer for a car letter passed as a label stays');
});

test('graph links are named by stairsLetter', () => {
  const project = well();
  const graph = buildGraph(project);
  assert.deepEqual(graph.links.map((link) => link.label), ['W', 'W']);
  assert.deepEqual(buildGraph(threeFloors()).links.map((link) => link.label), ['A', 'B']);
});

test('directions through a well of three flights say one letter, once', () => {
  const said = (project) => directions(project, route(routingGraph(project), roomId('1A'), roomId('3A')));
  const plain = said(threeFloors());
  assert.equal(plain.ok, true);
  assert.ok(plain.steps.some((step) => step.text === 'Take stairs A, then stairs B up to Floor 3.'), plain.text);
  const through = said(well());
  assert.equal(through.ok, true);
  const stairs = through.steps.filter((step) => step.kind === 'stairs');
  assert.equal(stairs.length, 1);
  assert.equal(stairs[0].text, 'Take stairs W up to Floor 3.');
  assert.deepEqual(stairs[0].labels, ['W']);
  assert.deepEqual(stairs[0].connections, ['cplan00001', 'cplan00002'], 'both flights are still taken');
  assert.ok(through.steps.some((step) => step.text === 'Walk 1 cell to stairs W.'), 'the walk to the stairs names the letter');
});

test('directions where one flight is a well and the next a plain flight keep both letters', () => {
  const project = threeFloors();
  project.building.connections[0].well = 'W';
  const said = directions(project, route(routingGraph(project), roomId('1A'), roomId('3A')));
  assert.ok(said.steps.some((step) => step.text === 'Take stairs W, then stairs B up to Floor 3.'), said.text);
});

// ---------------------------------------------------------------- away

const entry = (extra) => ({ dayTypeIds: [], weekdays: [], periods: [], ...extra });
const teacherOf = (away) => ({ id: 't1', away });

test('away always: no day types, weekdays or periods named holds on every day type, date or none', () => {
  const teacher = teacherOf([entry({})]);
  assert.ok(awayFor(teacher, A, 0, {}));
  assert.ok(awayFor(teacher, B, 7, { date: MONDAY }));
  assert.equal(awayFor(teacher, A, 0), awayFor(teacher, A, 0, {}), 'options are optional');
});

test('away on named day types and periods, and on a day type that is the same as one named', () => {
  const project = school();
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
  const teacher = teacherOf([entry({ dayTypeIds: [A], periods: [4, 5, 6, 7] })]);
  assert.ok(awayFor(teacher, A, 4, { project }));
  assert.equal(awayFor(teacher, A, 3, { project }), null, 'a period it does not name');
  assert.equal(awayFor(teacher, B, 5, { project }), null, 'a day type it does not name');
  assert.ok(awayFor(teacher, C, 5, { project }), 'C Day is the same as A Day');
  assert.equal(awayFor(teacher, C, 5), null, 'without the project the sameness cannot be followed');
});

test('away sometimes: a weekdays-only entry holds only on a date that falls on one of them', () => {
  const teacher = teacherOf([entry({ weekdays: [4] })]);
  assert.equal(awayFor(teacher, A, 2), null, 'no date: listed, not taking the period');
  assert.equal(awayFor(teacher, A, 2, { date: MONDAY }), null);
  assert.ok(awayFor(teacher, A, 2, { date: FRIDAY }));
  assert.equal(awayFor(teacher, A, 2, { date: 'next Friday' }), null, 'a malformed date matches nothing');
  const mixed = teacherOf([entry({ weekdays: [4], periods: [6, 7] })]);
  assert.ok(awayFor(mixed, A, 7, { date: FRIDAY }));
  assert.equal(awayFor(mixed, A, 5, { date: FRIDAY }), null);
});

test('away reads absent or malformed entries as not there, and returns the first that holds', () => {
  for (const away of [undefined, null, 'Fridays', [], [null, 4, 'x', []]]) assert.equal(awayFor({ away }, A, 0, {}), null, JSON.stringify(away));
  const garbled = { dayTypeIds: 7, weekdays: 'Fri', periods: {} };
  assert.equal(awayFor({ away: [garbled] }, A, 0, {}), null, 'fields that are not lists make the entry ignored, never wider');
  assert.equal(awayFor({ away: [null, 4, 'x'] }, A, 0), null);
  assert.equal(awayFor(null, A, 0), null);
  assert.equal(awayFor(undefined, A, 0), null);
  const first = entry({ periods: [0] });
  assert.equal(awayFor(teacherOf([entry({ periods: [3] }), first, entry({})]), A, 0), first);
});

test('teacherDays marks an away planning period "away" first, ahead of a duty and a school mark; a taught period stays taught', () => {
  const project = school();
  const teacher = project.teachers.find((each) => each.id === HALLORAN);
  const before = teacherDays(project, A).get(HALLORAN).map((day) => [day.kind, day.marked]);
  assert.ok(before.some(([kind]) => kind === 'planning') && before.some(([kind]) => kind === 'teaching'), 'the sample teacher both teaches and plans on A Day');
  teacher.away = [entry({})];
  const away = teacherDays(project, A).get(HALLORAN);
  away.forEach((day, i) => {
    assert.equal(day.kind, before[i][0], 'what the teacher does is not changed');
    assert.equal(day.marked, day.kind === 'planning' ? 'away' : null);
  });
  assert.ok(away.filter((day) => day.kind === 'planning').every((day) => !isFree(day)), 'an away period is not free');
  assert.ok(away.filter((day) => day.kind === 'teaching').every((day) => !day.marked), 'a teaching period in an away period is the teaching check\'s, not marked');
  // an always duty on the same period: away still comes first
  const free = before.findIndex(([kind]) => kind === 'planning');
  project.duties = [{ id: 'u000000001', kind: 'duty', label: '', when: 'period', period: free, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [HALLORAN], subjectIds: [], everyone: false }];
  assert.equal(teacherDays(project, A).get(HALLORAN)[free].marked, 'away', 'away before an always duty');
  const fresh = clone(project);
  fresh.teachers.find((each) => each.id === HALLORAN).away = [];
  assert.equal(teacherDays(fresh, A).get(HALLORAN)[free].marked, 'duty', 'with no away entry the duty takes it again');
});

test('a weekdays-only away entry takes the period only with a date on that weekday', () => {
  const project = school();
  project.teachers.find((each) => each.id === HALLORAN).away = [entry({ weekdays: [4] })];
  const plain = teacherDays(project, A).get(HALLORAN);
  assert.ok(plain.every((day) => day.marked !== 'away'), 'no date: sometimes');
  const monday = teacherDays(project, A, { date: MONDAY }).get(HALLORAN);
  assert.ok(monday.every((day) => day.marked !== 'away'));
  const friday = teacherDays(project, A, { date: FRIDAY }).get(HALLORAN);
  assert.ok(friday.some((day) => day.marked === 'away'));
  assert.deepEqual(teacherDay(project, HALLORAN, A, { date: FRIDAY }), friday);
});

test('away on a day type that follows another holds for the follower', () => {
  const project = school();
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
  project.teachers.find((each) => each.id === HALLORAN).away = [entry({ dayTypeIds: [A] })];
  assert.ok(teacherDays(project, C).get(HALLORAN).some((day) => day.marked === 'away'));
  assert.ok(teacherDays(project, B).get(HALLORAN).every((day) => day.marked !== 'away'));
});

test('awayWords: ranges by number names, weekdays, day types, as typed', () => {
  const dayTypes = [{ id: A, name: 'A Day' }, { id: B, name: 'B <i>Day</i>' }];
  const words = (extra, settings) => awayWords(settings || defaultSettings(), entry(extra), dayTypes);
  assert.equal(words({}), 'Not in school');
  assert.equal(words({ periods: [6, 7] }), 'Not in school in Periods 7 to 8');
  assert.equal(words({ periods: [4] }), 'Not in school in Period 5');
  assert.equal(words({ periods: [3, 1, 2, 3] }), 'Not in school in Periods 2 to 4', 'sorted, each once');
  assert.equal(words({ periods: [0, 1, 5] }), 'Not in school in Periods 1 to 2 and Period 6');
  assert.equal(words({ periods: [0, 2, 4] }), 'Not in school in Period 1, Period 3 and Period 5');
  assert.equal(words({ weekdays: [4] }), 'Not in school on Fridays');
  assert.equal(words({ weekdays: [4, 0, 2] }), 'Not in school on Mondays, Wednesdays and Fridays');
  assert.equal(words({ dayTypeIds: [B] }), 'Not in school on B <i>Day</i>');
  assert.equal(words({ dayTypeIds: [A, B] }), 'Not in school on A Day or B <i>Day</i>');
  assert.equal(words({ dayTypeIds: ['dgone00000'] }), '', 'an entry naming only a day type that is not there holds nowhere and is worded nowhere');
  assert.equal(words({ dayTypeIds: ['dgone00000', B] }), 'Not in school on B <i>Day</i>', 'a dangling id beside a real one is left out');
  assert.equal(words({ periods: [6, 7], weekdays: [4], dayTypeIds: [B] }), 'Not in school in Periods 7 to 8 on Fridays (B <i>Day</i>)');
  assert.equal(words({ periods: [4, 5] }, settingsWith({ periodWord: 'Block' })), 'Not in school in Blocks E to F');
  assert.equal(words({ periods: [0, 1] }, settingsWith({ periodWord: 'Hour' })), 'Not in school in 1st to 2nd Hour', 'an ordinal range carries the word once, at the end');
  assert.equal(words({ periods: [0, 1] }, settingsWith({ periodCustom: { word: 'Class', plural: 'Classes', count: 'number' }, periodNames: ['Homeroom', 'Maths'] })), 'Not in school in Classes 1 to 2', 'ranges use number names, never a period\'s own name');
  assert.equal(words({ periods: [4] }, settingsWith({ periodCustom: { word: 'Class', plural: 'Classes', count: 'letter' } })), 'Not in school in Class E');
});

test('awayWords words an entry that awayFor ignores as nothing, and nothing else', () => {
  for (const bad of [null, undefined, 4, 'Fridays', [], { periods: 'x', weekdays: null, dayTypeIds: 3 }, { periods: [-1, 1.5, 'a'], weekdays: [9, -1] }]) {
    assert.equal(awayWords(defaultSettings(), bad, []), '', JSON.stringify(bad));
  }
  assert.equal(awayWords(defaultSettings(), entry({ dayTypeIds: [A] }), null), '', 'without a day type list no id is known');
  assert.equal(awayWords(defaultSettings(), {}, null), 'Not in school', 'an entry naming nothing is the whole day');
});

// ---------------------------------------------------------------- every field absent

// What the rule functions give for a project with none of the new fields. The
// same function ran on the code of e1455dc8, before W7, and DIGEST is what it
// gave then: the new code gives the very same bytes. (The function is kept
// to what both codes have, so it can run on either.)
const DIGEST = '99a36834e7131cfaff5ddf358d6c18e7f04001f3ee6ec17ba71e410c8ee7dfa9';

function observe() {
  const out = {};
  const settingsOf = (word) => ({ ...defaultSettings(), periodWord: word });
  out.names = ['Period', 'Mod', 'Block', 'Hour', 'Other'].map((word) => Array.from({ length: 30 }, (_, i) => [periodName(settingsOf(word), i), periodLabel(settingsOf(word), i)]));
  out.words = ['Period', 'Mod', 'Block', 'Hour'].map((word) => [periodWord(settingsOf(word), false), periodWord(settingsOf(word), true)]);
  const full = sampleSchool();
  const level = school();
  out.days = [full, level].map((project) => project.dayTypes.map((dayType) => [undefined, { date: MONDAY }, { date: FRIDAY }, { bellsId: 'none' }].map((options) => {
    const days = teacherDays(project, dayType.id, options);
    return days ? Array.from(days).map(([id, day]) => [id, day.map((each) => [each.period, each.kind, each.marked, each.duties.map((duty) => duty.id), each.groups])]) : null;
  })));
  out.links = [full, level, threeFloors()].map((project) => buildGraph(project).links.map((link) => [link.id, link.label, link.a, link.b, link.direction, link.levels]));
  out.walks = [threeFloors(), level, full].map((project) => {
    const graph = routingGraph(project);
    const rooms = project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room').map((space) => space.id).slice(0, 7);
    const found = [];
    for (const from of rooms) for (const to of rooms) if (from !== to) found.push(directions(project, route(graph, from, to)).text);
    return found;
  });
  return JSON.stringify(out);
}

test('a project with every new field absent gives the same bytes as before W7', () => {
  const digest = createHash('sha256').update(observe()).digest('hex');
  assert.equal(digest, DIGEST, 'names, labels, teacher days, graph links and directions changed for a project that has none of the W7 fields');
});

test('a published model with every new field absent opens in the staff browser and answers as before', () => {
  const model = publishedModel(school(), { clock });
  for (const key of ['periodCustom', 'periodNames']) assert.equal(key in model.settings, false, key + ' is not published when absent');
  assert.equal('features' in model.building, false);
  assert.ok(model.teachers.every((teacher) => !('away' in teacher)));
  const open = openSchool(clone(model));
  assert.equal(open.periodName(0), 'Period 1');
  assert.equal(open.periodLabel(2), '3');
  assert.deepEqual(open.periodWords(), { one: 'Period', many: 'Periods', oneLower: 'period', manyLower: 'periods', count: 'number' });
});

test('the staff browser reads a published model carrying the new fields, and one carrying them malformed', () => {
  const model = publishedModel(school(), { clock });
  const custom = clone(model);
  custom.settings.periodCustom = { word: 'Lesson', count: 'letter', plural: 'Lessons' };
  custom.settings.periodNames = ['', 'Choir'];
  const open = openSchool(custom);
  assert.equal(open.periodName(0), 'Lesson A');
  assert.equal(open.periodName(1), 'Choir');
  assert.equal(open.periodLabel(1), 'B');
  assert.equal(open.periodWords().many, 'Lessons');
  const broken = clone(model);
  broken.settings.periodCustom = 'Lesson';
  broken.settings.periodNames = { 0: 'Choir' };
  const reads = openSchool(broken);
  assert.equal(reads.periodName(0), 'Period 1');
  assert.equal(reads.periodWords().one, 'Period');
});

// The sample's stairs A (Floors 1 and 2) and B (Floors 2 and 3), published
// with both flights in stairwell W. (publish-data.js writes `well` from
// SV2-126 on; here the field is put into the published model by hand, which
// is what a file from a planner that has it holds.)
function publishedWell(change) {
  const model = clone(publishedModel(school(), { clock }));
  for (const connection of model.building.connections.slice(0, 2)) connection.well = 'W';
  if (change) change(model);
  return model;
}

test('the staff browser names a stairwell by its letter: letterOfStairs, the route, the written directions', () => {
  assert.equal(letterOfStairs({ label: 'A', well: 'W' }), 'W');
  assert.equal(letterOfStairs({ label: 'A' }), 'A');
  const open = openSchool(publishedWell());
  const found = open.route('rsample101', 'rsample303');
  assert.equal(found.ok, true);
  assert.deepEqual(routeCrossings(open, found).map((each) => each.label), ['W', 'W']);
  assert.deepEqual(routeFloors(open, found).map((part) => part.stairs), ['W', 'W', null]);
  assert.match(open.directions(found).text, /Take stairs W up to Floor 3\./);
  assert.doesNotMatch(open.directions(found).text, /stairs A|stairs B/);
});

test('the staff browser lists a stairwell\'s one-way flights once, by the letter', () => {
  const model = publishedWell((built) => {
    built.building.connections[0].direction = 'ab';
    built.building.connections[1].direction = 'ab';
  });
  const second = model.building.floors[1];
  assert.deepEqual(oneWayStairs(model, second).map((each) => each.text), ['Stairs W (up only)'], 'two flights touch Floor 2, one line says it');
  const plain = clone(model);
  for (const connection of plain.building.connections) delete connection.well;
  assert.deepEqual(oneWayStairs(plain, plain.building.floors[1]).map((each) => each.text), ['Stairs A (up only)', 'Stairs B (up only)'], 'plain flights keep their own letters');
});

// ---------------------------------------------------------------- SV2-125b: the review's findings

test('away: a malformed entry never widens, and awayFor and awayWords agree on every input', () => {
  const project = school();
  const dayTypes = project.dayTypes;
  const bad = [
    { periods: ['3'] }, { weekdays: ['x'], periods: [1] }, { dayTypeIds: [5] }, { dayTypeIds: 'd1' }, { periods: [-1] }, { periods: [1.5] },
    { dayTypeIds: ['zz'] }, { periods: 3 }, { weekdays: [7] }, { weekdays: [-1] }, { weekdays: 4 }, { periods: {} }, { dayTypeIds: [null, 'zz'] },
  ];
  for (const each of bad) {
    const label = JSON.stringify(each);
    for (const dayTypeId of [A, B]) {
      for (let period = 0; period < 8; period += 1) {
        assert.equal(awayFor({ away: [each] }, dayTypeId, period, { project, date: FRIDAY }), null, 'holds nowhere: ' + label);
        assert.equal(awayFor({ away: [each] }, dayTypeId, period, { project }), null, 'holds nowhere without a date: ' + label);
      }
    }
    assert.equal(awayWords(defaultSettings(), each, dayTypes), '', 'worded nowhere: ' + label);
    assert.deepEqual(awayEntries({ away: [each] }, A, { project }), [], 'listed nowhere: ' + label);
  }
  // what survives narrows the entry; it never leaves it wider than it says
  const some = { periods: ['3', 2, -1, 2.5], weekdays: [4, 'x', 9], dayTypeIds: ['zz', B] };
  assert.equal(awayFor({ away: [some] }, B, 2, { project, date: FRIDAY }), some);
  assert.equal(awayFor({ away: [some] }, B, 3, { project, date: FRIDAY }), null);
  assert.equal(awayFor({ away: [some] }, A, 2, { project, date: FRIDAY }), null);
  assert.equal(awayFor({ away: [some] }, B, 2, { project, date: MONDAY }), null);
  assert.equal(awayWords(defaultSettings(), some, dayTypes), 'Not in school in Period 3 on Fridays (B Day)');
  // the same entries read the same through both, on a spread of inputs
  const inputs = [...bad, {}, entry({}), { periods: [] }, { periods: [0] }, { weekdays: [] }, { weekdays: [4] }, { dayTypeIds: [A] }, { dayTypeIds: [] }, some, null, 4, 'x', []];
  for (const each of inputs) {
    const held = awayFor({ away: [each] }, A, 0, { project, date: FRIDAY }) !== null || awayFor({ away: [each] }, B, 0, { project, date: FRIDAY }) !== null;
    const worded = awayWords(defaultSettings(), each, dayTypes) !== '';
    if (held) assert.ok(worded, 'held, so worded: ' + JSON.stringify(each));
    assert.equal(awayEntries({ away: [each] }, A, { project }).length > 0 || awayEntries({ away: [each] }, B, { project }).length > 0, worded, 'listed exactly when worded: ' + JSON.stringify(each));
  }
});

test('away: a follower named by the entry is not the leader; a bad options.project is no project', () => {
  const project = school();
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
  const names = (id) => ({ away: [entry({ dayTypeIds: [id] })] });
  assert.ok(awayFor(names(C), C, 0, { project }), 'the entry names the follower and the query is the follower');
  assert.equal(awayFor(names(C), A, 0, { project }), null, 'the entry names the follower and the query is the leader: the leader is not the follower');
  assert.ok(awayFor(names(A), C, 0, { project }), 'the entry names the leader and the query is the follower');
  for (const bad of [null, 'x', 4, [], {}, { dayTypes: 'x' }, { dayTypes: null }]) {
    assert.equal(awayFor(names(A), A, 0, { project: bad }), null, 'no project, no day type to name: ' + JSON.stringify(bad));
    assert.ok(awayFor({ away: [entry({})] }, A, 0, { project: bad }), 'an entry naming no day type still holds: ' + JSON.stringify(bad));
  }
  assert.equal(awayFor(names(A), A, 0, null), null);
  assert.equal(awayFor(names(A), A, 0, 'x'), null);
});

test('away in the teacher\'s day and the school\'s: a period nobody meets in reads "No class", ahead of away, a duty and other marks', () => {
  const project = school();
  project.bellSchedules = [{ id: 'bsample0er', name: 'Early Release', short: '', bells: project.dayTypes[0].bells.slice(), off: [5, 6, 7] }];
  project.teachers.find((each) => each.id === HALLORAN).away = [entry({})];
  const planning = (days) => days.filter((day) => day.kind === 'planning');
  const regular = planning(teacherDays(project, A).get(HALLORAN));
  assert.ok(regular.length > 0 && regular.every((day) => day.marked === 'away'));
  const early = teacherDays(project, A, { bellsId: 'bsample0er' }).get(HALLORAN);
  for (const day of planning(early)) assert.equal(day.marked, day.period >= 5 ? 'noclass' : 'away', 'period ' + day.period);
  assert.ok(planning(early).some((day) => day.period >= 5), 'the teacher plans in an off period');
  // a school No class mark does the same, with no bells chosen
  const marked = clone(project);
  marked.marks = [{ id: 'k000000001', kind: 'noclass', scope: 'school', period: planning(teacherDays(project, A).get(HALLORAN))[0].period, label: '', dayTypeIds: [], grades: [], groupIds: [] }];
  const at = marked.marks[0].period;
  assert.equal(teacherDays(marked, A).get(HALLORAN)[at].marked, 'noclass', 'a school No class mark comes before away');
  // then away, then a duty, then another school mark
  const lunch = clone(project);
  lunch.marks = [{ id: 'k000000002', kind: 'lunch', scope: 'school', period: at, label: '', dayTypeIds: [], grades: [], groupIds: [] }];
  assert.equal(teacherDays(lunch, A).get(HALLORAN)[at].marked, 'away', 'away comes before another school mark');
  lunch.teachers.find((each) => each.id === HALLORAN).away = [];
  assert.equal(teacherDays(lunch, A).get(HALLORAN)[at].marked, 'lunch');
  assert.equal(teacherDay(project, HALLORAN, A, { bellsId: 'bsample0er' })[7].marked, 'noclass', 'teacherDay passes the bells through');
});

test('periodLabel, periodNumberName and periodName: a bad index is nothing; letters past Z; names trimmed and held to their limits', () => {
  const settings = settingsWith({});
  for (const bad of [-1, 1.5, NaN, Infinity, '2', null, undefined, {}]) {
    assert.equal(periodLabel(settings, bad), '', String(bad));
    assert.equal(periodNumberName(settings, bad), '', String(bad));
    assert.equal(periodName(settings, bad), '', String(bad));
    assert.equal(periodLabel(settingsWith({ periodWord: 'Block' }), bad), '');
    assert.equal(periodLabel(settingsWith({ periodWord: 'Hour' }), bad), '');
  }
  assert.equal(periodLabel(settings, 0), '1');
  const letters = settingsWith({ periodCustom: { word: 'Lesson', count: 'letter', plural: 'Lessons' } });
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map((i) => periodLabel(letters, i)), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'], 'letters carry on past Z with the custom count');
  assert.equal(periodNumberName(letters, 26), 'Lesson AA');
  assert.equal(periodName(letters, 702), 'Lesson AAA');
  const block = settingsWith({ periodWord: 'Block' });
  assert.deepEqual([26, 27, 702].map((i) => periodLabel(block, i)), ['AA', 'AB', 'AAA']);
  assert.equal(periodLabel(settingsWith({ periodCustom: { word: 'Hour', count: 'ordinal' } }), 111), '112th');
  const wordMost = 'W'.repeat(PERIOD_WORD_MOST);
  const nameMost = 'N'.repeat(PERIOD_NAME_MOST);
  const long = settingsWith({ periodCustom: { word: ' ' + wordMost + 'xyz', plural: wordMost + 'PLURAL ', count: 'number' }, periodNames: ['  ' + nameMost + 'overflow  ', '  Lunch  '] });
  assert.equal(periodWordForms(long).one, wordMost);
  assert.equal(periodWordForms(long).many, wordMost);
  assert.equal(periodWordForms(long).oneLower, wordMost);
  assert.equal(periodName(long, 0), nameMost);
  assert.equal(periodName(long, 1), 'Lunch', 'an own name is trimmed');
  assert.equal(periodWordForms(settingsWith({ periodCustom: { word: wordMost } })).many, wordMost, 'the default plural is held to the limit too');
  assert.equal(periodNumberName(long, 2), wordMost + ' 3');
});

test('awayWords: an ordinal range reads "1st to 3rd Hour"; the other counts keep "Periods 7 to 8"', () => {
  const dayTypes = [];
  assert.equal(awayWords(settingsWith({ periodWord: 'Hour' }), entry({ periods: [0, 1, 2] }), dayTypes), 'Not in school in 1st to 3rd Hour');
  assert.equal(awayWords(settingsWith({ periodWord: 'Hour' }), entry({ periods: [0, 2] }), dayTypes), 'Not in school in 1st Hour and 3rd Hour');
  assert.equal(awayWords(settingsWith({ periodCustom: { word: 'Class', plural: 'Classes', count: 'ordinal' } }), entry({ periods: [1, 2] }), dayTypes), 'Not in school in 2nd to 3rd Class');
  assert.equal(awayWords(settingsWith({}), entry({ periods: [6, 7] }), dayTypes), 'Not in school in Periods 7 to 8');
});

test('directions collapse adjacent flights only for a non-blank well equal by name', () => {
  const said = (change) => {
    const project = threeFloors();
    change(project.building.connections);
    return directions(project, route(routingGraph(project), roomId('1A'), roomId('3A')));
  };
  const stairs = (result) => result.steps.find((step) => step.kind === 'stairs');
  const samePlain = said((connections) => {
    connections[0].label = 'A';
    connections[1].label = 'A';
  });
  assert.equal(stairs(samePlain).text, 'Take stairs A, then stairs A up to Floor 3.', 'two plain flights with one label are two flights');
  assert.deepEqual(stairs(samePlain).labels, ['A', 'A']);
  const blank = said((connections) => {
    connections[0].label = '';
    connections[1].label = '';
  });
  assert.deepEqual(stairs(blank).labels, ['', ''], 'two blank labels are never one stairwell');
  const blankWells = said((connections) => {
    connections[0].well = '';
    connections[1].well = '  ';
  });
  assert.deepEqual(stairs(blankWells).labels, ['A', 'B'], 'blank wells are no wells');
  const oneWell = said((connections) => {
    connections[0].well = 'W';
  });
  assert.deepEqual(stairs(oneWell).labels, ['W', 'B'], 'a well beside a plain flight keeps both');
  const sameLabelOneWell = said((connections) => {
    connections[0].label = 'W';
    connections[0].well = 'W';
    connections[1].label = 'W';
  });
  assert.deepEqual(stairs(sameLabelOneWell).labels, ['W', 'W'], 'a plain label equal to a well is not that well');
  const mixed = said((connections) => {
    connections[0].well = 'w';
    connections[1].well = ' W ';
  });
  assert.equal(stairs(mixed).text, 'Take stairs w up to Floor 3.', 'wells equal by name are one letter, the first said');
  assert.deepEqual(stairs(mixed).connections, ['cplan00001', 'cplan00002']);
  const differing = said((connections) => {
    connections[0].well = 'W';
    connections[1].well = 'X';
  });
  assert.deepEqual(stairs(differing).labels, ['W', 'X']);
});

test('the staff browser passes through a floor only when the way crossed it at one cell, by the same letter', () => {
  const via = (label) => ({ kind: 'stairs', label });
  const part = (cells, label) => ({ cells, via: label === null ? null : via(label) });
  assert.equal(floorIsPassed([part(1, 'W'), part(1, 'W'), part(1, null)], 1), true);
  assert.equal(floorIsPassed([part(1, 'W'), part(4, 'W'), part(1, null)], 1), false, 'a walk across the floor is not a pass');
  assert.equal(floorIsPassed([part(1, 'W'), part(1, 'X'), part(1, null)], 1), false, 'another letter');
  assert.equal(floorIsPassed([part(1, ''), part(1, ''), part(1, null)], 1), false, 'blank letters');
  assert.equal(floorIsPassed([part(1, 'W'), part(1, null)], 1), false, 'the last floor is where the walk ends');
  assert.equal(floorIsPassed([part(1, 'W'), part(1, 'W')], 0), false, 'the first floor is not entered by stairs');
  assert.equal(floorIsPassed([{ cells: 1, via: { kind: 'ride', label: 'A' } }, { cells: 1, via: { kind: 'ride', label: 'A' } }, part(1, null)], 1), false, 'a ride is not stairs');
  // and on the real route: the sample's well W, one flight after the other
  const open = openSchool(publishedWell());
  const floors = routeFloors(open, open.route('rsample101', 'rsample303'));
  assert.deepEqual(floors.map((each, at) => floorIsPassed(floors, at)), [false, floors[1].cells === 1, false]);
});

test('one-way stairs are said by letter: a stop with flights of different ways never says two contradictory sentences', () => {
  const model = publishedWell((built) => {
    built.building.connections[0].direction = 'ab';
    built.building.connections[1].direction = 'ab';
  });
  const names = model.building.floors.map((floor) => floor.name);
  const second = model.building.floors[1];
  assert.deepEqual(oneWayGroups(model, second).map((each) => each.sentence), ['Stairs W is up only.']);
  const against = clone(model);
  against.building.connections[1].direction = 'ba';
  const groups = oneWayGroups(against, against.building.floors[1]);
  assert.equal(groups.length, 1, 'one letter, one sentence');
  assert.equal(groups[0].text, 'Stairs W: up only from ' + names[0] + ' to ' + names[1] + ', down only from ' + names[2] + ' to ' + names[1]);
  assert.equal(groups[0].sentence, groups[0].text + '.');
  assert.deepEqual(oneWayStairs(against, against.building.floors[1]).map((each) => each.text), [groups[0].text]);
  assert.equal(oneWayGroups(against, against.building.floors[0]).map((each) => each.sentence).join(' '), 'Stairs W is up only.', 'the end floor touches one flight only');
  // letters differing only by case are one letter
  const cased = clone(against);
  cased.building.connections[1].well = 'w';
  assert.equal(oneWayGroups(cased, cased.building.floors[1]).length, 1);
  assert.deepEqual(oneWayGroups({ building: null }, second), []);
});

test('stairsLetter trims the well; nextConnectionLabel compares used labels and wells by name; stairwells leaves out flights with no id and sorts unknown floors last', () => {
  assert.equal(stairsLetter({ label: 'A', well: ' W ' }), 'W');
  assert.equal(stairsLetter({ label: 'A', well: '\tx\n' }), 'x');
  assert.equal(nextConnectionLabel([{ label: 'a' }]), 'B', 'a used label is compared by name');
  assert.equal(nextConnectionLabel([{ label: ' A ' }, { label: 'b' }]), 'C');
  assert.equal(nextConnectionLabel([{ label: 'a', well: 'b' }, { label: 7 }, null]), 'C');
  assert.equal(nextConnectionLabel([{ label: 'Z' }].concat(Array.from({ length: 25 }, (_, i) => ({ label: String.fromCharCode(97 + i) })))), 'AA');

  const building = {
    floors: [{ id: 'f1', level: 0 }, { id: 'f2', level: 1 }],
    connections: [
      { id: 'c1', label: 'A', well: ' W ', a: { floorId: 'f1', cell: 3 }, b: { floorId: 'f2', cell: 3 } },
      { label: 'B', well: 'W', a: { floorId: 'f1', cell: 5 }, b: { floorId: 'f2', cell: 5 } },
      { id: '', label: 'C', well: 'W', a: { floorId: 'f1', cell: 6 }, b: { floorId: 'f2', cell: 6 } },
      { id: 'c4', label: 'D', well: 'W', a: { floorId: 'fgone', cell: 9 }, b: { floorId: 'f2', cell: 9 } },
      { id: 'c5', label: 'E', well: 'W', a: { floorId: 'fgone', cell: 2 }, b: { floorId: 'fgone', cell: 4 } },
    ],
  };
  const [well] = stairwells(building);
  assert.equal(well.letter, 'W', 'the letter is trimmed');
  assert.deepEqual(well.connectionIds, ['c1', 'c4', 'c5'], 'the flights with no id are left out');
  assert.deepEqual(well.stops.map((stop) => stop.floorId + ':' + stop.cell), ['f1:3', 'f2:3', 'f2:9', 'fgone:2', 'fgone:4', 'fgone:9'], 'unknown floors last, by cell, never an unordered pair');
  assert.deepEqual(well.stops.map((stop) => stop.level), [0, 1, 1, null, null, null]);
  assert.equal(stairwells({ floors: [], connections: [{ id: 'c1', well: 'W', a: { floorId: 'x', cell: 1 }, b: { floorId: 'y', cell: 1 } }] })[0].stops.length, 2, 'a building with no floors still lists its stops');
});

test('the staff browser lists the away entries of a day type, so two day types that differ only by one are two cards', () => {
  const model = publishedModel(school(), { clock });
  model.teachers[0].away = [{ dayTypeIds: [B], weekdays: [], periods: [6, 7] }, { dayTypeIds: [], weekdays: [4], periods: [2] }, { dayTypeIds: ['zz'], periods: [1] }, { periods: 'x' }];
  const open = openSchool(model);
  const id = model.teachers[0].id;
  assert.deepEqual(open.awayOf(id, A).map((each) => each.words), ['Not in school in Period 3 on Fridays']);
  assert.deepEqual(open.awayOf(id, B).map((each) => each.words), ['Not in school in Periods 7 to 8 on ' + model.dayTypes.find((dayType) => dayType.id === B).name, 'Not in school in Period 3 on Fridays']);
  assert.deepEqual(open.awayOf(id, B).map((each) => each.sometimes), [false, true]);
  assert.deepEqual(open.awayOf('tgone00000', A), []);
});
