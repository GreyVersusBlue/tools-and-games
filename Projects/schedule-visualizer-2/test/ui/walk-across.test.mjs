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
import { checkSchedule, followAcceptedWalks } from '../../engine/checks.js';
import { suggestionCandidates, suggest } from '../../engine/suggest.js';
import { acceptFinding } from '../../engine/actions.js';
import { teacherWalks, bellMoves } from '../../engine/crowd.js';
import { buildGraph } from '../../engine/graph.js';
import { defaultChoice, pictureOf, transitionsOf } from '../../ui/movement/model.js';
import { loadWords } from '../../ui/movement/card.js';
import { nothingBetweenParts } from '../../ui/movement/tables.js';
import { renderOutput } from '../../ui/prints/index.js';
import { school, ctx, PINNED } from '../engine/helpers.mjs';

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
  const walk = ofKind(found, 'group-walk').find((finding) => finding.id === 'group-walk:' + A + ':1:gsample07a:' + TS + ':to3');
  assert.ok(walk, 'a finding for 7A\'s walk out of Period 2');
  assert.equal(walk.text, '7A needs 2 min 27 s to get from Room 302 after Period 2 to Room 102 for Period 4 on A Day with Testing bells, and the passing time is 1 min.');
  assert.equal(walk.where.period, 1);
  assert.equal(walk.where.roomId, 'rsample102', 'Show goes to the room it walks to');
  assert.deepEqual(walk.where.bellsIds, [TS]);
  // a walk that waits in the crowd says so, the same way a next-door walk does
  const crowded = ofKind(found, 'group-walk').find((finding) => finding.id === 'group-walk:' + A + ':1:gsample07c:' + TS + ':to3');
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
  const walk = ofKind(found, 'teacher-walk').find((finding) => finding.id === 'teacher-walk:' + A + ':1:' + COACH + ':' + TS + ':to3');
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
  assert.deepEqual(mine.map((finding) => finding.id).sort(), ['group-walk:' + A + ':1:gsample07a', 'group-walk:' + A + ':1:gsample07a:' + TS + ':to3']);
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

// SV2-79d, from SV2-79c's review (probe3.mjs): the id of a walk across ends with
// the period it reaches. Three projects whose Testing bells put Period 7A's
// next meeting at Period 4, 5 and 6 would all have had one id before.
function reaching(offs, reach) {
  const project = school();
  const bells = project.dayTypes[0].bells.map((bell) => ({ ...bell }));
  for (const off of offs) bells[off] = null;
  bells[reach] = { start: time(9 * 60 + 41), end: time(10 * 60 + 30) };
  project.bellSchedules = [{ id: TS, name: 'Testing', short: '', bells, off: offs }];
  return project;
}

const REACHES = [[[2], 3], [[2, 3], 4], [[2, 3, 4], 5]];

test('a walk across ends its id with the period it reaches, so an acceptance does not carry to a walk that goes elsewhere', () => {
  const idOf = (project) => {
    const { found } = findings(project);
    const mine = ofKind(found, 'group-walk').filter((finding) => finding.where.period === 1 && finding.where.dayTypeId === A && finding.where.groupIds[0] === 'gsample07a');
    assert.equal(mine.length, 1);
    return mine[0].id;
  };
  const ids = REACHES.map(([offs, reach]) => idOf(reaching(offs, reach)));
  assert.deepEqual(ids, ['group-walk:' + A + ':1:gsample07a:' + TS + ':to3', 'group-walk:' + A + ':1:gsample07a:' + TS + ':to4', 'group-walk:' + A + ':1:gsample07a:' + TS + ':to5']);
  // the walk to Period 4 accepted, the project then walks to Period 5 instead
  const accepted = acceptFinding(reaching([2], 3), { findingId: ids[0], reason: 'Early start' }, ctx());
  const same = checkSchedule(accepted, findings(accepted).results.walks);
  assert.deepEqual(same.accepted.map((finding) => finding.id), [ids[0]], 'the walk that was accepted stays accepted');
  const moved = { ...reaching([2, 3], 4), accepted: accepted.accepted };
  const after = checkSchedule(moved, findings(moved).results.walks);
  assert.deepEqual(after.accepted, [], 'a walk to Period 5 is not the walk accepted');
  assert.ok(after.findings.some((finding) => finding.id === ids[1]), 'it counts on its own');
  assert.deepEqual(after.gone.map((record) => record.findingId), [ids[0]], 'the old acceptance is listed as gone');
  // a record follows a finding only to the same period
  const record = [{ findingId: 'group-walk:' + A + ':1:gsample07a:' + ER + ':to4', reason: 'x', at: PINNED }];
  const finding = (id, bellsIds) => ({ id, kind: 'group-walk', where: { bellsIds } });
  assert.equal(followAcceptedWalks([finding('group-walk:' + A + ':1:gsample07a:' + TS + ':to4', [ER])], record)[0].id, 'group-walk:' + A + ':1:gsample07a:' + ER + ':to4', 'the same period: followed');
  assert.equal(followAcceptedWalks([finding('group-walk:' + A + ':1:gsample07a:' + TS + ':to5', [ER])], record)[0].id, 'group-walk:' + A + ':1:gsample07a:' + TS + ':to5', 'another period: not followed');
  assert.equal(followAcceptedWalks([finding('group-walk:' + A + ':1:gsample07a:' + TS, [ER])], record)[0].id, 'group-walk:' + A + ':1:gsample07a:' + TS, 'a next-door walk: not followed');
});

test('a walk across carries toPeriod in where, and its suggestions swap and move toward the period it reaches', () => {
  for (const [offs, reach] of REACHES) {
    const project = reaching(offs, reach);
    const { found } = findings(project);
    const walks = found.findings.filter((finding) => finding.kind === 'group-walk' && finding.where.toPeriod !== undefined);
    assert.ok(walks.length > 0);
    for (const walk of walks) {
      assert.equal(walk.where.toPeriod, reach, walk.id);
      assert.ok(walk.id.endsWith(':to' + reach), walk.id);
      const candidates = suggestionCandidates(project, walk);
      const first = candidates[0].change;
      assert.deepEqual([first.kind, first.periodA, first.periodB], ['swapPeriods', walk.where.period, reach], 'the first swap is the walk\'s own two ends: ' + walk.id);
    }
  }
  // a next-door walk has no toPeriod
  const { found } = findings(school());
  assert.deepEqual(ofKind(found, 'group-walk').filter((finding) => finding.where.toPeriod !== undefined), []);
});

test('with Testing bells every suggestion for a walk across names the period it reaches, never the period that does not meet', () => {
  const project = testing(school(), 1);
  const { found } = findings(project);
  const walk = ofKind(found, 'group-walk').find((finding) => finding.id === 'group-walk:' + A + ':1:gsample07a:' + TS + ':to3');
  const slots = suggestionCandidates(project, walk).map((candidate) => candidate.change);
  assert.deepEqual(slots.slice(0, 1).map((change) => [change.periodA, change.periodB]), [[1, 3]], 'Period 2 and Period 4');
  const said = suggest(project, walk).suggestions;
  assert.ok(said.length > 0);
  for (const suggestion of said) assert.equal(/Period 3\b/.test(suggestion.text), false, suggestion.text);
});

test('a teacher walk across with late: false makes no finding, and with late: true makes one', () => {
  const project = withTeacher(testing(school(), 1), [1, 3]);
  const { results } = findings(project);
  const quiet = (late) => ({ groups: results.walks.groups, teachers: results.walks.teachers, bells: { groups: [], teachers: results.walks.bells.teachers.map((walk) => (walk.teacherId === COACH && walk.toPeriod !== undefined ? { ...walk, late } : walk)) } });
  assert.equal(ofKind(checkSchedule(project, quiet(true)), 'teacher-walk').length, 1, 'the control');
  assert.deepEqual(ofKind(checkSchedule(project, quiet(false)), 'teacher-walk'), []);
});

test('a teacher with a free meeting period between the two taught periods has no walk across', () => {
  const teacher = 'tsample012';
  const across = (periods) => {
    const project = testing(school(), 1);
    const group = project.groups.find((each) => each.id === 'gsample07a');
    for (const period of periods) group.days[A][period].teacherIds = [teacher];
    const { results, found } = findings(project);
    return {
      figures: results.walks.bells.teachers.filter((walk) => walk.teacherId === teacher && walk.toPeriod !== undefined),
      found: ofKind(found, 'teacher-walk').filter((finding) => finding.where.teacherId === teacher && finding.where.toPeriod !== undefined),
    };
  };
  const control = across([1, 3]);
  assert.equal(control.figures.length, 1, 'taught in Period 2 and Period 4, Period 3 off: a walk across');
  assert.equal(control.found.length, 1);
  const free = across([1, 4]);
  assert.deepEqual(free.figures, [], 'Period 4 meets and is free: the time is the teacher\'s, no walk across');
  assert.deepEqual(free.found, []);
});

test('the same room at both ends of a walk across is no walk', () => {
  const project = withTeacher(testing(school(), 1), [1, 3]);
  const group = project.groups.find((each) => each.id === 'gsample07a');
  const isAcross = (finding) => finding.where.dayTypeId === A && finding.where.period === 1 && finding.where.toPeriod !== undefined;
  const before = findings(project);
  assert.ok(ofKind(before.found, 'group-walk').some((finding) => isAcross(finding) && finding.where.groupIds[0] === 'gsample07a'), 'the control');
  assert.ok(ofKind(before.found, 'teacher-walk').some(isAcross), 'the control, a teacher');
  group.days[A][3].room = group.days[A][1].room;
  const after = findings(project);
  assert.deepEqual(ofKind(after.found, 'group-walk').filter((finding) => isAcross(finding) && finding.where.groupIds[0] === 'gsample07a'), []);
  assert.deepEqual(ofKind(after.found, 'teacher-walk').filter(isAcross), []);
});

test('a one-period day with a bell schedule chosen takes the one-period sentence', () => {
  const text = (parts) => parts.map((part) => part.text).join('');
  const oneDay = earlyRelease(school(), []);
  oneDay.settings.periods = 1;
  assert.equal(text(nothingBetweenParts(oneDay, ER)), 'The day has one period, so the bells leave nothing to walk between.');
  assert.equal(text(nothingBetweenParts(oneDay, null)), 'The day has one period, so the bells leave nothing to walk between.');
  // and an eight-period day with seven off still says which one meets
  assert.equal(text(nothingBetweenParts(earlyRelease(school(), [0, 1, 2, 3, 4, 5, 7]), ER)), 'Only Period 7 meets under Early Release bells, so they leave nothing to walk between.');
});
