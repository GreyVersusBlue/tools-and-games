import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, isValid } from '../../engine/validate.js';
import { emptyProject, school, clone, room, BREAKS, PINNED } from './helpers.mjs';

test('the empty project and the sample school have no findings', () => {
  assert.deepEqual(validate(emptyProject()), []);
  assert.deepEqual(validate(school()), []);
  assert.equal(isValid(school()), true);
});

test('a finding is a path and a message, and nothing else', () => {
  const project = school();
  project.settings.periods = 17;
  const findings = validate(project);
  assert.ok(findings.length >= 1);
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding), ['path', 'message']);
    assert.equal(typeof finding.path, 'string');
    assert.match(finding.message, /\.$/);
  }
});

for (const [name, mutate, where] of BREAKS) {
  test('finds ' + name, () => {
    const project = school();
    mutate(project);
    const findings = validate(project);
    assert.ok(findings.some((finding) => where.test(finding.path)), 'no finding at ' + where + '; got ' + JSON.stringify(findings.map((finding) => finding.path)));
    assert.equal(isValid(project), false);
  });
}

test('the breaks are each a different rule: none of them is found in the untouched school', () => {
  const findings = validate(school());
  for (const [name, , where] of BREAKS) assert.equal(findings.some((finding) => where.test(finding.path)), false, name);
});

test('never rejects a character in a name', () => {
  const project = school();
  const hostile = '<script>alert("x")</script> & \'quotes\' "double" `tick` \\ ‮\u0000 日本語 العربية 🏫 \n\t';
  project.settings.schoolName = hostile;
  project.building.floors[0].name = hostile;
  project.building.floors[0].spaces[0].number = hostile;
  project.building.floors[0].spaces[0].wing = hostile;
  project.building.floors[0].spaces[5].label = hostile;
  project.building.floors[0].corridors[0].name = hostile;
  project.building.floors[0].exits[0].doorName = hostile;
  project.building.floors[0].exits[0].assembly = hostile;
  project.building.zones[0].label = hostile;
  project.subjects[0].name = hostile;
  project.subjects[0].code = hostile;
  project.teachers[0].name = hostile;
  project.teachers[0].notes = hostile;
  project.groups[0].name = hostile;
  project.groups[0].grade = hostile;
  project.groups[0].days.dsample00a[0].label = hostile;
  project.groups[0].days.dsample00a[0].roomText = hostile;
  project.dayTypes[0].name = hostile;
  project.publish.passcode = hostile;
  assert.deepEqual(validate(project), []);
  assert.equal(project.teachers[0].name, hostile, 'and stores it as given');
});

test('a room with no number is allowed, and two of them do not clash', () => {
  const project = school();
  project.building.floors[0].spaces[0].number = '';
  project.building.floors[0].spaces[1].number = '  ';
  assert.deepEqual(validate(project), []);
});

test('a bell that ends before it starts is not a validation finding: the bell checks warn about it', () => {
  const project = school();
  project.dayTypes[0].bells[0] = { start: '09:00', end: '08:00' };
  assert.deepEqual(validate(project), []);
});

test('a day type that is the same as A Day may hold no bell times and no group days', () => {
  const project = school();
  project.dayTypes[1].own = false;
  const paths = validate(project).map((finding) => finding.path);
  assert.ok(paths.includes('dayTypes[1].bells[0]'));
  assert.ok(paths.includes('groups[0].days.dsample00b'));
  for (const group of project.groups) delete group.days.dsample00b;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  assert.deepEqual(validate(project), []);
});

test('a scenario whose changes point at things that are gone is still valid: reconciling is the scenario module\'s job', () => {
  const project = school();
  project.scenario = { name: 'Move 8A', changes: [{ kind: 'move', dayTypeId: 'dgone00000', groupId: 'ggone00000', period: 40, roomId: 'rgone00000' }, { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample08a', periodA: 1, periodB: 2 }, { kind: 'swapRooms', dayTypeId: 'dsample00a', groupA: 'gsample08a', groupB: 'gsample08b', period: 0 }], compared: null };
  assert.deepEqual(validate(project), []);
});

test('a same-floor connection and a stairs cell with two connections are allowed', () => {
  const project = school();
  const floor = project.building.floors[1];
  project.building.connections.push({ id: 'csample00c', label: 'C', a: { floorId: floor.id, cell: 8 * 40 + 12 }, b: { floorId: floor.id, cell: 8 * 40 + 33 }, direction: 'ab' });
  assert.deepEqual(validate(project), []);
});

test('never throws, whatever it is given', () => {
  for (const junk of [undefined, null, 0, 'project', [], {}, { settings: [], building: { floors: [null, 4, {}] }, groups: [null, { days: 3 }, { days: { x: [null, 1] } }], teachers: [1, { roomIds: 5 }], dayTypes: [1, { bells: [5, {}] }], subjects: 'no', accepted: [1], scenario: 5, publish: 1, onboarding: 2 }, { building: { floors: [{ width: 10, height: 10, cells: '.'.repeat(100), spaces: [{ kind: 'room', cells: [1], doors: [null, {}] }, null], corridors: [null, { cells: 5 }], exits: [null, {}], image: 5 }], connections: [null, { a: 1 }], zones: [null, {}] } }]) {
    const findings = validate(junk);
    assert.ok(Array.isArray(findings) && findings.length > 0, JSON.stringify(junk));
  }
});

test('a published model, with its fewer fields, has no findings', () => {
  const project = school();
  const published = {
    format: 'sv2-published',
    version: 1,
    id: project.id,
    publishedAt: '2026-09-01T12:00:00.000Z',
    staleAfter: '2026-10-31T12:00:00.000Z',
    settings: { schoolName: project.settings.schoolName, periods: 8, periodWord: 'Period', defaultPassingSeconds: 240, secondsPerCell: 3, secondsPerStair: 8, timeFormat: '12h' },
    building: {
      floors: clone(project.building.floors).map((floor) => { delete floor.image; return floor; }),
      connections: clone(project.building.connections),
    },
    subjects: clone(project.subjects),
    teachers: clone(project.teachers),
    dayTypes: clone(project.dayTypes),
    groups: clone(project.groups).map((group) => { delete group.headCount; return group; }),
    publish: { views: project.publish.views, teacherNamesOnMap: true },
  };
  assert.deepEqual(validate(published), []);
  published.groups[0].colour = 'red';
  assert.deepEqual(validate(published).map((finding) => finding.path), ['groups[0].colour'], 'and it is still checked');
});

// ---- SV2-35: three rules the review of the first unit asked for

test('finds two stair connections with one label', () => {
  const project = school();
  project.building.connections[1].label = 'A';
  assert.deepEqual(validate(project).map((finding) => finding.path), ['building.connections[1].label']);
  assert.match(validate(project)[0].message, /already used at building\.connections\[0\]/);
});

test('connection labels are compared as typed: "A" and "a" are two labels', () => {
  const project = school();
  project.building.connections[1].label = 'a';
  assert.deepEqual(validate(project), []);
});

test('finds a check switched off that is not one of the checks', () => {
  const project = school();
  project.settings.checks.off = ['room-unused', 'room-on-fire'];
  assert.deepEqual(validate(project).map((finding) => finding.path), ['settings.checks.off[1]']);
  project.settings.checks.off = ['room-unused', 'empty-period'];
  assert.deepEqual(validate(project), []);
});

const WRONG_IDS = [
  ['the project', (p) => { p.id = 'my project'; }, 'project.id'],
  ['a subject', (p) => { p.subjects.push({ id: 'DRAMA', code: 'DRA', name: 'Drama', colour: '#7a5aa6' }); }, 'subjects[9].id'],
  ['a teacher', (p) => { p.teachers.push({ id: 'tsample01', name: 'Mx. Oakhollow', subjectId: null, roomIds: [], notes: '' }); }, 'teachers[12].id'],
  ['a day type', (p) => { const id = p.dayTypes[1].id; p.dayTypes[1].id = 'dSample00b'; for (const g of p.groups) { g.days.dSample00b = g.days[id]; delete g.days[id]; } }, 'dayTypes[1].id'],
  ['a floor', (p) => { p.building.floors.push({ ...clone(p.building.floors[2]), id: 'fsample0044', name: 'Roof', spaces: [], corridors: [], exits: [], cells: '.'.repeat(560) }); }, 'building.floors[3].id'],
  ['an other space', (p) => { p.building.floors[0].spaces[5].id = 'office'; }, 'building.floors[0].spaces[5].id'],
  ['a corridor name', (p) => { p.building.floors[0].corridors[0].id = 'k-sample01'; }, 'building.floors[0].corridors[0].id'],
  ['an exit', (p) => { p.building.floors[0].exits[0].id = ' xsample01'; }, 'building.floors[0].exits[0].id'],
  ['a connection', (p) => { p.building.connections[0].id = 'c'; }, 'building.connections[0].id'],
  ['a zone', (p) => { p.building.zones[0].id = 'zsample00é'; }, 'building.zones[0].id'],
  ['a group', (p) => { p.groups[7].id = '6a'; }, 'groups[7].id'],
];

for (const [name, mutate, path] of WRONG_IDS) {
  test('finds an id of the wrong form on ' + name, () => {
    const project = school();
    mutate(project);
    assert.deepEqual(validate(project).map((finding) => finding.path), [path]);
    assert.match(validate(project)[0].message, /10 characters/);
  });
}

test('finds an id that is another kind\'s: a group carrying a room\'s letter', () => {
  const project = school();
  project.groups[7].id = 'rsample999';
  assert.deepEqual(validate(project).map((finding) => finding.path), ['groups[7].id']);
  assert.match(validate(project)[0].message, /starts with "g"/);
});

test('a room that is not a rectangle is allowed: the eraser and a placement over part of a room make them', () => {
  const project = school();
  const space = room(project, '103');
  const lost = space.cells.filter((cell) => !space.doors.some((door) => door.cell === cell))[0];
  space.cells = space.cells.filter((cell) => cell !== lost);
  assert.deepEqual(validate(project), []);
});

test('an accepted finding\'s `about` is a list of ids when it is there, and a record without one is still valid', () => {
  const record = (about) => {
    const project = school();
    project.accepted = [{ findingId: 'no-planning:dsample00a:tsample001', reason: 'Part time', at: PINNED }];
    if (about !== undefined) project.accepted[0].about = about;
    return validate(project).map((finding) => finding.path);
  };
  assert.deepEqual(record(undefined), [], 'a file written before the field existed');
  assert.deepEqual(record([]), []);
  assert.deepEqual(record(['gsample001', 'gsample002']), []);
  for (const about of ['gsample001', null, 5, {}, [''], ['gsample001', 7], [null], [['gsample001']]]) {
    assert.deepEqual(record(about), ['accepted[0].about'], JSON.stringify(about));
  }
  const project = school();
  project.accepted = [{ findingId: 'no-planning:dsample00a:tsample001', reason: 'Part time', at: PINNED, about: [''] }];
  assert.match(validate(project)[0].message, /list of ids\.$/);
});
