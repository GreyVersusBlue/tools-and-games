import test from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { subjectsStarter } from '../../data/subjects-starter.js';
import { emptyProject, school, room, clock, makeIds, PINNED } from './helpers.mjs';
import { withElevator, F1, F2, F3, paint } from '../fixtures/step-free.mjs';
import { clone } from './helpers.mjs';

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
  // the calendar page's switch is kept now and published from SV2-77
  assert.deepEqual(Object.keys(publish.views), schema.PUBLISH_VIEWS.concat(['calendar']));
  assert.deepEqual(schema.LATER_PUBLISH_VIEWS, ['calendar']);
  assert.ok(Object.values(publish.views).every((on) => on === true));
  assert.equal(publish.lastPublishedAt, null);
  assert.equal(publish.staleAtCalendarEnd, true);
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

test('ARCHITECTURE 17: the limits, the new project\'s fields, and the readers that treat absent as none', () => {
  assert.deepEqual([schema.DAY_TYPES_MOST, schema.BELL_SCHEDULES_MOST, schema.NAME_MOST, schema.SHORT_MOST, schema.CALENDAR_DAYS_MOST, schema.ROTATION_RANGE, schema.DATE_LABEL_MOST], [12, 12, 40, 4, 731, [1, 24], 60]);
  const project = emptyProject();
  assert.deepEqual([project.bellSchedules, project.calendar], [[], null]);
  assert.deepEqual(project.dayTypes.map((d) => [d.own, d.sameAs, d.short]), [[true, null, ''], [false, null, '']]);
  assert.deepEqual(schema.newBellSchedule('bsample0er', 'Early Release', [null]), { id: 'bsample0er', name: 'Early Release', short: '', bells: [null], off: [] });
  assert.deepEqual(schema.defaultWeekdays().map((rule) => rule.day), ['rotation', 'rotation', 'rotation', 'rotation', 'rotation', 'closed', 'closed']);
  assert.deepEqual(schema.bellSchedulesOf({}), []);
  assert.deepEqual(schema.bellSchedulesOf({ bellSchedules: 'x' }), []);
  assert.equal(schema.calendarOf({}), null);
  assert.equal(schema.calendarOf({ calendar: [] }), null);
  assert.deepEqual(schema.calendarOf({ calendar: { start: 'x' } }), { start: 'x' });
  assert.equal(schema.spacelessKey(' Early  Release '), 'earlyrelease');
  assert.equal(schema.textLength('Τρίτη 😀'), 7);
});

// ---------------------------------------------------------------- marks and duties (SV2-83)

test('newProject has no marks and no duties: they are absent until the first is added', () => {
  const project = emptyProject();
  assert.equal('marks' in project, false);
  assert.equal('duties' in project, false);
  assert.deepEqual(schema.marksOf(project), []);
  assert.deepEqual(schema.dutiesOf(project), []);
  assert.deepEqual(schema.marksOf({ marks: 'x' }), []);
  assert.deepEqual(schema.dutiesOf(null), []);
});

test('newMark and newDuty are valid in a project, with the defaults the actions rely on', () => {
  const project = school();
  project.marks = [schema.newMark('mtest00001', 'lunch', 3)];
  project.duties = [schema.newDuty('utest00001', 'duty')];
  assert.deepEqual(validate(project), []);
  assert.deepEqual(project.marks[0], { id: 'mtest00001', kind: 'lunch', label: '', period: 3, dayTypeIds: [], scope: 'school', grades: [], groupIds: [] });
  assert.equal(project.duties[0].when, 'before');
  assert.equal(project.duties[0].everyone, false);
  assert.deepEqual(schema.MARK_KINDS, ['lunch', 'advisory', 'activity', 'noclass']);
  assert.deepEqual(schema.DUTY_KINDS, ['duty', 'meeting', 'lunch']);
});

test('lastPublishedHadCalendar is not in the defaults: absent reads as no', () => {
  assert.equal('lastPublishedHadCalendar' in schema.defaultPublish(''), false);
});

// ---- the step-free model (ARCHITECTURE 19.2, SV2-96)

test('step-free: the three elevator settings are read through elevatorSettings() and are not in defaultSettings()', () => {
  for (const key of ['elevatorWaitSeconds', 'elevatorSecondsPerFloor', 'elevatorPeoplePerTrip']) {
    assert.equal(key in schema.defaultSettings(), false, key);
    assert.equal(key in emptyProject().settings, false, key);
  }
  assert.deepEqual(schema.elevatorSettings(emptyProject().settings), { wait: 30, perFloor: 6, perTrip: 8 });
  assert.deepEqual(schema.elevatorSettings(undefined), { wait: 30, perFloor: 6, perTrip: 8 });
  assert.deepEqual(schema.elevatorSettings({ elevatorWaitSeconds: 45, elevatorSecondsPerFloor: 5, elevatorPeoplePerTrip: 6 }), { wait: 45, perFloor: 5, perTrip: 6 });
  assert.equal(schema.elevatorSettings({ elevatorWaitSeconds: 0 }).wait, 0, 'a wait of 0 is a wait of 0, not the default');
  assert.deepEqual(schema.elevatorSettings({ elevatorWaitSeconds: 301, elevatorSecondsPerFloor: 0, elevatorPeoplePerTrip: 41 }), { wait: 30, perFloor: 6, perTrip: 8 }, 'out of range reads as the default');
  assert.deepEqual(schema.elevatorSettings({ elevatorWaitSeconds: '9', elevatorSecondsPerFloor: 2.5, elevatorPeoplePerTrip: null }), { wait: 30, perFloor: 6, perTrip: 8 });
  assert.deepEqual([schema.RANGES.elevatorWaitSeconds, schema.RANGES.elevatorSecondsPerFloor, schema.RANGES.elevatorPeoplePerTrip], [[0, 300], [1, 60], [1, 40]]);
});

test('step-free: the constants are named as ARCHITECTURE 19 names them', () => {
  assert.equal(schema.ELEVATOR_KIND, 'elevator');
  assert.equal(schema.ELEVATOR_DOOR_SECONDS, 10);
});

test('step-free: no cell character was added (an older tool refuses any but . # S)', () => {
  assert.deepEqual([schema.CELL_EMPTY, schema.CELL_CORRIDOR, schema.CELL_STAIRS], ['.', '#', 'S']);
  assert.equal(/[^.#S]/.test(withElevator().building.floors.map((floor) => floor.cells).join('')), false);
});

// a three-stop elevator, as a chain (Floor 1 to 2, 2 to 3) or a star (the lobby to each)
function threeStops(shape) {
  const project = school();
  const [f1, f2, f3] = project.building.floors;
  for (const [floor, cell] of [[f1, 333], [f2, 333], [f3, 333]]) paint(floor, cell, 'S');
  project.building.connections = [
    { id: 'cchain0001', label: 'A', a: { floorId: F1, cell: 333 }, b: { floorId: F2, cell: 333 }, direction: 'both', kind: 'elevator', car: 'A', staffOnly: true },
    shape === 'chain'
      ? { id: 'cchain0002', label: 'B', a: { floorId: F2, cell: 333 }, b: { floorId: F3, cell: 333 }, direction: 'both', kind: 'elevator', car: 'A', staffOnly: true }
      : { id: 'cchain0002', label: 'B', a: { floorId: F1, cell: 333 }, b: { floorId: F3, cell: 333 }, direction: 'both', kind: 'elevator', car: 'A', staffOnly: true },
  ];
  return project;
}

test('step-free: elevatorCars: a chain of three stops is one car, stops in floor-level order, named by its first connection', () => {
  const cars = schema.elevatorCars(threeStops('chain').building);
  assert.deepEqual(cars, [{ id: 'cchain0001', label: 'A', stops: [{ floorId: F1, cell: 333 }, { floorId: F2, cell: 333 }, { floorId: F3, cell: 333 }], connectionIds: ['cchain0001', 'cchain0002'], staffOnly: true }]);
});

test('step-free: elevatorCars: a star from the lobby is the same car as the chain', () => {
  const star = schema.elevatorCars(threeStops('star').building);
  assert.equal(star.length, 1);
  assert.deepEqual(star[0].stops, schema.elevatorCars(threeStops('chain').building)[0].stops);
  assert.equal(star[0].id, 'cchain0001');
});

test('step-free: elevatorCars: two connections that meet at a cell are merged into one car, however they were drawn', () => {
  // drawn in the other order: Floor 2 to 3 first, then Floor 1 to 2
  const project = threeStops('chain');
  project.building.connections.reverse();
  const cars = schema.elevatorCars(project.building);
  assert.equal(cars.length, 1);
  assert.equal(cars[0].id, 'cchain0002', 'named by the first connection in building order');
  assert.deepEqual(cars[0].stops.map((stop) => stop.floorId), [F1, F2, F3], 'stops in floor-level order whatever the order drawn');
});

test('step-free: elevatorCars: two separate elevators are two cars, in order of their first connection', () => {
  const project = threeStops('chain');
  paint(project.building.floors[0], 340, 'S');
  paint(project.building.floors[1], 340, 'S');
  project.building.connections.splice(1, 0, { id: 'cother0001', label: 'C', a: { floorId: F1, cell: 340 }, b: { floorId: F2, cell: 340 }, direction: 'both', kind: 'elevator', car: 'C' });
  const cars = schema.elevatorCars(project.building);
  assert.deepEqual(cars.map((car) => [car.id, car.label, car.staffOnly]), [['cchain0001', 'A', true], ['cother0001', 'C', false]].concat([]).slice(0, 2));
});

test('step-free: elevatorCars: an unconnected stop is a car of its own; a stairs connection is no car; staffOnly is true when any connection says so', () => {
  const project = withElevator();
  project.building.floors[2].lifts = [];
  paint(project.building.floors[2], 360, 'S');
  project.building.floors[2].lifts = [360];
  const cars = schema.elevatorCars(project.building);
  assert.deepEqual(cars.map((car) => car.stops.length), [2, 1]);
  assert.deepEqual(cars[1], { id: 'stop:' + F3 + ':360', label: '', stops: [{ floorId: F3, cell: 360 }], connectionIds: [], staffOnly: false });
  assert.deepEqual(schema.elevatorCars(school().building), [], 'a building with no elevator has no cars');
  const mixed = threeStops('chain');
  delete mixed.building.connections[0].staffOnly;
  assert.equal(schema.elevatorCars(mixed.building)[0].staffOnly, true);
});

test('step-free: elevatorCars: the label is the stored car letter, and the connection\'s own label when none is stored', () => {
  const project = threeStops('chain');
  project.building.connections[0].car = 'D';
  project.building.connections[0].label = 'X';
  assert.equal(schema.elevatorCars(project.building)[0].label, 'D');
  delete project.building.connections[0].car;
  assert.equal(schema.elevatorCars(project.building)[0].label, 'X');
});

test('step-free: elevatorCars survives a building it cannot read', () => {
  assert.deepEqual(schema.elevatorCars(null), []);
  assert.deepEqual(schema.elevatorCars({}), []);
  assert.deepEqual(schema.elevatorCars({ floors: [], connections: [null, { kind: 'elevator' }, { kind: 'elevator', a: 1, b: 2 }] }), []);
});

test('step-free: isLiftCell: an end of an elevator connection is a lift cell with or without a lifts list', () => {
  const project = withElevator();
  assert.equal(schema.isLiftCell(project.building, F1, 332), true);
  assert.equal(schema.isLiftCell(project.building, F2, 332), true);
  delete project.building.floors[0].lifts;
  assert.equal(schema.isLiftCell(project.building, F1, 332), true, 'by the connection');
  assert.equal(schema.isLiftCell(project.building, F2, 353), false, 'the other stairs are stairs');
  assert.equal(schema.isLiftCell(project.building, F1, 283), false, 'a corridor cell');
  assert.equal(schema.isLiftCell(project.building, 'fnowhere00', 332), false);
});

test('step-free: isLiftCell: a stop in lifts with no connection is a lift cell; a stale index on a stairs connection is not (the kind is the authority)', () => {
  const project = school();
  const [f1, , f3] = project.building.floors;
  paint(f1, 340, 'S');
  f1.lifts = [340, 5, 332];
  assert.equal(schema.isLiftCell(project.building, F1, 340), true, 'a stop with no connection yet');
  assert.equal(schema.isLiftCell(project.building, F1, 5), false, 'not a stairs cell');
  assert.equal(schema.isLiftCell(project.building, F1, 332), false, 'it carries stairs connection A, which an older tool drew');
  f3.lifts = [353];
  assert.equal(schema.isLiftCell(project.building, F3, 353), false);
});

test('step-free: cellKind answers "elevator" for a lift cell, "stairs" for the others, and the other kinds as before', () => {
  const project = withElevator();
  const [f1, f2, f3] = project.building.floors;
  assert.equal(schema.cellKind(f1, 332, project.building), 'elevator');
  assert.equal(schema.cellKind(f1, 332), 'elevator', 'by the floor\'s own list when no building is given');
  assert.equal(schema.cellKind(f2, 353, project.building), 'stairs');
  assert.equal(schema.cellKind(f3, 353, project.building), 'stairs');
  assert.equal(schema.cellKind(f1, 283, project.building), 'corridor');
  assert.equal(schema.cellKind(f1, 70, project.building), 'room');
  assert.equal(schema.cellKind(f1, 321, project.building), 'other');
  assert.equal(schema.cellKind(f1, 5, project.building), 'empty');
  const plain = school().building.floors[0];
  assert.equal(schema.cellKind(plain, 332), 'stairs', 'no lifts list: stairs');
  const stale = clone(plain);
  stale.lifts = [332];
  assert.equal(schema.cellKind(stale, 332, school().building), 'stairs', 'with the building, a stairs connection wins over a stale list');
});
