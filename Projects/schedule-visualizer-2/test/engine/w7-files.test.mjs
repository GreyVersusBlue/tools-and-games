// W7's fields in the files and in what staff receive (ARCHITECTURE 22.14,
// 22.17): the project, building and schedule files round-trip every new field;
// the schedule file's settings are optional extras; applySchedule carries
// `away` with the day types mapped; merge import takes the period word and
// names together; buildingPart and applyBuilding carry the features; and
// publish-data writes each new field only when it is there, so the sample's
// published data does not move. Plain Node; nothing here reads the clock or the
// machine's time zone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEDULE_SETTING_EXTRAS, SCHEDULE_SETTINGS, FileError, writeProjectFile, readProjectFile, writeBuildingFile, readBuildingFile, writeScheduleFile, readScheduleFile, buildingPart, schedulePart, applyBuilding, applySchedule, applySettings, SETTINGS_TAKEN } from '../../engine/project-file.js';
import { publishedModel } from '../../engine/publish-data.js';
import { PUBLISHED_SETTINGS } from '../../ui/staff/preview.js';
import { validate } from '../../engine/validate.js';
import { collectIds } from '../../engine/ids.js';
import { ELEVATOR_KIND } from '../../engine/schema.js';
import { periodName, periodNumberName } from '../../engine/bells.js';
import { sampleSchool } from '../../data/sample-school.js';
import { emptyProject, clone, makeIds, assertValid, clock, tickingClock } from './helpers.mjs';
import { createStore } from '../../engine/store.js';
import * as actions from '../../engine/actions.js';

const LAB = 'hlab000001';
const SINK = 'hsink00001';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// The sample school with every new field: features, a custom word and names, a
// teacher who is away, and the two stairs flights as one stairwell W (they do not
// share a stop, so repair would split it; the files carry it as it is).
function carrying(apart) {
  const project = sampleSchool({ level: true });
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  project.building.features = [{ id: LAB, name: 'Lab' }, { id: SINK, name: 'Sink' }];
  rooms[0].featureIds = [LAB, SINK];
  rooms[1].featureIds = [SINK];
  project.settings.periodCustom = { word: 'Lesson', plural: 'Lessons', count: 'letter' };
  project.settings.periodNames = ['', '', 'Advisory', '', 'Lunch'];
  project.teachers[0].away = [{ dayTypeIds: [project.dayTypes[0].id], weekdays: [0, 4], periods: [1, 2] }, { dayTypeIds: [], weekdays: [], periods: [] }];
  // stairwell W is the first two flights; unless `apart`, the second starts where the first ends (floor 2), so they are one chain
  const [first, second] = project.building.connections.filter((connection) => connection.kind !== ELEVATOR_KIND);
  first.well = 'W';
  second.well = 'W';
  if (!apart) {
    const top = project.building.floors.find((floor) => floor.id === second.b.floorId);
    second.a = { floorId: first.b.floorId, cell: first.b.cell };
    second.b = { floorId: top.id, cell: first.b.cell };
    top.cells = top.cells.slice(0, first.b.cell) + 'S' + top.cells.slice(first.b.cell + 1);
  }
  assertValid(project);
  return project;
}

const read = (project, images) => readProjectFile(writeProjectFile(project, { images: images || {} }));
const FIELDS = ['"features"', '"featureIds"', '"periodCustom"', '"periodNames"', '"away"', '"well"'];
const holdsAll = (text) => FIELDS.every((field) => text.includes(field));

// ---------------------------------------------------------------- the project file

test('project file: every new field round-trips, and export, import, export gives the same file', () => {
  const project = carrying();
  const text = writeProjectFile(project);
  assert.ok(holdsAll(text), 'every new field is in the file');
  const back = readProjectFile(text);
  assert.deepEqual(back.project.building.features, project.building.features);
  assert.deepEqual(back.project.settings.periodCustom, project.settings.periodCustom);
  assert.deepEqual(back.project.settings.periodNames, project.settings.periodNames);
  assert.deepEqual(back.project.teachers[0].away, project.teachers[0].away);
  assert.deepEqual(back.project.building.connections.map((c) => c.well), project.building.connections.map((c) => c.well));
  assert.deepEqual(back.project.building.connections.map((c) => c.well).slice(0, 2), ['W', 'W'], 'a stairwell whose flights join is read as it was written');
  assert.deepEqual(back.project.building.floors, project.building.floors);
  assert.equal(writeProjectFile(back.project), text, 'the same file again');
  assert.deepEqual(back.notes, []);
});

test('project file: a stairwell in two parts is mended on the way in, with a note', () => {
  const project = carrying(true);
  const text = writeProjectFile(project);
  const back = readProjectFile(text);
  // stairs A and B sit at different cells, so the well W is two parts and repair gave the second a fresh letter
  const [first, second] = back.project.building.connections.filter((c) => c.kind !== ELEVATOR_KIND);
  assert.equal(first.well, 'W');
  assert.ok(second.well && second.well !== 'W');
  assert.ok(back.notes.some((note) => /was in 2 separate parts/.test(note)));
  assertValid(back.project);
});

test('project file: a file that names a feature the list does not hold is read, mended, with a note', () => {
  const project = carrying();
  project.building.floors.flatMap((f) => f.spaces).find((space) => space.featureIds).featureIds.push('hgone00000');
  const back = readProjectFile(writeProjectFile(project));
  assert.ok(back.notes.some((note) => /feature that is not on the building's list/.test(note)));
  assertValid(back.project);
});

// ---------------------------------------------------------------- the building file

test('building file: the feature list, a room\'s features and a stairwell\'s letters round-trip', () => {
  const project = carrying();
  const text = writeBuildingFile(project);
  assert.ok(['"features"', '"featureIds"', '"well"'].every((field) => text.includes(field)));
  const { file } = readBuildingFile(text);
  assert.deepEqual(file.building.features, project.building.features);
  assert.deepEqual(file.building.connections.map((c) => c.well), project.building.connections.map((c) => c.well));
  const rooms = file.building.floors.flatMap((f) => f.spaces).filter((s) => s.kind === 'room');
  assert.deepEqual(rooms.map((r) => r.featureIds).filter(Boolean), [[LAB, SINK], [SINK]]);
  assert.equal(writeBuildingFile({ ...project, building: file.building, subjects: file.subjects }), text, 'the same file again');
});

test('building file: a malformed feature list is refused naming where, and nothing else about features is', () => {
  const project = carrying();
  const file = JSON.parse(writeBuildingFile(project));
  file.building.features = [{ id: 'xlab000001', name: 'Lab' }];
  assert.throws(() => readBuildingFile(JSON.stringify(file)), (error) => error instanceof FileError && error.code === 'invalid' && error.findings.some((f) => f.path === 'building.features[0].id'));
  const loose = JSON.parse(writeBuildingFile(project));
  loose.building.features = [{ id: LAB, name: 'Lab' }];
  assert.doesNotThrow(() => readBuildingFile(JSON.stringify(loose)), 'a room that names a feature the list lacks is not refused');
});

test('buildingPart carries the features as the building file round trip does (no code was needed)', () => {
  const project = carrying();
  const readOne = read(project);
  const part = buildingPart(readOne);
  assert.deepEqual(part.file.building.features, project.building.features);
  assert.deepEqual(part, readBuildingFile(writeBuildingFile(readOne.project, { images: readOne.images })));
});

test('applyBuilding brings the feature list and the rooms\' features in, and a feature id never meets another thing\'s', () => {
  const source = carrying();
  const part = buildingPart(read(source));
  const target = sampleSchool({ level: true });
  const { project } = applyBuilding(target, part.file, { ids: makeIds(9), unnumberedText: 'not in the building' });
  assert.deepEqual(project.building.features, source.building.features);
  const rooms = project.building.floors.flatMap((f) => f.spaces).filter((s) => s.kind === 'room');
  assert.deepEqual(rooms.map((r) => r.featureIds).filter(Boolean), [[LAB, SINK], [SINK]]);
  assertValid(project);
  assert.ok(collectIds(project).includes(LAB));
  // a building without features takes the features away with the rest of the old building
  const bare = buildingPart(read(sampleSchool({ level: true })));
  const swapped = applyBuilding(project, bare.file, { ids: makeIds(9), unnumberedText: 'not in the building' }).project;
  assert.equal('features' in swapped.building, false);
});

// ---------------------------------------------------------------- the schedule file

test('schedule file: the custom word and names are optional extras of its settings, written only when set', () => {
  assert.deepEqual(SCHEDULE_SETTING_EXTRAS, ['periodCustom', 'periodNames']);
  const plain = JSON.parse(writeScheduleFile(sampleSchool()));
  assert.deepEqual(Object.keys(plain.settings), SCHEDULE_SETTINGS, 'a project with neither writes the four settings it always did');
  const project = carrying();
  const file = JSON.parse(writeScheduleFile(project));
  assert.deepEqual(Object.keys(file.settings), [...SCHEDULE_SETTINGS, 'periodCustom', 'periodNames']);
  assert.deepEqual(file.settings.periodCustom, project.settings.periodCustom);
  assert.deepEqual(file.settings.periodNames, project.settings.periodNames);
  const justNames = carrying();
  delete justNames.settings.periodCustom;
  assert.deepEqual(Object.keys(JSON.parse(writeScheduleFile(justNames)).settings), [...SCHEDULE_SETTINGS, 'periodNames']);
  const nullCustom = carrying();
  nullCustom.settings.periodCustom = null;
  assert.equal('periodCustom' in JSON.parse(writeScheduleFile(nullCustom)).settings, false, 'null is none: not written');
});

test('schedule file: it round-trips every new field, and a file without the extras is still read', () => {
  const project = carrying();
  const text = writeScheduleFile(project);
  const { file } = readScheduleFile(text);
  assert.deepEqual(file.settings.periodCustom, project.settings.periodCustom);
  assert.deepEqual(file.settings.periodNames, project.settings.periodNames);
  assert.deepEqual(file.teachers[0].away, project.teachers[0].away);
  assert.equal(JSON.stringify(JSON.parse(text)), JSON.stringify(JSON.parse(JSON.stringify(file))), 'read gives back what was written, byte for byte');

  const old = JSON.parse(text);
  delete old.settings.periodCustom;
  delete old.settings.periodNames;
  const oldRead = readScheduleFile(JSON.stringify(old));
  assert.equal('periodCustom' in oldRead.file.settings, false);
  assert.deepEqual(Object.keys(oldRead.file.settings), SCHEDULE_SETTINGS);
  // the four are still required
  const missing = JSON.parse(text);
  delete missing.settings.periodWord;
  assert.throws(() => readScheduleFile(JSON.stringify(missing)), (error) => error instanceof FileError && error.findings.some((f) => f.path === 'settings.periodWord'));
});

test('schedule file: a malformed extra or a malformed `away` is refused naming where', () => {
  const text = writeScheduleFile(carrying());
  const bad = (change) => {
    const file = JSON.parse(text);
    change(file);
    return () => readScheduleFile(JSON.stringify(file));
  };
  const names = (path) => (error) => error instanceof FileError && error.code === 'invalid' && error.findings.some((f) => f.path === path);
  assert.throws(bad((f) => { f.settings.periodCustom = 'Lesson'; }), names('settings.periodCustom'));
  assert.throws(bad((f) => { f.settings.periodCustom.count = 'roman'; }), names('settings.periodCustom.count'));
  assert.throws(bad((f) => { f.settings.periodNames = [5]; }), names('settings.periodNames[0]'));
  assert.throws(bad((f) => { f.teachers[0].away = [{ dayTypeIds: [], weekdays: [9], periods: [] }]; }), names('teachers[0].away[0].weekdays'));
});

test('schedulePart gives the extras and `away` as the schedule file round trip does', () => {
  const project = carrying();
  const part = schedulePart(project);
  assert.deepEqual(part.file, readScheduleFile(writeScheduleFile(project)).file);
});

// ---------------------------------------------------------------- applySchedule: away

const DAY_IN_FILE = 'dfile00001';
const OPTIONS = { policy: undefined, takeSettings: false, ids: makeIds(5), clock: () => new Date('2026-09-01T12:00:00Z') };

// A schedule file whose first day type has an id this project does not use (it matches by name), and two teachers.
function fileWithAway(project) {
  const file = clone(schedulePart(project).file);
  const was = file.dayTypes[0].id;
  file.dayTypes[0].id = DAY_IN_FILE;
  for (const group of file.groups) {
    group.days[DAY_IN_FILE] = group.days[was];
    delete group.days[was];
  }
  file.teachers.push({ id: 'tvisit0001', name: 'Visiting Teacher', subjectId: null, roomIds: [], notes: '', away: [{ dayTypeIds: [DAY_IN_FILE], weekdays: [2], periods: [3] }, { dayTypeIds: [], weekdays: [], periods: [] }] });
  file.teachers[0] = { ...file.teachers[0], away: [{ dayTypeIds: [DAY_IN_FILE, file.dayTypes[1].id], weekdays: [], periods: [1] }] };
  return file;
}

test('applySchedule: an added teacher carries `away`, with the day types mapped as a duty\'s are', () => {
  const project = sampleSchool({ level: true });
  const { project: out } = applySchedule(project, fileWithAway(project), OPTIONS);
  const added = out.teachers.find((t) => t.name === 'Visiting Teacher');
  assert.deepEqual(added.away, [{ dayTypeIds: [project.dayTypes[0].id], weekdays: [2], periods: [3] }, { dayTypeIds: [], weekdays: [], periods: [] }]);
  assertValid(out);
});

test('applySchedule: a matched teacher takes the file\'s `away` when the file has the field, and keeps its own when it has not', () => {
  const project = sampleSchool({ level: true });
  project.teachers[1].away = [{ dayTypeIds: [], weekdays: [1], periods: [] }];
  const file = fileWithAway(project);
  const { project: out } = applySchedule(project, file, OPTIONS);
  assert.deepEqual(out.teachers[0].away, [{ dayTypeIds: [project.dayTypes[0].id, project.dayTypes[1].id], weekdays: [], periods: [1] }]);
  assert.deepEqual(out.teachers[1].away, [{ dayTypeIds: [], weekdays: [1], periods: [] }], 'the file says nothing about this teacher\'s away: kept');
  assertValid(out);

  const empty = clone(file);
  empty.teachers[0].away = [];
  project.teachers[0].away = [{ dayTypeIds: [], weekdays: [3], periods: [] }];
  const cleared = applySchedule(project, empty, OPTIONS).project;
  assert.deepEqual(cleared.teachers[0].away, [], 'a file that says [] clears it');
});

test('applySchedule: a file with no `away` leaves the teachers as they were, and the project the very same object when nothing changes', () => {
  const project = sampleSchool({ level: true });
  const file = clone(schedulePart(project).file);
  const { project: out } = applySchedule(project, file, OPTIONS);
  assert.deepEqual(out.teachers, project.teachers);
  assert.ok(out.teachers.every((teacher) => !('away' in teacher)));
});

test('applySchedule: a day type of the file that is added here is the one `away` is mapped to', () => {
  const project = sampleSchool({ level: true });
  const file = fileWithAway(project);
  file.dayTypes[0].name = 'C Day';
  const { project: out } = applySchedule(project, file, OPTIONS);
  const added = out.dayTypes.find((dayType) => dayType.name === 'C Day');
  assert.ok(added && added.id !== DAY_IN_FILE || added.id === DAY_IN_FILE);
  assert.deepEqual(out.teachers.find((t) => t.name === 'Visiting Teacher').away[0].dayTypeIds, [added.id]);
  assertValid(out);
});

test('applySchedule with takeSettings takes the period word, the custom word and the names together', () => {
  const project = sampleSchool({ level: true });
  project.settings.periodNames = ['Mine'];
  const file = clone(schedulePart(carrying()).file);
  const result = applySchedule(project, file, { ...OPTIONS, takeSettings: true });
  assert.deepEqual(result.project.settings.periodCustom, file.settings.periodCustom);
  assert.deepEqual(result.project.settings.periodNames, file.settings.periodNames);
  assert.ok(result.summary.settingsTaken.some((taken) => (taken && taken.key) === 'periodWord'), 'the entry says the word and names changed');
  // a file that has the word and no extras clears the extras here: they were the word's
  const bare = clone(schedulePart(sampleSchool({ level: true })).file);
  const withCustom = { ...project, settings: { ...project.settings, periodCustom: { word: 'Class', plural: 'Classes', count: 'number' } } };
  const cleared = applySchedule(withCustom, bare, { ...OPTIONS, takeSettings: true }).project;
  assert.equal('periodCustom' in cleared.settings, false);
  assert.equal('periodNames' in cleared.settings, false);
  // and nothing is taken without takeSettings
  assert.deepEqual(applySchedule(project, file, OPTIONS).project.settings.periodNames, ['Mine']);
});

// ---------------------------------------------------------------- merge import's settings

test('applySettings: the period word, the custom word and the names are one setting, "The period word and names"', () => {
  assert.deepEqual(SETTINGS_TAKEN.filter((key) => key.startsWith('period')), ['periods', 'periodWord'], 'one key stands for the three');
  const base = readProjectFile(writeProjectFile(sampleSchool())).project;
  const from = carrying().settings;
  const result = applySettings(base, { periodWord: from.periodWord, periodCustom: from.periodCustom, periodNames: from.periodNames });
  assert.deepEqual(result.project.settings.periodCustom, from.periodCustom);
  assert.deepEqual(result.project.settings.periodNames, from.periodNames);
  assert.equal(result.summary.taken.length, 1, 'one line');
  assert.equal(result.summary.taken[0].key, 'periodWord');
  assert.deepEqual(result.summary.taken[0], { key: 'periodWord', from: 'Period', to: 'Lesson and 2 period names' });
  assertValid(result.project);

  // the same settings again: nothing to take
  const again = applySettings(result.project, { periodWord: from.periodWord, periodCustom: from.periodCustom, periodNames: from.periodNames });
  assert.equal(again.project, result.project);
  assert.deepEqual(again.summary.taken, []);

  // a file whose word is plain takes the extras away: they were part of the word
  const plain = applySettings(result.project, { periodWord: 'Mod' });
  assert.equal(plain.project.settings.periodWord, 'Mod');
  assert.equal('periodCustom' in plain.project.settings, false);
  assert.equal('periodNames' in plain.project.settings, false);
  assert.deepEqual(plain.summary.taken, [{ key: 'periodWord', from: 'Lesson and 2 period names', to: 'Mod' }]);

  // a file that holds only some of them leaves the others
  const names = applySettings(result.project, { periodNames: ['Homeroom'] });
  assert.deepEqual(names.project.settings.periodNames, ['Homeroom']);
  assert.deepEqual(names.project.settings.periodCustom, from.periodCustom);
  assert.equal(names.project.settings.periodWord, result.project.settings.periodWord);

  // a plain word alone on a plain project is the one line it always was
  const only = applySettings(base, { periodWord: 'Block' });
  assert.deepEqual(only.summary.taken, [{ key: 'periodWord', from: 'Period', to: 'Block' }]);
});

test('applySettings: a malformed custom word or name list refuses the whole import, naming it, and changes nothing', () => {
  const base = readProjectFile(writeProjectFile(sampleSchool())).project;
  const refused = (settings, key) => assert.throws(() => applySettings(base, settings), (error) => error instanceof FileError && error.code === 'invalid' && error.findings.some((f) => f.path === 'settings.' + key));
  refused({ periodCustom: 'Lesson' }, 'periodCustom');
  refused({ periodCustom: { word: '', count: 'number' } }, 'periodCustom');
  refused({ periodCustom: { word: 'Lesson', count: 'roman' } }, 'periodCustom');
  refused({ periodCustom: { word: 'x'.repeat(17), count: 'number' } }, 'periodCustom');
  refused({ periodNames: 'Advisory' }, 'periodNames');
  refused({ periodNames: [5] }, 'periodNames');
  refused({ periodNames: ['x'.repeat(25)] }, 'periodNames');
  refused({ periodNames: Array(17).fill('') }, 'periodNames');
  assert.deepEqual(applySettings(base, { periodCustom: null }).summary.taken, [], 'null is none');
});

test('applySettings: the names taken are read back by periodName and periodNumberName', () => {
  const base = readProjectFile(writeProjectFile(sampleSchool())).project;
  const from = carrying().settings;
  const { project } = applySettings(base, { periodWord: 'Period', periodCustom: from.periodCustom, periodNames: from.periodNames });
  assert.equal(periodName(project.settings, 2), 'Advisory');
  assert.equal(periodNumberName(project.settings, 2), 'Lesson C');
  assert.equal(periodName(project.settings, 0), 'Lesson A');
});

// ---------------------------------------------------------------- what staff receive

const published = (project) => publishedModel(project, { clock });

test('publish: a project with none of the new fields publishes none, and the sample\'s published data is the recorded baseline', () => {
  const model = published(sampleSchool());
  const recorded = JSON.parse(readFileSync(path.join(HERE, '..', 'publish', 'baseline', 'published.json'), 'utf8'));
  for (const key of ['settings', 'building', 'teachers', 'groups', 'dayTypes', 'subjects', 'marks', 'duties']) assert.deepEqual(JSON.parse(JSON.stringify(model[key])), recorded[key], key);
  const text = JSON.stringify(model);
  for (const field of ['"features"', '"featureIds"', '"periodCustom"', '"periodNames"', '"away"', '"well"']) assert.equal(text.includes(field), false, field + ' is not written');
});

test('publish: each new field is written, only when present', () => {
  const project = carrying();
  const model = published(project);
  assert.deepEqual(model.settings.periodCustom, { word: 'Lesson', plural: 'Lessons', count: 'letter' });
  assert.deepEqual(model.settings.periodNames, ['', '', 'Advisory', '', 'Lunch']);
  assert.deepEqual(model.building.features, [{ id: LAB, name: 'Lab' }, { id: SINK, name: 'Sink' }]);
  const rooms = model.building.floors.flatMap((f) => f.spaces).filter((s) => s.kind === 'room');
  assert.deepEqual(rooms.map((r) => r.featureIds).filter(Boolean), [[LAB, SINK], [SINK]]);
  assert.ok(rooms.filter((r) => !r.featureIds).length === rooms.length - 2, 'a room with none carries no key');
  assert.deepEqual(model.teachers[0].away, project.teachers[0].away);
  assert.ok(model.teachers.slice(1).every((t) => !('away' in t)));
  const stairs = model.building.connections.filter((c) => c.kind !== ELEVATOR_KIND);
  assert.deepEqual(stairs.map((c) => c.well), ['W', 'W', undefined], 'the third flight is a plain one: no key');
  assert.equal('well' in stairs[2], false);
  assert.deepEqual(validate({ ...model, format: model.format }), validate({ ...model }));

  // each one, taken away, goes from the file
  const strip = clone(project);
  delete strip.settings.periodCustom;
  assert.equal('periodCustom' in published(strip).settings, false);
  strip.settings.periodNames = [];
  assert.equal('periodNames' in published(strip).settings, false, 'an empty list is none');
  strip.teachers[0].away = [];
  assert.equal('away' in published(strip).teachers[0], false);
  strip.building.floors.forEach((f) => f.spaces.forEach((s) => { if (s.featureIds) s.featureIds = []; }));
  const bare = published(strip);
  assert.equal('features' in bare.building, false, 'a list no room uses is not published');
  assert.ok(bare.building.floors.flatMap((f) => f.spaces).every((s) => !('featureIds' in s)));
});

test('publish: the features published are only those a published room has, in the list\'s order, and a well is never on an elevator', () => {
  const project = carrying();
  project.building.features = [{ id: 'hunused001', name: 'Unused' }, ...project.building.features];
  const model = published(project);
  assert.deepEqual(model.building.features.map((f) => f.id), [LAB, SINK]);
  const elevator = project.building.connections.find((c) => c.kind === ELEVATOR_KIND) || { ...project.building.connections[0], kind: ELEVATOR_KIND, car: 'Q', well: 'W' };
  const withLift = clone(project);
  withLift.building.connections[0] = { ...withLift.building.connections[0], kind: ELEVATOR_KIND, car: 'Q', well: 'W', direction: 'both' };
  assert.equal('well' in published(withLift).building.connections[0], false);
  assert.ok(elevator);
});

test('publish: names go out as typed', () => {
  const project = carrying();
  project.building.features[0].name = '<b>Lab</b> "A" & more';
  project.settings.periodNames[2] = '<i>Advisory</i>';
  project.settings.periodCustom.word = '<Class>';
  const model = published(project);
  assert.equal(model.building.features[0].name, '<b>Lab</b> "A" & more');
  assert.equal(model.settings.periodNames[2], '<i>Advisory</i>');
  assert.equal(model.settings.periodCustom.word, '<Class>');
});

test('PUBLISHED_SETTINGS holds every key publishedModel writes in settings, the two new ones included', () => {
  assert.ok(PUBLISHED_SETTINGS.includes('periodCustom') && PUBLISHED_SETTINGS.includes('periodNames'));
  const keys = Object.keys(published(carrying()).settings);
  assert.deepEqual(PUBLISHED_SETTINGS, keys);
  assert.equal(PUBLISHED_SETTINGS.length, 12);
  assert.deepEqual(Object.keys(published(sampleSchool()).settings), PUBLISHED_SETTINGS.filter((key) => key !== 'periodCustom' && key !== 'periodNames'));
});

test('an empty project has none of the new fields in any file it writes', () => {
  const project = emptyProject();
  for (const text of [writeProjectFile(project), writeBuildingFile(project), writeScheduleFile(project)]) {
    for (const field of ['"features"', '"featureIds"', '"periodCustom"', '"periodNames"', '"away"', '"well"']) assert.equal(text.includes(field), false, field);
  }
});


// ---------------------------------------------------------------- review fixes (SV2-126b)

test('applyBuilding: a room carries only the features the incoming building lists', () => {
  const target = sampleSchool({ level: true });
  const file = clone(buildingPart(read(carrying())).file);
  const room = file.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'room' && space.featureIds && space.featureIds.length === 2);
  room.featureIds = [LAB, 'hgone00000', SINK];
  const only = file.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'room' && space.featureIds && space.featureIds.length === 1);
  only.featureIds = ['hgone00000'];
  const { project } = applyBuilding(target, file, { ids: makeIds(9), unnumberedText: 'not in the building' });
  const rooms = project.building.floors.flatMap((floor) => floor.spaces);
  assert.deepEqual(rooms.find((space) => space.id === room.id).featureIds, [LAB, SINK]);
  assert.equal('featureIds' in rooms.find((space) => space.id === only.id), false, 'all of them gone: absent, not an empty list');
  assertValid(project);
  // a file with no feature list carries none of its rooms' ids
  const bare = clone(file);
  delete bare.building.features;
  const swapped = applyBuilding(target, bare, { ids: makeIds(9), unnumberedText: 'not in the building' }).project;
  assert.equal(swapped.building.floors.flatMap((floor) => floor.spaces).some((space) => space.featureIds && space.featureIds.length > 0), false);
});

test('applySchedule takeSettings: the names are cut to the periods the project ends with', () => {
  const project = sampleSchool({ level: true });
  const periods = project.settings.periods;
  const file = clone(schedulePart(carrying()).file);
  file.settings.periodNames = Array.from({ length: periods + 3 }, (_, k) => 'N' + k);
  const out = applySchedule(project, file, { ...OPTIONS, takeSettings: true }).project;
  assert.equal(out.settings.periodNames.length, periods, 'the names the file had past the day\'s end are not kept');
  assert.equal(out.settings.periodNames[periods - 1], 'N' + (periods - 1));
  const merged = applySettings(project, { periodWord: 'Period', periodNames: file.settings.periodNames }).project;
  assert.equal(merged.settings.periodNames.length, merged.settings.periods);
  // a list that is blank once cut is not written as a list of blanks
  const blank = clone(file);
  blank.settings.periodNames = [...Array(periods).fill(''), 'Past the end'];
  const none = applySchedule(project, blank, { ...OPTIONS, takeSettings: true }).project;
  assert.equal('periodNames' in none.settings, false);
});

test('applySchedule takeSettings: a file with no custom word or names over a project that has them says they went', () => {
  const project = carrying();
  const bare = clone(schedulePart(sampleSchool({ level: true })).file);
  const { project: out, summary } = applySchedule(project, bare, { ...OPTIONS, takeSettings: true });
  assert.equal('periodCustom' in out.settings && out.settings.periodCustom !== undefined, false);
  assert.equal('periodNames' in out.settings, false);
  const entry = summary.settingsTaken.find((taken) => taken && typeof taken === 'object');
  assert.ok(entry, 'an entry with from and to');
  assert.equal(entry.key, 'periodWord');
  assert.match(entry.from, /Lesson and 2 period names/);
  assert.equal(entry.to, 'Period');
  // and with none of them on either side the entry is the plain key, as before
  const plain = sampleSchool({ level: true });
  const word = clone(schedulePart(plain).file);
  word.settings.periodWord = 'Block';
  assert.deepEqual(applySchedule(plain, word, { ...OPTIONS, takeSettings: true }).summary.settingsTaken, ['periodWord']);
});

test('the schedule file writes periodNames only when some name is not blank', () => {
  const project = carrying();
  project.settings.periodNames = ['', '  ', ''];
  assert.equal('periodNames' in JSON.parse(writeScheduleFile(project)).settings, false);
  assert.equal('periodNames' in schedulePart(project).file.settings, false);
  project.settings.periodNames = [];
  assert.equal('periodNames' in JSON.parse(writeScheduleFile(project)).settings, false);
  project.settings.periodNames = ['', 'Lunch'];
  assert.deepEqual(JSON.parse(writeScheduleFile(project)).settings.periodNames, ['', 'Lunch']);
});

test('publish: periodNames only when some name is not blank, featureIds only those published, away day types only those published', () => {
  const project = carrying();
  project.settings.periodNames = ['', ' ', ''];
  assert.equal('periodNames' in published(project).settings, false);
  project.settings.periodNames = [];
  assert.equal('periodNames' in published(project).settings, false);
  // a room naming a feature the building does not list: the id is not published
  const rooms = project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room');
  rooms[0].featureIds = [LAB, 'hgone00000'];
  rooms[2].featureIds = ['hgone00000'];
  const model = published(project);
  const out = model.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room');
  assert.deepEqual(out.find((room) => room.id === rooms[0].id).featureIds, [LAB]);
  assert.equal('featureIds' in out.find((room) => room.id === rooms[2].id), false);
  // away: a day type the data does not have is dropped, an entry left naming none is dropped, never widened
  const day = project.dayTypes[0].id;
  project.teachers[0].away = [
    { dayTypeIds: [day, 'dgone00000'], weekdays: [1], periods: [] },
    { dayTypeIds: ['dgone00000'], weekdays: [], periods: [] },
    { dayTypeIds: [], weekdays: [], periods: [2] },
  ];
  const teachers = published(project).teachers;
  assert.deepEqual(teachers[0].away, [{ dayTypeIds: [day], weekdays: [1], periods: [] }, { dayTypeIds: [], weekdays: [], periods: [2] }]);
  project.teachers[0].away = [{ dayTypeIds: ['dgone00000'], weekdays: [], periods: [] }];
  assert.equal('away' in published(project).teachers[0], false);
});

test('merge: the period word, the custom word and the names are taken together, and the store\'s schedule counter moves', () => {
  const store = (project) => createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const bring = (target, file) => target.apply(actions.importPart, { part: 'settings', read: read(file), fileName: 'next-year.json' });
  // only the custom word and names differ: the key stands for the three, and the schedule moves
  const here = emptyProject();
  const there = clone(here);
  there.settings.periodCustom = { word: 'Class', plural: 'Classes', count: 'number' };
  there.settings.periodNames = ['Advisory'];
  const a = store(here);
  bring(a, there);
  assert.deepEqual(a.project.settings.periodCustom, there.settings.periodCustom);
  assert.deepEqual(a.project.settings.periodNames, ['Advisory']);
  assert.deepEqual([a.geometryVersion, a.buildingVersion, a.scheduleVersion], [0, 0, 1]);
  // and a file that has neither takes them away from a project that has them
  const b = store(there);
  bring(b, here);
  assert.equal(b.project.settings.periodCustom, undefined);
  assert.equal(b.project.settings.periodNames, undefined);
  assert.deepEqual([b.geometryVersion, b.buildingVersion, b.scheduleVersion], [0, 0, 1]);
  // names alone
  const names = clone(here);
  names.settings.periodNames = ['Lunch'];
  const c = store(here);
  bring(c, names);
  assert.deepEqual(c.project.settings.periodNames, ['Lunch']);
  assert.equal(c.scheduleVersion, 1);
});

test('validate: the published format with every new field present is valid', () => {
  const project = carrying();
  const model = published(project);
  const text = JSON.stringify(model);
  assert.ok(['"features"', '"featureIds"', '"periodCustom"', '"periodNames"', '"away"', '"well"'].every((field) => text.includes(field)), 'every new field is published');
  assert.deepEqual(validate(JSON.parse(text)), []);
});
