// Movement's teacher mode and its two filters, the pure parts (SV2-153;
// ARCHITECTURE 23.7 and 23.12, DESIGN 17.2, 17.3, 17.7): settleChoice's new
// fields, pictureOf for a teacher and with Going to or Rooms of subject set,
// the sentences, the cell card's two figures, and the lanes' dash.
// Plain Node, no page.
//
// Two buildings: the three-room corridor of teacher-trail.test.mjs with one
// teacher whose day each case lays out, and the two-halls fixture with
// subjects given to its rooms.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { createPipeline } from '../../engine/worker.js';
import { emptySlot, emptyBells, findRoom } from '../../engine/schema.js';
import { defaultChoice, settleChoice, pictureOf, sentenceOf, cellCard, shownGroups, fitsOf, teacherWalksOn } from '../../ui/movement/model.js';
import { buildLanes } from '../../ui/surface/overlays/lanes.js';
import { assertValid } from '../engine/helpers.mjs';
import { planProject, roomId } from '../fixtures/buildings/plans.mjs';
import { twoHalls } from '../fixtures/buildings/two-halls.mjs';

const VERSIONS = { geometry: 1, building: 1, schedule: 1 };
const TEACHER = 'tplan00001';
const PERIODS = 7;

function bellTime(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

// One teacher on a corridor of three rooms; `layout` is, per period, the room numbers taught in (none: a free period).
function lessons(layout, options) {
  const opts = options || {};
  const project = planProject([['.AAA.BBB.CCC.', '#############']]);
  project.settings.periods = PERIODS;
  const bells = Array.from({ length: PERIODS }, (unused, p) => ({ start: bellTime(480 + p * 44), end: bellTime(480 + p * 44 + 40) }));
  for (const dayType of project.dayTypes) dayType.bells = dayType.own ? bells.map((bell) => ({ ...bell })) : emptyBells(PERIODS);
  project.subjects = [{ id: 'sjmath0001', code: 'MA', name: 'Math <b>', colour: '#aa3300' }];
  project.teachers = [{ id: TEACHER, name: opts.name || 'Ms. Okafor', subjectId: opts.subject === false ? null : 'sjmath0001', roomIds: [], notes: '' }];
  const dayId = project.dayTypes[0].id;
  const lines = [];
  layout.forEach((rooms, period) => rooms.forEach((room) => lines.push({ period, room })));
  project.groups = lines.map(({ period, room }, index) => {
    const day = Array.from({ length: PERIODS }, () => emptySlot());
    day[period] = { ...emptySlot(), room: roomId(room), teacherIds: [TEACHER] };
    return { id: 'gplan' + String(index + 1).padStart(5, '0'), name: '7-' + (index + 1), grade: '', headCount: null, colour: '#3366cc', days: { [dayId]: day } };
  });
  assertValid(project);
  return project;
}

function seen(project, patch) {
  const results = createPipeline().run(project, VERSIONS);
  const graph = buildGraph(project);
  const choice = { ...defaultChoice(project), ...patch };
  const picture = pictureOf(project, results, graph, choice);
  return { results, graph, picture, sentence: sentenceOf(project, picture, []) };
}

function textOf(sentence) {
  return sentence.parts.map((part) => part.text).join('');
}

// ---- settleChoice

test('settleChoice: the new fields start empty, and a choice made before them is settled to them', () => {
  const project = lessons([['1A']]);
  const fresh = defaultChoice(project);
  assert.equal(fresh.teacherId, null);
  assert.equal(fresh.toRoomId, null);
  assert.equal(fresh.subjectId, null);
  const old = { who: 'all', grade: '', groupIds: [], dayTypeId: project.dayTypes[0].id, bellsId: null, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };
  const settled = settleChoice(project, old);
  assert.deepEqual([settled.teacherId, settled.toRoomId, settled.subjectId], [null, null, null]);
});

test('settleChoice: who may be a teacher, and a teacher, room or subject the project lacks is put right to none', () => {
  const project = lessons([['1A']]);
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: TEACHER }).who, 'teacher');
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: TEACHER }).teacherId, TEACHER);
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: 'tgone00000' }).teacherId, null, 'a teacher that is gone');
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: 5 }).teacherId, null);
  assert.equal(settleChoice(project, { toRoomId: roomId('1B') }).toRoomId, roomId('1B'));
  assert.equal(settleChoice(project, { toRoomId: 'rgone00000' }).toRoomId, null, 'a room that is gone');
  assert.equal(settleChoice(project, { toRoomId: '' }).toRoomId, null);
  assert.equal(settleChoice(project, { subjectId: 'sjmath0001' }).subjectId, 'sjmath0001');
  assert.equal(settleChoice(project, { subjectId: '' }).subjectId, '', 'no subject is a choice of its own');
  assert.equal(settleChoice(project, { subjectId: 'sgone00000' }).subjectId, null, 'a subject that is gone');
  assert.equal(settleChoice(project, { who: 'nobody' }).who, 'all');
});

test('settleChoice: a transition is kept for a teacher where a walk can leave the period, else dropped', () => {
  const project = lessons([['1A']]);
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: TEACHER, transition: 2 }).transition, 2);
  assert.equal(settleChoice(project, { who: 'teacher', teacherId: TEACHER, transition: PERIODS - 1 }).transition, null, 'none leaves the last period');
});

test('shownGroups: a teacher shows no groups', () => {
  const project = lessons([['1A']]);
  assert.deepEqual(shownGroups(project, settleChoice(project, { who: 'teacher', teacherId: TEACHER })), []);
});

// ---- a teacher's day

test('a teacher\'s day: solid between consecutive periods, dashed across a free period, one lane set of one walker in the teacher\'s id', () => {
  const project = lessons([['1A'], ['1B'], [], ['1C'], [], [], []]);
  const { picture, sentence } = seen(project, { who: 'teacher', teacherId: TEACHER });
  assert.equal(picture.mode, 'teacher');
  assert.equal(picture.drawn, 2);
  assert.equal(picture.load, null, 'no load colouring');
  assert.equal(picture.bands, null);
  assert.deepEqual(picture.groups, []);
  const lanes = picture.lanes.floors.values().next().value;
  assert.deepEqual(lanes.map((lane) => [lane.groupId, lane.dash]).sort((a, b) => Number(a[1]) - Number(b[1])), [[TEACHER, false], [TEACHER, true]]);
  assert.equal(picture.teacher.colour, '#aa3300', 'the subject\'s colour');
  assert.match(textOf(sentence), /^Ms\. Okafor’s day on A Day: 1 walk between classes, \d+ s? ?(\d+ s)?.*\(walking alone, not slowed by the crowd\), and 1 walk with a free period between\./);
  assert.equal(sentence.parts.find((part) => part.text === 'Ms. Okafor').name, true, 'the name is marked as typed');
});

test('a teacher with no subject has no colour of its own (the page uses ink)', () => {
  const project = lessons([['1A'], ['1B']], { subject: false });
  assert.equal(seen(project, { who: 'teacher', teacherId: TEACHER }).picture.teacher.colour, null);
});

test('a teacher\'s pills say the period and the groups as typed, one on each room of the day', () => {
  const project = lessons([['1A'], ['1B']]);
  project.groups[0].name = '7-<i>1</i>';
  const { picture } = seen(project, { who: 'teacher', teacherId: TEACHER });
  const pills = [...picture.markers.values()].flat().flatMap((marker) => marker.pills.map((pill) => pill.text)).sort();
  assert.deepEqual(pills, ['P1 · 7-<i>1</i>', 'P2 · 7-2']);
});

test('a teacher with one room all day has nothing to walk, and the sentence says where they teach', () => {
  const project = lessons([['1B'], ['1B'], ['1B']]);
  const { picture, sentence } = seen(project, { who: 'teacher', teacherId: TEACHER });
  assert.equal(picture.drawn, 0);
  assert.equal(textOf(sentence), 'Ms. Okafor teaches in Room 1B all day on A Day, so there is nothing to walk.');
  assert.equal(sentence.showMe, false);
});

test('a teacher with no class says so', () => {
  const project = lessons([[]]);
  assert.match(textOf(seen(project, { who: 'teacher', teacherId: TEACHER }).sentence), /^Ms\. Okafor has no class on A Day, so there is nothing to walk\.$/);
});

test('A teacher chosen with nobody picked yet shows nothing and says to choose one', () => {
  const project = lessons([['1A']]);
  const { picture, sentence } = seen(project, { who: 'teacher' });
  assert.equal(picture.mode, 'empty');
  assert.equal(picture.emptyBecause, 'teacher');
  assert.equal(textOf(sentence), 'Nothing is shown. Choose a teacher to see where they walk.');
});

test('one transition chosen draws only the walk out of that period; across a free period it counts under the period it leaves', () => {
  const project = lessons([['1A'], ['1B'], [], ['1C'], [], [], []]);
  const one = seen(project, { who: 'teacher', teacherId: TEACHER, transition: 1 });
  assert.equal(one.picture.drawn, 1, 'the walk out of Period 2 over the free Period 3');
  const lane = one.picture.lanes.floors.values().next().value;
  assert.deepEqual(lane.map((each) => each.dash), [true]);
  assert.match(textOf(one.sentence), /^Ms\. Okafor walks from Room 1B to Room 1C in Period 2 to Period 4: .*, with a free period between\./);
  const first = seen(project, { who: 'teacher', teacherId: TEACHER, transition: 0 });
  assert.equal(first.picture.drawn, 1);
  assert.deepEqual(first.picture.lanes.floors.values().next().value.map((each) => each.dash), [false]);
  assert.match(textOf(first.sentence), /^Ms\. Okafor walks from Room 1A to Room 1B in Period 1 to Period 2 \(8:40 to 8:44\): .* passing time\. It fits\./);
});

test('one transition where the teacher stays put says so, and draws nothing', () => {
  const project = lessons([['1B'], ['1B'], ['1A']]);
  const { picture, sentence } = seen(project, { who: 'teacher', teacherId: TEACHER, transition: 0 });
  assert.equal(picture.drawn, 0);
  assert.equal(textOf(sentence), 'Ms. Okafor stays in Room 1B from Period 1 to Period 2.');
});

test('a walk that does not fit is named with its rooms and the time it takes against the time there is; the figure of the walk is the pipeline\'s', () => {
  const project = lessons([['1A'], ['1C']]);
  for (const dayType of project.dayTypes) if (dayType.own) dayType.bells = dayType.bells.map((bell, p) => (p === 0 ? { start: bell.start, end: bell.end } : bell));
  // a passing time of 4 s: far too short for the walk from 1A to 1C
  project.dayTypes[0].bells[1] = { start: bellTime(480 + 40 + 0), end: bellTime(480 + 80) };
  project.settings.defaultPassingSeconds = 5;
  const { picture, sentence, results } = seen(project, { who: 'teacher', teacherId: TEACHER });
  const [walk] = teacherWalksOn(picture);
  assert.equal(walk.late, true);
  assert.equal(fitsOf(project.settings, walk).state, 'no');
  assert.match(fitsOf(project.settings, walk).text, /^no, \d+ s over$|^no, \d+ min( \d+ s)? over$/);
  assert.equal(sentence.showMe, true);
  assert.match(textOf(sentence), /1 does not fit: Period 1 to Period 2, Room 1A to Room 1C, .* for a .* passing time\./);
  assert.ok(results);
});

test('fitsOf: yes, no with the time over, a free period with its length, and a walk not worked out yet', () => {
  const settings = lessons([['1A']]).settings;
  const base = { period: 0, toPeriod: 1, across: [], failed: false, walking: 100, riding: 0, passingSeconds: 240, late: false };
  assert.equal(fitsOf(settings, base).text, 'yes');
  assert.equal(fitsOf(settings, { ...base, walking: 250, late: true }).text, 'no, 10 s over');
  assert.equal(fitsOf(settings, { ...base, toPeriod: 3, across: [1, 2], passingSeconds: 3120, late: null }).text, 'yes, Period 2 and Period 3 are free (52 min)');
  assert.equal(fitsOf(settings, { ...base, toPeriod: 2, across: [1], passingSeconds: 3120, late: null }).text, 'yes, Period 2 is free (52 min)');
  assert.equal(fitsOf(settings, { ...base, walking: null, late: null }).text, 'not worked out yet');
  assert.equal(fitsOf(settings, { ...base, failed: true, walking: null }).text, 'no route');
});

// ---- the lanes' dash

test('buildLanes: a solid and a dashed walk between the same rooms are two lines; the same walk twice is one', () => {
  const project = lessons([['1A'], ['1C']]);
  const { picture } = seen(project, { who: 'teacher', teacherId: TEACHER });
  const route = teacherWalksOn(picture)[0].route;
  const lanes = buildLanes(project, [
    { groupId: TEACHER, rank: 0, route, dash: false },
    { groupId: TEACHER, rank: 0, route, dash: true },
    { groupId: TEACHER, rank: 0, route, dash: true },
  ]);
  assert.deepEqual(lanes.floors.values().next().value.map((lane) => lane.dash).sort(), [false, true]);
});

// ---- Going to and Rooms of subject

function halls() {
  const project = twoHalls({ periods: 4 });
  const [science] = project.subjects;
  for (const number of ['1A', '1E']) findRoom(project, roomId(number)).subjectId = science.id;
  project.subjects[0].name = 'Sci <i>& "Tech"</i>';
  assertValid(project);
  return { project, science };
}

test('Going to: only walks into the room are drawn, the groups shown are those who walk there, and the sentence counts them', () => {
  const { project } = halls();
  const all = seen(project, {});
  const into = seen(project, { toRoomId: roomId('1E') });
  assert.ok(into.picture.drawn > 0 && into.picture.drawn < all.picture.drawn);
  assert.ok(into.picture.groups.length > 0 && into.picture.groups.length < project.groups.length);
  assert.equal(into.picture.filter.walks, into.picture.filter.groups > 0 ? into.picture.filter.walks : 0);
  assert.match(textOf(into.sentence), /^Showing walks into Room 1E on A Day, all transitions: \d+ groups?, \d+ walks?\./);
  assert.equal(into.picture.load.max <= all.picture.load.max, true, 'the busiest and the scale are of those walks only');
  assert.ok(into.picture.filter.words.length > 0);
});

test('Rooms of subject: the subject\'s name is marked as typed, and a transition names itself in place of "all transitions"', () => {
  const { project, science } = halls();
  const one = seen(project, { subjectId: science.id, transition: 0 });
  const text = textOf(one.sentence);
  assert.match(text, /^Showing walks into Sci <i>& "Tech"<\/i> rooms on A Day, Period 1 to Period 2: \d+ groups?\./);
  assert.equal(one.sentence.parts.find((part) => part.text.startsWith('Sci')).name, true);
});

test('a filter with a group chosen or a grade says by whom', () => {
  const { project } = halls();
  const one = seen(project, { who: 'groups', groupIds: [project.groups[0].id, project.groups[1].id], toRoomId: roomId('1E') });
  assert.match(textOf(one.sentence), /^Showing walks into Room 1E by West 1 and West 2 on A Day/);
});

test('a room nobody meets in, and a room nobody walks into, say which', () => {
  const { project } = halls();
  // no group has 1H in any period
  for (const group of project.groups) for (const day of Object.values(group.days)) day.forEach((slot, p) => { if (slot.room === roomId('1H')) day[p] = { ...emptySlot(), room: roomId('1G') }; });
  const none = seen(project, { toRoomId: roomId('1H') });
  assert.equal(none.picture.mode, 'empty');
  assert.equal(none.picture.emptyBecause, 'filter');
  assert.equal(textOf(none.sentence), 'Room 1H has no class on A Day.');
  assert.equal(none.sentence.clearFilter, true);
  // a group already in 1A all day: it is in the room and nobody walks into it
  const still = twoHalls({ periods: 4, pattern: 'hhhh' });
  const st = seen(still, { toRoomId: roomId('1A') });
  assert.equal(st.picture.emptyBecause, 'filter');
  assert.equal(textOf(st.sentence), 'Nobody walks into Room 1A on A Day: West 1 is there from Period 1 and stays.');
  assert.equal(st.sentence.clearFilter, true);
  // a subject no room has
  const subjectless = seen(still, { subjectId: '' });
  assert.notEqual(subjectless.picture.emptyBecause, 'teacher');
});

test('a filter changes nothing for a teacher, and who is a teacher hides it', () => {
  const project = lessons([['1A'], ['1B']]);
  const plain = seen(project, { who: 'teacher', teacherId: TEACHER });
  const filtered = seen(project, { who: 'teacher', teacherId: TEACHER, toRoomId: roomId('1C'), subjectId: '' });
  assert.equal(filtered.picture.drawn, plain.picture.drawn);
  assert.equal(filtered.picture.filter, null);
  assert.equal(textOf(filtered.sentence), textOf(plain.sentence));
});

test('the cell card of a filtered picture says both figures: the walks into the room and everyone\'s', () => {
  const { project } = halls();
  const { results, graph, picture } = seen(project, { toRoomId: roomId('1E') });
  // the corridor cell with the most load among the walks into the room
  const floor = project.building.floors[0];
  let found = null;
  for (let cell = 0; cell < floor.width * floor.height && !found; cell += 1) {
    const info = cellCard(project, results, graph, picture, floor.id, cell);
    if (info && info.load > 0) found = info;
  }
  assert.ok(found, 'a cell some walk into 1E crosses');
  assert.ok(found.filter);
  assert.ok(found.everyone >= found.load, 'everyone\'s load is at least the filtered walks\'');
});

test('the cell card of a teacher\'s day names the walks that cross the cell, with no load', () => {
  const project = lessons([['1A'], ['1C']]);
  const { results, graph, picture } = seen(project, { who: 'teacher', teacherId: TEACHER });
  const route = teacherWalksOn(picture)[0].route;
  const at = route.cells[1];
  const info = cellCard(project, results, graph, picture, at.floorId, at.cell);
  assert.equal(info.teacher.walks.length, 1);
  assert.equal(info.teacher.walks[0].period, 0);
  assert.equal(info.load, 0);
});
