import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { validate } from '../../engine/validate.js';
import { GROUP_COLOUR_PRESETS, defaultSettings, nameOfRoom } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { emptyProject, school, ctx, clone, room, group, teacher, assertValid, PINNED } from './helpers.mjs';

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

test('setOnboarding is a quiet action, and no other action is', () => {
  assert.equal(actions.setOnboarding.quiet, true);
  for (const [name, value] of Object.entries(actions)) {
    if (typeof value === 'function' && 'label' in value && name !== 'setOnboarding') assert.equal(value.quiet, false, name);
  }
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
