// The movement view's outputs in plain Node: the hotspot rows and the
// travel-time rows the inspector shows, their CSV files, and the two print
// documents built from them (ui/prints/movement.js, ui/prints/congestion.js),
// from the sample school and from a school whose every name is hostile.
//
//   node test/engine/prints-movement.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { hotspots } from '../../engine/places.js';
import { bandOf, bandEdges } from '../../engine/load.js';
import { parse as parseCsv } from '../../engine/csv.js';
import { csvText, exportFileName } from '../../engine/exports.js';
import { defaultChoice, pictureOf } from '../../ui/movement/model.js';
import { hotspotRows, rankedPlaces, hotspotsCsv, cellWords, placeWords, PULSE_TOP, TABLE_FIRST } from '../../ui/movement/hotspots.js';
import { transitionRows, dayRows, slowestPeriod, lateWords, transitionsCsv, dayCsv } from '../../ui/movement/tables.js';
import { OUTPUTS, outputFor, renderOutput } from '../../ui/prints/index.js';
import { esc } from '../../ui/prints/document.js';
import * as movementPrint from '../../ui/prints/movement.js';
import * as congestionPrint from '../../ui/prints/congestion.js';
import { school, group, room, PINNED } from './helpers.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const NOW = { now: PINNED };
// one pixel of PNG, as the Export tab would hand a picture over
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function derive(project) {
  return { project, results: createPipeline().run(project), graph: buildGraph(project) };
}

function picture(world, patch) {
  return pictureOf(world.project, world.results, world.graph, { ...defaultChoice(world.project), ...patch });
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// The text of a document's table cells, row by row, for the table that follows a heading.
function tableAfter(html, heading) {
  const from = html.indexOf('<h2>' + heading + '</h2>');
  assert.notEqual(from, -1, 'no section headed ' + heading);
  const start = html.indexOf('<tbody>', from);
  const end = html.indexOf('</tbody>', start);
  return html.slice(start, end).split('</tr>').filter((row) => row.includes('<tr>')).map((row) => Array.from(row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)).map((cell) => cell[1].replace(/<[^>]+>/g, '').trim()));
}

const sample = derive(school());

// ---------------------------------------------------------------- the hotspot rows

test('the hotspot rows are the engine\'s ranking, in its order, for what the map shows', () => {
  const view = picture(sample);
  const rows = hotspotRows(sample.project, sample.results, sample.graph, view);
  const ranked = hotspots(sample.project, sample.results.routes, DAY_A, { graph: sample.graph, places: sample.results.places, load: sample.results.loads.find((load) => load.dayTypeId === DAY_A), crowd: sample.results.crowd.days.find((day) => day.dayTypeId === DAY_A) });
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.place), ranked.map((row) => row.place), 'the same places in the same order');
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(rows.map((row) => [row.load, row.delay, row.dayDelay]), ranked.map((row) => [row.load, row.delay, row.dayDelay]));
  const top = rows[0];
  assert.equal(top.place.name, 'Main Corridor, by Door B');
  assert.equal(top.load, 177);
  assert.equal(top.unit, 'students');
  assert.equal(top.when, 'Period 4 to Period 5');
  assert.equal(top.delay, 13);
  assert.equal(top.groups.length, 8);
  assert.equal(top.cells.length, 39, 'a row opens to every cell of its place');
  assert.ok(top.cells.every((cell, index) => index === 0 || top.cells[index - 1].load >= cell.load), 'its cells are busiest first');
  assert.equal(hotspotRows(sample.project, sample.results, sample.graph, view), rows, 'worked out once a picture');
});

test('a band is the load rule\'s band for the busiest load on the map', () => {
  const view = picture(sample);
  const rows = hotspotRows(sample.project, sample.results, sample.graph, view);
  for (const row of rows) assert.equal(row.band, bandOf(row.load, sample.project.settings.colourScale, view.load.max), row.place.name);
  assert.equal(rows[0].band, 5);
  assert.ok(rows.some((row) => row.band < 5), 'not every place is in the busiest band');
});

test('a name two places share has its floor beside it; a name that is one place\'s own does not', () => {
  const rows = hotspotRows(sample.project, sample.results, sample.graph, picture(sample));
  const west = rows.filter((row) => row.place.name === 'West');
  assert.equal(west.length, 2);
  assert.deepEqual(west.map((row) => row.floorName).sort(), ['Floor 1', 'Floor 2']);
  assert.equal(placeWords(west[0]), 'West on ' + west[0].floorName);
  assert.equal(rows[0].floorName, '', 'Main Corridor is the only place of its name');
  const stairs = rows.find((row) => row.place.kind === 'connection');
  assert.equal(stairs.floorName, '', 'a stairs connection names its floors itself');
  assert.equal(stairs.cells.length, 0);
  assert.equal(stairs.ends.length, 2, 'the map can go to either end of it');
});

test('with one transition on the map, that transition alone is ranked', () => {
  const view = picture(sample, { transition: 2 });
  const rows = hotspotRows(sample.project, sample.results, sample.graph, view);
  const load = sample.results.loads.find((each) => each.dayTypeId === DAY_A);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.peak, 2, row.place.name);
    assert.equal(row.when, 'Period 3 to Period 4');
    const source = row.place.kind === 'connection' ? load.connections.byTransition[2] : load.cells.byTransition[2];
    const members = row.place.kind === 'connection' ? [row.place.link] : row.place.nodes.filter((node) => !load.excluded[node]);
    assert.equal(row.load, Math.max(...members.map((member) => source[member])), row.place.name);
  }
  const most = Math.max(...Array.from(load.cells.byTransition[2]).filter((count, node) => !load.excluded[node]));
  assert.equal(rows[0].load, most, 'the first row is the busiest cell of that transition');
  assert.equal(most, 149);
  // and the whole day's ranking is untouched by having asked
  assert.equal(hotspotRows(sample.project, sample.results, sample.graph, picture(sample))[0].load, 177);
});

test('with some groups on the map, only their loads are ranked; the total over the day has no peak', () => {
  const some = picture(sample, { who: 'groups', groupIds: ['gsample06a', 'gsample06b'] });
  const rows = hotspotRows(sample.project, sample.results, sample.graph, some);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.load <= 24 + 26), 'no load can pass the two groups\' head counts');
  assert.ok(rows.every((row) => row.groups.every((each) => ['6A', '6B'].includes(each.group.name))));
  const total = hotspotRows(sample.project, sample.results, sample.graph, picture(sample, { measure: 'total' }));
  assert.ok(total.every((row) => row.peak === null && row.when === ''));
  assert.ok(total[0].load > 177, 'a day\'s total is more than its busiest moment');
  assert.deepEqual(hotspotRows(sample.project, sample.results, sample.graph, picture(sample, { who: 'groups', groupIds: [] })), [], 'nothing shown, nothing ranked');
  assert.deepEqual(hotspotRows(sample.project, null, sample.graph, picture({ ...sample, results: null })), [], 'no answer yet, no rows');
});

test('a cell is named the way the building editor names one', () => {
  assert.equal(cellWords({ width: 40 }, 0), 'Column 1, row 1');
  assert.equal(cellWords({ width: 40 }, 40 * 7 + 5), 'Column 6, row 8');
  assert.ok(PULSE_TOP >= 1 && PULSE_TOP <= 5, 'the top few places carry a ring');
  assert.ok(TABLE_FIRST >= PULSE_TOP);
});

// ---------------------------------------------------------------- travel time

test('a transition\'s table is every group that walks, slowest first, in the walk results\' own figures', () => {
  const { rows, still, failed } = transitionRows(sample.project, sample.results, DAY_A, 5);
  const walks = sample.results.walks.groups.filter((walk) => walk.dayTypeId === DAY_A && walk.period === 5);
  assert.equal(rows.length, walks.length);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].total >= row.total), 'slowest first: ' + rows.map((row) => row.total).join(' '));
  const slowest = walks.reduce((a, b) => (b.total > a.total ? b : a));
  assert.equal(rows[0].group.id, slowest.groupId, 'the first row is the slowest walk');
  assert.deepEqual([rows[0].group.name, rows[0].from, rows[0].to, rows[0].walking, rows[0].waiting, rows[0].total, rows[0].late], ['8A', 'Gym', '303', 261, 0, 261, true]);
  assert.equal(rows[0].over, 21, '261 s against 240 s of passing time');
  assert.equal(lateWords(rows[0]), 'Late by 21 s');
  assert.equal(lateWords(rows[1]), 'In time');
  assert.equal(lateWords({ arrived: false, late: true, over: 400 }), 'Did not arrive');
  for (const row of rows) {
    const walk = walks.find((each) => each.groupId === row.group.id);
    assert.deepEqual([row.walking, row.waiting, row.total, row.late], [walk.walking, walk.waiting, walk.total, walk.late], row.group.name);
  }
  assert.equal(rows.length + still.length + failed.length, sample.project.groups.length, 'every group is in the table, stays in its room, or has no route');
});

test('the margin a school allows moves "late by", and late itself is still the walk results\' word', () => {
  const project = school();
  project.settings.checks.passingMarginSeconds = 15;
  const world = derive(project);
  const row = transitionRows(project, world.results, DAY_A, 5).rows[0];
  assert.equal(row.late, true);
  assert.equal(row.over, 6, '261 s against 240 s and 15 s of margin');
  project.settings.checks.passingMarginSeconds = 30;
  const easy = derive(project);
  assert.equal(transitionRows(project, easy.results, DAY_A, 5).rows[0].late, false);
});

test('a group that stays put, and a group with no route, are named apart from the table', () => {
  const project = school();
  const slots = group(project, '7A').days[DAY_A];
  slots[1] = { ...slots[1], room: slots[0].room };
  slots[3] = { ...slots[3], room: null, roomText: '' };
  const world = derive(project);
  const first = transitionRows(project, world.results, DAY_A, 0);
  assert.deepEqual(first.still.map((each) => each.name), ['7A']);
  assert.ok(!first.rows.some((row) => row.group.name === '7A'));
  const third = transitionRows(project, world.results, DAY_A, 2);
  assert.deepEqual(third.failed.map((each) => each.name), ['7A']);
});

test('the day\'s table adds each group\'s walks up, slowest first, and counts its late ones', () => {
  const rows = dayRows(sample.project, sample.results, DAY_A);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].total >= row.total), 'slowest first: ' + rows.map((row) => row.total).join(' '));
  for (const row of rows) {
    const walks = sample.results.walks.groups.filter((walk) => walk.dayTypeId === DAY_A && walk.groupId === row.group.id);
    assert.equal(row.walks, walks.length, row.group.name);
    assert.equal(row.walking, walks.reduce((sum, walk) => sum + walk.walking, 0), row.group.name);
    assert.equal(row.waiting, walks.reduce((sum, walk) => sum + walk.waiting, 0), row.group.name);
    assert.equal(row.total, walks.reduce((sum, walk) => sum + walk.total, 0), row.group.name);
    assert.equal(row.slowest.total, Math.max(...walks.map((walk) => walk.total)), row.group.name);
  }
  const late = rows.filter((row) => row.late > 0);
  assert.deepEqual(late.map((row) => [row.group.name, row.late]), [['8A', 1]]);
  assert.equal(slowestPeriod(sample.results, DAY_A), 5, 'the transition holding the slowest walk of the day');
  assert.equal(slowestPeriod(null, DAY_A), null);
});

// ---------------------------------------------------------------- CSV

test('the three CSV files: their first lines, a row a walk, and names exactly as typed', () => {
  const project = school();
  group(project, '6A').name = '6A, "the early lot"';
  room(project, 'Gym').number = 'Gym, east=half';
  project.dayTypes[0].name = 'A Day; "long"';
  const world = derive(project);
  const view = picture(world);

  const hot = csvText(hotspotsCsv(project, hotspotRows(project, world.results, world.graph, view), view));
  assert.ok(hot.startsWith('﻿Rank,Place,Floor,Kind,Load (students),Peaks in,Groups,Delay (seconds),Delay over the day (seconds),Cells\r\n'), hot.slice(0, 120));
  const hotRows = parseCsv(hot).rows;
  assert.equal(hotRows.length, 11);
  assert.deepEqual(hotRows[1].slice(0, 6), ['1', 'Main Corridor, by Door B', 'Floor 1', 'corridor', '177', 'Period 4 to Period 5']);
  assert.ok(hotRows[1][6].includes('6A, "the early lot"'), hotRows[1][6]);
  assert.deepEqual(hotRows.find((row) => row[3] === 'stairs').slice(1, 3), ['Stairs A, Floor 1 to Floor 2', 'Floor 1; Floor 2']);

  const byTransition = csvText(transitionsCsv(project, world.results, DAY_A, view.dayTypeName));
  assert.ok(byTransition.startsWith('﻿Day type,Transition,Passing time (seconds),Group,From room,To room,Walking (seconds),Waiting (seconds),Total (seconds),Late,Late by (seconds)\r\n'));
  const walks = parseCsv(byTransition).rows;
  assert.equal(walks.length - 1, world.results.walks.groups.filter((walk) => walk.dayTypeId === DAY_A).length, 'one row a walk');
  assert.ok(walks.slice(1).every((row) => row[0] === 'A Day; "long"'));
  const late = walks.filter((row) => row[9] === 'late');
  assert.deepEqual(late, [['A Day; "long"', 'Period 6 to Period 7', '240', '8A', 'Gym, east=half', '303', '261', '0', '261', 'late', '21']]);
  assert.ok(walks.some((row) => row[3] === '6A, "the early lot"'), 'the group as typed, comma and quotes and all');

  const byGroup = csvText(dayCsv(project, world.results, DAY_A, view.dayTypeName));
  assert.ok(byGroup.startsWith('﻿Day type,Group,Walks,Walking (seconds),Waiting (seconds),Total (seconds),Late walks,Slowest walk,Slowest walk (seconds)\r\n'));
  const groups = parseCsv(byGroup).rows;
  assert.equal(groups.length, 9);
  assert.ok(groups.slice(1).every((row, index) => index === 0 || Number(groups[index][5]) >= Number(row[5])), 'slowest first');
  assert.equal(exportFileName(project, 'hotspots', 'csv', '2026-09-01'), 'Marrowby Middle School (sample) - hotspots - 2026-09-01.csv');
});

// ---------------------------------------------------------------- the movement picture

test('both outputs are registered, and each renders with nothing but the project', () => {
  assert.equal(outputFor('movement'), movementPrint);
  assert.equal(outputFor('congestion'), congestionPrint);
  assert.ok(OUTPUTS.includes(movementPrint) && OUTPUTS.includes(congestionPrint));
  assert.equal(movementPrint.name, 'Movement picture');
  assert.equal(congestionPrint.name, 'Congestion report');
  for (const id of ['movement', 'congestion']) {
    const { title, html } = renderOutput(id, school(), null, NOW);
    assert.equal(title, outputFor(id).name + ' · Marrowby Middle School (sample)');
    assert.ok(html.includes('<p class="doc-head__school">Marrowby Middle School (sample)</p>'), id + ': the school');
    assert.ok(html.includes('<p class="doc-head__date">1 September 2026</p>'), id + ': the date');
    assert.equal(html, renderOutput(id, school(), null, NOW).html, id + ': the same project gives the same document');
  }
});

test('the movement picture says what is shown: who, the day type, the transition and its passing time', () => {
  movementPrint.askFor(null);
  const whole = movementPrint.render(sample.project, null, NOW).html;
  assert.ok(whole.includes('<p class="doc-lead">Showing every group (8) on A Day: all 7 transitions of the day. Corridors are coloured by the busiest moment: the most students crossing each cell in any one transition.</p>'), whole.slice(whole.indexOf('doc-lead'), whole.indexOf('doc-lead') + 300));
  const one = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { dayTypeId: DAY_B, transition: 3 } } }).html;
  assert.ok(one.includes('Showing every group (8) on B Day: Period 4 to Period 5, 11:44 to 11:48, 4 min of passing time. Corridors are coloured by the students crossing each cell in this transition.'), one.slice(one.indexOf('doc-lead'), one.indexOf('doc-lead') + 300));
  const some = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { who: 'groups', groupIds: ['gsample06a', 'gsample08a'] } } }).html;
  assert.ok(some.includes('Showing 6A and 8A on A Day'));
  const grade = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { who: 'grade', grade: '7' } } }).html;
  assert.ok(grade.includes('Showing 3 groups of grade 7 on A Day'));
  const total = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { measure: 'total' } } }).html;
  assert.ok(total.includes('Corridors are coloured by the total over the day'));
});

test('the legend, the scale and the hotspot table are each there by choice', () => {
  const html = (parts) => movementPrint.render(sample.project, null, { ...NOW, movement: { parts } }).html;
  const all = html(undefined);
  for (const heading of ['Groups on the map', 'Colour scale', 'Busiest places']) assert.equal(countOf(all, '<h2>' + heading + '</h2>'), 1, heading);
  const noLegend = html({ legend: false });
  assert.equal(countOf(noLegend, '<h2>Groups on the map</h2>'), 0);
  assert.equal(countOf(noLegend, '<h2>Colour scale</h2>'), 1);
  const noScale = html({ scale: false });
  assert.equal(countOf(noScale, '<h2>Colour scale</h2>'), 0);
  assert.equal(countOf(noScale, '<h2>Busiest places</h2>'), 1);
  const noTable = html({ hotspots: false });
  assert.equal(countOf(noTable, '<h2>Busiest places</h2>'), 0);
  assert.equal(countOf(noTable, '<h2>Groups on the map</h2>'), 1);
  const bare = html({ legend: false, scale: false, hotspots: false });
  assert.equal(countOf(bare, '<h2>'), 0);
  assert.equal(countOf(bare, '<table'), 0);
});

test('the three parts hold what the screen holds: the groups, the bands in numbers, the ranked places', () => {
  const { html } = movementPrint.render(sample.project, null, { ...NOW, movement: {} });
  const groups = tableAfter(html, 'Groups on the map');
  assert.deepEqual(groups.map((row) => row[0]), ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B']);
  assert.deepEqual(groups.find((row) => row[0] === '8A').slice(3), ['Yes', 'Once', 'None']);

  const view = picture(sample);
  const edges = bandEdges(sample.project.settings.colourScale, view.load.max);
  const scale = tableAfter(html, 'Colour scale');
  assert.deepEqual(scale.map((row) => row[0]), ['1, quiet', '2', '3', '4', '5, busy']);
  assert.deepEqual(scale.map((row) => row[1]), edges.map((edge) => edge.from + ' to ' + edge.to));
  assert.deepEqual(scale.map((row) => row[2]), ['No lines', '1 line', '2 lines', '3 lines', '4 lines'], 'a pattern beside every colour');
  assert.ok(html.includes('The scale is relative: fifths of the busiest cell on the map, 177. 1 exclusion zone is left out of the scale.'));

  const places = tableAfter(html, 'Busiest places');
  const rows = hotspotRows(sample.project, sample.results, sample.graph, view);
  assert.equal(places.length, 10);
  assert.deepEqual(places[0], ['1', 'Main Corridor, by Door B', '177 students', '5', 'Period 4 to Period 5', '8A, 7A, 6B, 7B, 8B, 6A, 6C, 7C', '13 s']);
  assert.deepEqual(places.map((row) => row[1]), rows.map((row) => placeWords(row)));
});

test('an absolute scale and a single group are said as they are', () => {
  const project = school();
  project.settings.colourScale = { mode: 'absolute', bands: [10, 25, 50, 100] };
  const absolute = movementPrint.render(project, null, { ...NOW, movement: {} }).html;
  assert.ok(absolute.includes('The scale is absolute: fixed loads the school set, so two pictures compare.'));
  assert.deepEqual(tableAfter(absolute, 'Colour scale').map((row) => row[1]), ['1 to 9', '10 to 24', '25 to 49', '50 to 99', '100 or more']);
  const single = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { who: 'groups', groupIds: ['gsample08a'] } } }).html;
  assert.ok(single.includes('Showing 8A on A Day: all 7 transitions of the day. The line is the group&#39;s own colour.'));
  assert.equal(countOf(single, '<h2>Colour scale</h2>'), 0, 'one group alone is not coloured by load');
  const nothing = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { who: 'groups', groupIds: [] } } }).html;
  assert.ok(nothing.includes('<p class="doc-lead">Nothing is shown: no group is chosen.</p>'));
  assert.equal(countOf(nothing, '<table'), 0);
});

test('the map goes in as an image only when it is a PNG or JPEG data address', () => {
  const withPicture = movementPrint.render(sample.project, null, { ...NOW, movement: { picture: { url: PIXEL, width: 1008, height: 1366 } } }).html;
  assert.equal(countOf(withPicture, '<image width="1008" height="1366" href="' + PIXEL + '"/>'), 1);
  assert.ok(withPicture.includes('aria-label="The movement map: Floor 1, Floor 2 and Floor 3."'));
  assert.equal(countOf(withPicture, 'The map itself is added'), 0);
  // it fits the sheet: no wider than the printable width, and room is left for the header
  const size = withPicture.match(/class="plan-figure__plan" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/);
  assert.ok(size, 'the figure has a size in millimetres');
  assert.ok(Number(size[1]) <= 215.9 - 24 && Number(size[2]) <= 279.4 - 28 - 44, size[0]);
  assert.equal((Number(size[1]) / Number(size[2])).toFixed(2), (1008 / 1366).toFixed(2), 'in the picture\'s own shape');

  for (const url of ['https://example.org/map.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', PIXEL + '" onload="alert(1)', '']) {
    const { html } = movementPrint.render(sample.project, null, { ...NOW, movement: { picture: { url, width: 100, height: 100 } } });
    assert.equal(countOf(html, '<image'), 0, url);
    assert.equal(countOf(html, 'example.org') + countOf(html, 'javascript:') + countOf(html, 'onload'), 0, url);
    assert.equal(countOf(html, 'The map itself is added when this is printed from the Export tab of the movement view.'), 1, url);
  }
  const noSize = movementPrint.render(sample.project, null, { ...NOW, movement: { picture: { url: PIXEL, width: 0, height: 100 } } }).html;
  assert.equal(countOf(noSize, '<image'), 0, 'a picture with no size is not one');
});

test('what the Export tab left is read when no choice comes with the call, and a call\'s own choice wins', () => {
  try {
    movementPrint.askFor({ choice: { transition: 0 }, parts: { hotspots: false } });
    const held = movementPrint.render(sample.project, null, NOW).html;
    assert.ok(held.includes('Period 1 to Period 2'));
    assert.equal(countOf(held, '<h2>Busiest places</h2>'), 0);
    const own = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { transition: 4 } } }).html;
    assert.ok(own.includes('Period 5 to Period 6') && !own.includes('Period 1 to Period 2,'));
    assert.equal(countOf(own, '<h2>Busiest places</h2>'), 1);
  } finally {
    movementPrint.askFor(null);
  }
  assert.ok(movementPrint.render(sample.project, null, NOW).html.includes('all 7 transitions of the day'), 'and nothing is left behind');
});

test('the results the planner has are used as they are; without them the same pipeline runs, once a project', () => {
  const project = school();
  const mine = derive(project);
  assert.equal(movementPrint.movementResults(project, mine).results, mine.results);
  assert.equal(movementPrint.movementResults(project, mine.results).results, mine.results, 'the results alone will do');
  const worked = movementPrint.movementResults(project, null);
  assert.notEqual(worked.results, mine.results);
  assert.equal(movementPrint.movementResults(project, null), worked, 'kept while the project\'s parts are the same');
  assert.deepEqual(worked.results.walks.groups, mine.results.walks.groups, 'and they are the pipeline\'s own answer');
  // a change the routes depend on is worked out again
  const moved = { ...project, groups: project.groups.map((each, index) => (index === 0 ? { ...each, headCount: 99 } : each)) };
  assert.notEqual(movementPrint.movementResults(moved, null), worked);
  // and so is a setting the walks depend on, with every other part the very same object
  const again = movementPrint.movementResults(project, null);
  const slower = { ...project, settings: { ...project.settings, secondsPerCell: 5 } };
  const slow = movementPrint.movementResults(slower, null);
  assert.notEqual(slow, again, 'a slower walk is not answered from the faster one\'s results');
  assert.ok(slow.results.walks.groups[0].walking > again.results.walks.groups[0].walking);
  // while a setting they do not depend on leaves the answer standing
  assert.equal(movementPrint.movementResults({ ...slower, settings: { ...slower.settings, paper: { size: 'a4', orientation: 'landscape' } } }, null), slow);
  // the planner's own answer, handed over, is what the next document is made from
  movementPrint.keepResults(project, mine.results, mine.graph);
  assert.equal(movementPrint.movementResults(project, null).results, mine.results);
  assert.equal(movementPrint.render(project, mine, NOW).html, movementPrint.render(school(), null, NOW).html, 'given or worked out, the document is the same');
});

test('the pattern beside a band: no lines for the quietest, one more for each band, all inside the cell', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((band) => movementPrint.bandLines(band).length), [0, 1, 2, 3, 4]);
  assert.deepEqual(movementPrint.bandLines(0), []);
  for (let band = 1; band <= 5; band += 1) {
    for (const line of movementPrint.bandLines(band)) {
      assert.ok(line.every((value) => value >= 0 && value <= 1), band + ': ' + line.join(' '));
      assert.ok(line[0] !== line[2] || line[1] !== line[3], 'a line has a length');
    }
  }
  assert.deepEqual([1, 2, 5].map(movementPrint.lineWords), ['No lines', '1 line', '4 lines']);
});

// ---------------------------------------------------------------- the congestion report

test('the congestion report: for each day type its worst transitions, its busiest places, and who is late', () => {
  const { html } = congestionPrint.render(sample.project, null, NOW);
  assert.equal(countOf(html, '<h2>A Day</h2>'), 1);
  assert.equal(countOf(html, '<h2>B Day</h2>'), 1);
  assert.equal(countOf(html, '<section class="doc-section new-sheet">'), 1, 'the second day type starts a sheet of its own');
  assert.ok(html.indexOf('<h2>A Day</h2>') < html.indexOf('<section class="doc-section new-sheet">') && html.indexOf('<section class="doc-section new-sheet">') < html.indexOf('<h2>B Day</h2>'));
  assert.ok(html.includes('<p class="doc-lead">On A Day the busiest place is Main Corridor, by Door B: 177 students in Period 4 to Period 5. 1 group cannot arrive in time, on 1 walk.</p>'));
  assert.equal(countOf(html, '<h2>The 3 worst transitions</h2>'), 2);
  assert.equal(countOf(html, '<h2>The 10 busiest places</h2>'), 2);
  assert.equal(countOf(html, '<h2>Groups that cannot arrive in time</h2>'), 2);

  const worst = congestionPrint.worstTransitions(sample.project, sample.results, DAY_A);
  assert.equal(worst.length, 7);
  assert.ok(worst.every((each, index) => index === 0 || worst[index - 1].waiting >= each.waiting), 'most time lost first: ' + worst.map((each) => each.waiting).join(' '));
  const printed = tableAfter(html, 'The 3 worst transitions');
  assert.equal(printed.length, 3);
  assert.deepEqual(printed.map((row) => row[0]), worst.slice(0, 3).map((each) => each.name));
  assert.deepEqual(printed[0].slice(0, 3), ['Period 5 to Period 6', '12:16 to 12:20, 4 min', '8']);
  assert.equal(printed[0][5], 'Upper Corridor: 123 students', 'the busiest place of that transition alone');
  const crowd = sample.results.crowd.days.find((day) => day.dayTypeId === DAY_A).transitions[4];
  assert.equal(worst[0].waiting, crowd.groups.reduce((sum, each) => sum + each.waiting, 0), 'the waiting is the crowd model\'s, added up');

  const places = tableAfter(html, 'The 10 busiest places');
  assert.equal(places.length, 10);
  assert.deepEqual(places[0], ['1', 'Main Corridor, by Door B', '177 students', '5', 'Period 4 to Period 5', '8A, 7A, 6B, 7B, 8B, 6A, 6C, 7C', '13 s']);

  const late = tableAfter(html, 'Groups that cannot arrive in time');
  assert.deepEqual(late, [['8A', 'Period 6 to Period 7', 'Gym', '303', '4 min 21 s', 'none', '4 min 21 s', '4 min', 'Late by 21 s']]);
  assert.deepEqual(congestionPrint.lateWalks(sample.project, sample.results, DAY_A).map((row) => [row.group.name, row.over]), [['8A', 21]]);
});

test('a day type on which nobody is late says so, and one that is the same as another has no figures of its own', () => {
  const project = school();
  project.settings.checks.passingMarginSeconds = 60;
  const { html } = congestionPrint.render(project, null, NOW);
  assert.equal(countOf(html, 'Every group arrives in time.'), 2, 'in each day type\'s first line');
  assert.equal(countOf(html, '<p class="doc-none">Every group arrives in time on A Day.</p>'), 1);
  assert.equal(countOf(html, 'doc-table--late'), 0);

  const same = school();
  same.dayTypes[1].own = false;
  for (const each of same.groups) delete each.days[DAY_B];
  const one = congestionPrint.render(same, null, NOW).html;
  assert.equal(countOf(one, '<h2>B Day</h2>'), 0);
  assert.equal(countOf(one, 'new-sheet'), 0);
  assert.ok(one.includes('<p class="doc-meaning">B Day is the same as A Day and has no figures of its own.</p>'));
});

test('an open scenario gets one sentence saying its effect is left out; no scenario, no word of one', () => {
  assert.equal(countOf(congestionPrint.render(sample.project, null, NOW).html, 'cenario'), 0);
  const project = school();
  project.scenario = { name: 'Move 7th grade <b>', changes: [{ kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07a', period: 2, roomId: 'rsample101' }, { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07b', period: 2, roomId: 'rsample102' }], compared: null };
  const { html } = congestionPrint.render(project, null, NOW);
  assert.equal(countOf(html, '<h2>The scenario</h2>'), 1);
  assert.ok(html.includes('<p class="doc-none">A scenario, Move 7th grade &lt;b&gt;, is open with 2 changes. What it would change is left out of this report: the comparison is not built yet, and every figure here is the schedule as it stands.</p>'));
  assert.equal(countOf(html, '<b>'), 0);
  // the figures are the schedule's own: nothing of the scenario was applied
  assert.equal(html.replace(/\n<section class="doc-section doc-scenario">[\s\S]*?<\/section>/, ''), congestionPrint.render(school(), null, NOW).html);
  project.scenario = { name: '  ', changes: [], compared: null };
  assert.ok(congestionPrint.render(project, null, NOW).html.includes('A scenario is open with no changes.'));
});

test('a school where nobody walks still prints both, and says there is nothing to report', () => {
  const project = school();
  for (const each of project.groups) for (const day of Object.keys(each.days)) each.days[day] = each.days[day].map((slot) => ({ ...slot, room: null, roomText: '' }));
  const report = congestionPrint.render(project, null, NOW).html;
  assert.equal(countOf(report, 'Nobody crosses a corridor on A Day yet, so there is nothing to report.'), 1);
  assert.equal(countOf(report, '<table'), 0);
  const map = movementPrint.render(project, null, { ...NOW, movement: {} }).html;
  assert.ok(map.includes('56 routes failed and are not drawn.'), map.slice(map.indexOf('doc-lead'), map.indexOf('doc-lead') + 300));
  assert.ok(map.includes('<p class="doc-none">Nobody on the map crosses a corridor.</p>'));
});

// ---------------------------------------------------------------- hostile names

const HOSTILE = [
  '<script>alert("s")</script>',
  '"><img src=x onerror=alert(1)>',
  '</title></style><svg onload=alert(2)>',
  "O'Neil & <b>Sons</b>",
  '<!-- -->&amp;&lt;',
];

// The sample school with a hostile string in every name a user can type,
// each its own string.
function hostileSchool() {
  const project = school();
  let next = 0;
  const made = [];
  const nasty = (what) => {
    const value = HOSTILE[next % HOSTILE.length] + ' #' + next;
    next += 1;
    made.push({ what, value });
    return value;
  };
  project.settings.schoolName = nasty('school');
  for (const floor of project.building.floors) {
    floor.name = nasty('floor');
    for (const space of floor.spaces) {
      if (space.kind === 'room') {
        space.number = nasty('room');
        space.wing = nasty('wing');
      } else {
        space.label = nasty('other space');
      }
    }
    for (const corridor of floor.corridors) corridor.name = nasty('corridor');
    for (const exit of floor.exits) {
      exit.doorName = nasty('door');
      exit.assembly = nasty('assembly');
    }
  }
  for (const connection of project.building.connections) connection.label = nasty('stairs');
  for (const teacher of project.teachers) teacher.name = nasty('teacher');
  for (const each of project.groups) {
    each.name = nasty('group');
    each.colour = 'red" onmouseover="alert(1)';
  }
  for (const dayType of project.dayTypes) dayType.name = nasty('day type');
  project.scenario = { name: nasty('scenario'), changes: [], compared: null };
  return { project, made };
}

// Every tag either document is made of.
const TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'style', 'body', 'section', 'header', 'footer', 'div', 'p', 'h1', 'h2', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'svg', 'image']);

test('hostile names come through both documents as text: no "<" a name brought reaches the markup', () => {
  const { project, made } = hostileSchool();
  const expected = {
    movement: ['school', 'floor', 'wing', 'corridor', 'door', 'stairs', 'group', 'day type'],
    congestion: ['school', 'floor', 'room', 'wing', 'corridor', 'door', 'stairs', 'group', 'day type', 'scenario'],
  };
  const documents = {
    movement: movementPrint.render(project, null, { ...NOW, movement: { picture: { url: PIXEL, width: 800, height: 600 } } }),
    congestion: congestionPrint.render(project, null, NOW),
  };
  for (const [id, { title, html }] of Object.entries(documents)) {
    assert.ok(title.includes(project.settings.schoolName), id + ': the title is the name as typed');
    for (const { what, value } of made) assert.equal(countOf(html, value), 0, id + ': the ' + what + ' name ' + value + ' is in the markup as typed');
    for (const raw of HOSTILE) assert.equal(countOf(html, raw), 0, id + ': ' + raw);
    for (const what of expected[id]) {
      const names = made.filter((entry) => entry.what === what);
      assert.ok(names.some((entry) => html.includes(esc(entry.value))), id + ': no ' + what + ' name was printed at all');
    }
    const stray = Array.from(html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)).map((match) => match[1]).filter((tag) => !TAGS.has(tag));
    assert.deepEqual(stray, [], id + ': a tag that neither document has');
    assert.equal(countOf(html, '<title>'), 1, id);
    assert.equal(countOf(html, '<style'), 1, id);
    assert.equal(countOf(html, '<script'), 0, id);
    assert.equal(countOf(html, '<img'), 0, id);
    // with every quoted value taken out (a quote inside one is &quot;), no tag has an event handler left in it
    assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, id + ': an event handler attribute');
    // a colour that is not a colour never reaches a style
    assert.equal(countOf(html, 'onmouseover'), 0, id);
    for (const style of html.matchAll(/ style="([^"]*)"/g)) assert.match(style[1], /^[a-z0-9 :;.#-]+$/i, id + ': a style holds only what the module wrote: ' + style[1]);
  }
  assert.ok(documents.movement.html.includes('border-left: 3mm solid #888888;'), 'a group whose colour is not one is drawn grey');
});

test('hostile names reach the CSV files exactly as typed', () => {
  const { project, made } = hostileSchool();
  const world = derive(project);
  const view = picture(world);
  const hot = parseCsv(csvText(hotspotsCsv(project, hotspotRows(project, world.results, world.graph, view), view))).rows;
  const corridor = made.find((entry) => entry.what === 'corridor').value;
  assert.ok(hot.some((row) => row[1].includes(corridor)), 'a corridor\'s name, whole');
  const walks = parseCsv(csvText(transitionsCsv(project, world.results, DAY_A, view.dayTypeName))).rows;
  const groups = made.filter((entry) => entry.what === 'group').map((entry) => entry.value);
  const rooms = made.filter((entry) => entry.what === 'room').map((entry) => entry.value);
  assert.ok(walks.slice(1).every((row) => groups.includes(row[3]) && rooms.includes(row[4]) && rooms.includes(row[5]) && row[0] === made.find((entry) => entry.what === 'day type').value));
  assert.deepEqual(parseCsv(csvText(dayCsv(project, world.results, DAY_A, view.dayTypeName))).rows.slice(1).map((row) => row[1]).sort(), groups.slice().sort());
});

test('rankedPlaces ranks what it is asked, without a picture', () => {
  const load = sample.results.loads.find((each) => each.dayTypeId === DAY_B);
  const view = picture(sample, { dayTypeId: DAY_B });
  const asked = rankedPlaces(sample.project, sample.results, sample.graph, { dayTypeId: DAY_B, groups: sample.project.groups, load, max: load.max.busiest, transition: null, measure: 'busiest', transitions: view.transitions });
  const shown = hotspotRows(sample.project, sample.results, sample.graph, view);
  assert.deepEqual(asked.map((row) => [row.id, row.load, row.when, row.delay]), shown.map((row) => [row.id, row.load, row.when, row.delay]));
  assert.deepEqual(rankedPlaces(sample.project, sample.results, sample.graph, null), []);
});
