// Merge import, the engine (spec 13.2, ARCHITECTURE 21.6 and 21.10): the
// building part, the schedule part and the settings of a project file read
// already, each brought in alone as one undo step. Plain Node; nothing here
// reads the clock or the machine's time zone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, CURRENT_VERSION, CHECK_KINDS, defaultSettings } from '../../engine/schema.js';
import { FileError, writeProjectFile, readProjectFile, writeBuildingFile, readBuildingFile, writeScheduleFile, readScheduleFile, writeScheduleFile as writeSchedule, buildingPart, schedulePart, applySchedule, applySettings, raisePeriods, SETTINGS_TAKEN, SETTINGS_LEFT, wrongKindMessage } from '../../engine/project-file.js';
import { NEWER_VERSION_MESSAGE } from '../../engine/migrate.js';
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
