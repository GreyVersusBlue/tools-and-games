import test from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { subjectsStarter } from '../../data/subjects-starter.js';
import { emptyProject, school, room, clock, makeIds, PINNED } from './helpers.mjs';

test('newProject is a valid empty project', () => {
  const project = emptyProject();
  assert.deepEqual(validate(project), []);
  assert.equal(project.format, 'sv2-project');
  assert.equal(project.version, 1);
  assert.match(project.id, /^p[a-z0-9]{9}$/);
  assert.equal(project.created, PINNED);
  assert.equal(project.modified, PINNED);
});

test('newProject has one floor of 40 by 30 on level 1 with nothing drawn', () => {
  const { floors, connections, zones } = emptyProject().building;
  assert.equal(floors.length, 1);
  assert.equal(floors[0].name, 'Floor 1');
  assert.equal(floors[0].level, 1);
  assert.equal(floors[0].width, 40);
  assert.equal(floors[0].height, 30);
  assert.equal(floors[0].cells, '.'.repeat(1200));
  assert.deepEqual([floors[0].spaces, floors[0].corridors, floors[0].exits, floors[0].image], [[], [], [], null]);
  assert.deepEqual([connections, zones], [[], []]);
});

test('newProject has an A Day, and a B Day that is the same as A Day', () => {
  const project = emptyProject();
  assert.deepEqual(project.dayTypes.map((d) => [d.name, d.own]), [['A Day', true], ['B Day', false]]);
  for (const dayType of project.dayTypes) assert.deepEqual(dayType.bells, [null, null, null, null, null, null, null, null]);
});

test('newProject has the settings of spec 16', () => {
  assert.deepEqual(emptyProject().settings, {
    schoolName: '',
    periods: 8,
    periodWord: 'Period',
    defaultPassingSeconds: 240,
    defaultHeadCount: 25,
    secondsPerCell: 3,
    secondsPerStair: 8,
    colourScale: { mode: 'relative', bands: [10, 25, 50, 100] },
    checks: { consecutiveLimit: 4, passingMarginSeconds: 0, off: [] },
    timeFormat: '12h',
    paper: { size: 'letter', orientation: 'portrait' },
    theme: 'auto',
  });
});

test('newProject takes the paper size of the device\'s region when it is given one', () => {
  assert.equal(schema.newProject(makeIds(), clock, { paperSize: 'a4' }).settings.paper.size, 'a4');
  assert.equal(schema.newProject(makeIds(), clock, { paperSize: 'legal' }).settings.paper.size, 'letter');
});

test('newProject starts with the starter subjects, each with its own id', () => {
  const project = emptyProject();
  assert.ok(subjectsStarter.length >= 8);
  assert.deepEqual(project.subjects.map((s) => [s.code, s.name, s.colour]), subjectsStarter.map((s) => [s.code, s.name, s.colour]));
  assert.equal(new Set(project.subjects.map((s) => s.id)).size, subjectsStarter.length);
  assert.ok(project.subjects.every((s) => /^s[a-z0-9]{9}$/.test(s.id)));
  assert.ok(subjectsStarter.every((s) => schema.isHexColour(s.colour)));
  assert.equal(new Set(subjectsStarter.map((s) => s.code)).size, subjectsStarter.length);
});

test('newProject takes its passcode from the caller, and has every view on and 60 days of staleness', () => {
  const { publish, onboarding, accepted, scenario } = emptyProject();
  // schema.js knows no passcode (a published file carries its source): bare, protection is off
  assert.equal(publish.passcode, '');
  assert.equal(schema.defaultPublish().passcode, '');
  assert.equal('DEFAULT_PASSCODE' in schema, false);
  // the planner hands over the tool's default
  assert.equal(DEFAULT_PASSCODE, 'bulldogs2015');
  assert.equal(schema.newProject(makeIds(), clock, { passcode: DEFAULT_PASSCODE }).publish.passcode, 'bulldogs2015');
  assert.equal(schema.defaultPublish(DEFAULT_PASSCODE).passcode, 'bulldogs2015');
  assert.equal(publish.stalenessDays, 60);
  assert.deepEqual(Object.keys(publish.views), schema.PUBLISH_VIEWS);
  assert.ok(Object.values(publish.views).every((on) => on === true));
  assert.equal(publish.lastPublishedAt, null);
  assert.deepEqual(onboarding, { steps: {}, dismissed: false, neverShow: false });
  assert.deepEqual([accepted, scenario], [[], null]);
});

test('two new projects share no object', () => {
  const a = emptyProject();
  const b = emptyProject();
  assert.notEqual(a.settings, b.settings);
  assert.notEqual(a.settings.colourScale.bands, b.settings.colourScale.bands);
  assert.notEqual(a.publish.views, b.publish.views);
});

test('the constants: six students to a lane cell, the ranges, the presets', () => {
  assert.equal(schema.STUDENTS_PER_LANE_CELL, 6);
  assert.deepEqual(schema.RANGES.periods, [1, 16]);
  assert.deepEqual(schema.RANGES.headCount, [1, 999]);
  assert.deepEqual(schema.RANGES.capacity, [1, 999]);
  assert.deepEqual(schema.RANGES.secondsPerCell, [1, 10]);
  assert.deepEqual(schema.RANGES.secondsPerStair, [2, 30]);
  assert.deepEqual(schema.RANGES.floorSize, [5, 200]);
  assert.deepEqual(schema.PERIOD_WORDS, ['Period', 'Mod', 'Block', 'Hour']);
  assert.deepEqual(schema.GROUP_COLOUR_PRESETS.slice(0, 10), ['#d1495b', '#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#8c6d31', '#7b4ea3', '#f0e442', '#999999']);
  assert.equal(schema.GROUP_COLOUR_PRESETS.length, 19);
  assert.equal(new Set(schema.GROUP_COLOUR_PRESETS).size, 19);
  assert.ok(schema.GROUP_COLOUR_PRESETS.every(schema.isHexColour));
  assert.deepEqual(schema.LOAD_BAND_COLOURS, ['#e9eef2', '#bcd7e8', '#7fb3d5', '#d98a3e', '#b3261e']);
});

test('the second ten presets are the first ten turned 30 degrees of hue', () => {
  // #d1495b is hue 352; 30 degrees on is hue 22, an orange with the same lightness
  assert.equal(schema.GROUP_COLOUR_PRESETS[10], '#d17b49');
  // pure blue-ish #0072b2 (hue 202) turns to hue 232
  assert.equal(schema.GROUP_COLOUR_PRESETS[11], '#0019b2');
});

test('nextGroupColour gives the first preset no group uses, then the least used', () => {
  const presets = schema.GROUP_COLOUR_PRESETS;
  assert.equal(schema.nextGroupColour([]), presets[0]);
  assert.equal(schema.nextGroupColour([{ colour: presets[0] }, { colour: presets[1].toUpperCase() }]), presets[2]);
  assert.equal(schema.nextGroupColour([{ colour: presets[1] }]), presets[0]);
  const all = presets.map((colour) => ({ colour }));
  assert.equal(schema.nextGroupColour(all), presets[0]);
  assert.equal(schema.nextGroupColour(all.concat([{ colour: presets[0] }])), presets[1]);
  assert.equal(schema.nextGroupColour([{ colour: '#123456' }]), presets[0]);
});

test('nextConnectionLabel is the first unused letter, then AA, AB', () => {
  const labels = (list) => list.map((label) => ({ label }));
  assert.equal(schema.nextConnectionLabel([]), 'A');
  assert.equal(schema.nextConnectionLabel(labels(['A', 'C'])), 'B');
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  assert.equal(schema.nextConnectionLabel(labels(alphabet)), 'AA');
  assert.equal(schema.nextConnectionLabel(labels(alphabet.concat(['AA']))), 'AB');
});

test('room numbers and names compare without case or surrounding spaces', () => {
  assert.equal(schema.roomNumberKey('  Gym '), schema.roomNumberKey('GYM'));
  assert.notEqual(schema.roomNumberKey('20 4'), schema.roomNumberKey('204'));
  assert.equal(schema.nameKey(' 7-1'), schema.nameKey('7-1 '));
  assert.equal(schema.looseNameKey('Ms. Okafor'), schema.looseNameKey('Ms Okafor'));
  assert.notEqual(schema.looseNameKey('Ms. Okafor'), schema.looseNameKey('Mr. Okafor'));
});

test('bell times and dates are recognised strictly', () => {
  for (const good of ['00:00', '08:05', '23:59']) assert.equal(schema.isBellTime(good), true, good);
  for (const bad of ['8:05', '24:00', '08:60', '08:05:00', '', null, 805]) assert.equal(schema.isBellTime(bad), false, String(bad));
  assert.equal(schema.isIsoDate('2026-09-01T12:00:00.000Z'), true);
  assert.equal(schema.isIsoDate('2026-09-01T12:00:00Z'), true);
  assert.equal(schema.isIsoDate('2026-09-01'), false);
  assert.equal(schema.isIsoDate('2026-09-01T12:00:00+02:00'), false);
});

test('neighbourCell stops at each edge of the floor', () => {
  const floor = { width: 5, height: 5 };
  assert.equal(schema.neighbourCell(floor, 0, 'n'), -1);
  assert.equal(schema.neighbourCell(floor, 0, 'w'), -1);
  assert.equal(schema.neighbourCell(floor, 0, 'e'), 1);
  assert.equal(schema.neighbourCell(floor, 0, 's'), 5);
  assert.equal(schema.neighbourCell(floor, 4, 'e'), -1);
  assert.equal(schema.neighbourCell(floor, 24, 's'), -1);
  assert.equal(schema.neighbourCell(floor, 24, 'n'), 19);
  assert.equal(schema.neighbourCell(floor, 12, 'w'), 11);
});

test('cellKind says what each kind of cell is', () => {
  const floor = school().building.floors[0];
  assert.equal(schema.cellKind(floor, 0), 'empty');
  assert.equal(schema.cellKind(floor, schema.cellIndex(floor, 5, 7)), 'corridor');
  assert.equal(schema.cellKind(floor, schema.cellIndex(floor, 12, 8)), 'stairs');
  assert.equal(schema.cellKind(floor, schema.cellIndex(floor, 2, 4)), 'room');
  assert.equal(schema.cellKind(floor, schema.cellIndex(floor, 2, 9)), 'other');
  assert.equal(schema.cellX(floor, schema.cellIndex(floor, 12, 8)), 12);
  assert.equal(schema.cellY(floor, schema.cellIndex(floor, 12, 8)), 8);
});

test('an exit cell is corridor beside something empty or the edge; a mid-corridor cell is not', () => {
  const floor = school().building.floors[0];
  assert.equal(schema.isEdgeCorridorCell(floor, schema.cellIndex(floor, 39, 7)), true, 'the east end');
  assert.equal(schema.isEdgeCorridorCell(floor, schema.cellIndex(floor, 20, 13)), true, 'the bottom of the Front Hall');
  assert.equal(schema.isEdgeCorridorCell(floor, schema.cellIndex(floor, 3, 7)), false, 'between Room 101 and the Office');
  assert.equal(schema.isEdgeCorridorCell(floor, schema.cellIndex(floor, 2, 4)), false, 'a room cell');
  assert.equal(schema.isEdgeCorridorCell(floor, schema.cellIndex(floor, 12, 8)), false, 'a stairs cell');
});

test('resolveSlotRoom: a room in the building', () => {
  const project = school();
  const result = schema.resolveSlotRoom(project, { room: 'rsample203', roomText: '', label: '', teacherIds: [] });
  assert.equal(result.room, room(project, '203'));
  assert.equal(result.text, '203');
  assert.equal(result.missing, false);
});

test('resolveSlotRoom: a room that is not in the building keeps its text and is missing', () => {
  const project = school();
  assert.deepEqual(schema.resolveSlotRoom(project, { room: null, roomText: '999', label: '', teacherIds: [] }), { room: null, text: '999', missing: true });
  assert.deepEqual(schema.resolveSlotRoom(project, { room: 'rnowhere00', roomText: 'Annex', label: '', teacherIds: [] }), { room: null, text: 'Annex', missing: true });
});

test('resolveSlotRoom: a slot with nothing entered is not missing', () => {
  assert.deepEqual(schema.resolveSlotRoom(school(), schema.emptySlot()), { room: null, text: '', missing: false });
});

test('findRoom, floorOfRoom and allRooms read the building', () => {
  const project = school();
  assert.equal(schema.findRoom(project, 'rsamplelib').number, 'Library');
  assert.equal(schema.floorOfRoom(project, 'rsamplelib').name, 'Floor 2');
  assert.equal(schema.findRoom(project, 'osample001'), null, 'an other space is not a room');
  assert.equal(schema.findRoom(project, 'rnowhere00'), null);
  assert.equal(schema.allRooms(project).length, 13);
  assert.equal(schema.findFloor(project, 'fsample003').level, 3);
});
