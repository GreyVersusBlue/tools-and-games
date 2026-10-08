import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, isValid } from '../../engine/validate.js';
import { emptyProject, school, clone, BREAKS } from './helpers.mjs';

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
