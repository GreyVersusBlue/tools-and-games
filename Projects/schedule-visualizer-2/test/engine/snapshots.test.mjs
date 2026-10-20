// Snapshots and clearing, the parts with no browser (SV2-28):
// node test/engine/snapshots.test.mjs
//
// storage/snapshots.js: the record and its name kept as typed, the limit and
// its refusal, the order of the list, a stored project read back (an older
// one brought up to date, a damaged one refused), and what the page's
// snapshots refuse before they touch the database. ui/project/clear.js: the
// three cleared projects, each valid, and the sentences saying what each
// removes and keeps. ui/project/files.js: the import question's last line.
// The IndexedDB side (take, list, restore, rename, delete with its image
// sweep, export) runs in Chromium: test/browser/snapshots.mjs. There is no
// fake IndexedDB in this tool's tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_LIMIT, AUTO_SNAPSHOT_NAMES, NAME_NEEDED, READ_ONLY_SENTENCE, SnapshotError,
  fullSentence, snapshotBytes, snapshotRecord, isSnapshot, snapshotEntry, newestFirst, readSnapshotProject,
  snapshotFileName, startSnapshots, takeAutoSnapshot, snapshotRoom,
} from '../../storage/snapshots.js';
import { RECOVERY_KEEP } from '../../storage/db.js';
import { CURRENT_VERSION } from '../../engine/schema.js';
import { NEWER_VERSION_MESSAGE } from '../../engine/migrate.js';
import {
  CLEARS, buildingContents, scheduleContents, clearedBuilding, clearedSchedule, freshProject,
  buildingWords, scheduleWords, newProjectWords, snapshotLine,
} from '../../ui/project/clear.js';
import { importSafetyLine } from '../../ui/project/files.js';
import { bigProject } from '../fixtures/big.mjs';
import { school, clone, clock, makeIds, assertValid } from './helpers.mjs';

const HOSTILE = '<img src=x onerror=alert(1)> “Before” & \'7th\' 学年 ‮evil';

// ---------------------------------------------------------------- the record

test('a snapshot record keeps its name exactly as typed and weighs its project as UTF-8 JSON', () => {
  const project = school();
  const record = snapshotRecord(project, { id: 'nabcdefgh1', name: HOSTILE, takenAt: '2026-09-01T12:00:00.000Z' });
  assert.deepEqual(Object.keys(record), ['id', 'name', 'takenAt', 'bytes', 'project'], 'the shape of ARCHITECTURE 7, nothing added');
  assert.equal(record.name, HOSTILE);
  assert.equal(record.project, project);
  assert.equal(record.bytes, Buffer.byteLength(JSON.stringify(project), 'utf8'));
  assert.equal(snapshotBytes({ name: 'é' }), Buffer.byteLength('{"name":"é"}', 'utf8'), 'bytes, not characters');
  assert.ok(isSnapshot(record));
  // a name of spaces and joiners only is no name; one with a single letter is
  for (const blank of ['', '   ', '​‍﻿', '\t\n']) {
    assert.throws(() => snapshotRecord(project, { id: 'nabcdefgh1', name: blank, takenAt: '' }), (error) => error instanceof SnapshotError && error.code === 'no-name' && error.message === NAME_NEEDED);
  }
  assert.equal(snapshotRecord(project, { id: 'nabcdefgh1', name: ' x ', takenAt: '' }).name, ' x ', 'not trimmed');
  assert.throws(() => snapshotRecord(project, { id: 'pabcdefgh1', name: 'x', takenAt: '' }), TypeError, 'a snapshot id starts with n');
});

test('the limit is stated, and the refusal names it, says what to do, and promises nothing is replaced', () => {
  assert.equal(SNAPSHOT_LIMIT, 30);
  assert.equal(fullSentence(), 'This device keeps at most 30 snapshots, and it has 30. Delete one you no longer need (export it first to keep it as a file), then take this one. No snapshot is ever replaced to make room.');
  assert.match(fullSentence(4), /^This device keeps at most 4 snapshots, and it has 4\./);
  // the count as it is: another tab may have taken one past the limit at the same moment
  assert.match(fullSentence(30, 31), /^This device keeps at most 30 snapshots, and it has 31\./);
});

test('the limit holds what storage/snapshots.js says it does at the size spec 3.13 promises', () => {
  // the header's arithmetic: 30 snapshots of the 3.13 project are about 5.5 MB of JSON
  const bytes = snapshotBytes(bigProject({ seed: 1 }));
  assert.ok(bytes > 150000 && bytes < 220000, 'the 3.13 project is about 182 KB of JSON, not ' + bytes);
  const all = SNAPSHOT_LIMIT * bytes;
  assert.ok(all < 6.5e6, SNAPSHOT_LIMIT + ' snapshots at the 3.13 size are ' + (all / 1e6).toFixed(1) + ' MB; the header promises about 5.5');
  // with four traced images of their own each (300 KB) and the recovery points (under 10 MB), under 60 MB
  assert.ok(all + SNAPSHOT_LIMIT * 4 * 300e3 + 10e6 + bytes < 60e6);
  assert.equal(RECOVERY_KEEP, 8, 'the recovery points the arithmetic counts');
});

test('the list is newest first, two of the same moment in a fixed order', () => {
  const entries = [
    { id: 'n000000001', takenAt: '2026-09-01T10:00:00.000Z' },
    { id: 'n000000003', takenAt: '2026-09-02T10:00:00.000Z' },
    { id: 'n000000002', takenAt: '2026-09-02T10:00:00.000Z' },
    { id: 'n000000004', takenAt: '2026-08-30T10:00:00.000Z' },
  ];
  assert.deepEqual(newestFirst(entries).map((entry) => entry.id), ['n000000003', 'n000000002', 'n000000001', 'n000000004']);
  assert.deepEqual(newestFirst(entries.slice().reverse()).map((entry) => entry.id), ['n000000003', 'n000000002', 'n000000001', 'n000000004']);
});

test('an entry is what the card lists; a damaged record is listed as unreadable, never dropped or thrown', () => {
  const project = school();
  project.settings.schoolName = HOSTILE;
  const entry = snapshotEntry(snapshotRecord(project, { id: 'nabcdefgh1', name: HOSTILE, takenAt: '2026-09-01T12:00:00.000Z' }));
  assert.deepEqual({ ...entry, bytes: typeof entry.bytes }, {
    id: 'nabcdefgh1', name: HOSTILE, takenAt: '2026-09-01T12:00:00.000Z', bytes: 'number', school: HOSTILE, projectId: project.id,
    summary: { floors: 3, rooms: 13, groups: 8, teachers: 12 }, readable: true,
  });
  for (const bad of [{ id: 'nabcdefgh2', name: 'x', takenAt: 'y' }, { id: 'nabcdefgh3', name: 'x', takenAt: 'y', project: [] }, null, 'text']) {
    const listed = snapshotEntry(bad);
    assert.equal(listed.readable, false);
    assert.equal(listed.summary, null);
  }
});

// ---------------------------------------------------------------- reading one back

test('a stored project is read back checked: as it was, brought up from an older version, or refused with a sentence', () => {
  const options = { ids: makeIds(3), clock, imageIds: new Set() };
  const project = school();
  assert.deepEqual(readSnapshotProject(clone(project), options).project, project, 'a current one comes back unchanged');

  const old = clone(project);
  delete old.format;
  old.version = 0;
  const read = readSnapshotProject(old, options);
  assert.equal(read.project.version, CURRENT_VERSION);
  assertValid(read.project);

  const damaged = clone(project);
  delete damaged.groups;
  delete damaged.dayTypes;
  assert.throws(() => readSnapshotProject(damaged, options), (error) => error.code === 'unreadable' && error.message === 'The snapshot is damaged: it has no readable groups, day types.');
  assert.throws(() => readSnapshotProject({ ...clone(project), version: 99 }, options), (error) => error.code === 'unreadable' && error.message === NEWER_VERSION_MESSAGE);
  assert.throws(() => readSnapshotProject(null, options), (error) => error.code === 'unreadable');
});

test('an exported snapshot is named by the one rule for file names, dated the day it was taken', () => {
  const project = school();
  project.settings.schoolName = 'North <Side> / High';
  assert.equal(snapshotFileName(project, '2026-08-14T15:00:00.000Z', clock()), 'North Side High - snapshot - 2026-08-14.json');
  assert.equal(snapshotFileName(project, 'not a date', clock()), 'North Side High - snapshot - 2026-09-01.json');
});

// ---------------------------------------------------------------- the page's snapshots, before the database

test('automatic snapshots: a name for every reason a section has, SV2-28b\'s included, and nothing thrown before boot', async () => {
  assert.deepEqual(Object.keys(AUTO_SNAPSHOT_NAMES), ['clear-building', 'clear-schedule', 'new-project', 'import', 'clear-floor', 'resize', 'scenario']);
  for (const name of Object.values(AUTO_SNAPSHOT_NAMES)) assert.match(name, /^Before /);
  // no page snapshots made yet in this process
  assert.deepEqual(await takeAutoSnapshot('clear-floor'), { ok: false, code: 'not-ready', text: 'The project is still loading, so no snapshot was taken.' });
  assert.deepEqual(await snapshotRoom(), { count: null, limit: SNAPSHOT_LIMIT, full: false, error: 'The project is still loading.' });
});

test('the page\'s snapshots refuse a read-only tab, a blank name and an unknown reason before they open anything', async () => {
  let opened = 0;
  const open = () => {
    opened += 1;
    return Promise.reject(new Error('the database should not be opened'));
  };
  const state = { readOnly: true, available: true };
  const ctx = { store: { project: school() }, clock, ids: makeIds(9), storage: { state, ready: Promise.resolve(), flush: () => Promise.resolve() } };
  const snapshots = startSnapshots(ctx, { open });
  await assert.rejects(snapshots.take('Before moving 7th grade'), (error) => error.code === 'read-only' && error.message === READ_ONLY_SENTENCE);
  for (const run of [() => snapshots.restore('nabcdefgh1'), () => snapshots.rename('nabcdefgh1', 'x'), () => snapshots.remove('nabcdefgh1')]) {
    await assert.rejects(run(), (error) => error.code === 'read-only');
  }
  assert.deepEqual(await snapshots.takeAuto('clear-building'), { ok: false, code: 'read-only', text: READ_ONLY_SENTENCE });
  assert.deepEqual(await takeAutoSnapshot('clear-building'), { ok: false, code: 'read-only', text: READ_ONLY_SENTENCE }, 'the module-level call reaches the page\'s snapshots');
  state.readOnly = false;
  await assert.rejects(snapshots.take(' ​ '), (error) => error.code === 'no-name' && error.message === NAME_NEEDED);
  assert.equal((await snapshots.takeAuto('tidy-up')).code, 'bad-reason');
  assert.equal(opened, 0, 'none of these reached the database');
  // a browser that keeps nothing: said, not thrown at the caller of takeAuto
  state.available = false;
  state.error = 'IndexedDB is switched off.';
  assert.deepEqual(await snapshots.takeAuto('clear-schedule'), { ok: false, code: 'unavailable', text: 'This browser is not keeping the project, so it cannot keep a snapshot either: IndexedDB is switched off.' });
  assert.equal((await snapshots.room()).error, 'This browser is not keeping the project, so it cannot keep a snapshot either: IndexedDB is switched off.');
});

test('a connection closed under the page\'s snapshots (another tab upgrading the database) is opened again on the next call', async () => {
  const opened = [];
  const open = () => {
    const main = {
      closed: false,
      onversionchange: null,
      close() {
        this.closed = true;
      },
      transaction() {
        if (this.closed) throw new Error('The database connection is closing.');
        const tx = {
          objectStore: () => ({
            count() {
              const request = {};
              setTimeout(() => {
                request.result = 3;
                if (request.onsuccess) request.onsuccess();
                tx.oncomplete();
              });
              return request;
            },
          }),
        };
        return tx;
      },
    };
    main.onversionchange = () => main.close(); // as db.js sets it
    opened.push(main);
    return Promise.resolve({ main, recovery: null });
  };
  const ctx = { store: { project: school() }, clock, ids: makeIds(9), storage: { state: { readOnly: false, available: true }, ready: Promise.resolve() } };
  const snapshots = startSnapshots(ctx, { open });
  assert.equal((await snapshots.room()).count, 3);
  assert.equal((await snapshots.room()).count, 3);
  assert.equal(opened.length, 1, 'one connection while it stays open');
  opened[0].onversionchange({});
  assert.equal(opened[0].closed, true, 'db.js\'s own answer to a version change still runs');
  assert.deepEqual(await snapshots.room(), { count: 3, limit: SNAPSHOT_LIMIT, full: false, error: null }, 'the next call works, on a new connection');
  assert.equal(opened.length, 2);
  opened[1].onclose();
  await snapshots.room();
  assert.equal(opened.length, 3, 'a connection the browser closed is opened again too');
});

// ---------------------------------------------------------------- clearing

test('clearing the building empties every floor and keeps the floors, the schedule and the teachers by name', () => {
  const project = school();
  project.building.floors[1].image = { imageId: 'iabcdefgh1', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 10, height: 10, missing: false };
  const cleared = clearedBuilding(project);
  assertValid(cleared);
  assert.deepEqual(buildingContents(cleared), { floors: 3, rooms: 0, otherSpaces: 0, corridorCells: 0, stairsCells: 0, corridorNames: 0, exits: 0, connections: 0, zones: 0 });
  assert.deepEqual(cleared.building.floors.map((floor) => [floor.id, floor.name, floor.level, floor.width, floor.height]), project.building.floors.map((floor) => [floor.id, floor.name, floor.level, floor.width, floor.height]));
  assert.equal(cleared.building.floors[1].image, project.building.floors[1].image, 'the traced image stays');
  assert.equal(cleared.groups.length, project.groups.length);
  assert.deepEqual(cleared.teachers.map((teacher) => teacher.name), project.teachers.map((teacher) => teacher.name));
  assert.ok(cleared.teachers.every((teacher) => teacher.roomIds.length === 0), 'teachers no longer have rooms');
  // every slot that named a room keeps its number as text
  const numbers = new Map();
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') numbers.set(space.id, space.number);
  let slots = 0;
  project.groups.forEach((group, g) => {
    for (const [dayTypeId, day] of Object.entries(group.days)) {
      day.forEach((slot, p) => {
        if (slot.room === null) return;
        slots += 1;
        assert.deepEqual([cleared.groups[g].days[dayTypeId][p].room, cleared.groups[g].days[dayTypeId][p].roomText], [null, numbers.get(slot.room)]);
      });
    }
  });
  assert.ok(slots > 40, 'the sample has slots to check');
  assert.equal(cleared.subjects, project.subjects);
  assert.equal(cleared.dayTypes, project.dayTypes);
  assert.equal(cleared.settings, project.settings);
});

test('clearing the schedule takes the groups, teachers, accepted findings and scenario, and leaves the building, subjects, days and settings', () => {
  const project = school();
  project.accepted = [{ findingId: 'room-double:dsample00a:1:rsample203', reason: 'Shared', at: '2026-09-01T12:00:00.000Z', about: [] }];
  project.scenario = { name: HOSTILE, changes: [], compared: null };
  assertValid(project);
  assert.deepEqual(scheduleContents(project), { groups: 8, teachers: 12, accepted: 1, scenario: HOSTILE });
  const cleared = clearedSchedule(project);
  assertValid(cleared);
  assert.deepEqual([cleared.groups, cleared.teachers, cleared.accepted, cleared.scenario], [[], [], [], null]);
  for (const floor of cleared.building.floors) for (const space of floor.spaces) if (space.kind === 'room') assert.deepEqual(space.teacherIds, []);
  assert.deepEqual(buildingContents(cleared), buildingContents(project));
  assert.equal(cleared.building.connections, project.building.connections);
  assert.equal(cleared.subjects, project.subjects);
  assert.equal(cleared.dayTypes, project.dayTypes, 'the day types and their bell times');
  assert.equal(cleared.settings, project.settings);
  assert.equal(cleared.id, project.id);
});

test('a new project is empty, valid and a project of its own; the theme comes across', () => {
  const project = school();
  project.settings.theme = 'dark';
  const fresh = freshProject(project, makeIds(4), clock, 'a4');
  assertValid(fresh);
  assert.notEqual(fresh.id, project.id);
  assert.deepEqual([fresh.settings.theme, fresh.settings.paper.size, fresh.settings.schoolName], ['dark', 'a4', '']);
  assert.deepEqual([fresh.building.floors.length, fresh.groups.length, fresh.teachers.length, fresh.dayTypes.map((day) => day.name)], [1, 0, 0, ['A Day', 'B Day']]);
  assert.equal(fresh.publish.passcode, 'bulldogs2015', 'the default passcode, as every new project in the planner');
});

test('each clear says exactly what it removes and what stays, and says so when there is nothing to remove', () => {
  const project = school();
  assert.deepEqual(buildingWords(project), {
    empty: false,
    removes: 'Removes everything drawn on all 3 floors: 13 rooms, 10 other spaces, 121 corridor cells, 4 stairs cells, 5 corridor names, 2 exits, 2 stairs connections and 1 area left out of the colour scale.',
    keeps: 'The floors stay, empty, with their names, sizes and any traced images. The schedule stays: a group in a room that is gone keeps the room\'s number, which reads "not in the building", and teachers keep their names but no longer have rooms.',
  });
  assert.deepEqual(scheduleWords(project), {
    empty: false,
    removes: 'Removes 8 groups with their schedules and 12 teachers.',
    keeps: 'The building stays with its rooms, which no longer have teachers. The subjects, the day types with their bell times, and the settings stay too.',
  });
  assert.equal(newProjectWords(project).removes, 'Replaces the whole project with an empty one: the building, the schedule, the scenario, the publish settings and every other setting. This project has 3 floors, 13 rooms, 12 teachers, 8 groups, 9 subjects and 2 day types.');
  assert.equal(newProjectWords(project).empty, false, 'a new project can always be started');

  const one = clone(project);
  one.accepted = [{ findingId: 'x', reason: '', at: '2026-09-01T12:00:00.000Z', about: [] }];
  one.scenario = { name: HOSTILE, changes: [], compared: null };
  one.groups = one.groups.slice(0, 1);
  // the scenario's name is isolated (U+2068 … U+2069): HOSTILE ends in a right-to-left override, which must not turn round the words after it
  assert.ok(HOSTILE.includes('\u202e'));
  assert.equal(scheduleWords(one).removes, 'Removes 1 group with its schedule, 12 teachers, 1 accepted finding and the open scenario “\u2068' + HOSTILE + '\u2069”.');

  assert.deepEqual([buildingWords(clearedBuilding(project)).empty, buildingWords(clearedBuilding(project)).removes], [true, 'Nothing is drawn on any of the 3 floors, so there is nothing to clear.']);
  assert.deepEqual([scheduleWords(clearedSchedule(project)).empty, scheduleWords(clearedSchedule(project)).removes], [true, 'There are no groups, teachers, accepted findings or scenario, so there is nothing to clear.']);
  const single = freshProject(project, makeIds(2), clock);
  assert.equal(buildingWords(single).removes, 'Nothing is drawn on the floor, so there is nothing to clear.');
});

test('the three clears in the card\'s order, each with an action that names it and an automatic snapshot of its own', () => {
  assert.deepEqual(CLEARS.map((entry) => [entry.id, entry.button, entry.action, entry.keep, entry.label, AUTO_SNAPSHOT_NAMES[entry.reason]]), [
    ['building', 'Clear the building', 'Clear the building', 'Keep the building', 'Clear the building', 'Before clearing the building'],
    ['schedule', 'Clear the schedule', 'Clear the schedule', 'Keep the schedule', 'Clear the schedule', 'Before clearing the schedule'],
    ['new', 'Start a new project', 'Start a new project', 'Keep this project', 'Start a new project', 'Before starting a new project'],
  ]);
  const project = school();
  const made = CLEARS.map((entry) => entry.make(project, { ids: makeIds(6), clock, devicePaper: () => 'letter' }));
  for (const each of made) assertValid(each);
  assert.notEqual(made[2].id, project.id);
});

test('the question\'s last line says whether a snapshot comes first, and why not when it cannot', () => {
  const room = { count: 2, limit: 30, full: false, error: null };
  assert.equal(snapshotLine(room, 'Before clearing the building', 'the building'), 'A snapshot of the project as it is now, “Before clearing the building”, is taken first, so you can restore it from Snapshots at any time. Undo brings the building back too, while this tab stays open.');
  assert.equal(snapshotLine({ ...room, count: 30, full: true }, 'x', 'the schedule'), 'No snapshot can be taken first: this device already keeps 30 snapshots, the most it keeps, and none is replaced to make room. Undo still brings the schedule back while this tab stays open. To have a snapshot as well, keep this, delete one under Snapshots, and come back.');
  assert.equal(snapshotLine({ ...room, error: 'IndexedDB is switched off.' }, 'x', 'this project'), 'No snapshot can be taken first: IndexedDB is switched off. Undo still brings this project back while this tab stays open.');
  assert.equal(snapshotLine(null, 'x', 'this project'), 'No snapshot can be taken first. Undo still brings this project back while this tab stays open.');

  assert.equal(importSafetyLine(room, 'Before importing ' + HOSTILE + '.json', 'it'), 'A recovery point of this project is taken first, with a snapshot of it, “Before importing ' + HOSTILE + '.json”, that you can restore from Snapshots at any time. Undo brings it back while this tab stays open.');
  assert.equal(importSafetyLine({ ...room, count: 30, full: true }, 'x', 'the building'), 'A recovery point of this project is taken first, and Undo brings the building back while this tab stays open. No snapshot can be taken: this device already keeps 30 snapshots, the most it keeps, and none is replaced to make room. To have one as well, keep this, delete one under Snapshots, and import again.');
  assert.equal(importSafetyLine(null, 'x', 'it'), 'A recovery point of this project is taken first, and Undo brings it back while this tab stays open. No snapshot can be taken.');
});
