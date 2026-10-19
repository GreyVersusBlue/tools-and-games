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
import { hotspotRows, placesElsewhere, rankedPlaces, hotspotsCsv, cellWords, placeWords, createPulse, pulseFrame, PULSE_TOP, TABLE_FIRST, PULSE_MS, PULSE_TIMES } from '../../ui/movement/hotspots.js';
import { transitionRows, dayRows, slowestPeriod, lateWords, transitionsCsv, dayCsv, travelDay } from '../../ui/movement/tables.js';
import { fitScale, heldScale, stepDown, canvasHolds, MAX_SIDE, MAX_AREA, LOWEST_SCALE } from '../../ui/movement/export.js';
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
  assert.ok(hot.startsWith('﻿Rank,Place,Floor,Kind,Load (students),When,Delay (seconds),Delay over the day (seconds),Cells,Groups,"6A, ""the early lot""",6B,6C,7A,7B,7C,8A,8B\r\n'), hot.slice(0, 160));
  const hotRows = parseCsv(hot).rows;
  assert.equal(hotRows.length, 11);
  assert.deepEqual(hotRows[1].slice(0, 6), ['1', 'Main Corridor, by Door B', 'Floor 1', 'corridor', '177', 'Period 4 to Period 5']);
  assert.equal(hotRows[0][10], '6A, "the early lot"', 'a group is a column, headed by its name as typed');
  assert.deepEqual(hotRows[1].slice(6), ['13', '147', '39', '8', '1', '1', '1', '1', '1', '1', '1', '1'], 'each group that crosses has its count under its own name');
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

test('SV2-47 item 6: the print keeps nothing between two calls: what one call chose is not in the next', () => {
  assert.equal(movementPrint.askFor, undefined, 'there is no way to leave a choice behind');
  assert.equal(movementPrint.keepResults, undefined, 'nor an answer');
  const chosen = movementPrint.render(sample.project, null, { ...NOW, movement: { choice: { transition: 0 }, parts: { hotspots: false } } }).html;
  assert.ok(chosen.includes('Period 1 to Period 2'));
  assert.equal(countOf(chosen, '<h2>Busiest places</h2>'), 0);
  const next = movementPrint.render(sample.project, null, NOW).html;
  assert.ok(next.includes('all 7 transitions of the day'), 'the next call, with no choice of its own, is the whole day');
  assert.equal(countOf(next, '<h2>Busiest places</h2>'), 1);
});

test('SV2-47 item 6: a print handed the view\'s own state is made from that project alone, table and sentences alike', () => {
  // the map on screen is from before a change: 7A was renamed and 8A lost its rooms since, and the answer has not come
  const before = derive(school());
  const now = school();
  group(now, '7A').name = '7A East';
  for (const slots of Object.values(group(now, '8A').days)) slots.forEach((slot, period) => { slots[period] = { ...slot, room: null, roomText: '' }; });
  const handed = { project: before.project, results: before.results, graph: before.graph };
  const image = { url: PIXEL, width: 800, height: 600 };
  const picture = movementPrint.render(now, null, { ...NOW, movement: { ...handed, picture: image } }).html;
  assert.deepEqual(tableAfter(picture, 'Groups on the map').map((row) => row[0]), ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B'], 'the groups as the image has them');
  assert.equal(countOf(picture, '7A East'), 0, 'nothing of the project as it is now');
  assert.deepEqual(tableAfter(picture, 'Busiest places')[0], ['1', 'Main Corridor, by Door B', '177 students', '5', 'Period 4 to Period 5', '8A, 7A, 6B, 7B, 8B, 6A, 6C, 7C', '13 s']);
  assert.ok(picture.includes('Showing every group (8) on A Day: all 7 transitions of the day.') && !picture.includes('failed'), 'no route had failed when the image was drawn');
  assert.equal(picture, movementPrint.render(before.project, before, { ...NOW, movement: { picture: image } }).html, 'it is the document of the project the image was drawn from');
  // without the state it is the project given, worked out here
  const fresh = movementPrint.render(now, null, { ...NOW, movement: {} }).html;
  assert.ok(fresh.includes('7A East') && fresh.includes('routes failed'));
  // the congestion report takes the same
  const report = congestionPrint.render(now, null, { ...NOW, movement: handed }).html;
  assert.equal(countOf(report, '7A East'), 0);
  assert.equal(report, congestionPrint.render(before.project, before, NOW).html);
  // and the results handed over are the ones used: nothing is worked out again
  assert.equal(movementPrint.printedFrom(now, null, { movement: handed }).results, before.results);
  assert.equal(movementPrint.printedFrom(now, null, { movement: { choice: {} } }).project, now);
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

test('an open scenario whose comparison has not come gets one sentence saying it is being worked out; no scenario, no word of one', () => {
  assert.equal(countOf(congestionPrint.render(sample.project, null, NOW).html, 'cenario'), 0);
  const project = school();
  project.scenario = { name: 'Move 7th grade <b>', changes: [{ kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07a', period: 2, roomId: 'rsample101' }, { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07b', period: 2, roomId: 'rsample102' }], compared: null };
  const { html } = congestionPrint.render(project, null, NOW);
  assert.equal(countOf(html, '<h2>The scenario: <span dir="auto">Move 7th grade &lt;b&gt;</span></h2>'), 1);
  assert.ok(html.includes('<p class="doc-none">Every figure above was worked out for the schedule as it stands. What the scenario <span dir="auto">Move 7th grade &lt;b&gt;</span> would change is still being worked out.</p>'));
  assert.equal(countOf(html, '<b>'), 0);
  // the figures are the schedule's own: nothing of the scenario was applied
  assert.equal(html.replace(/\n<section class="doc-section doc-scenario">[\s\S]*?<\/section>/, ''), congestionPrint.render(school(), null, NOW).html);
  project.scenario = { name: '  ', changes: [], compared: null };
  assert.ok(congestionPrint.render(project, null, NOW).html.includes('What the scenario <span dir="auto">New scenario</span> would change is still being worked out.'));
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

// ---------------------------------------------------------------- SV2-47: the SV2-18 review

test('SV2-47 item 1: with one floor on the map the table is that floor\'s: no place off the map is a row, and the first row is the legend\'s busiest load', () => {
  const all = picture(sample);
  const whole = hotspotRows(sample.project, sample.results, sample.graph, all);
  assert.equal(placesElsewhere(sample.project, sample.results, sample.graph, all), 0, 'every floor on the map: nothing is elsewhere');
  const view = picture(sample, { floors: 'fsample002' });
  const rows = hotspotRows(sample.project, sample.results, sample.graph, view);
  assert.ok(rows.length > 0 && rows.length < whole.length, rows.length + ' of ' + whole.length);
  for (const row of rows) assert.ok(row.ends.some((end) => end.floorId === 'fsample002'), row.place.name + ' has no end on Floor 2');
  assert.ok(!rows.some((row) => row.place.name === 'Main Corridor, by Door B'), 'the Floor 1 corridor is not a row');
  assert.ok(whole.some((row) => row.place.name === 'Main Corridor, by Door B' && row.load === 177), 'though it is the busiest place of the building');
  assert.deepEqual(rows.map((row) => row.rank), rows.map((row, index) => index + 1), 'ranked from 1 among what is shown');
  // the same number means one thing on the screen: the first row is the legend's maximum, in its top band
  assert.equal(rows[0].load, view.busiest.load);
  assert.equal(rows[0].load, view.load.max);
  assert.ok(view.load.max < 177, 'Floor 2\'s busiest is under the building\'s: ' + view.load.max);
  assert.equal(rows[0].band, 5);
  const top = view.load.edges[4];
  assert.ok(rows[0].load >= top.from && rows[0].load <= top.to, rows[0].load + ' is inside the legend\'s band 5, ' + top.from + ' to ' + top.to);
  for (const row of rows) assert.equal(row.band, bandOf(row.load, sample.project.settings.colourScale, view.load.max), row.place.name);
  // the rest are counted, not listed
  assert.equal(placesElsewhere(sample.project, sample.results, sample.graph, view), whole.length - rows.length);
  // a stairs connection with one end on the floor is on the map, and is a row
  const stairs = rows.filter((row) => row.place.kind === 'connection');
  assert.ok(stairs.length > 0 && stairs.every((row) => row.ends.some((end) => end.floorId !== 'fsample002')), 'the stairs to the floors beside it');
  // the print's table is the same rows, and says how many are elsewhere
  const html = movementPrint.render(sample.project, sample, { ...NOW, movement: { choice: { floors: 'fsample002' } } }).html;
  assert.deepEqual(tableAfter(html, 'Busiest places').map((row) => row[1]), rows.map((row) => placeWords(row)));
  assert.ok(html.includes(' ' + (whole.length - rows.length) + ' more places on floors not shown.'), html.slice(html.indexOf('<h2>Busiest places</h2>'), html.indexOf('<h2>Busiest places</h2>') + 300));
});

test('SV2-47 item 2: a picture the browser\'s canvas cannot hold falls a step at a time to one it can', () => {
  assert.deepEqual([4.4, 4, 3.1, 2, 1, 0.5].map(stepDown), [4, 2, 2, 1, 0.5, 0.25]);
  // a browser whose canvas holds about 16.7 million pixels
  const small = (width, height) => width * height <= 16777216;
  assert.deepEqual(heldScale(1000, 1400, 4, small), { scale: 2, fell: 1 }, '22.4 million pixels are not held; a step down, 5.6 million are');
  assert.deepEqual(heldScale(2000, 3000, 4, small), { scale: 1, fell: 2 });
  assert.deepEqual(heldScale(1000, 1400, 2, small), { scale: 2, fell: 0 }, 'a size that is held is the size drawn');
  assert.deepEqual(heldScale(1000, 1400, 3.8, small), { scale: 2, fell: 1 }, 'from a size the tool\'s own limits gave, down to a whole step');
  const never = heldScale(1000, 1000, 1, () => false);
  assert.equal(never.scale, 0, 'nothing is held: no picture, and the caller says so');
  assert.ok(LOWEST_SCALE <= 0.25 && never.fell >= 3);
  // what is asked of heldScale is the image's own pixels
  const asked = [];
  heldScale(1001, 1401, 2, (width, height) => asked.push([width, height]) > 0);
  assert.deepEqual(asked, [[2002, 2802]]);

  // the probe: one pixel at the far corner, written and read back
  const canvasOf = (alpha, clamp) => {
    const made = { fills: [], reads: [], w: 0, h: 0 };
    const canvas = {
      get width() { return made.w; },
      set width(value) { made.w = clamp ? Math.min(value, clamp) : value; },
      get height() { return made.h; },
      set height(value) { made.h = value; },
      getContext: () => ({ fillRect: (...args) => made.fills.push(args), getImageData: (...args) => { made.reads.push(args); return { data: [0, 0, 0, alpha] }; } }),
    };
    return { made, make: () => canvas };
  };
  const good = canvasOf(255);
  assert.equal(canvasHolds(5000, 3000, good.make), true);
  assert.deepEqual(good.made.fills, [[4999, 2999, 1, 1]]);
  assert.deepEqual(good.made.reads, [[4999, 2999, 1, 1]], 'the pixel read is the pixel written');
  assert.deepEqual([good.made.w, good.made.h], [0, 0], 'the canvas is let go');
  assert.equal(canvasHolds(5000, 3000, canvasOf(0).make), false, 'a canvas that takes no pixel holds no picture');
  assert.equal(canvasHolds(40000, 3000, canvasOf(255, 32767).make), false, 'a canvas the browser made smaller than asked');
  assert.equal(canvasHolds(100, 100, () => { throw new Error('no memory'); }), false);
  assert.equal(canvasHolds(0, 100, good.make), false);
  // with no canvas to ask, the tool's own limits answer
  assert.equal(canvasHolds(MAX_SIDE, 100), true);
  assert.equal(canvasHolds(MAX_SIDE + 1, 100), false);
  assert.equal(canvasHolds(8000, 8000), false, '64 million pixels are over MAX_AREA: ' + MAX_AREA);
  assert.equal(fitScale(1000, 1400, 4), 4, 'and fitScale is what it was');
});

test('SV2-47 item 5: the pulse draws the travelling rings alone, stops when its pulses are done, and leaves no timer', () => {
  // pulseFrame: one arc a ring, nothing else
  const calls = [];
  const g = new Proxy({}, { get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])), set: (target, name, value) => { target[name] = value; return true; } });
  pulseFrame(g, [{ x: 10, y: 20, r: 22 }, { x: 50, y: 60, r: 22 }], 1, { accent: '#0f6e66' });
  assert.deepEqual(calls.map((call) => call[0]), ['beginPath', 'arc', 'stroke', 'beginPath', 'arc', 'stroke']);
  assert.deepEqual(calls[1].slice(1, 4), [10, 20, 22], 'a pulse sets out from the ring itself');
  calls.length = 0;
  pulseFrame(g, [{ x: 10, y: 20, r: 22 }], 0, { accent: '#0f6e66' });
  assert.equal(calls[1][3].toFixed(1), (22 * 1.7).toFixed(1), 'and ends 0.7 of a radius out');
  assert.equal(g.globalAlpha, 1, 'the context is left opaque');

  // the clock, on a hand-wound time
  let now = 1000;
  const waiting = new Map();
  let handle = 0;
  const log = [];
  let reduced = false;
  const pulse = createPulse({
    now: () => now,
    later: (fn, ms) => { handle += 1; waiting.set(handle, { fn, at: now + ms }); return handle; },
    cancel: (id) => waiting.delete(id),
    still: () => reduced,
    frame: (left) => log.push(left),
    done: () => log.push('done'),
  });
  const run = (ms) => {
    const until = now + ms;
    for (;;) {
      const next = Array.from(waiting).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      waiting.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = until;
  };
  assert.equal(pulse.moving, false);
  assert.equal(pulse.start(), true);
  assert.equal(pulse.moving, true);
  assert.equal(log.length, 1, 'the first frame is drawn at once');
  assert.equal(waiting.size, 1, 'one timer');
  run(PULSE_MS * PULSE_TIMES + 200);
  assert.equal(log[log.length - 1], 'done');
  assert.equal(log.filter((each) => each === 'done').length, 1);
  assert.ok(log.length > 100, 'a frame every 60 ms for 7.2 s: ' + log.length);
  assert.ok(log.slice(0, -1).every((left) => left >= 0 && left <= 1));
  assert.equal(pulse.moving, false);
  assert.equal(waiting.size, 0, 'no timer once the pulses are done');
  // stop() mid-pulse clears the timer: nothing fires after it
  log.length = 0;
  pulse.start();
  run(300);
  const drawn = log.length;
  pulse.stop();
  assert.equal(waiting.size, 0, 'the timer is cleared');
  assert.deepEqual(log.slice(drawn), ['done']);
  run(1000);
  assert.equal(log.length, drawn + 1, 'and no frame follows');
  // start() while moving does not set a second timer going
  pulse.start();
  pulse.start();
  assert.equal(waiting.size, 1);
  pulse.stop();
  // under reduced motion nothing moves at all
  reduced = true;
  log.length = 0;
  assert.equal(pulse.start(), false);
  assert.deepEqual(log, []);
  assert.equal(waiting.size, 0);
  assert.equal(pulse.moving, false);
});

test('SV2-47 item 7: a name that begins with = + - or @, or holds a line break, is in all three CSV files exactly as typed', () => {
  // SV2-10's rule stands: `guard` is off unless asked for, because the guard's
  // quote mark changes the name. A file read back gives the names typed.
  const project = school();
  const names = { '6A': '=6A', '6B': '+6B', '6C': '-6C', '7A': '@7A', '7B': '7B\nannex' };
  for (const [from, to] of Object.entries(names)) group(project, from).name = to;
  room(project, 'Gym').number = '=Gym';
  room(project, '303').number = '+303\r\nupstairs';
  project.building.floors[0].corridors.find((each) => each.name === 'Main Corridor').name = '@Main\nCorridor';
  project.dayTypes[0].name = '-A Day';
  const world = derive(project);
  const view = picture(world);
  const typed = Object.values(names);

  const hotTable = hotspotsCsv(project, hotspotRows(project, world.results, world.graph, view), view);
  const hot = parseCsv(csvText(hotTable)).rows;
  assert.deepEqual(hot[0].slice(10), ['=6A', '+6B', '-6C', '@7A', '7B\nannex', '7C', '8A', '8B'], 'a column a group, each name a cell of its own');
  assert.equal(hot[1][1], '@Main\nCorridor, by Door B');
  assert.deepEqual(hot, hotTable.map((row) => row.map(String)), 'the file reads back as the table written');
  assert.ok(csvText(hotTable).includes(',=6A,+6B,-6C,@7A,"7B\nannex",7C,'), 'no quote mark is put before = + - or @');
  assert.ok(csvText(hotTable, { guard: true }).includes(',\'=6A,\'+6B,\'-6C,\'@7A,'), 'that is the guard, and it is the caller\'s to ask for');

  const walks = parseCsv(csvText(transitionsCsv(project, world.results, DAY_A))).rows;
  assert.ok(walks.slice(1).every((row) => row[0] === '-A Day'));
  for (const name of typed) assert.ok(walks.some((row) => row[3] === name), JSON.stringify(name) + ' walks, under its own name');
  assert.deepEqual(walks.find((row) => row[9] === 'late').slice(3, 6), ['8A', '=Gym', '+303\r\nupstairs']);

  const days = parseCsv(csvText(dayCsv(project, world.results, DAY_A))).rows;
  assert.deepEqual(days.slice(1).map((row) => row[1]).sort(), [...typed, '7C', '8A', '8B'].sort());
  assert.ok(days.slice(1).every((row) => row[0] === '-A Day'));
});

test('SV2-47 item 7: the hotspots file has one column a group: no name is joined to another, and a count is never part of a name', () => {
  const project = school();
  // names the old "; " join and " x2" suffix could not tell apart from two groups, or from a count
  group(project, '6A').name = '6A; 6B';
  group(project, '6C').name = '6C x2';
  const world = derive(project);
  const view = picture(world, { measure: 'total' });
  const rows = hotspotRows(project, world.results, world.graph, view);
  const table = hotspotsCsv(project, rows, view);
  assert.deepEqual(table[0].slice(0, 10), ['Rank', 'Place', 'Floor', 'Kind', 'Load (students)', 'When', 'Delay (seconds)', 'Delay over the day (seconds)', 'Cells', 'Groups']);
  assert.deepEqual(table[0].slice(10), project.groups.map((each) => each.name), 'then the groups on the map, in the project\'s order');
  assert.ok(table.every((row) => row.length === 10 + project.groups.length), 'every row is as wide as the headings');
  rows.forEach((row, index) => {
    const cells = table[index + 1].slice(10);
    assert.equal(table[index + 1][9], row.groups.length, row.place.name);
    project.groups.forEach((each, column) => {
      const crossing = row.groups.find((one) => one.group.id === each.id);
      assert.equal(cells[column], crossing ? crossing.times : '', row.place.name + ', ' + each.name);
    });
  });
  assert.ok(table.slice(1).some((row) => row.slice(10).some((times) => times > 1)), 'over a day a group crosses a place in more than one transition, and the count says so');
  // with some groups on the map, only they are columns
  const two = picture(world, { who: 'groups', groupIds: ['gsample06a', 'gsample08a'] });
  assert.deepEqual(hotspotsCsv(project, hotspotRows(project, world.results, world.graph, two), two)[0].slice(10), ['6A; 6B', '8A']);
});

test('SV2-47 item 8: a day type that is the same as another has that one\'s tables, from one source, and says so in every heading', () => {
  const project = school();
  project.dayTypes[1].own = false;
  // a follower's own bells are not its bells: these must never show
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => ({ start: '06:00', end: '06:01' }));
  for (const each of project.groups) delete each.days[DAY_B];
  const world = derive(project);
  assert.deepEqual(travelDay(project, DAY_B), { id: DAY_A, name: 'B Day', heading: 'B Day (same as A Day)' });
  assert.deepEqual(travelDay(project, DAY_A), { id: DAY_A, name: 'A Day', heading: 'A Day' });
  assert.deepEqual(travelDay(sample.project, DAY_B), { id: DAY_B, name: 'B Day', heading: 'B Day' }, 'a day type that is its own copy is itself');
  assert.equal(travelDay(project, 'dnotthere0').id, DAY_A, 'a day type the project does not have is the first');

  const asB = parseCsv(csvText(transitionsCsv(project, world.results, DAY_B))).rows;
  const asA = parseCsv(csvText(transitionsCsv(project, world.results, DAY_A))).rows;
  assert.ok(asB.length > 1, 'B Day\'s file has A Day\'s walks, not none');
  assert.ok(asB.slice(1).every((row) => row[0] === 'B Day (same as A Day)'), asB[1][0]);
  assert.deepEqual(asB.slice(1).map((row) => row.slice(1)), asA.slice(1).map((row) => row.slice(1)), 'every figure is A Day\'s');
  assert.ok(asB.slice(1).every((row) => row[2] === '240'), 'the passing time is A Day\'s bells\', not the follower\'s own');

  const dayB = parseCsv(csvText(dayCsv(project, world.results, DAY_B))).rows;
  assert.equal(dayB.length, 9);
  assert.ok(dayB.slice(1).every((row) => row[0] === 'B Day (same as A Day)'));
  assert.deepEqual(dayB.slice(1).map((row) => row.slice(1)), parseCsv(csvText(dayCsv(project, world.results, DAY_A))).rows.slice(1).map((row) => row.slice(1)));
});

test('SV2-47 item 9: with one transition shown nothing says "Peaks in"; the file\'s When is the day only when the day is added up; Late on the print follows the transition printed', () => {
  // the print's table: no "Peaks in" column when one transition is what is printed
  const one = movementPrint.render(sample.project, sample, { ...NOW, movement: { choice: { transition: 3 } } }).html;
  assert.equal(countOf(one, 'Peaks in'), 0);
  assert.deepEqual(tableAfter(one, 'Busiest places')[0], ['1', 'Main Corridor, by Door B', '177 students', '5', '8A, 7A, 6B, 7B, 8B, 6A, 6C, 7C', '13 s']);
  assert.ok(one.includes('Delay is the waiting the crowd model found at the place in this transition, with every group of the school walking.'));
  const day = movementPrint.render(sample.project, sample, { ...NOW, movement: {} }).html;
  assert.equal(countOf(day, '<th scope="col">Peaks in</th>'), 1, 'over the day each place peaks in a transition of its own');
  assert.equal(countOf(movementPrint.placesTable([], { one: true }), 'Peaks in'), 0);
  assert.equal(countOf(movementPrint.placesTable([], { total: true }), 'Peaks in'), 0);
  assert.equal(countOf(movementPrint.placesTable([], {}), 'Peaks in'), 1);

  // the file: the transition's name, or "the whole day" only when the whole day is what is shown
  const when = (patch) => {
    const view = picture(sample, patch);
    return hotspotsCsv(sample.project, hotspotRows(sample.project, sample.results, sample.graph, view), view).slice(1).map((row) => row[5]);
  };
  assert.ok(when({ measure: 'total' }).every((cell) => cell === 'the whole day'));
  assert.ok(when({ transition: 2 }).every((cell) => cell === 'Period 3 to Period 4'));
  assert.equal(when({})[0], 'Period 4 to Period 5');
  // a row whose peak has no name is left empty at the busiest moment: it is not "the whole day"
  const busiest = picture(sample);
  const nameless = { ...hotspotRows(sample.project, sample.results, sample.graph, busiest)[0], when: '' };
  assert.equal(hotspotsCsv(sample.project, [nameless], busiest)[1][5], '');

  // the print's legend: 8A is late once in the day, in Period 6 to Period 7
  const late = (patch) => {
    const html = movementPrint.render(sample.project, sample, { ...NOW, movement: { choice: patch } }).html;
    const heading = html.slice(html.indexOf('<h2>Groups on the map</h2>')).match(/<th scope="col">(Late[^<]*)<\/th>/)[1];
    return { heading, cell: tableAfter(html, 'Groups on the map').find((row) => row[0] === '8A')[4], other: tableAfter(html, 'Groups on the map').find((row) => row[0] === '6A')[4] };
  };
  assert.deepEqual(late({}), { heading: 'Late', cell: 'Once', other: 'Never' });
  assert.deepEqual(late({ transition: 3 }), { heading: 'Late in this transition', cell: 'No', other: 'No' }, '8A is in time in the transition printed');
  assert.deepEqual(late({ transition: 5 }), { heading: 'Late in this transition', cell: 'Yes', other: 'No' });
});

test('SV2-43 47f: an image handed over beside a state that cannot be used is left out: it is never printed over another project’s figures', () => {
  const before = derive(school());
  const now = school();
  group(now, '7A').name = '7A East';
  const image = { url: PIXEL, width: 800, height: 600 };
  // the state came over without results that can be read: no routes, no results, or no project
  for (const [what, handed] of [
    ['results with no routes', { project: before.project, results: {}, graph: before.graph }],
    ['no results', { project: before.project, results: null, graph: before.graph }],
    ['a project alone', { project: before.project }],
    ['results alone', { results: before.results, graph: before.graph }],
  ]) {
    const from = movementPrint.printedFrom(now, null, { movement: { ...handed, picture: image } });
    assert.equal(from.project, now, what + ': the document is of the project given');
    assert.equal(from.whole, false, what);
    const html = movementPrint.render(now, null, { ...NOW, movement: { ...handed, picture: image } }).html;
    assert.ok(html.includes('7A East'), what + ': the figures are the project’s as it is now');
    assert.equal(countOf(html, '<image '), 0, what + ': the image of the other project is on the page beside them');
    assert.ok(html.includes('The map itself is added when this is printed from the Export tab of the movement view.'), what);
  }
  // the state whole: its image is printed, over its own figures
  const whole = { project: before.project, results: before.results, graph: before.graph };
  assert.equal(movementPrint.printedFrom(now, null, { movement: whole }).whole, true);
  const printed = movementPrint.render(now, null, { ...NOW, movement: { ...whole, picture: image } }).html;
  assert.equal(countOf(printed, '<image '), 1);
  assert.equal(countOf(printed, '7A East'), 0);
  // an image with no state beside it is the caller saying it is of the project given: printed
  assert.equal(movementPrint.printedFrom(before.project, before, { movement: { picture: image } }).whole, true);
  assert.equal(countOf(movementPrint.render(before.project, before, { ...NOW, movement: { picture: image } }).html, '<image '), 1);
  assert.equal(movementPrint.printedFrom(now, null, null).whole, true);
});
