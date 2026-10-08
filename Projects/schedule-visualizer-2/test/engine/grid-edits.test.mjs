// The grid editor's one action and the pure parts of the grid that feed it:
// node test/engine/grid-edits.test.mjs
//
// applyGridEdits is everything the grid staged as one step. The staging, the
// paste plan and the tab-separated text are tested here too, since none of
// them touches a page.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { parseTsv, writeTsv } from '../../ui/schedule/grid/tsv.js';
import { draftFor, gridEditsPending, watchGridEdits, preview, payloadOf, touch, discard, remember, takeBack, stageSlot, stageField, stageAdd, stageRemove } from '../../ui/schedule/grid/staged.js';
import { sheetModel, cellText, cellState, readCell, planPaste } from '../../ui/schedule/grid/model.js';
import { school, emptyProject, ctx, clock, makeIds, room, group, assertValid } from './helpers.mjs';

const { applyGridEdits, countGroupChanges, groupChangesText, describeAction, ActionError } = actions;
const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function run(project, payload) {
  const after = applyGridEdits(freeze(project), payload, ctx());
  assertValid(after, 'the project is still valid after the grid edits');
  return after;
}

// A payload that does one of everything on the sample school.
function everything(project) {
  return {
    removed: [group(project, '8B').id],
    groups: [{ id: group(project, '6A').id, name: '6 Alpha', grade: '6', headCount: 31, colour: '#123456' }],
    added: [{ id: 'gnewgroup1', name: '9A', grade: '9', headCount: null, colour: '#abcdef' }],
    slots: [
      { groupId: group(project, '6B').id, dayTypeId: DAY_A, period: 0, slot: { room: room(project, '101').id } },
      { groupId: 'gnewgroup1', dayTypeId: DAY_B, period: 2, slot: { room: null, roomText: '999' } },
    ],
  };
}

test('one of everything is applied together: a removal, a rename with its fields, an addition, a slot of an old group and a slot of the new one', () => {
  const before = school();
  const after = run(before, everything(before));
  assert.equal(after.groups.some((g) => g.name === '8B'), false);
  const alpha = group(after, '6 Alpha');
  assert.deepEqual([alpha.grade, alpha.headCount, alpha.colour], ['6', 31, '#123456']);
  assert.equal(group(after, '6B').days[DAY_A][0].room, room(after, '101').id);
  const added = group(after, '9A');
  assert.equal(added.id, 'gnewgroup1');
  assert.deepEqual(added.days[DAY_B][2], { room: null, roomText: '999', label: '', teacherIds: [] });
  assert.deepEqual(countGroupChanges(before, after), { changed: 2, added: 1, removed: 1 });
});

test('it is one undo entry, and one undo takes all of it back', () => {
  const before = school();
  const store = createStore({ project: before, clock, ids: makeIds(3) });
  store.apply(applyGridEdits, everything(before));
  assert.notDeepEqual(store.project.groups, before.groups);
  const step = store.undo();
  assert.equal(step.label, 'Apply grid edits: 2 groups changed, 1 added, 1 removed');
  assert.deepEqual(store.project.groups, before.groups, 'every group is as it was');
  assert.equal(store.undo(), null, 'and that was the only entry');
});

test('the label counts groups from what changed, and the focus is the Grid tab', () => {
  const before = school();
  const payload = { slots: [{ groupId: group(before, '6A').id, dayTypeId: DAY_A, period: 0, slot: { room: null } }] };
  const after = run(before, payload);
  const info = describeAction(applyGridEdits, before, payload, after);
  assert.equal(info.label, 'Apply grid edits: 1 group changed');
  assert.deepEqual(info.bumps, [actions.SCHEDULE]);
  assert.deepEqual(info.focus, { section: 'schedule', tab: 'grid' });
});

test('the summary names "group" once, on the first part that is there', () => {
  assert.equal(groupChangesText({ changed: 3, added: 1, removed: 0 }), '3 groups changed, 1 added');
  assert.equal(groupChangesText({ changed: 3, added: 1, removed: 1 }), '3 groups changed, 1 added, 1 removed');
  assert.equal(groupChangesText({ changed: 1, added: 0, removed: 0 }), '1 group changed');
  assert.equal(groupChangesText({ changed: 0, added: 1, removed: 2 }), '1 group added, 2 removed');
  assert.equal(groupChangesText({ changed: 0, added: 0, removed: 1 }), '1 group removed');
  assert.equal(groupChangesText({ changed: 0, added: 0, removed: 0 }), 'no changes');
});

test('edits that leave everything as it is return the very same project, so the store makes no entry', () => {
  const before = school();
  const a = group(before, '6A');
  const same = applyGridEdits(freeze(before), {
    groups: [{ id: a.id, name: a.name, grade: a.grade }],
    slots: [{ groupId: a.id, dayTypeId: DAY_A, period: 0, slot: { room: a.days[DAY_A][0].room } }],
  }, ctx());
  assert.equal(same, before);
  assert.equal(applyGridEdits(before, {}, ctx()), before);
});

test('a group the edits do not touch is the very same object afterwards', () => {
  const before = school();
  const after = run(before, everything(before));
  assert.equal(group(after, '7A'), group(before, '7A'));
  assert.equal(after.building, before.building);
});

test('any refusal refuses the whole step: a slot in a room that has left the building changes nothing', () => {
  const before = school();
  const payload = everything(before);
  payload.slots.push({ groupId: group(before, '7A').id, dayTypeId: DAY_A, period: 1, slot: { room: 'rnotaroom1' } });
  assert.throws(() => applyGridEdits(freeze(before), payload, ctx()), (error) => error instanceof ActionError && error.code === 'missing' && /no longer in the building/.test(error.message));
  const store = createStore({ project: before, clock, ids: makeIds(3) });
  assert.throws(() => store.apply(applyGridEdits, payload), ActionError);
  assert.equal(store.project, before, 'the store still holds the project it had');
  assert.equal(store.undo(), null);
});

test('a removed group gives its name to an added one in the same step', () => {
  const before = school();
  const after = run(before, { removed: [group(before, '8B').id], added: [{ id: 'gnewgroup2', name: '8b', grade: '8', headCount: null, colour: '#abcdef' }] });
  assert.deepEqual(after.groups.filter((g) => g.name.toLowerCase() === '8b').map((g) => g.id), ['gnewgroup2']);
});

test('two groups trade names, and three pass theirs round', () => {
  const before = school();
  const [a, b, c] = ['6A', '6B', '6C'].map((name) => group(before, name).id);
  const traded = run(before, { groups: [{ id: a, name: '6B' }, { id: b, name: '6A' }] });
  assert.deepEqual([a, b].map((id) => traded.groups.find((g) => g.id === id).name), ['6B', '6A']);
  const round = run(before, { groups: [{ id: a, name: '6B' }, { id: b, name: '6C' }, { id: c, name: '6A' }] });
  assert.deepEqual([a, b, c].map((id) => round.groups.find((g) => g.id === id).name), ['6B', '6C', '6A']);
  // a name freed by a rename is taken in the same step, whichever is listed first
  const chain = run(before, { groups: [{ id: a, name: '6B' }, { id: b, name: '6Z' }] });
  assert.deepEqual([a, b].map((id) => chain.groups.find((g) => g.id === id).name), ['6B', '6Z']);
});

test('a name held by a group that is keeping it is refused in the action\'s own sentence', () => {
  const before = school();
  assert.throws(() => applyGridEdits(freeze(before), { groups: [{ id: group(before, '6A').id, name: '7a' }] }, ctx()),
    (error) => error instanceof ActionError && error.code === 'duplicate-name' && /already a group called "7A"/.test(error.message));
});

test('a payload that is not one is refused', () => {
  assert.throws(() => applyGridEdits(school(), null, ctx()), (error) => error instanceof ActionError && error.code === 'bad-value');
});

// ---------------------------------------------------------------- tab-separated text

test('tab-separated text is read as a spreadsheet writes it: any line ending, quoted cells, no row for the last line break', () => {
  assert.deepEqual(parseTsv('101\t102\r\n103\t104\r\n'), [['101', '102'], ['103', '104']]);
  assert.deepEqual(parseTsv('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseTsv('a\rb'), [['a'], ['b']]);
  assert.deepEqual(parseTsv('"two\nlines"\t"say ""hi"""\tplain "quote"'), [['two\nlines', 'say "hi"', 'plain "quote"']]);
  assert.deepEqual(parseTsv('a\t\t\n\tb\t'), [['a', '', ''], ['', 'b', '']], 'empty cells keep their place');
  assert.deepEqual(parseTsv(''), []);
});

test('what is written is read back the same, hostile cells included', () => {
  const rows = [['<b>7-1</b>', 'a\tb', 'line\nbreak', '"quoted"', ''], ['名前', '', '', '', 'x']];
  assert.deepEqual(parseTsv(writeTsv(rows)), rows);
  assert.equal(writeTsv([['101', '102'], ['103', '104']]), '101\t102\r\n103\t104');
});

// ---------------------------------------------------------------- staging

function staged(project) {
  const result = preview(project, project.id, ctx());
  return { ...result, model: sheetModel(project, result.project, draftFor(project.id)) };
}

// Each test stages on a project with its own id, as drafts are kept by project.
let serial = 0;
function ownSchool() {
  serial += 1;
  return { ...school(), id: 'pgridtest' + String(serial).padStart(2, '0') };
}

test('a staged edit shows in the preview and not in the project, and the bar\'s summary counts it', () => {
  const project = freeze(ownSchool());
  assert.equal(gridEditsPending(project.id), false);
  stageSlot(project.id, group(project, '6A').id, DAY_A, 0, { room: room(project, '101').id, roomText: '' });
  stageField(project.id, group(project, '6B').id, 'grade', 'Six');
  touch(project.id);
  const result = staged(project);
  assert.equal(gridEditsPending(project.id), true);
  assert.equal(result.text, '2 groups changed');
  assert.equal(group(result.project, '6A').days[DAY_A][0].room, room(project, '101').id);
  assert.notEqual(group(project, '6A').days[DAY_A][0].room, room(project, '101').id, 'the project itself is untouched');
  assert.equal(result.model.sections.some((section) => section.label === 'Grade Six'), true, 'the group moved under its new grade');
});

test('an edit that puts a cell back as it was is no longer pending', () => {
  const project = freeze(ownSchool());
  const a = group(project, '6A');
  stageSlot(project.id, a.id, DAY_A, 0, { room: null, roomText: '' });
  touch(project.id);
  assert.equal(staged(project).text, '1 group changed');
  stageSlot(project.id, a.id, DAY_A, 0, { room: a.days[DAY_A][0].room, roomText: '' });
  stageField(project.id, a.id, 'name', a.name);
  touch(project.id);
  assert.equal(staged(project).text, 'no changes');
  assert.equal(gridEditsPending(project.id), false);
});

test('the draft outlives a change to the project under it, and drops what the change made pointless', () => {
  const project = freeze(ownSchool());
  const a = group(project, '6A');
  const b = group(project, '6B');
  stageSlot(project.id, a.id, DAY_A, 3, { room: null, roomText: 'Annex' });
  stageSlot(project.id, b.id, DAY_A, 3, { room: null, roomText: 'Annex' });
  touch(project.id);
  const later = freeze(actions.deleteGroup(project, { id: b.id }, ctx()));
  const result = staged(later);
  assert.equal(result.refusal, null);
  assert.equal(result.text, '1 group changed', 'the edit to the group that is gone went with it');
  assert.deepEqual(payloadOf(draftFor(project.id)).slots.map((slot) => slot.groupId), [a.id]);
});

test('watchGridEdits tells the shell when edits start waiting and when they stop', () => {
  const project = freeze(ownSchool());
  const heard = [];
  const stop = watchGridEdits((id, pending) => heard.push([id, pending]));
  stageField(project.id, group(project, '6A').id, 'headCount', 12);
  touch(project.id);
  touch(project.id);
  discard(project.id);
  stop();
  stageField(project.id, group(project, '6A').id, 'headCount', 13);
  touch(project.id);
  assert.deepEqual(heard, [[project.id, true], [project.id, false]]);
  discard(project.id);
});

test('the last staged change can be taken back, one at a time', () => {
  const project = freeze(ownSchool());
  remember(project.id);
  stageField(project.id, group(project, '6A').id, 'grade', 'X');
  touch(project.id);
  remember(project.id);
  stageRemove(project.id, group(project, '6B').id);
  touch(project.id);
  assert.equal(staged(project).text, '1 group changed, 1 removed');
  assert.equal(takeBack(project.id), true);
  assert.equal(staged(project).text, '1 group changed');
  assert.equal(takeBack(project.id), true);
  assert.equal(gridEditsPending(project.id), false);
  assert.equal(takeBack(project.id), false);
});

test('removing a group that was only staged takes its slots with it and leaves nothing waiting', () => {
  const project = freeze(ownSchool());
  stageAdd(project.id, { id: 'gstagedone', name: '9Z', grade: '9', headCount: null, colour: '#abcdef' });
  stageSlot(project.id, 'gstagedone', DAY_A, 0, { room: room(project, '101').id, roomText: '' });
  touch(project.id);
  assert.equal(staged(project).text, '1 group added');
  stageRemove(project.id, 'gstagedone');
  touch(project.id);
  assert.equal(gridEditsPending(project.id), false);
});

// ---------------------------------------------------------------- cells and paste

test('a cell reads a room by its number whatever the capitals, keeps an unknown one as typed, and empties on nothing', () => {
  const project = freeze(ownSchool());
  const { model } = staged(project);
  const row = model.rows.find((each) => each.group.name === '6A');
  const column = model.columns.find((each) => each.id === DAY_A + ':1');
  assert.deepEqual(readCell(model, row, column, ' GYM ').op.fields, { room: room(project, 'Gym').id, roomText: '' });
  assert.deepEqual(readCell(model, row, column, '999').op.fields, { room: null, roomText: '999' });
  assert.deepEqual(readCell(model, row, column, '  ').op.fields, { room: null, roomText: '' });
});

test('a head count, a colour and a name are each refused in a sentence when they are not one', () => {
  const project = freeze(ownSchool());
  const { model } = staged(project);
  const row = model.rows.find((each) => each.group.name === '6A');
  const column = (id) => model.columns.find((each) => each.id === id);
  assert.match(readCell(model, row, column('headCount'), '0').why, /whole number from 1 to 999/);
  assert.match(readCell(model, row, column('headCount'), 'lots').why, /whole number from 1 to 999/);
  assert.equal(readCell(model, row, column('headCount'), '').op.value, null);
  assert.equal(readCell(model, row, column('headCount'), '28').op.value, 28);
  assert.match(readCell(model, row, column('colour'), 'red').why, /#rrggbb/);
  assert.equal(readCell(model, row, column('colour'), '#ABCDEF').op.value, '#abcdef');
  assert.match(readCell(model, row, column('name'), ' ').why, /needs a name/);
  assert.match(readCell(model, row, column('name'), '7a').why, /already a group called "7A"/);
  assert.equal(readCell(model, row, column('name'), '6a').op.value, '6a', 'its own name in other capitals is a rename');
  assert.equal(readCell(model, row, column('name'), '<b>6A</b>').op.value, '<b>6A</b>', 'any character is a name');
});

test('an unknown room shows as typed and is marked; a staged cell is marked staged', () => {
  const project = freeze(ownSchool());
  const a = group(project, '6A');
  stageSlot(project.id, a.id, DAY_A, 0, { room: null, roomText: 'Annex <2>' });
  touch(project.id);
  const { model } = staged(project);
  const row = model.rows.find((each) => each.id === a.id);
  const at = (period) => cellState(model, row, model.columns.find((each) => each.id === DAY_A + ':' + period));
  assert.deepEqual([at(0).text, at(0).unknown, at(0).staged], ['Annex <2>', true, true]);
  assert.deepEqual([at(1).unknown, at(1).staged], [false, false]);
});

test('findings are worked out on the staged schedule: a double-booking shows on both cells before anything is applied', () => {
  const project = freeze(ownSchool());
  const a = group(project, '7A');
  const b = group(project, '7B');
  const free = (period) => !project.groups.some((g) => g.days[DAY_B][period].room === a.days[DAY_B][period].room && g.id !== a.id);
  const period = [0, 1, 2, 3, 4, 5, 6, 7].find((p) => a.days[DAY_B][p].room !== null && free(p));
  stageSlot(project.id, b.id, DAY_B, period, { room: a.days[DAY_B][period].room, roomText: '' });
  touch(project.id);
  const { model } = staged(project);
  const column = model.columns.find((each) => each.id === DAY_B + ':' + period);
  for (const id of [a.id, b.id]) {
    const found = cellState(model, model.rows.find((each) => each.id === id), column).findings;
    assert.equal(found.some((finding) => finding.kind === 'room-double' && finding.severity === 'problem'), true, 'a problem on ' + id);
  }
});

test('a pasted block lands with its corner on the cell, stops at the last column, and says what it left out', () => {
  const project = freeze(ownSchool());
  const { model } = staged(project);
  const c = model.columns.findIndex((each) => each.id === DAY_A + ':0');
  const plan = planPaste(model, 0, c, parseTsv('101\t102\n103\tNowhere'), makeIds(5));
  assert.equal(plan.cells, 4);
  assert.deepEqual(plan.ops.map((op) => [op.groupId, op.period, op.fields.room, op.fields.roomText]), [
    [model.rows[0].id, 0, room(project, '101').id, ''],
    [model.rows[0].id, 1, room(project, '102').id, ''],
    [model.rows[1].id, 0, room(project, '103').id, ''],
    [model.rows[1].id, 1, null, 'Nowhere'],
  ]);
  const edge = planPaste(model, 0, model.columns.length - 2, [['101', '102', '103']], makeIds(5));
  assert.deepEqual([edge.cells, edge.clipped], [1, 2]);
  const bad = planPaste(model, 0, model.columns.findIndex((each) => each.id === 'headCount'), [['many']], makeIds(5));
  assert.deepEqual([bad.cells, bad.ops.length, bad.refused.length], [0, 0, 1]);
});

test('rows pasted past the last group become new groups, each with a free name and its own colour', () => {
  const project = freeze({ ...emptyProject(), id: 'pgridempty' });
  const before = staged(project);
  assert.equal(before.model.rows.length, 0);
  const plan = planPaste(before.model, 0, 0, parseTsv('7-1\t7\t24\t\tGym\n7-1\t7\t\t\t\n\t8\t\t#123456\t\n\t\t\t\t\n'), makeIds(5));
  assert.equal(plan.added, 3, 'the row of nothing adds no group');
  assert.match(plan.refused.join(' '), /already a group called "7-1"/, 'the second 7-1 is refused its name');
  const adds = plan.ops.filter((op) => op.op === 'add').map((op) => op.group);
  assert.equal(new Set(adds.map((g) => g.colour)).size, 3);
  for (const op of plan.ops) {
    if (op.op === 'add') stageAdd(project.id, { ...op.group });
    else if (op.op === 'field') stageField(project.id, op.groupId, op.field, op.value);
    else stageSlot(project.id, op.groupId, op.dayTypeId, op.period, op.fields);
  }
  touch(project.id);
  const after = staged(project);
  assert.equal(after.refusal, null);
  assert.equal(after.text, '3 groups added');
  assert.deepEqual(after.project.groups.map((g) => [g.name, g.grade, g.headCount]), [['7-1', '7', 24], ['New group', '7', null], ['New group 2', '8', null]]);
  assert.equal(after.project.groups[2].colour, '#123456');
  const dayId = after.project.dayTypes[0].id;
  assert.deepEqual(after.project.groups[0].days[dayId][0], { room: null, roomText: 'Gym', label: '', teacherIds: [] }, 'no building yet, so the room is kept as typed');
  assertValid(after.project);
  assert.equal(cellText(after.model, after.model.rows[0], after.model.columns[0]), '7-1');
});
