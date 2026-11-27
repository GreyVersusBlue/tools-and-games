// Crowd-aware routes as Movement reads them, the pure parts (SV2-154;
// ARCHITECTURE 23.7, 23.12 "One results view for every Movement reader",
// DESIGN 17.4, 17.7): settleChoice's `routes`, crowdResultsView and what it
// replaces, every reader the architecture names seeing the view, the
// comparison sentence and its trade, "another way" in the groups' rows, the
// cell card's two counts, and findings that never change. Plain Node, no page.
//
// The school is the two-halls fixture (test/fixtures/buildings/two-halls.mjs),
// where the rule demonstrably moves groups (waiting 312 s → 132 s, four groups
// on another way), and the sample, where it honestly moves none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { createPipeline, crowdRun, runResults } from '../../engine/worker.js';
import { defaultChoice, settleChoice, pictureOf, sentenceOf, groupRows, cellCard, runOf, routeHealth } from '../../ui/movement/model.js';
import { crowdResultsView, lensOf, usualOf, lensFits, lensFigures, comparisonParts, movedBy, usualRouteOf, usualWalkOf, hasWaiting } from '../../ui/movement/crowd-view.js';
import { hotspotRows } from '../../ui/movement/hotspots.js';
import { transitionRows, dayRows, travelDay } from '../../ui/movement/tables.js';
import { twoHalls } from '../fixtures/buildings/two-halls.mjs';
import { plainSchool } from '../engine/helpers.mjs';

const VERSIONS = { geometry: 1, building: 1, schedule: 1 };

function halls() {
  const project = twoHalls();
  const pipeline = createPipeline();
  const main = pipeline.run(project, VERSIONS);
  const dayTypeId = project.dayTypes[0].id;
  const run = crowdRun(pipeline, project, VERSIONS, { dayTypeId, bellsId: null });
  return { project, main, run, dayTypeId, view: crowdResultsView(main, run), graph: buildGraph(project) };
}

function picture(project, results, graph, patch) {
  return pictureOf(project, results, graph, { ...defaultChoice(project), routes: 'crowd', ...patch });
}

const words = (parts) => parts.map((part) => part.text).join('');

// ---- settleChoice

test('settleChoice: routes starts at usual, keeps crowd, and puts anything else right to usual', () => {
  const project = twoHalls();
  assert.equal(defaultChoice(project).routes, 'usual');
  assert.equal(settleChoice(project, { routes: 'crowd' }).routes, 'crowd');
  for (const junk of ['optimal', '', null, 5, undefined, 'Crowd']) assert.equal(settleChoice(project, { routes: junk }).routes, 'usual', String(junk));
  const old = { who: 'all', grade: '', groupIds: [], dayTypeId: project.dayTypes[0].id, bellsId: null, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };
  assert.equal(settleChoice(project, old).routes, 'usual', 'a choice made before the field has none');
});

// ---- the view

test('crowdResultsView: the run is put in its place and the checks\' parts are the main result\'s own', () => {
  const { main, run, view, dayTypeId } = halls();
  assert.notEqual(view, main);
  const here = runResults(view, dayTypeId, null);
  assert.equal(here.routes, run.routes);
  assert.equal(here.crowd, run.crowd);
  assert.equal(here.loads, run.loads);
  assert.deepEqual(here.walks.groups, run.walks.groups);
  // what the lens must never touch
  assert.equal(view.findings, main.findings);
  assert.equal(view.buildingFindings, main.buildingFindings);
  assert.equal(view.places, main.places);
  assert.equal(view.versions, main.versions);
  // and the main result is as it was
  assert.notEqual(runResults(main, dayTypeId, null).routes, run.routes, 'the usual routes are not the lens\'s');
  assert.equal(lensOf(main), null);
  assert.equal(usualOf(main), main);
  assert.equal(usualOf(view), main);
  assert.equal(lensOf(view).run, run);
});

test('crowdResultsView: memoised by the two objects, so a panel\'s memo on state.results holds', () => {
  const { main, run, view } = halls();
  assert.equal(crowdResultsView(main, run), view);
  const other = crowdRun(createPipeline(), twoHalls(), VERSIONS, { dayTypeId: main.routes.days[0].dayTypeId, bellsId: null });
  assert.notEqual(crowdResultsView(main, other), view);
});

test('crowdResultsView: with no answer it is the main result, and with an answer that moved nothing the entries are the main\'s own', () => {
  const { main, project, graph } = halls();
  assert.equal(crowdResultsView(main, null), main);
  assert.equal(crowdResultsView(null, null), null);
  // the sample finds nothing: every part of the run is the main lane's own object
  const sample = plainSchool();
  const pipeline = createPipeline();
  const results = pipeline.run(sample, VERSIONS);
  const dayTypeId = sample.dayTypes[0].id;
  const run = crowdRun(pipeline, sample, VERSIONS, { dayTypeId, bellsId: null });
  assert.equal(run.changed.length, 0);
  const view = crowdResultsView(results, run);
  assert.equal(runResults(view, dayTypeId, null).routes, runResults(results, dayTypeId, null).routes);
  assert.ok(lensOf(view), 'the view still says it is the lens: the sentence says nothing moved');
  assert.ok(project && graph);
});

test('crowdResultsView: a bell schedule\'s run is swapped in the bells lists, and the regular run is left alone', () => {
  const entry = (dayTypeId, bellsId, tag) => ({ dayTypeId, ...(bellsId ? { bellsId } : {}), tag });
  const main = {
    versions: {}, findings: {}, places: {}, buildingFindings: {},
    routes: { days: [entry('d1', null, 'usual')], bells: [entry('d1', 'b1', 'usual-bells'), entry('d2', 'b1', 'other')] },
    crowd: { days: [entry('d1', null, 'usual')], bells: [entry('d1', 'b1', 'usual-bells')] },
    loads: [entry('d1', null, 'usual')],
    bellLoads: [entry('d1', 'b1', 'usual-bells')],
    walks: { groups: [{ dayTypeId: 'd1', groupId: 'g', period: 0, tag: 'regular' }], teachers: [], bells: { groups: [{ dayTypeId: 'd1', bellsId: 'b1', groupId: 'g', period: 0, tag: 'usual-bells' }, { dayTypeId: 'd2', bellsId: 'b1', groupId: 'g', period: 0, tag: 'other' }], teachers: [] } },
  };
  const crowd = { dayTypeId: 'd1', bellsId: 'b1', routes: entry('d1', 'b1', 'aware'), crowd: entry('d1', 'b1', 'aware'), loads: entry('d1', 'b1', 'aware'), walks: { groups: [{ dayTypeId: 'd1', bellsId: 'b1', groupId: 'g', period: 0, tag: 'aware' }] }, changed: [], figures: {} };
  const view = crowdResultsView(main, crowd);
  assert.deepEqual(view.routes.bells.map((each) => each.tag), ['aware', 'other']);
  assert.deepEqual(view.routes.days.map((each) => each.tag), ['usual']);
  assert.deepEqual(view.crowd.bells.map((each) => each.tag), ['aware']);
  assert.deepEqual(view.bellLoads.map((each) => each.tag), ['aware']);
  assert.deepEqual(view.loads.map((each) => each.tag), ['usual']);
  assert.deepEqual(view.walks.bells.groups.map((each) => each.tag), ['aware', 'other']);
  assert.deepEqual(view.walks.groups.map((each) => each.tag), ['regular']);
  assert.ok(lensFits(view, 'd1', 'b1'));
  assert.ok(!lensFits(view, 'd1', null));
  assert.ok(!lensFits(view, 'd2', 'b1'));
});

// ---- every reader sees the view

test('every Movement reader the architecture names sees the view: picture, loads, card, Hotspots, Travel time, legend rows', () => {
  const { project, main, run, view, graph, dayTypeId } = halls();
  const lens = picture(project, view, graph);
  const usual = picture(project, main, graph);
  assert.equal(lens.routesMode, 'crowd');
  assert.equal(usual.routesMode, 'usual');
  assert.equal(usual.routesPending, true, 'a crowd-aware choice with no answer yet is the usual picture, pending');
  assert.equal(lens.routesPending, false);

  // pictureOf: the routes drawn and the loads counted are the run's
  assert.equal(lens.load.source, run.loads);
  assert.notEqual(lens.load.source, usual.load.source);
  assert.deepEqual(lens.late, []);
  // model.js's indexRoutes and dayRoutes read results.routes: the card's crossings follow the lens
  const node = [...Array(graph.count).keys()].find((n) => lens.load.cells[n] !== usual.load.cells[n]);
  assert.ok(node !== undefined, 'the lens loads some corridor cell differently');

  // Hotspots: the delay is the run's crowd result's
  const delay = (rows) => rows.reduce((sum, row) => sum + (row.delay || 0), 0);
  const lensDelay = delay(hotspotRows(project, view, graph, lens));
  const usualDelay = delay(hotspotRows(project, main, graph, usual));
  assert.ok(lensDelay < usualDelay, 'Hotspots\' delay falls with the lens: ' + lensDelay + ' against ' + usualDelay);

  // Travel time: the tables are the run's walks
  const day = travelDay(project, dayTypeId, null);
  const waitOf = (rows) => rows.reduce((sum, row) => sum + row.waiting, 0);
  assert.equal(waitOf(dayRows(project, view, day.id, day.bellsId)), run.figures.aware.waiting);
  assert.equal(waitOf(dayRows(project, main, day.id, day.bellsId)), run.figures.usual.waiting);
  const t0 = transitionRows(project, view, day.id, 0, day.bellsId).rows;
  assert.equal(waitOf(t0), run.walks.groups.filter((walk) => walk.period === 0).reduce((sum, walk) => sum + walk.waiting, 0));

  // the legend's rows, and the card
  const rows = groupRows(project, view, lens);
  assert.equal(rows.reduce((sum, row) => sum + row.waiting, 0), run.figures.aware.waiting);
  assert.deepEqual(groupRows(project, main, usual).map((row) => row.another), Array(8).fill(null));
  const floorId = project.building.floors[0].id;
  const cell = graph.nodeCell[node];
  const card = cellCard(project, view, graph, lens, floorId, cell);
  assert.ok(card.crowd, 'the card carries the two counts');
  assert.equal(typeof card.crowd.aware, 'number');
  assert.equal(typeof card.crowd.usual, 'number');
  assert.equal(cellCard(project, main, graph, usual, floorId, cell).crowd, undefined, 'and only with the lens');
});

test('the card counts the groups here on both routes: where a group left the corridor the two differ', () => {
  const { project, view, graph, run } = halls();
  const lens = picture(project, view, graph);
  const floorId = project.building.floors[0].id;
  let counted = 0;
  let differs = 0;
  for (let node = 0; node < graph.count; node += 1) {
    const card = cellCard(project, view, graph, lens, floorId, graph.nodeCell[node]);
    if (!card || !card.crowd) continue;
    counted += 1;
    if (card.crowd.aware !== card.crowd.usual) differs += 1;
  }
  assert.ok(counted > 0);
  assert.ok(differs > 0, 'some cell is crossed by fewer or more groups on the lens (' + run.changed.length + ' walks moved)');
});

// ---- the first line

test('the first line: the comparison with the trade, the day, and the what-if', () => {
  const { project, view, graph, run } = halls();
  const lens = picture(project, view, graph);
  const sentence = sentenceOf(project, lens, []);
  const text = words(sentence.parts);
  assert.equal(text, 'Crowd-aware routes on A Day: 4 groups take another way: 3 min less waiting, 24 s more walking (summed over the groups’ walks); no group late. A what-if: checks use the usual routes.');
  assert.equal(sentence.parts.find((part) => part.name).text, 'A Day', 'the day type is marked as typed');
  // the figures are the run's own when every group is on screen
  assert.deepEqual({ w: lens.compare.usual.waiting, t: lens.compare.usual.total, l: lens.compare.usual.late }, { w: run.figures.usual.waiting, t: run.figures.usual.total, l: run.figures.usual.late });
  assert.deepEqual({ w: lens.compare.aware.waiting, t: lens.compare.aware.total, l: lens.compare.aware.late }, { w: run.figures.aware.waiting, t: run.figures.aware.total, l: run.figures.aware.late });
});

test('the first line says a rise plainly, and groups late as "groups late", never "late arrivals"', () => {
  const fake = (usual, aware) => ({ routesMode: 'crowd', dayTypeName: 'A Day', transition: null, elsewhere: 0, changed: [{ groupId: 'g1' }, { groupId: 'g2' }, { groupId: 'g1' }], compare: { usual, aware } });
  const base = { waiting: 0, walking: 0, total: 0, late: 0, walks: 1 };
  const rise = words(comparisonParts(fake({ ...base, late: 3 }, { ...base, late: 4 })));
  assert.match(rise, /groups late 3 → 4\./);
  assert.ok(!/late arrivals/.test(rise));
  assert.match(rise, /^Crowd-aware routes on A Day: 2 groups take another way: /);
  const more = words(comparisonParts(fake({ ...base, waiting: 10, walking: 100 }, { ...base, waiting: 70, walking: 40 })));
  assert.match(more, /1 min more waiting, 1 min less walking/);
  const same = words(comparisonParts(fake(base, base)));
  assert.match(same, /the same waiting, the same walking/);
  assert.match(same, /no group late/);
  const one = words(comparisonParts({ ...fake(base, base), changed: [{ groupId: 'g1' }] }));
  assert.match(one, /: 1 group takes another way: /);
  assert.deepEqual(comparisonParts({ routesMode: 'usual' }), []);
});

test('the first line with one transition chosen names it and counts only its walks', () => {
  const { project, view, graph } = halls();
  const lens = picture(project, view, graph, { transition: 0 });
  const text = words(sentenceOf(project, lens, []).parts);
  assert.match(text, /^Crowd-aware routes on A Day, Period 1 to Period 2: /);
  assert.ok(lens.changed.every((row) => row.period === 0));
  assert.ok(lens.compare.aware.walks < 16);
});

test('the sample finds nothing: the sentence says so, and the usual routes already use the building well', () => {
  const sample = plainSchool();
  const pipeline = createPipeline();
  const main = pipeline.run(sample, VERSIONS);
  const dayTypeId = sample.dayTypes[0].id;
  const run = crowdRun(pipeline, sample, VERSIONS, { dayTypeId, bellsId: null });
  const view = crowdResultsView(main, run);
  const graph = buildGraph(sample);
  const lens = picture(sample, view, graph, { dayTypeId });
  assert.equal(lens.routesMode, 'crowd');
  assert.equal(lens.changed.length, 0);
  assert.equal(words(sentenceOf(sample, lens, []).parts), 'Crowd-aware routes on ' + lens.dayName + ': no group finds a quicker way round. The usual routes already use the building well. A what-if: checks use the usual routes.');
});

test('one group shown: the figures and the count are of that group, and the others that moved are said to be elsewhere', () => {
  const { project, view, graph, run } = halls();
  const west1 = project.groups[0];
  const alone = picture(project, view, graph, { who: 'groups', groupIds: [west1.id] });
  assert.equal(alone.compare.aware.walks, 2, 'its own two walks');
  assert.deepEqual(alone.changed, [], 'West 1 stays on the usual way');
  assert.equal(alone.elsewhere, new Set(run.changed.map((row) => row.groupId)).size);
  const text = words(sentenceOf(project, alone, []).parts);
  assert.match(text, /none of the groups shown takes another way; 4 groups elsewhere do\./);
  const moved = project.groups.find((group) => run.changed.some((row) => row.groupId === group.id));
  const one = picture(project, view, graph, { who: 'groups', groupIds: [moved.id] });
  assert.equal(new Set(one.changed.map((row) => row.groupId)).size, 1);
  assert.match(words(sentenceOf(project, one, []).parts), /: 1 group takes another way: /);
});

test('teacher mode ignores the choice: no lens, nothing pending', () => {
  const { project, view, graph } = halls();
  const teacher = picture(project, view, graph, { who: 'teacher', teacherId: null });
  assert.equal(teacher.routesMode, 'usual');
  assert.equal(teacher.routesPending, false);
});

test('a day type that is the same as another shows the lens of the day it copies, and a lens for another run does not fit', () => {
  const { project, view, graph, dayTypeId } = halls();
  const follower = project.dayTypes.find((dayType) => dayType.id !== dayTypeId);
  assert.ok(follower && follower.own === false, 'B Day follows A Day in the fixture');
  assert.equal(picture(project, view, graph, { dayTypeId: follower.id }).routesMode, 'crowd');
  assert.ok(!lensFits(view, 'dnothere00', null));
  assert.ok(!lensFits(view, dayTypeId, 'bnothere00'));
  // a plain results object is never a lens
  assert.ok(!lensFits({ routes: {} }, dayTypeId, null));
});

// ---- "another way", the usual route, and the offer

test('movedBy: a group that took another way has its walks and the seconds its own total fell; others have none', () => {
  const { project, view, run } = halls();
  const lens = lensOf(view);
  const movedIds = new Set(run.changed.map((row) => row.groupId));
  for (const group of project.groups) {
    const found = movedBy(lens, group.id);
    if (!movedIds.has(group.id)) {
      assert.equal(found, null);
      continue;
    }
    const rows = run.changed.filter((row) => row.groupId === group.id);
    assert.equal(found.walks, rows.length);
    assert.equal(found.saved, rows.reduce((sum, row) => sum + row.usual.total - row.aware.total, 0));
  }
});

test('the usual route of a walk that moved is the main lane\'s, and differs from the lens\'s; its usual figures are the main lane\'s walk', () => {
  const { main, view, run, dayTypeId } = halls();
  const row = run.changed[0];
  const usual = usualRouteOf(view, row.groupId, row.period);
  const aware = runResults(view, dayTypeId, null).routes.groups.find((each) => each.groupId === row.groupId).routes[row.period];
  assert.notEqual(usual, aware);
  assert.notDeepEqual(usual.cells, aware.cells);
  assert.equal(usual, runResults(main, dayTypeId, null).routes.groups.find((each) => each.groupId === row.groupId).routes[row.period]);
  const walk = usualWalkOf(view, dayTypeId, null, row.groupId, row.period);
  assert.equal(walk.total, row.usual.total);
  assert.equal(usualWalkOf(main, dayTypeId, null, row.groupId, row.period), null, 'only a lens has a usual beside it');
  assert.equal(usualRouteOf(main, row.groupId, row.period), null);
});

test('the offer "Try crowd-aware routes" is made where the usual routes have waiting, and not where they have none or the lens is on', () => {
  const { project, main, view, graph } = halls();
  const usual = pictureOf(project, main, graph, defaultChoice(project));
  assert.equal(usual.waiting, true);
  assert.equal(hasWaiting(usual), true);
  assert.equal(hasWaiting(picture(project, view, graph)), false, 'not once it is chosen');
  // nobody waits: the sample
  const sample = plainSchool();
  const results = createPipeline().run(sample, VERSIONS);
  const calm = pictureOf(sample, results, buildGraph(sample), defaultChoice(sample));
  assert.equal(typeof calm.waiting, 'boolean');
  const none = pictureOf(project, main, graph, { ...defaultChoice(project), who: 'groups', groupIds: [] });
  assert.equal(hasWaiting(none), false, 'with nothing on screen there is nothing to offer');
});

// ---- findings never change

test('findings never change: the Checks counts are the same before and after choosing crowd-aware, and the health list is the usual routes\'', () => {
  const { project, main, view } = halls();
  const count = (results) => ({ found: results.findings.findings.length, kinds: results.findings.findings.map((finding) => finding.kind || finding.id).sort(), accepted: results.findings.accepted.length, building: results.buildingFindings ? JSON.stringify(results.buildingFindings) : '' });
  assert.deepEqual(count(view), count(main));
  assert.equal(view.findings, main.findings);
  assert.deepEqual(routeHealth(project, view), routeHealth(project, main));
  // a late walk of the lens is not a finding: findings are read from the main result only
  assert.ok(runOf(view, main.routes.days[0].dayTypeId, null).walks.groups.length > 0);
});
