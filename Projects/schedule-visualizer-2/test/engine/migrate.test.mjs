import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MigrateError, NEWER_VERSION_MESSAGE, MIGRATION_STEPS, versionOf } from '../../engine/migrate.js';
import { repair } from '../../engine/repair.js';
import { validate } from '../../engine/validate.js';
import { CURRENT_VERSION } from '../../engine/schema.js';
import { emptyProject, school, clone } from './helpers.mjs';

test('there is one step per version below the current one', () => {
  assert.equal(MIGRATION_STEPS.length, CURRENT_VERSION);
});

test('a current project comes back as the same object', () => {
  const project = school();
  assert.equal(migrate(project), project);
});

test('a project with no version is version 0 and becomes version 1', () => {
  const old = clone(school());
  delete old.version;
  delete old.format;
  assert.equal(versionOf(old), 0);
  const migrated = migrate(old);
  assert.equal(migrated.version, 1);
  assert.equal(migrated.format, 'sv2-project');
  assert.deepEqual(migrated, school());
});

test('migrate does not change what it is given', () => {
  const old = clone(school());
  old.version = 0;
  old.scenario = { name: 'Trial', dayTypeId: 'dsample00a', changes: [{ kind: 'move', groupId: 'gsample08a', period: 6, roomId: 'rsample302' }], compared: null };
  const before = clone(old);
  migrate(old);
  assert.deepEqual(old, before);
});

test('version 0 held one day type for a whole scenario; version 1 has it on each change', () => {
  const old = clone(school());
  old.version = 0;
  old.scenario = {
    name: 'Trial',
    dayTypeId: 'dsample00a',
    changes: [
      { kind: 'move', groupId: 'gsample08a', period: 6, roomId: 'rsample302' },
      { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample08a', periodA: 1, periodB: 2 },
    ],
    compared: null,
  };
  const migrated = migrate(old);
  assert.equal('dayTypeId' in migrated.scenario, false);
  assert.deepEqual(migrated.scenario.changes.map((change) => change.dayTypeId), ['dsample00a', 'dsample00b']);
  assert.deepEqual(validate(migrated), []);
});

test('a version-0 object with missing fields is migrated, then repaired into a valid project', () => {
  const old = {
    id: 'poldschool',
    settings: { schoolName: 'Old Hollow School', periods: 6 },
    building: { floors: [{ id: 'foldfloor1', name: 'Ground', width: 10, height: 6, cells: '.'.repeat(10) + '#'.repeat(10) + '.'.repeat(40), spaces: [{ id: 'roldroom01', kind: 'room', cells: [0, 1], number: '1' }] }] },
    teachers: [{ id: 'toldteach1', name: 'Mx. Arrowood', roomIds: ['roldroom01'] }],
    groups: [{ id: 'goldgroup1', name: 'Red', days: { doldday00a: [{ room: 'roldroom01' }, {}, {}, {}, {}, {}] } }],
    dayTypes: [{ id: 'doldday00a', name: 'Every Day' }],
  };
  const migrated = migrate(old);
  assert.equal(migrated.version, 1);
  const { project } = repair(migrated);
  assert.deepEqual(validate(project), []);
  assert.equal(project.settings.schoolName, 'Old Hollow School');
  assert.equal(project.settings.periods, 6);
  assert.equal(project.settings.secondsPerCell, 3, 'a missing setting takes its default');
  assert.equal(project.building.floors[0].level, 1, 'repair fills the floor level older data lacks');
  assert.deepEqual(project.building.floors[0].spaces[0].teacherIds, ['toldteach1'], 'the room lists the teacher who listed it');
  assert.equal(project.groups[0].days.doldday00a[0].room, 'roldroom01');
  assert.equal(project.groups[0].days.doldday00a.length, 6);
  assert.equal(project.dayTypes[0].own, true);
  assert.equal(project.publish.passcode, 'bulldogs2015');
  assert.equal(project.scenario, null);
});

test('a version-99 file is refused whole, with the exact message', () => {
  const newer = clone(school());
  newer.version = 99;
  assert.throws(() => migrate(newer), (error) => {
    assert.ok(error instanceof MigrateError);
    assert.equal(error.code, 'newer-version');
    assert.equal(error.message, 'This file was made by a newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file saved in format 1.');
    assert.equal(error.message, NEWER_VERSION_MESSAGE);
    return true;
  });
  assert.equal(newer.version, 99, 'and the file is not touched');
});

test('version 2 is refused too: one above current is already newer', () => {
  assert.throws(() => migrate({ ...school(), version: CURRENT_VERSION + 1 }), { code: 'newer-version' });
});

test('something that is not a project is refused, not guessed at', () => {
  for (const junk of [null, undefined, 4, 'project', [], { version: 'one' }, { version: -1 }, { version: 0.5 }]) {
    assert.throws(() => migrate(junk), { name: 'MigrateError', code: 'not-a-project' }, JSON.stringify(junk));
  }
});

test('round trip: newProject to JSON, migrate, repair, and nothing has changed', () => {
  const project = emptyProject();
  const read = JSON.parse(JSON.stringify(project));
  const migrated = migrate(read);
  const { project: repaired, notes } = repair(migrated);
  assert.deepEqual(notes, []);
  assert.deepEqual(repaired, project);
  assert.equal(JSON.stringify(repaired), JSON.stringify(project), 'to the byte, key order included');
  assert.equal(repaired, read, 'repair handed back the object it was given');
});

test('round trip: the sample school to JSON, migrate, repair, and nothing has changed', () => {
  const project = school();
  const read = JSON.parse(JSON.stringify(project));
  const { project: repaired, notes } = repair(migrate(read));
  assert.deepEqual(notes, []);
  assert.equal(JSON.stringify(repaired), JSON.stringify(project));
});
