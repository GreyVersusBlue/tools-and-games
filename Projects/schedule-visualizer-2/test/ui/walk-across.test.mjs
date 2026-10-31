// A late walk across a period that does not meet, as the checks, the cell
// card, the Travel tab and its print show it (ARCHITECTURE 17.3 and 17.8,
// SV2-79c): node test/ui/walk-across.test.mjs
//
// The school is the invented sample with a bell schedule, Testing, whose
// times are A Day's except that Period 3 does not meet and Period 4 starts a
// minute after Period 2 ends, so every walk from Period 2 to Period 4 has
// 1 min and the long ones are late. A teacher is given 7A's Period 2 and
// Period 4 so that a teacher walks across it too.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createPipeline } from '../../engine/worker.js';
import { checkSchedule } from '../../engine/checks.js';
import { teacherWalks, bellMoves } from '../../engine/crowd.js';
import { buildGraph } from '../../engine/graph.js';
import { defaultChoice, pictureOf, transitionsOf } from '../../ui/movement/model.js';
import { loadWords } from '../../ui/movement/card.js';
import { nothingBetweenParts } from '../../ui/movement/tables.js';
import { renderOutput } from '../../ui/prints/index.js';
import { school, PINNED } from '../engine/helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const TS = 'bsample0ts';
const ER = 'bsample0er';
const COACH = 'tsample002';

function time(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function testing(project, gap) {
  const bells = project.dayTypes[0].bells.map((bell) => ({ ...bell }));
  bells[2] = null;
  bells[3] = { start: time(9 * 60 + 40 + gap), end: time(10 * 60 + 28 + gap) };
  project.bellSchedules = [{ id: TS, name: 'Testing', short: '', bells, off: [2] }];
  return project;
}

function earlyRelease(project, off) {
  const bells = [];
  for (let p = 0; p < 8; p += 1) bells.push(off.includes(p) ? null : { start: time(480 + 33 * p), end: time(510 + 33 * p) });
  project.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells, off }];
  return project;
}

function withTeacher(project, periods) {
  const group = project.groups.find((each) => each.id === 'gsample07a');
  for (const period of periods) group.days[A][period].teacherIds = [COACH];
  return project;
}

function findings(project) {
  const results = createPipeline().run(project);
  return { results, found: checkSchedule(project, results.walks) };
}

function ofKind(result, kind) {
  return result.findings.filter((finding) => finding.kind === kind);
}

test('a late group walk across a middle off period names both periods and the room at each end, with the schedule in its id', () => {
  const { found } = findings(testing(school(), 1));
  const walk = ofKind(found, 'group-walk').find((finding) => finding.id === 'group-walk:' + A + ':1:gsample07a:' + TS);
  assert.ok(walk, 'a finding for 7A\'s walk out of Period 2');
  assert.equal(walk.text, '7A needs 2 min 27 s to get from Room 302 after Period 2 to Room 102 for Period 4 on A Day with Testing bells, and the passing time is 1 min.');
  assert.equal(walk.where.period, 1);
  assert.equal(walk.where.roomId, 'rsample102', 'Show goes to the room it walks to');
  assert.deepEqual(walk.where.bellsIds, [TS]);
  // a walk that waits in the crowd says so, the same way a next-door walk does
  const crowded = ofKind(found, 'group-walk').find((finding) => finding.id === 'group-walk:' + A + ':1:gsample07c:' + TS);
  assert.match(crowded.text, /^7C needs 1 min 5 s to get from Room 203 after Period 2 to Room 201 for Period 4 on A Day with Testing bells, 20 s of it waiting in crowded corridors, and the passing time is 1 min\.$/);
});

test('a walk across that fits the passing time makes no finding, and the gap by the bells decides', () => {
  const roomy = findings(testing(school(), 56));
  assert.deepEqual(ofKind(roomy.found, 'group-walk').filter((finding) => finding.where.period === 1), []);
  assert.deepEqual(ofKind(roomy.found, 'teacher-walk'), []);
  const tight = findings(testing(school(), 1));
  assert.ok(ofKind(tight.found, 'group-walk').filter((finding) => finding.where.period === 1).length >= 4);
});

test('a teacher\'s walk across a middle off period is a walk, named by both periods and rooms', () => {
  const project = withTeacher(testing(school(), 1), [1, 3]);
  const { results, found } = findings(project);
  const across = results.walks.bells.teachers.filter((walk) => walk.teacherId === COACH && walk.toPeriod !== undefined);
  assert.deepEqual(across.map((walk) => [walk.period, walk.toPeriod, walk.passingSeconds, walk.late]), [[1, 3, 60, true]]);
  const walk = ofKind(found, 'teacher-walk').find((finding) => finding.id === 'teacher-walk:' + A + ':1:' + COACH + ':' + TS);
  assert.ok(walk, 'a teacher finding');
  assert.equal(walk.text, 'Mr. Brightwater needs 2 min 27 s to walk from Room 302 after Period 2 to Room 102 for Period 4 on A Day with Testing bells, before any crowding, and the passing time is 1 min.');
  assert.equal(walk.where.roomId, 'rsample102');
  assert.deepEqual(walk.where.groupIds, ['gsample07a']);
  // the walk into or out of the period that does not meet is still not one
  assert.deepEqual(bellMoves([{ groups: [] }], new Set([0])), []);
});

test('a figure for a walk across is for that walk only while the bells still leave the period off', () => {
  const project = withTeacher(testing(school(), 1), [1, 3]);
  const { results } = findings(project);
  const reached = (patch) => ({ groups: results.walks.groups, teachers: results.walks.teachers, bells: { groups: results.walks.bells.groups.map((walk) => ({ ...walk, ...patch })), teachers: results.walks.bells.teachers.map((walk) => ({ ...walk, ...patch })) } });
  const kinds = (walks) => ofKind(checkSchedule(project, walks), 'group-walk').concat(ofKind(checkSchedule(project, walks), 'teacher-walk')).filter((finding) => finding.where.period === 1);
  assert.ok(kinds(results.walks).length > 0);
  assert.deepEqual(kinds(reached({ toPeriod: 4 })), [], 'a figure that says it ended in Period 5');
  assert.deepEqual(kinds(reached({ toPeriod: undefined })), [], 'a figure that says nothing about where it ended is a next-door walk');
  const open = { ...project, bellSchedules: [{ ...project.bellSchedules[0], off: [] }] };
  assert.deepEqual(ofKind(checkSchedule(open, results.walks), 'group-walk').filter((finding) => finding.where.period === 1 && finding.where.bellsIds), [], 'Period 3 meets again: the walk is not across any more');
});

test('a walk late next door under the regular bells and across under Testing are two findings, not one', () => {
  const project = testing(school(), 1);
  const { results } = findings(project);
  const regular = results.walks.groups.find((walk) => walk.groupId === 'gsample07a' && walk.dayTypeId === A && walk.period === 1);
  const made = checkSchedule(project, { groups: [{ ...regular, late: true, total: 500, waiting: 0 }], teachers: [], bells: results.walks.bells });
  const mine = ofKind(made, 'group-walk').filter((finding) => finding.where.period === 1 && finding.where.dayTypeId === A && finding.text.startsWith('7A'));
  assert.equal(mine.length, 2, JSON.stringify(mine.map((finding) => [finding.id, finding.text])));
  assert.deepEqual(mine.map((finding) => finding.id).sort(), ['group-walk:' + A + ':1:gsample07a', 'group-walk:' + A + ':1:gsample07a:' + TS]);
});

// Findings are stored as accepted by their id, so a project with no walk across
// must give the findings it gave before this unit, byte for byte. The hashes
// are of checkSchedule's whole result, recorded from sv2 at 53d5d823 (before
// walks across were checked) on the invented sample.
test('a project with no middle off period gives byte-identical findings (the named case)', () => {
  const hash = (project) => createHash('sha256').update(JSON.stringify(findings(project).found)).digest('hex').slice(0, 16);
  assert.equal(hash(school()), 'd45a2300b043d4b2', 'no bell schedules');
  assert.equal(hash(earlyRelease(school(), [6, 7])), 'd132e9104a054d5c', 'trailing periods off');
  assert.equal(hash(earlyRelease(school(), [0, 1])), '13976cbe3196b7c3', 'leading periods off');
  assert.equal(hash(withTeacher(school(), [0, 1])), '901b8f5ef83ad479', 'a teacher late next door, no bell schedules');
  assert.equal(hash(withTeacher(earlyRelease(school(), [6, 7]), [0, 1])), '350b9af1aafb7509', 'a teacher late next door, trailing periods off');
});

test('the cell card names the walk a cell is busiest in by the walk across', () => {
  const project = testing(school(), 1);
  const world = { project, results: createPipeline().run(project), graph: buildGraph(project) };
  const choice = { ...defaultChoice(project), bellsId: TS };
  const picture = pictureOf(project, world.results, world.graph, choice);
  const card = { load: 5, unit: 'students', measure: 'busiest', peak: 1 };
  assert.equal(loadWords(card, picture, project.settings), '5 students at its busiest, Period 2 to Period 4.');
  assert.equal(loadWords({ ...card, peak: 4 }, picture, project.settings), '5 students at its busiest, Period 5 to Period 6.', 'a walk next door is as it was');
  const regular = pictureOf(project, world.results, world.graph, defaultChoice(project));
  assert.equal(loadWords(card, regular, project.settings), '5 students at its busiest, Period 2 to Period 3.', 'regular bells, nothing across');
  assert.equal(transitionsOf(project, A, TS).find((each) => each.period === 1).toPeriod, 3);
});

test('with one period meeting the Travel tab and its print say the bells leave nothing to walk between, not advice about rooms', () => {
  const project = earlyRelease(school(), [0, 1, 2, 3, 4, 5, 7]);
  const text = (parts) => parts.map((part) => part.text).join('');
  assert.equal(text(nothingBetweenParts(project, ER)), 'Only Period 7 meets under Early Release bells, so they leave nothing to walk between.');
  assert.deepEqual(nothingBetweenParts(project, null), null, 'eight periods meet under the regular bells');
  assert.deepEqual(nothingBetweenParts(earlyRelease(school(), [0, 1, 2, 3, 4, 5, 6, 7]), ER), null, 'none meeting is what nothingMeets says');
  assert.deepEqual(nothingBetweenParts(earlyRelease(school(), [0, 7]), ER), null, 'six meet');
  const oneDay = school();
  oneDay.settings.periods = 1;
  assert.equal(text(nothingBetweenParts(oneDay, null)), 'The day has one period, so the bells leave nothing to walk between.');

  const results = createPipeline().run(project);
  const graph = buildGraph(project);
  const html = renderOutput('travel-time', project, null, { now: PINNED, dayTypeId: A, bellsId: ER, movement: { project, results, graph } }).html;
  assert.ok(html.includes('Only Period 7 meets under Early Release bells, so they leave nothing to walk between.'), html.slice(0, 300));
  assert.equal(html.includes('give a group a room'), false, 'no advice about rooms');
});
