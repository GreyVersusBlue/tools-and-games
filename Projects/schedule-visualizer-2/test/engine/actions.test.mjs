import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { validate } from '../../engine/validate.js';
import { GROUP_COLOUR_PRESETS, defaultSettings, nameOfRoom } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { createStore } from '../../engine/store.js';
import { emptyProject, school, ctx, clock, makeIds, clone, room, group, teacher, assertValid, PINNED } from './helpers.mjs';

const { ActionError, GEOMETRY, BUILDING, SCHEDULE } = actions;

// Run an action on a deep-frozen project: any write to the old state throws.
function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// One id source for the whole file, as a page has one for its whole life.
const shared = ctx();

function run(action, project, payload) {
  const before = freeze(project);
  const after = action(before, payload === undefined ? {} : payload, shared);
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

function info(action, before, payload, after) {
  return actions.describeAction(action, before, payload, after);
}

// ---------------------------------------------------------------- shape

test('every action is (project, payload, ctx) and carries a label and its counters', () => {
  const names = Object.keys(actions).filter((name) => typeof actions[name] === 'function' && 'bumps' in actions[name]);
  for (const expected of ['setSetting', 'setPeriods', 'resetSettings', 'setPublishSetting', 'setOnboarding', 'addSubject', 'renameSubject', 'recolourSubject', 'reorderSubject', 'deleteSubject', 'addTeacher', 'editTeacher', 'deleteTeacher', 'mergeTeachers', 'setRoomTeachers', 'addGroup', 'editGroup', 'duplicateGroup', 'deleteGroup', 'setSlot', 'moveSlot', 'copyDay', 'renameDayType', 'makeOwnCopy', 'revertToBase', 'setBell', 'setBells', 'addFloor', 'renameFloor', 'reorderFloor', 'setFloorLevel', 'deleteFloor', 'acceptFinding', 'unacceptFinding', 'replaceProject']) {
    assert.ok(names.includes(expected), expected + ' is an action');
  }
  for (const name of names) {
    const action = actions[name];
    assert.ok(typeof action.label === 'string' || typeof action.label === 'function', name + ' has a label');
    assert.ok(Array.isArray(action.bumps) || typeof action.bumps === 'function', name + ' declares its counters');
  }
});

test('patch shares every branch off the path, and returns the target when nothing changed', () => {
  const target = freeze({ a: { b: [1, 2, 3], c: { d: 1 } }, e: { f: 1 } });
  const next = actions.patch(target, ['a', 'b', 1], () => 9);
  assert.deepEqual(next.a.b, [1, 9, 3]);
  assert.equal(next.e, target.e);
  assert.equal(next.a.c, target.a.c);
  assert.notEqual(next.a, target.a);
  assert.equal(actions.patch(target, ['a', 'b', 1], (value) => value), target);
});

// ---------------------------------------------------------------- settings

test('setSetting changes each field, one at a time', () => {
  const cases = [
    ['schoolName', 'Marrowby <Middle> & "Upper"'],
    ['periodWord', 'Block'],
    ['defaultPassingSeconds', 300],
    ['defaultHeadCount', 30],
    ['secondsPerCell', 2],
    ['secondsPerStair', 12],
    ['cellScale', { unit: 'feet', length: 5 }],
    ['colourScale.mode', 'absolute'],
    ['colourScale.bands', [5, 10, 20, 40]],
    ['checks.consecutiveLimit', 5],
    ['checks.passingMarginSeconds', 30],
    ['checks.off', ['room-unused', 'empty-period']],
    ['timeFormat', '24h'],
    ['paper.size', 'a4'],
    ['paper.orientation', 'landscape'],
    ['theme', 'dark'],
  ];
  assert.deepEqual(cases.map((c) => c[0]).concat(['periods']).sort(), actions.SETTING_KEYS.slice().sort(), 'every setting key is covered here');
  for (const [key, value] of cases) {
    const before = school();
    const after = run(actions.setSetting, before, { key, value });
    const read = key.split('.').reduce((at, part) => at[part], after.settings);
    assert.deepEqual(read, value, key);
    assert.equal(after.building, before.building, key + ' leaves the building alone');
    assert.equal(after.groups, before.groups, key + ' leaves the groups alone');
    const untouched = clone(before.settings);
    const changed = clone(after.settings);
    let a = untouched;
    let b = changed;
    const parts = key.split('.');
    for (const part of parts.slice(0, -1)) { a = a[part]; b = b[part]; }
    delete a[parts[parts.length - 1]];
    delete b[parts[parts.length - 1]];
    assert.deepEqual(changed, untouched, key + ' changes nothing else');
  }
});

test('setSetting stores the school name exactly as typed', () => {
  const name = '  <b>Marrowby</b> & "Sons"  ';
  assert.equal(run(actions.setSetting, school(), { key: 'schoolName', value: name }).settings.schoolName, name);
});

test('setSetting refuses a value out of range and says the range', () => {
  for (const [key, value] of [['secondsPerCell', 0], ['secondsPerCell', 11], ['secondsPerStair', 1], ['secondsPerStair', 31], ['defaultHeadCount', 0], ['defaultHeadCount', 1000], ['defaultHeadCount', 2.5], ['periodWord', 'Lesson'], ['timeFormat', '12'], ['theme', 'sepia'], ['paper.size', 'legal'], ['colourScale.bands', [1, 1, 2, 3]], ['colourScale.bands', [1, 2, 3]], ['checks.off', ['a', 'a']], ['schoolName', 5], ['nothing', 1]]) {
    refused(actions.setSetting, school(), { key, value }, 'bad-value');
  }
  assert.throws(() => actions.setSetting(school(), { key: 'secondsPerCell', value: 11 }, ctx()), /whole number from 1 to 10/);
});

test('setSetting with the value it already has returns the same project', () => {
  const project = school();
  assert.equal(actions.setSetting(project, { key: 'secondsPerCell', value: 3 }, ctx()), project);
  assert.equal(actions.setSetting(project, { key: 'colourScale.bands', value: [10, 25, 50, 100] }, ctx()), project);
});

test('which counters a setting moves: walking speeds move geometry, display settings move none', () => {
  const project = school();
  const bumps = (key, value) => info(actions.setSetting, project, { key, value }, project).bumps;
  assert.deepEqual(bumps('secondsPerCell', 2), [GEOMETRY, SCHEDULE]);
  assert.deepEqual(bumps('secondsPerStair', 9), [GEOMETRY, SCHEDULE]);
  assert.deepEqual(bumps('defaultHeadCount', 30), [SCHEDULE]);
  assert.deepEqual(bumps('periods', 6), [SCHEDULE]);
  assert.deepEqual(bumps('schoolName', 'x'), []);
  assert.deepEqual(bumps('theme', 'dark'), []);
  assert.equal(info(actions.setSetting, project, { key: 'theme', value: 'dark' }, project).label, 'Change the theme');
});

test('resetSettings resets settings only: not the building, the schedule, or periods per day', () => {
  let project = school();
  project = run(actions.setSetting, project, { key: 'secondsPerCell', value: 5 });
  project = run(actions.setSetting, project, { key: 'periodWord', value: 'Hour' });
  project = run(actions.setPeriods, project, { periods: 6 });
  const after = run(actions.resetSettings, project);
  assert.deepEqual(after.settings, { ...defaultSettings(), periods: 6 });
  assert.equal(after.building, project.building);
  assert.equal(after.groups, project.groups);
  assert.equal(after.dayTypes, project.dayTypes);
  assert.equal(after.publish, project.publish);
  assert.equal(actions.resetSettings(after, {}, ctx()), after, 'resetting defaults changes nothing');
});

test('setPublishSetting: the passcode, the staleness period, each view', () => {
  let project = school();
  project = run(actions.setPublishSetting, project, { key: 'passcode', value: '' });
  project = run(actions.setPublishSetting, project, { key: 'stalenessDays', value: 30 });
  project = run(actions.setPublishSetting, project, { key: 'views.coverage', value: false });
  project = run(actions.setPublishSetting, project, { key: 'teacherNamesOnMap', value: false });
  project = run(actions.setPublishSetting, project, { key: 'lastPublishedAt', value: PINNED });
  assert.deepEqual([project.publish.passcode, project.publish.stalenessDays, project.publish.views.coverage, project.publish.views.map, project.publish.teacherNamesOnMap, project.publish.lastPublishedAt], ['', 30, false, true, false, PINNED]);
  refused(actions.setPublishSetting, project, { key: 'stalenessDays', value: 0 }, 'bad-value');
  refused(actions.setPublishSetting, project, { key: 'views.everything', value: true }, 'bad-value');
  refused(actions.setPublishSetting, project, { key: 'passcode', value: 2015 }, 'bad-value');
});

test('setOnboarding ticks a step, dismisses, and sets never show', () => {
  let project = emptyProject();
  project = run(actions.setOnboarding, project, { step: 'movement' });
  project = run(actions.setOnboarding, project, { dismissed: true });
  project = run(actions.setOnboarding, project, { neverShow: true });
  assert.deepEqual(project.onboarding, { steps: { movement: true }, dismissed: true, neverShow: true });
  assert.equal(actions.setOnboarding(project, { step: 'movement', dismissed: true }, ctx()), project);
});

// ---------------------------------------------------------------- periods

test('describePeriodChange from 8 to 6 says exactly what would be lost, and changes nothing', () => {
  const project = freeze(school());
  const report = actions.describePeriodChange(project, 6);
  assert.equal(report.from, 8);
  assert.equal(report.to, 6);
  assert.deepEqual(report.removedPeriods, [{ period: 6, name: 'Period 7' }, { period: 7, name: 'Period 8' }]);
  assert.equal(report.slots, 32, '8 groups, 2 day types, 2 periods, every slot filled');
  assert.equal(report.bells, 4);
  assert.equal(report.groups.length, 8);
  assert.deepEqual(report.groups[0], { groupId: 'gsample06a', name: '6A', slots: 4 });
  assert.deepEqual(report.dayTypes, [{ dayTypeId: 'dsample00a', name: 'A Day', bells: 2 }, { dayTypeId: 'dsample00b', name: 'B Day', bells: 2 }]);
  assert.equal(report.losesData, true);
});

test('describePeriodChange going up, or over empty periods, loses nothing', () => {
  assert.equal(actions.describePeriodChange(school(), 10).losesData, false);
  assert.deepEqual(actions.describePeriodChange(school(), 10).removedPeriods, []);
  const empty = actions.describePeriodChange(emptyProject(), 4);
  assert.deepEqual([empty.slots, empty.bells, empty.losesData], [0, 0, false]);
  assert.equal(empty.removedPeriods.length, 4);
});

test('describePeriodChange counts the scenario changes that use a removed period', () => {
  const project = school();
  project.scenario = { name: 'x', compared: null, changes: [{ kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample06a', period: 7, roomId: 'rsample101' }, { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample06a', periodA: 0, periodB: 6 }, { kind: 'swapRooms', dayTypeId: 'dsample00a', groupA: 'gsample06a', groupB: 'gsample06b', period: 2 }] };
  assert.equal(actions.describePeriodChange(project, 6).scenarioChanges, 2);
});

test('setPeriods from 8 to 6 cuts every day and bell schedule to six', () => {
  const before = school();
  const after = run(actions.setPeriods, before, { periods: 6 });
  assert.equal(after.settings.periods, 6);
  for (const g of after.groups) for (const day of Object.values(g.days)) assert.equal(day.length, 6);
  for (const dayType of after.dayTypes) assert.equal(dayType.bells.length, 6);
  assert.equal(group(after, '6A').days.dsample00a[5], group(before, '6A').days.dsample00a[5], 'the kept slots are the same objects');
  assert.equal(after.building, before.building);
});

test('setPeriods from 8 to 10 pads every day with empty slots and every bell schedule with nulls', () => {
  const after = run(actions.setPeriods, school(), { periods: 10 });
  assert.deepEqual(group(after, '8B').days.dsample00b.slice(8), [{ room: null, roomText: '', label: '', teacherIds: [] }, { room: null, roomText: '', label: '', teacherIds: [] }]);
  assert.deepEqual(after.dayTypes[0].bells.slice(8), [null, null]);
});

test('setPeriods refuses 0 and 17, and the same number changes nothing', () => {
  refused(actions.setPeriods, school(), { periods: 0 }, 'bad-value');
  refused(actions.setPeriods, school(), { periods: 17 }, 'bad-value');
  refused(actions.setPeriods, school(), { periods: 6.5 }, 'bad-value');
  const project = school();
  assert.equal(actions.setPeriods(project, { periods: 8 }, ctx()), project);
});

test('setSetting with the key periods does what setPeriods does', () => {
  const viaSetting = run(actions.setSetting, school(), { key: 'periods', value: 6 });
  assert.deepEqual(viaSetting, actions.setPeriods(school(), { periods: 6 }, ctx()));
  assert.equal(info(actions.setSetting, school(), { key: 'periods', value: 6 }, viaSetting).label, 'Change periods per day to 6');
});

// ---------------------------------------------------------------- subjects

test('addSubject puts a new subject at the end with its own id', () => {
  const before = school();
  const after = run(actions.addSubject, before, { code: 'DRA', name: 'Drama', colour: '#AA3366' });
  assert.equal(after.subjects.length, before.subjects.length + 1);
  const added = after.subjects[after.subjects.length - 1];
  assert.match(added.id, /^s[a-z0-9]{9}$/);
  assert.deepEqual([added.code, added.name, added.colour], ['DRA', 'Drama', '#aa3366']);
  assert.equal(after.subjects[0], before.subjects[0]);
  assert.equal(info(actions.addSubject, before, { name: 'Drama' }, after).label, 'Add subject Drama');
  refused(actions.addSubject, before, { name: 'Drama', colour: 'pink' }, 'bad-value');
});

test('renameSubject and recolourSubject change the one subject and keep its id', () => {
  const before = school();
  let after = run(actions.renameSubject, before, { id: 'ssample001', name: 'Maths', code: 'MA' });
  after = run(actions.recolourSubject, after, { id: 'ssample001', colour: '#112233' });
  assert.deepEqual(after.subjects[0], { id: 'ssample001', code: 'MA', name: 'Maths', colour: '#112233' });
  assert.equal(after.subjects[1], before.subjects[1]);
  assert.equal(room(after, '101').subjectId, 'ssample001', 'rooms still point at it');
  assert.equal(after.building, before.building);
  refused(actions.renameSubject, before, { id: 'snothing00', name: 'x' }, 'missing');
});

test('reorderSubject moves one subject and keeps the rest in order', () => {
  const before = school();
  const after = run(actions.reorderSubject, before, { id: 'ssample001', toIndex: 2 });
  assert.deepEqual(after.subjects.slice(0, 4).map((s) => s.code), ['ENG', 'SCI', 'MATH', 'SOC']);
  assert.deepEqual(run(actions.reorderSubject, before, { id: 'ssample003', toIndex: 0 }).subjects.slice(0, 3).map((s) => s.code), ['SCI', 'MATH', 'ENG']);
  assert.equal(run(actions.reorderSubject, before, { id: 'ssample001', toIndex: 99 }).subjects[8].code, 'MATH', 'past the end means last');
  assert.equal(actions.reorderSubject(before, { id: 'ssample001', toIndex: 0 }, ctx()), before);
});

test('deleteSubject leaves the rooms and teachers that used it with no subject', () => {
  const before = school();
  assert.deepEqual(actions.describeSubjectUse(before, 'ssample001'), { rooms: 2, teachers: 2 });
  const after = run(actions.deleteSubject, before, { id: 'ssample001' });
  assert.equal(after.subjects.some((s) => s.id === 'ssample001'), false);
  assert.equal(room(after, '101').subjectId, null);
  assert.equal(room(after, '102').subjectId, null);
  assert.equal(room(after, '103').subjectId, 'ssample003', 'never filed under some other subject');
  assert.deepEqual(after.teachers.filter((t) => t.subjectId === null).map((t) => t.name), ['Ms. Halloran', 'Mr. Brightwater']);
  assert.equal(after.building.floors[2], before.building.floors[2], 'a floor with no room of that subject is the same object');
});

// ---------------------------------------------------------------- teachers

test('addTeacher adds to the list and to each of the teacher\'s rooms', () => {
  const before = school();
  const after = run(actions.addTeacher, before, { name: 'Mr. Ashgrove', subjectId: 'ssample001', roomIds: ['rsample101'], notes: 'Tuesdays only' });
  const added = teacher(after, 'Mr. Ashgrove');
  assert.match(added.id, /^t[a-z0-9]{9}$/);
  assert.deepEqual(added.roomIds, ['rsample101']);
  assert.deepEqual(room(after, '101').teacherIds, ['tsample001', added.id], 'the main teacher stays first');
  assert.equal(after.building.floors[1], before.building.floors[1]);
});

test('addTeacher refuses a name already on the list, whatever the capitals', () => {
  refused(actions.addTeacher, school(), { name: 'ms. halloran ' }, 'duplicate-name');
  refused(actions.addTeacher, school(), { name: '   ' }, 'no-name');
  refused(actions.addTeacher, school(), { name: 'New', roomIds: ['rnowhere00'] }, 'missing');
  refused(actions.addTeacher, school(), { name: 'New', subjectId: 'snothing00' }, 'missing');
});

test('editTeacher: renaming keeps the id, so nothing is disconnected', () => {
  const before = school();
  const after = run(actions.editTeacher, before, { id: 'tsample001', name: 'Mrs. Halloran-Voss' });
  assert.equal(after.teachers[0].id, 'tsample001');
  assert.equal(after.teachers[0].name, 'Mrs. Halloran-Voss');
  assert.equal(after.teachers.length, before.teachers.length, 'no second teacher');
  assert.equal(after.building, before.building);
  assert.equal(run(actions.editTeacher, before, { id: 'tsample001', name: 'MS. HALLORAN' }).teachers[0].name, 'MS. HALLORAN', 'a teacher may be renamed to their own name in other capitals');
  refused(actions.editTeacher, before, { id: 'tsample001', name: 'Mr. Brightwater' }, 'duplicate-name');
});

test('editTeacher: changing rooms changes both sides', () => {
  const before = school();
  const after = run(actions.editTeacher, before, { id: 'tsample001', roomIds: ['rsample102', 'rsample301'] });
  assert.deepEqual(after.teachers[0].roomIds, ['rsample102', 'rsample301']);
  assert.deepEqual(room(after, '101').teacherIds, []);
  assert.deepEqual(room(after, '102').teacherIds, ['tsample002', 'tsample001']);
  assert.deepEqual(room(after, '301').teacherIds, ['tsample010', 'tsample001']);
  assert.equal(after.building.floors[1], before.building.floors[1]);
  assert.equal(actions.editTeacher(before, { id: 'tsample001', roomIds: ['rsample101'], notes: '' }, ctx()), before);
});

test('setRoomTeachers sets a room\'s teachers in order and updates each teacher', () => {
  const before = school();
  const after = run(actions.setRoomTeachers, before, { roomId: 'rsample101', teacherIds: ['tsample002', 'tsample001'] });
  assert.deepEqual(room(after, '101').teacherIds, ['tsample002', 'tsample001']);
  assert.deepEqual(after.teachers[1].roomIds, ['rsample102', 'rsample101']);
  const cleared = run(actions.setRoomTeachers, after, { roomId: 'rsample101', teacherIds: [] });
  assert.deepEqual(cleared.teachers[0].roomIds, []);
  assert.deepEqual(cleared.teachers[1].roomIds, ['rsample102']);
});

test('deleteTeacher takes the teacher off every room and every slot', () => {
  let before = school();
  before = run(actions.setSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { teacherIds: ['tsample005', 'tsample001'] } });
  const after = run(actions.deleteTeacher, before, { id: 'tsample005' });
  assert.equal(after.teachers.some((t) => t.id === 'tsample005'), false);
  assert.deepEqual(room(after, '201').teacherIds, []);
  assert.deepEqual(group(after, '6A').days.dsample00a[0].teacherIds, ['tsample001']);
  assert.equal(group(after, '6B'), group(before, '6B'), 'a group that never named the teacher is the same object');
});

test('mergeTeachers moves every room and slot to the kept teacher', () => {
  let before = school();
  before = run(actions.addTeacher, before, { id: 'tsampledup', name: 'Ms Halloran', roomIds: ['rsample302', 'rsample101'], notes: 'Part time' });
  before = run(actions.setSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { teacherIds: ['tsampledup', 'tsample001'] } });
  before = run(actions.setSlot, before, { groupId: 'gsample06b', dayTypeId: 'dsample00a', period: 0, slot: { teacherIds: ['tsampledup'] } });
  assert.deepEqual(actions.findNearDuplicateTeachers(before).map((list) => list.map((t) => t.name)), [['Ms. Halloran', 'Ms Halloran']]);
  const after = run(actions.mergeTeachers, before, { keepId: 'tsample001', mergeId: 'tsampledup' });
  assert.equal(after.teachers.length, 12);
  assert.deepEqual(after.teachers[0], { id: 'tsample001', name: 'Ms. Halloran', subjectId: 'ssample001', roomIds: ['rsample101', 'rsample302'], notes: 'Part time' });
  assert.deepEqual(room(after, '101').teacherIds, ['tsample001'], 'named once, not twice');
  assert.deepEqual(room(after, '302').teacherIds, ['tsample011', 'tsample001']);
  assert.deepEqual(group(after, '6A').days.dsample00a[0].teacherIds, ['tsample001']);
  assert.deepEqual(group(after, '6B').days.dsample00a[0].teacherIds, ['tsample001']);
  assert.equal(info(actions.mergeTeachers, before, { keepId: 'tsample001', mergeId: 'tsampledup' }, after).label, 'Merge Ms Halloran into Ms. Halloran');
  refused(actions.mergeTeachers, before, { keepId: 'tsample001', mergeId: 'tsample001' }, 'bad-value');
});

test('mergeTeachers fills the kept teacher\'s gaps from the merged one, and keeps both notes', () => {
  let before = school();
  before = run(actions.editTeacher, before, { id: 'tsample001', subjectId: null, notes: 'Room 101' });
  before = run(actions.editTeacher, before, { id: 'tsample002', notes: 'Mondays' });
  const after = run(actions.mergeTeachers, before, { keepId: 'tsample001', mergeId: 'tsample002' });
  assert.equal(after.teachers[0].subjectId, 'ssample001');
  assert.equal(after.teachers[0].notes, 'Room 101\nMondays');
});

// ---------------------------------------------------------------- groups

test('addGroup takes the next unused colour and an empty day for each own day type', () => {
  const before = school();
  const after = run(actions.addGroup, before, { name: '8C', grade: '8', headCount: 21 });
  const added = group(after, '8C');
  assert.match(added.id, /^g[a-z0-9]{9}$/);
  assert.equal(added.colour, GROUP_COLOUR_PRESETS[8], 'the first eight presets are taken by the sample groups');
  assert.deepEqual(Object.keys(added.days), ['dsample00a', 'dsample00b']);
  assert.equal(added.days.dsample00a.length, 8);
  assert.equal(after.groups[0], before.groups[0]);
});

test('addGroup in a project whose B Day is the same as A Day makes a day for A Day only', () => {
  const after = run(actions.addGroup, emptyProject(), { name: '7-1' });
  assert.equal(Object.keys(after.groups[0].days).length, 1);
  assert.deepEqual([after.groups[0].grade, after.groups[0].headCount, after.groups[0].colour], ['', null, GROUP_COLOUR_PRESETS[0]]);
});

test('addGroup and editGroup refuse a name in use, whatever the capitals, and a bad head count', () => {
  refused(actions.addGroup, school(), { name: '6a' }, 'duplicate-name');
  refused(actions.addGroup, school(), { name: '' }, 'no-name');
  refused(actions.addGroup, school(), { name: 'New', headCount: 0 }, 'bad-value');
  refused(actions.addGroup, school(), { name: 'New', headCount: 1000 }, 'bad-value');
  refused(actions.editGroup, school(), { id: 'gsample06a', name: '6B' }, 'duplicate-name');
  refused(actions.editGroup, school(), { id: 'gnobody000', name: 'x' }, 'missing');
});

test('editGroup changes name, grade, head count and colour and nothing else', () => {
  const before = school();
  const after = run(actions.editGroup, before, { id: 'gsample06a', name: '6-Alpha', grade: 'Sixth', headCount: null, colour: '#ABCDEF' });
  assert.deepEqual([after.groups[0].name, after.groups[0].grade, after.groups[0].headCount, after.groups[0].colour], ['6-Alpha', 'Sixth', null, '#abcdef']);
  assert.equal(after.groups[0].days, before.groups[0].days);
  assert.equal(after.groups[1], before.groups[1]);
  assert.equal(actions.editGroup(before, { id: 'gsample06a', name: '6A', headCount: 24 }, ctx()), before);
});

test('duplicateGroup names the copies "(Copy)", "(Copy) 2", "(Copy) 3"', () => {
  let project = school();
  project = run(actions.duplicateGroup, project, { id: 'gsample06a' });
  assert.deepEqual(project.groups.slice(0, 3).map((g) => g.name), ['6A', '6A (Copy)', '6B'], 'the copy sits after the original');
  project = run(actions.duplicateGroup, project, { id: 'gsample06a' });
  project = run(actions.duplicateGroup, project, { id: 'gsample06a' });
  assert.deepEqual(project.groups.filter((g) => g.name.startsWith('6A')).map((g) => g.name).sort(), ['6A', '6A (Copy)', '6A (Copy) 2', '6A (Copy) 3']);
});

test('duplicating a copy counts on rather than stacking "(Copy) (Copy)"', () => {
  let project = run(actions.duplicateGroup, school(), { id: 'gsample06a', newId: 'gcopy00001' });
  project = run(actions.duplicateGroup, project, { id: 'gcopy00001' });
  assert.ok(project.groups.some((g) => g.name === '6A (Copy) 2'));
  assert.equal(project.groups.some((g) => g.name.includes('(Copy) (Copy)')), false);
  assert.equal(actions.copyName(project, '6a (Copy) 2'), '6a (Copy) 3', 'names in use are compared without case');
});

test('duplicateGroup copies the days, with a new id and the next unused colour', () => {
  const before = school();
  const after = run(actions.duplicateGroup, before, { id: 'gsample08a' });
  const copy = group(after, '8A (Copy)');
  assert.notEqual(copy.id, 'gsample08a');
  assert.deepEqual(copy.days, group(before, '8A').days);
  assert.equal(copy.headCount, 28);
  assert.equal(copy.colour, GROUP_COLOUR_PRESETS[8]);
});

test('deleteGroup removes the one group', () => {
  const before = school();
  const after = run(actions.deleteGroup, before, { id: 'gsample07b' });
  assert.deepEqual(after.groups.map((g) => g.name), ['6A', '6B', '6C', '7A', '7C', '8A', '8B']);
  assert.equal(after.building, before.building);
});

test('setSlot puts a group in a room for one period on one day type', () => {
  const before = school();
  const after = run(actions.setSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00b', period: 2, slot: { room: 'rsample302', label: 'Ceramics', teacherIds: ['tsample011', 'tsample001'] } });
  assert.deepEqual(group(after, '6A').days.dsample00b[2], { room: 'rsample302', roomText: '', label: 'Ceramics', teacherIds: ['tsample011', 'tsample001'] });
  assert.equal(group(after, '6A').days.dsample00a, group(before, '6A').days.dsample00a, 'the other day type is the same object');
  assert.equal(group(after, '6A').days.dsample00b[3], group(before, '6A').days.dsample00b[3]);
  assert.equal(info(actions.setSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00b', period: 2 }, after).label, 'Change 6A in Period 3 on B Day');
});

test('setSlot: a room that is not in the building is kept as text; naming a real room clears the text', () => {
  let project = run(actions.setSlot, school(), { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: null, roomText: 'Annex <4>' } });
  assert.deepEqual([group(project, '6A').days.dsample00a[0].room, group(project, '6A').days.dsample00a[0].roomText], [null, 'Annex <4>']);
  project = run(actions.setSlot, project, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: 'rsample101' } });
  assert.deepEqual([group(project, '6A').days.dsample00a[0].room, group(project, '6A').days.dsample00a[0].roomText], ['rsample101', '']);
  project = run(actions.setSlot, project, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: null } });
  assert.deepEqual(group(project, '6A').days.dsample00a[0], { room: null, roomText: '', label: '', teacherIds: [] });
});

test('setSlot refuses a room, period, teacher or group that is not there', () => {
  const base = { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0 };
  refused(actions.setSlot, school(), { ...base, slot: { room: 'rnowhere00' } }, 'missing');
  refused(actions.setSlot, school(), { ...base, slot: { room: 'osample001' } }, 'missing');
  refused(actions.setSlot, school(), { ...base, slot: { teacherIds: ['tnobody000'] } }, 'missing');
  refused(actions.setSlot, school(), { ...base, period: 8, slot: { room: null } }, 'bad-value');
  refused(actions.setSlot, school(), { ...base, period: -1, slot: { room: null } }, 'bad-value');
  refused(actions.setSlot, school(), { ...base, groupId: 'gnobody000', slot: { room: null } }, 'missing');
  refused(actions.setSlot, school(), { ...base, dayTypeId: 'dnowhere00', slot: { room: null } }, 'missing');
});

test('setSlot refuses a day type that is the same as A Day, and says how to change it', () => {
  let project = run(actions.addGroup, emptyProject(), { name: '7-1', id: 'gseven0001' });
  const bDay = project.dayTypes[1].id;
  refused(actions.setSlot, project, { groupId: 'gseven0001', dayTypeId: bDay, period: 0, slot: { label: 'x' } }, 'same-as-base');
  assert.throws(() => actions.setSlot(project, { groupId: 'gseven0001', dayTypeId: bDay, period: 0, slot: { label: 'x' } }, ctx()), { message: 'B Day is the same as A Day. Make it its own copy to change it.' });
});

test('setSlot with what the slot already holds returns the same project', () => {
  const project = school();
  const slot = group(project, '6A').days.dsample00a[0];
  assert.equal(actions.setSlot(project, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: slot.room, label: '', teacherIds: [] } }, ctx()), project);
});

test('moveSlot moves an assignment to another period; the two periods trade places', () => {
  const before = school();
  const after = run(actions.moveSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', from: 0, to: 4 });
  const was = group(before, '6A').days.dsample00a;
  const now = group(after, '6A').days.dsample00a;
  assert.equal(now[4], was[0]);
  assert.equal(now[0], was[4]);
  assert.deepEqual(now.filter((slot, p) => p !== 0 && p !== 4), was.filter((slot, p) => p !== 0 && p !== 4));
  assert.equal(info(actions.moveSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', from: 0, to: 4 }, after).label, 'Move 6A\'s Period 1 to Period 5');
  assert.equal(actions.moveSlot(before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', from: 3, to: 3 }, ctx()), before);
  refused(actions.moveSlot, before, { groupId: 'gsample06a', dayTypeId: 'dsample00a', from: 0, to: 8 }, 'bad-value');
});

test('copyDay copies A Day to B Day for one group', () => {
  const before = school();
  const after = run(actions.copyDay, before, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00b', groupId: 'gsample06a' });
  assert.deepEqual(group(after, '6A').days.dsample00b, group(before, '6A').days.dsample00a);
  assert.notEqual(group(after, '6A').days.dsample00b[0], group(after, '6A').days.dsample00a[0], 'copies, so editing one day does not edit the other');
  assert.equal(group(after, '6B'), group(before, '6B'));
});

test('copyDay with no group copies A Day to B Day for every group', () => {
  const before = school();
  const after = run(actions.copyDay, before, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00b' });
  for (const g of after.groups) assert.deepEqual(g.days.dsample00b, g.days.dsample00a, g.name);
  assert.equal(info(actions.copyDay, before, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00b' }, after).label, 'Copy A Day to B Day for every group');
  assert.equal(actions.copyDay(after, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00b' }, ctx()), after, 'copying again changes nothing');
});

test('copyDay onto a day type that is the same as A Day changes nothing: it already is', () => {
  const project = run(actions.addGroup, emptyProject(), { name: '7-1' });
  assert.equal(actions.copyDay(project, { fromDayTypeId: project.dayTypes[0].id, toDayTypeId: project.dayTypes[1].id }, ctx()), project);
});

// ---------------------------------------------------------------- day types

test('makeOwnCopy turns "same as A Day" into a copy of A Day\'s bells and every group\'s day', () => {
  let before = run(actions.addGroup, emptyProject(), { name: '7-1', id: 'gseven0001' });
  const [aDay, bDay] = before.dayTypes.map((d) => d.id);
  before = run(actions.setBell, before, { dayTypeId: aDay, period: 0, bell: { start: '08:00', end: '08:50' } });
  before = run(actions.setSlot, before, { groupId: 'gseven0001', dayTypeId: aDay, period: 0, slot: { roomText: '12' } });
  const after = run(actions.makeOwnCopy, before, { dayTypeId: bDay });
  assert.equal(after.dayTypes[1].own, true);
  assert.deepEqual(after.dayTypes[1].bells, after.dayTypes[0].bells);
  assert.notEqual(after.dayTypes[1].bells[0], after.dayTypes[0].bells[0]);
  assert.deepEqual(after.groups[0].days[bDay], after.groups[0].days[aDay]);
  assert.notEqual(after.groups[0].days[bDay][0], after.groups[0].days[aDay][0]);
  assert.equal(after.dayTypes[0], before.dayTypes[0]);
  assert.equal(info(actions.makeOwnCopy, before, { dayTypeId: bDay }, after).label, 'Make B Day its own copy');
  assert.equal(actions.makeOwnCopy(after, { dayTypeId: bDay }, ctx()), after);
  assert.equal(actions.makeOwnCopy(after, { dayTypeId: aDay }, ctx()), after);
});

test('revertToBase makes B Day the same as A Day again and removes its own bells and days', () => {
  const before = school();
  assert.deepEqual(actions.describeRevert(before, 'dsample00b'), { bells: 8, slots: 64, groups: 8, losesData: true });
  const after = run(actions.revertToBase, before, { dayTypeId: 'dsample00b' });
  assert.equal(after.dayTypes[1].own, false);
  assert.deepEqual(after.dayTypes[1].bells, [null, null, null, null, null, null, null, null]);
  for (const g of after.groups) assert.deepEqual(Object.keys(g.days), ['dsample00a']);
  assert.equal(effectiveSchedule(after, 'gsample06a', 'dsample00b'), group(after, '6A').days.dsample00a);
  assert.equal(group(after, '6A').days.dsample00a, group(before, '6A').days.dsample00a);
  assert.equal(info(actions.revertToBase, before, { dayTypeId: 'dsample00b' }, after).label, 'Make B Day the same as A Day');
  assert.equal(actions.revertToBase(after, { dayTypeId: 'dsample00b' }, ctx()), after);
  assert.deepEqual(actions.describeRevert(after, 'dsample00b'), { bells: 0, slots: 0, groups: 0, losesData: false });
});

test('revertToBase refuses the first day type', () => {
  refused(actions.revertToBase, school(), { dayTypeId: 'dsample00a' }, 'base');
});

test('setBell sets and clears one period\'s times', () => {
  const before = school();
  let after = run(actions.setBell, before, { dayTypeId: 'dsample00a', period: 3, bell: { start: '10:40', end: '11:30' } });
  assert.deepEqual(after.dayTypes[0].bells[3], { start: '10:40', end: '11:30' });
  assert.equal(after.dayTypes[0].bells[2], before.dayTypes[0].bells[2]);
  assert.equal(after.dayTypes[1], before.dayTypes[1]);
  after = run(actions.setBell, after, { dayTypeId: 'dsample00a', period: 3, bell: null });
  assert.equal(after.dayTypes[0].bells[3], null);
  assert.equal(actions.setBell(before, { dayTypeId: 'dsample00a', period: 0, bell: { start: '08:00', end: '08:48' } }, ctx()), before);
});

test('setBell allows an end before its start (the bell checks warn), and refuses what is not a time', () => {
  const after = run(actions.setBell, school(), { dayTypeId: 'dsample00a', period: 0, bell: { start: '09:00', end: '08:00' } });
  assert.deepEqual(after.dayTypes[0].bells[0], { start: '09:00', end: '08:00' });
  refused(actions.setBell, school(), { dayTypeId: 'dsample00a', period: 0, bell: { start: '8:00', end: '08:48' } }, 'bad-value');
  refused(actions.setBell, school(), { dayTypeId: 'dsample00a', period: 0, bell: { start: '08:00' } }, 'bad-value');
  refused(actions.setBell, school(), { dayTypeId: 'dsample00a', period: 9, bell: null }, 'bad-value');
  const empty = emptyProject();
  refused(actions.setBell, empty, { dayTypeId: empty.dayTypes[1].id, period: 0, bell: null }, 'same-as-base');
});

test('setBells sets a whole schedule and needs one entry per period', () => {
  const before = school();
  const bells = before.dayTypes[0].bells.map((bell, p) => (p === 7 ? null : { ...bell }));
  const after = run(actions.setBells, before, { dayTypeId: 'dsample00a', bells });
  assert.equal(after.dayTypes[0].bells[7], null);
  assert.equal(after.dayTypes[0].bells[0], before.dayTypes[0].bells[0], 'an unchanged entry is the same object');
  refused(actions.setBells, before, { dayTypeId: 'dsample00a', bells: bells.slice(0, 7) }, 'bad-value');
  assert.equal(actions.setBells(before, { dayTypeId: 'dsample00a', bells: clone(before.dayTypes[0].bells) }, ctx()), before);
});

test('renameDayType renames and keeps the id', () => {
  const after = run(actions.renameDayType, school(), { dayTypeId: 'dsample00b', name: 'Gold Day' });
  assert.deepEqual(after.dayTypes.map((d) => [d.id, d.name]), [['dsample00a', 'A Day'], ['dsample00b', 'Gold Day']]);
  refused(actions.renameDayType, school(), { dayTypeId: 'dsample00b', name: ' ' }, 'no-name');
});

// ---------------------------------------------------------------- floors

test('addFloor takes the size of the current floor, the next name, and its index plus one as level', () => {
  const before = school();
  const after = run(actions.addFloor, before, { likeFloorId: 'fsample002' });
  const added = after.building.floors[3];
  assert.match(added.id, /^f[a-z0-9]{9}$/);
  assert.deepEqual([added.name, added.level, added.width, added.height], ['Floor 4', 4, 40, 14]);
  assert.equal(added.cells, '.'.repeat(560));
  assert.equal(after.building.floors[0], before.building.floors[0]);
  assert.equal(info(actions.addFloor, before, {}, after).label, 'Add Floor 4');
});

test('addFloor on a new project makes a second 40 by 30 floor on level 2', () => {
  const after = run(actions.addFloor, emptyProject());
  assert.deepEqual(after.building.floors.map((f) => [f.name, f.level, f.width, f.height]), [['Floor 1', 1, 40, 30], ['Floor 2', 2, 40, 30]]);
});

test('addFloor copies the size of the floor it is told to, not the last one', () => {
  const project = emptyProject();
  project.building.floors[0].width = 60;
  project.building.floors[0].height = 20;
  project.building.floors[0].cells = '.'.repeat(1200);
  let after = run(actions.addFloor, project, { name: 'Annex' });
  after.building = { ...after.building, floors: after.building.floors.map((f, i) => (i === 1 ? { ...f, width: 10, height: 10, cells: '.'.repeat(100) } : f)) };
  after = run(actions.addFloor, after, { likeFloorId: project.building.floors[0].id });
  assert.deepEqual(after.building.floors.map((f) => [f.name, f.width, f.height]), [['Floor 1', 60, 20], ['Annex', 10, 10], ['Floor 3', 60, 20]]);
});

test('renameFloor keeps the id and everything on the floor', () => {
  const before = school();
  const after = run(actions.renameFloor, before, { id: 'fsample001', name: 'Ground <Floor>' });
  assert.equal(after.building.floors[0].name, 'Ground <Floor>');
  assert.equal(after.building.floors[0].spaces, before.building.floors[0].spaces);
  assert.deepEqual(info(actions.renameFloor, before, { id: 'fsample001', name: 'G' }, after).bumps, [BUILDING]);
});

test('reorderFloor changes the display order and no level, so no route changes', () => {
  const before = school();
  const after = run(actions.reorderFloor, before, { id: 'fsample003', toIndex: 0 });
  assert.deepEqual(after.building.floors.map((f) => [f.name, f.level]), [['Floor 3', 3], ['Floor 1', 1], ['Floor 2', 2]]);
  assert.equal(after.building.floors[0], before.building.floors[2], 'the floors themselves are the same objects');
  assert.equal(after.building.connections, before.building.connections);
  assert.deepEqual(info(actions.reorderFloor, before, { id: 'fsample003', toIndex: 0 }, after).bumps, [BUILDING], 'not geometry');
});

test('setFloorLevel changes the level and moves the geometry counter', () => {
  const before = school();
  const after = run(actions.setFloorLevel, before, { id: 'fsample001', level: -1 });
  assert.equal(after.building.floors[0].level, -1);
  assert.deepEqual(info(actions.setFloorLevel, before, { id: 'fsample001', level: -1 }, after).bumps, [GEOMETRY]);
  refused(actions.setFloorLevel, before, { id: 'fsample001', level: 1.5 }, 'bad-value');
});

test('deleteFloor refuses the last floor', () => {
  const project = emptyProject();
  refused(actions.deleteFloor, project, { id: project.building.floors[0].id }, 'last-floor');
  assert.throws(() => actions.deleteFloor(project, { id: project.building.floors[0].id }, ctx()), /Floor 1 is the only floor/);
});

test('deleteFloor removes the stair connections that touch the floor, and only those', () => {
  const before = school();
  assert.deepEqual(actions.describeFloorDelete(before, 'fsample003'), { name: 'Floor 3', last: false, rooms: 3, otherSpaces: 3, connections: 1, zones: 0, exits: 0, slots: 28 });
  const after = run(actions.deleteFloor, before, { id: 'fsample003' });
  assert.deepEqual(after.building.floors.map((f) => f.name), ['Floor 1', 'Floor 2']);
  assert.deepEqual(after.building.connections.map((c) => c.label), ['A'], 'B touched Floor 3; A keeps its letter');
  assert.equal(after.building.connections[0], before.building.connections[0]);
  assert.equal(after.building.floors[0], before.building.floors[0]);
});

test('deleteFloor from the middle removes both connections and the floor\'s zones', () => {
  const before = school();
  before.building.zones.push({ id: 'zsample002', floorId: 'fsample002', label: 'Library doors', x: 29, y: 7, w: 4, h: 1 });
  const after = run(actions.deleteFloor, before, { id: 'fsample002' });
  assert.deepEqual(after.building.connections, []);
  assert.deepEqual(after.building.zones.map((z) => z.id), ['zsample001']);
});

test('deleteFloor leaves the schedule slots in its rooms flagged with the room number, not blanked', () => {
  const before = school();
  const after = run(actions.deleteFloor, before, { id: 'fsample003' });
  const was = group(before, '8A').days.dsample00a;
  const now = group(after, '8A').days.dsample00a;
  assert.equal(was[6].room, 'rsample303');
  assert.deepEqual([now[6].room, now[6].roomText], [null, '303']);
  assert.deepEqual([now[7].room, now[7].roomText], [null, '302']);
  assert.equal(now[0], was[0], 'a slot in a room on another floor is the same object');
  let flagged = 0;
  for (const g of after.groups) for (const day of Object.values(g.days)) flagged += day.filter((slot) => slot.room === null && ['301', '302', '303'].includes(slot.roomText)).length;
  assert.equal(flagged, 28, '13 on A Days and 15 on B Days');
  assert.deepEqual(after.teachers.filter((t) => t.roomIds.length === 0).map((t) => t.name), ['Ms. Thistlewood', 'Mr. Larkspur', 'Ms. O\'Fennimore']);
  assert.deepEqual(info(actions.deleteFloor, before, { id: 'fsample003' }, after).bumps, [GEOMETRY, SCHEDULE]);
});

test('detachRooms keeps an unnumbered room\'s slots too, under a plain name', () => {
  let project = school();
  project.building.floors[0].spaces[0].number = '';
  const after = actions.detachRooms(project, [project.building.floors[0].spaces[0]]);
  let kept = 0;
  for (const g of after.groups) for (const day of Object.values(g.days)) kept += day.filter((slot) => slot.roomText === actions.UNNUMBERED_ROOM_TEXT).length;
  assert.equal(kept, 5);
});

// ---------------------------------------------------------------- findings, replace

test('acceptFinding records the reason, the time from the clock and who the finding is about, once per finding', () => {
  let project = run(actions.acceptFinding, school(), { findingId: 'room-double:dsample00a:1:rsample203', reason: 'Team taught' });
  // SV2-36 item 2: with no list handed over, `about` is the two groups the finding names now
  assert.deepEqual(project.accepted, [{ findingId: 'room-double:dsample00a:1:rsample203', reason: 'Team taught', at: PINNED, about: ['gsample06c', 'gsample07c'] }]);
  // a list handed over is kept, sorted, and the caller's own list is left alone
  const handed = ['gsample07c', 'gsample06c', 'gsample06a'];
  assert.deepEqual(run(actions.acceptFinding, school(), { findingId: 'room-double:dsample00a:1:rsample203', reason: 'x', about: handed }).accepted[0].about, ['gsample06a', 'gsample06c', 'gsample07c']);
  assert.deepEqual(handed, ['gsample07c', 'gsample06c', 'gsample06a']);
  // a finding the checks do not make now is about nobody that is known
  assert.deepEqual(run(actions.acceptFinding, school(), { findingId: 'group-walk:dsample00a:5:gsample08a', reason: 'x' }).accepted[0].about, []);
  for (const bad of ['gsample06c', [7], null]) refused(actions.acceptFinding, school(), { findingId: 'room-double:dsample00a:1:rsample203', reason: 'x', about: bad }, 'bad-value');
  project = run(actions.acceptFinding, project, { findingId: 'room-double:dsample00a:1:rsample203', reason: 'Both teachers present' });
  assert.equal(project.accepted.length, 1);
  assert.equal(project.accepted[0].reason, 'Both teachers present');
  project = run(actions.unacceptFinding, project, { findingId: 'room-double:dsample00a:1:rsample203' });
  assert.deepEqual(project.accepted, []);
  assert.equal(actions.unacceptFinding(project, { findingId: 'nothing' }, ctx()), project);
});

test('replaceProject puts another project in place, under the label it is given', () => {
  const before = emptyProject();
  const sample = school();
  const after = run(actions.replaceProject, before, { project: sample, label: 'Load the sample school' });
  assert.equal(after, sample);
  assert.equal(info(actions.replaceProject, before, { project: sample, label: 'Load the sample school' }, after).label, 'Load the sample school');
  refused(actions.replaceProject, before, {}, 'bad-value');
});

// ---------------------------------------------------------------- structural sharing

test('structural sharing: a floor nobody touched is the same object after a group action', () => {
  const before = school();
  const steps = [
    [actions.addGroup, { name: '8C' }],
    [actions.editGroup, { id: 'gsample06a', name: 'Six A' }],
    [actions.setSlot, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: 'rsample302' } }],
    [actions.moveSlot, { groupId: 'gsample06a', dayTypeId: 'dsample00a', from: 0, to: 1 }],
    [actions.copyDay, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00b', groupId: 'gsample06a' }],
    [actions.duplicateGroup, { id: 'gsample06b' }],
    [actions.deleteGroup, { id: 'gsample07a' }],
  ];
  let project = before;
  for (const [action, payload] of steps) {
    project = run(action, project, payload);
    assert.equal(project.building, before.building, 'the building');
    for (let f = 0; f < 3; f += 1) assert.equal(project.building.floors[f], before.building.floors[f], 'floor ' + f);
    assert.equal(project.teachers, before.teachers, 'the teachers');
    assert.equal(project.subjects, before.subjects, 'the subjects');
    assert.equal(project.settings, before.settings, 'the settings');
  }
  assert.equal(group(project, '8B'), group(before, '8B'), 'and a group nobody touched');
});

test('structural sharing: a teacher edit on Floor 1 leaves Floors 2 and 3 and every group as they were', () => {
  const before = school();
  const after = run(actions.setRoomTeachers, before, { roomId: 'rsample101', teacherIds: [] });
  assert.notEqual(after.building.floors[0], before.building.floors[0]);
  assert.equal(after.building.floors[1], before.building.floors[1]);
  assert.equal(after.building.floors[2], before.building.floors[2]);
  assert.equal(after.building.floors[0].cells, before.building.floors[0].cells);
  assert.equal(after.building.floors[0].spaces[1], before.building.floors[0].spaces[1]);
  assert.equal(after.groups, before.groups);
});

test('no action writes to the project it is given', () => {
  // every run() above freezes the old state first; this one walks a long chain
  let project = school();
  const original = JSON.stringify(project);
  const first = project;
  project = run(actions.setPeriods, project, { periods: 5 });
  project = run(actions.deleteSubject, project, { id: 'ssample003' });
  project = run(actions.mergeTeachers, project, { keepId: 'tsample001', mergeId: 'tsample002' });
  project = run(actions.revertToBase, project, { dayTypeId: 'dsample00b' });
  project = run(actions.makeOwnCopy, project, { dayTypeId: 'dsample00b' });
  project = run(actions.deleteFloor, project, { id: 'fsample001' });
  project = run(actions.resetSettings, project);
  assert.equal(JSON.stringify(first), original);
  assert.deepEqual(validate(project), []);
});

// ---------------------------------------------------------------- SV2-35: what the review of the first unit found

test('addFloor after a middle floor was deleted gives a level no floor has: one above the highest', () => {
  let project = run(actions.deleteFloor, school(), { id: 'fsample002' });
  assert.deepEqual(project.building.floors.map((f) => f.level), [1, 3]);
  project = run(actions.addFloor, project);
  assert.deepEqual(project.building.floors.map((f) => f.level), [1, 3, 4], 'two floors on level 3 would make the stairs between them cost one flight');
  assert.equal(new Set(project.building.floors.map((f) => f.level)).size, 3);
});

test('addFloor counts up from the highest level, wherever that floor is in the order, and from a basement', () => {
  let project = run(actions.reorderFloor, school(), { id: 'fsample003', toIndex: 0 });
  project = run(actions.addFloor, project);
  assert.equal(project.building.floors[3].level, 4);
  let low = run(actions.setFloorLevel, emptyProject(), { id: emptyProject().building.floors[0].id, level: -2 });
  low = run(actions.addFloor, low);
  assert.deepEqual(low.building.floors.map((f) => f.level), [-2, -1]);
});

const ADDS = [
  ['addSubject', { code: 'DRA', name: 'Drama' }, 'id', 'ssample001', 'sdrama0001'],
  ['addTeacher', { name: 'Mx. Oakhollow' }, 'id', 'tsample001', 'toakhollow'],
  ['addGroup', { name: '8C' }, 'id', 'gsample06a', 'gsample08c'],
  ['duplicateGroup', { id: 'gsample06a' }, 'newId', 'gsample06b', 'gsample06z'],
  ['addFloor', {}, 'id', 'fsample001', 'fsample004'],
  ['placeRoom', { floorId: 'fsample003', rect: { x: 1, y: 9, w: 3, h: 3 } }, 'id', 'rsample101', 'rsample399'],
  ['placeOtherSpace', { floorId: 'fsample003', rect: { x: 1, y: 9, w: 3, h: 3 }, label: 'Store' }, 'id', 'osample001', 'osample399'],
  ['connectStairs', { a: { floorId: 'fsample001', cell: 332 }, b: { floorId: 'fsample003', cell: 353 } }, 'id', 'csample00a', 'csample00c'],
  ['nameCorridor', { floorId: 'fsample003', cells: [7 * 40 + 2, 7 * 40 + 3], name: 'Music Wing Hall' }, 'id', 'ksample001', 'ksample399'],
  ['markExit', { floorId: 'fsample002', cell: 7 * 40 + 38, doorName: 'Door C' }, 'id', 'xsample00a', 'xsample00c'],
  ['addZone', { floorId: 'fsample002', x: 1, y: 7, w: 2, h: 1 }, 'id', 'zsample001', 'zsample002'],
];

for (const [name, payload, key, taken, free] of ADDS) {
  test(name + ' refuses an id the project already uses, and an id of another kind\'s, and takes a free one', () => {
    const project = school();
    if (name === 'nameCorridor') project.building.floors[2].corridors = [];
    refused(actions[name], project, { ...payload, [key]: taken }, 'duplicate-id');
    refused(actions[name], project, { ...payload, [key]: 'psample001' }, 'bad-id');
    refused(actions[name], project, { ...payload, [key]: 'Not An Id' }, 'bad-id');
    const after = run(actions[name], project, { ...payload, [key]: free });
    assert.ok(JSON.stringify(after).includes('"' + free + '"'), 'the id given is the id used');
  });
}

test('an id used anywhere in the project is refused, whatever kind of thing has it', () => {
  // the project's own id has the right letter for nothing else; a traced image's id is found too
  const project = school();
  project.building.floors[0].image = { imageId: 'gsample999', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 10, height: 10, missing: false };
  refused(actions.addGroup, project, { name: '8C', id: 'gsample999' }, 'duplicate-id');
});

test('setSetting refuses to switch off a check that is not one of the checks', () => {
  refused(actions.setSetting, school(), { key: 'checks.off', value: ['room-unused', 'room-on-fire'] }, 'bad-value');
  const after = run(actions.setSetting, school(), { key: 'checks.off', value: ['room-unused', 'empty-period'] });
  assert.deepEqual(after.settings.checks.off, ['room-unused', 'empty-period']);
});

test('setConnection refuses a label another stair connection has, and takes its own again', () => {
  refused(actions.setConnection, school(), { connectionId: 'csample00b', label: 'A' }, 'duplicate-label');
  assert.equal(actions.setConnection(school(), { connectionId: 'csample00b', label: 'B', direction: 'ab' }, ctx()).building.connections[1].direction, 'ab');
  assert.equal(run(actions.setConnection, school(), { connectionId: 'csample00b', label: 'East stairs' }).building.connections[1].label, 'East stairs');
});

test('setOnboarding and notePublished are quiet actions, and no other action is', () => {
  assert.equal(actions.setOnboarding.quiet, true);
  assert.equal(actions.notePublished.quiet, true);
  for (const [name, value] of Object.entries(actions)) {
    if (typeof value === 'function' && 'label' in value && name !== 'setOnboarding' && name !== 'notePublished') assert.equal(value.quiet, false, name);
  }
  // when a file was published: the time is kept, and only a date is taken
  const before = school();
  const after = actions.notePublished(before, { at: '2026-09-01T12:00:00.000Z' }, ctx());
  assert.equal(after.publish.lastPublishedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(before.publish.lastPublishedAt, null);
  assert.throws(() => actions.notePublished(before, { at: 'last Tuesday' }, ctx()), /The last published time is a date\./);
});

test('describeAction carries what a building action and an import reported, and null for the rest', () => {
  const before = school();
  const placed = actions.placeRoom(before, { floorId: 'fsample003', rect: { x: 1, y: 9, w: 3, h: 3 } }, ctx());
  const told = info(actions.placeRoom, before, {}, placed);
  assert.equal(told.outcome, actions.buildingOutcome(placed));
  assert.match(told.outcome.spaceId, /^r[a-z0-9]{9}$/);
  const renamed = actions.renameFloor(before, { id: 'fsample001', name: 'Ground' }, ctx());
  assert.equal(info(actions.renameFloor, before, { id: 'fsample001', name: 'Ground' }, renamed).outcome, null);
});

// ---------------------------------------------------------------- SV2-35: how a room is named

test('roomName: a number that starts with a digit reads "Room 204", in any script', () => {
  assert.equal(roomName({ number: '204' }, true), 'Room 204');
  assert.equal(roomName({ number: '12B' }, false), 'Room 12B');
  assert.equal(roomName({ number: '٢٠٤' }, false), 'Room ٢٠٤', 'Arabic-Indic digits');
  assert.equal(roomName({ number: '२०४' }, false), 'Room २०४', 'Devanagari digits');
});

test('roomName: one or two letters and then a digit is a number too: "B12", "A-7", "LL3"', () => {
  assert.equal(roomName({ number: 'B12' }, false), 'Room B12');
  assert.equal(roomName({ number: 'A-7' }, false), 'Room A-7');
  assert.equal(roomName({ number: 'LL3' }, true), 'Room LL3');
  assert.equal(roomName({ number: 'Б12' }, true), 'Room Б12', 'a Cyrillic letter');
});

test('roomName: a number that is a word is given as typed, with or without a digit after it', () => {
  assert.equal(roomName({ number: 'Gym' }, true), 'Gym');
  assert.equal(roomName({ number: 'Gym 2' }, false), 'Gym 2', 'this used to read "Room Gym 2"');
  assert.equal(roomName({ number: 'Library' }, false), 'Library');
  assert.equal(roomName({ number: 'Lab3' }, false), 'Lab3', 'three letters is a word');
  assert.equal(roomName({ number: ' <i>Lab</i> ' }, false), ' <i>Lab</i> ');
});

// One rule does this, not a second one: "Room 204" starts with four letters,
// so it is a word. Breaking the rule in schema.js fails this case with the others.
test('roomName: a number that already starts with "room" never gets a second one', () => {
  assert.equal(roomName({ number: 'Room 204' }, true), 'Room 204');
  assert.equal(roomName({ number: 'room 204' }, false), 'room 204');
  assert.equal(roomName({ number: ' ROOM204' }, false), ' ROOM204');
});

test('roomName: a room with no number says so, and findings.js hands on schema.js\'s very function', () => {
  assert.equal(roomName({ number: '' }, true), 'A room with no number');
  assert.equal(roomName({ number: '  ' }, false), 'a room with no number');
  assert.equal(roomName(null, false), 'a room with no number');
  assert.equal(roomName, nameOfRoom, 'findings.js roomName is schema.js nameOfRoom, not a second rule');
});

test('the building\'s labels name a room the way sentences do: "Delete Gym", "Edit Room 101", never "Room Gym"', () => {
  const project = school();
  const gym = room(project, 'Gym');
  const deleted = actions.deleteSpaces(project, { spaceIds: [gym.id] }, ctx());
  assert.equal(info(actions.deleteSpaces, project, { spaceIds: [gym.id] }, deleted).label, 'Delete Gym');
  const edited = actions.setRoomFields(project, { roomId: 'rsample101', wing: 'North' }, ctx());
  assert.equal(info(actions.setRoomFields, project, { roomId: 'rsample101', wing: 'North' }, edited).label, 'Edit Room 101');
  const renumbered = actions.setRoomFields(project, { roomId: 'rsample101', number: 'Room 101' }, ctx());
  assert.equal(info(actions.addDoor, renumbered, { roomId: 'rsample101' }, renumbered).label, 'Add a door to Room 101', 'not "Room Room 101"');
  assert.equal(info(actions.setRoomTeachers, project, { roomId: gym.id }, project).label, 'Change the teachers of Gym');
  assert.equal(info(actions.setRoomTeachers, project, { roomId: 'rsample101' }, project).label, 'Change the teachers of Room 101');
});

test('a room number in use is refused in a sentence that names the room as it is: "a room called Gym", "a Room 101"', () => {
  assert.throws(() => actions.setRoomFields(school(), { roomId: 'rsample101', number: ' gym ' }, ctx()), /^ActionError: There is already a room called Gym, on Floor 1\. /);
  assert.throws(() => actions.setRoomFields(school(), { roomId: 'rsample102', number: '101' }, ctx()), /^ActionError: There is already a Room 101, on Floor 1\. /);
});

test('what a placement would replace is named the same way', () => {
  const project = school();
  const gym = room(project, 'Gym');
  const described = actions.describeSpaceDelete(project, { spaceIds: [gym.id, 'rsample101'] });
  assert.deepEqual(described.loss.spaces.map((space) => space.name), ['Room 101', 'Gym']);
});

// ---------------------------------------------------------------- SV2-08: the traced image

const TRACED = { imageId: 'itraced001', width: 800, height: 600 };

function traced(project) {
  return run(actions.setTraceImage, project, { floorId: project.building.floors[0].id, image: { ...TRACED, scale: 0.05, x: 2, y: 1 } });
}

test('setTraceImage sets an image on a floor with defaults', () => {
  const before = emptyProject();
  const after = traced(before);
  assert.deepEqual(after.building.floors[0].image, { imageId: 'itraced001', opacity: actions.DEFAULT_TRACE_OPACITY, scale: 0.05, rotation: 0, x: 2, y: 1, visible: true, locked: false, width: 800, height: 600, missing: false });
  assert.equal(actions.DEFAULT_TRACE_OPACITY, 0.4);
  assert.equal(before.building.floors[0].image, null, 'the project it was given is untouched');
  assert.equal(after.subjects, before.subjects, 'what it did not change is the same object');
  assert.deepEqual(actions.setTraceImage.bumps, [BUILDING], 'an image changes no route and no schedule');
  assert.equal(info(actions.setTraceImage, before, { floorId: before.building.floors[0].id, image: TRACED }, after).label, 'Trace over an image on Floor 1');
});

test('setTraceImage adjusts one field keeping the rest', () => {
  const before = traced(emptyProject());
  const floorId = before.building.floors[0].id;
  const after = run(actions.setTraceImage, before, { floorId, image: { rotation: -12.5 } });
  assert.deepEqual(after.building.floors[0].image, { ...before.building.floors[0].image, rotation: -12.5 });
  assert.equal(info(actions.setTraceImage, before, { floorId, image: { rotation: -12.5 } }, after).label, 'Adjust the traced image on Floor 1');
});

test('setTraceImage removes it, and only that floor changes', () => {
  const start = school();
  const [first, second] = start.building.floors;
  const before = run(actions.setTraceImage, start, { floorId: second.id, image: { ...TRACED, scale: 0.05 } });
  const after = run(actions.setTraceImage, before, { floorId: second.id, image: null });
  assert.equal(after.building.floors[1].image, null);
  assert.equal(after.building.floors[0], first, 'another floor is the same object');
  assert.equal(info(actions.setTraceImage, before, { floorId: second.id, image: null }, after).label, 'Remove the traced image from ' + second.name);
});

test('setTraceImage refuses a floor that is gone', () => {
  refused(actions.setTraceImage, traced(emptyProject()), { floorId: 'fnotafloor', image: null }, 'missing');
  refused(actions.setTraceImage, emptyProject(), { floorId: 'fnotafloor', image: TRACED }, 'missing');
});

test('setTraceImage refuses opacity out of range', () => {
  const before = traced(emptyProject());
  const floorId = before.building.floors[0].id;
  for (const opacity of [1.5, -0.1, NaN, '0.5']) refused(actions.setTraceImage, before, { floorId, image: { opacity } }, 'bad-value');
  assert.throws(() => actions.setTraceImage(before, { floorId, image: { opacity: 1.5 } }, ctx()), /Opacity is from 0% to 100%\./);
  for (const opacity of [0, 1]) assert.equal(run(actions.setTraceImage, before, { floorId, image: { opacity } }).building.floors[0].image.opacity, opacity);
});

test('setTraceImage: a no-op returns the same project', () => {
  const before = traced(emptyProject());
  const floorId = before.building.floors[0].id;
  assert.equal(actions.setTraceImage(before, { floorId, image: { opacity: actions.DEFAULT_TRACE_OPACITY, visible: true, x: 2 } }, ctx()), before);
  assert.equal(actions.setTraceImage(before, { floorId, image: {} }, ctx()), before);
  const none = emptyProject();
  assert.equal(actions.setTraceImage(none, { floorId: none.building.floors[0].id, image: null }, ctx()), none);
});

test('setTraceImage is one undo entry in the store, and undo takes the image off again', () => {
  const store = createStore({ project: emptyProject(), clock, ids: makeIds(3) });
  const floorId = store.project.building.floors[0].id;
  store.apply(actions.setTraceImage, { floorId, image: { ...TRACED, scale: 0.05 } });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Trace over an image on Floor 1');
  store.undo();
  assert.equal(store.project.building.floors[0].image, null);
  assert.equal(store.history.past.length, 0);
});

// ---------------------------------------------------------------- SV2-73a: Cell scale and scaling the traced image

test('Cell scale is not set in a new project, is set and cleared as one setting, and the same value changes nothing', () => {
  assert.equal(defaultSettings().cellScale, undefined, 'a new project has no Cell scale: it is a wish brought forward only as far as the scaling tool');
  const set = run(actions.setSetting, school(), { key: 'cellScale', value: { unit: 'metres', length: 1.5 } });
  assert.deepEqual(set.settings.cellScale, { unit: 'metres', length: 1.5 });
  assert.equal(actions.setSetting(set, { key: 'cellScale', value: { unit: 'metres', length: 1.5 } }, ctx()), set, 'the same unit and length is no change');
  const cleared = run(actions.setSetting, set, { key: 'cellScale', value: null });
  assert.equal(cleared.settings.cellScale, null);
  assert.equal(info(actions.setSetting, set, { key: 'cellScale', value: null }, cleared).label, 'Change the cell scale');
  assert.deepEqual(info(actions.setSetting, set, { key: 'cellScale', value: null }, cleared).bumps, [], 'nothing reads it for a route or a load yet');
  const given = { unit: 'feet', length: 5 };
  const kept = run(actions.setSetting, school(), { key: 'cellScale', value: given });
  given.length = 9;
  assert.equal(kept.settings.cellScale.length, 5, 'the project keeps a copy, not the caller\'s object');
});

test('Cell scale refuses a length of nothing, a negative, too long, a non-number and an unknown unit, with a sentence', () => {
  for (const value of [{ unit: 'feet', length: 0 }, { unit: 'feet', length: -2 }, { unit: 'metres', length: 1001 }, { unit: 'feet', length: Number.NaN }, { unit: 'feet', length: '5' }, { unit: 'yards', length: 3 }, { unit: 'feet' }, { unit: 'feet', length: 5, extra: true }, 5, 'five', []]) {
    refused(actions.setSetting, school(), { key: 'cellScale', value }, 'bad-value');
  }
  assert.throws(() => actions.setSetting(school(), { key: 'cellScale', value: { unit: 'feet', length: 0 } }, ctx()), /One cell is a length above 0 and at most 1000, in feet or metres, or the cell scale is not set\.$/);
});

test('scaleTraceImage sets the scale and the corner in one step, leaving the rest of the image as it was', () => {
  const start = traced(emptyProject());
  const floorId = start.building.floors[0].id;
  const after = run(actions.scaleTraceImage, start, { floorId, image: { scale: 0.02, x: -1.5, y: 3.25 } });
  assert.deepEqual(after.building.floors[0].image, { ...start.building.floors[0].image, scale: 0.02, x: -1.5, y: 3.25 });
  assert.equal(after.settings, start.settings, 'no Cell scale given: the settings are the same object');
  assert.equal(info(actions.scaleTraceImage, start, { floorId }, after).label, 'Scale the traced image on Floor 1');
  assert.deepEqual(actions.scaleTraceImage.bumps, [BUILDING]);
  const store = createStore({ project: start, clock, ids: makeIds() });
  store.apply(actions.scaleTraceImage, { floorId, image: { scale: 0.02, x: -1.5, y: 3.25 }, cellScale: { unit: 'feet', length: 4 } });
  assert.equal(store.history.past.length, 1, 'the image and the Cell scale are one undo step');
  assert.deepEqual(store.project.settings.cellScale, { unit: 'feet', length: 4 });
  store.undo();
  assert.equal(store.project.settings.cellScale, undefined);
  assert.equal(store.project.building.floors[0].image.scale, 0.05);
});

test('scaleTraceImage refuses a locked image, a floor with none, a bad scale and a bad Cell scale, each with its reason', () => {
  const start = traced(emptyProject());
  const floorId = start.building.floors[0].id;
  const locked = run(actions.setTraceImage, start, { floorId, image: { locked: true } });
  refused(actions.scaleTraceImage, locked, { floorId, image: { scale: 0.02, x: 0, y: 0 } }, 'locked');
  assert.throws(() => actions.scaleTraceImage(locked, { floorId, image: { scale: 0.02, x: 0, y: 0 } }, ctx()), /locked, so it cannot be scaled\. Untick "Lock the image" on the Floor tab first\./);
  refused(actions.scaleTraceImage, emptyProject(), { floorId: emptyProject().building.floors[0].id, image: { scale: 0.02, x: 0, y: 0 } }, 'missing');
  refused(actions.scaleTraceImage, start, { floorId: 'fnothing00', image: { scale: 0.02, x: 0, y: 0 } }, 'missing');
  refused(actions.scaleTraceImage, start, { floorId, image: { scale: 0, x: 0, y: 0 } }, 'bad-value');
  refused(actions.scaleTraceImage, start, { floorId, image: { scale: 0.02, x: Number.NaN, y: 0 } }, 'bad-value');
  refused(actions.scaleTraceImage, start, { floorId }, 'bad-value');
  refused(actions.scaleTraceImage, start, { floorId, image: { scale: 0.02, x: 0, y: 0 }, cellScale: { unit: 'feet', length: -1 } }, 'bad-value');
  refused(actions.scaleTraceImage, start, { floorId, image: { scale: 0.02, x: 0, y: 0 }, cellScale: null }, 'bad-value');
});

// ================================================================ SV2-75: day types, bell schedules, the calendar

import { withEverything, A, B, C, D, ER, AS } from '../fixtures/day-types-calendar.mjs';
import { describeDayType, followersOf } from '../../engine/day-types.js';
import { bellsFor } from '../../engine/bells.js';
import { dayOn, calendarDays } from '../../engine/calendar.js';
import { tickingClock } from './helpers.mjs';

// The store, so each action is checked as the page runs it: one undo step,
// its label and focus, SCHEDULE moved, and undo putting back the very state.
function step(project, action, payload, options) {
  const store = createStore({ project: freeze(project), clock: (options && options.clock) || clock, ids: makeIds(11) });
  const schedule = store.scheduleVersion;
  store.apply(action, payload);
  assertValid(store.project, 'valid after ' + store.undoLabel);
  assert.equal(store.history.past.length, 1, 'one undo step');
  assert.equal(store.scheduleVersion, schedule + 1, 'SCHEDULE moves');
  const entry = store.history.past[0];
  const after = store.project;
  store.undo();
  // undo stamps `modified` from the store's clock as every change does
  assert.deepEqual({ ...store.project, modified: project.modified }, project, 'undo brings back what was');
  return { after, label: entry.label, focus: entry.focus, outcome: entry.outcome };
}

test('every new action bumps SCHEDULE, and only that', () => {
  for (const name of ['addDayType', 'deleteDayType', 'reorderDayType', 'setDayTypeKind', 'setDayTypeShort', 'renameDayType', 'copyDay', 'makeOwnCopy', 'revertToBase', 'addBellSchedule', 'setBellSchedule', 'deleteBellSchedule', 'reorderBellSchedule', 'makeCalendar', 'setCalendarRange', 'setCalendarWeekday', 'setCalendarRotation', 'setCalendarDates', 'removeCalendar']) {
    assert.deepEqual(actions[name].bumps, [SCHEDULE], name);
  }
});

// ---------------------------------------------------------------- day types

test('addDayType: the same as A Day by default, at the end, one step', () => {
  const { after, label, focus } = step(school(), actions.addDayType, { name: 'C Day' });
  const added = after.dayTypes[2];
  assert.deepEqual({ ...added, id: '' }, { id: '', name: 'C Day', own: false, sameAs: null, short: '', bells: Array(8).fill(null) });
  assert.equal(label, 'Add day type C Day');
  assert.deepEqual(focus, { section: 'schedule', tab: 'day', dayTypeId: added.id });
  assert.deepEqual(describeDayType(after, added.id).follows, 'A Day');
});

test('addDayType: the same as B Day, or its own classes as a copy of B Day', () => {
  const same = run(actions.addDayType, school(), { name: 'C Day', sameAs: B });
  assert.equal(same.dayTypes[2].sameAs, B);
  // naming the first day type is kept as null: one way to say it
  assert.equal(run(actions.addDayType, school(), { name: 'C Day', sameAs: A }).dayTypes[2].sameAs, null);
  const own = run(actions.addDayType, school(), { name: 'Testing Day', own: true, copyOf: B, short: 'T' });
  const id = own.dayTypes[2].id;
  assert.deepEqual([own.dayTypes[2].own, own.dayTypes[2].short], [true, 'T']);
  assert.deepEqual(own.dayTypes[2].bells, own.dayTypes[1].bells);
  for (const g of own.groups) assert.deepEqual(g.days[id], g.days[B], g.name);
  // a copy of a day type that is the same as another is a copy of that one
  const fromC = run(actions.addDayType, withEverything(), { name: 'E Day', own: true, copyOf: C });
  for (const g of fromC.groups) assert.deepEqual(g.days[fromC.dayTypes[4].id], g.days[B], g.name);
});

test('addDayType refuses a blank, long or taken name, a taken short, the same as a follower, and a thirteenth', () => {
  const project = withEverything();
  for (const [payload, code] of [[{ name: ' ' }, 'no-name'], [{ name: 'x'.repeat(41) }, 'too-long'], [{ name: 'cday' }, 'duplicate-name'], [{ name: 'E', short: 'c' }, 'duplicate-short'], [{ name: 'E', short: 'EEEEE' }, 'too-long'], [{ name: 'E', sameAs: D }, 'not-own'], [{ name: 'E', sameAs: 'dnowhere00' }, 'missing']]) {
    assert.throws(() => actions.addDayType(project, payload, shared), { name: 'ActionError', code }, JSON.stringify(payload));
  }
  assert.throws(() => actions.addDayType(project, { name: 'E', sameAs: D }, shared), { message: 'D Day is the same as A Day, so nothing can be the same as it. Choose a day type with its own classes.' });
});

test('deleteDayType: its days and bells go, its followers follow A Day, and the outcome says what went', () => {
  const project = withEverything();
  project.scenario = { name: 'Trial', changes: [{ kind: 'move', dayTypeId: B, groupId: 'gsample06a', period: 0, roomId: 'rsample302' }, { kind: 'move', dayTypeId: A, groupId: 'gsample06a', period: 0, roomId: 'rsample302' }], compared: null };
  project.calendar.weekdays[4] = { day: B, bells: null };
  const { after, label, outcome } = step(project, actions.deleteDayType, { dayTypeId: B }, { clock: tickingClock() });
  assert.equal(label, 'Delete day type B Day');
  assert.deepEqual(after.dayTypes.map((d) => d.id), [A, C, D]);
  assert.ok(after.groups.every((g) => !(B in g.days)));
  assert.equal(after.dayTypes[1].sameAs, null);
  assert.equal(describeDayType(after, C).follows, 'A Day');
  assert.deepEqual(after.scenario.changes.map((change) => change.dayTypeId), [A]);
  assert.deepEqual(after.calendar.rotation, [A]);
  assert.equal(after.calendar.weekdays[4].day, 'rotation');
  assert.equal(after.calendar.dates.some((entry) => entry.day === B), false);
  assert.equal(after.calendar.changedAt, '2026-09-01T12:00:01.000Z');
  assert.equal(outcome.text, 'Deleted B Day, its classes for 8 groups, its bells, 1 date in the calendar, Fridays in the calendar, its place in the rotation and 1 change in the scenario. C Day is now the same as A Day');
  assert.deepEqual([outcome.groups, outcome.dates, outcome.weekdays, outcome.rotation, outcome.scenarioChanges, outcome.followers], [8, 1, [4], 1, 1, ['C Day']]);
  // a day type that is the same as another takes nothing with it
  assert.equal(step(project, actions.deleteDayType, { dayTypeId: D }).outcome.text, 'Deleted D Day');
});

test('deleteDayType refuses the first day type', () => {
  assert.throws(() => actions.deleteDayType(school(), { dayTypeId: A }, shared), { code: 'base', message: 'A Day comes first and cannot be deleted. Every other day type can be the same as it.' });
  assert.throws(() => actions.deleteDayType(school(), { dayTypeId: 'dnowhere00' }, shared), { code: 'missing' });
});

test('reorderDayType: the others move, and never before the first', () => {
  const project = withEverything();
  assert.deepEqual(run(actions.reorderDayType, project, { dayTypeId: D, toIndex: 1 }).dayTypes.map((d) => d.id), [A, D, B, C]);
  assert.deepEqual(run(actions.reorderDayType, project, { dayTypeId: D, toIndex: 0 }).dayTypes.map((d) => d.id), [A, D, B, C]);
  assert.equal(actions.reorderDayType(project, { dayTypeId: D, toIndex: 3 }, shared), project);
  assert.throws(() => actions.reorderDayType(project, { dayTypeId: A, toIndex: 2 }, shared), { code: 'base' });
  assert.equal(step(project, actions.reorderDayType, { dayTypeId: B, toIndex: 3 }).label, 'Move B Day in the list of day types');
});

test('setDayTypeKind to the same as another: its days and bells go and its followers move with it; the outcome counts them', () => {
  const project = withEverything();
  const { after, label, outcome } = step(project, actions.setDayTypeKind, { dayTypeId: B, own: false, sameAs: A });
  assert.equal(label, 'Make B Day the same as A Day');
  assert.deepEqual([after.dayTypes[1].own, after.dayTypes[1].sameAs], [false, null]);
  assert.ok(after.dayTypes[1].bells.every((bell) => bell === null));
  assert.equal(after.dayTypes[2].sameAs, null);
  assert.deepEqual(outcome, { from: null, to: 'A Day', slots: 64, groups: 8, bells: 8, followers: ['C Day'], scenarioChanges: 0, losesData: true });
  assert.deepEqual(actions.describeDayTypeKind(project, { dayTypeId: B, own: false }), outcome);
  // to its own classes: a copy of what it was the same as
  const own = step(project, actions.setDayTypeKind, { dayTypeId: C, own: true });
  assert.equal(own.label, 'Make C Day its own copy');
  assert.deepEqual(own.outcome.from, 'B Day');
  for (const g of own.after.groups) assert.deepEqual(g.days[C], g.days[B], g.name);
  // a follower made the same as another own day type
  const moved = run(actions.setDayTypeKind, project, { dayTypeId: D, own: false, sameAs: B });
  assert.equal(moved.dayTypes[3].sameAs, B);
  assert.equal(actions.setDayTypeKind(project, { dayTypeId: D, own: false, sameAs: null }, shared), project);
  assert.equal(actions.setDayTypeKind(project, { dayTypeId: B, own: true }, shared), project);
});

test('setDayTypeKind and revertToBase from own to same take the scenario\'s changes on that day type with its days, and count them, as deleteDayType does (SV2-75b)', () => {
  const project = withEverything();
  project.scenario = { name: 'Trial', changes: [{ kind: 'move', dayTypeId: B, groupId: 'gsample06a', period: 0, roomId: 'rsample302' }, { kind: 'move', dayTypeId: A, groupId: 'gsample06a', period: 0, roomId: 'rsample302' }], compared: null };
  const described = actions.describeDayTypeKind(project, { dayTypeId: B, own: false });
  assert.equal(described.scenarioChanges, 1);
  const kind = step(project, actions.setDayTypeKind, { dayTypeId: B, own: false, sameAs: A });
  assert.deepEqual(kind.after.scenario.changes.map((change) => change.dayTypeId), [A]);
  assert.equal(kind.after.scenario.changes[0], project.scenario.changes[1], 'the other changes are kept as they were');
  assert.equal(kind.outcome.scenarioChanges, 1);
  assert.deepEqual(kind.outcome, described);
  const revert = step(project, actions.revertToBase, { dayTypeId: B });
  assert.deepEqual(revert.after.scenario.changes.map((change) => change.dayTypeId), [A]);
  assert.deepEqual(revert.outcome, described);
  // with none on it, the scenario is the same object
  const none = { ...project, scenario: { ...project.scenario, changes: [project.scenario.changes[1]] } };
  const after = run(actions.setDayTypeKind, none, { dayTypeId: B, own: false });
  assert.equal(after.scenario, none.scenario);
  assert.equal(actions.describeDayTypeKind(none, { dayTypeId: B, own: false }).scenarioChanges, 0);
});

test('setDayTypeKind refuses the first day type, itself, and a day type that is not its own', () => {
  const project = withEverything();
  assert.throws(() => actions.setDayTypeKind(project, { dayTypeId: A, own: false }, shared), { code: 'base' });
  assert.throws(() => actions.setDayTypeKind(project, { dayTypeId: B, own: false, sameAs: B }, shared), { code: 'bad-value' });
  assert.throws(() => actions.setDayTypeKind(project, { dayTypeId: B, own: false, sameAs: C }, shared), { code: 'not-own' });
  assert.throws(() => actions.setDayTypeKind(project, { dayTypeId: B }, shared), { code: 'bad-value' });
});

test('setDayTypeShort: up to four characters, unique ignoring case, "" to have one worked out', () => {
  const project = withEverything();
  const { after, label } = step(project, actions.setDayTypeShort, { dayTypeId: D, short: 'Δ' });
  assert.equal(after.dayTypes[3].short, 'Δ');
  assert.equal(label, 'Change the short name of D Day');
  assert.equal(run(actions.setDayTypeShort, project, { dayTypeId: C, short: '' }).dayTypes[2].short, '');
  assert.equal(actions.setDayTypeShort(project, { dayTypeId: C, short: 'C' }, shared), project);
  assert.equal(actions.setDayTypeShort(project, { dayTypeId: D, short: '' }, shared), project);
  assert.throws(() => actions.setDayTypeShort(project, { dayTypeId: D, short: 'c' }, shared), { code: 'duplicate-short', message: '"C" is already the short name of C Day. Each day type has its own; type another, or leave it empty to have one worked out.' });
});

test('makeOwnCopy and revertToBase follow sameAs', () => {
  const project = withEverything();
  const copied = run(actions.makeOwnCopy, project, { dayTypeId: C });
  for (const g of copied.groups) assert.deepEqual(g.days[C], g.days[B], g.name + ': a copy of B Day, which C Day was the same as');
  const reverted = run(actions.revertToBase, project, { dayTypeId: B });
  assert.equal(describeDayType(reverted, C).follows, 'A Day');
  const followerReverted = run(actions.revertToBase, project, { dayTypeId: C });
  assert.equal(followerReverted.dayTypes[2].sameAs, null);
  assert.equal(actions.revertToBase(project, { dayTypeId: D }, shared), project);
});

test('a change to a day type that is the same as another names that one', () => {
  assert.throws(() => actions.setSlot(withEverything(), { groupId: 'gsample06a', dayTypeId: C, period: 0, slot: { room: null } }, shared), { code: 'same-as-base', message: 'C Day is the same as B Day. Make it its own copy to change it.' });
  assert.throws(() => actions.setBell(withEverything(), { dayTypeId: D, period: 0, bell: null }, shared), { code: 'same-as-base', message: 'D Day is the same as A Day. Make it its own copy to change it.' });
});

// ---------------------------------------------------------------- bell schedules

test('addBellSchedule: a copy of a day type\'s regular bells, every period meeting', () => {
  const { after, label, focus } = step(school(), actions.addBellSchedule, { name: 'Early Release', fromDayTypeId: B });
  const added = after.bellSchedules[0];
  assert.deepEqual({ ...added, id: '' }, { id: '', name: 'Early Release', short: '', bells: after.dayTypes[1].bells, off: [] });
  assert.match(added.id, /^b[a-z0-9]{9}$/);
  assert.equal(label, 'Add bell schedule Early Release');
  assert.deepEqual(focus, { section: 'schedule', tab: 'day', bellsId: added.id });
  // left out, the first day type's
  assert.deepEqual(run(actions.addBellSchedule, school(), { name: 'Testing' }).bellSchedules[0].bells, school().dayTypes[0].bells);
});

test('addBellSchedule refuses a blank, long or taken name, and a thirteenth', () => {
  const project = withEverything();
  for (const [payload, code] of [[{ name: '' }, 'no-name'], [{ name: 'E'.repeat(41) }, 'too-long'], [{ name: 'EARLY release' }, 'duplicate-name'], [{ name: 'Half', short: 'as' }, 'duplicate-short']]) {
    assert.throws(() => actions.addBellSchedule(project, payload, shared), { code }, JSON.stringify(payload));
  }
  let full = school();
  for (let n = 0; n < 12; n += 1) full = actions.addBellSchedule(full, { name: 'Bells ' + n }, shared);
  assertValid(full);
  assert.throws(() => actions.addBellSchedule(full, { name: 'Bells 12' }, shared), { code: 'limit', message: 'A project has at most 12 bell schedules, and this one has 12. Delete one to add another.' });
});

test('setBellSchedule: a name, a short, a bell, a period that does not meet, or the whole list', () => {
  const project = withEverything();
  const renamed = step(project, actions.setBellSchedule, { bellScheduleId: ER, name: 'Half Day' });
  assert.deepEqual([renamed.after.bellSchedules[0].name, renamed.label], ['Half Day', 'Rename bell schedule Early Release to Half Day']);
  const bell = step(project, actions.setBellSchedule, { bellScheduleId: ER, period: 0, bell: { start: '07:50', end: '08:30' } });
  assert.deepEqual([bell.after.bellSchedules[0].bells[0], bell.label], [{ start: '07:50', end: '08:30' }, 'Change the bell for Period 1 on Early Release']);
  const off = step(project, actions.setBellSchedule, { bellScheduleId: ER, period: 3, off: true });
  assert.deepEqual([off.after.bellSchedules[0].off, off.label], [[3, 5, 6, 7], 'Make Period 4 not meet on Early Release']);
  assert.equal(bellsFor(off.after, A, ER)[3].off, true);
  const on = step(project, actions.setBellSchedule, { bellScheduleId: ER, period: 5, off: false });
  assert.deepEqual([on.after.bellSchedules[0].off, on.label], [[6, 7], 'Let Period 6 meet on Early Release']);
  assert.deepEqual(run(actions.setBellSchedule, project, { bellScheduleId: ER, off: [7, 4, 4] }).bellSchedules[0].off, [4, 7]);
  assert.equal(step(project, actions.setBellSchedule, { bellScheduleId: ER, short: 'ER' }).label, 'Change the short name of Early Release');
  assert.equal(actions.setBellSchedule(project, { bellScheduleId: ER, period: 5, off: true }, shared), project);
  assert.throws(() => actions.setBellSchedule(project, { bellScheduleId: ER, off: [8] }, shared), { code: 'bad-value' });
  assert.throws(() => actions.setBellSchedule(project, { bellScheduleId: ER, name: 'assembly' }, shared), { code: 'duplicate-name' });
  assert.throws(() => actions.setBellSchedule(project, { bellScheduleId: 'bnowhere00', name: 'x' }, shared), { code: 'missing' });
});

test('deleteBellSchedule: the calendar rings the regular bells where it was named, and the toast says where', () => {
  const project = withEverything();
  const { after, label, outcome } = step(project, actions.deleteBellSchedule, { bellScheduleId: ER }, { clock: tickingClock() });
  assert.equal(label, 'Delete bell schedule Early Release');
  assert.deepEqual(after.bellSchedules.map((one) => one.id), [AS]);
  assert.equal(after.calendar.weekdays[2].bells, null);
  assert.equal(outcome.text, 'Deleted Early Release, used on Wednesdays in the calendar');
  assert.equal(after.calendar.changedAt, '2026-09-01T12:00:01.000Z');
  const assembly = step(project, actions.deleteBellSchedule, { bellScheduleId: AS });
  assert.equal(assembly.outcome.text, 'Deleted Assembly, used on 1 date in the calendar');
  assert.equal(assembly.after.calendar.dates.find((entry) => entry.date === '2026-10-14').bells, null);
});

test('reorderBellSchedule', () => {
  const { after, label } = step(withEverything(), actions.reorderBellSchedule, { bellScheduleId: AS, toIndex: 0 });
  assert.deepEqual(after.bellSchedules.map((one) => one.id), [AS, ER]);
  assert.equal(label, 'Move Assembly in the list of bell schedules');
});

test('setPeriods sizes every bell schedule and drops the periods past the end from those that do not meet; describePeriodChange counts them', () => {
  const project = withEverything();
  const report = actions.describePeriodChange(project, 6);
  assert.deepEqual(report.bellSchedules, [{ bellScheduleId: ER, name: 'Early Release', bells: 2, off: 2 }, { bellScheduleId: AS, name: 'Assembly', bells: 2, off: 0 }]);
  const after = run(actions.setPeriods, project, { periods: 6 });
  assert.deepEqual(after.bellSchedules.map((one) => [one.bells.length, one.off]), [[6, [5]], [6, []]]);
  const longer = run(actions.setPeriods, project, { periods: 10 });
  assert.deepEqual(longer.bellSchedules.map((one) => one.bells.length), [10, 10]);
});

// ---------------------------------------------------------------- the calendar

function bare() {
  const project = withEverything();
  delete project.calendar;
  return project;
}

test('makeCalendar: Monday to Friday in the rotation of every day type, weekends closed, changedAt from the store\'s clock', () => {
  const { after, label, focus, outcome } = step(bare(), actions.makeCalendar, { start: '2026-08-31', end: '2027-06-11' }, { clock: tickingClock() });
  assert.deepEqual(after.calendar, {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ day: w < 5 ? 'rotation' : 'closed', bells: null })),
    rotation: [A, B, C, D],
    dates: [],
    changedAt: '2026-09-01T12:00:01.000Z',
  });
  // no breaks: no outcome to report (SV2-75b)
  assert.deepEqual([label, focus, outcome], ['Make the calendar', { section: 'schedule', tab: 'calendar' }, null]);
  assert.equal(actions.describeAction(actions.makeCalendar, bare(), { start: '2026-08-31', end: '2027-06-11' }, after).outcome, null);
  assert.equal(actions.scheduleOutcome(run(actions.makeCalendar, bare(), { start: '2026-08-31', end: '2027-06-11', breaks: [] })), null);
  // a break, even one that closes no school day, is reported
  const weekend = run(actions.makeCalendar, bare(), { start: '2026-08-31', end: '2027-06-11', breaks: [{ from: '2026-09-05', to: '2026-09-06', label: 'Weekend' }] });
  assert.deepEqual(actions.scheduleOutcome(weekend), { breaks: [{ from: '2026-09-05', to: '2026-09-06', label: 'Weekend', schoolDays: 0 }], text: 'Weekend: 0 school days' });
  assert.throws(() => actions.makeCalendar(withEverything(), { start: '2026-08-31', end: '2027-06-11' }, shared), { code: 'calendar-exists' });
  assert.equal(run(actions.makeCalendar, withEverything(), { start: '2027-08-30', end: '2028-06-09', replace: true }).calendar.start, '2027-08-30');
});

test('makeCalendar refuses dates that are not dates, a range that runs backwards, and more than 731 days', () => {
  for (const [start, end, code] of [['2026-02-30', '2026-06-01', 'bad-value'], ['2026-08-31', '2026-08-30', 'bad-value'], ['2026-08-01', '2028-08-01', 'too-long']]) {
    assert.throws(() => actions.makeCalendar(bare(), { start, end }, shared), { code }, start + ' to ' + end);
  }
  assert.throws(() => actions.makeCalendar(bare(), { start: '2026-08-31', end: '2027-06-11', rotation: [] }, shared), { code: 'bad-value' });
  assert.throws(() => actions.makeCalendar(bare(), { start: '2026-08-31', end: '2027-06-11', rotation: ['dnowhere00'] }, shared), { code: 'missing' });
  assert.throws(() => actions.makeCalendar(bare(), { start: '2026-08-31', end: '2027-06-11', breaks: [{ from: '2026-12-23', to: '2026-12-21', label: 'x' }] }, shared), { code: 'bad-value' });
});

test('setCalendarRange, setCalendarWeekday, setCalendarRotation, removeCalendar: each one step with its label', () => {
  const project = withEverything();
  const range = step(project, actions.setCalendarRange, { start: '2026-09-01', end: '2027-06-10' });
  assert.equal(range.label, 'Change the calendar to 1 September 2026 to 10 June 2027');
  // dated changes outside a shortened range are kept
  assert.equal(run(actions.setCalendarRange, project, { start: '2026-12-01', end: '2027-06-11' }).calendar.dates.length, 5);
  const wednesday = step(project, actions.setCalendarWeekday, { weekday: 2, day: C });
  assert.deepEqual([wednesday.after.calendar.weekdays[2], wednesday.label], [{ day: C, bells: ER }, 'Change Wednesdays in the calendar']);
  assert.equal(run(actions.setCalendarWeekday, project, { weekday: 2, bells: null }).calendar.weekdays[2].bells, null);
  assert.throws(() => actions.setCalendarWeekday(project, { weekday: 7, day: 'closed' }, shared), { code: 'bad-value' });
  assert.throws(() => actions.setCalendarWeekday(project, { weekday: 2, bells: 'regular' }, shared), { code: 'missing' });
  const rotation = step(project, actions.setCalendarRotation, { rotation: [A, A, B] });
  assert.deepEqual([rotation.after.calendar.rotation, rotation.label], [[A, A, B], 'Change the rotation']);
  assert.equal(actions.setCalendarRotation(project, { rotation: [A, B] }, shared), project);
  const removed = step(project, actions.removeCalendar, {});
  assert.deepEqual([removed.after.calendar, removed.label], [null, 'Remove the calendar']);
  for (const action of [actions.setCalendarRange, actions.setCalendarWeekday, actions.setCalendarRotation, actions.setCalendarDates, actions.removeCalendar]) {
    assert.throws(() => action(bare(), { start: '2026-08-31', end: '2027-06-11', weekday: 0, rotation: [A], dates: ['2026-09-01'], day: 'closed' }, shared), { code: 'no-calendar', message: 'There is no calendar yet. Make one first.' });
  }
});

test('setCalendarDates: No school on a run counts its school days, and says from when later dates move', () => {
  const project = withEverything();
  const { after, label, outcome } = step(project, actions.setCalendarDates, { dates: { from: '2026-12-21', to: '2026-12-31' }, day: 'closed', label: 'Winter break' }, { clock: tickingClock() });
  assert.equal(label, 'Set 9 school days to No school');
  assert.deepEqual([outcome.schoolDays, outcome.skipped, outcome.movedFrom], [9, 2, '2027-01-01']);
  // ten school days off a rotation of two leave every later date as it was
  const even = actions.setCalendarDates(project, { dates: { from: '2026-12-21', to: '2027-01-01' }, day: 'closed', label: 'Winter break' }, shared);
  assert.deepEqual([actions.scheduleOutcome(even).schoolDays, actions.scheduleOutcome(even).movedFrom], [10, null]);
  assert.equal(after.calendar.changedAt, '2026-09-01T12:00:01.000Z');
  assert.equal(dayOn(after, '2026-12-26').why, 'weekday');
  const snow = step(project, actions.setCalendarDates, { dates: ['2026-11-25'], day: 'closed', label: 'Snow day' });
  assert.equal(snow.label, 'Set 25 November to No school');
  assert.equal(snow.outcome.movedFrom, '2026-11-27');
});

test('setCalendarDates: a day type, next in the rotation, bells, a note, and back to as the calendar says', () => {
  const project = withEverything();
  const b = step(project, actions.setCalendarDates, { dates: ['2026-09-01'], day: B });
  assert.equal(b.label, 'Set 1 September to B Day');
  assert.deepEqual(b.after.calendar.dates[0], { date: '2026-09-01', day: B, bells: null, label: '' });
  const saturday = step(project, actions.setCalendarDates, { dates: ['2026-09-05'], day: 'rotation', label: 'Make-up day' });
  assert.equal(saturday.label, 'Set 5 September to Next in the rotation');
  assert.equal(dayOn(saturday.after, '2026-09-05').school, true);
  const bells = run(actions.setCalendarDates, project, { dates: ['2026-11-26'], bells: AS });
  assert.deepEqual(bells.calendar.dates.find((entry) => entry.date === '2026-11-26'), { date: '2026-11-26', day: 'closed', bells: AS, label: 'Thanksgiving' });
  const back = step(project, actions.setCalendarDates, { dates: ['2026-11-26', '2026-11-27'], day: null });
  assert.equal(back.label, 'Set 26 November as the calendar says');
  assert.equal(back.after.calendar.dates.some((entry) => entry.date === '2026-11-26'), false);
  // a change that would say nothing is not kept, and nothing changed is no step
  assert.equal(actions.setCalendarDates(project, { dates: ['2026-09-01'], day: 'rotation' }, shared), project);
  assert.equal(actions.setCalendarDates(project, { dates: ['2026-11-26'], day: 'closed', label: 'Thanksgiving' }, shared), project);
});

test('setCalendarDates with no day on a date with no change of its own writes day null, so a fixed weekday\'s bells change moves nothing later (SV2-75b)', () => {
  // Mondays and Wednesdays A, Tuesdays and Thursdays B, Fridays alternate
  const project = withEverything();
  project.calendar = { ...project.calendar, weekdays: [{ day: A, bells: null }, { day: B, bells: null }, { day: A, bells: null }, { day: B, bells: null }, { day: 'rotation', bells: null }, { day: 'closed', bells: null }, { day: 'closed', bells: null }], dates: [] };
  const before = calendarDays(project);
  const { after, label, outcome } = step(project, actions.setCalendarDates, { dates: ['2026-09-16'], bells: ER });
  assert.equal(label, 'Change 16 September in the calendar');
  assert.deepEqual(after.calendar.dates, [{ date: '2026-09-16', day: null, bells: ER, label: '' }]);
  const days = calendarDays(after);
  days.forEach((entry, i) => {
    if (entry.date === '2026-09-16') assert.deepEqual([entry.dayTypeId, entry.bellsId, entry.why, entry.changed], [A, ER, 'weekday', true]);
    else assert.deepEqual(entry, before[i], entry.date + ' moved');
  });
  assert.equal(outcome.movedFrom, null);
  // a note only, on a fixed weekday: day null, and nothing moves
  const note = run(actions.setCalendarDates, project, { dates: ['2026-09-17'], label: 'Picture day' });
  assert.deepEqual(note.calendar.dates, [{ date: '2026-09-17', day: null, bells: null, label: 'Picture day' }]);
  calendarDays(note).forEach((entry, i) => {
    if (entry.date !== '2026-09-17') assert.deepEqual(entry, before[i], entry.date + ' moved');
  });
  // a date with a change of its own keeps its day
  const kept = run(actions.setCalendarDates, withEverything(), { dates: ['2026-10-14'], bells: ER });
  assert.deepEqual(kept.calendar.dates.find((entry) => entry.date === '2026-10-14'), { date: '2026-10-14', day: C, bells: ER, label: 'Assembly' });
  // taking the note away again leaves a change that says nothing, which goes
  const cleared = run(actions.setCalendarDates, note, { dates: ['2026-09-17'], label: '' });
  assert.deepEqual(cleared.calendar.dates, []);
  assertValid(after);
  assertValid(note);
});

test('setCalendarDates refuses dates outside the calendar, unknown day types and bells, and a long note', () => {
  const project = withEverything();
  assert.throws(() => actions.setCalendarDates(project, { dates: ['2027-06-12'], day: 'closed' }, shared), { code: 'outside', message: '12 June 2027 is outside the calendar, which runs from 31 August 2026 to 11 June 2027.' });
  assert.throws(() => actions.setCalendarDates(project, { dates: [], day: 'closed' }, shared), { code: 'bad-value' });
  assert.throws(() => actions.setCalendarDates(project, { dates: ['2026-09-01'], day: 'dnowhere00' }, shared), { code: 'missing' });
  assert.throws(() => actions.setCalendarDates(project, { dates: ['2026-09-01'], bells: 'bnowhere00' }, shared), { code: 'missing' });
  assert.throws(() => actions.setCalendarDates(project, { dates: ['2026-09-01'], label: 'x'.repeat(61) }, shared), { code: 'too-long' });
});

test('setPublishSetting takes staleAtCalendarEnd and the calendar view', () => {
  const project = school();
  assert.equal(run(actions.setPublishSetting, project, { key: 'staleAtCalendarEnd', value: false }).publish.staleAtCalendarEnd, false);
  assert.equal(run(actions.setPublishSetting, project, { key: 'views.calendar', value: false }).publish.views.calendar, false);
  assert.throws(() => actions.setPublishSetting(project, { key: 'staleAtCalendarEnd', value: 'no' }, shared), { code: 'bad-value' });
  assert.throws(() => actions.setPublishSetting(project, { key: 'views.diary', value: true }, shared), { code: 'bad-value' });
});

test('followersOf after every kind of change stays one hop', () => {
  let project = withEverything();
  project = actions.setDayTypeKind(project, { dayTypeId: D, own: false, sameAs: B }, shared);
  project = actions.setDayTypeKind(project, { dayTypeId: B, own: false, sameAs: A }, shared);
  assert.deepEqual(followersOf(project, A).map((d) => d.name), ['B Day', 'C Day', 'D Day']);
  assert.ok(project.dayTypes.every((d) => d.sameAs === null || d.sameAs === undefined));
  assertValid(project);
});

// ---------------------------------------------------------------- SV2-77b: names the calendar uses

test('a day type cannot be called "No school", "Next in the rotation" or "As the calendar says", whatever the capitals and spaces', () => {
  for (const name of ['No school', 'NOSCHOOL', ' next in the  Rotation ', 'As the calendar says']) {
    refused(actions.addDayType, school(), { name }, 'reserved-name');
    refused(actions.renameDayType, school(), { dayTypeId: B, name }, 'reserved-name');
  }
  assert.throws(() => actions.addDayType(school(), { name: 'no school' }, shared), { message: '"No school" is what the calendar says for a date with no school, so a day type cannot be called that: the calendar and its CSV could not tell the two apart. Type a different name.' });
  // a name that only contains one is a name
  assert.equal(run(actions.addDayType, school(), { name: 'No school day' }).dayTypes[2].name, 'No school day');
  assert.equal(run(actions.addDayType, school(), { name: 'Regular' }).dayTypes[2].name, 'Regular', 'Regular is a word for bells, not day types');
});

test('a bell schedule cannot be called "Regular" or "As the weekday says", whatever the capitals and spaces', () => {
  for (const name of ['Regular', ' regular ', 'Regular Bells', 'As the weekday says', 'astheweekdaysays']) {
    refused(actions.addBellSchedule, school(), { name }, 'reserved-name');
    refused(actions.setBellSchedule, withEverything(), { bellScheduleId: ER, name }, 'reserved-name');
  }
  assert.throws(() => actions.addBellSchedule(school(), { name: 'Regular' }, shared), { message: '"Regular" is what the calendar says for a day type\'s own bells, so a bell schedule cannot be called that: the calendar and its CSV could not tell the two apart. Type a different name.' });
  assert.equal(run(actions.addBellSchedule, school(), { name: 'Regular bells, late' }).bellSchedules[0].name, 'Regular bells, late');
  assert.equal(run(actions.addBellSchedule, school(), { name: 'No school' }).bellSchedules[0].name, 'No school', 'a day-type word is a bell schedule\'s name');
});

// ---------------------------------------------------------------- SV2-77b: importCalendarDates

import { readCalendarCsv, importedCalendar, calendarImportText } from '../../engine/import-calendar.js';

test('importCalendarDates puts a calendar CSV\'s changes in place: one step, its label, SCHEDULE, stamped from the clock', () => {
  const project = withEverything();
  project.calendar.changedAt = '2026-08-20T09:00:00.000Z';
  const read = readCalendarCsv(project, 'Date,Note\r\n2026-12-21,Winter break\r\n2026-11-26,Thanksgiving\r\n2030-01-01,Later\r\n');
  const { after, label, focus } = step(project, actions.importCalendarDates, { changes: read.changes, counts: read.counts });
  assert.equal(label, 'Import dates: ' + calendarImportText(project, read));
  assert.equal(label, 'Import dates: 1 date changes; 1 date is as the calendar has it; 1 date is outside the calendar, which runs from 31 August 2026 to 11 June 2027');
  assert.deepEqual(focus, { section: 'schedule', tab: 'calendar' });
  assert.deepEqual(after.calendar.dates, importedCalendar(project, read.changes).dates);
  assert.equal(after.calendar.changedAt, clock().toISOString(), 'the store\'s time, for the publish form');
  assert.equal(dayOn(after, '2026-12-21').school, false);
  // without counts the label counts the changes
  assert.equal(step(project, actions.importCalendarDates, { changes: read.changes }).label, 'Import dates: 1 date changes');
  assert.deepEqual(actions.importCalendarDates.bumps, [SCHEDULE]);
});

test('setCalendarDates and importCalendarDates store a note without the spaces around it, and count the length after trimming', () => {
  const project = withEverything();
  const set = step(project, actions.setCalendarDates, { dates: ['2026-11-25'], day: 'closed', label: '  Snow day \t' });
  assert.equal(set.after.calendar.dates.find((entry) => entry.date === '2026-11-25').label, 'Snow day');
  const long = ' ' + 'a'.repeat(60) + ' ';
  assert.equal(step(project, actions.setCalendarDates, { dates: ['2026-11-25'], day: 'closed', label: long }).after.calendar.dates.find((entry) => entry.date === '2026-11-25').label, 'a'.repeat(60), 'sixty characters and spaces fit');
  refused(actions.setCalendarDates, project, { dates: ['2026-11-25'], day: 'closed', label: 'a'.repeat(61) }, 'too-long');
  const imported = step(project, actions.importCalendarDates, { changes: [{ date: '2026-11-25', day: 'closed', bells: null, label: '  Snow day ' }] });
  assert.equal(imported.after.calendar.dates.find((entry) => entry.date === '2026-11-25').label, 'Snow day');
});

test('importCalendarDates: no change makes no step, and it is refused with no calendar or a change that no longer fits', () => {
  const project = withEverything();
  const store = createStore({ project, clock, ids: makeIds(3) });
  store.apply(actions.importCalendarDates, { changes: [] });
  store.apply(actions.importCalendarDates, { changes: readCalendarCsv(project, 'Date,Note\n2026-11-26,Thanksgiving\n').changes });
  assert.equal(store.history.past.length, 0);
  assert.equal(store.project, project);
  const change = { date: '2026-12-21', day: 'closed', bells: null, label: 'Winter break' };
  refused(actions.importCalendarDates, school(), { changes: [change] }, 'no-calendar');
  refused(actions.importCalendarDates, project, {}, 'bad-value');
  refused(actions.importCalendarDates, project, { changes: [{ ...change, date: '2026-12-32' }] }, 'bad-value');
  refused(actions.importCalendarDates, project, { changes: [change, change] }, 'bad-value');
  refused(actions.importCalendarDates, project, { changes: [{ ...change, date: '2030-01-01' }] }, 'outside');
  refused(actions.importCalendarDates, project, { changes: [{ ...change, day: 'dnowhere00' }] }, 'missing');
  refused(actions.importCalendarDates, project, { changes: [{ ...change, day: null, bells: 'bnowhere00' }] }, 'missing');
  refused(actions.importCalendarDates, project, { changes: [{ ...change, label: 'x'.repeat(61) }] }, 'too-long');
});
