// A walk across periods that do not meet, and a bell schedule with no period
// meeting, as the movement view, its tables and CSV files, its prints and the
// scenario lab's names show them (ARCHITECTURE 17.3, SV2-79b): node test/ui/movement-across.test.mjs
//
// The school is the invented sample with a bell schedule, Assembly, whose
// times are A Day's and in which Period 3 does not meet, so the walk out of
// Period 2 is a walk into Period 4 over the 56 minutes between them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline, runResults } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { loads } from '../../engine/load.js';
import { routesByRun } from '../../engine/crowd.js';
import {
  defaultChoice, settleChoice, transitionsOf, pictureOf, sentenceOf, groupRows, failurePeriod, walkWords, walkNamed,
  nothingMeets, nothingMeetsParts, followerWords,
} from '../../ui/movement/model.js';
import { travelDay, transitionRows, dayRows, transitionsCsv, dayCsv, slowestPeriod } from '../../ui/movement/tables.js';
import { rankedPlaces, hotspotRows } from '../../ui/movement/hotspots.js';
import { transitionChoices, transitionName } from '../../ui/scenarios/model.js';
import { whenWords } from '../../ui/scenarios/difference.js';
import { renderOutput } from '../../ui/prints/index.js';
import { school, clone, PINNED } from '../engine/helpers.mjs';

const NOW = { now: PINNED };
const A = 'dsample00a';
const B = 'dsample00b';
const AS = 'bsample0as';

function withAssembly(off) {
  const project = school();
  project.bellSchedules = [{ id: AS, name: 'Assembly <b>', short: '', bells: project.dayTypes[0].bells.map((bell) => (bell ? { ...bell } : null)), off: off || [2] }];
  return project;
}

function derive(project) {
  return { project, results: createPipeline().run(project), graph: buildGraph(project) };
}

function picture(world, patch) {
  return pictureOf(world.project, world.results, world.graph, { ...defaultChoice(world.project), ...patch });
}

function words(sentence) {
  return sentence.parts.map((part) => part.text).join('');
}

function sum(list, pick) {
  return list.reduce((total, each) => total + pick(each), 0);
}

const assembly = derive(withAssembly());
const plain = derive(school());

test('the strip: the walk out of Period 2 is "Period 2 to Period 4", timed by the gap, and nothing leaves or enters Period 3', () => {
  const strip = transitionsOf(assembly.project, A, AS);
  assert.deepEqual(strip.map((each) => each.period), [0, 1, 3, 4, 5, 6]);
  assert.deepEqual(strip[1], { period: 1, toPeriod: 3, name: 'Period 2 to Period 4', short: '2 to 4', from: '09:40', to: '10:36', times: '9:40 to 10:36', seconds: 56 * 60 });
  assert.equal(strip.filter((each) => each.toPeriod !== undefined).length, 1, 'only the walk across says where it ends');
  assert.deepEqual(strip[0], transitionsOf(assembly.project, A)[0], 'next door, a transition is what it is without bells');
  // the same bells with Period 3 meeting are the regular seven
  assert.deepEqual(transitionsOf(assembly.project, A), transitionsOf(plain.project, A));
  assert.equal(walkWords(assembly.project.settings, 1, 3), 'Period 2 to Period 4');
  assert.equal(walkWords(assembly.project.settings, 1), 'Period 2 to Period 3');
  assert.equal(walkNamed(assembly.project.settings, strip, 1), 'Period 2 to Period 4');
  assert.equal(walkNamed(assembly.project.settings, strip, 4), 'Period 5 to Period 6');
  // leading and trailing periods that do not meet leave the strip shorter and cross nothing
  const trailing = transitionsOf(withAssembly([6, 7]), A, AS);
  assert.deepEqual(trailing.map((each) => each.period), [0, 1, 2, 3, 4]);
  assert.equal(trailing.some((each) => each.toPeriod !== undefined), false);
  assert.deepEqual(transitionsOf(withAssembly([0, 2]), A, AS).map((each) => [each.period, each.toPeriod]), [[1, 3], [3, undefined], [4, undefined], [5, undefined], [6, undefined]]);
});

test('the choice: a walk across can be chosen; one into or out of Period 3 falls back to all', () => {
  const kept = settleChoice(assembly.project, { ...defaultChoice(assembly.project), bellsId: AS, transition: 1 });
  assert.equal(kept.transition, 1);
  assert.equal(settleChoice(assembly.project, { ...kept, transition: 2 }).transition, null);
  assert.equal(settleChoice(assembly.project, { ...kept, bellsId: null, transition: 2 }).transition, 2, 'with the regular bells Period 3 meets');
});

test('the picture: the walk across is drawn and named in the first line, with the clock of the gap', () => {
  const one = picture(assembly, { who: 'all', bellsId: AS, transition: 1 });
  assert.ok(one.drawn > 0, 'routes are drawn');
  assert.equal(one.transition.name, 'Period 2 to Period 4');
  assert.match(words(sentenceOf(assembly.project, one, [])), /^Showing 8 groups on A Day with Assembly <b> bells, Period 2 to Period 4 \(9:40 to 10:36\)\. /);
  // the whole day draws the walk across among the others
  const day = picture(assembly, { bellsId: AS });
  assert.ok(day.drawn > picture(assembly, { bellsId: AS, transition: 0 }).drawn);
  assert.deepEqual(day.failed, []);
});

test('the busiest load and the legend are the bell run\'s: figures against runResults', () => {
  const run = runResults(assembly.results, A, AS);
  const day = picture(assembly, { bellsId: AS });
  assert.equal(day.load.max, run.loads.max.busiest, 'the busiest cell');
  const rows = groupRows(assembly.project, assembly.results, day);
  for (const row of rows) {
    const mine = run.crowd.transitions.flatMap((transition) => transition.groups.filter((walker) => walker.groupId === row.group.id));
    assert.equal(row.walks, mine.length, row.group.name);
    assert.equal(row.walking, sum(mine, (walker) => walker.walking), row.group.name);
    assert.equal(row.waiting, sum(mine, (walker) => walker.waiting), row.group.name);
  }
  assert.ok(rows.some((row) => row.walks === 6 || row.walks === 5), 'a group that changes rooms in six of the six transitions');
});

test('the Travel tab: rows, CSV files and the slowest walk are the walks runResults holds, the walk across included', () => {
  const run = runResults(assembly.results, A, AS);
  const across = transitionRows(assembly.project, assembly.results, A, 1, AS);
  assert.ok(across.rows.length > 0);
  assert.equal(across.rows.length, run.walks.groups.filter((walk) => walk.period === 1).length);
  assert.ok(across.rows.every((row) => row.toPeriod === 3 && row.passingSeconds === 56 * 60));
  assert.equal(sum(across.rows, (row) => row.total), sum(run.walks.groups.filter((walk) => walk.period === 1), (walk) => walk.total));
  assert.deepEqual(transitionRows(assembly.project, assembly.results, A, 2, AS).rows, [], 'nobody leaves Period 3');
  const days = dayRows(assembly.project, assembly.results, A, AS);
  assert.equal(sum(days, (row) => row.total), sum(run.walks.groups, (walk) => walk.total), 'the day tables add up to the run\'s walks');
  assert.equal(sum(days, (row) => row.walks), run.walks.groups.length);
  const csv = transitionsCsv(assembly.project, assembly.results, A, AS);
  assert.equal(csv.length - 1, run.walks.groups.length, 'a row for every walk that happens');
  assert.equal(sum(csv.slice(1), (row) => row[8]), sum(run.walks.groups, (walk) => walk.total));
  assert.equal(csv.filter((row) => row[1] === 'Period 2 to Period 4').length, across.rows.length);
  assert.equal(csv.some((row) => /Period 3/.test(row[1])), false, 'Period 3 is in no transition');
  const day = dayCsv(assembly.project, assembly.results, A, AS);
  assert.equal(sum(day.slice(1), (row) => row[5]), sum(run.walks.groups, (walk) => walk.total));
  for (const row of days) assert.match(day.find((cells) => cells[1] === row.group.name)[7], /^Period \d to Period \d$/);
  assert.ok(slowestPeriod(assembly.results, A, AS) !== 2);
});

test('the Hotspots tab ranks the bell run: its busiest place is the run\'s busiest load, by the transition it peaks in', () => {
  const run = runResults(assembly.results, A, AS);
  const day = picture(assembly, { bellsId: AS });
  const rows = hotspotRows(assembly.project, assembly.results, assembly.graph, day);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].load, run.loads.max.busiest);
  assert.ok(rows.every((row) => row.peak === null || row.peak !== 2));
  const regular = hotspotRows(plain.project, plain.results, plain.graph, picture(plain, {}));
  assert.notDeepEqual(rows.map((row) => row.load), regular.map((row) => row.load));
  // and the ranking asked by hand agrees
  const ask = rankedPlaces(assembly.project, assembly.results, assembly.graph, { dayTypeId: A, bellsId: AS, groups: assembly.project.groups, load: run.loads, max: run.loads.max.busiest, transition: null, measure: 'busiest', transitions: day.transitions });
  assert.deepEqual(ask.map((row) => row.id), rows.map((row) => row.id));
});

test('failurePeriod: a route that fails at its far end opens the period it was walking into', () => {
  assert.equal(failurePeriod({ period: 1, route: { end: 'to' } }), 2);
  assert.equal(failurePeriod({ period: 1, toPeriod: 3, route: { end: 'to' } }), 3);
  assert.equal(failurePeriod({ period: 1, toPeriod: 3, route: { end: 'from' } }), 1);
});

test('no period meets: the first line, the Travel tab\'s words, the prints and the lab say so', () => {
  const none = derive(withAssembly([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(nothingMeets(none.project, AS), true);
  assert.equal(nothingMeets(none.project, null), false);
  assert.equal(nothingMeets(assembly.project, AS), false);
  assert.equal(nothingMeetsParts(none.project, AS).map((part) => part.text).join(''), 'No period meets under Assembly <b> bells.');
  assert.equal(nothingMeetsParts(none.project, AS)[1].name, true, 'the name is set as typed');
  const day = picture(none, { bellsId: AS });
  assert.deepEqual(day.transitions, []);
  assert.equal(words(sentenceOf(none.project, day, [])), 'Showing 8 groups on A Day with Assembly <b> bells, all transitions. No period meets under Assembly <b> bells.');
  assert.equal(sentenceOf(none.project, day, []).showMe, false);
  for (const options of [{ dayTypeId: A, bellsId: AS }, { bellsId: AS }]) {
    const travel = renderOutput('travel-time', none.project, null, { ...NOW, ...options, movement: none }).html;
    assert.equal((travel.match(/No period meets under Assembly &lt;b&gt; bells\./g) || []).length, options.dayTypeId ? 1 : 2, JSON.stringify(options));
    assert.doesNotMatch(travel, /Nobody walks anywhere/);
    assert.doesNotMatch(travel, /<table/);
    const congestion = renderOutput('congestion', none.project, null, { ...NOW, ...options, movement: none }).html;
    assert.equal((congestion.match(/No period meets under Assembly &lt;b&gt; bells\./g) || []).length, 2, 'a section for each day type');
    assert.doesNotMatch(congestion, /Nobody crosses a corridor/);
  }
  // the same project under its regular bells is not told that
  assert.doesNotMatch(renderOutput('travel-time', none.project, null, { ...NOW, dayTypeId: A, movement: none }).html, /No period meets/);
  // and the lab: no transition to narrow to
  assert.deepEqual(transitionChoices(none.project, AS), []);
});

test('the travel-time print honours the bells without a day type: every day type under them', () => {
  const html = renderOutput('travel-time', assembly.project, null, { ...NOW, bellsId: AS, movement: assembly }).html;
  assert.equal(html.includes('A Day with Assembly &lt;b&gt; bells'), true);
  assert.equal(html.includes('B Day with Assembly &lt;b&gt; bells'), true);
  assert.equal(html.includes('Period 2 to Period 4'), true);
  assert.equal(/Period 2 to Period 3|Period 3 to Period 4/.test(html), false, 'nothing leaves or enters Period 3');
  // the same sheet as with the day types named, one after the other
  const run = runResults(assembly.results, B, AS);
  assert.ok(run.walks.groups.length > 0);
  const one = renderOutput('travel-time', assembly.project, null, { ...NOW, dayTypeId: A, bellsId: AS, movement: assembly }).html;
  assert.equal(one.includes('B Day with'), false);
});

test('a project with no bell schedules prints and tabulates as it did: the bells asked for change nothing', () => {
  for (const id of ['travel-time', 'congestion']) {
    const regular = renderOutput(id, plain.project, null, { ...NOW, movement: plain }).html;
    for (const bellsId of [null, undefined, 'bnothere']) {
      assert.equal(renderOutput(id, plain.project, null, { ...NOW, bellsId, movement: plain }).html, regular, id + ' ' + bellsId);
      assert.equal(renderOutput(id, plain.project, null, { ...NOW, dayTypeId: A, bellsId, movement: plain }).html, renderOutput(id, plain.project, null, { ...NOW, dayTypeId: A, movement: plain }).html, id + ' ' + bellsId);
    }
    assert.equal(regular.includes('bells'), false, id + ' says nothing of bells');
    assert.equal(regular.includes('toPeriod'), false);
  }
  const csv = transitionsCsv(plain.project, plain.results, A);
  assert.equal(csv.length, 1 + 8 * 7);
  assert.deepEqual(csv[1].slice(0, 2), ['A Day', 'Period 1 to Period 2']);
  assert.equal(JSON.stringify(transitionRows(plain.project, plain.results, A, 0)).includes('toPeriod'), false);
  assert.equal(JSON.stringify(dayRows(plain.project, plain.results, A)).includes('toPeriod'), false);
});

test('the congestion print names what each follower is the same as, and that the figures are the bell run\'s', () => {
  const project = withAssembly();
  project.dayTypes.push({ id: 'dsample00c', name: 'C Day', short: '', own: false, sameAs: B, bells: Array(8).fill(null) });
  project.dayTypes.push({ id: 'dsample00d', name: 'D Day', short: '', own: false, sameAs: A, bells: Array(8).fill(null) });
  const world = derive(project);
  const mixed = renderOutput('congestion', project, null, { ...NOW, movement: world }).html;
  assert.match(mixed, /C Day \(the same as B Day\) and D Day \(the same as A Day\) have no figures of their own\./);
  assert.doesNotMatch(mixed, /the same as A Day and have/, 'not all the base');
  const under = renderOutput('congestion', project, null, { ...NOW, bellsId: AS, movement: world }).html;
  assert.match(under, /have no figures of their own\. Their figures are the Assembly &lt;b&gt; bells run’s of B Day and A Day\./);
  const travel = renderOutput('travel-time', project, null, { ...NOW, bellsId: AS, movement: world }).html;
  assert.match(travel, /Their figures are the Assembly &lt;b&gt; bells run’s of B Day and A Day\./);
  // one follower, of the base: the sentence it always was
  const one = clone(project);
  one.dayTypes.pop();
  one.dayTypes.pop();
  one.dayTypes.push({ id: 'dsample00c', name: 'C Day', short: '', own: false, sameAs: A, bells: Array(8).fill(null) });
  assert.equal(followerWords(one, [one.dayTypes[2]], null, 'figures'), 'C Day is the same as A Day and has no figures of its own.');
  assert.equal(followerWords(one, [one.dayTypes[2]], AS, 'times'), 'C Day is the same as A Day and has the same travel times. Its figures are the Assembly <b> bells run’s of A Day.');
});

test('the lab\'s transition choices and words name the walk across', () => {
  assert.deepEqual(transitionChoices(assembly.project, AS).map((each) => [each.value, each.label]), [
    ['0', 'Period 1 to Period 2'], ['1', 'Period 2 to Period 4'], ['3', 'Period 4 to Period 5'], ['4', 'Period 5 to Period 6'], ['5', 'Period 6 to Period 7'], ['6', 'Period 7 to Period 8'],
  ]);
  assert.equal(transitionChoices(plain.project, null).length, 7);
  assert.equal(transitionName(assembly.project, AS, 1), 'Period 2 to Period 4');
  assert.equal(transitionName(assembly.project, null, 1), 'Period 2 to Period 3');
  assert.equal(whenWords(assembly.project, 1, A, AS), 'in Period 2 to Period 4, on A Day with Assembly <b> bells');
  assert.equal(whenWords(plain.project, 1, A, null), 'in Period 2 to Period 3, on A Day');
});

test('the walk across is the route between Period 2\'s room and Period 4\'s', () => {
  const routes = routesByRun(assembly.project);
  const day = routes.bells.find((entry) => entry.dayTypeId === A && entry.bellsId === AS);
  const regular = routes.days.find((entry) => entry.dayTypeId === A);
  const load = loads(assembly.project, routes, A, assembly.graph, AS);
  assert.ok(day.groups.some((group) => group.routes[1].ok === true && group.routes[1].same !== true));
  assert.ok(load.cells.byTransition[1].some((value) => value > 0));
  assert.deepEqual(regular.groups.map((group) => group.routes[1].toRoomId), regular.groups.map((group) => group.routes[1].toRoomId));
  assert.notDeepEqual(day.groups.map((group) => group.routes[1].toRoomId), regular.groups.map((group) => group.routes[1].toRoomId), 'a different far end from the regular Period 2 to Period 3');
});
