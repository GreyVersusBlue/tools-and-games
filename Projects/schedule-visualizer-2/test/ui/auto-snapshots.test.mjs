// The plain parts of the automatic snapshots inside sections (SV2-28b), with
// no page: what clearing a floor erases and says, how many slots applying a
// scenario changes and when that keeps a snapshot, and the sentence the
// message carries when a snapshot was kept or was not. The same in a page is
// test/browser/auto-snapshots.mjs.
//
//   node test/ui/auto-snapshots.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { drawnCells, clearFloorWords } from '../../ui/building/inspector/floor.js';
import { appliedSlots, applySummary, scenarioView, SCENARIO_SNAPSHOT_SLOTS } from '../../ui/scenarios/model.js';
import { autoSnapshotSaid, undoForStep, AUTO_SNAPSHOT_NAMES, SNAPSHOT_LIMIT, READ_ONLY_SENTENCE } from '../../storage/snapshots.js';
import { eraseCells, setSetting } from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { sampleSchool } from '../../data/sample-school.js';

const clock = () => new Date('2026-09-01T12:00:00Z');

function store() {
  let n = 0;
  const ids = (prefix) => prefix + String(n++).padStart(9, '0');
  return createStore({ project: sampleSchool(), clock, ids });
}

// ---------------------------------------------------------------- clearing a floor

test('drawnCells lists every corridor, stairs and space cell of the floor once, in order, and nothing empty', () => {
  const floor = sampleSchool().building.floors[1];
  const cells = drawnCells(floor);
  const owned = new Set(floor.spaces.flatMap((space) => space.cells));
  for (let cell = 0; cell < floor.cells.length; cell += 1) {
    assert.equal(cells.includes(cell), floor.cells[cell] !== '.' || owned.has(cell), 'cell ' + cell);
  }
  assert.deepEqual(cells, cells.slice().sort((a, b) => a - b));
  assert.equal(new Set(cells).size, cells.length);
});

test('erasing the drawn cells leaves the floor empty, keeps its name, size, level, image and left-out areas, and is one undo step', () => {
  const s = store();
  const before = s.project;
  const floor = before.building.floors[1];
  s.apply(eraseCells, { floorId: floor.id, cells: drawnCells(floor), whole: true });
  const after = s.project.building.floors[1];
  assert.equal(after.cells, '.'.repeat(floor.width * floor.height));
  assert.deepEqual([after.spaces, after.exits, after.corridors], [[], [], []]);
  assert.deepEqual([after.id, after.name, after.level, after.width, after.height, after.image], [floor.id, floor.name, floor.level, floor.width, floor.height, floor.image]);
  assert.equal(s.project.building.connections.some((c) => c.a.floorId === floor.id || c.b.floorId === floor.id), false);
  assert.deepEqual(s.project.building.zones, before.building.zones);
  // the other floors are the same objects
  assert.equal(s.project.building.floors[0], before.building.floors[0]);
  s.undo();
  assert.deepEqual(s.project.building, before.building);
});

test('clearFloorWords counts what is drawn, in the words the button stands beside, and says when there is nothing', () => {
  const project = sampleSchool();
  const floor = project.building.floors[1];
  const words = clearFloorWords(project, floor);
  assert.equal(words.empty, false);
  assert.equal(words.removes, 'Removes everything drawn on Floor 2: 5 rooms, 3 other spaces, 38 corridor cells, 2 stairs cells, 1 corridor name and 2 stairs connections.');
  assert.match(words.keeps, /^The floor stays, empty, with its name, level, size, traced image and the areas left out of the colour scale\./);
  // it promises no snapshot: the device may have no room for one (SV2-28d)
  assert.match(words.keeps, /Undo brings it all back, and a snapshot of the project as it was is kept too when this device has room for one\.$/);
  const empty = { ...floor, name: 'Roof <b>deck</b>', cells: '.'.repeat(floor.cells.length), spaces: [], corridors: [], exits: [] };
  const none = { ...project, building: { ...project.building, connections: [] } };
  assert.deepEqual(clearFloorWords(none, empty), { empty: true, removes: 'Nothing is drawn on Roof <b>deck</b>, so there is nothing to clear.', keeps: '' });
});

// ---------------------------------------------------------------- a big scenario

function withChanges(changes) {
  const project = sampleSchool();
  return { ...project, scenario: { name: 'Trial', changes, compared: null } };
}

// Moves for distinct slots of the sample school's own day types.
function moves(n) {
  const project = sampleSchool();
  const day = project.dayTypes[0].id;
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  const out = [];
  for (const group of project.groups) {
    for (let period = 0; period < project.settings.periods && out.length < n; period += 1) {
      const slot = group.days[day][period];
      const room = rooms.find((each) => each.id !== slot.room);
      out.push({ kind: 'move', dayTypeId: day, groupId: group.id, period, roomId: room.id });
    }
  }
  return out;
}

test('appliedSlots counts each kept change\'s slots once: a move one, a swap two, a slot named twice once', () => {
  const project = sampleSchool();
  const day = project.dayTypes[0].id;
  const [a, b] = project.groups;
  const view = { kept: [
    { change: { kind: 'move', dayTypeId: day, groupId: a.id, period: 0, roomId: 'r' } },
    { change: { kind: 'swapPeriods', dayTypeId: day, groupId: a.id, periodA: 0, periodB: 3 } },
    { change: { kind: 'swapRooms', dayTypeId: day, groupA: a.id, groupB: b.id, period: 5 } },
  ] };
  assert.equal(appliedSlots(view), 4);
  assert.equal(appliedSlots({ kept: [] }), 0);
});

test('a scenario keeps a snapshot when it changes more than SCENARIO_SNAPSHOT_SLOTS slots, and not at that many', () => {
  assert.equal(SCENARIO_SNAPSHOT_SLOTS, 10);
  const at = withChanges(moves(SCENARIO_SNAPSHOT_SLOTS));
  const atSummary = applySummary(at, scenarioView(at));
  assert.equal(atSummary.slots, SCENARIO_SNAPSHOT_SLOTS);
  assert.equal(atSummary.snapshot, false, 'exactly the limit is not more than it');
  const over = withChanges(moves(SCENARIO_SNAPSHOT_SLOTS + 1));
  const overSummary = applySummary(over, scenarioView(over));
  assert.equal(overSummary.slots, SCENARIO_SNAPSHOT_SLOTS + 1);
  assert.equal(overSummary.snapshot, true);
  assert.equal(overSummary.changes.length, SCENARIO_SNAPSHOT_SLOTS + 1);
});

test('a change that no longer applies does not count toward a snapshot', () => {
  const changes = moves(SCENARIO_SNAPSHOT_SLOTS + 1);
  changes[0] = { ...changes[0], groupId: 'gnotthere0' };
  const project = withChanges(changes);
  const summary = applySummary(project, scenarioView(project));
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.slots, SCENARIO_SNAPSHOT_SLOTS);
  assert.equal(summary.snapshot, false);
});

// ---------------------------------------------------------------- the message

test('autoSnapshotSaid names a kept snapshot isolated, and says why none was kept and that Undo still works', () => {
  assert.equal(autoSnapshotSaid({ ok: true, snapshot: { name: 'Before clearing ‮Floor 2' } }), 'The snapshot “⁨Before clearing ‮Floor 2⁩” has what was there.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'full', text: 'x' }), 'No snapshot was taken, because this device already keeps ' + SNAPSHOT_LIMIT + ', the most it keeps. Undo brings it back while this tab stays open.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'read-only', text: READ_ONLY_SENTENCE }), 'No snapshot was taken, because this tab is read-only while the project is open in another tab. Undo brings it back while this tab stays open.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'failed', text: 'The snapshot was not kept: QuotaExceededError.' }), 'No snapshot was taken: QuotaExceededError. Undo brings it back while this tab stays open.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'not-saved', text: 'The snapshot was not taken, because the project could not be saved first.' }), 'No snapshot was taken, because the project could not be saved first. Undo brings it back while this tab stays open.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'not-ready', text: 'The project is still loading, so no snapshot was taken.' }), 'No snapshot was taken, because the project was still loading. Undo brings it back while this tab stays open.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'failed', text: '' }), 'No snapshot was taken: the device did not say why. Undo brings it back while this tab stays open.');
  assert.deepEqual(['clear-floor', 'resize', 'scenario'].every((reason) => reason in AUTO_SNAPSHOT_NAMES), true);
});

// ---------------------------------------------------------------- the Undo a message offers (SV2-28d)

test('autoSnapshotSaid without its word on Undo, for a change Undo no longer takes back', () => {
  assert.equal(autoSnapshotSaid({ ok: true, snapshot: { name: 'Before clearing Floor 2' } }, { undo: false }), 'The snapshot “⁨Before clearing Floor 2⁩” has what was there.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'full', text: 'x' }, { undo: false }), 'No snapshot was taken, because this device already keeps ' + SNAPSHOT_LIMIT + ', the most it keeps.');
  assert.equal(autoSnapshotSaid({ ok: false, code: 'failed', text: '' }, { undo: false }), 'No snapshot was taken: the device did not say why.');
});

test('undoForStep takes back its own step while it is the last one, and nothing once history has moved', () => {
  const s = store();
  s.apply(setSetting, { key: 'schoolName', value: 'First' });
  s.apply(setSetting, { key: 'schoolName', value: 'Second' });
  const step = undoForStep(s, () => s.undo());
  assert.equal(step.current, true);
  assert.equal(step.run(), true);
  assert.equal(s.project.settings.schoolName, 'First', 'its own step undone');
  assert.equal(step.run(), false, 'once only');
  assert.equal(s.project.settings.schoolName, 'First');

  s.apply(setSetting, { key: 'schoolName', value: 'Third' });
  const late = undoForStep(s, () => s.undo());
  s.undo();
  assert.equal(late.current, false, 'an undo since withdraws it');
  assert.equal(late.run(), false);
  assert.equal(s.project.settings.schoolName, 'First', 'the step before it is left alone');

  const edited = undoForStep(s, () => s.undo());
  s.apply(setSetting, { key: 'schoolName', value: 'Fourth' });
  assert.equal(edited.current, false, 'an edit since withdraws it');
  assert.equal(edited.run(), false);
  assert.equal(s.project.settings.schoolName, 'Fourth');
});
