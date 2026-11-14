// Merge import, the engine (spec 13.2, ARCHITECTURE 21.6 and 21.10): the
// building part, the schedule part and the settings of a project file read
// already, each brought in alone as one undo step. Plain Node; nothing here
// reads the clock or the machine's time zone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, CURRENT_VERSION, CHECK_KINDS, CELL_CORRIDOR, defaultSettings } from '../../engine/schema.js';
import { FileError, writeProjectFile, readProjectFile, writeBuildingFile, readBuildingFile, writeScheduleFile, readScheduleFile, writeScheduleFile as writeSchedule, buildingPart, schedulePart, applySchedule, applySettings, raisePeriods, SETTINGS_TAKEN, SETTINGS_LEFT, wrongKindMessage } from '../../engine/project-file.js';
import { NEWER_VERSION_MESSAGE, NOT_A_PROJECT_MESSAGE } from '../../engine/migrate.js';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { exportFileName, buildExport } from '../../engine/exports.js';
import { sampleSchool } from '../../data/sample-school.js';
import { school, emptyProject, clone, makeIds, tickingClock, assertValid } from './helpers.mjs';
import { withEverything } from '../fixtures/day-types-calendar.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const IMAGES = { isample001: { data: PNG, type: 'image/png' } };

// undo restores everything but the store's own `modified` stamp
const sameBut = (a, b) => assert.deepEqual({ ...a, modified: '' }, { ...b, modified: '' });

const storeOf = (project) => createStore({ project, clock: tickingClock(), ids: makeIds(3) });

function traced() {
  const project = sampleSchool();
  project.building.floors[0].image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 1, height: 1, missing: false };
  assertValid(project);
  return project;
}

// A project file read, as the page holds it: { project, images, … }.
const readOf = (project, images) => readProjectFile(writeProjectFile(project, { images: images || {} }));

// ---------------------------------------------------------------- the two parts equal the round trips

const roundBuilding = (read) => readBuildingFile(writeBuildingFile(read.project, { images: read.images }));

test('buildingPart equals the building file round trip on the sample', () => {
  const read = readOf(sampleSchool());
  assert.deepEqual(buildingPart(read), roundBuilding(read));
});

test('buildingPart equals the round trip on a project with a traced image', () => {
  const read = readOf(traced(), IMAGES);
  const part = buildingPart(read);
  assert.deepEqual(part, roundBuilding(read));
  assert.deepEqual(part.images, IMAGES);
  assert.equal(part.file.building.floors[0].image.missing, false);
});

test('buildingPart equals the round trip on a project whose traced image is marked missing', () => {
  const project = traced();
  project.building.floors[0].image.missing = true;
  const read = readOf(project, {});
  const part = buildingPart(read);
  assert.deepEqual(part, roundBuilding(read));
  assert.deepEqual(part.images, {});
  assert.equal(part.file.building.floors[0].image.missing, true);
  // and bytes the file holds for an image marked missing put it on hand
  const held = readOf(project, IMAGES);
  assert.deepEqual(buildingPart(held), roundBuilding(held));
  assert.equal(buildingPart(held).file.building.floors[0].image.missing, false);
});

test('buildingPart carries only the subjects rooms use, as writeBuildingFile does', () => {
  const project = sampleSchool();
  project.subjects.push({ id: 'sunused000', code: 'ZZ', name: 'Unused', colour: '#336699' });
  assertValid(project);
  const read = readOf(project);
  const part = buildingPart(read);
  assert.deepEqual(part, roundBuilding(read));
  assert.ok(!part.file.subjects.some((subject) => subject.id === 'sunused000'));
});

const roundSchedule = (project) => readScheduleFile(writeScheduleFile(project));

test('schedulePart equals the schedule file round trip on the sample', () => {
  const project = readOf(sampleSchool()).project;
  assert.deepEqual(schedulePart(project), roundSchedule(project));
});

test('schedulePart equals the round trip with marks, duties and staggered dismissals', () => {
  const project = readOf(sampleSchool()).project;
  assert.ok(project.marks.length > 0 && project.duties.length > 0 && project.release.length > 0);
  const part = schedulePart(project);
  assert.deepEqual(part, roundSchedule(project));
  assert.equal(part.file.marks.length, project.marks.length);
  assert.equal(part.file.duties.length, project.duties.length);
  assert.equal(part.file.release.length, project.release.length);
});

test('schedulePart equals the round trip on a project with none of the later parts, and on day types and a calendar', () => {
  for (const project of [school(), emptyProject(), withEverything()]) {
    const read = readOf(project).project;
    assert.deepEqual(schedulePart(read), roundSchedule(read));
  }
  const plain = schedulePart(readOf(school()).project).file;
  assert.deepEqual([plain.bellSchedules, plain.calendar, plain.marks, plain.duties, plain.release], [[], null, [], [], []]);
});

// ---------------------------------------------------------------- applySettings

const KEYS = Object.keys(defaultSettings());

test('applySettings: the taken and the left lists are disjoint and cover defaultSettings() exactly', () => {
  assert.deepEqual([...SETTINGS_TAKEN, ...SETTINGS_LEFT].sort(), KEYS.slice().sort());
  assert.deepEqual(SETTINGS_TAKEN.filter((key) => SETTINGS_LEFT.includes(key)), []);
});

// A value of each setting that is not the default, and is allowed.
const OTHER = {
  schoolName: 'Northfield Middle',
  periods: 9,
  periodWord: 'Block',
  defaultPassingSeconds: 300,
  defaultHeadCount: 30,
  secondsPerCell: 2,
  secondsPerStair: 12,
  colourScale: { mode: 'absolute', bands: [5, 20, 40, 80] },
  checks: { consecutiveLimit: 3, passingMarginSeconds: 30, off: ['room-unused'] },
  timeFormat: '24h',
  paper: { size: 'a4', orientation: 'landscape' },
  theme: 'dark',
};

test('applySettings: iterating defaultSettings(), each key is taken or left as 21.10 says', () => {
  const base = emptyProject();
  base.settings.schoolName = '';
  for (const key of KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(OTHER, key), key + ' has a value to try');
    const result = applySettings(base, { [key]: OTHER[key] });
    assertValid(result.project, key);
    if (SETTINGS_TAKEN.includes(key)) {
      assert.deepEqual(result.project.settings[key], OTHER[key], key + ' is taken');
      assert.equal(result.summary.taken.length, 1, key);
      assert.deepEqual(result.summary.taken[0], { key, from: base.settings[key], to: OTHER[key] });
    } else {
      assert.deepEqual(result.project.settings[key], base.settings[key], key + ' is left');
      assert.deepEqual(result.summary.taken, [], key);
      assert.equal(result.project, base, key + ' changes nothing');
    }
  }
});

test('applySettings: a whole file leaves the device and building settings, and a cell scale or elevator number the file holds', () => {
  const base = emptyProject();
  base.settings.theme = 'light';
  base.settings.paper = { size: 'letter', orientation: 'portrait' };
  base.settings.cellScale = { unit: 'metres', length: 3 };
  const file = { ...OTHER, cellScale: { unit: 'feet', length: 10 }, elevatorWaitSeconds: 99, elevatorSecondsPerFloor: 9, elevatorPeoplePerTrip: 5 };
  const { project } = applySettings(base, file);
  assert.equal(project.settings.theme, 'light');
  assert.deepEqual(project.settings.paper, { size: 'letter', orientation: 'portrait' });
  assert.deepEqual(project.settings.cellScale, { unit: 'metres', length: 3 });
  assert.equal(project.settings.secondsPerCell, base.settings.secondsPerCell);
  assert.equal(project.settings.secondsPerStair, base.settings.secondsPerStair);
  assert.equal(project.settings.elevatorWaitSeconds, undefined);
  assert.equal(project.settings.periodWord, 'Block');
  assertValid(project);
});

test('applySettings: a key the file does not hold leaves the value here', () => {
  const base = emptyProject();
  base.settings.periodWord = 'Mod';
  base.settings.defaultHeadCount = 22;
  const result = applySettings(base, { timeFormat: '24h' });
  assert.equal(result.project.settings.periodWord, 'Mod');
  assert.equal(result.project.settings.defaultHeadCount, 22);
  assert.equal(result.project.settings.timeFormat, '24h');
  assert.deepEqual(result.summary.taken.map((taken) => taken.key), ['timeFormat']);
  // a check's own part absent leaves that part
  const partial = applySettings(base, { checks: { consecutiveLimit: 2 } });
  assert.deepEqual(partial.project.settings.checks, { consecutiveLimit: 2, passingMarginSeconds: 0, off: [] });
  // an empty file changes nothing and is the project itself
  assert.equal(applySettings(base, {}).project, base);
});

test('applySettings: checks.off is filtered to the kinds this version knows, and colourScale is taken whole', () => {
  const base = emptyProject();
  const { project } = applySettings(base, { checks: { consecutiveLimit: 4, passingMarginSeconds: 0, off: ['room-unused', 'a-check-from-the-future', 'room-unused', CHECK_KINDS[0]] }, colourScale: { mode: 'absolute', bands: [1, 2, 3, 4] } });
  assert.deepEqual(project.settings.checks.off, ['room-unused', CHECK_KINDS[0]]);
  assert.deepEqual(project.settings.colourScale, { mode: 'absolute', bands: [1, 2, 3, 4] });
  assertValid(project);
});

test('applySettings: the school name is taken only when this project has none', () => {
  const named = emptyProject();
  named.settings.schoolName = 'Our School';
  assert.equal(applySettings(named, { schoolName: 'Their School' }).project.settings.schoolName, 'Our School');
  const blank = emptyProject();
  blank.settings.schoolName = '   ';
  assert.equal(applySettings(blank, { schoolName: 'Their School' }).project.settings.schoolName, 'Their School');
  assert.equal(applySettings(blank, { schoolName: '  ' }).project, blank);
});

test('applySettings: periods are raised through the helper applySchedule uses, padding every day, and never lowered', () => {
  const base = readOf(sampleSchool()).project;
  assert.equal(base.settings.periods, 8);
  const raised = applySettings(base, { periods: 10 });
  assert.deepEqual(raised.summary.periodsRaised, { from: 8, to: 10 });
  assert.equal(raised.summary.periodsStay, null);
  assert.deepEqual(raised.summary.taken, [{ key: 'periods', from: 8, to: 10 }]);
  assertValid(raised.project);
  assert.equal(raised.project.settings.periods, 10);
  for (const dayType of raised.project.dayTypes) assert.equal(dayType.bells.length, 10);
  for (const g of raised.project.groups) for (const day of Object.values(g.days)) assert.equal(day.length, 10);
  for (const schedule of raised.project.bellSchedules) assert.equal(schedule.bells.length, 10);
  // the same helper, so the same result as the schedule import's
  assert.deepEqual(raised.project, raisePeriods(base, 10));
  const file = clone(schedulePart(base).file);
  file.settings.periods = 10;
  const viaSchedule = applySchedule(base, file, { policy: undefined, takeSettings: false, ids: makeIds(5), clock: () => new Date('2026-09-01T12:00:00Z') });
  assert.deepEqual(viaSchedule.project.settings.periods, 10);
  assert.deepEqual(viaSchedule.project.dayTypes.map((d) => d.bells.length), raised.project.dayTypes.map((d) => d.bells.length));
  assert.deepEqual(viaSchedule.project.groups, raised.project.groups);
  assert.deepEqual(viaSchedule.project.bellSchedules, raised.project.bellSchedules);

  // fewer in the file: the project stays at 8, and says so
  const fewer = applySettings(base, { periods: 6 });
  assert.equal(fewer.project, base);
  assert.deepEqual(fewer.summary, { taken: [], periodsRaised: null, periodsStay: { at: 8, file: 6 } });
  // the same: nothing to say
  assert.deepEqual(applySettings(base, { periods: 8 }).summary, { taken: [], periodsRaised: null, periodsStay: null });
});

test('applySettings: a project is left alone when the result would not hold', () => {
  const base = emptyProject();
  assert.throws(() => applySettings(base, { defaultHeadCount: -4 }), (error) => error instanceof FileError && error.code === 'invalid');
  assert.throws(() => applySettings(base, null), (error) => error instanceof FileError);
  assert.equal(base.settings.defaultHeadCount, defaultSettings().defaultHeadCount);
});

// ---------------------------------------------------------------- importPart

const bring = (store, part, read, extra) => store.apply(actions.importPart, { part, read, fileName: 'next-year.json', ...extra });

test('importPart building: one undo step, labelled, with the summary, and undo puts everything back', () => {
  const project = school();
  const store = storeOf(project);
  const other = readOf(traced(), IMAGES);
  const after = bring(store, 'building', other);
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Bring in the building from next-year.json');
  assert.deepEqual([store.geometryVersion > 0, store.buildingVersion, store.scheduleVersion], [true, 1, 1]);
  assertValid(after);
  assert.deepEqual(after.building, buildingPart(other).file.building);
  const outcome = store.undoOutcome;
  assert.equal(outcome.part, 'building');
  assert.equal(typeof outcome.slotsKept, 'number');
  // the schedule here stays
  assert.equal(after.groups.length, project.groups.length);
  store.undo();
  assert.equal(store.project.building, project.building);
  sameBut(store.project, project);
});

test('importPart schedule: one undo step, takes the schedule and not the settings, and asks the policy', () => {
  const project = school();
  project.settings.periodWord = 'Mod';
  const store = storeOf(project);
  const other = readOf(sampleSchool());
  const after = bring(store, 'schedule', other, { policy: { all: 'skip' } });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Bring in the schedule from next-year.json');
  assertValid(after);
  assert.equal(after.settings.periodWord, 'Mod');
  assert.equal(store.undoOutcome.part, 'schedule');
  assert.ok(after.marks.length > 0 || after.duties.length > 0);
  store.undo();
  sameBut(store.project, project);
});

test('importPart schedule: marks and duties of the file that clash are answered by the policy', () => {
  const project = readOf(sampleSchool()).project;
  const same = readOf(sampleSchool());
  same.project.marks[0] = { ...same.project.marks[0], label: 'Early lunch' };
  const kept = storeOf(project);
  bring(kept, 'schedule', same, { policy: { all: 'skip' } });
  assert.equal(kept.project.marks[0].label, '');
  const replaced = storeOf(project);
  bring(replaced, 'schedule', same, { policy: { all: 'overwrite' } });
  assert.equal(replaced.project.marks[0].label, 'Early lunch');
  assert.equal(replaced.undoOutcome.marksReplaced, 1);
  assert.equal(replaced.undoOutcome.part, 'schedule');
  assert.throws(() => bring(storeOf(project), 'schedule', same, { policy: { all: 'replace' } }), (error) => error instanceof actions.ActionError && error.code === 'bad-policy');
});

test('importPart settings: one undo step, takes the settings, and undo puts them back', () => {
  const project = emptyProject();
  const store = storeOf(project);
  const source = emptyProject();
  source.settings = { ...source.settings, ...OTHER, schoolName: 'Northfield Middle' };
  const other = readOf(raisePeriods({ ...source, settings: { ...source.settings, periods: 8 } }, 9));
  const after = bring(store, 'settings', other);
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Bring in the settings from next-year.json');
  assertValid(after);
  assert.equal(after.settings.periods, 9);
  assert.equal(after.settings.timeFormat, '24h');
  assert.equal(after.settings.theme, project.settings.theme);
  const outcome = store.undoOutcome;
  assert.equal(outcome.part, 'settings');
  assert.deepEqual(outcome.periodsRaised, { from: 8, to: 9 });
  assert.ok(outcome.taken.some((taken) => taken.key === 'periodWord'));
  store.undo();
  sameBut(store.project, project);
  store.redo();
  assert.equal(store.project.settings.periods, 9);
});

test('importPart: a file whose project id is another project\'s is fine, and takes no id', () => {
  const project = school();
  const other = readOf(sampleSchool());
  other.project.id = 'pother0001';
  other.project.settings.periodWord = 'Block';
  assert.notEqual(other.project.id, project.id);
  const store = storeOf(project);
  for (const part of ['building', 'schedule', 'settings']) {
    bring(store, part, other, { policy: { all: 'skip' } });
    assert.equal(store.project.id, project.id);
  }
  assert.equal(store.history.past.length, 3);
});

test('importPart: a file that changes nothing makes no undo entry', () => {
  const project = readOf(sampleSchool()).project;
  const store = storeOf(project);
  bring(store, 'settings', readOf(project));
  assert.equal(store.history.past.length, 0);
});

test('importPart: refused before anything changes, whatever the part', () => {
  const project = school();
  const store = storeOf(project);
  const read = readOf(sampleSchool());
  const refused = (payload, test) => {
    assert.throws(() => store.apply(actions.importPart, payload), (error) => error instanceof actions.ActionError && test(error));
    assert.equal(store.project, project);
    assert.equal(store.history.past.length, 0);
    assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 0, 0]);
  };
  refused({ read }, (error) => error.code === 'bad-value');
  refused({ part: 'groups', read }, (error) => error.code === 'bad-value');
  refused({ part: 'building' }, (error) => /no project file/.test(error.message));
  refused({ part: 'settings', read: {} }, (error) => /no project file/.test(error.message));
  refused({ part: 'schedule', read, policy: { all: 'replace' } }, (error) => error.code === 'bad-policy');
  // a file that did not hold, however it got here
  const broken = clone(read);
  broken.project.settings.defaultHeadCount = -4;
  refused({ part: 'settings', read: broken }, (error) => error.code === 'invalid');
});

test('importPart: a newer file and one of another kind are refused in the reader\'s words', () => {
  const project = school();
  const store = storeOf(project);
  const text = writeProjectFile(sampleSchool(), { images: {} });
  const newer = JSON.stringify({ ...JSON.parse(text), version: CURRENT_VERSION + 1 });
  assert.throws(() => store.apply(actions.importPart, { part: 'building', text: newer }), (error) => error instanceof actions.ActionError && error.message === NEWER_VERSION_MESSAGE && error.code === 'newer-version');
  const building = writeBuildingFile(sampleSchool(), { images: {} });
  assert.throws(() => store.apply(actions.importPart, { part: 'building', text: building }), (error) => error instanceof actions.ActionError && error.message === wrongKindMessage('sv2-building', FORMAT) && error.code === 'wrong-kind');
  assert.match(wrongKindMessage('sv2-building', FORMAT), /^This is a building file, not a project file\./);
  const schedule = writeSchedule(sampleSchool());
  assert.throws(() => store.apply(actions.importPart, { part: 'schedule', text: schedule }), (error) => error.message === wrongKindMessage('sv2-schedule', FORMAT));
  assert.throws(() => store.apply(actions.importPart, { part: 'settings', text: 'not json {' }), (error) => error.code === 'not-json');
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
  // and the text of a good project file is read here, then brought in
  const after = store.apply(actions.importPart, { part: 'settings', text: JSON.stringify({ ...JSON.parse(text), settings: { ...JSON.parse(text).settings, periodWord: 'Hour' } }), fileName: 'x.json' });
  assert.equal(after.settings.periodWord, 'Hour');
});

test('importPart: names are carried as typed, never as markup', () => {
  const source = sampleSchool();
  source.settings.schoolName = 'Écôle <"Nord"> & Söhne 北校';
  source.groups[0].name = 'The "Owls", <9A>';
  const read = readOf(source);
  const blank = emptyProject();
  blank.settings.schoolName = '';
  const store = storeOf(blank);
  bring(store, 'settings', read);
  assert.equal(store.project.settings.schoolName, 'Écôle <"Nord"> & Söhne 北校');
  const withFile = storeOf(emptyProject());
  bring(withFile, 'schedule', read, { policy: { all: 'skip' } });
  assert.ok(withFile.project.groups.some((g) => g.name === 'The "Owls", <9A>'));
  const labelled = storeOf(emptyProject());
  bring(labelled, 'settings', read);
  assert.equal(labelled.undoLabel, 'Bring in the settings from next-year.json');
  const hostile = labelled.apply(actions.importPart, { part: 'settings', read: readOf(raisePeriods(source, 12)), fileName: '<b>"x"</b>.json' });
  assert.equal(labelled.undoLabel, 'Bring in the settings from <b>"x"</b>.json');
  assertValid(hostile);
});

// ---------------------------------------------------------------- the export file name

test('exportFileName: the label joins the name only when the caller says more than one project is kept', () => {
  const project = sampleSchool();
  project.settings.schoolName = 'Northfield Middle';
  project.label = 'Next year';
  // the pinned names stay
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14'), 'Northfield Middle - project - 2026-11-14.json');
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14', {}), 'Northfield Middle - project - 2026-11-14.json');
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14', { label: false }), 'Northfield Middle - project - 2026-11-14.json');
  assert.equal(exportFileName(project, 'groups', 'csv', '2026-11-14', { label: true }), 'Northfield Middle - Next year - groups - 2026-11-14.csv');
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14', { label: true }), 'Northfield Middle - Next year - project - 2026-11-14.json');
  // a blank or absent label changes nothing
  project.label = '  ';
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14', { label: true }), 'Northfield Middle - project - 2026-11-14.json');
  delete project.label;
  assert.equal(exportFileName(project, 'project', 'json', '2026-11-14', { label: true }), 'Northfield Middle - project - 2026-11-14.json');
});

test('exportFileName: the label is cleaned like the school, and with no school the tool\'s name stands', () => {
  const project = emptyProject();
  project.settings.schoolName = '';
  project.label = 'This/that: <draft>?';
  assert.equal(exportFileName(project, 'schedule', 'json', '2026-11-14', { label: true }), 'Schedule Visualizer 2 - This that draft - schedule - 2026-11-14.json');
  assert.equal(exportFileName(project, 'schedule', 'json', '2026-11-14'), 'Schedule Visualizer 2 - schedule - 2026-11-14.json');
  project.label = 'x'.repeat(60);
  assert.equal(exportFileName(project, 'schedule', 'json', '2026-11-14', { label: true }), 'Schedule Visualizer 2 - ' + 'x'.repeat(60) + ' - schedule - 2026-11-14.json');
});

test('buildExport passes the label option to the file name and not to the file', () => {
  const project = sampleSchool();
  project.settings.schoolName = 'Northfield Middle';
  project.label = 'Next year';
  const plain = buildExport(project, 'project', { date: '2026-11-14', images: {} });
  const labelled = buildExport(project, 'project', { date: '2026-11-14', images: {}, label: true });
  assert.equal(plain.fileName, 'Northfield Middle - project - 2026-11-14.json');
  assert.equal(labelled.fileName, 'Northfield Middle - Next year - project - 2026-11-14.json');
  assert.equal(plain.text, labelled.text);
});

// ---------------------------------------------------------------- SV2-119b: the guards the review asked for

const refusedInvalid = (what) => (error) => error instanceof FileError && error.code === 'invalid' && error.message.includes('settings.' + what);

test('applySettings: a value of the wrong type or out of range refuses the whole import, naming the setting', () => {
  const base = emptyProject();
  const bad = [
    ['periods', '12'], ['periods', 12.5], ['periods', 99], ['periods', 0], ['periods', null],
    ['periodWord', 'Class'], ['defaultPassingSeconds', 'x'], ['defaultPassingSeconds', 5000], ['defaultHeadCount', 0], ['defaultHeadCount', 25.5],
    ['timeFormat', '36h'], ['schoolName', 7],
    ['checks', 'all'], ['checks', null], ['checks', [1]], ['checks', { consecutiveLimit: '4' }], ['checks', { passingMarginSeconds: 601 }], ['checks', { off: 'room-unused' }], ['checks', { off: [4] }],
    ['colourScale', 'relative'], ['colourScale', null], ['colourScale', { mode: 'logarithmic' }], ['colourScale', { mode: 'absolute', bands: [1, 2, 3] }], ['colourScale', { bands: [4, 3, 2, 1] }],
  ];
  for (const [key, value] of bad) {
    // with a good key beside it, which must not be taken either
    assert.throws(() => applySettings(base, { timeFormat: '24h', [key]: value }), refusedInvalid(key), key + ' = ' + JSON.stringify(value));
  }
  // the same through the action: nothing changes, nothing is counted
  const store = storeOf(base);
  for (const [key, value] of [['periods', '12'], ['periods', 99], ['checks', 'x'], ['colourScale', 5]]) {
    assert.throws(() => bring(store, 'settings', { project: { ...base, settings: { ...base.settings, [key]: value } } }), (error) => error instanceof actions.ActionError && error.code === 'invalid' && error.message.includes('settings.' + key));
  }
  assert.equal(store.project, base);
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion, store.history.past.length], [0, 0, 0, 0]);
  // a key a file holds that is wrong is refused even where this project would not have taken it
  const named = emptyProject();
  named.settings.schoolName = 'Ours';
  assert.throws(() => applySettings(named, { schoolName: 4 }), refusedInvalid('schoolName'));
});

test('applySettings: periods out of range are refused before the days are padded', () => {
  const base = readOf(sampleSchool()).project;
  assert.throws(() => applySettings(base, { periods: 17 }), refusedInvalid('periods'));
  assert.equal(raisePeriods(base, 8), base);
});

test('applySettings: the colour scale is rebuilt as { mode, bands } and the checks from their known keys', () => {
  const base = emptyProject();
  const { project } = applySettings(base, { colourScale: { mode: 'absolute', bands: [1, 2, 3, 4], extra: 'x' }, checks: { consecutiveLimit: 3, passingMarginSeconds: 10, off: [], extra: 1 } });
  assert.deepEqual(Object.keys(project.settings.colourScale).sort(), ['bands', 'mode']);
  assert.deepEqual(Object.keys(project.settings.checks).sort(), ['consecutiveLimit', 'off', 'passingMarginSeconds']);
  assertValid(project);
  // a part the file's colour scale lacks stays what it is here
  const mode = applySettings(base, { colourScale: { mode: 'absolute' } }).project;
  assert.deepEqual(mode.settings.colourScale, { mode: 'absolute', bands: base.settings.colourScale.bands });
});

test('applySettings: "changed" is by value, not by the order of an object\'s keys', () => {
  const base = emptyProject();
  base.settings.colourScale = { mode: 'absolute', bands: [1, 2, 3, 4] };
  base.settings.checks = { off: [], passingMarginSeconds: 0, consecutiveLimit: 4 };
  const result = applySettings(base, { colourScale: { bands: [1, 2, 3, 4], mode: 'absolute' }, checks: { consecutiveLimit: 4, passingMarginSeconds: 0, off: [] } });
  assert.equal(result.project, base);
  assert.deepEqual(result.summary.taken, []);
});

test('previewPart: the summary without applying, for every part, even when nothing would change', () => {
  const project = readOf(sampleSchool()).project;
  const store = storeOf(project);
  // a settings file that changes only periodsStay: no undo entry, the summary all the same
  const fewer = readOf(clone(project));
  fewer.project.settings.periods = 6;
  assert.deepEqual(actions.previewPart(project, fewer, 'settings'), { part: 'settings', taken: [], periodsRaised: null, periodsStay: { at: 8, file: 6 } });
  bring(store, 'settings', fewer);
  assert.equal(store.history.past.length, 0);
  assert.equal(store.undoOutcome, null);
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 0, 0]);
  // nothing taken and nothing staying
  assert.deepEqual(actions.previewPart(project, readOf(project), 'settings'), { part: 'settings', taken: [], periodsRaised: null, periodsStay: null });
  // the building's and the schedule's summaries are what importPart's outcome carries
  const target = school();
  const other = readOf(traced(), IMAGES);
  const before = clone(target);
  const preview = actions.previewPart(target, other, 'building');
  assert.deepEqual(target, before, 'the project is not touched');
  assert.deepEqual([preview.part, preview.leversDropped, preview.changesUnmatched], ['building', 0, 0]);
  const applied = storeOf(target);
  bring(applied, 'building', other);
  assert.deepEqual(applied.undoOutcome, preview);
  const schedulePreview = actions.previewPart(target, readOf(sampleSchool()), 'schedule', { policy: { all: 'skip' } });
  const scheduled = storeOf(target);
  bring(scheduled, 'schedule', readOf(sampleSchool()), { policy: { all: 'skip' } });
  assert.deepEqual(scheduled.undoOutcome, schedulePreview);
  // and it refuses as the action does
  assert.throws(() => actions.previewPart(target, other, 'groups'), (error) => error instanceof actions.ActionError && error.code === 'bad-value');
  assert.throws(() => actions.previewPart(target, {}, 'settings'), (error) => error instanceof actions.ActionError && /no project file/.test(error.message));
});

test('importPart: the counters each part moves, and settings move them by the keys actually taken', () => {
  const counters = (store) => [store.geometryVersion, store.buildingVersion, store.scheduleVersion];
  const building = storeOf(school());
  bring(building, 'building', readOf(traced(), IMAGES));
  assert.deepEqual(counters(building), [1, 1, 1]);
  const schedule = storeOf(school());
  bring(schedule, 'schedule', readOf(sampleSchool()), { policy: { all: 'skip' } });
  assert.deepEqual(counters(schedule), [0, 1, 1]);
  // settings: [what the file changes, does it move the schedule]
  const cases = [
    [{ periods: 9 }, true], [{ periodWord: 'Block' }, true], [{ defaultPassingSeconds: 300 }, true], [{ defaultHeadCount: 30 }, true],
    [{ checks: { consecutiveLimit: 3, passingMarginSeconds: 0, off: [] } }, true], [{ checks: { consecutiveLimit: 4, passingMarginSeconds: 0, off: ['room-unused'] } }, true],
    [{ timeFormat: '24h' }, false], [{ colourScale: { mode: 'absolute', bands: [1, 2, 3, 4] } }, false], [{ schoolName: 'Northfield Middle' }, false],
  ];
  for (const [change, moves] of cases) {
    const base = emptyProject();
    base.settings.schoolName = '';
    // a periods change needs the days padded, as the real file would have them
    const source = change.periods ? readOf(raisePeriods(base, change.periods)) : readOf({ ...base, settings: { ...base.settings, ...change } });
    const store = storeOf(base);
    bring(store, 'settings', source);
    assert.equal(store.history.past.length, 1, JSON.stringify(change));
    assert.deepEqual(counters(store), [0, 0, moves ? 1 : 0], JSON.stringify(change));
  }
  // several keys: moves the schedule when any does, and never the geometry
  const base = emptyProject();
  const many = storeOf(base);
  bring(many, 'settings', readOf({ ...base, settings: { ...base.settings, timeFormat: '24h', defaultHeadCount: 40 } }));
  assert.deepEqual(counters(many), [0, 0, 1]);
  // a file that takes nothing moves nothing
  const none = storeOf(base);
  bring(none, 'settings', readOf(base));
  assert.deepEqual(counters(none), [0, 0, 0]);
});

test('importPart: a read lacking the building, the settings or the subjects is refused in the reader\'s words, not thrown', () => {
  const project = school();
  const store = storeOf(project);
  const whole = readOf(sampleSchool());
  const variants = [
    (read) => { delete read.project.building.floors; },
    (read) => { read.project.building = null; },
    (read) => { delete read.project.settings; },
    (read) => { read.project.settings = []; },
    (read) => { delete read.project.subjects; },
  ];
  for (const part of ['building', 'schedule', 'settings']) {
    for (const spoil of variants) {
      const read = clone(whole);
      spoil(read);
      assert.throws(() => bring(store, part, read, { policy: { all: 'skip' } }), (error) => error instanceof actions.ActionError && error.code === 'bad-value' && error.message === NOT_A_PROJECT_MESSAGE, part);
      assert.throws(() => actions.previewPart(project, read, part), (error) => error instanceof actions.ActionError && error.code === 'bad-value');
    }
  }
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
});

test('importPart: the text of a project file brings in each part', () => {
  const text = writeProjectFile(traced(), { images: IMAGES });
  const building = storeOf(school());
  const after = building.apply(actions.importPart, { part: 'building', text, fileName: 'a.json' });
  assert.deepEqual(after.building, buildingPart(readProjectFile(text)).file.building);
  assert.equal(building.undoOutcome.part, 'building');
  const schedule = storeOf(school());
  schedule.apply(actions.importPart, { part: 'schedule', text: writeProjectFile(sampleSchool(), { images: {} }), policy: { all: 'skip' } });
  assert.equal(schedule.history.past.length, 1);
  assert.equal(schedule.undoLabel, 'Bring in the schedule from a project file');
  assert.ok(schedule.project.marks.length > 0);
});

test('importPart building: an image the file holds the bytes of is on hand, whatever the project said', () => {
  // the page holds a read whose project says missing while its images hold the bytes
  const held = readOf(traced(), IMAGES);
  held.project = clone(held.project);
  held.project.building.floors[0].image.missing = true;
  assert.equal(held.project.building.floors[0].image.missing, true);
  const store = storeOf(school());
  const after = bring(store, 'building', held);
  assert.equal(after.building.floors[0].image.missing, false);
  assert.equal(actions.previewPart(school(), held, 'building').part, 'building');
  // and bytes it does not hold put it missing, for a project that said it was on hand
  const lacking = readOf(traced(), IMAGES);
  lacking.images = {};
  assert.equal(bring(storeOf(school()), 'building', lacking).building.floors[0].image.missing, true);
});

test('schedulePart: a duty\'s room, the teachers\' rooms and a calendar naming a bell schedule are in the file', () => {
  const project = readOf(sampleSchool()).project;
  const part = schedulePart(project);
  assert.deepEqual(part, roundSchedule(project));
  const indexed = new Set(part.file.rooms.map((room) => room.id));
  const dutyRoom = project.duties.find((duty) => typeof duty.roomId === 'string');
  assert.ok(dutyRoom, 'the sample has a duty in a room');
  assert.ok(indexed.has(dutyRoom.roomId));
  for (const teacher of project.teachers) for (const roomId of teacher.roomIds) assert.ok(indexed.has(roomId), roomId);
  const named = part.file.calendar.weekdays.map((rule) => rule.bells).filter((bells) => typeof bells === 'string' && bells !== 'regular');
  assert.ok(named.length > 0 && named.every((id) => part.file.bellSchedules.some((schedule) => schedule.id === id)));
  // every room in the index has the number the building gives it
  for (const room of part.file.rooms) assert.ok(project.building.floors.some((floor) => floor.spaces.some((space) => space.id === room.id && space.number === room.number)));
});

test('importPart schedule: raising the periods pads the bell schedules, the day types and the groups, and the calendar still holds', () => {
  const base = readOf(sampleSchool()).project;
  assert.ok(base.calendar && base.bellSchedules.length > 0);
  const longer = readOf(raisePeriods(clone(base), 10));
  const store = storeOf(base);
  const after = bring(store, 'schedule', longer, { policy: { all: 'skip' } });
  assertValid(after);
  assert.equal(after.settings.periods, 10);
  for (const schedule of after.bellSchedules) assert.equal(schedule.bells.length, 10);
  for (const dayType of after.dayTypes) assert.equal(dayType.bells.length, 10);
  for (const g of after.groups) for (const day of Object.values(g.days)) assert.equal(day.length, 10);
  assert.deepEqual(after.calendar.weekdays.map((rule) => rule.bells), base.calendar.weekdays.map((rule) => rule.bells));
  assert.deepEqual(store.undoOutcome.periodsRaised, { from: 8, to: 10 });
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 1, 1]);
  store.undo();
  sameBut(store.project, base);
});

// ---------------------------------------------------------------- the open and the kept scenarios follow an import

const move = (groupId, period, roomId) => ({ kind: 'move', dayTypeId: 'dsample00a', groupId, period, roomId });
const GONE = { floor: 'fgone00000', room: 'rgone00000', connection: 'cgone00000' };

// A project with an open and a kept scenario, each with levers, some of which
// name what the building in the file has and some what it does not.
function withScenarios() {
  const project = sampleSchool();
  const floor = project.building.floors[0];
  const corridor = floor.corridors[0].cells.slice(0, 2);
  const wall = Array.from(floor.cells).findIndex((cell) => cell !== CELL_CORRIDOR);
  assert.ok(corridor.every((cell) => Array.from(floor.cells)[cell] === CELL_CORRIDOR) && wall >= 0);
  const levers = (suffix) => [
    { kind: 'corridor', floorId: floor.id, cells: corridor, name: 'kept ' + suffix },
    { kind: 'corridor', floorId: floor.id, cells: [corridor[0], wall], name: 'not all corridor ' + suffix },
    { kind: 'corridor', floorId: GONE.floor, cells: [1, 2], name: 'floor gone ' + suffix },
    { kind: 'way', connectionId: 'csample00a', way: 'closed' },
    { kind: 'way', connectionId: GONE.connection, way: 'closed' },
    { kind: 'capacity', roomId: 'rsample203', capacity: 12 },
    { kind: 'capacity', roomId: GONE.room, capacity: 12 },
    { kind: 'headCount', groupId: 'gsample06a', headCount: 20 },
  ];
  project.scenario = { id: 'eopen00001', name: 'Open', changes: [move('gsample07c', 1, 'rsample204'), move('gsample07c', 2, GONE.room)], compared: null, levers: levers('open') };
  project.scenarios = [{ id: 'ekept00001', name: 'Kept', changes: [move('gsample06a', 1, GONE.room), move('gsample06a', 2, GONE.room)], compared: null, levers: levers('kept').slice(0, 7) }];
  assertValid(project);
  return project;
}

const KEPT_LEVERS = ['kept', 'way:csample00a', 'capacity:rsample203'];
const leverNames = (levers) => levers.map((lever) => (lever.kind === 'corridor' ? lever.name.split(' ')[0] === 'kept' ? 'kept' : lever.name : lever.kind + ':' + (lever.connectionId || lever.roomId || lever.groupId)));

test('importPart building: levers on what the new building no longer has are dropped, in the open and the kept scenario, and counted', () => {
  const project = withScenarios();
  const store = storeOf(project);
  const after = bring(store, 'building', readOf(sampleSchool()));
  assertValid(after);
  assert.deepEqual(leverNames(after.scenario.levers), ['kept', 'way:csample00a', 'capacity:rsample203', 'headCount:gsample06a']);
  assert.deepEqual(leverNames(after.scenarios[0].levers), ['kept', 'way:csample00a', 'capacity:rsample203']);
  // the open one lost 4, the kept one 4 of its 7
  const outcome = store.undoOutcome;
  assert.equal(outcome.leversDropped, 4 + 4);
  // moves whose room is gone stay, and are counted: one in the open, two in the kept
  assert.equal(outcome.changesUnmatched, 3);
  assert.equal(after.scenario.changes.length, 2);
  assert.equal(after.scenarios[0].changes.length, 2);
  assert.deepEqual(actions.previewPart(project, readOf(sampleSchool()), 'building').leversDropped, 8);
  store.undo();
  sameBut(store.project, project);
});

test('importPart building: a scenario whose levers all stay is the very same object, and none are counted', () => {
  const project = sampleSchool();
  project.scenario = { id: 'eopen00001', name: 'Open', changes: [], compared: null, levers: [{ kind: 'capacity', roomId: 'rsample203', capacity: 12 }] };
  project.scenarios = [{ id: 'ekept00001', name: 'Kept', changes: [], compared: null }];
  const store = storeOf(project);
  const after = bring(store, 'building', readOf(sampleSchool()));
  assert.equal(after.scenario, project.scenario);
  assert.equal(after.scenarios[0], project.scenarios[0]);
  assert.equal(store.undoOutcome.leversDropped, 0);
  assert.equal(store.undoOutcome.changesUnmatched, 0);
});

test('importPart schedule: the open and the kept scenarios keep naming the groups and day types they named', () => {
  // The schedule import never changes the id of a group or a day type this
  // project has, so a scenario's references stay; a group the file brings
  // under a new id (its name is new, its id taken here) gets none of them.
  const project = withScenarios();
  project.scenario.changes.push({ kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample08a', periodA: 1, periodB: 2 });
  project.scenarios[0].levers.push({ kind: 'release', who: { groups: ['gsample06a'] }, seconds: 60, after: null, dayTypeIds: ['dsample00b'] });
  const source = sampleSchool();
  source.groups[0] = { ...source.groups[0], name: 'Brand new group' };
  const read = readOf(source);
  const store = storeOf(project);
  const after = bring(store, 'schedule', read, { policy: { all: 'skip' } });
  assertValid(after);
  assert.equal(after.groups.length, project.groups.length + 1);
  const added = after.groups.find((group) => group.name === 'Brand new group');
  assert.notEqual(added.id, 'gsample06a');
  assert.equal(after.scenario, project.scenario, 'the open scenario is untouched');
  assert.equal(after.scenarios[0], project.scenarios[0], 'and so is the kept one');
  for (const scenario of [after.scenario, ...after.scenarios]) {
    for (const change of scenario.changes) {
      assert.ok(after.groups.some((group) => group.id === change.groupId) && after.dayTypes.some((dayType) => dayType.id === change.dayTypeId), 'a change still names a group and a day type that are here');
      assert.notEqual(change.groupId, added.id);
    }
  }
  assert.equal(JSON.stringify(after.scenarios).includes(added.id), false);
});

// ---------------------------------------------------------------- the export file name, the corners

test('exportFileName: a label of dots only is no label, and one longer than 60 that ends on a dot stays 60 long', () => {
  const project = emptyProject();
  project.settings.schoolName = 'Northfield';
  const named = (label) => {
    project.label = label;
    return exportFileName(project, 'project', 'json', '2026-11-14', { label: true });
  };
  const plain = 'Northfield - project - 2026-11-14.json';
  assert.equal(named('...'), plain);
  assert.equal(named(' . .. '), plain);
  assert.equal(named('.'), plain);
  const long = named('x'.repeat(59) + '..abc');
  assert.equal(long, 'Northfield - ' + 'x'.repeat(59) + '. - project - 2026-11-14.json');
  const middle = long.slice('Northfield - '.length, long.indexOf(' - project'));
  assert.equal(middle.length, 60);
  assert.ok(long.endsWith('.json') && !/[. ]\.json$/.test(long));
  assert.equal(named('x'.repeat(70) + '.'), 'Northfield - ' + 'x'.repeat(60) + ' - project - 2026-11-14.json');
});
