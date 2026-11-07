// The step-free route sheet (ui/prints/route-sheet.js; SV2-103; DESIGN 13.7), rendered in plain
// Node and read as a string, as test/engine/prints-step-free.test.mjs reads the report.
//
// The clock and the zone are pinned: the date line is `now`, and TZ is set here so a run on
// a machine in another zone prints the same day.
//
//   node test/engine/prints-route-sheet.test.mjs

process.env.TZ = 'UTC';

import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import * as sheet from '../../ui/prints/route-sheet.js';
import { OUTPUTS, outputFor, renderOutput } from '../../ui/prints/index.js';
import { esc, printableBox, paperOf } from '../../ui/prints/document.js';
import { createPipeline } from '../../engine/worker.js';
import { route, routingGraph } from '../../engine/routing.js';
import { runOf } from '../../ui/movement/model.js';
import { connectionChoices, stairsOf, stairsConnection, pickedPlace } from '../../ui/scenarios/model.js';
import { buildGraph } from '../../engine/graph.js';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { school, assertValid, PINNED } from './helpers.mjs';
import { planProject, roomId } from '../fixtures/buildings/plans.mjs';

const NOW = { now: PINNED };
const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];
const STAIRS_HALL = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function text(markup) {
  return markup.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]).replace(/\s+/g, ' ').trim();
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// A block's markup, by its period: the section of a walk, or the paragraph of a line.
function blockOf(html, period) {
  const walk = html.indexOf('<section class="doc-section rs__block" data-kind="walk" data-ok="');
  const find = (marker) => {
    const at = html.indexOf(marker);
    if (at < 0) return null;
    const close = marker.startsWith('<section') ? html.indexOf('</section>', at) + '</section>'.length : html.indexOf('</p>', at) + 4;
    return html.slice(at, close);
  };
  void walk;
  return find('<section class="doc-section rs__block" data-kind="walk" data-ok="true" data-period="' + period + '"')
    || find('<section class="doc-section rs__block" data-kind="walk" data-ok="false" data-period="' + period + '"')
    || find('<p class="rs__line" data-kind="same" data-period="' + period + '"')
    || find('<p class="rs__line" data-kind="none" data-period="' + period + '"')
    || find('<p class="rs__line" data-kind="many" data-period="' + period + '"')
    || find('<p class="rs__line" data-kind="missing" data-period="' + period + '"');
}

// Three floors of one hall with an elevator at the west end of each corridor, stopping on all
// three. Ada needs step-free routes and has 20 students; Bo needs none and stays on Floor 1
// after the first period. The passing time is 60 s. The cars:
//   'one'  Elevator D, stops on Floors 1, 2 and 3 (a chain of two connections)
//   'two'  Elevator D on Floors 1 and 2, Elevator E on Floors 2 and 3
// `stairs` also joins the floors by stairs, which a step-free route must not use.
function lifted(settings, options) {
  const opts = options || {};
  const drawing = opts.stairs ? STAIRS_HALL : HALL;
  const project = planProject([drawing, drawing, drawing], { exits: [[1, 6, 2, 'Main Door']], connections: opts.stairs ? [[1, 0, 2, 2, 0, 2], [2, 0, 2, 3, 0, 2]] : [] });
  const two = opts.cars === 'two';
  // a stop is a corridor cell: the west end for Elevator D (with stairs at the west end, one cell short of the east
  // end, so the car does not wall the stairs in), and for
  // Elevator E (cars 'two') the east end, so that the two cars share no stop
  const at = (number, east) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: 2 * floor.width + (east ? floor.width - 1 : opts.stairs ? 5 : 0) };
  };
  const stops = two ? [[1, 2, false], [2, 3, true]] : [[1, 2, false], [2, 3, false]];
  const marked = new Set();
  stops.forEach(([a, b, east], index) => {
    for (const number of [a, b]) {
      const floor = project.building.floors[number - 1];
      const stop = at(number, east).cell;
      if (marked.has(number + ':' + stop)) continue;
      marked.add(number + ':' + stop);
      floor.cells = floor.cells.slice(0, stop) + 'S' + floor.cells.slice(stop + 1);
      floor.lifts = (floor.lifts || []).concat([stop]);
    }
    project.building.connections.push({ id: 'celev0000' + (index + 1), label: (two && index === 1 ? 'E' : 'D') + (index + 1), a: at(a, east), b: at(b, east), direction: 'both', kind: 'elevator', staffOnly: opts.staffOnly !== false, car: two && index === 1 ? 'E' : 'D' });
  });
  project.settings.periods = 3;
  project.settings.defaultPassingSeconds = 60;
  Object.assign(project.settings, settings || {});
  for (const dayType of project.dayTypes) dayType.bells = emptyBells(3);
  const rows = opts.rows || { Ada: ['1A', '2A', '2A'], Bo: ['1A', '1B', '1B'] };
  project.groups = Object.keys(rows).map((name, index) => ({
    id: 'gplan0000' + (index + 1),
    name,
    grade: '',
    headCount: index === 0 ? 20 : null,
    colour: GROUP_COLOUR_PRESETS[index],
    ...(index === 0 ? { stepFree: true } : {}),
    days: { [project.dayTypes[0].id]: Array.from({ length: 3 }, (_, period) => (rows[name][period] ? { ...emptySlot(), room: roomId(rows[name][period]) } : emptySlot())) },
  }));
  assertValid(project);
  return project;
}

const ADA = 'gplan00001';
const BO = 'gplan00002';

function derive(project) {
  return { project, results: createPipeline().run(project), graph: buildGraph(project) };
}

test('the output is registered as route-sheet, once, named for the sheet', () => {
  assert.equal(sheet.id, 'route-sheet');
  assert.equal(outputFor('route-sheet'), sheet);
  assert.equal(OUTPUTS.filter((output) => output.id === 'route-sheet').length, 1);
  const made = renderOutput('route-sheet', lifted(), null, NOW);
  assert.equal(made.title, 'Step-free route sheet · Schedule Visualizer 2');
  assert.ok(made.html.includes('<h1 class="doc-head__what">Step-free route sheet</h1>'));
  assert.ok(made.html.includes('<p class="doc-head__date">1 September 2026</p>'), 'the date line is the given clock, in the pinned zone');
});

test('a group\'s day: each walk is a block with its numbered directions, a ride step, and the one-person time against the passing time', () => {
  const project = lifted();
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, dayTypeId: project.dayTypes[0].id }).html;
  const walk = blockOf(html, 0);
  assert.ok(walk.includes('<h2>Period 1 → Period 2 · <span dir="auto">Room 1A</span> to <span dir="auto">Room 2A</span></h2>'));
  const steps = Array.from(walk.matchAll(/<li class="card__step" data-n="(\d+)">([\s\S]*?)<\/li>/g)).map((match) => [Number(match[1]), text(match[2])]);
  assert.deepEqual(steps.map((step) => step[0]), [1, 2, 3, 4, 5], 'numbered from 1');
  assert.ok(steps.some((step) => step[1] === '3. Take Elevator D up to Floor 2.'), 'the ride is a step of its own');
  assert.equal(steps.some((step) => /stairs/i.test(step[1])), false);
  // 4 cells at the school's 3 s a cell, and the car: 30 s wait + 6 s for the one floor
  assert.ok(text(walk).includes('48 s · passing time 1 min · fits, 12 s to spare'));
  assert.ok(walk.includes('data-fits="true"'));
  // a transition where the person stays is one line, not a block
  assert.equal(blockOf(html, 1), '<p class="rs__line" data-kind="same" data-period="1">Period 2 → Period 3 · Stays in <span dir="auto">Room 2A</span>.</p>');
  assert.equal(countOf(html, 'data-kind="walk"'), 1);
});

test('the time carries the elevator\'s wait and ride: the school\'s wait and floor times move it one for one', () => {
  const find = (settings) => sheet.routeSheet(lifted(settings), { groupId: ADA }).blocks[0].seconds;
  const base = find({});
  assert.equal(base, 48);
  assert.equal(find({ elevatorWaitSeconds: 0 }), base - 30, 'no wait: 30 s less');
  assert.equal(find({ elevatorSecondsPerFloor: 10 }), base + 4, 'a floor at 10 s, not 6: one floor, 4 s more');
  assert.equal(find({ elevatorPeoplePerTrip: 1 }), base, 'one person rides once, however few the car holds');
});

test('over the passing time says so, with the amount and a word, and inside the school\'s margin says that too', () => {
  const tight = lifted({ defaultPassingSeconds: 30 });
  const html = renderOutput('route-sheet', tight, null, { ...NOW, groupId: ADA }).html;
  const walk = blockOf(html, 0);
  assert.ok(text(walk).includes('48 s · passing time 30 s · over by 18 s'));
  assert.ok(walk.includes('data-fits="false"'));
  assert.ok(walk.includes('<span class="rs__over">over by 18 s</span>'), 'in the warning style, with the word');
  assert.equal(text(walk).includes('fits'), false);
  const margin = lifted({ defaultPassingSeconds: 30, checks: { consecutiveLimit: 4, passingMarginSeconds: 20, off: [] } });
  assert.ok(text(blockOf(renderOutput('route-sheet', margin, null, { ...NOW, groupId: ADA }).html, 0)).includes('over by 18 s, inside the 20 s margin'));
  // exactly the passing time fits, with nothing to spare
  const exact = lifted({ defaultPassingSeconds: 48 });
  assert.ok(text(blockOf(renderOutput('route-sheet', exact, null, { ...NOW, groupId: ADA }).html, 0)).includes('fits, with no time to spare'));
});

test('the map is there only when the route changes floor, one per floor, labelled for a screen reader', () => {
  const project = lifted({}, { rows: { Ada: ['1A', '2A', '1A'], Bo: ['1A', '1B', '1A'] } });
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: BO }).html;
  assert.equal(countOf(html, '<figure'), 0, 'Bo walks on Floor 1 only: no map');
  assert.equal(countOf(html, 'role="img"'), 0);
  const ada = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA }).html;
  const first = blockOf(ada, 0);
  assert.equal(countOf(first, '<figure class="card__map rs__map"'), 2, 'Floor 1 and Floor 2');
  assert.ok(first.includes('<div class="rs__maps" role="img" aria-label="Route from Floor 1 to Floor 2 by Elevator D"'));
  assert.ok(first.includes('<span dir="auto">Floor 1</span> · start'));
  assert.ok(first.includes('<span dir="auto">Floor 2</span> · end'));
  // the way back is a map too, in the other order
  assert.ok(blockOf(ada, 1).includes('aria-label="Route from Floor 2 to Floor 1 by Elevator D"'));
  // each map is the route over a cropped plan
  assert.equal(countOf(first, 'class="plan__route"'), 2);
  assert.equal(countOf(first, 'class="plan__start"'), 1);
  assert.equal(countOf(first, 'class="plan__end"'), 1);
});

test('the staff-only line is there once when a route rides a staff-only elevator, names every such car, and is not there otherwise', () => {
  const one = renderOutput('route-sheet', lifted(), null, { ...NOW, groupId: ADA }).html;
  assert.equal(countOf(one, 'data-line="staff-only"'), 1);
  assert.ok(text(one).includes('Elevator D is staff and authorised only: arrange access with the office.'));
  // a route that rides twice is still one line
  const twice = lifted({}, { rows: { Ada: ['1A', '2A', '1A'], Bo: ['1A'] } });
  const rode = renderOutput('route-sheet', twice, null, { ...NOW, groupId: ADA }).html;
  assert.equal(countOf(rode, 'data-line="staff-only"'), 1);
  assert.ok(text(rode).includes('Elevator D is staff and authorised only'), 'Elevator D once, not "Elevators D and D"');
  // two cars on one route: both, in the order ridden, and the map's label says so
  const joined = lifted({}, { cars: 'two', rows: { Ada: ['1A', '3A', '3A'], Bo: ['1A'] } });
  const both = renderOutput('route-sheet', joined, null, { ...NOW, groupId: ADA }).html;
  assert.ok(text(both).includes('Elevators D and E are staff and authorised only: arrange access with the office.'));
  assert.ok(both.includes('aria-label="Route from Floor 1 to Floor 3 by Elevator D then Elevator E"'));
  // a car that is not staff-only needs no line
  const open = lifted({}, { staffOnly: false });
  assert.equal(countOf(renderOutput('route-sheet', open, null, { ...NOW, groupId: ADA }).html, 'data-line="staff-only"'), 0);
  // a day that rides nothing needs none either
  assert.equal(countOf(renderOutput('route-sheet', lifted(), null, { ...NOW, groupId: BO }).html, 'data-line="staff-only"'), 0);
});

test('a step-free sheet never takes the stairs, whether or not the group has the flag, and the elevator is the way between floors', () => {
  // a 5 minute wait (the most a school may set) makes the stairs the quicker way, so only the step-free plan keeps the sheet off them
  const project = lifted({ elevatorWaitSeconds: 300 }, { stairs: true, rows: { Ada: ['1A', '2A', '2A'], Bo: ['1A', '2A', '2A'] } });
  const byStairs = route(routingGraph(project), roomId('1A'), roomId('2A'), {});
  assert.ok(byStairs.ok && byStairs.rides === 0 && byStairs.stairs > 0, 'with no restriction the route is by the stairs, so the check below means something');
  for (const groupId of [ADA, BO]) {
    const model = sheet.routeSheet(project, { groupId });
    const walk = model.blocks[0];
    assert.equal(walk.ok, true, groupId);
    assert.equal(walk.steps.some((step) => step.kind === 'stairs'), false, groupId + ': no stairs step');
    assert.equal(walk.steps.filter((step) => step.kind === 'ride').length, 1, groupId + ': one ride');
  }
});

test('a transition with no step-free route says why, in the routing engine\'s sentence, with no map and no time', () => {
  const project = planProject([STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] });
  project.settings.periods = 3;
  for (const dayType of project.dayTypes) dayType.bells = emptyBells(3);
  project.groups = [{ id: ADA, name: 'Ada', grade: '', headCount: null, colour: GROUP_COLOUR_PRESETS[0], days: { [project.dayTypes[0].id]: ['1A', '2A', '2A'].map((number) => ({ ...emptySlot(), room: roomId(number) })) } }];
  assertValid(project);
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA }).html;
  const walk = blockOf(html, 0);
  assert.ok(walk.includes('data-ok="false"'));
  assert.ok(walk.includes('<p class="rs__noroute" data-line="no-route"><span dir="auto">There is no way from Room 1A to Room 2A without stairs.</span></p>'));
  assert.equal(countOf(walk, 'card__step'), 0);
  assert.equal(countOf(walk, '<figure'), 0);
  assert.equal(countOf(walk, 'data-line="time"'), 0);
  // the sheet as data says the same
  const model = sheet.routeSheet(project, { groupId: ADA });
  assert.deepEqual([model.blocks[0].ok, model.blocks[0].sentence], [false, 'There is no way from Room 1A to Room 2A without stairs.']);
});

test('the lines: staying, a free period, a room that is not in the building, and "nothing to walk" for a day with no walks', () => {
  const project = lifted({}, { rows: { Ada: ['1A', null, '1A'], Bo: ['1A', '1A', '1A'] } });
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA }).html;
  assert.equal(blockOf(html, 0), '<p class="rs__line" data-kind="none" data-period="0">Period 1 → Period 2 · No room in Period 2, so no walk.</p>');
  assert.equal(blockOf(html, 1), '<p class="rs__line" data-kind="none" data-period="1">Period 2 → Period 3 · No room in Period 2, so no walk.</p>');
  assert.ok(html.includes('data-line="nothing"'), 'no walk anywhere says so');
  assert.ok(text(html).includes(sheet.NOTHING_SAYS));
  assert.equal(countOf(renderOutput('route-sheet', project, null, { ...NOW, groupId: BO }).html, 'data-kind="same"'), 2);
  // a room that was in the building and is not: the number the slot kept, as typed
  project.groups[0].days[project.dayTypes[0].id][1] = { ...emptySlot(), room: 'rgone00000', roomText: '<b>204</b>' };
  const gone = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA }).html;
  assert.equal(blockOf(gone, 0), '<p class="rs__line" data-kind="missing" data-period="0">Period 1 → Period 2 · Room <span dir="auto">&lt;b&gt;204&lt;/b&gt;</span> in Period 2 is not in the building, so there is no route.</p>');
});

test('a teacher\'s day: their walks from the engine\'s teacher day, a room in two places is a line, and the same rules as a group\'s', () => {
  const project = lifted({}, { rows: { Ada: ['1A', '2A', '2A'], Bo: ['1A', '1B', '1B'] } });
  project.teachers = [{ id: 'tplan00001', name: 'Ms. Odd', subjectId: null, roomIds: [], notes: '' }];
  const day = project.dayTypes[0].id;
  // Ms. Odd teaches Ada in the first two periods, and Bo in the last: Room 1A, Room 2A, Room 1B
  project.groups[0].days[day][0].teacherIds = ['tplan00001'];
  project.groups[0].days[day][1].teacherIds = ['tplan00001'];
  project.groups[1].days[day][2].teacherIds = ['tplan00001'];
  project.groups[0].days[day][2].teacherIds = [];
  project.groups[1].days[day][0].teacherIds = [];
  assertValid(project);
  const model = sheet.routeSheet(project, { teacherId: 'tplan00001', dayTypeId: day });
  assert.equal(model.kind, 'teacher');
  assert.deepEqual(model.blocks.map((block) => [block.kind, block.from, block.to]), [['walk', 'Room 1A', 'Room 2A'], ['walk', 'Room 2A', 'Room 1B']]);
  assert.equal(model.blocks[1].ok, true, 'a step-free route down again');
  const html = renderOutput('route-sheet', project, null, { ...NOW, teacherId: 'tplan00001', dayTypeId: day }).html;
  assert.ok(html.includes('<p class="doc-lead rs__who" data-line="who" data-kind="teacher">Teacher <span dir="auto">Ms. Odd</span> · <span dir="auto">A Day</span></p>'));
  assert.equal(countOf(html, 'data-line="movement"'), 0, 'no group, no "whole group late"');
  // in two rooms in one period: one line, no route
  project.groups[1].days[day][1].teacherIds = ['tplan00001'];
  const many = renderOutput('route-sheet', project, null, { ...NOW, teacherId: 'tplan00001', dayTypeId: day }).html;
  assert.equal(blockOf(many, 0), '<p class="rs__line" data-kind="many" data-period="0">Period 1 → Period 2 · In more than one room in Period 2, so there is no one route.</p>');
});

test('"Movement shows the whole group late here" comes from the crowd\'s walks, for a step-free group, with its trips; no results, no line', () => {
  // 20 students, 8 to a trip: 3 trips, which a 60 s passing time cannot hold (prints-travel.test.mjs pins the same walk late by 43 s)
  const project = lifted();
  const world = derive(project);
  const day = project.dayTypes[0].id;
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, dayTypeId: day, movement: world }).html;
  assert.ok(text(blockOf(html, 0)).includes('fits, 12 s to spare · Movement shows the whole group late here (3 trips)'), 'one person fits; the whole group does not');
  assert.equal(countOf(html, 'data-line="movement"'), 1);
  // the planner's own results do as well
  const derived = renderOutput('route-sheet', project, { results: world.results }, { ...NOW, groupId: ADA, dayTypeId: day }).html;
  assert.equal(countOf(derived, 'data-line="movement"'), 1);
  // none on hand: no line, and nothing worked out here
  assert.equal(countOf(renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, dayTypeId: day }).html, 'data-line="movement"'), 0);
  // a group that does not need step-free routes was timed on another route: never the line
  // (here by the stairs, late at a 10 s passing time: the same group, timed on the ordinary route)
  const plain = lifted({ defaultPassingSeconds: 10 }, { stairs: true });
  plain.groups[0].stepFree = false;
  plain.groups[0].headCount = 20;
  const other = derive(plain);
  assert.ok(runOf(other.results, day).walks.groups.some((walk) => walk.groupId === ADA && walk.period === 0 && walk.late === true), 'the crowd does time it late, so the missing line is the rule\'s doing');
  assert.equal(countOf(renderOutput('route-sheet', plain, null, { ...NOW, groupId: ADA, dayTypeId: day, movement: other }).html, 'data-line="movement"'), 0);
  // one trip is not "(1 trips)"
  const small = lifted({ elevatorPeoplePerTrip: 40, defaultPassingSeconds: 20 });
  const quick = derive(small);
  const said = renderOutput('route-sheet', small, null, { ...NOW, groupId: ADA, dayTypeId: day, movement: quick }).html.match(/<span class="rs__movement" data-line="movement">([^<]*)<\/span>/);
  assert.ok(said, 'one trip is still late at 20 s');
  assert.equal(said[1], 'Movement shows the whole group late here');
});

test('the sheet is made from the project the movement view carries, so its table and its sheet are one project\'s', () => {
  const project = lifted();
  const world = derive(project);
  const later = lifted();
  later.groups[0].name = 'Renamed since';
  const html = renderOutput('route-sheet', later, null, { ...NOW, groupId: ADA, movement: world }).html;
  assert.ok(html.includes('<span dir="auto">Ada</span>'));
  assert.equal(html.includes('Renamed since'), false);
});

test('with no day type chosen every own day type has a sheet of its own; one chosen, only that; same-as day types are one line', () => {
  const project = school();
  const first = project.groups[0];
  const all = renderOutput('route-sheet', project, null, { ...NOW, groupId: first.id }).html;
  const own = project.dayTypes.filter((dayType) => dayType.own).length;
  assert.equal(countOf(all, '<section class="page">'), own);
  assert.equal(countOf(all, 'data-line="who"'), own);
  const one = renderOutput('route-sheet', project, null, { ...NOW, groupId: first.id, dayTypeId: project.dayTypes[0].id }).html;
  assert.equal(countOf(one, '<section class="page">'), 1);
  assert.equal(countOf(one, 'data-line="followers"'), 0);
  const same = school();
  same.dayTypes.push({ ...same.dayTypes[1], id: 'dsample00c', name: 'C Day', own: false, sameAs: 'dsample00a' });
  const followed = renderOutput('route-sheet', same, null, { ...NOW, groupId: first.id }).html;
  assert.ok(text(followed).includes('C Day is the same as A Day and has the same route sheet.'));
  assert.equal(countOf(followed, '<section class="page">'), own, 'a follower has no sheet of its own');
});

test('a bell schedule is followed: no walk into or out of a period that does not meet, and a walk across one is named across', () => {
  const project = lifted({}, { rows: { Ada: ['1A', '2A', '1A'], Bo: ['1A'] } });
  project.settings.periods = 3;
  project.bellSchedules = [{ id: 'bplan00001', name: 'Assembly', short: '', bells: [{ start: '08:00', end: '08:40' }, null, { start: '09:20', end: '10:00' }], off: [1] }];
  const model = sheet.routeSheet(project, { groupId: ADA, bellsId: 'bplan00001' });
  assert.deepEqual(model.blocks.map((block) => [block.period, block.toPeriod, block.kind]), [[0, 2, 'same']], 'Period 1 to Period 3, both in Room 1A');
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, bellsId: 'bplan00001' }).html;
  assert.ok(html.includes('data-period="0" data-to="2"'));
  assert.ok(text(html).includes('Period 1 → Period 3 · Stays in Room 1A.'));
});

test('nobody to print: no group or teacher, or an id that is nobody\'s, prints one sheet saying so, never another person\'s day', () => {
  const empty = lifted();
  empty.groups = [];
  assert.ok(text(renderOutput('route-sheet', empty, null, NOW).html).includes(sheet.NOBODY_SAYS));
  const project = lifted();
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: 'gnobody' }).html;
  assert.ok(html.includes('data-line="nobody"'));
  assert.equal(countOf(html, 'data-line="who"'), 0);
  assert.equal(countOf(renderOutput('route-sheet', project, null, { ...NOW, teacherId: 'tnobody' }).html, 'data-line="nobody"'), 1);
  // left out altogether: the first group that needs step-free routes
  assert.equal(sheet.routeSheet(project, {}).name, 'Ada');
  const flipped = lifted();
  flipped.groups.reverse();
  assert.equal(sheet.routeSheet(flipped, {}).name, 'Ada', 'Ada is the step-free one, though second in the list');
});

test('letter and A4: the page rule and the paper are the ones asked for, and the maps fit the width between the margins on each', () => {
  const project = lifted({}, { cars: 'two', rows: { Ada: ['1A', '3A', '3A'], Bo: ['1A'] } });
  for (const paper of [{ size: 'letter', orientation: 'portrait' }, { size: 'a4', orientation: 'portrait' }, { size: 'a4', orientation: 'landscape' }]) {
    const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, paper }).html;
    assert.ok(html.includes('data-paper="' + paper.size + '" data-orientation="' + paper.orientation + '"'), paper.size);
    assert.equal(countOf(html, '<style id="page-size">@page { size: ' + (paper.size === 'a4' ? 'A4' : 'letter') + ' ' + paper.orientation + '; }</style>'), 1);
    // the widths of one block's maps and the gaps between them, in millimetres, within the printable width
    const maps = blockOf(html, 0);
    const widths = Array.from(maps.matchAll(/class="card__plan" style="width: ([\d.]+)mm;/g)).map((match) => Number(match[1]));
    assert.equal(widths.length, 3, paper.size + ': three floors');
    const used = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * sheet.MAP_GAP_MM;
    assert.ok(used <= printableBox(paperOf(project, { paper })).width + 1e-6, paper.size + ' ' + paper.orientation + ': ' + used + ' mm in ' + printableBox(paperOf(project, { paper })).width);
  }
  // a block never splits across a page, and says so in its own markup
  // (SV2-102b: in ui/print.css, not in the markup)
  const first = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA }).html;
  assert.ok(blockOf(first, 0).startsWith('<section class="doc-section rs__block" data-kind="walk" data-ok="true" data-period="0">'));
  const css = readFileSync(new URL('../../ui/print.css', import.meta.url), 'utf8');
  assert.match(css, /\.rs__block \{\s*break-inside: avoid;/);
  assert.match(css, /\.rs__maps \{\s*display: flex;\s*gap: 6mm;/);
  assert.equal(sheet.MAP_GAP_MM, 6, 'the gap the maps are sized by is the one the stylesheet has');
});

test('SV2-102b: the sheet\'s own rules live in ui/print.css: the markup keeps only the sizes of the plans (and the page size) as inline style', () => {
  const html = renderOutput('route-sheet', lifted({}, { cars: 'two', rows: { Ada: ['1A', '3A', '3A'], Bo: ['1A'] } }), null, { ...NOW, groupId: ADA }).html;
  const styles = Array.from(html.matchAll(/ style="([^"]*)"/g)).map((match) => match[1]).filter((value) => !value.startsWith('--page-'));
  assert.ok(styles.length > 0);
  assert.ok(styles.every((value) => /^width: [\d.]+mm; height: [\d.]+mm;$/.test(value)), JSON.stringify(styles.filter((value) => !/^width/.test(value))));
  for (const word of ['break-inside', 'display: flex', 'font-weight', 'margin-top']) assert.equal(html.includes(word), false, word);
});

test('names are as typed: a group, a room, a floor, an elevator letter and a day type with markup or a right-to-left script print as text', () => {
  const project = lifted();
  const hostile = '<script>alert(1)</script> "ויקי" & مستوى';
  project.groups[0].name = hostile;
  project.dayTypes[0].name = '<i>A</i> Day';
  project.settings.schoolName = '<b>School</b> & "Co"';
  project.building.floors[1].name = '<img src=x onerror=alert(1)>';
  project.building.floors[0].spaces.find((space) => space.id === roomId('1A')).number = '<u>1A</u>';
  for (const connection of project.building.connections) connection.car = '<D>';
  const html = renderOutput('route-sheet', project, null, { ...NOW, groupId: ADA, dayTypeId: project.dayTypes[0].id }).html;
  for (const raw of ['<script', '<b>School', '<i>A', '<img', '<u>1A', '<D>']) assert.equal(countOf(html, raw), 0, raw);
  assert.ok(html.includes('<span dir="auto">' + esc(hostile) + '</span>'), 'the group, exactly as typed');
  assert.ok(html.includes('<span dir="auto">' + esc('<i>A</i> Day') + '</span>'));
  assert.ok(html.includes('<span dir="auto">' + esc('<img src=x onerror=alert(1)>') + '</span>'), 'a floor in a map\'s caption');
  assert.ok(html.includes('<span dir="auto">' + esc('<u>1A</u>') + '</span>'), 'a room in a block\'s heading, as typed (a number that does not start like one has no "Room" in front)');
  assert.ok(html.includes('aria-label="Route from Floor 1 to ' + esc('<img src=x onerror=alert(1)>') + ' by Elevator ' + esc('<D>') + '"'), 'and in the map\'s label');
  assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i);
  assert.ok(text(html).includes('Elevator <D> is staff and authorised only'));
});

test('the same project and options give the same document byte for byte, with no clock read', () => {
  const project = lifted();
  const world = derive(project);
  const options = { ...NOW, groupId: ADA, movement: world, paper: { size: 'a4', orientation: 'portrait' } };
  assert.equal(renderOutput('route-sheet', project, null, options).html, renderOutput('route-sheet', project, null, options).html);
  assert.equal(renderOutput('route-sheet', project, null, {}).html.includes('doc-head__date'), false, 'no date given, no date line');
});

// ---------------------------------------------------------------- the scenario lab lists stairs only

test('the lab\'s stairs list offers stairs and never an elevator, and finds a connection by id only when it is stairs', () => {
  const both = lifted({}, { stairs: true });
  assert.deepEqual(connectionChoices(both).map((choice) => choice.label), ['Stairs A: Floor 1 to Floor 2', 'Stairs B: Floor 2 to Floor 3'], 'two stairs, and Elevator D\'s two connections left out');
  assert.deepEqual(stairsOf(both).map((connection) => connection.label), ['A', 'B']);
  const elevator = both.building.connections.find((connection) => connection.kind === 'elevator');
  assert.equal(stairsConnection(both, elevator.id), null, 'an elevator is not a stairs connection to the lab');
  assert.equal(stairsConnection(both, both.building.connections[0].id).label, 'A');
  assert.equal(stairsConnection(both, 'cnobody'), null);
  // a building with an elevator and no stairs has nothing to offer: the form says so
  assert.deepEqual(connectionChoices(lifted()), []);
  // an older tool's file, an elevator joined as plain stairs (no kind), is stairs to the lab, as it is to everything that reads it
  const older = lifted();
  for (const connection of older.building.connections) delete connection.kind;
  assert.equal(connectionChoices(older).length, 2);
});

test('picking a lift stop on the lab\'s map says it is an elevator stop, a stairs landing says it is stairs, and neither is a corridor to close', () => {
  const project = lifted({}, { stairs: true });
  const floor = project.building.floors[0];
  const stop = floor.lifts[0];
  const landing = floor.cells.indexOf('S');
  assert.notEqual(landing, stop);
  assert.equal(pickedPlace(project, floor, stop, null).why, 'That is an elevator stop. A scenario closes corridors and stairs, not elevators.');
  assert.equal(pickedPlace(project, floor, landing, null).why, 'That is a stairs landing. Close it with "A stair" above.');
  assert.equal(pickedPlace(project, floor, floor.cells.indexOf('#'), null).why, undefined, 'a corridor is still a place');
});
