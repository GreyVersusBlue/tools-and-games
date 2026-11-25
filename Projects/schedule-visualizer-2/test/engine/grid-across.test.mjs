// Editing the Grid by room and by teacher, the engine: node test/engine/grid-across.test.mjs
//
// roomCellEdit, teacherCellEdit and acrossBlock turn an edited cell of the
// Rooms or Teachers rows into slot fields (ARCHITECTURE 23.8, 23.12). Every
// case here is on the sample school (A Day and B Day, eight groups, one
// teacher in each of 12 of its 13 rooms), changed where a case needs it.
// Nothing here touches a page: the staging path is covered by feeding the
// result to applyGridEdits, the one action that applies a staged grid.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGridEdits } from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { roomCellEdit, teacherCellEdit, acrossBlock, groupsInText } from '../../engine/grid-across.js';
import { teacherDays } from '../../engine/teacher-day.js';
import { school, ctx, clock, makeIds, room, group, teacher, clone, assertValid } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// the sample, frozen, so a case that changed it would throw
function sample() {
  return freeze(school());
}

// a copy to change before freezing
function changed(fix) {
  const project = school();
  fix(project);
  return freeze(project);
}

const markNoClass = (groupId, dayTypeId, period) => ({ id: 'mnoclass01', kind: 'noclass', label: '', period, dayTypeIds: [dayTypeId], scope: 'groups', grades: [], groupIds: [groupId] });

// the ids of the groups, by name, for a result
const names = (project, ids) => ids.map((id) => project.groups.find((each) => each.id === id).name);
// fields by group name
const fieldsByName = (project, result) => Object.fromEntries(result.slots.map((slot) => [project.groups.find((each) => each.id === slot.groupId).name, slot.fields]));
// the groups the teacher's cell holds, by name
function cellOf(project, teacherName, dayTypeId, period) {
  return teacherDays(project, dayTypeId).get(teacher(project, teacherName).id)[period].groups.map((each) => project.groups.find((g) => g.id === each.groupId).name);
}
// a result put through the one action that applies a staged grid
function applied(project, result) {
  return applyGridEdits(project, { slots: result.slots.map(({ groupId, dayTypeId, period, fields }) => ({ groupId, dayTypeId, period, slot: fields })) }, ctx());
}

// ---------------------------------------------------------------- a room's cell

test('typing a group into a Rooms cell puts it there and takes the room\'s old group out (replace)', () => {
  const project = sample();
  // period 1 (index 0): 204 holds 7A, 201 holds 6A
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id] });
  assert.equal(result.refused, null);
  assert.deepEqual(fieldsByName(project, result), { '6A': { room: room(project, '204').id, roomText: '' }, '7A': { room: null, roomText: '' } });
  assert.deepEqual(names(project, result.cleared), ['7A'], '7A is left with no room');
  assert.deepEqual(result.moved.map((move) => [names(project, [move.groupId])[0], move.fromRoomId, move.fromText]), [['6A', room(project, '201').id, '']], '6A comes from 201');
  const after = applied(project, result);
  assertValid(after, 'what it leaves is a valid project');
  assert.equal(group(after, '6A').days[A][0].room, room(after, '204').id);
  assert.equal(group(after, '7A').days[A][0].room, null);
});

test('a Rooms edit that changes nothing stages nothing: the group already there, named again', () => {
  const project = sample();
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id] });
  assert.deepEqual([result.slots, result.moved, result.cleared, result.refused], [[], [], [], null]);
});

test('Delete on a Rooms cell (no groups) takes every group out of the room', () => {
  const project = sample();
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [] });
  assert.deepEqual(names(project, result.cleared), ['7A']);
  assert.deepEqual(result.moved, []);
});

test('a group put in a room keeps its label, and only its room is changed', () => {
  const project = changed((p) => { group(p, '6A').days[A][0].label = 'Maths'; });
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id, group(project, '7A').id] });
  assert.deepEqual(Object.keys(fieldsByName(project, result)['6A']).sort(), ['room', 'roomText'], 'no label field: it is kept');
  assert.equal(applied(project, result).groups.find((g) => g.name === '6A').days[A][0].label, 'Maths');
});

test('explicit teachers: dropped when none of them is based in the new room, and moved says so', () => {
  // 6A in 201 names Ms. Oyelaran (based in 201) explicitly; 204 is Mme. Dufrêne's
  const project = changed((p) => { group(p, '6A').days[A][0].teacherIds = [teacher(p, 'Ms. Oyelaran').id]; });
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id, group(project, '7A').id] });
  assert.deepEqual(fieldsByName(project, result)['6A'], { room: room(project, '204').id, roomText: '', teacherIds: [] });
  assert.deepEqual(result.moved[0].droppedTeacherIds, [teacher(project, 'Ms. Oyelaran').id]);
  assert.equal(teacherDays(applied(project, result), A).get(teacher(project, 'Mme. Dufrêne').id)[0].groups.length, 2, 'the room\'s teacher takes both');
});

test('explicit teachers: kept when one of them is based in the new room', () => {
  const project = changed((p) => { group(p, '6A').days[A][0].teacherIds = [teacher(p, 'Mme. Dufrêne').id, teacher(p, 'Ms. Oyelaran').id]; });
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id, group(project, '7A').id] });
  assert.deepEqual(fieldsByName(project, result)['6A'], { room: room(project, '204').id, roomText: '' }, 'no teacherIds field');
  assert.deepEqual(result.moved[0].droppedTeacherIds, []);
});

test('a group whose room was typed text (not in the building) says where it came from', () => {
  const project = changed((p) => { Object.assign(group(p, '6A').days[A][0], { room: null, roomText: '999' }); });
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id, group(project, '7A').id] });
  assert.deepEqual([result.moved[0].fromRoomId, result.moved[0].fromText], [null, '999']);
  assert.equal(applied(project, result).groups.find((g) => g.name === '6A').days[A][0].roomText, '', 'the text goes when a room is named');
});

test('a shared space takes several groups, and a room that is not shared that gets two keeps both (no refusal)', () => {
  const project = sample();
  const ids = ['6A', '8B', '7C'].map((name) => group(project, name).id);
  const gym = roomCellEdit(project, { roomId: room(project, 'Gym').id, dayTypeId: A, period: 0, groupIds: ids });
  assert.equal(gym.refused, null);
  assert.deepEqual(names(project, gym.cleared), [], '8B is already in the gym and stays');
  assert.deepEqual(gym.moved.map((move) => names(project, [move.groupId])[0]).sort(), ['6A', '7C']);
  const two = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id, group(project, '6B').id] });
  assert.equal(two.refused, null, 'a double-booking is a finding, never a refusal');
  const after = applied(project, two);
  assert.deepEqual([group(after, '7A').days[A][0].room, group(after, '6B').days[A][0].room], [room(after, '204').id, room(after, '204').id]);
});

test('a group with a No class mark or in a bell schedule\'s off period is refused, with the sentence', () => {
  const project = changed((p) => { p.marks = [markNoClass(group(p, '7A').id, B, 5)]; });
  const marked = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: B, period: 5, groupIds: [group(project, '7A').id] });
  assert.equal(marked.refused, '7A does not meet in Period 6 on B Day (No class).');
  assert.deepEqual([marked.slots, marked.moved, marked.cleared], [[], [], []]);
  const bells = changed((p) => { p.bellSchedules = [{ id: 'bassembly1', name: 'Assembly', short: '', bells: p.dayTypes[0].bells.map((bell) => (bell ? { ...bell } : null)), off: [2] }]; });
  const off = roomCellEdit(bells, { roomId: room(bells, '204').id, dayTypeId: A, period: 2, groupIds: [group(bells, '7A').id] }, { bellsId: 'bassembly1' });
  assert.equal(off.refused, '7A does not meet in Period 3 on A Day (off in Assembly).');
  const regular = roomCellEdit(bells, { roomId: room(bells, '204').id, dayTypeId: A, period: 2, groupIds: [group(bells, '7A').id] });
  assert.equal(regular.refused, null, 'on the regular bells every period meets');
});

test('a No class group is not in the room it still names, so typing over the cell does not clear it', () => {
  const project = changed((p) => { p.marks = [markNoClass(group(p, '7A').id, A, 0)]; });
  const result = roomCellEdit(project, { roomId: room(project, '204').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id] });
  assert.deepEqual(names(project, result.cleared), [], '7A is not shown in 204 then, so it is not taken out');
});

test('a day type that follows another, a period past the day and a room that is gone are refused in the schedule\'s own words', () => {
  const project = changed((p) => { Object.assign(p.dayTypes[1], { own: false, sameAs: A }); });
  const base = { roomId: room(project, '204').id, period: 0, groupIds: [] };
  assert.equal(roomCellEdit(project, { ...base, dayTypeId: B }).refused, 'B Day is the same as A Day. Make it its own copy to change it.');
  assert.equal(roomCellEdit(project, { ...base, dayTypeId: 'dgone00000' }).refused, 'That day type is no longer in the project.');
  assert.equal(roomCellEdit(project, { ...base, dayTypeId: A, period: 8 }).refused, 'That period is not in the school day. The day has 8.');
  assert.equal(roomCellEdit(project, { ...base, dayTypeId: A, roomId: 'rgone000000' }).refused, 'That room is no longer in the building. Pick another room.');
});

// ---------------------------------------------------------------- a teacher's cell

test('a teacher\'s cell: a group added goes in the teacher\'s only room, naming nobody (the room\'s teacher is the teacher)', () => {
  const project = sample();
  // Mme. Dufrêne has 204 only; at period 0 she has 7A
  assert.deepEqual(cellOf(project, 'Mme. Dufrêne', A, 0), ['7A']);
  const result = teacherCellEdit(project, { teacherId: teacher(project, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id, group(project, '6A').id] });
  assert.equal(result.refused, null);
  assert.deepEqual(fieldsByName(project, result), { '6A': { room: room(project, '204').id, roomText: '' } }, '204\'s teachers are exactly her: teacherIds stays empty');
  assert.deepEqual(result.taken.map((each) => [names(project, [each.groupId])[0], each.roomId]), [['6A', room(project, '204').id]]);
  assert.deepEqual(cellOf(applied(project, result), 'Mme. Dufrêne', A, 0).sort(), ['6A', '7A']);
});

test('a teacher\'s cell: the room is the one the teacher already uses that period, else their first room, and an explicit room wins', () => {
  // Mme. Dufrêne is also based in 102 (with Mr. Brightwater): two rooms
  // (6B's 204 at period 5 of the day is moved out, so she has nothing then)
  const project = changed((p) => { room(p, '102').teacherIds.push(teacher(p, 'Mme. Dufrêne').id); group(p, '6B').days[A][4].room = room(p, 'Library').id; });
  const T = teacher(project, 'Mme. Dufrêne').id;
  assert.deepEqual(cellOf(project, 'Mme. Dufrêne', A, 4), [], 'nothing in use at index 4');
  const edit = { teacherId: T, dayTypeId: A, period: 0 };
  // in use: she has 7A in 204 at period 0, so 6A goes to 204 (not 102, the first of her rooms)
  const using = teacherCellEdit(project, { ...edit, groupIds: [group(project, '7A').id, group(project, '6A').id] });
  assert.equal(fieldsByName(project, using)['6A'].room, room(project, '204').id);
  assert.deepEqual(fieldsByName(project, using)['6A'].teacherIds, undefined);
  // nothing in use at period 4 (she has no group then): the first of her rooms, 102, shared with Mr. Brightwater, so she is named
  const none = teacherCellEdit(project, { ...edit, period: 4, groupIds: [group(project, '6B').id] });
  assert.deepEqual(none.slots[0].fields, { room: room(project, '102').id, roomText: '', teacherIds: [T] });
  // an explicit room wins
  const explicit = teacherCellEdit(project, { ...edit, period: 4, groupIds: [group(project, '6B').id], roomId: room(project, 'Gym').id });
  assert.equal(explicit.slots[0].fields.room, room(project, 'Gym').id);
  assert.deepEqual(explicit.slots[0].fields.teacherIds, [T], 'the gym is not hers, so she is named');
});

test('a teacher\'s cell: in a room two teachers share, the added group names the teacher', () => {
  const project = changed((p) => { room(p, '204').teacherIds.push(teacher(p, 'Ms. Oyelaran').id); });
  const T = teacher(project, 'Mme. Dufrêne').id;
  const result = teacherCellEdit(project, { teacherId: T, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id, group(project, '6B').id] });
  assert.deepEqual(result.slots[0].fields, { room: room(project, '204').id, roomText: '', teacherIds: [T] });
  const after = applied(project, result);
  assert.deepEqual(cellOf(after, 'Ms. Oyelaran', A, 0).includes('6B'), false, 'the other teacher does not gain it');
});

test('a teacher with no room is refused, and the sentence says what to do', () => {
  const project = changed((p) => { room(p, '204').teacherIds = []; });
  const result = teacherCellEdit(project, { teacherId: teacher(project, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id] });
  assert.equal(result.refused, 'Mme. Dufrêne has no room. Add one for Mme. Dufrêne in Teachers, or type the class into the Rooms rows.');
  assert.deepEqual([result.slots, result.moved, result.cleared], [[], [], []]);
  // but a teacher with no room can still have a group taken out, and a roomId given is enough
  const given = teacherCellEdit(project, { teacherId: teacher(project, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [group(project, '6A').id], roomId: room(project, '204').id });
  assert.equal(given.refused, null);
});

test('a group whose slot names several teachers loses this one only, and its room stays', () => {
  const project = changed((p) => { group(p, '7A').days[A][0].teacherIds = [teacher(p, 'Mme. Dufrêne').id, teacher(p, 'Ms. Oyelaran').id]; });
  const result = teacherCellEdit(project, { teacherId: teacher(project, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [] });
  assert.deepEqual(fieldsByName(project, result), { '7A': { teacherIds: [teacher(project, 'Ms. Oyelaran').id] } });
  assert.deepEqual(result.cleared, []);
  assert.deepEqual(cellOf(applied(project, result), 'Ms. Oyelaran', A, 0).includes('7A'), true, 'the other teacher still has it');
});

test('a group that names the teacher alone, or counts through the room, is cleared when taken out of the cell', () => {
  const alone = changed((p) => { group(p, '7A').days[A][0].teacherIds = [teacher(p, 'Mme. Dufrêne').id]; });
  const first = teacherCellEdit(alone, { teacherId: teacher(alone, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [] });
  assert.deepEqual(fieldsByName(alone, first), { '7A': { room: null, roomText: '', teacherIds: [] } });
  assert.deepEqual(names(alone, first.cleared), ['7A']);
  assert.deepEqual(cellOf(applied(alone, first), 'Mme. Dufrêne', A, 0), [], 'it is really out of her cell (naming her alone would otherwise keep it)');
  const through = sample();
  const second = teacherCellEdit(through, { teacherId: teacher(through, 'Mme. Dufrêne').id, dayTypeId: A, period: 0, groupIds: [] });
  assert.deepEqual(fieldsByName(through, second), { '7A': { room: null, roomText: '', teacherIds: [] } });
  assert.deepEqual(names(through, second.cleared), ['7A']);
});

test('co-teaching is kept: a group already in the room naming another teacher gains this one', () => {
  const project = changed((p) => { group(p, '7A').days[A][0].teacherIds = [teacher(p, 'Ms. Oyelaran').id]; Object.assign(group(p, '7A').days[A][0], { room: room(p, '204').id }); });
  const T = teacher(project, 'Mme. Dufrêne').id;
  assert.deepEqual(cellOf(project, 'Mme. Dufrêne', A, 0), [], 'naming Ms. Oyelaran alone takes it from the room\'s teacher');
  const result = teacherCellEdit(project, { teacherId: T, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id] });
  assert.deepEqual(result.slots[0].fields, { room: room(project, '204').id, roomText: '', teacherIds: [teacher(project, 'Ms. Oyelaran').id, T] });
  assert.deepEqual(result.moved, [], 'the group did not change room');
  const after = applied(project, result);
  assert.deepEqual([cellOf(after, 'Mme. Dufrêne', A, 0), cellOf(after, 'Ms. Oyelaran', A, 0).includes('7A')], [['7A'], true]);
});

test('a group counted through the room for several teachers keeps them when another teacher is added', () => {
  const project = changed((p) => { room(p, '204').teacherIds.push(teacher(p, 'Ms. Oyelaran').id); });
  const guest = teacher(project, 'Mr. Pennywhistle').id;
  const result = teacherCellEdit(project, { teacherId: guest, dayTypeId: A, period: 0, groupIds: [group(project, '7A').id], roomId: room(project, '204').id });
  assert.deepEqual(result.slots[0].fields.teacherIds, [teacher(project, 'Mme. Dufrêne').id, teacher(project, 'Ms. Oyelaran').id, guest]);
});

test('a teacher\'s cell is refused for a follower day type, a No class group and a missing teacher', () => {
  const project = changed((p) => { Object.assign(p.dayTypes[1], { own: false, sameAs: A }); p.marks = [markNoClass(group(p, '6A').id, A, 3)]; });
  const T = teacher(project, 'Mme. Dufrêne').id;
  assert.equal(teacherCellEdit(project, { teacherId: T, dayTypeId: B, period: 0, groupIds: [] }).refused, 'B Day is the same as A Day. Make it its own copy to change it.');
  assert.equal(teacherCellEdit(project, { teacherId: T, dayTypeId: A, period: 3, groupIds: [group(project, '6A').id] }).refused, '6A does not meet in Period 4 on A Day (No class).');
  assert.equal(teacherCellEdit(project, { teacherId: 'tgone000000', dayTypeId: A, period: 0, groupIds: [] }).refused, 'That teacher is no longer in the project.');
});

// ---------------------------------------------------------------- typing

test('a cell\'s text is group names: whole first, then split on commas or semicolons, by nameKey', () => {
  const project = changed((p) => { group(p, '7C').name = 'Art, 2nd'; });
  const ids = (text) => groupsInText(project, text).groupIds.map((id) => project.groups.find((g) => g.id === id).name);
  assert.deepEqual(ids('6a'), ['6A'], 'case does not count');
  assert.deepEqual(ids('  6A  '), ['6A'], 'spaces at the ends do not count');
  assert.deepEqual(ids('6A, 6B'), ['6A', '6B']);
  assert.deepEqual(ids('6A;6B; 7A'), ['6A', '6B', '7A']);
  assert.deepEqual(ids('Art, 2nd'), ['Art, 2nd'], 'a group named with a comma matches whole');
  assert.deepEqual(ids('6A, Art, 2nd'), ['6A', 'Art, 2nd'], 'and still when typed with others');
  assert.deepEqual(ids('6A,,6B,'), ['6A', '6B'], 'empty pieces are nothing');
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('   '), []);
  assert.deepEqual(groupsInText(project, undefined), { groupIds: [], refused: null });
});

test('a name that matches no group is refused, as typed; two names for one group are refused', () => {
  const project = sample();
  assert.equal(groupsInText(project, '6A, 7-9').refused, 'No class is called 7-9. Add it in the Groups rows first.');
  assert.equal(groupsInText(project, '7-9').refused, 'No class is called 7-9. Add it in the Groups rows first.');
  assert.equal(groupsInText(project, '6A,  <b>x</b> ').refused, 'No class is called <b>x</b>. Add it in the Groups rows first.', 'a name is shown as typed, never as markup');
  assert.equal(groupsInText(project, '6A, 6a').refused, '6A and 6a are the same group. Name it once.');
  assert.deepEqual(groupsInText(project, '6A, 7-9').groupIds, [], 'a refusal names no group');
});

// ---------------------------------------------------------------- a block

test('a block is worked cell by cell, each against the result of those before it (a swap of two rooms)', () => {
  const project = sample();
  // 6A is in 201 and 7A in 204 in period 0: swap them, as a paste of two cells would
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 0, text: '7A' },
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '6A' },
  ]);
  assert.equal(result.refused, null);
  assert.equal(group(result.project, '7A').days[A][0].room, room(project, '201').id);
  assert.equal(group(result.project, '6A').days[A][0].room, room(project, '204').id);
});

test('a block is refused whole when one group would be in two rooms in one period, naming both rooms', () => {
  const project = sample();
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 1, text: '6A' },
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 1, text: '6A' },
  ]);
  assert.equal(result.refused, '6A is in two rooms in Period 2 in what you pasted: 204 and 201.');
  assert.deepEqual([result.slots, result.moved, result.cleared, result.taken], [[], [], [], []]);
  assert.equal(result.project, project, 'the project is the one handed in');
  // two Teachers cells that give one group different rooms are the same fault
  const teachers = acrossBlock(project, [
    { kind: 'teacher', teacherId: teacher(project, 'Mme. Dufrêne').id, dayTypeId: A, period: 1, text: '6A' },
    { kind: 'teacher', teacherId: teacher(project, 'Ms. Oyelaran').id, dayTypeId: A, period: 1, text: '6A' },
  ]);
  assert.equal(teachers.refused, '6A is in two rooms in Period 2 in what you pasted: 204 and 201.');
  // the same group in different periods, or on different day types, is not
  const fine = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 1, text: '6A' },
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 2, text: '6A' },
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: B, period: 1, text: '6A' },
  ]);
  assert.equal(fine.refused, null);
});

test('two Teachers cells naming one group in one room are co-teaching and kept, with both teachers', () => {
  // 204 is shared by Mme. Dufrêne and Ms. Oyelaran
  const project = changed((p) => { room(p, '204').teacherIds.push(teacher(p, 'Ms. Oyelaran').id); });
  const [one, two] = [teacher(project, 'Mme. Dufrêne').id, teacher(project, 'Ms. Oyelaran').id];
  const result = acrossBlock(project, [
    { kind: 'teacher', teacherId: one, dayTypeId: A, period: 1, text: '6A', roomId: room(project, '204').id },
    { kind: 'teacher', teacherId: two, dayTypeId: A, period: 1, text: '6A', roomId: room(project, '204').id },
  ]);
  assert.equal(result.refused, null);
  // (each teacher's cell also loses the group they had then: only 6A is named)
  assert.deepEqual(result.slots.filter((slot) => slot.groupId === group(project, '6A').id).map((slot) => slot.fields), [{ room: room(project, '204').id, roomText: '', teacherIds: [one, two] }], 'one slot, both teachers');
  assert.deepEqual([cellOf(result.project, 'Mme. Dufrêne', A, 1), cellOf(result.project, 'Ms. Oyelaran', A, 1)], [['6A'], ['6A']]);
});

test('a block with one refused cell is refused whole, with that cell\'s sentence, and stages nothing', () => {
  const project = sample();
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 1, text: '6A' },
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 2, text: '7-9' },
  ]);
  assert.equal(result.refused, 'No class is called 7-9. Add it in the Groups rows first.');
  assert.deepEqual(result.slots, []);
  assert.deepEqual(result.payload, { slots: [] });
  const noClass = changed((p) => { p.marks = [markNoClass(group(p, '7A').id, A, 4)]; });
  const second = acrossBlock(noClass, [
    { kind: 'room', roomId: room(noClass, '204').id, dayTypeId: A, period: 3, text: '6A' },
    { kind: 'room', roomId: room(noClass, '204').id, dayTypeId: A, period: 4, text: '7A' },
  ]);
  assert.equal(second.refused, '7A does not meet in Period 5 on A Day (No class).');
});

test('a block can be a column of Delete: every cell cleared, one slot for each group that had a room', () => {
  const project = sample();
  const result = acrossBlock(project, [201, 204, 301].map((number) => ({ kind: 'room', roomId: room(project, String(number)).id, dayTypeId: A, period: 0, text: '' })));
  assert.deepEqual(names(project, result.cleared).sort(), ['6A', '6C', '7A']);
  assert.deepEqual(result.slots.map((slot) => slot.fields), [{ room: null, roomText: '' }, { room: null, roomText: '' }, { room: null, roomText: '' }]);
});

test('a group cleared by one cell and named by a later one is moved, from where it began, and not cleared', () => {
  const project = sample();
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '' },
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 0, text: '7A' },
  ]);
  assert.equal(result.refused, null);
  assert.deepEqual(names(project, result.cleared), ['6A'], '6A was in 201 and was replaced; 7A is in 201 now');
  assert.deepEqual(result.moved.map((move) => [names(project, [move.groupId])[0], move.fromRoomId]), [['7A', room(project, '204').id]]);
});

test('the block\'s output, staged through applyGridEdits, is one history entry that one undo takes back', () => {
  const project = sample();
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '201').id, dayTypeId: A, period: 0, text: '7A' },
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '6A' },
    { kind: 'teacher', teacherId: teacher(project, 'Mr. Pennywhistle').id, dayTypeId: A, period: 1, text: '6B' },
  ]);
  assert.equal(result.refused, null);
  const store = createStore({ project, clock, ids: makeIds(3) });
  store.apply(applyGridEdits, result.payload);
  assert.deepEqual(store.project.groups, result.project.groups, 'applying the payload gives the schedule the block worked out');
  assertValid(store.project, 'and it is valid');
  store.undo();
  assert.deepEqual(store.project.groups, project.groups, 'one undo takes all three cells back');
  assert.equal(store.undo(), null, 'there was one entry');
});

test('a slot touched by two cells is staged once, with the fields the last left', () => {
  const project = sample();
  const result = acrossBlock(project, [
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '' },
    { kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '7A' },
  ]);
  assert.equal(result.slots.filter((slot) => slot.groupId === group(project, '7A').id).length, 1);
  assert.deepEqual(result.slots[0].fields, { room: room(project, '204').id, roomText: '' });
});

test('nothing handed in is changed, and the same edit gives the same answer', () => {
  const project = sample();
  const cells = [{ kind: 'room', roomId: room(project, '204').id, dayTypeId: A, period: 0, text: '6A' }];
  const frozen = freeze(clone(cells));
  const first = acrossBlock(project, frozen);
  assert.deepEqual(acrossBlock(project, frozen), first);
  assert.equal(group(project, '6A').days[A][0].room, room(project, '201').id);
});
