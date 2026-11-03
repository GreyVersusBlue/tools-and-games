// Staggered dismissal in the real schedule (ARCHITECTURE 18.2, SV2-88):
// node test/engine/release.test.mjs
//
// The rule (releaseDelay), the field (absent, repair, validate), the actions,
// what deleting a group, a day type or a period does to it, the schedule
// file, and the one promise about everything else: a project with no
// `release` gives the pipeline results it gave before the field existed.
// The crowd, the walk-late sentence and the worker's cache have their cases
// in crowd.test.mjs, checks.test.mjs and worker.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as actions from '../../engine/actions.js';
import { releaseDelay, releaseKind } from '../../engine/release.js';
import { repair } from '../../engine/repair.js';
import { validate } from '../../engine/validate.js';
import { createStore } from '../../engine/store.js';
import { createIds, seededRandom, ID_PREFIXES, collectIds } from '../../engine/ids.js';
import { RELEASE_MOST, releaseOf } from '../../engine/schema.js';
import { writeScheduleFile, readScheduleFile, applySchedule, writeProjectFile, readProjectFile } from '../../engine/project-file.js';
import { createPipeline } from '../../engine/worker.js';
import { sampleSchool } from '../../data/sample-school.js';
import { school, clone, makeIds, ctx, clock, assertValid } from './helpers.mjs';
import { bigProject } from '../fixtures/big.mjs';

const { ActionError, SCHEDULE } = actions;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const A = 'dsample00a';
const B = 'dsample00b';
const ASSEMBLY = 'dsample0as'; // the same as B Day

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const shared = ctx();

function run(action, project, payload) {
  const after = action(freeze(project), payload === undefined ? {} : payload, shared);
  assertValid(after, 'the project is still valid after the action');
  return after;
}

function refused(action, project, payload, code) {
  assert.throws(() => action(freeze(project), payload, ctx()), (error) => {
    assert.ok(error instanceof ActionError, 'an ActionError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/, 'the message is a sentence');
    return true;
  });
}

function entry(id, who, seconds, extra) {
  return { id, who, seconds, after: null, dayTypeIds: null, ...(extra || {}) };
}

function withRelease(list, project) {
  return { ...(project || school()), release: list };
}

// ---------------------------------------------------------------- the rule

test('releaseDelay: a project with no release, or an empty one, leaves on the bell', () => {
  const project = school();
  assert.equal('release' in project, false);
  assert.equal(releaseDelay(project, 'gsample07a', A, 0, 'rsample101'), 0);
  assert.equal(releaseDelay(withRelease([]), 'gsample07a', A, 0, 'rsample101'), 0);
});

test('releaseDelay: groups, then grade, then wing: the most specific rank wins, a groups entry of 0 holds a grade back by one group', () => {
  const project = withRelease([
    entry('l000000001', { wing: 'West' }, 30),
    entry('l000000002', { grade: '7' }, 120),
    entry('l000000003', { groups: ['gsample07a'] }, 0),
  ]);
  // 7A is in grade 7 and leaves from West: the groups entry decides, and it says 0
  assert.equal(releaseDelay(project, 'gsample07a', A, 0, 'rsample101'), 0);
  // 7B has only the grade and the wing: grade beats wing
  assert.equal(releaseDelay(project, 'gsample07b', A, 0, 'rsample101'), 120);
  // 6A has only the wing
  assert.equal(releaseDelay(project, 'gsample06a', A, 0, 'rsample101'), 30);
  // 8A leaving the East has nothing
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, 'rsample204'), 0);
});

test('releaseDelay: within a rank the largest delay wins, whatever the order', () => {
  const list = [entry('l000000001', { grade: '7' }, 60), entry('l000000002', { grade: ' 7 ' }, 180), entry('l000000003', { grade: '7' }, 90)];
  assert.equal(releaseDelay(withRelease(list), 'gsample07c', A, 3, 'rsample101'), 180);
  assert.equal(releaseDelay(withRelease(list.slice().reverse()), 'gsample07c', A, 3, 'rsample101'), 180);
  const groups = [entry('l000000001', { groups: ['gsample07a'] }, 45), entry('l000000002', { groups: ['gsample07a', 'gsample07b'] }, 75)];
  assert.equal(releaseDelay(withRelease(groups), 'gsample07a', A, 0, null), 75);
});

test('releaseDelay: a grade matches ignoring case and the spaces around it; a group with no grade matches no grade entry', () => {
  const project = withRelease([entry('l000000001', { grade: ' EIGHT ' }, 60)]);
  project.groups = project.groups.map((group) => (group.id === 'gsample08a' ? { ...group, grade: 'eight' } : group.id === 'gsample08b' ? { ...group, grade: '' } : group));
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, null), 60);
  assert.equal(releaseDelay(project, 'gsample08b', A, 0, null), 0);
  const blank = withRelease([entry('l000000001', { grade: '' }, 60)]);
  assert.equal(releaseDelay(blank, 'gsample08b', A, 0, null), 0, 'an empty grade is not every group with an empty grade');
});

test('releaseDelay: a wing is the wing of the room the group is leaving, ignoring case and spaces', () => {
  const project = withRelease([entry('l000000001', { wing: ' music WING ' }, 45)]);
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, 'rsample303'), 45, 'leaving 303, in the Music Wing');
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, 'rsample101'), 0, 'the room it is going to does not matter: this one is West');
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, 'rsample203'), 0, 'a room with no wing matches no wing entry');
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, 'rnowhere00'), 0, 'a room that is not there matches none');
  assert.equal(releaseDelay(project, 'gsample08a', A, 0, null), 0);
});

test('releaseDelay: after names the periods followed; null is every period', () => {
  const project = withRelease([entry('l000000001', { grade: '6' }, 60, { after: [2, 4] })]);
  const at = (period) => releaseDelay(project, 'gsample06a', A, period, null);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(at), [0, 0, 60, 0, 60, 0]);
  const every = withRelease([entry('l000000001', { grade: '6' }, 60)]);
  assert.deepEqual([0, 1, 2, 3].map((period) => releaseDelay(every, 'gsample06a', A, period, null)), [60, 60, 60, 60]);
});

test('releaseDelay: a day type matches directly or through the day type it is the same as; null is every day type', () => {
  const onB = withRelease([entry('l000000001', { grade: '6' }, 60, { dayTypeIds: [B] })], sampleSchool());
  assert.equal(releaseDelay(onB, 'gsample06a', B, 0, null), 60);
  assert.equal(releaseDelay(onB, 'gsample06a', A, 0, null), 0);
  assert.equal(releaseDelay(onB, 'gsample06a', ASSEMBLY, 0, null), 60, 'Assembly Day is the same as B Day');
  const onAssembly = withRelease([entry('l000000001', { grade: '6' }, 60, { dayTypeIds: [ASSEMBLY] })], sampleSchool());
  assert.equal(releaseDelay(onAssembly, 'gsample06a', ASSEMBLY, 0, null), 60);
  assert.equal(releaseDelay(onAssembly, 'gsample06a', B, 0, null), 0, 'naming the follower does not reach the day type it follows');
  const every = withRelease([entry('l000000001', { grade: '6' }, 60)], sampleSchool());
  assert.deepEqual([A, B, ASSEMBLY].map((dayTypeId) => releaseDelay(every, 'gsample06a', dayTypeId, 0, null)), [60, 60, 60]);
});

test('releaseDelay: an entry that cannot be read (two kinds, no kind, seconds not whole) is no delay', () => {
  const broken = withRelease([
    entry('l000000001', { grade: '6', wing: 'West' }, 60),
    entry('l000000002', {}, 60),
    entry('l000000003', { grade: '6' }, 7.5),
    entry('l000000004', null, 60),
  ]);
  assert.equal(releaseDelay(broken, 'gsample06a', A, 0, 'rsample101'), 0);
  assert.equal(releaseKind({ grade: '6', wing: 'West' }), null);
  assert.equal(releaseKind({ groups: [] }), 'groups');
  assert.equal(releaseKind([]), null);
});

// ---------------------------------------------------------------- ids

test('ids: release has the prefix l, collectIds sees it, and a clash with another kind is not possible', () => {
  assert.equal(ID_PREFIXES.release, 'l');
  const prefixes = Object.values(ID_PREFIXES);
  assert.equal(new Set(prefixes).size, prefixes.length, 'every kind has a letter of its own');
  const project = withRelease([entry('lreleaseaa', { grade: '6' }, 60)]);
  assert.ok(collectIds(project).includes('lreleaseaa'));
  const ids = createIds(seededRandom(3));
  ids.reserve(collectIds(project));
  for (let i = 0; i < 50; i += 1) assert.notEqual(ids('l'), 'lreleaseaa');
});

// ---------------------------------------------------------------- repair and validate

test('repair: a project with no release is handed back as it came, and so is the sample school', () => {
  const sample = sampleSchool();
  assert.equal('release' in sample, false, 'absent on the sample');
  const fixed = repair(sample);
  assert.equal(fixed.project, sample, 'the very same object');
  assert.deepEqual(fixed.notes, []);
  assert.equal('release' in fixed.project, false, 'absent stays absent');
});

test('repair: a sound release is handed back as it came', () => {
  const project = withRelease([
    entry('lrelease01', { groups: ['gsample07a', 'gsample07b'] }, 0, { after: [1, 3], dayTypeIds: [A, ASSEMBLY] }),
    entry('lrelease02', { grade: '8' }, 120),
    entry('lrelease03', { wing: 'East' }, 15, { after: null, dayTypeIds: [B] }),
  ], sampleSchool());
  const fixed = repair(project);
  assert.equal(fixed.project, project);
  assert.deepEqual(fixed.notes, []);
});

test('repair: release that is not a list is emptied, an entry that is not an object is dropped, with notes', () => {
  const text = repair({ ...sampleSchool(), release: 'soon' });
  assert.deepEqual(text.project.release, []);
  assert.match(text.notes.join('\n'), /staggered dismissals could not be read/);
  const mixed = repair({ ...sampleSchool(), release: [7, null, entry('lrelease01', { grade: '6' }, 60)] });
  assert.deepEqual(mixed.project.release.map((item) => item.id), ['lrelease01']);
  assert.match(mixed.notes.join('\n'), /2 entries in the list of staggered dismissals could not be read/);
});

test('repair: an entry with no valid who, or seconds out of range or not whole, goes with a note', () => {
  const bad = [
    entry('lrelease01', { grade: '6', wing: 'West' }, 60),
    entry('lrelease02', {}, 60),
    entry('lrelease03', 'North', 60),
    entry('lrelease04', { grade: '   ' }, 60),
    entry('lrelease05', { wing: 7 }, 60),
    entry('lrelease06', { groups: 'gsample07a' }, 60),
    entry('lrelease07', { grade: '6' }, 14),
    entry('lrelease08', { grade: '6' }, 301),
    entry('lrelease09', { grade: '6' }, 60.5),
    entry('lrelease10', { grade: '6' }, '60'),
    entry('lrelease11', { grade: '6' }, 0),
    entry('lrelease12', { groups: ['gsample07a'] }, -15),
    entry('lrelease13', { grade: '6' }, 60),
  ];
  const fixed = repair({ ...sampleSchool(), release: bad });
  assert.deepEqual(fixed.project.release.map((item) => item.id), ['lrelease13'], 'only the sound one stays; a grade entry of 0 is not allowed, a groups entry of 0 is');
  assert.equal(fixed.notes.filter((note) => /was removed/.test(note)).length, 12);
  assert.deepEqual(validate(fixed.project), []);
  const zero = repair({ ...sampleSchool(), release: [entry('lrelease01', { groups: ['gsample07a'] }, 0)] });
  assert.equal(zero.project.release.length, 1, 'a groups entry may leave on the bell');
});

test('repair: a group that is not there is dropped from who.groups, and an entry left with none goes', () => {
  const fixed = repair({ ...sampleSchool(), release: [
    entry('lrelease01', { groups: ['gsample07a', 'gnowhere00', 'gsample07a'] }, 60),
    entry('lrelease02', { groups: ['gnowhere00'] }, 60),
  ] });
  assert.deepEqual(fixed.project.release.map((item) => [item.id, item.who]), [['lrelease01', { groups: ['gsample07a'] }]]);
  assert.equal(fixed.notes.length, 2);
  assert.match(fixed.notes[0], /named 2 groups that are not in the project, or the same one twice; they were removed from it/);
  assert.match(fixed.notes[1], /named no group that is in the project and was removed/);
});

test('repair: a day type that is not there removes the entry; a period that is not a whole number removes it; periods past the day are trimmed', () => {
  const fixed = repair({ ...sampleSchool(), release: [
    entry('lrelease01', { grade: '6' }, 60, { dayTypeIds: [A, 'dnowhere00'] }),
    entry('lrelease02', { grade: '6' }, 60, { dayTypeIds: [] }),
    entry('lrelease03', { grade: '6' }, 60, { dayTypeIds: 'A' }),
    entry('lrelease04', { grade: '6' }, 60, { after: [1, 'x'] }),
    entry('lrelease05', { grade: '6' }, 60, { after: [1.5] }),
    entry('lrelease06', { grade: '6' }, 60, { after: -1 }),
    entry('lrelease07', { grade: '6' }, 60, { after: [1, 3, 8, 9] }),
    entry('lrelease08', { grade: '6' }, 60, { after: [8, 9] }),
    entry('lrelease09', { grade: '6' }, 60, { after: [3, 1, 3] }),
  ] });
  assert.deepEqual(fixed.project.release.map((item) => [item.id, item.after]), [['lrelease07', [1, 3]], ['lrelease09', [1, 3]]]);
  assert.match(fixed.notes.join('\n'), /2 periods of Staggered dismissal 7 are past the end of the day and were removed from it/);
  assert.match(fixed.notes.join('\n'), /followed only periods past the end of the day/);
  assert.deepEqual(validate(fixed.project), []);
});

test('repair: the missing keys of an entry are filled (after and dayTypeIds null), more than 50 entries are cut with a note', () => {
  const bare = repair({ ...sampleSchool(), release: [{ id: 'lrelease01', who: { grade: '6' }, seconds: 60 }] });
  assert.deepEqual(bare.project.release[0], entry('lrelease01', { grade: '6' }, 60));
  const many = [];
  for (let i = 0; i < 53; i += 1) many.push(entry('l' + String(i).padStart(9, '0'), { grade: String(i) }, 60));
  const cut = repair({ ...sampleSchool(), release: many });
  assert.equal(cut.project.release.length, RELEASE_MOST);
  assert.equal(cut.notes.filter((note) => /past the limit of 50/.test(note)).length, 3);
});

test('repair: an id of the wrong form is replaced and the renamed map is followed into who.groups and dayTypeIds', () => {
  const project = clone(sampleSchool());
  // a group, a day type and a release entry with ids of the wrong form
  const group = project.groups.find((candidate) => candidate.id === 'gsample07a');
  const dayType = project.dayTypes.find((candidate) => candidate.id === B);
  const renamedGroup = 'seven-a';
  const renamedDay = 'bee';
  for (const item of project.groups) if (item === group) { item.days[renamedDay] = item.days[B]; }
  group.id = renamedGroup;
  for (const item of project.groups) { item.days[renamedDay] = item.days[B]; delete item.days[B]; }
  dayType.id = renamedDay;
  for (const other of project.dayTypes) if (other.sameAs === B) other.sameAs = renamedDay;
  project.release = [{ id: 'not-an-id', who: { groups: [renamedGroup] }, seconds: 60, after: null, dayTypeIds: [renamedDay] }];
  const fixed = repair(project, { ids: makeIds(11) });
  const [moved] = fixed.project.release;
  const newGroup = fixed.project.groups.find((candidate) => candidate.name === '7A');
  const newDay = fixed.project.dayTypes.find((candidate) => candidate.name === 'B Day');
  assert.notEqual(newGroup.id, renamedGroup);
  assert.notEqual(newDay.id, renamedDay);
  assert.deepEqual(moved.who, { groups: [newGroup.id] });
  assert.deepEqual(moved.dayTypeIds, [newDay.id]);
  assert.match(moved.id, /^l[a-z0-9]{9}$/, 'the entry has an id of its own kind now');
  assert.deepEqual(validate(fixed.project), []);
});

test('repair: a release entry that shares an id with something earlier of its kind gets a new one', () => {
  const fixed = repair({ ...sampleSchool(), release: [entry('lrelease01', { grade: '6' }, 60), entry('lrelease01', { grade: '7' }, 60)] }, { ids: makeIds(5) });
  assert.equal(new Set(fixed.project.release.map((item) => item.id)).size, 2);
  assert.match(fixed.notes[0], /shared the id "lrelease01" with something earlier/);
});

test('validate: absent is fine; a sound release is fine; each way an entry can be wrong is named where it is', () => {
  assert.deepEqual(validate(sampleSchool()), []);
  assert.deepEqual(validate(withRelease([entry('lrelease01', { groups: ['gsample07a'] }, 0), entry('lrelease02', { grade: '7' }, 300, { after: [0, 4], dayTypeIds: [A] })], sampleSchool())), []);
  const problems = (list) => validate(withRelease(list, sampleSchool())).map((finding) => finding.path);
  assert.deepEqual(problems([7]), ['release[0]']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7', wing: 'x' }, 60)]), ['release[0].who']);
  assert.deepEqual(problems([entry('lrelease01', { cohort: '7' }, 60)]), ['release[0].who']);
  assert.deepEqual(problems([entry('lrelease01', { groups: [] }, 60)]), ['release[0].who.groups']);
  assert.deepEqual(problems([entry('lrelease01', { groups: ['gnowhere00'] }, 60)]), ['release[0].who.groups[0]']);
  assert.deepEqual(problems([entry('lrelease01', { groups: ['gsample07a', 'gsample07a'] }, 60)]), ['release[0].who.groups[1]']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '  ' }, 60)]), ['release[0].who.grade']);
  assert.deepEqual(problems([entry('lrelease01', { wing: 'W'.repeat(81) }, 60)]), ['release[0].who.wing']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 0)]), ['release[0].seconds'], 'only a groups entry may be 0');
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 301)]), ['release[0].seconds']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 90.5)]), ['release[0].seconds']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60, { after: [] })]), ['release[0].after']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60, { after: [3, 1] })]), ['release[0].after']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60, { after: [1.5] })]), ['release[0].after']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60, { dayTypeIds: [] })]), ['release[0].dayTypeIds']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60, { dayTypeIds: ['dnowhere00'] })]), ['release[0].dayTypeIds[0]']);
  assert.deepEqual(problems([entry('lbad', { grade: '7' }, 60)]), ['release[0].id']);
  assert.deepEqual(problems([entry('lrelease01', { grade: '7' }, 60), entry('lrelease01', { grade: '8' }, 60)]), ['release[1].id']);
  assert.deepEqual(validate({ ...sampleSchool(), release: {} }).map((finding) => finding.path), ['release']);
  const many = [];
  for (let i = 0; i < 51; i += 1) many.push(entry('l' + String(i).padStart(9, '0'), { grade: String(i) }, 60));
  assert.deepEqual(problems(many), ['release'], 'more than 50 entries');
});

test('validate: a period past the end of the day is not refused (repair trims it), so a file is not turned away for it', () => {
  assert.deepEqual(validate(withRelease([entry('lrelease01', { grade: '7' }, 60, { after: [20] })], sampleSchool())), []);
});

// ---------------------------------------------------------------- actions

test('addRelease: one undo step, labelled, bumping SCHEDULE; undo takes it back and redo puts it back', () => {
  const store = createStore({ project: school(), clock, ids: createIds(seededRandom(21)) });
  const before = store.project;
  const version = store.scheduleVersion;
  store.apply(actions.addRelease, { who: { grade: ' 7 ' }, seconds: 120, after: [3, 1], dayTypeIds: [B, A] });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Add staggered dismissal for grade 7');
  assert.ok(store.scheduleVersion > version, 'SCHEDULE moved');
  const [made] = releaseOf(store.project);
  assert.match(made.id, /^l[a-z0-9]{9}$/);
  assert.deepEqual({ who: made.who, seconds: made.seconds, after: made.after, dayTypeIds: made.dayTypeIds }, { who: { grade: '7' }, seconds: 120, after: [1, 3], dayTypeIds: [A, B] }, 'trimmed, and in the order the project keeps');
  assert.deepEqual(actions.addRelease.bumps, [SCHEDULE]);
  store.undo();
  assert.equal('release' in store.project, false, 'the field is absent again');
  assert.equal(store.project.groups, before.groups);
  store.redo();
  assert.equal(releaseOf(store.project).length, 1);
});

test('addRelease: groups, a wing, defaults (every period, every day type), a given id', () => {
  let project = run(actions.addRelease, school(), { who: { groups: ['gsample07b', 'gsample07a'] }, seconds: 0 });
  assert.deepEqual(project.release[0].who, { groups: ['gsample07a', 'gsample07b'] }, 'in the project\'s order');
  assert.equal(project.release[0].after, null);
  assert.equal(project.release[0].dayTypeIds, null);
  project = run(actions.addRelease, project, { who: { wing: 'East' }, seconds: 45, id: 'lgivenid01' });
  assert.equal(project.release[1].id, 'lgivenid01');
  assert.equal(actions.addRelease.label(school(), { who: { groups: ['gsample07b', 'gsample07a'] }, seconds: 0 }), 'Add staggered dismissal for 7B and 7A');
  assert.equal(actions.addRelease.label(school(), { who: { wing: 'East' }, seconds: 45 }), 'Add staggered dismissal for the East wing');
  refused(actions.addRelease, project, { who: { wing: 'East' }, seconds: 45, id: 'lgivenid01' }, 'duplicate-id');
  refused(actions.addRelease, project, { who: { wing: 'East' }, seconds: 45, id: 'xgivenid02' }, 'bad-id');
});

test('addRelease: seconds outside 15 to 300 (0 for a groups entry), an empty who, bad periods and day types are refused, in words', () => {
  const project = school();
  const who = { grade: '7' };
  refused(actions.addRelease, project, { who, seconds: 10 }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 0 }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 301 }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 90.5 }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: '90' }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: undefined }, 'bad-value');
  refused(actions.addRelease, project, { who: { groups: ['gsample07a'] }, seconds: 301 }, 'bad-value');
  refused(actions.addRelease, project, { who: { groups: ['gsample07a'] }, seconds: -1 }, 'bad-value');
  refused(actions.addRelease, project, { who: { groups: [] }, seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { who: { groups: ['gnowhere00'] }, seconds: 60 }, 'missing');
  refused(actions.addRelease, project, { who: { grade: '   ' }, seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { who: { wing: '' }, seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { who: { wing: 'W'.repeat(81) }, seconds: 60 }, 'too-long');
  refused(actions.addRelease, project, { who: {}, seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { who: { grade: '7', wing: 'East' }, seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { seconds: 60 }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 60, after: [] }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 60, after: [8] }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 60, after: [-1] }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 60, dayTypeIds: [] }, 'bad-value');
  refused(actions.addRelease, project, { who, seconds: 60, dayTypeIds: ['dnowhere00'] }, 'missing');
  assert.throws(() => actions.addRelease(freeze(project), { who, seconds: 10 }, ctx()), /15 to 300/);
  assert.throws(() => actions.addRelease(freeze(project), { who: { groups: ['gsample07a'] }, seconds: 400 }, ctx()), /or 0 for groups that leave on the bell/);
});

test('addRelease: at most 50 entries, said in words, and the 50th is still allowed', () => {
  let project = school();
  for (let i = 0; i < RELEASE_MOST; i += 1) project = actions.addRelease(project, { who: { grade: 'g' + i }, seconds: 30 }, shared);
  assert.equal(project.release.length, RELEASE_MOST);
  assertValid(project);
  refused(actions.addRelease, project, { who: { grade: 'one more' }, seconds: 30 }, 'limit');
  assert.throws(() => actions.addRelease(project, { who: { grade: 'one more' }, seconds: 30 }, ctx()), /at most 50 staggered dismissals, and this one has 50\. Remove one to add another\./);
});

test('setRelease: changes what is given, one undo step, labelled; changing nothing makes no step', () => {
  const store = createStore({ project: withRelease([entry('lrelease01', { grade: '7' }, 120)]), clock, ids: createIds(seededRandom(22)) });
  store.apply(actions.setRelease, { id: 'lrelease01', seconds: 90 });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Change staggered dismissal for grade 7');
  assert.equal(store.project.release[0].seconds, 90);
  const after = store.project;
  store.apply(actions.setRelease, { id: 'lrelease01', seconds: 90 });
  store.apply(actions.setRelease, { id: 'lrelease01', who: { grade: '7' }, after: null });
  assert.equal(store.history.past.length, 1, 'no step for no change');
  assert.equal(store.project, after);
  store.apply(actions.setRelease, { id: 'lrelease01', who: { wing: 'East' }, after: [2], dayTypeIds: [A] });
  assert.deepEqual(store.project.release[0], entry('lrelease01', { wing: 'East' }, 90, { after: [2], dayTypeIds: [A] }));
  store.undo();
  assert.deepEqual(store.project.release, after.release);
  assert.deepEqual(actions.setRelease.bumps, [SCHEDULE]);
});

test('setRelease: the same refusals as add, checked against the kind the entry ends up with', () => {
  const project = withRelease([entry('lrelease01', { groups: ['gsample07a'] }, 0), entry('lrelease02', { grade: '7' }, 60)]);
  refused(actions.setRelease, project, { id: 'lrelease01', who: { grade: '7' } }, 'bad-value'); // a grade cannot leave on the bell
  run(actions.setRelease, project, { id: 'lrelease01', who: { grade: '7' }, seconds: 30 });
  refused(actions.setRelease, project, { id: 'lrelease02', seconds: 0 }, 'bad-value');
  run(actions.setRelease, project, { id: 'lrelease02', who: { groups: ['gsample07a'] }, seconds: 0 });
  refused(actions.setRelease, project, { id: 'lrelease02', seconds: 400 }, 'bad-value');
  refused(actions.setRelease, project, { id: 'lrelease02', after: [] }, 'bad-value');
  refused(actions.setRelease, project, { id: 'lrelease02', dayTypeIds: [] }, 'bad-value');
  refused(actions.setRelease, project, { id: 'lnowhere00', seconds: 60 }, 'missing');
});

test('removeRelease: one undo step, labelled; the last one removed leaves an empty list, valid', () => {
  const store = createStore({ project: withRelease([entry('lrelease01', { wing: 'West' }, 120)]), clock, ids: createIds(seededRandom(23)) });
  store.apply(actions.removeRelease, { id: 'lrelease01' });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Remove staggered dismissal for the West wing');
  assert.deepEqual(store.project.release, []);
  assertValid(store.project);
  assert.deepEqual(actions.removeRelease.bumps, [SCHEDULE]);
  store.undo();
  assert.equal(store.project.release.length, 1);
  refused(actions.removeRelease, store.project, { id: 'lnowhere00' }, 'missing');
});

test('the release actions are in the actions list with a label, bumps and a focus on the Day tab', () => {
  for (const name of ['addRelease', 'setRelease', 'removeRelease']) {
    assert.ok(typeof actions[name].label === 'function', name + ' has a label');
    assert.deepEqual(actions[name].bumps, [SCHEDULE]);
  }
  const project = run(actions.addRelease, school(), { who: { grade: '7' }, seconds: 60 });
  const info = actions.describeAction(actions.addRelease, school(), { who: { grade: '7' }, seconds: 60 }, project);
  assert.deepEqual(info.focus, { section: 'schedule', tab: 'day', releaseId: project.release[0].id });
});

// ---------------------------------------------------------------- what deleting follows

test('deleteGroup: the group leaves every entry\'s groups in the same undo step; an entry left with none goes; the outcome counts them', () => {
  const project = withRelease([
    entry('lrelease01', { groups: ['gsample07a', 'gsample07b'] }, 60),
    entry('lrelease02', { groups: ['gsample07a'] }, 0),
    entry('lrelease03', { grade: '7' }, 120),
    entry('lrelease04', { groups: ['gsample06a'] }, 60),
  ]);
  const store = createStore({ project, clock, ids: createIds(seededRandom(24)) });
  store.apply(actions.deleteGroup, { id: 'gsample07a' });
  assert.equal(store.history.past.length, 1, 'one step');
  assert.deepEqual(store.project.release.map((item) => [item.id, item.who]), [['lrelease01', { groups: ['gsample07b'] }], ['lrelease03', { grade: '7' }], ['lrelease04', { groups: ['gsample06a'] }]]);
  assert.equal(store.project.release[2], project.release[3], 'an entry it left alone is the very same object');
  assertValid(store.project);
  const outcome = store.undoOutcome;
  assert.equal(outcome.release, 2, 'one changed and one removed');
  assert.equal(outcome.releaseRemoved, 1);
  assert.match(outcome.text, /^Deleted 7A, .*2 staggered dismissals changed$/);
  store.undo();
  assert.equal(store.project.release.length, 4, 'undo brings them back');
  // a group no entry names reports nothing about release
  const quiet = actions.scheduleOutcome(run(actions.deleteGroup, project, { id: 'gsample08a' }));
  assert.equal('release' in quiet, false);
  assert.equal(quiet.text, 'Deleted 8A');
  // all removed
  const gone = actions.scheduleOutcome(run(actions.deleteGroup, withRelease([entry('lrelease02', { groups: ['gsample07a'] }, 0)]), { id: 'gsample07a' }));
  assert.equal(gone.text, 'Deleted 7A, 1 staggered dismissal removed');
});

test('deleteGroup: a project with no release stays without the field', () => {
  const after = run(actions.deleteGroup, school(), { id: 'gsample07a' });
  assert.equal('release' in after, false);
});

test('deleteDayType: the day type leaves every entry\'s day types; one left with none goes (it would mean every day type); the outcome counts them', () => {
  const project = withRelease([
    entry('lrelease01', { grade: '7' }, 60, { dayTypeIds: [A, B] }),
    entry('lrelease02', { grade: '7' }, 60, { dayTypeIds: [B] }),
    entry('lrelease03', { grade: '7' }, 60),
    entry('lrelease04', { grade: '7' }, 60, { dayTypeIds: [A] }),
  ], sampleSchool());
  const described = actions.describeDayTypeDelete(project, B);
  assert.equal(described.release, 2);
  assert.equal(described.releaseRemoved, 1);
  assert.match(described.text, /1 staggered dismissal removed|2 staggered dismissals changed/);
  const after = run(actions.deleteDayType, project, { dayTypeId: B });
  assert.deepEqual(after.release.map((item) => [item.id, item.dayTypeIds]), [['lrelease01', [A]], ['lrelease03', null], ['lrelease04', [A]]]);
  assert.equal(after.release[2], project.release[3]);
  assert.equal(actions.scheduleOutcome(after).release, 2);
  assert.equal(actions.scheduleOutcome(after).releaseRemoved, 1);
  const plain = actions.describeDayTypeDelete(sampleSchool(), B);
  assert.equal(plain.release, 0);
  assert.equal(plain.releaseRemoved, 0);
});

test('setPeriods and describePeriodChange: periods past the new count leave `after`; an entry that followed only those goes; undo brings them back', () => {
  const project = withRelease([
    entry('lrelease01', { grade: '7' }, 60, { after: [1, 6] }),
    entry('lrelease02', { grade: '7' }, 60, { after: [6, 7] }),
    entry('lrelease03', { grade: '7' }, 60, { after: [2] }),
    entry('lrelease04', { grade: '7' }, 60),
  ], sampleSchool());
  const described = actions.describePeriodChange(project, 6);
  assert.equal(described.release, 2, 'one trimmed and one removed');
  assert.ok(described.marksAndDutiesWords.includes('2 staggered dismissals'));
  assert.equal(described.losesData, true);
  const same = actions.describePeriodChange(withRelease([entry('lrelease01', { grade: '7' }, 60, { after: [1] })], sampleSchool()), 6);
  assert.equal(same.release, 0);
  const store = createStore({ project, clock, ids: createIds(seededRandom(25)) });
  store.apply(actions.setPeriods, { periods: 6 });
  assert.equal(store.history.past.length, 1);
  assert.deepEqual(store.project.release.map((item) => [item.id, item.after]), [['lrelease01', [1]], ['lrelease03', [2]], ['lrelease04', null]]);
  assertValid(store.project);
  store.undo();
  assert.deepEqual(store.project.release.map((item) => item.after), [[1, 6], [6, 7], [2], null]);
  // raising the count deletes nothing
  const raised = run(actions.setPeriods, project, { periods: 12 });
  assert.equal(raised.release, project.release);
  // the same through the settings action
  const viaSetting = run(actions.setSetting, project, { key: 'periods', value: 6 });
  assert.equal(viaSetting.release.length, 3);
});

test('describePeriodChange: a project with no release says nothing about it', () => {
  const described = actions.describePeriodChange(sampleSchool(), 6);
  assert.equal(described.release, 0);
  assert.equal(described.marksAndDutiesWords.some((word) => /staggered/.test(word)), false);
});

// ---------------------------------------------------------------- files

test('the project file round-trips release byte for byte', () => {
  const project = withRelease([entry('lrelease01', { groups: ['gsample07a'] }, 0, { after: [2], dayTypeIds: [B] }), entry('lrelease02', { wing: 'East' }, 90)], sampleSchool());
  const text = writeProjectFile(project);
  const read = readProjectFile(text);
  assert.deepEqual(read.project.release, project.release);
  assert.equal(writeProjectFile(read.project), text);
});

test('the schedule file round-trips release; a project without any writes the file it always did', () => {
  const plain = sampleSchool();
  assert.equal('release' in JSON.parse(writeScheduleFile(plain)), false, 'an older project\'s file is byte-identical: no release key');
  const project = withRelease([entry('lrelease01', { groups: ['gsample07a'] }, 0, { after: [2], dayTypeIds: [B] }), entry('lrelease02', { wing: 'East' }, 90)], sampleSchool());
  const text = writeScheduleFile(project);
  assert.deepEqual(JSON.parse(text).release, project.release);
  const read = readScheduleFile(text);
  assert.equal(read.summary.release, 2);
  assert.deepEqual(read.file.release, project.release);
  assert.equal(readScheduleFile(writeScheduleFile(plain)).summary.release, 0);
  assert.deepEqual(readScheduleFile(writeScheduleFile(plain)).file.release, []);
});

test('the schedule file: release fails the project\'s own rules as a finding naming where', () => {
  const project = withRelease([entry('lrelease01', { grade: '7' }, 60)], sampleSchool());
  const value = JSON.parse(writeScheduleFile(project));
  value.release[0].seconds = 5;
  assert.throws(() => readScheduleFile(JSON.stringify(value)), (error) => error.code === 'invalid' && /release\[0\]\.seconds/.test(error.message));
});

test('importing a schedule file: release is added, re-pointed through the matches, and an entry left naming nothing is dropped and counted', () => {
  const source = withRelease([
    entry('lrelease01', { groups: ['gsample07a', 'gsample07b'] }, 0, { dayTypeIds: [B] }),
    entry('lrelease02', { grade: '8' }, 150),
    entry('lrelease03', { wing: 'East' }, 45, { after: [1, 2] }),
  ], sampleSchool());
  const file = readScheduleFile(writeScheduleFile(source)).file;
  // into a school whose 7B is called 7B-Gold: the groups match by name, so 7B does not match and 7A does
  const target = sampleSchool();
  target.groups = target.groups.filter((group) => group.name !== '7B');
  const applied = applySchedule(target, file, { ids: makeIds(31), policy: { all: 'skip' } });
  assertValid(applied.project, 'the result is a valid project');
  const summary = applied.summary;
  assert.equal(summary.releaseAdded, 3);
  assert.equal(summary.releaseDropped, 0);
  // 7B is added by the import (its name is not here), so both groups are in the result
  const first = applied.project.release.find((item) => item.who.groups);
  assert.equal(first.who.groups.length, 2);
  assert.deepEqual(first.dayTypeIds, [B]);
  assert.deepEqual(applied.project.release.map((item) => item.seconds).sort((a, b) => a - b), [0, 45, 150]);
  // the same file applied again: the ids clash and nothing is added
  const again = applySchedule(applied.project, file, { ids: makeIds(32), policy: { all: 'skip' } });
  assert.equal(again.summary.releaseAdded, 0);
  assert.equal(again.summary.releaseKept, 3);
  assert.equal(again.project.release.length, 3);
});

test('importing a schedule file: the policy answers a clash on an entry\'s id as it does for marks (skip, overwrite, rename)', () => {
  const here = withRelease([entry('lrelease01', { grade: '7' }, 60)], sampleSchool());
  const fileProject = withRelease([entry('lrelease01', { grade: '7' }, 200)], sampleSchool());
  const file = readScheduleFile(writeScheduleFile(fileProject)).file;
  const skip = applySchedule(here, file, { ids: makeIds(41), policy: { all: 'skip' } });
  assert.deepEqual(skip.project.release.map((item) => item.seconds), [60]);
  assert.equal(skip.summary.releaseKept, 1);
  const overwrite = applySchedule(here, file, { ids: makeIds(42), policy: { all: 'overwrite' } });
  assert.deepEqual(overwrite.project.release.map((item) => item.seconds), [200]);
  assert.equal(overwrite.summary.releaseReplaced, 1);
  const rename = applySchedule(here, file, { ids: makeIds(43), policy: { all: 'rename' } });
  assert.deepEqual(rename.project.release.map((item) => item.seconds), [60, 200]);
  assert.notEqual(rename.project.release[1].id, 'lrelease01');
  assert.equal(rename.summary.releaseAdded, 1);
});

test('importing a schedule file: an id made for a renamed entry is never one the file already uses', () => {
  const here = withRelease([entry('lbbbbbbbbb', { grade: '7' }, 60)], sampleSchool());
  const fileProject = withRelease([entry('laaaaaaaaa', { grade: '8' }, 90), entry('lbbbbbbbbb', { grade: '7' }, 200)], sampleSchool());
  const file = readScheduleFile(writeScheduleFile(fileProject)).file;
  // a source of ids whose first try is the id the file's first entry keeps
  let calls = 0;
  const ids = createIds(() => (calls++ < 9 ? 0 : (calls * 0.6180339) % 1));
  const applied = applySchedule(here, file, { ids, policy: { all: 'skip', per: { lbbbbbbbbb: 'rename' } } });
  const made = applied.project.release.map((item) => item.id);
  assert.equal(new Set(made).size, made.length, 'no id twice: ' + made.join(', '));
  assert.deepEqual(made.slice(0, 2), ['lbbbbbbbbb', 'laaaaaaaaa']);
  assertValid(applied.project);
});

test('importing a schedule file: a file that would take the project past 50 entries is refused whole', () => {
  const many = [];
  for (let i = 0; i < 30; i += 1) many.push(entry('l' + String(i).padStart(9, '0'), { grade: String(i) }, 60));
  const here = withRelease(many, sampleSchool());
  const other = [];
  for (let i = 0; i < 30; i += 1) other.push(entry('m' === 'x' ? '' : 'l' + String(100 + i).padStart(9, '0'), { grade: 'x' + i }, 60));
  const file = readScheduleFile(writeScheduleFile(withRelease(other, sampleSchool()))).file;
  assert.throws(() => applySchedule(here, file, { ids: makeIds(51), policy: { all: 'skip' } }), (error) => error.code === 'too-many-release' && /60 staggered dismissals, and a project has at most 50\./.test(error.message));
});

test('a schedule file with no release imports exactly as before: no entries, nothing counted', () => {
  const file = readScheduleFile(writeScheduleFile(sampleSchool())).file;
  const applied = applySchedule(sampleSchool(), file, { ids: makeIds(61), policy: { all: 'skip' } });
  assert.equal('release' in applied.project, false);
  assert.deepEqual([applied.summary.releaseAdded, applied.summary.releaseKept, applied.summary.releaseReplaced, applied.summary.releaseDropped], [0, 0, 0, 0]);
});

// ---------------------------------------------------------------- the one promise

function digest(project) {
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const { work, ...rest } = createPipeline().run(project, { geometry: 1, building: 1, schedule: 1 });
  return { crowd: hash(rest.crowd), walks: hash(rest.walks), findings: hash(rest.findings), loads: hash(rest.loads), routes: hash(rest.routes), whole: hash(rest) };
}

// test/fixtures/release-baseline.json holds these digests as sv2 gave them at
// 180edab7, the commit before SV2-88, taken by running the pipeline there on
// the three projects below. If a later unit changes the crowd model, the
// checks or the routes on purpose, it records the file again, and says so.
test('a project with no release gives byte-identical pipeline results to sv2 before this unit', () => {
  const baseline = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'release-baseline.json'), 'utf8'));
  const projects = { sample: sampleSchool(), plain: school(), big: bigProject({ seed: 3 }) };
  for (const [name, project] of Object.entries(projects)) {
    assert.equal('release' in project, false, name + ' has no release');
    assert.deepEqual(digest(project), baseline[name], name + ': every part of the result is the one sv2 gave before');
  }
});

test('an empty release gives the same results as an absent one (the keys do not move)', () => {
  const plain = school();
  assert.deepEqual(digest({ ...plain, release: [] }), digest(plain));
});

test('the published key set is unchanged: nothing about release is in the published model', async () => {
  const { publishedModel } = await import('../../engine/publish-data.js');
  const project = withRelease([entry('lrelease01', { grade: '7' }, 60)], sampleSchool());
  const options = { clock };
  const without = publishedModel(sampleSchool(), options);
  const withIt = publishedModel(project, options);
  assert.deepEqual(Object.keys(withIt), Object.keys(without));
  assert.equal(JSON.stringify(withIt).includes('lrelease01'), false);
  assert.equal(JSON.stringify(withIt), JSON.stringify(without));
});

// ---------------------------------------------------------------- the Day tab's editor (SV2-93b)
// The editor's functions are plain ones (ui/schedule/release.js); the browser
// file test/browser/release.mjs has the same promises on the page.

const HOSTILE = ['<b>x</b>', 'Q"uote\'s', 'Fish & Chips', '=SUM(1)', '&lt;i&gt;'];

test('releaseMissing: a typed time the engine would refuse is missing, 315 s and 0 s included; only a groups entry on the bell may be 0', async () => {
  const { releaseDraftOf, releaseMissing } = await import('../../ui/schedule/release.js');
  const saved = entry('lsaved0001', { grade: '7' }, 120);
  const draft = releaseDraftOf(saved);
  assert.equal(releaseMissing(draft), '');
  assert.equal(releaseMissing({ ...draft, seconds: 315 }), 'Choose a time from 15 s to 5 min after the bell to finish.', '5 min and 15 s is past the limit');
  assert.equal(releaseMissing({ ...draft, seconds: 300 }), '', 'the limit itself is allowed');
  assert.equal(releaseMissing({ ...draft, seconds: 0 }), 'Choose a time from 15 s to 5 min after the bell to finish.', '0 min and 0 s is no time for a grade');
  assert.equal(releaseMissing({ ...draft, kind: 'wing', wing: 'East', seconds: 0 }) !== '', true, 'nor for a wing');
  assert.equal(releaseMissing({ ...draft, seconds: 10 }) !== '', true, 'under the least');
  const named = { ...releaseDraftOf(entry('lsaved0002', { groups: ['gsample07a'] }, 0)) };
  assert.equal(named.onBell, true);
  assert.equal(releaseMissing(named), '', 'a group on the bell is 0 by design');
  assert.equal(releaseMissing({ ...named, onBell: false, seconds: 0 }) !== '', true, 'but 0 with On the bell off is not a time');
});

test('grades: the card, the chip and the crowd group "Grade 7" and "Grade7" the same way, as two grades', async () => {
  const { gradesOf, releaseParts } = await import('../../ui/schedule/release.js');
  const project = withRelease([entry('lgrade0001', { grade: 'Grade 7' }, 120)]);
  project.groups = project.groups.map((group, index) => ({ ...group, grade: index === 0 ? 'Grade 7' : index === 1 ? 'Grade7' : index === 2 ? ' grade 7 ' : 'Grade 8' }));
  assert.deepEqual(gradesOf(project).filter((grade) => /7/.test(grade)), ['Grade 7', 'Grade7'], 'two grades, as Movement\'s picker has them; case and outer spaces do not make a third');
  const parts = releaseParts(project, project.release[0], 'lgrade0001');
  const crowd = project.groups.filter((group) => releaseDelay(project, group.id, A, 0, null) > 0).length;
  assert.equal(crowd, 2, 'the crowd model delays "Grade 7" and " grade 7 "');
  assert.equal(parts.groups, '2 groups', 'the card says what the crowd does');
  const joined = withRelease([entry('lgrade0002', { grade: 'Grade7' }, 120)], project);
  assert.equal(releaseParts(joined, joined.release[0], 'lgrade0002').groups, '1 group');
  assert.equal(project.groups.filter((group) => releaseDelay(joined, group.id, A, 0, null) > 0).length, 1);
});

test('syncReleaseDraft: an entry changed because a group, day type or period went says so; an Undo or a Redo says that; neither is said for the other', async () => {
  const { releaseDraftOf, syncReleaseDraft } = await import('../../ui/schedule/release.js');
  const undoNote = 'This staggered dismissal was changed by an Undo or a Redo. The editor shows it as it is now.';
  const base = withRelease([entry('lsync00001', { groups: ['gsample07a', 'gsample07b'] }, 120, { dayTypeIds: [A, B] })]);
  const draft = releaseDraftOf(base.release[0]);
  const heard = [];
  // a group deleted
  const lessGroup = run(actions.deleteGroup, base, { id: 'gsample07b' });
  assert.deepEqual(lessGroup.release[0].who.groups, ['gsample07a']);
  const afterGroup = syncReleaseDraft(lessGroup, { ...draft }, (words) => heard.push(words));
  assert.equal(afterGroup.note, 'A group, day type or period this staggered dismissal named is gone from the project, so it was taken off.');
  assert.deepEqual(afterGroup.groupIds, ['gsample07a']);
  // a day type deleted
  const lessDay = run(actions.deleteDayType, base, { dayTypeId: B });
  assert.equal(syncReleaseDraft(lessDay, { ...draft }, null).note, 'A group, day type or period this staggered dismissal named is gone from the project, so it was taken off.');
  // a change that is not a deletion is an Undo or a Redo
  const changed = run(actions.setRelease, base, { id: 'lsync00001', seconds: 90 });
  assert.equal(syncReleaseDraft(changed, { ...draft }, null).note, undoNote);
  // bringing back what a deletion took (the Undo of it) is an Undo
  const back = syncReleaseDraft(base, { ...releaseDraftOf(lessGroup.release[0]) }, null);
  assert.equal(back.note, undoNote);
  assert.deepEqual(heard, [afterGroup.note], 'what is told to a screen reader is the note');
});

test('hostile names: a group, a grade and a wing typed as markup, quotes, an ampersand or a formula read back exactly as typed in the sentence', async () => {
  const { releaseSentence, gradesOf, wingsOf } = await import('../../ui/schedule/release.js');
  for (const name of HOSTILE) {
    const project = withRelease([entry('lhost00001', { grade: name }, 120), entry('lhost00002', { wing: name }, 60), entry('lhost00003', { groups: ['gsample07a'] }, 0)]);
    project.groups = project.groups.map((group) => (group.id === 'gsample07a' ? { ...group, name, grade: name } : group));
    project.building = JSON.parse(JSON.stringify(project.building));
    const sentences = project.release.map((each) => releaseSentence(project, each, each.id));
    assert.ok(sentences[0].startsWith(/^grade\s/i.test(name) ? name : 'grade ' + name), 'the grade as typed: ' + sentences[0]);
    assert.ok(sentences[1].includes(name), 'the wing as typed: ' + sentences[1]);
    assert.ok(sentences[2].startsWith(name + ' leaves on the bell'), 'the group as typed: ' + sentences[2]);
    assert.ok(gradesOf(project).includes(name));
    assert.equal(typeof wingsOf(project).length, 'number');
  }
});

test('alsoText: the schedule file import says its staggered dismissals by count, with the nouns right for one and many', async () => {
  const { alsoText } = await import('../../ui/schedule/import/schedule-file.js');
  const none = { subjectsAdded: [], teachersAdded: [], dayTypesAdded: [], periodsRaised: null, marksAdded: 0, marksKept: 0, marksReplaced: 0, dutiesAdded: 0, dutiesKept: 0, dutiesReplaced: 0, releaseAdded: 0, releaseKept: 0, releaseReplaced: 0, releaseDropped: 0, unknownRooms: [] };
  const words = { many: 'periods' };
  assert.equal(alsoText(none, words), '', 'a file with none says nothing');
  assert.equal(alsoText({ ...none, releaseAdded: 1 }, words), ' Also: 1 staggered dismissal added.');
  assert.equal(alsoText({ ...none, releaseAdded: 2, releaseReplaced: 1, releaseKept: 3 }, words), ' Also: 2 staggered dismissals added, 1 staggered dismissal replaced and 3 staggered dismissals kept as they were.');
  assert.equal(alsoText({ ...none, releaseDropped: 1 }, words), ' Also: 1 staggered dismissal left out because it names nothing here.');
  assert.equal(alsoText({ ...none, releaseDropped: 2 }, words), ' Also: 2 staggered dismissals left out because they name nothing here.');
});
