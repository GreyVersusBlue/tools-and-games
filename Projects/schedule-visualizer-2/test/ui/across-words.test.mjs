// The Teachers and Rooms rows of the Grid, as data and as words: node test/ui/across-words.test.mjs
//
// SV2-155. ui/schedule/grid/across.js turns the schedule into the rows the
// sheet draws and edits, and says in words what an edit did. No page is
// needed: the sheet draws what these hand it, and the rules of the edit
// itself are engine/grid-across.js's (test/engine/grid-across.test.mjs).
// Every case is on the sample school (A Day and B Day, eight groups, a
// teacher in each of 12 of its 13 rooms).
//
//   6A  A Day  201 103 101 Cafeteria 302 303 204 203
//   7C  A Day  302 203 Gym 201 Cafeteria Library 301 102
//   8B  A Day  Gym 101 204 203 Cafeteria 103 202 303

import test from 'node:test';
import assert from 'node:assert/strict';
import { setDayTypeKind, setRoomTeachers, editGroup, setSlot } from '../../engine/actions.js';
import { acrossModel, cellState, cellText, acrossOptions, namesUnknown, teacherRooms, defaultRoom, cellRequest, cellsOf, followersLeft, runAcross, wordsFor, plain, copiedAs, withoutDuties } from '../../ui/schedule/grid/across.js';
import { school, ctx } from '../engine/helpers.mjs';
import { sampleSchool } from '../../data/sample-school.js';

const A = 'dsample00a';
const B = 'dsample00b';

const rooms = (project, findings, ids, pending) => acrossModel('rooms', project, project, findings || new Map(), ids || null, pending || false);
const teachers = (project, findings, ids) => acrossModel('teachers', project, project, findings || new Map(), ids || null, false);
const rowOf = (model, id) => model.rows.find((row) => row.id === id);
const columnOf = (model, id) => model.columns.find((column) => column.id === id);

// what typing `text` into a slot does, in words
function said(project, model, rowId, columnId, text, roomId) {
  const cells = [cellRequest(model, rowOf(model, rowId), columnOf(model, columnId), text, roomId)];
  const block = runAcross(project, cells);
  assert.equal(block.refused, null, 'the edit is not refused: ' + block.refused);
  const words = wordsFor(project, block, cells);
  return words === null ? null : plain(words);
}

// ---------------------------------------------------------------- the model

test('the Rooms rows are one row a room in order of their numbers, a column a period of each day type, and a slot holds the groups in it', () => {
  const project = school();
  const model = rooms(project);
  assert.equal(model.rows.length, 13);
  assert.deepEqual(model.rows.map((row) => row.name).slice(0, 4), ['101', '102', '103', '201']);
  assert.deepEqual(model.columns.map((column) => column.kind), ['name'].concat(Array(16).fill('slot')));
  assert.deepEqual(model.days.map((day) => [day.dayType.name, day.count, day.follows]), [['A Day', 8, null], ['B Day', 8, null]]);
  assert.equal(columnOf(model, A + ':1').label, 'Period 2, A Day', 'a slot is named by the period and then the day type');
  const slot = cellState(model, rowOf(model, 'rsample101'), columnOf(model, A + ':1'));
  assert.deepEqual([slot.text, slot.groupNames, slot.staged, slot.follower], ['8B', ['8B'], false, false]);
  assert.equal(cellText(model, rowOf(model, 'rsample101'), columnOf(model, A + ':1')), '8B', 'what a slot is edited as and copied as: the group names');
  assert.equal(cellText(model, rowOf(model, 'rsamplecaf'), columnOf(model, A + ':3')), '6A, 6B, 6C', 'a shared space holds several');
  assert.equal(cellText(model, rowOf(model, 'rsample101'), columnOf(model, 'name')), '', 'the name is not edited as anything');
});

test('the Teachers rows say a group with its room, copy only the group names, and a free period holds nothing', () => {
  const project = school();
  const model = teachers(project);
  const row = rowOf(model, 'tsample011');
  const slot = columnOf(model, A + ':0');
  assert.equal(cellState(model, row, slot).text, '7C in 302');
  assert.equal(cellText(model, row, slot), '7C', 'the room is not what is typed or copied');
  assert.equal(cellState(model, rowOf(model, 'tsample001'), columnOf(model, A + ':0')).text, '', 'Ms. Halloran has Period 1 free on A Day');
  assert.equal(model.free, 'Planning');
  assert.equal(rooms(project).free, 'Empty');
});

test('a day type that follows another is shown with its columns marked, holding the day type it copies', () => {
  const project = setDayTypeKind(school(), { dayTypeId: B, own: false, sameAs: A }, ctx());
  const model = rooms(project);
  assert.equal(model.days[1].follows.name, 'A Day');
  const column = columnOf(model, B + ':1');
  assert.equal(column.follows.name, 'A Day');
  const slot = cellState(model, rowOf(model, 'rsample101'), column);
  assert.deepEqual([slot.text, slot.follower], ['8B', true], 'its slots are A Day’s, greyed');
  assert.equal(cellState(model, rowOf(model, 'rsample101'), columnOf(model, A + ':1')).follower, false);
  // asked for one day type, only that one is a column
  assert.deepEqual(rooms(project, null, [B]).days.map((day) => day.dayType.name), ['B Day']);
});

test('a slot the staged edits change is told apart, and one they leave alone is not', () => {
  const project = school();
  const cells = [cellRequest(rooms(project), rowOf(rooms(project), 'rsample101'), columnOf(rooms(project), A + ':1'), '6A')];
  const block = runAcross(project, cells);
  const model = acrossModel('rooms', project, block.project, new Map(), null, true);
  const state = (room, period) => cellState(model, rowOf(model, room), columnOf(model, A + ':' + period)).staged;
  assert.equal(state('rsample101', 1), true, 'Room 101 now holds 6A');
  assert.equal(state('rsample103', 1), true, 'Room 103 has lost it');
  assert.equal(state('rsample102', 1), false);
  assert.equal(acrossModel('rooms', project, block.project, new Map(), null, false).state(rowOf(model, 'rsample101'), columnOf(model, A + ':1')).staged, false, 'nothing is told apart when nothing is waiting');
});

// ---------------------------------------------------------------- the picker

test('the picker lists every group with where it is now, and narrows by what is typed since the last comma', () => {
  const project = school();
  const model = rooms(project);
  const row = rowOf(model, 'rsample101');
  const column = columnOf(model, A + ':1');
  const all = acrossOptions(model, row, column, '');
  assert.equal(all.options.length, 8);
  assert.equal(all.options.find((option) => option.group.name === '6A').label, '6A · grade 6 · now in 103');
  assert.equal(all.options.find((option) => option.group.name === '8B').label, '8B · grade 8 · now in 101');
  assert.deepEqual(acrossOptions(model, row, column, '7').options.map((option) => option.group.name), ['7A', '7B', '7C']);
  assert.deepEqual(acrossOptions(model, row, column, '8b').options.map((option) => option.group.name), ['8B'], 'case does not count');
  const after = acrossOptions(model, row, column, '8B, 6');
  assert.deepEqual(after.options.map((option) => option.group.name), ['6A', '6B', '6C'], 'after a comma the new piece narrows');
  assert.equal(after.from, 3, 'and says where in the text it begins');
  assert.equal(acrossOptions(model, row, column, '8B, ').options.length, 8, 'a comma with nothing after it lists every group again');
});

test('a group that has no room says so, and one whose name has a comma is matched whole', () => {
  const base = school();
  // a group whose own name has a comma, and a group with no room in Period 2 on A Day
  const project = editGroup(base, { id: 'gsample07a', name: 'Art, 2nd' }, ctx());
  const model = rooms(project);
  const row = rowOf(model, 'rsample101');
  const column = columnOf(model, A + ':3');
  const named = acrossOptions(model, row, column, 'Art, 2n');
  assert.deepEqual(named.options.map((option) => option.group.name), ['Art, 2nd'], 'no group is called 2n, so the whole text is what narrows');
  assert.equal(named.from, 0);
  const blank = { ...project, groups: project.groups.map((group) => (group.id === 'gsample06a' ? { ...group, days: { ...group.days, [A]: group.days[A].map((slot, period) => (period === 3 ? { ...slot, room: null, roomText: '' } : slot)) } } : group)) };
  const none = acrossOptions(rooms(blank), rowOf(rooms(blank), 'rsample101'), columnOf(rooms(blank), A + ':3'), '6A');
  assert.equal(none.options[0].label, '6A · grade 6 · now has no room');
  assert.equal(namesUnknown(model, 'Art, 2nd'), false);
  assert.equal(namesUnknown(model, '6A, 9Z'), true);
  assert.equal(namesUnknown(model, '6A, 6a'), true, 'one group twice');
});

test('a teacher’s rooms are the In field’s list, and it starts at the room the teacher already uses that period', () => {
  const project = setRoomTeachers(school(), { roomId: 'rsample201', teacherIds: ['tsample005', 'tsample008'] }, ctx());
  assert.deepEqual(teacherRooms(project, 'tsample008').map((room) => room.number), ['201', '204']);
  assert.deepEqual(teacherRooms(project, 'tsample011').map((room) => room.number), ['302'], 'a teacher with one room has no choice');
  const model = teachers(project);
  const row = rowOf(model, 'tsample008');
  // Period 1 she has 6A in 201 (hers now) and 7A in 204: the first of them; Period 2 only 7B in 204
  assert.equal(defaultRoom(model, row, columnOf(model, A + ':0')), 'rsample201');
  assert.equal(defaultRoom(model, row, columnOf(model, A + ':1')), 'rsample204');
  // a teacher with no room has none
  const bare = teachers(setRoomTeachers(school(), { roomId: 'rsample302', teacherIds: [] }, ctx()));
  assert.equal(defaultRoom(bare, rowOf(bare, 'tsample011'), columnOf(bare, A + ':3')), null);
});

// ---------------------------------------------------------------- what an edit says

test('a loss is said first, then what moved: typing 6A into Room 101 in Period 2 leaves 8B with no room', () => {
  const project = school();
  const model = rooms(project);
  assert.equal(said(project, model, 'rsample101', A + ':1', '6A'), '8B now has no room in Period 2 on A Day (was 101). 6A moves from 103 to 101 in Period 2 on A Day.');
  // the loss comes first even when the typed group is the first one listed in the schedule
  assert.match(said(project, model, 'rsample103', A + ':1', '8B'), /^6A now has no room in Period 2 on A Day \(was 103\)\. 8B moves from 101 to 103/);
});

test('a group with no room before is put in with the words that say so, and the same edit twice changes nothing', () => {
  const project = school();
  const emptied = acrossModel('rooms', project, runAcross(project, [cellRequest(rooms(project), rowOf(rooms(project), 'rsample101'), columnOf(rooms(project), A + ':1'), '')]).project, new Map(), null, false);
  const after = runAcross(project, [cellRequest(rooms(project), rowOf(rooms(project), 'rsample101'), columnOf(rooms(project), A + ':1'), '')]).project;
  assert.equal(cellText(emptied, rowOf(emptied, 'rsample101'), columnOf(emptied, A + ':1')), '');
  // 8B has no room in Period 2 now: putting it in Room 102 says it had none
  const model = rooms(after);
  assert.equal(said(after, model, 'rsample102', A + ':1', '8B'), '8B goes into 102 in Period 2 on A Day (it had no room).');
  // typing what is already there is no edit
  const same = [cellRequest(model, rowOf(model, 'rsample101'), columnOf(model, A + ':1'), '')];
  assert.equal(wordsFor(after, runAcross(after, same), same), null);
});

test('a teacher’s slot says what the teacher took and what was lost, the loss first, and Delete says where the class was', () => {
  const project = school();
  const model = teachers(project);
  assert.equal(said(project, model, 'tsample011', A + ':0', '6A'), '7C has no room in Period 1 on A Day now (it was in 302 with Mr. Larkspur). Mr. Larkspur takes 6A in Period 1 on A Day, in 302 (it was in 201).');
  assert.equal(said(project, model, 'tsample011', A + ':0', ''), '7C has no room in Period 1 on A Day now (it was in 302 with Mr. Larkspur).');
  // Mme. Dufrêne has a second room: the In field's room is where the class goes
  const two = setRoomTeachers(project, { roomId: 'rsample201', teacherIds: ['tsample005', 'tsample008'] }, ctx());
  const both = teachers(two);
  assert.equal(said(two, both, 'tsample008', A + ':1', '7B, 8A', 'rsample201'), 'Mme. Dufrêne takes 8A in Period 2 on A Day, in 201 (it was in 202).');
});

test('a long answer ends "And 3 more.", the day type is named only when the school has more than one, and names are kept as typed', () => {
  const project = school();
  const model = rooms(project);
  // the Cafeteria's Period 4 holds 6A, 6B and 6C; Room 101 takes all of them in Period 4 and Period 5, six changes
  const cells = [
    cellRequest(model, rowOf(model, 'rsample101'), columnOf(model, A + ':3'), '6A, 6B, 6C'),
    cellRequest(model, rowOf(model, 'rsample102'), columnOf(model, A + ':4'), '7A, 7B, 7C'),
  ];
  const block = runAcross(project, cells);
  assert.equal(block.refused, null);
  const words = plain(wordsFor(project, block, cells, 3));
  assert.match(words, / And \d+ more\.$/);
  assert.equal((words.match(/\. /g) || []).length >= 3, true);
  const hostile = '<b>7A</b> "x"';
  const renamed = editGroup(project, { id: 'gsample07a', name: hostile }, ctx());
  const model2 = rooms(renamed);
  const out = wordsFor(renamed, runAcross(renamed, [cellRequest(model2, rowOf(model2, 'rsample101'), columnOf(model2, A + ':1'), hostile)]), [cellRequest(model2, rowOf(model2, 'rsample101'), columnOf(model2, A + ':1'), hostile)]);
  assert.ok(out.some((part) => typeof part !== 'string' && part.name === hostile), 'the name is a segment of its own, for the page to draw as text');
  assert.equal(plain(out).includes(hostile), true);
  // one day type: no "on A Day"
  const one = { ...project, dayTypes: [project.dayTypes[0]] };
  const m1 = rooms(one);
  assert.doesNotMatch(said(one, m1, 'rsample101', A + ':1', '6A'), / on A Day/);
});

// ---------------------------------------------------------------- a block

test('a pasted block is laid on the slots from its corner, in reading order, and says what fell off the table or on the name', () => {
  const project = school();
  const model = rooms(project);
  const laid = cellsOf(model, 0, 4, [['7A', '7B'], ['6A', '6B']]);
  assert.equal(laid.cells.length, 4);
  assert.deepEqual(laid.cells.map((cell) => [cell.roomId, cell.period, cell.text]), [['rsample101', 3, '7A'], ['rsample101', 4, '7B'], ['rsample102', 3, '6A'], ['rsample102', 4, '6B']], 'room, period, text; the corner column is Period 4 of A Day');
  assert.deepEqual([laid.skipped, laid.runOff], [0, 0]);
  const over = cellsOf(model, 12, 16, [['x', 'y'], ['z', 'w']]);
  assert.deepEqual(over.cells.map((cell) => cell.text), ['x'], 'one slot is left on the table: the last room’s last period');
  assert.equal(over.runOff, 3, 'the rest ran off its end');
  const name = cellsOf(model, 0, 0, [['9', '7A']]);
  assert.equal(name.skipped, 1, 'the name is not a slot');
  assert.deepEqual(name.cells.map((cell) => cell.text), ['7A']);
});

// ---------------------------------------------------------------- SV2-155b

test('a block laid over the Teachers rows keeps the duty columns by place (a null holds nothing there, a text is skipped and counted) and leaves a follower day type’s slots out, said', () => {
  // (the full sample: school() has no duties, so no duty columns)
  const project = setDayTypeKind(sampleSchool({ level: true }), { dayTypeId: B, own: false, sameAs: A }, ctx());
  const model = teachers(project);
  const c = model.columns.findIndex((column) => column.id === A + ':6');
  assert.deepEqual(model.columns.slice(c, c + 7).map((column) => column.id), [A + ':6', A + ':7', A + ':before', A + ':after', B + ':0', B + ':1', B + ':2'], 'the sample has both duty columns after each day type’s periods');
  // a copy of A Day's last two periods and the two duty columns, as the sheet writes it, and three of B Day
  const laid = cellsOf(model, 0, c, [['6A', '7C', '', '', '8B', '8B', '8B']]);
  assert.deepEqual(laid.cells.map((cell) => cell.period), [6, 7], 'the two periods of A Day are taken, each in its own column');
  assert.equal(laid.skipped, 2, 'what lands on the duty columns is counted as left out');
  assert.equal(laid.followers.length, 3, 'B Day follows A Day: its three slots are left out, not sent to be refused');
  assert.equal(followersLeft(project, laid.followers), '3 slots were left as they are: B Day is the same as A Day. Make its own copy in the column header to change them');
  // a fill passes over the duty columns with nulls, and says nothing about them
  const fill = cellsOf(model, 0, c, [['6A', '6A', null, null, null]]);
  assert.deepEqual([fill.cells.length, fill.skipped, fill.followers.length, fill.runOff], [2, 0, 0, 0], 'a null is a place the fill passes over, not a skipped duty');
  assert.equal(followersLeft(project, [laid.followers[0]]), '1 slot was left as it is: B Day is the same as A Day. Make its own copy in the column header to change it');
});

test('an edit that moves a group off a slot that named teachers says which teachers were taken off it', () => {
  // 6A in Period 1 on A Day names Mr. Larkspur, who is based in 302; it goes to 101, which is Ms. Halloran’s
  const named = setSlot(school(), { groupId: 'gsample06a', dayTypeId: A, period: 0, slot: { teacherIds: ['tsample011'] } }, ctx());
  const model = rooms(named);
  const cells = [cellRequest(model, rowOf(model, 'rsample101'), columnOf(model, A + ':0'), '6A')];
  const block = runAcross(named, cells);
  assert.equal(block.refused, null);
  assert.deepEqual(block.moved.map((move) => move.droppedTeacherIds), [['tsample011']], 'the engine says who was dropped');
  assert.equal(plain(wordsFor(named, block, cells)), '6A moves from 201 to 101 in Period 1 on A Day. Mr. Larkspur is no longer named on 6A there (not based in 101).');
  // a slot that named nobody says nothing of the kind
  const bare = said(school(), rooms(school()), 'rsample101', A + ':0', '6A');
  assert.doesNotMatch(bare, /no longer named/);
  // a teacher who is gone from the schedule is still spoken of, not skipped
  const gone = { ...named, teachers: named.teachers.filter((teacher) => teacher.id !== 'tsample011') };
  const again = rooms(gone);
  const asked = [cellRequest(again, rowOf(again, 'rsample101'), columnOf(again, A + ':0'), '6A')];
  const lost = runAcross(gone, asked);
  if (!lost.refused) assert.match(plain(wordsFor(gone, lost, asked)), /A teacher who is no longer in the schedule is no longer named on 6A there/);
});

// ---------------------------------------------------------------- SV2-155c

test('a block copied from the Teachers rows with Before and After, pasted into the Rooms rows, drops the duty columns by their header and lands period by period', () => {
  // (the full sample: Coach Dunmore and others have duties, so the Teachers rows have Before and After)
  const project = sampleSchool({ level: true });
  const from = teachers(project);
  const to = rooms(project);
  const c = from.columns.findIndex((column) => column.id === A + ':6');
  const columns = [c, c + 1, c + 2, c + 3, c + 4];
  assert.deepEqual(columns.map((i) => from.columns[i].id), [A + ':6', A + ':7', A + ':before', A + ':after', B + ':0']);
  const block = [['6A', '7C', 'Bus duty', 'Car line', '8B'], ['', '8B', '', '', '6A']];
  const copy = copiedAs(from, columns, block);
  assert.deepEqual(copy.headers.slice(2, 4), ['Before', 'After'], 'each column keeps the header it was copied under: ' + copy.headers.join(', '));
  assert.deepEqual(copy.duty, [false, false, true, true, false]);
  const kept = withoutDuties(to, block, copy);
  assert.deepEqual(kept, [['6A', '7C', '8B'], ['', '8B', '6A']], 'the Rooms rows have no duty columns: Before and After are dropped');
  const r6 = to.columns.findIndex((column) => column.id === A + ':6');
  const laid = cellsOf(to, 0, r6, kept);
  assert.deepEqual(laid.cells.map((cell) => cell.dayTypeId + ':' + cell.period + '=' + cell.text), [A + ':6=6A', A + ':7=7C', B + ':0=8B', A + ':6=', A + ':7=8B', B + ':0=6A'], 'A Day’s last two periods and B Day’s first, none shifted onto the next');
  assert.equal(laid.skipped, 0, 'no duty text is laid on a slot');
  // the Teachers rows have duty columns of their own: the block is laid by place, as before
  assert.equal(withoutDuties(from, block, copy), block);
  // text that is not the last copy (from a spreadsheet) is laid as it is
  const other = [['6A', '7C', 'Bus duty', 'Car line', '7A']];
  assert.equal(withoutDuties(to, other, copy), other);
  assert.equal(withoutDuties(to, block, null), block);
});

test('a co-teacher based in the room a teacher’s slot takes a group into is never said to be not based there: the words follow the engine’s reason', () => {
  // Dr. Quillfeather shares 101 with Ms. Halloran; 6A in Period 1 on A Day is in 201 naming Ms. Halloran
  const shared = setRoomTeachers(school(), { roomId: 'rsample101', teacherIds: ['tsample001', 'tsample003'] }, ctx());
  const project = setSlot(shared, { groupId: 'gsample06a', dayTypeId: A, period: 0, slot: { teacherIds: ['tsample001'] } }, ctx());
  const model = teachers(project);
  const row = rowOf(model, 'tsample003');
  const column = columnOf(model, A + ':0');
  const there = cellText(model, row, column);
  const cells = [cellRequest(model, row, column, there === '' ? '6A' : there + ', 6A', 'rsample101')];
  const block = runAcross(project, cells);
  assert.equal(block.refused, null, block.refused);
  const move = block.moved.find((each) => each.groupId === 'gsample06a');
  assert.deepEqual(move.droppedTeacherIds, ['tsample001'], 'the engine says Ms. Halloran was taken off 6A');
  assert.equal(move.takenBy, 'tsample003', 'and why: Dr. Quillfeather’s slot took it');
  const words = plain(wordsFor(project, block, cells));
  assert.match(words, /Ms\. Halloran is no longer named on 6A there \(Dr\. Quillfeather has it now\)\./, words);
  assert.doesNotMatch(words, /not based in/, 'Ms. Halloran is based in 101: ' + words);
});
