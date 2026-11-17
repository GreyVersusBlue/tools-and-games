// W7's fields (ARCHITECTURE 22.2, 22.17): ids, validate and repair of room
// features, the custom period word and the periods' own names, when a teacher
// is away, and a stairwell's letter; and that an older planner, with these
// rules taken out, passes every one of them through byte for byte. Plain Node;
// nothing here reads the clock or the machine's time zone.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { ID_PREFIXES, collectIds, isId, createIds, seededRandom } from '../../engine/ids.js';
import { CELL_STAIRS, newFloor, newRoom, ELEVATOR_KIND, stairwells, nextConnectionLabel } from '../../engine/schema.js';
import { sampleSchool } from '../../data/sample-school.js';
import { emptyProject, clone, assertValid } from './helpers.mjs';

const LAB = 'hlab000001';
const SINK = 'hsink00001';

// A project with every new field, built on the sample school: two features, a
// room with them, a custom word and names, a teacher who is away, and a
// stairwell of two flights that join at one stop.
function carrying() {
  const project = sampleSchool({ level: true });
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  project.building.features = [{ id: LAB, name: 'Lab' }, { id: SINK, name: 'Sink' }];
  rooms[0].featureIds = [LAB, SINK];
  rooms[1].featureIds = [SINK];
  project.settings.periodCustom = { word: 'Lesson', plural: 'Lessons', count: 'letter' };
  project.settings.periodNames = ['', '', 'Advisory', '', 'Lunch'];
  const day = project.dayTypes[0].id;
  project.teachers[0].away = [
    { dayTypeIds: [day], weekdays: [0, 4], periods: [1, 2] },
    { dayTypeIds: [], weekdays: [], periods: [] },
  ];
  // two flights of one stairwell W: floor 1 to floor 2 at cell A, floor 2 to floor 3 at cell B, joining at the stop on floor 2
  return project;
}

// A small building of three floors for stairwell cases: stairs cells at 7 and 9 on every floor.
function wells(connections) {
  const project = emptyProject();
  const floors = ['f1aaaaaaaa', 'f2aaaaaaaa', 'f3aaaaaaaa'].map((id, k) => {
    const floor = newFloor(id, 'Floor ' + (k + 1), k + 1, 6, 6);
    const cells = floor.cells.split('');
    for (const cell of [7, 9, 13]) cells[cell] = CELL_STAIRS;
    floor.cells = cells.join('');
    return floor;
  });
  project.building = { floors, connections: connections.map(([id, label, from, to, extra]) => ({ id, label, a: { floorId: floors[from[0]].id, cell: from[1] }, b: { floorId: floors[to[0]].id, cell: to[1] }, direction: 'both', ...extra })), zones: [] };
  return project;
}

const mended = (project) => {
  const result = repair(clone(project));
  assertValid(result.project, 'what repair gives back is valid');
  return result;
};

// ---------------------------------------------------------------- ids

test('ids: a feature has the prefix h, and collectIds walks building.features', () => {
  assert.equal(ID_PREFIXES.feature, 'h');
  assert.equal(new Set(Object.values(ID_PREFIXES)).size, Object.values(ID_PREFIXES).length, 'no two kinds share a prefix');
  const found = collectIds(carrying());
  assert.ok(found.includes(LAB) && found.includes(SINK));
  assert.deepEqual(collectIds({ building: { features: 'x' } }), [], 'a malformed list is none');
  const ids = createIds(seededRandom(5));
  ids.reserve(found);
  for (let n = 0; n < 200; n += 1) assert.ok(!found.includes(ids(ID_PREFIXES.feature)), 'a new feature id never meets an old one');
  assert.ok(isId(LAB, 'h'));
});

// ---------------------------------------------------------------- validate: what is accepted

test('validate: a project with every new field is valid', () => {
  assertValid(carrying());
});

test('validate: absent is none, null is none for the custom word, and the sample carries none of them', () => {
  const sample = sampleSchool();
  assertValid(sample);
  for (const key of ['features']) assert.equal(key in sample.building, false);
  assert.equal('periodCustom' in sample.settings || 'periodNames' in sample.settings, false);
  const project = carrying();
  project.settings.periodCustom = null;
  assertValid(project);
  delete project.settings.periodCustom;
  delete project.settings.periodNames;
  delete project.building.features;
  assertValid(project, 'a room naming a feature the list does not hold is not refused: an older planner may have deleted it');
});

test('validate: the plural of the custom word is optional', () => {
  const project = carrying();
  delete project.settings.periodCustom.plural;
  assertValid(project);
});

// ---------------------------------------------------------------- validate: what is refused, and only that

const paths = (project) => validate(project).map((finding) => finding.path);

test('validate: features are a list of at most 40, each with an h id and a name of 1 to 30 characters', () => {
  const at = (change) => {
    const project = carrying();
    change(project);
    return paths(project);
  };
  assert.deepEqual(at((p) => { p.building.features = 'Lab'; }), ['building.features']);
  assert.deepEqual(at((p) => { p.building.features = Array.from({ length: 41 }, (_, n) => ({ id: 'h' + String(n).padStart(9, '0'), name: 'F' + n })); }), ['building.features']);
  assert.deepEqual(at((p) => { p.building.features.push(7); }), ['building.features[2]']);
  assert.deepEqual(at((p) => { p.building.features[0].id = 'rlab000001'; }), ['building.features[0].id'], 'an id of another kind');
  assert.deepEqual(at((p) => { p.building.features[1].id = LAB; }), ['building.features[1].id'], 'a repeated id');
  assert.deepEqual(at((p) => { p.building.features[0].name = '   '; }), ['building.features[0].name']);
  assert.deepEqual(at((p) => { p.building.features[0].name = 'x'.repeat(31); }), ['building.features[0].name']);
  assert.deepEqual(at((p) => { p.building.features[0].name = 'x'.repeat(30); }), []);
  assert.deepEqual(at((p) => { p.building.features[0].name = '<b>Lab</b> "2" \u{1F52C}'; }), [], 'a name is data');
});

test('validate: a repeated name in the feature list is not refused (the actions keep names unique; repair mends it)', () => {
  const project = carrying();
  project.building.features[1].name = ' lab';
  assertValid(project);
});

test('validate: featureIds are a list of strings, each once', () => {
  const at = (change) => {
    const project = carrying();
    change(project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'room' && space.featureIds));
    return paths(project);
  };
  assert.deepEqual(at((room) => { room.featureIds = LAB; }).map((p) => p.replace(/^building\.floors\[\d+\]\.spaces\[\d+\]/, 'room')), ['room.featureIds']);
  assert.equal(at((room) => { room.featureIds = [LAB, LAB]; }).length, 1);
  assert.equal(at((room) => { room.featureIds = [LAB, 5]; }).length, 1);
  assert.deepEqual(at((room) => { room.featureIds = ['hgone00000']; }), [], 'an id the list does not hold');
  assert.deepEqual(at((room) => { room.featureIds = []; }), []);
});

test('validate: periodCustom is null or { word 1 to 16, plural 1 to 16 when present, count }', () => {
  const at = (change) => {
    const project = carrying();
    change(project.settings);
    return paths(project);
  };
  assert.deepEqual(at((s) => { s.periodCustom = 'Lesson'; }), ['settings.periodCustom']);
  assert.deepEqual(at((s) => { s.periodCustom = []; }), ['settings.periodCustom']);
  assert.deepEqual(at((s) => { s.periodCustom.word = '  '; }), ['settings.periodCustom.word']);
  assert.deepEqual(at((s) => { s.periodCustom.word = 7; }), ['settings.periodCustom.word']);
  assert.deepEqual(at((s) => { s.periodCustom.word = 'x'.repeat(17); }), ['settings.periodCustom.word']);
  assert.deepEqual(at((s) => { s.periodCustom.word = 'x'.repeat(16); }), []);
  // a space before or after is refused (the field is new), so repair's trim never changes a valid project
  assert.deepEqual(at((s) => { s.periodCustom.word = ' Lesson'; }), ['settings.periodCustom.word']);
  assert.deepEqual(at((s) => { s.periodCustom.word = 'Lesson '; }), ['settings.periodCustom.word']);
  assert.deepEqual(at((s) => { s.periodCustom.plural = ' Lessons'; }), ['settings.periodCustom.plural']);
  assert.deepEqual(at((s) => { s.periodCustom.plural = 'Lessons '; }), ['settings.periodCustom.plural']);
  assert.deepEqual(at((s) => { s.periodCustom.word = 'Two words'; }), [], 'a space inside is fine');
  assert.deepEqual(at((s) => { s.periodCustom.plural = ''; }), ['settings.periodCustom.plural']);
  assert.deepEqual(at((s) => { s.periodCustom.plural = 'x'.repeat(17); }), ['settings.periodCustom.plural']);
  assert.deepEqual(at((s) => { s.periodCustom.count = 'roman'; }), ['settings.periodCustom.count']);
  assert.deepEqual(at((s) => { delete s.periodCustom.count; }), ['settings.periodCustom.count']);
  for (const count of ['number', 'letter', 'ordinal']) assert.deepEqual(at((s) => { s.periodCustom.count = count; }), []);
});

test('validate: periodNames are a list of at most 16 texts of at most 24 characters, and nothing across fields', () => {
  const at = (change) => {
    const project = carrying();
    change(project.settings);
    return paths(project);
  };
  assert.deepEqual(at((s) => { s.periodNames = 'Advisory'; }), ['settings.periodNames']);
  assert.deepEqual(at((s) => { s.periodNames = Array(17).fill(''); }), ['settings.periodNames']);
  assert.deepEqual(at((s) => { s.periodNames = Array(16).fill('x'); }), [], 'longer than the periods is not refused');
  assert.deepEqual(at((s) => { s.periodNames[1] = 7; }), ['settings.periodNames[1]']);
  assert.deepEqual(at((s) => { s.periodNames[1] = 'x'.repeat(25); }), ['settings.periodNames[1]']);
  assert.deepEqual(at((s) => { s.periodNames[1] = 'x'.repeat(24); }), []);
  assert.deepEqual(at((s) => { s.periodNames[1] = 'Block 1'; }), [], 'a name that looks like a number name is an action rule, not a form rule');
  assert.deepEqual(at((s) => { s.periodNames[3] = 'Lunch'; }), [], 'two periods with one name: not a form rule');
});

test('validate: away is a list of at most 12 entries of three lists', () => {
  const at = (change) => {
    const project = carrying();
    change(project.teachers[0]);
    return paths(project).map((p) => p.replace(/^teachers\[0\]/, 't'));
  };
  assert.deepEqual(at((t) => { t.away = {}; }), ['t.away']);
  assert.deepEqual(at((t) => { t.away = Array.from({ length: 13 }, () => ({ dayTypeIds: [], weekdays: [], periods: [] })); }), ['t.away']);
  assert.deepEqual(at((t) => { t.away = Array.from({ length: 12 }, () => ({ dayTypeIds: [], weekdays: [], periods: [] })); }), []);
  assert.deepEqual(at((t) => { t.away[0] = 'Fridays'; }), ['t.away[0]']);
  assert.deepEqual(at((t) => { delete t.away[0].dayTypeIds; }), ['t.away[0].dayTypeIds']);
  assert.deepEqual(at((t) => { t.away[0].dayTypeIds = ['dgone00000']; }), [], 'a day type not in the project is not refused');
  assert.deepEqual(at((t) => { t.away[0].dayTypeIds = [t.away[0].dayTypeIds[0], t.away[0].dayTypeIds[0]]; }), ['t.away[0].dayTypeIds']);
  assert.deepEqual(at((t) => { t.away[0].weekdays = [7]; }), ['t.away[0].weekdays']);
  assert.deepEqual(at((t) => { t.away[0].weekdays = [-1]; }), ['t.away[0].weekdays']);
  assert.deepEqual(at((t) => { t.away[0].weekdays = [1, 1]; }), ['t.away[0].weekdays']);
  assert.deepEqual(at((t) => { t.away[0].weekdays = [0, 6]; }), []);
  assert.deepEqual(at((t) => { t.away[0].weekdays = [4, 0]; }), ['t.away[0].weekdays'], 'in order, as periods are');
  assert.deepEqual(at((t) => { t.away[0].periods = [2, 1]; }), ['t.away[0].periods'], 'in order');
  assert.deepEqual(at((t) => { t.away[0].periods = [1, 1]; }), ['t.away[0].periods']);
  assert.deepEqual(at((t) => { t.away[0].periods = [-1]; }), ['t.away[0].periods']);
  assert.deepEqual(at((t) => { t.away[0].periods = [1.5]; }), ['t.away[0].periods']);
  assert.deepEqual(at((t) => { t.away[0].periods = [40]; }), [], 'past the end of the day is repair\'s, not a form rule');
});

test('validate: well is non-blank text of at most 8 characters, wherever the connection is, and nothing across connections', () => {
  const at = (change) => {
    const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 'W' }], ['c00000001b', 'B', [1, 7], [2, 7], { well: 'W' }]]);
    change(project);
    return paths(project);
  };
  assert.deepEqual(at(() => {}), []);
  assert.deepEqual(at((p) => { p.building.connections[0].well = ''; }), ['building.connections[0].well']);
  assert.deepEqual(at((p) => { p.building.connections[0].well = '  '; }), ['building.connections[0].well']);
  assert.deepEqual(at((p) => { p.building.connections[0].well = 4; }), ['building.connections[0].well']);
  assert.deepEqual(at((p) => { p.building.connections[0].well = 'x'.repeat(9); }), ['building.connections[0].well']);
  assert.deepEqual(at((p) => { p.building.connections[0].well = 'x'.repeat(8); }), []);
  assert.deepEqual(at((p) => { p.building.connections[1].well = 'Z'; }), [], 'a well in two parts is not refused');
  assert.deepEqual(at((p) => { p.building.connections[1].label = 'W'; delete p.building.connections[1].well; }), [], 'a well sharing a plain flight\'s letter is not refused');
  assert.deepEqual(at((p) => { p.building.connections[0].kind = ELEVATOR_KIND; p.building.connections[0].car = 'W'; }).filter((p) => p.endsWith('.well')), [], 'a well on an elevator is repair\'s rule, not a form rule');
});

// ---------------------------------------------------------------- repair: nothing to mend

test('repair: a project with every new field and nothing wrong is returned as it is, with no note', () => {
  const project = carrying();
  const result = repair(project);
  assert.deepEqual(result.notes, []);
  assert.equal(result.project, project, 'the very same object');
});

test('repair(sample) is the same object', () => {
  const sample = sampleSchool();
  const result = repair(sample);
  assert.deepEqual(result.notes, []);
  assert.equal(result.project, sample);
});

// ---------------------------------------------------------------- repair: features

test('repair: a feature list that is not a list is removed, an entry that is not an object or has no name is dropped', () => {
  let project = carrying();
  project.building.features = 'Lab';
  let result = mended(project);
  assert.equal('features' in result.project.building, false);
  assert.ok(result.notes.some((note) => /room features could not be read and was removed/.test(note)));
  assert.ok(result.project.building.floors.flatMap((f) => f.spaces).every((space) => !space.featureIds || space.featureIds.length === 0), 'rooms lose what the list no longer holds');

  project = carrying();
  project.building.features = [{ id: LAB, name: 'Lab' }, 7, { id: SINK, name: '  ' }, { id: 'hthird0001' }];
  result = mended(project);
  assert.deepEqual(result.project.building.features, [{ id: LAB, name: 'Lab' }]);
  assert.equal(result.notes.filter((note) => /could not be read and was removed/.test(note)).length, 1);
  assert.equal(result.notes.filter((note) => /had no name and were removed/.test(note)).length, 1);
});

test('repair: a feature with no id, a bad id or a repeated id is given a new one, and a room that named it by the old id follows', () => {
  const project = carrying();
  project.building.features = [{ id: LAB, name: 'Lab' }, { id: LAB, name: 'Sink' }, { name: 'Oven' }, { id: 'rbadid0001', name: 'Kiln' }];
  const room = project.building.floors.flatMap((f) => f.spaces).find((space) => space.featureIds);
  room.featureIds = [LAB, 'rbadid0001'];
  const { project: out, notes } = mended(project);
  const ids = out.building.features.map((feature) => feature.id);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => isId(id, 'h')));
  assert.equal(ids[0], LAB, 'the first keeps its id');
  assert.equal(notes.filter((note) => /was given a new one/.test(note)).length, 3);
  const mendedRoom = out.building.floors.flatMap((f) => f.spaces).find((space) => space.id === room.id);
  assert.deepEqual(mendedRoom.featureIds, [LAB, ids[3]], 'the room follows the bad id to its new one, in the list\'s order');
});

test('repair: duplicate names are made unique, a long name is cut, and the list stops at 40', () => {
  const project = carrying();
  project.building.features = [{ id: LAB, name: 'Lab' }, { id: SINK, name: ' LAB ' }, { id: 'hthree0001', name: 'x'.repeat(40) }, { id: 'hfour00001', name: 'x'.repeat(30) }];
  let { project: out, notes } = mended(project);
  assert.deepEqual(out.building.features.map((feature) => feature.name), ['Lab', ' LAB  (2)'.trim() === 'LAB (2)' ? ' LAB  (2)' : out.building.features[1].name, 'x'.repeat(30), 'x'.repeat(26) + ' (2)']);
  assert.ok(notes.some((note) => /both called/.test(note)));
  assert.ok(notes.some((note) => /longer than 30 characters/.test(note)));
  assert.ok(out.building.features.every((feature) => Array.from(feature.name).length <= 30));

  const many = carrying();
  many.building.features = Array.from({ length: 44 }, (_, n) => ({ id: 'h' + String(n).padStart(9, '0'), name: 'Feature ' + n }));
  many.building.floors.forEach((floor) => floor.spaces.forEach((space) => { if (space.featureIds) space.featureIds = []; }));
  ({ project: out, notes } = mended(many));
  assert.equal(out.building.features.length, 40);
  assert.ok(notes.some((note) => /at most 40 room features/.test(note)));
});

test('repair: featureIds are filtered to the list and each once, in the room\'s own order, with a note', () => {
  const project = carrying();
  const room = project.building.floors.flatMap((f) => f.spaces).find((space) => space.featureIds && space.featureIds.length === 2);
  room.featureIds = [SINK, 'hgone00000', LAB, SINK];
  const { project: out, notes } = mended(project);
  const after = out.building.floors.flatMap((f) => f.spaces).find((space) => space.id === room.id);
  assert.deepEqual(after.featureIds, [SINK, LAB], 'the first of each, in the order the room had them');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /named 2 features that are not on the building's list, or the same one twice/);

  const ordered = carrying();
  ordered.building.floors.flatMap((f) => f.spaces).find((space) => space.id === room.id).featureIds = [SINK, LAB];
  const again = repair(ordered);
  assert.deepEqual(validate(ordered), []);
  assert.equal(again.project, ordered);
  assert.deepEqual(again.notes, [], 'an order the list does not have is valid, so repair leaves it');

  const bad = carrying();
  bad.building.floors.flatMap((f) => f.spaces).find((space) => space.id === room.id).featureIds = 'Lab';
  const gone = mended(bad);
  assert.equal('featureIds' in gone.project.building.floors.flatMap((f) => f.spaces).find((space) => space.id === room.id), false);
  assert.match(gone.notes[0], /could not be read and were removed/);
});

test('repair: a room that names features when the building has no list loses them', () => {
  const project = carrying();
  delete project.building.features;
  const { project: out, notes } = mended(project);
  assert.ok(out.building.floors.flatMap((f) => f.spaces).every((space) => !space.featureIds || space.featureIds.length === 0));
  assert.ok(notes.length >= 1);
});

// ---------------------------------------------------------------- repair: the period word and names

test('repair: periodCustom is trimmed and cut, a missing count is "number", and one that cannot be read is removed', () => {
  let project = carrying();
  project.settings.periodCustom = { word: '  Lesson  ', plural: ' Lessons ', count: 'roman' };
  let result = mended(project);
  assert.deepEqual(result.project.settings.periodCustom, { word: 'Lesson', plural: 'Lessons', count: 'number' });
  assert.equal(result.notes.length, 3);

  project = carrying();
  project.settings.periodCustom = { word: 'x'.repeat(20), count: 'ordinal' };
  result = mended(project);
  assert.equal(result.project.settings.periodCustom.word, 'x'.repeat(16));
  assert.equal('plural' in result.project.settings.periodCustom, false, 'an absent plural stays absent');

  project = carrying();
  project.settings.periodCustom = { word: 'Lesson', plural: 4, count: 'letter' };
  result = mended(project);
  assert.equal('plural' in result.project.settings.periodCustom, false);
  assert.ok(result.notes.some((note) => /plural of the custom period word could not be read/.test(note)));

  for (const bad of ['Lesson', 5, [], { word: '', count: 'number' }, { word: 4, count: 'number' }, {}]) {
    project = carrying();
    project.settings.periodCustom = bad;
    result = mended(project);
    assert.equal('periodCustom' in result.project.settings, false, JSON.stringify(bad));
    assert.equal(result.project.settings.periodWord, project.settings.periodWord, 'the period word is still there');
    assert.ok(result.notes.some((note) => /custom period word could not be read and was removed/.test(note)));
  }

  project = carrying();
  project.settings.periodCustom = null;
  result = repair(project);
  assert.equal(result.project.settings.periodCustom, null, 'null stays: it is none already');
  assert.deepEqual(result.notes, []);
});

test('repair: periodNames are trimmed to the periods, each cut to 24, a non-text name cleared', () => {
  const project = carrying();
  const periods = project.settings.periods;
  project.settings.periodNames = ['One', 'x'.repeat(30), 5, ...Array(periods + 1).fill('More')].slice(0, periods + 3);
  const { project: out, notes } = mended(project);
  assert.deepEqual(out.settings.periodNames, ['One', 'x'.repeat(24), '', ...Array(periods - 3).fill('More')]);
  assert.equal(notes.length, 3);
  assert.ok(notes.some((note) => new RegExp('past period ' + periods + ' were removed').test(note)));

  const loose = carrying();
  loose.settings.periodNames = '  Advisory ';
  const result = mended(loose);
  assert.equal('periodNames' in result.project.settings, false);
  assert.match(result.notes[0], /period names could not be read and were removed/);

  const kept = carrying();
  kept.settings.periodNames = ['  Advisory  '];
  assert.deepEqual(repair(kept).project.settings.periodNames, ['  Advisory  '], 'a name is as typed');
});

test('repair: a name list is cut when the periods repair sets are fewer than it has', () => {
  const project = carrying();
  project.settings.periods = 99;
  project.settings.periodNames = ['a', 'b'];
  const { project: out } = mended(project);
  assert.ok(out.settings.periods <= 16 && out.settings.periodNames.length <= out.settings.periods);
});

// ---------------------------------------------------------------- repair: away

const awayOf = (project) => project.teachers[0].away;

test('repair: an away entry that cannot be read is dropped, never widened to every day or the whole day', () => {
  const project = carrying();
  const day = project.dayTypes[0].id;
  project.teachers[0].away = [
    'Fridays',
    { dayTypeIds: 'all', weekdays: [], periods: [] },
    { dayTypeIds: [], weekdays: null, periods: [] },
    { dayTypeIds: [], weekdays: [], periods: 'all' },
    { dayTypeIds: [day], weekdays: [], periods: [1] },
  ];
  const { project: out, notes } = mended(project);
  assert.deepEqual(awayOf(out), [{ dayTypeIds: [day], weekdays: [], periods: [1] }]);
  assert.equal(notes.length, 4);

  const text = carrying();
  text.teachers[0].away = 'Fridays';
  const gone = mended(text);
  assert.equal('away' in gone.project.teachers[0], false);
  assert.match(gone.notes[0], /could not be read and was removed/);
});

test('repair: unknown day types are removed, and an entry that named some and has none left is dropped', () => {
  const project = carrying();
  const day = project.dayTypes[0].id;
  project.teachers[0].away = [
    { dayTypeIds: ['dgone00000', day], weekdays: [], periods: [] },
    { dayTypeIds: ['dgone00000'], weekdays: [], periods: [] },
    { dayTypeIds: [], weekdays: [], periods: [] },
  ];
  const { project: out, notes } = mended(project);
  assert.deepEqual(awayOf(out), [{ dayTypeIds: [day], weekdays: [], periods: [] }, { dayTypeIds: [], weekdays: [], periods: [] }]);
  assert.equal(notes.length, 2);
});

test('repair: periods past the end are removed, an entry whose periods all fall past the end is dropped, weekdays and repeats are mended', () => {
  const project = carrying();
  const end = project.settings.periods;
  project.teachers[0].away = [
    { dayTypeIds: [], weekdays: [], periods: [end + 1, 1, 1, end] },
    { dayTypeIds: [], weekdays: [], periods: [end, end + 3] },
    { dayTypeIds: [], weekdays: [9, 4, 4, 0], periods: [] },
    { dayTypeIds: [], weekdays: [9], periods: [] },
  ];
  const { project: out } = mended(project);
  assert.deepEqual(awayOf(out), [
    { dayTypeIds: [], weekdays: [], periods: [1] },
    { dayTypeIds: [], weekdays: [0, 4], periods: [] },
  ]);
});

test('repair: at most 12 entries are kept', () => {
  const project = carrying();
  project.teachers[0].away = Array.from({ length: 14 }, (_, n) => ({ dayTypeIds: [], weekdays: [n % 7], periods: [] }));
  const { project: out, notes } = mended(project);
  assert.equal(awayOf(out).length, 12);
  assert.ok(notes.some((note) => /at most 12 entries/.test(note)));
});

test('repair: a day type id that was renamed is followed', () => {
  const project = carrying();
  const first = project.dayTypes[0];
  const oldId = 'not-an-id';
  const groups = project.groups;
  first.id = oldId;
  for (const group of groups) {
    group.days[oldId] = group.days[Object.keys(group.days)[0]];
    delete group.days[Object.keys(group.days)[0]];
  }
  project.teachers[0].away = [{ dayTypeIds: [oldId], weekdays: [], periods: [] }];
  const result = repair(clone(project));
  const fresh = result.project.dayTypes[0].id;
  assert.ok(isId(fresh, 'd') && fresh !== oldId);
  assert.deepEqual(awayOf(result.project), [{ dayTypeIds: [fresh], weekdays: [], periods: [] }]);
});

// ---------------------------------------------------------------- repair: well

const flightsOf = (project) => project.building.connections.map((connection) => [connection.label, connection.well]);

test('repair: a well of flights that join is left as it is', () => {
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 'W' }], ['c00000001b', 'B', [1, 7], [2, 7], { well: 'W' }]]);
  const result = repair(project);
  assert.deepEqual(result.notes, []);
  assert.equal(result.project, project);
  assert.equal(stairwells(result.project.building)[0].parts, 1);
});

test('repair: a well on an elevator connection loses it', () => {
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { kind: ELEVATOR_KIND, car: 'A', well: 'W' }], ['c00000001b', 'B', [0, 9], [1, 9], { well: 'V' }]]);
  const { project: out, notes } = mended(project);
  assert.equal('well' in out.building.connections[0], false);
  assert.equal(out.building.connections[0].car, 'A');
  assert.equal(out.building.connections[1].well, 'V');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Elevator connection A carried a stairwell letter/);
});

test('repair: a well letter that is not text is removed, one that is too long is cut', () => {
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 4 }], ['c00000001b', 'B', [1, 7], [2, 7], { well: 'x'.repeat(12) }], ['c00000001c', 'C', [0, 9], [1, 9], { well: ' ' }]]);
  const { project: out, notes } = mended(project);
  assert.deepEqual(flightsOf(out), [['A', undefined], ['B', 'x'.repeat(8)], ['C', undefined]]);
  assert.equal(notes.length, 3);
});

test('repair: a well in two parts keeps its letter on the first part and gives the others fresh letters', () => {
  // an older planner pulled the middle flight out: floor 1 to 2 at cell 7, and floor 2 to 3 at cell 9
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 'W' }], ['c00000001b', 'B', [1, 9], [2, 9], { well: 'W' }], ['c00000001c', 'C', [0, 13], [1, 13], { well: 'W' }]]);
  assert.equal(stairwells(project.building)[0].parts, 3);
  const { project: out, notes } = mended(project);
  const letters = out.building.connections.map((connection) => connection.well);
  assert.equal(letters[0], 'W');
  assert.equal(new Set(letters).size, 3, 'each part has its own letter');
  assert.ok(letters.slice(1).every((letter) => letter !== 'A' && letter !== 'B' && letter !== 'C' && letter !== 'W'), 'a fresh letter is not any label or well already there: ' + letters.join());
  assert.deepEqual(stairwells(out.building).map((well) => well.parts), [1, 1, 1]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /was in 3 separate parts/);
});

test('repair: a well whose letter is a plain flight\'s label gets a fresh letter, and the plain flight keeps its own', () => {
  const project = wells([['c00000001a', 'W', [0, 9], [1, 9]], ['c00000001b', 'B', [0, 7], [1, 7], { well: 'w' }], ['c00000001c', 'C', [1, 7], [2, 7], { well: 'W' }]]);
  const { project: out, notes } = mended(project);
  assert.equal(out.building.connections[0].label, 'W');
  assert.equal('well' in out.building.connections[0], false);
  const [b, c] = out.building.connections.slice(1).map((connection) => connection.well);
  assert.equal(b, c, 'the two flights of the well are still one well');
  assert.ok(!['W', 'w', 'B', 'C'].includes(b), 'the fresh letter is none of the letters there: ' + b);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /same letter as a stairs connection that is not part of a stairwell/);
});

test('repair: a stair connection with no letter is not given a well\'s letter', () => {
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 'B' }], ['c00000001b', '', [1, 9], [2, 9]]]);
  const { project: out } = mended(project);
  assert.notEqual(out.building.connections[1].label, 'B');
  assert.notEqual(out.building.connections[1].label, 'A');
});

// ---------------------------------------------------------------- repair(valid) is valid

// Every new field in a form validate accepts and nothing about it is ordinary: a feature name with a
// space either side, a room's features in an order the list does not have and an empty list, a custom word
// of 16 characters with no plural, names that are blank or spaces, as long as the day, a teacher with 12
// entries of every shape, a weekday list in order. (Wells are in the next case: they need a building of joined flights.)
function unusual() {
  const project = carrying();
  const periods = project.settings.periods;
  project.building.features.push({ id: 'hhood00001', name: ' Fume hood ' }, { id: 'hlong00001', name: 'x'.repeat(30) });
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  rooms[0].featureIds = [SINK, 'hhood00001', LAB];
  rooms[1].featureIds = [];
  rooms[2].featureIds = ['hlong00001'];
  project.settings.periodCustom = { word: 'x'.repeat(16), count: 'ordinal' };
  project.settings.periodNames = ['', '   ', ' Lunch ', 'y'.repeat(24), ...Array(periods).fill('Block')].slice(0, periods);
  const day = project.dayTypes[0].id;
  project.teachers[0].away = [
    { dayTypeIds: [day], weekdays: [0, 6], periods: [0] },
    { dayTypeIds: [], weekdays: [], periods: [] },
    { dayTypeIds: [], weekdays: [1, 2, 3], periods: [0, 1, periods - 1] },
    ...Array.from({ length: 9 }, (_, k) => ({ dayTypeIds: [], weekdays: [k % 7], periods: [] })),
  ];
  project.teachers[1].away = [];
  return project;
}

test('repair is the identity on a project carrying every new field in valid but unusual forms', () => {
  const project = unusual();
  assert.deepEqual(validate(project), [], 'it is valid');
  assert.equal(project.teachers[0].away.length, 12);
  const text = JSON.stringify(project);
  const result = repair(project);
  assert.deepEqual(result.notes, []);
  assert.equal(result.project, project, 'the same object');
  assert.equal(JSON.stringify(result.project), text);
});

test('repair is the identity on wells in valid forms: a letter with a space inside, lower case, a flight alone, joined flights', () => {
  const project = wells([
    ['c00000001a', 'A', [0, 7], [1, 7], { well: 'ab cd' }], ['c00000001b', 'B', [1, 7], [2, 7], { well: 'ab cd' }],
    ['c00000001c', 'C', [0, 9], [1, 9], { well: 'x'.repeat(8) }],
    ['c00000001d', 'D', [0, 13], [1, 13]],
  ]);
  assert.deepEqual(validate(project), []);
  const result = repair(project);
  assert.deepEqual(result.notes, []);
  assert.equal(result.project, project);
});

test('repair(valid) is valid: what validate accepts, repair does not change, one field at a time', () => {
  for (const [what, change] of [
    ['weekdays in order', (p) => { p.teachers[0].away[0].weekdays = [2, 5]; }],
    ['a period word with a space inside', (p) => { p.settings.periodCustom.word = 'Two words'; }],
    ['a feature name with spaces round it', (p) => { p.building.features[0].name = ' Lab '; }],
    ['periodNames of every period', (p) => { p.settings.periodNames = Array(p.settings.periods).fill(' '); }],
    ['null for the custom word', (p) => { p.settings.periodCustom = null; }],
  ]) {
    const project = carrying();
    change(project);
    assert.deepEqual(validate(project), [], what + ' is valid');
    const result = repair(project);
    assert.equal(result.project, project, what);
    assert.deepEqual(result.notes, [], what);
  }
});

test('repair: weekdays out of order are put in order with a note that says so (validate refuses them)', () => {
  const project = carrying();
  project.teachers[0].away[0].weekdays = [4, 0];
  assert.deepEqual(paths(project), ['teachers[0].away[0].weekdays']);
  const { project: out, notes } = mended(project);
  assert.deepEqual(out.teachers[0].away[0].weekdays, [0, 4]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /weekdays of an entry .* were put in order/);
  const periods = carrying();
  periods.teachers[0].away[0].periods = [2, 1];
  const mendedPeriods = mended(periods);
  assert.deepEqual(mendedPeriods.project.teachers[0].away[0].periods, [1, 2]);
  assert.match(mendedPeriods.notes[0], /periods of an entry .* were put in order/);
});

test('repair: an away entry\'s note says its cause, one note for each', () => {
  const project = carrying();
  const day = project.dayTypes[0].id;
  const end = project.settings.periods;
  project.teachers[0].away = [{ dayTypeIds: ['dgone00000', day, day], weekdays: [9, 1, 1], periods: [end + 2, 1, 1, -3] }];
  const { notes } = mended(project);
  const said = (pattern) => notes.filter((note) => pattern.test(note)).length;
  assert.equal(said(/1 day type that is not in the project/), 1);
  assert.equal(said(/listed a day type twice/), 1);
  assert.equal(said(/1 weekday that does not exist/), 1);
  assert.equal(said(/listed a weekday twice/), 1);
  assert.equal(said(/1 period that is not a period number from 0/), 1);
  assert.equal(said(/listed a period twice/), 1);
  assert.equal(said(/1 period past the end of the day/), 1);
  assert.equal(notes.length, 7, notes.join('\n'));
  // a note names a cause only when it is the cause
  const only = carrying();
  only.teachers[0].away = [{ dayTypeIds: [], weekdays: [], periods: [end + 1, 2] }];
  assert.deepEqual(mended(only).notes.map((note) => note.replace(/^.*away /, '')), ['named 1 period past the end of the day; it was removed.']);
});

test('repair: the custom word with spaces is trimmed and the note says it was trimmed', () => {
  const project = carrying();
  project.settings.periodCustom = { word: ' Lesson', plural: 'Lessons ', count: 'letter' };
  assert.deepEqual(paths(project), ['settings.periodCustom.word', 'settings.periodCustom.plural']);
  const { project: out, notes } = mended(project);
  assert.deepEqual(out.settings.periodCustom, { word: 'Lesson', plural: 'Lessons', count: 'letter' });
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => /was trimmed or cut/.test(note)));
});

test('repair: "1 period name was not text" and "2 period names were not text"', () => {
  const one = carrying();
  one.settings.periodNames = ['a', 5];
  assert.match(mended(one).notes[0], /^1 period name was not text and was cleared\.$/);
  const two = carrying();
  two.settings.periodNames = [5, 'a', null];
  assert.match(mended(two).notes[0], /^2 period names were not text and were cleared\.$/);
});

test('repair: a duplicate feature name is trimmed before it is made unique', () => {
  const project = carrying();
  project.building.features = [{ id: LAB, name: 'lab' }, { id: SINK, name: ' lab ' }];
  project.building.floors.flatMap((floor) => floor.spaces).forEach((space) => { delete space.featureIds; });
  const { project: out } = mended(project);
  assert.deepEqual(out.building.features.map((feature) => feature.name), ['lab', 'lab (2)']);
});

test('repair: flights of a well written "W" and "w" end with one letter string, the first\'s', () => {
  const project = wells([['c00000001a', 'A', [0, 7], [1, 7], { well: 'W' }], ['c00000001b', 'B', [1, 7], [2, 7], { well: 'w' }]]);
  assert.deepEqual(validate(project), []);
  const { project: out, notes } = mended(project);
  assert.deepEqual(flightsOf(out), [['A', 'W'], ['B', 'W']]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /was also written "w"/);
});

test('repair: a well whose letter is an elevator\'s label gets a fresh letter, and the elevator keeps its own', () => {
  const project = wells([['c00000001a', 'E', [0, 7], [1, 7], { kind: ELEVATOR_KIND, car: 'A' }], ['c00000001b', 'B', [0, 9], [1, 9], { well: 'e' }], ['c00000001c', 'C', [1, 9], [2, 9], { well: 'E' }]]);
  const { project: out, notes } = mended(project);
  assert.equal(out.building.connections[0].label, 'E');
  const [b, c] = out.building.connections.slice(1).map((connection) => connection.well);
  assert.equal(b, c);
  assert.ok(!['E', 'e', 'B', 'C'].includes(b), 'fresh: ' + b);
  assert.equal(notes.length, 1);
});

// ---------------------------------------------------------------- an older planner

// The real pre-W7 engine, frozen: the modules repair.js and validate.js of commit e1455dc8 import,
// followed to the end, in test/fixtures/engine-pre-w7/ (see its README.txt). The test does not
// remove anything from today's engine: what an older planner does with a W7 field is what its code does.
const OLD = new URL('../fixtures/engine-pre-w7/', import.meta.url);
const old = {
  repair: (await import(new URL('repair.js', OLD).href)).repair,
  validate: (await import(new URL('validate.js', OLD).href)).validate,
  ids: await import(new URL('ids.js', OLD).href),
  schema: await import(new URL('schema.js', OLD).href),
};

test('an older planner: its code is the pre-W7 code (no feature prefix, no W7 rule in its sources)', () => {
  assert.equal(old.ids.ID_PREFIXES.feature, undefined, 'the frozen ids.js knows no feature prefix');
  assert.deepEqual(old.ids.collectIds(carrying()).filter((id) => id === LAB), [], 'and does not walk features');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '..', 'fixtures', 'engine-pre-w7');
  for (const name of ['repair.js', 'validate.js', 'ids.js']) assert.equal(/W7/.test(readFileSync(path.join(dir, name), 'utf8')), false, name + ' has no W7 mark');
});

test('an older planner: repair and validate keep every new field byte for byte and refuse nothing', () => {
  for (const [what, make] of [['a project carrying every field', carrying], ['the same in unusual forms', unusual]]) {
    const project = make();
    const [first, second] = project.building.connections;
    first.well = 'W';
    second.well = 'W';
    const text = JSON.stringify(project);
    assert.ok(text.includes('"features"') && text.includes('"periodCustom"') && text.includes('"periodNames"') && text.includes('"away"') && text.includes('"well"') && text.includes('"featureIds"'), what + ': every new field is in the project');
    const result = old.repair(JSON.parse(text));
    assert.equal(JSON.stringify(result.project), text, what + ': repair leaves every new field as it found it');
    assert.deepEqual(result.notes, [], what);
    assert.deepEqual(old.validate(JSON.parse(text)), [], what + ': validate refuses nothing');
    assert.deepEqual(validate(JSON.parse(text)), [], what + ': nor does today\'s');
  }
});

test('an older planner takes what today\'s validate refuses and its repair does not touch it (why validate checks form only)', () => {
  const odd = carrying();
  odd.building.features = 'Lab';
  odd.settings.periodCustom = 'Lesson';
  odd.settings.periodNames = 7;
  odd.teachers[0].away = { never: 'a list' };
  odd.building.connections[0].well = 4;
  const text = JSON.stringify(odd);
  assert.deepEqual(old.validate(JSON.parse(text)), [], 'the old code has no rule for any of them');
  assert.equal(JSON.stringify(old.repair(JSON.parse(text)).project), text, 'nor does its repair touch them');
  assert.notDeepEqual(validate(JSON.parse(text)), [], 'today\'s validate has');
  assert.notEqual(JSON.stringify(repair(JSON.parse(text)).project), text, 'today\'s repair does');
});

test('an older planner draws a plain flight the letter of a well; today\'s repair gives the well a fresh letter', () => {
  const flights = [{ label: 'A' }, { label: 'C', well: 'B' }];
  const drawn = old.schema.nextConnectionLabel(flights);
  assert.equal(drawn, 'B', 'the old nextConnectionLabel does not look at wells');
  assert.equal(nextConnectionLabel(flights), 'D', 'today\'s does');
  const project = wells([['c00000001a', 'A', [0, 13], [1, 13]], ['c00000001c', 'C', [0, 7], [1, 7], { well: 'B' }], ['c00000001b', drawn, [0, 9], [1, 9]]]);
  const text = JSON.stringify(project);
  assert.equal(JSON.stringify(old.repair(JSON.parse(text)).project), text, 'the older planner finds nothing wrong');
  assert.deepEqual(validate(JSON.parse(text)), [], 'and today\'s validate accepts it (form only)');
  const { project: out, notes } = mended(project);
  assert.deepEqual(flightsOf(out), [['A', undefined], ['C', 'D'], ['B', undefined]], 'the plain flight keeps B, the well is given D');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Stairwell B had the same letter/);
});

test('newRoom carries featureIds only when asked (so a project that never uses features stays as it was)', () => {
  assert.equal('featureIds' in newRoom('rnew000001', [0]), false);
  assert.deepEqual(newRoom('rnew000001', [0], [LAB]).featureIds, [LAB]);
});
