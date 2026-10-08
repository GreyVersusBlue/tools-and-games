import test from 'node:test';
import assert from 'node:assert/strict';
import { repair, UNKNOWN_ROOM_TEXT } from '../../engine/repair.js';
import { validate } from '../../engine/validate.js';
import { seededRandom } from '../../engine/ids.js';
import { emptyProject, school, clone, clock, makeIds, room, group, PINNED, BREAKS } from './helpers.mjs';

test('a valid project comes back as the same object with no notes', () => {
  for (const project of [emptyProject(), school()]) {
    const result = repair(project);
    assert.equal(result.project, project);
    assert.deepEqual(result.notes, []);
  }
});

test('repair does not change what it is given', () => {
  const project = school();
  project.settings.periods = 99;
  project.groups[0].days.dsample00a[0].room = 'rnowhere00';
  project.building.floors[0].spaces[1].cells.push(project.building.floors[0].spaces[0].cells[0]);
  const before = clone(project);
  repair(project);
  assert.deepEqual(project, before);
});

for (const [name, mutate] of BREAKS) {
  test('puts right ' + name, () => {
    const project = school();
    mutate(project);
    assert.notDeepEqual(validate(project), [], 'the break is a real one');
    const result = repair(project);
    assert.deepEqual(validate(result.project), []);
    assert.ok(result.notes.every((note) => typeof note === 'string' && note.length > 0));
  });
}

test('anything at all becomes a valid project', () => {
  for (const junk of [undefined, null, 0, 'project', [], {}, { version: 1 }, { settings: [], building: { floors: [null, 4, {}] }, groups: [null, { days: 3 }, { days: { x: [null, 1] } }], teachers: [1, { roomIds: 5 }], dayTypes: [1, { bells: [5, {}] }], subjects: 'no', accepted: [1], scenario: 5, publish: 1, onboarding: 2 }, { building: { floors: [{ width: 10, height: 10, cells: 'x'.repeat(100), spaces: [{ kind: 'room', cells: [1], doors: [null, {}] }, null, { cells: 'no' }], corridors: [null, { cells: 5 }], exits: [null, {}], image: 5 }], connections: [null, { a: 1 }], zones: [null, {}] } }]) {
    const result = repair(junk);
    assert.deepEqual(validate(result.project), [], JSON.stringify(junk));
    assert.ok(result.notes.length > 0, 'and it says what it did: ' + JSON.stringify(junk));
  }
});

test('a thousand randomly damaged sample schools all come back valid', () => {
  const random = seededRandom('damage');
  const pick = (list) => list[Math.floor(random() * list.length)];
  const junk = [undefined, null, -1, 0, 1.5, 9999, '', 'x', true, [], {}, [null], { id: 5 }, 'rsample101', 'tsample001', 'dsample00b'];
  // walk to a random place in the project and overwrite or delete it
  const damage = (project) => {
    let target = project;
    for (let depth = 0; depth < 6; depth += 1) {
      const keys = Object.keys(target);
      if (keys.length === 0) return;
      const key = pick(keys);
      const child = target[key];
      if (child !== null && typeof child === 'object' && random() < 0.8) {
        target = child;
        continue;
      }
      if (random() < 0.2) {
        if (Array.isArray(target)) target.splice(Number(key), 1);
        else delete target[key];
      } else {
        target[key] = pick(junk);
      }
      return;
    }
  };
  for (let run = 0; run < 1000; run += 1) {
    const project = school();
    const hits = 1 + Math.floor(random() * 4);
    for (let i = 0; i < hits; i += 1) damage(project);
    const snapshot = JSON.stringify(project);
    let result;
    assert.doesNotThrow(() => { result = repair(project); }, 'run ' + run + ': ' + snapshot.slice(0, 200));
    const findings = validate(result.project);
    assert.deepEqual(findings, [], 'run ' + run + ' left ' + JSON.stringify(findings.slice(0, 3)));
    const again = repair(result.project);
    assert.equal(again.project, result.project, 'run ' + run + ': a repaired project needs no second repair');
    assert.deepEqual(again.notes, []);
  }
});

// ---- the period rule (ARCHITECTURE 5)

test('a bad periods setting never truncates: it becomes the longest day present', () => {
  const project = school();
  project.settings.periods = 0;
  const result = repair(project);
  assert.equal(result.project.settings.periods, 8);
  assert.deepEqual(result.project.groups, project.groups, 'no day lost a slot');
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /Periods per day .* is now 8/);
});

test('a missing periods setting with ten-slot days becomes 10, not the default 8', () => {
  const project = school();
  delete project.settings.periods;
  for (const g of project.groups) for (const day of Object.values(g.days)) day.push({ room: 'rsample101', roomText: '', label: 'ninth', teacherIds: [] }, { room: null, roomText: '', label: '', teacherIds: [] });
  const result = repair(project);
  assert.equal(result.project.settings.periods, 10);
  assert.equal(group(result.project, '6A').days.dsample00a[8].label, 'ninth');
  assert.equal(result.project.dayTypes[0].bells.length, 10, 'the bell schedules are filled out to match');
  assert.deepEqual(validate(result.project), []);
});

test('a missing periods setting with no days at all becomes 8', () => {
  const project = emptyProject();
  delete project.settings.periods;
  project.dayTypes.forEach((dayType) => { dayType.bells = []; });
  assert.equal(repair(project).project.settings.periods, 8);
});

test('a longest day past 16 is capped at 16, and says what it removed', () => {
  const project = school();
  project.settings.periods = 'eight';
  const day = group(project, '6A').days.dsample00a;
  while (day.length < 18) day.push({ room: 'rsample101', roomText: '', label: '', teacherIds: [] });
  const result = repair(project);
  assert.equal(result.project.settings.periods, 16);
  assert.ok(result.notes.some((note) => /2 slots past the last period/.test(note)), result.notes.join(' | '));
});

test('with a sound periods setting, days are sized to it: short ones padded, long ones cut with a note', () => {
  const project = school();
  group(project, '6A').days.dsample00a.pop();
  group(project, '6B').days.dsample00a.push({ room: 'rsample101', roomText: '', label: '', teacherIds: [] });
  const result = repair(project);
  assert.equal(group(result.project, '6A').days.dsample00a.length, 8);
  assert.deepEqual(group(result.project, '6A').days.dsample00a[7], { room: null, roomText: '', label: '', teacherIds: [] });
  assert.equal(group(result.project, '6B').days.dsample00a.length, 8);
  assert.ok(result.notes.some((note) => /6B.*1 slot past the last period/.test(note)));
});

// ---- floors

test('fills Floor.level for older data: the floor\'s index plus one', () => {
  const project = school();
  for (const floor of project.building.floors) delete floor.level;
  const result = repair(project);
  assert.deepEqual(result.project.building.floors.map((floor) => floor.level), [1, 2, 3]);
  assert.deepEqual(result.notes, [], 'an absent field is filled without a note');
});

test('keeps a level that is already a whole number, whatever the order of the floors', () => {
  const project = school();
  project.building.floors.reverse();
  const result = repair(project);
  assert.deepEqual(result.project.building.floors.map((floor) => floor.level), [3, 2, 1]);
});

test('a cell claimed by two spaces goes to the earlier one', () => {
  const project = school();
  const floor = project.building.floors[0];
  const contested = floor.spaces[0].cells[0];
  floor.spaces[1].cells.push(contested);
  const result = repair(project);
  const fixed = result.project.building.floors[0];
  assert.ok(fixed.spaces[0].cells.includes(contested));
  assert.equal(fixed.spaces[1].cells.includes(contested), false);
  assert.ok(result.notes.some((note) => /Room "102".*lost 1 cell/.test(note)), result.notes.join(' | '));
});

test('a space cell that is also corridor stays with the space, and the corridor cell is cleared', () => {
  const project = school();
  const floor = project.building.floors[0];
  const cell = floor.spaces[0].cells[0];
  floor.cells = floor.cells.slice(0, cell) + '#' + floor.cells.slice(cell + 1);
  const result = repair(project);
  assert.equal(result.project.building.floors[0].cells[cell], '.');
  assert.ok(result.project.building.floors[0].spaces[0].cells.includes(cell));
  assert.ok(result.notes.some((note) => /1 corridor or stairs cell .* cleared/.test(note)));
});

test('a room left with no cells is removed, and its slots keep its number as text', () => {
  const project = school();
  room(project, '203').cells = [];
  const result = repair(project);
  assert.equal(result.project.building.floors[1].spaces.some((space) => space.number === '203'), false);
  const slot = group(result.project, '6C').days.dsample00a[1];
  assert.deepEqual([slot.room, slot.roomText], [null, '203']);
  assert.equal(result.project.teachers.find((t) => t.name === 'Ms. Vandermeer').roomIds.length, 0);
  assert.deepEqual(validate(result.project), []);
});

test('a slot whose room id is not in the building is kept as text, never silently emptied', () => {
  const project = school();
  group(project, '6A').days.dsample00a[0] = { room: 'rnowhere00', roomText: 'Annex 4', label: '', teacherIds: [] };
  group(project, '6A').days.dsample00a[1] = { room: 'rnowhere01', roomText: '', label: '', teacherIds: [] };
  const result = repair(project);
  const day = group(result.project, '6A').days.dsample00a;
  assert.deepEqual([day[0].room, day[0].roomText], [null, 'Annex 4']);
  assert.deepEqual([day[1].room, day[1].roomText], [null, UNKNOWN_ROOM_TEXT]);
  assert.ok(result.notes.some((note) => /6A.*2 slots in a room that is not in the building/.test(note)));
});

test('a door that faces nowhere is removed; the room keeps its good door', () => {
  const project = school();
  const r = room(project, '101');
  r.doors.push({ cell: r.cells[0], side: 'n' });
  const result = repair(project);
  assert.deepEqual(room(result.project, '101').doors, [r.doors[0]]);
});

test('a connection whose cell is not stairs is removed', () => {
  const project = school();
  const floor = project.building.floors[1];
  floor.cells = floor.cells.replace('S', '#');
  const result = repair(project);
  assert.deepEqual(result.project.building.connections.map((c) => c.label), ['B']);
  assert.ok(result.notes.some((note) => /stair connection A .* removed/.test(note)));
});

test('a connection with no letter takes the first unused one and keeps the others as they are', () => {
  const project = school();
  project.building.connections[0].label = '';
  const result = repair(project);
  assert.deepEqual(result.project.building.connections.map((c) => c.label), ['A', 'B']);
  project.building.connections[1].label = 'A';
  assert.deepEqual(repair(project).project.building.connections.map((c) => c.label), ['B', 'A']);
});

test('a corridor name keeps its corridor cells and drops the others', () => {
  const project = school();
  const corridor = project.building.floors[0].corridors[0];
  const good = corridor.cells.length;
  corridor.cells.push(0, 1);
  assert.equal(repair(project).project.building.floors[0].corridors[0].cells.length, good);
});

test('an exit that is not on an edge corridor cell is removed', () => {
  const project = school();
  project.building.floors[0].exits[1].cell = 7 * 40 + 3;
  const result = repair(project);
  assert.deepEqual(result.project.building.floors[0].exits.map((exit) => exit.doorName), ['Door A']);
  assert.ok(result.notes.some((note) => /exit "Door B".*removed/.test(note)));
});

// ---- names and ids

test('two rooms with one number: the later becomes "204 (2)"', () => {
  const project = school();
  room(project, '203').number = ' 204';
  const result = repair(project);
  const numbers = result.project.building.floors[1].spaces.filter((s) => s.kind === 'room').map((s) => s.number);
  assert.deepEqual(numbers, ['201', '202', ' 204', '204 (2)', 'Library']);
});

test('two groups with one name but for case: the later becomes "6a (2)"', () => {
  const project = school();
  project.groups[1].name = '6a';
  assert.deepEqual(repair(project).project.groups.slice(0, 2).map((g) => g.name), ['6A', '6a (2)']);
});

test('two teachers with one name: the later gets " (2)" and a note that offers a merge', () => {
  const project = school();
  project.teachers[1].name = 'Ms. Halloran';
  const result = repair(project);
  assert.equal(result.project.teachers[1].name, 'Ms. Halloran (2)');
  assert.ok(result.notes.some((note) => /merge them/.test(note)));
});

test('a missing id is given, and a repeated id is replaced on the later thing', () => {
  const project = school();
  delete project.groups[0].id;
  project.teachers[1].id = project.teachers[0].id;
  const result = repair(project, { ids: makeIds(5) });
  assert.match(result.project.groups[0].id, /^g[a-z0-9]{9}$/);
  assert.equal(result.project.teachers[0].id, 'tsample001');
  assert.match(result.project.teachers[1].id, /^t[a-z0-9]{9}$/);
  assert.notEqual(result.project.teachers[1].id, 'tsample001');
  assert.deepEqual(validate(result.project), []);
});

test('without an id source, repair is still the same every time', () => {
  const broken = () => { const p = school(); delete p.groups[0].id; delete p.id; return p; };
  const a = repair(broken());
  const b = repair(broken());
  assert.equal(a.project.groups[0].id, b.project.groups[0].id);
  assert.equal(a.project.id, b.project.id);
});

test('a missing date takes the clock it is given', () => {
  const project = school();
  delete project.created;
  project.modified = 'last week';
  const result = repair(project, { clock });
  assert.equal(result.project.created, PINNED);
  assert.equal(result.project.modified, PINNED);
});

// ---- teachers and rooms

test('a teacher\'s rooms and a room\'s teachers are brought to say the same thing, keeping both', () => {
  const project = school();
  project.teachers[0].roomIds = ['rsample101', 'rsample102'];
  project.teachers[2].roomIds = [];
  const result = repair(project);
  assert.deepEqual(room(result.project, '102').teacherIds, ['tsample002', 'tsample001'], 'the room now lists the teacher who listed it');
  assert.deepEqual(result.project.teachers[2].roomIds, ['rsample103'], 'the teacher now lists the room that listed them');
  assert.deepEqual(validate(result.project), []);
});

test('a reference to a teacher or subject that does not exist is dropped', () => {
  const project = school();
  room(project, '101').teacherIds.push('tnobody000');
  room(project, '101').subjectId = 'snothing00';
  project.teachers[3].subjectId = 'snothing00';
  group(project, '6A').days.dsample00a[0].teacherIds = ['tnobody000', 'tsample001'];
  const result = repair(project);
  assert.deepEqual(room(result.project, '101').teacherIds, ['tsample001']);
  assert.equal(room(result.project, '101').subjectId, null);
  assert.equal(result.project.teachers[3].subjectId, null);
  assert.deepEqual(group(result.project, '6A').days.dsample00a[0].teacherIds, ['tsample001']);
});

// ---- day types

test('the empty-B-Day rule survives repair: a B Day with nothing entered stays "same as A Day"', () => {
  const project = emptyProject();
  const result = repair(clone(project));
  assert.equal(result.project.dayTypes[1].own, false);
  assert.deepEqual(result.notes, []);
});

test('a day type marked "same as A Day" that carries days of its own becomes its own copy, and loses nothing', () => {
  const project = school();
  project.dayTypes[1].own = false;
  const result = repair(project);
  assert.equal(result.project.dayTypes[1].own, true);
  assert.deepEqual(result.project.groups, project.groups);
  assert.deepEqual(result.project.dayTypes[1].bells, project.dayTypes[1].bells);
  assert.ok(result.notes.some((note) => /B Day .* its own copy now/.test(note)));
});

test('when only some groups have a day for it, the others get a copy of their A Day, as they had in effect', () => {
  const project = school();
  project.dayTypes[1].own = false;
  for (const g of project.groups.slice(1)) delete g.days.dsample00b;
  const result = repair(project);
  assert.deepEqual(group(result.project, '6A').days.dsample00b, group(project, '6A').days.dsample00b);
  assert.deepEqual(group(result.project, '6B').days.dsample00b, group(project, '6B').days.dsample00a);
  assert.notEqual(group(result.project, '6B').days.dsample00b, group(result.project, '6B').days.dsample00a, 'a copy, not the same list');
  assert.deepEqual(validate(result.project), []);
});

test('an own day type with a missing day gets an empty one', () => {
  const project = school();
  delete group(project, '8B').days.dsample00b;
  const result = repair(project);
  assert.equal(group(result.project, '8B').days.dsample00b.length, 8);
  assert.ok(group(result.project, '8B').days.dsample00b.every((slot) => slot.room === null));
});

test('a project with no day types gets A Day and B Day', () => {
  const project = emptyProject();
  project.dayTypes = [];
  const result = repair(project);
  assert.deepEqual(result.project.dayTypes.map((d) => [d.name, d.own, d.bells.length]), [['A Day', true, 8], ['B Day', false, 8]]);
});

// ---- other parts

test('a traced image is marked missing when the device does not hold it, and found again when it does', () => {
  const project = school();
  project.building.floors[0].image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 800, height: 600, missing: false };
  assert.equal(repair(project).project, project, 'with no list of images, nothing is assumed');
  const gone = repair(project, { imageIds: new Set() });
  assert.equal(gone.project.building.floors[0].image.missing, true);
  assert.equal(gone.project.building.floors[0].image.x, 0, 'the position is kept');
  assert.match(gone.notes[0], /not on this device/);
  const back = repair(gone.project, { imageIds: new Set(['isample001']) });
  assert.equal(back.project.building.floors[0].image.missing, false);
});

test('unknown fields are kept, so a newer build\'s extras survive an older one', () => {
  const project = school();
  project.futureThing = { a: 1 };
  project.groups[0].futureFlag = true;
  project.settings.periods = 0;
  const result = repair(project);
  assert.deepEqual(result.project.futureThing, { a: 1 });
  assert.equal(result.project.groups[0].futureFlag, true);
});

test('a scenario keeps the changes that are well formed and drops the rest; it is not reconciled here', () => {
  const project = school();
  project.scenario = { name: 'Trial', changes: [{ kind: 'move', dayTypeId: 'dgone00000', groupId: 'ggone00000', period: 2, roomId: 'rgone00000' }, { kind: 'move' }, 'x'], compared: 7 };
  const result = repair(project);
  assert.deepEqual(result.project.scenario, { name: 'Trial', changes: [{ kind: 'move', dayTypeId: 'dgone00000', groupId: 'ggone00000', period: 2, roomId: 'rgone00000' }], compared: null });
});

test('a published model is accepted and stays a published model', () => {
  const project = school();
  const published = {
    format: 'sv2-published', version: 1, id: project.id, publishedAt: PINNED, staleAfter: PINNED,
    settings: { schoolName: 'x', periods: 8, periodWord: 'Period', defaultPassingSeconds: 240, secondsPerCell: 3, secondsPerStair: 8, timeFormat: '12h' },
    building: { floors: clone(project.building.floors).map((floor) => { delete floor.image; return floor; }), connections: clone(project.building.connections) },
    subjects: clone(project.subjects), teachers: clone(project.teachers), dayTypes: clone(project.dayTypes),
    groups: clone(project.groups).map((g) => { delete g.headCount; return g; }),
    publish: { views: project.publish.views, teacherNamesOnMap: true },
  };
  const result = repair(published);
  assert.equal(result.project, published);
  assert.deepEqual(result.notes, []);
  for (const absent of ['accepted', 'scenario', 'onboarding', 'created']) assert.equal(absent in result.project, false, absent);
  assert.equal('headCount' in result.project.groups[0], false);
  assert.equal('passcode' in result.project.publish, false);
});
