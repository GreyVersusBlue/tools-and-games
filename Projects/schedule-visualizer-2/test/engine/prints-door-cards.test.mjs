// Door cards (ui/prints/door-cards.js) and the two options planSvg gained
// for them (crop, route), rendered in plain Node from the sample school and
// from small drawn buildings, the way test/engine/prints.test.mjs reads a
// print document: as a string.
//
//   node test/engine/prints-door-cards.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as doorCards from '../../ui/prints/door-cards.js';
import { OUTPUTS, outputFor, printButtons } from '../../ui/prints/index.js';
import { planSvg } from '../../ui/prints/plan-svg.js';
import { esc } from '../../ui/prints/document.js';
import { render as floorPlan } from '../../ui/prints/floor-plan.js';
import { roomRows, sortRoomRows } from '../../ui/prints/room-list.js';
import { evacuationRoutes, noRoute, doorCard, ELEVATOR_KIND } from '../../engine/evacuation.js';
import { routingGraph } from '../../engine/routing.js';
import { sampleSchool } from '../../data/sample-school.js';
import { planProject, threeFloors, twoRooms, disconnectedWing, splitLevel, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { PINNED } from './helpers.mjs';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = { now: PINNED };
const PAPERS = [
  { size: 'letter', orientation: 'portrait' },
  { size: 'letter', orientation: 'landscape' },
  { size: 'a4', orientation: 'portrait' },
  { size: 'a4', orientation: 'landscape' },
];

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// The cards' room ids, in the order the document has them.
function cardOrder(html) {
  return Array.from(html.matchAll(/<div class="card" data-card="([^"]+)"/g)).map((match) => match[1]);
}

// Each card's markup, by room id.
function cardsOf(html) {
  const parts = html.split('<div class="card" data-card="').slice(1);
  return new Map(parts.map((part) => [part.slice(0, part.indexOf('"')), part.slice(0, part.indexOf('</section>'))]));
}

// A step's words as they are in the markup, with what a user typed set apart.
function stepNumbers(markup) {
  return Array.from(markup.matchAll(/<li class="card__step" data-n="(\d+)">/g)).map((match) => Number(match[1]));
}

function stepTexts(markup) {
  return Array.from(markup.matchAll(/<span class="card__words">(.*?)<\/span><\/li>/g)).map((match) => match[1].replace(/<span dir="auto">(.*?)<\/span>/g, '$1'));
}

// A corridor that winds back and forth: a run along a row, down two cells at
// one end, back along the next, `turns` times, from Room 1A at the top to Far
// Door at the bottom. Each turn of the corridor is four steps.
function windingCorridor(turns) {
  const width = 12;
  const rows = ['.AA' + '.'.repeat(width - 3), '.AA' + '.'.repeat(width - 3)];
  for (let turn = 0; turn < turns; turn += 1) {
    rows.push('#'.repeat(width));
    const side = turn % 2 === 0 ? width - 1 : 0;
    for (let k = 0; k < 2; k += 1) rows.push(Array.from({ length: width }, (_, x) => (x === side ? '#' : '.')).join(''));
  }
  rows.push('#'.repeat(width));
  return planProject([rows], { doors: { '1A': [[1, 1, 's']] }, exits: [[1, turns % 2 === 0 ? width - 1 : 0, rows.length - 1, 'Far Door']] });
}

// ---------------------------------------------------------------- which rooms, in what order

test('the output is listed, and its button stands next to the floor plan\'s on the Building inspector', () => {
  assert.equal(outputFor('door-cards'), doorCards);
  assert.ok(OUTPUTS.includes(doorCards));
  assert.equal(doorCards.name, 'Door cards');
  const at = printButtons.findIndex((entry) => entry.output === 'door-cards');
  const entry = printButtons[at];
  assert.deepEqual(entry, { id: 'print-door-cards', output: 'door-cards', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print door cards', floors: true });
  assert.equal(printButtons[at - 1].output, 'floor-plan', 'next to the floor plan\'s');
});

test('every room, one card each, in room order: floor by floor, then by number, whatever order the floors list them in', () => {
  const project = sampleSchool();
  // a floor's own order is not room order: put the last room first
  const first = project.building.floors[0];
  first.spaces.unshift(first.spaces.pop());
  const { html } = doorCards.render(project, null, NOW);
  const expected = sortRoomRows(roomRows(project, 'all')).map((row) => row.id);
  assert.deepEqual(cardOrder(html), expected);
  assert.deepEqual(expected.slice(0, 5), ['rsample101', 'rsample102', 'rsample103', 'rsamplecaf', 'rsamplegym']);
  assert.equal(new Set(cardOrder(html)).size, 13);
  // a card is a page of its own under the header, and the first sheet comes before them
  assert.equal(countOf(html, '<section class="page">'), 14);
  assert.equal(countOf(html, '<h1 class="doc-head__what">Evacuation route</h1>'), 13);
  assert.ok(html.indexOf('<h1 class="doc-head__what">Door cards</h1>') < html.indexOf('<div class="card" '));
  assert.ok(html.includes('13 door cards, one for each room in the building, in room order.'));
});

test('a sort the room list was given is not followed: a pile is always in room order', () => {
  const project = sampleSchool();
  const plain = doorCards.render(project, null, NOW).html;
  assert.equal(doorCards.render(project, null, { ...NOW, sort: { column: 'teacher', direction: 'descending' } }).html, plain);
});

test('one floor\'s rooms, a selection in room order whatever order it was given in, one room alone', () => {
  const project = sampleSchool();
  const floor2 = project.building.floors[1];
  const onFloor = sortRoomRows(roomRows(project, floor2.id)).map((row) => row.id);
  const floorHtml = doorCards.render(project, null, { ...NOW, floorId: floor2.id }).html;
  assert.deepEqual(cardOrder(floorHtml), onFloor);
  assert.ok(floorHtml.includes('one for each room on ' + floor2.name));
  // 'all' is every room
  assert.equal(cardOrder(doorCards.render(project, null, { ...NOW, floorId: 'all' }).html).length, 13);

  const chosen = doorCards.render(project, null, { ...NOW, roomIds: ['rsample303', 'rsample101', 'nosuchroom', 'rsample204'] }).html;
  assert.deepEqual(cardOrder(chosen), ['rsample101', 'rsample204', 'rsample303'], 'room order, and an id that is no room is passed over');
  assert.ok(chosen.includes('3 door cards, one for each room chosen'));
  // a selection wins over the floor the preview passes
  assert.deepEqual(cardOrder(doorCards.render(project, null, { ...NOW, floorId: floor2.id, roomIds: ['rsample101'] }).html), ['rsample101']);

  const one = doorCards.render(project, null, { ...NOW, roomIds: ['rsample204'] }).html;
  assert.deepEqual(cardOrder(one), ['rsample204']);
  assert.equal(countOf(one, '<section class="page">'), 1, 'one room with a way out is one card and no first sheet');
  assert.equal(countOf(one, 'Door cards</h1>'), 0);
});

test('no rooms to print says so, in a sentence for each way of asking', () => {
  const project = sampleSchool();
  assert.ok(doorCards.render(project, null, { ...NOW, roomIds: [] }).html.includes('<p class="doc-lead">None of the rooms chosen is in the building.</p>'));
  assert.ok(doorCards.render(project, null, { ...NOW, roomIds: ['nosuchroom'] }).html.includes('None of the rooms chosen is in the building.'));
  const empty = planProject([['#####']], {});
  assert.ok(doorCards.render(empty, null, NOW).html.includes('There are no rooms in the building yet.'));
  assert.ok(doorCards.render(empty, null, { ...NOW, floorId: floorId(1) }).html.includes('There are no rooms on Floor 1 yet.'));
  assert.equal(cardOrder(doorCards.render(empty, null, NOW).html).length, 0);
});

// ---------------------------------------------------------------- the maps

test('every floor the route passes through is drawn, in the order the route reaches them, cropped to the card\'s box', () => {
  const project = threeFloors();
  const graph = routingGraph(project);
  const route = evacuationRoutes(project, graph).rooms.find((entry) => entry.roomId === roomId('3A')).route;
  const card = doorCard(project, graph, route);
  const markup = cardsOf(doorCards.render(project, null, { ...NOW, roomIds: [roomId('3A')] }).html).get(roomId('3A'));
  const maps = Array.from(markup.matchAll(/<figure class="card__map" data-floor="([^"]+)">([\s\S]*?)<\/figure>/g));
  assert.deepEqual(maps.map((match) => match[1]), [floorId(3), floorId(2), floorId(1)]);
  maps.forEach((match, i) => {
    const box = card.floors[i].box;
    const view = match[2].match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    if (i < 2) assert.deepEqual(view, [box.x * 20, box.y * 20, box.width * 20, box.height * 20], match[1] + ': the crop');
    // the exit's floor: the crop, grown where the exit's name needs it
    else assert.ok(view[0] <= box.x * 20 && view[1] <= box.y * 20 && view[0] + view[2] >= (box.x + box.width) * 20 && view[1] + view[3] >= (box.y + box.height) * 20, match[1] + ': the crop and more: ' + view);
    assert.equal(countOf(match[2], '<path class="plan__route"'), i === 1 ? 0 : 1, match[1] + ': the line (floor 2 is one stairs cell: no line, the stairs show it)');
  });
  // the start on the room's floor only, the exit on the exit's floor only
  assert.deepEqual(maps.map((match) => countOf(match[2], 'class="plan__start"')), [1, 0, 0]);
  assert.deepEqual(maps.map((match) => countOf(match[2], 'class="plan__end"')), [0, 0, 1]);
  assert.ok(markup.includes('<figcaption class="card__map-name"><span dir="auto">Floor 3</span> · start</figcaption>'));
  assert.ok(markup.includes('<figcaption class="card__map-name"><span dir="auto">Floor 2</span> · on the way</figcaption>'));
  assert.ok(markup.includes('<figcaption class="card__map-name"><span dir="auto">Floor 1</span> · exit</figcaption>'));
  assert.ok(markup.includes('<p class="card__key">' + doorCards.KEY_SAYS + '</p>'));
});

test('a room on the exit\'s floor has one map, marked start and exit', () => {
  const project = twoRooms();
  const markup = cardsOf(doorCards.render(project, null, NOW).html).get(roomId('1A'));
  assert.equal(countOf(markup, '<figure class="card__map"'), 1);
  assert.equal(countOf(markup, 'class="plan__start"'), 1);
  assert.equal(countOf(markup, 'class="plan__end"'), 1);
  assert.ok(markup.includes('<span dir="auto">Floor 1</span> · start and exit'));
});

test('the maps share one scale, and a small route is not blown up past the largest cell', () => {
  const layout = doorCards.mapLayout([{ width: 10, height: 8 }, { width: 20, height: 4 }], 190, 100);
  assert.ok(layout.cell > 0 && layout.cell <= 9);
  assert.equal(doorCards.mapLayout([{ width: 4, height: 4 }], 190, 100).cell, 9);
  // in a row when that gives the larger cells, one above another when that does
  assert.equal(doorCards.mapLayout([{ width: 30, height: 5 }, { width: 30, height: 5 }], 190, 150).across, false);
  assert.equal(doorCards.mapLayout([{ width: 5, height: 30 }, { width: 5, height: 30 }], 190, 150).across, true);
  const markup = cardsOf(doorCards.render(threeFloors(), null, NOW).html).get(roomId('3A'));
  const sizes = Array.from(markup.matchAll(/<div class="card__plan" style="width: ([\d.]+)mm; height: ([\d.]+)mm;">/g)).map((match) => [Number(match[1]), Number(match[2])]);
  const held = doorCard(threeFloors(), null, evacuationRoutes(threeFloors()).rooms.find((entry) => entry.roomId === roomId('3A')).route).floors;
  const widths = held.map((floor) => planSvg(threeFloors(), threeFloors().building.floors.find((candidate) => candidate.id === floor.floorId), { crop: floor.box, route: { cells: floor.cells, start: floor.start, exit: floor.exit } }).width);
  const scales = sizes.map(([w], i) => w / widths[i]);
  for (const scale of scales) assert.ok(Math.abs(scale - scales[0]) < 0.02, 'one scale: ' + scales.join(', '));
});

// ---------------------------------------------------------------- the words

test('the steps are the evacuation engine\'s, numbered, without distances, and the exit and assembly point close the card', () => {
  const project = sampleSchool();
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  const cards = cardsOf(doorCards.render(project, null, NOW).html);
  for (const entry of evacuation.rooms) {
    const card = doorCard(project, graph, entry.route);
    const markup = cards.get(entry.roomId);
    assert.deepEqual(stepNumbers(markup), card.steps.map((step) => step.n), entry.roomId);
    assert.deepEqual(stepNumbers(markup), card.steps.map((_, i) => i + 1), entry.roomId + ': from 1');
    assert.deepEqual(stepTexts(markup), card.steps.map((step) => esc(step.text)), entry.roomId);
    assert.doesNotMatch(markup, /\d+ cells?\b/, entry.roomId + ': no distance');
    assert.ok(markup.includes('<p class="card__exit-line"><span class="card__label">Exit</span> <span dir="auto">' + esc(card.exit.doorName) + '</span>, <span dir="auto">' + esc(card.exit.floorName) + '</span></p>'), entry.roomId);
    assert.ok(markup.includes('<p class="card__assembly"><span class="card__label">Assembly point</span> <span dir="auto">' + esc(card.exit.assembly) + '</span></p>'), entry.roomId);
    assert.ok(markup.includes('<p class="card__name"><span dir="auto">' + esc(card.name) + '</span></p><p class="card__floor"><span dir="auto">' + esc(card.floor.name) + '</span></p>'), entry.roomId);
  }
});

test('an exit with no assembly point, and one with no door name, say so', () => {
  const project = twoRooms();
  project.building.floors[0].exits[0].doorName = '  ';
  const markup = cardsOf(doorCards.render(project, null, NOW).html).get(roomId('1B'));
  assert.ok(markup.includes('<span class="card__label">Exit</span> The exit on <span dir="auto">Floor 1</span>'));
  assert.ok(markup.includes('<p class="card__assembly card__assembly--none"><span class="card__label">Assembly point</span> None is set for this exit.</p>'));
});

// ---------------------------------------------------------------- long directions

test('directions that run long flow on to a second sheet: thirty-one steps, every one once, numbered on', () => {
  const project = windingCorridor(7);
  const card = doorCard(project, null, evacuationRoutes(project).rooms[0].route);
  assert.ok(card.steps.length >= 30, card.steps.length + ' steps');
  for (const paper of PAPERS) {
    const markup = cardsOf(doorCards.render(project, null, { ...NOW, paper }).html).get(roomId('1A'));
    const at = paper.size + ' ' + paper.orientation;
    const sheets = markup.split('<div class="card__more new-sheet"');
    assert.ok(sheets.length >= 2, at + ': a second sheet');
    assert.deepEqual(stepNumbers(markup), card.steps.map((_, i) => i + 1), at + ': every step once, in order');
    // the first sheet has some, the second carries on from there under its own line
    const onFirst = stepNumbers(sheets[0]);
    assert.ok(onFirst.length > 0 && onFirst.length < card.steps.length, at);
    assert.equal(stepNumbers(sheets[1])[0], onFirst[onFirst.length - 1] + 1, at);
    assert.ok(sheets[1].startsWith(' data-sheet="2"><p class="card__continued"><span dir="auto">Room 1A</span> · <span dir="auto">Floor 1</span> · Evacuation route, continued</p>'), at);
    // the exit on the first sheet, and again where the steps end
    assert.equal(countOf(sheets[0], '<div class="card__exit">'), 1, at);
    assert.equal(countOf(sheets[sheets.length - 1], '<div class="card__exit">'), 1, at);
    assert.equal(countOf(markup, '<div class="card__exit">'), 2, at);
  }
  // a card that fits stays one sheet
  const short = cardsOf(doorCards.render(windingCorridor(1), null, NOW).html).get(roomId('1A'));
  assert.equal(countOf(short, 'new-sheet'), 0);
});

test('the sample school\'s cards are one sheet each, upright and on their side, on both papers', () => {
  for (const paper of PAPERS) {
    const { html } = doorCards.render(sampleSchool(), null, { ...NOW, paper });
    assert.equal(countOf(html, 'card__more new-sheet'), 0, paper.size + ' ' + paper.orientation);
  }
});

test('the steps are cut into sheets by the room each has, and every sheet takes at least one', () => {
  const steps = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: 'Turn left.' }));
  const one = doorCards.sheetsOfSteps(steps, 1000, 1000, { first: 100, later: 100 });
  assert.deepEqual(one.map((sheet) => sheet.length), [10]);
  const cut = doorCards.sheetsOfSteps(steps, 30, 50, { first: 100, later: 100 });
  assert.deepEqual(cut.flat().map((step) => step.n), steps.map((step) => step.n));
  // a one-line step is 11 pt at 1.35 lines and a 1.6 mm gap, 6.84 mm: four in 30 mm, seven in 50
  assert.deepEqual(cut.map((sheet) => sheet.length), [4, 6]);
  // no room at all still moves on, a step a sheet
  assert.deepEqual(doorCards.sheetsOfSteps(steps, 0, 0, { first: 100, later: 100 }).map((sheet) => sheet.length), Array(10).fill(1));
  // a longer step takes more room: a wide script counts nearly twice a Latin letter
  assert.ok(doorCards.linesOf('x'.repeat(200), 50, 11) > doorCards.linesOf('x'.repeat(20), 50, 11));
  assert.ok(doorCards.linesOf('教'.repeat(40), 50, 11) > doorCards.linesOf('e'.repeat(40), 50, 11));
});

// ---------------------------------------------------------------- no way out

test('a room with no way out gets a card in the routing engine\'s own sentence, and the first sheet lists it', () => {
  const project = disconnectedWing();
  const missing = noRoute(project, evacuationRoutes(project));
  assert.deepEqual(missing.map((entry) => entry.roomId), [roomId('1C'), roomId('1D')]);
  const { html } = doorCards.render(project, null, NOW);
  const cards = cardsOf(html);
  for (const entry of missing) {
    const markup = cards.get(entry.roomId);
    assert.ok(markup.startsWith(entry.roomId + '" data-route="none">'));
    assert.ok(markup.includes('<p class="card__none"><span dir="auto">' + esc(entry.sentence) + '</span></p>'), entry.sentence);
    assert.equal(countOf(markup, doorCards.ELEVATOR_SAYS), 0, 'not a room that only an elevator would get out');
    assert.ok(markup.includes(doorCards.NO_ROUTE_SAYS));
    assert.equal(countOf(markup, '<figure'), 0);
    assert.equal(countOf(markup, 'card__step'), 0);
  }
  const cover = html.slice(html.indexOf('<h1 class="doc-head__what">Door cards</h1>'), html.indexOf('<div class="card" '));
  assert.ok(cover.includes('<h2>2 rooms with no way out</h2>'));
  assert.ok(cover.includes('<ul class="card-cover__missing">' + missing.map((entry) => '<li data-room="' + entry.roomId + '"><span dir="auto">' + esc(entry.sentence) + '</span></li>').join('') + '</ul>'));
  assert.ok(cover.includes('<span class="card-cover__to">no way out</span>'));
  assert.ok(cover.includes('<span class="card-cover__to">to <span dir="auto">West Door</span></span>'));
  // the first sheet comes first, before any card
  assert.ok(html.indexOf('card-cover__missing') < html.indexOf('<div class="card" '));
});

test('one room with no way out printed alone still gets the first sheet that lists it; with a way out, the first sheet says every room has one', () => {
  const project = disconnectedWing();
  const alone = doorCards.render(project, null, { ...NOW, roomIds: [roomId('1D')] }).html;
  assert.equal(countOf(alone, '<section class="page">'), 2);
  assert.ok(alone.includes('<h2>A room with no way out</h2>'));
  const fine = doorCards.render(sampleSchool(), null, NOW).html;
  assert.ok(fine.includes('<p class="card-cover__all">Every one of these rooms has a way out.</p>'));
  assert.equal(countOf(fine, 'card-cover__missing'), 0);
});

// ---------------------------------------------------------------- paper

test('the paper and orientation are the ones chosen, landscape included: unlike a door sign, a card is never turned upright', () => {
  for (const paper of PAPERS) {
    const { html } = doorCards.render(sampleSchool(), null, { ...NOW, paper });
    const css = { letter: 'letter', a4: 'A4' }[paper.size];
    assert.ok(html.includes('data-paper="' + paper.size + '" data-orientation="' + paper.orientation + '"'));
    assert.ok(html.includes('<style id="page-size">@page { size: ' + css + ' ' + paper.orientation + '; }</style>'));
    assert.equal(countOf(html, 'card__body--' + (paper.orientation === 'landscape' ? 'side' : 'up')), 13);
  }
  assert.notEqual(doorCards.upright, true);
  // left out, the project's own setting
  const project = sampleSchool();
  project.settings.paper = { size: 'a4', orientation: 'landscape' };
  assert.ok(doorCards.render(project, null, NOW).html.includes('data-paper="a4" data-orientation="landscape"'));
});

// ---------------------------------------------------------------- names as typed

test('hostile names print as text, never as markup', () => {
  const project = twoRooms();
  project.settings.schoolName = '<img src=x onerror=alert(1)> & Sons';
  project.building.floors[0].name = '"Floor" <b>1</b>';
  project.building.floors[0].spaces[0].number = '&amp; <script>alert(2)</script>';
  project.building.floors[0].exits[0].doorName = "O'Neil's <door>";
  project.building.floors[0].exits[0].assembly = '</p><svg onload=alert(3)>';
  const { title, html } = doorCards.render(project, null, NOW);
  assert.equal(title, 'Door cards · <img src=x onerror=alert(1)> & Sons');
  for (const raw of ['<img src=x', '<script>', '<b>1</b>', '<door>', '<svg onload']) assert.equal(countOf(html, raw), 0, raw);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; Sons'));
  assert.ok(html.includes('<p class="card__name"><span dir="auto">&amp;amp; &lt;script&gt;alert(2)&lt;/script&gt;</span></p>'), '&amp; is printed as typed, not read as an ampersand');
  assert.ok(html.includes('<span dir="auto">&quot;Floor&quot; &lt;b&gt;1&lt;/b&gt;</span>'));
  assert.ok(html.includes('<span dir="auto">O&#39;Neil&#39;s &lt;door&gt;</span>'));
  assert.ok(html.includes('<span dir="auto">&lt;/p&gt;&lt;svg onload=alert(3)&gt;</span>'));
  assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i);
});

test('non-Latin room numbers, floor names and door names print as typed, each in its own direction', () => {
  const project = twoRooms();
  project.settings.schoolName = 'مدرسة النور';
  project.building.floors[0].name = '一階';
  project.building.floors[0].spaces[0].number = '٢٠٤';
  project.building.floors[0].spaces[1].number = 'Б-12';
  project.building.floors[0].exits[0].doorName = 'דלת מזרח';
  project.building.floors[0].exits[0].assembly = '校庭の北側';
  const { html } = doorCards.render(project, null, NOW);
  assert.ok(html.includes('<p class="card__name"><span dir="auto">Room ٢٠٤</span></p><p class="card__floor"><span dir="auto">一階</span></p>'));
  assert.ok(html.includes('<span dir="auto">Room Б-12</span>'));
  assert.ok(html.includes('<span dir="auto">דלת מזרח</span>, <span dir="auto">一階</span>'));
  assert.ok(html.includes('<span dir="auto">校庭の北側</span>'));
  assert.ok(html.includes('<p class="doc-head__school">مدرسة النور</p>'));
  // the door's name in a step is set apart too
  assert.ok(html.includes('Exit at <span dir="auto">דלת מזרח</span>.'));
});

// ---------------------------------------------------------------- no clock

test('no clock is read: the date is the one handed in, none without it, and the same options give the same document', () => {
  const project = sampleSchool();
  const bare = doorCards.render(project, null, {}).html;
  assert.equal(countOf(bare, 'doc-head__date'), 0);
  assert.equal(countOf(doorCards.render(project, null, NOW).html, '<p class="doc-head__date">1 September 2026</p>'), 14);
  assert.equal(doorCards.render(sampleSchool(), null, NOW).html, doorCards.render(sampleSchool(), null, NOW).html);
  const code = readFileSync(path.join(TOOL_DIR, 'ui', 'prints', 'door-cards.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bDate\b|performance\.now|Math\.random/);
});

// ---------------------------------------------------------------- SV2-66b: the review's six

// What cardFit needs for one room: the room list's row and the card.
function fitOf(project, id, paper, last) {
  const graph = routingGraph(project);
  const entry = evacuationRoutes(project, graph).rooms.find((candidate) => candidate.roomId === id);
  const row = roomRows(project, 'all').find((candidate) => candidate.id === id);
  return doorCards.cardFit(project, row, doorCard(project, graph, entry.route), paper, { last });
}

// The cell a card's first map is drawn at, in mm, read from the markup.
function cellIn(markup, plan) {
  return Number(markup.match(/<div class="card__plan" style="width: ([\d.]+)mm;/)[1]) / plan.width;
}

test('Room 303 upright on Letter: three floors\' maps at least half as large again as the 2.3 mm a cell they were, every step still on the one sheet', () => {
  const project = sampleSchool();
  const letter = { size: 'letter', orientation: 'portrait' };
  const markup = cardsOf(doorCards.render(project, null, { ...NOW, paper: letter, roomIds: ['rsample303'] }).html).get('rsample303');
  const fit = fitOf(project, 'rsample303', letter, true);
  // before this fix: one row of three at 85.05 mm for a 37-cell box, 2.30 mm a cell
  const before = 85.05 / 37;
  const cell = cellIn(markup, fit.plans[0]);
  assert.ok(cell >= before * 1.5, cell + ' mm a cell, against ' + before.toFixed(3) + ' before');
  assert.ok(Math.abs(cell - fit.layout.cell) < 0.01, 'the markup is the fit');
  assert.equal(countOf(markup, 'new-sheet'), 0, 'the steps stay on one sheet');
  assert.equal(stepNumbers(markup).length, 15);
  // the largest map on its own row, the other two in a row under it
  assert.deepEqual([fit.layout.kind, fit.layout.groups], ['rows', [[0], [1, 2]]]);
  assert.ok(markup.includes('<div class="card__maps card__maps--rows"><div class="card__maps-group"><figure class="card__map" data-floor="fsample003">'));
  // the maps take the height the steps leave: here, with the steps in two columns
  assert.equal(fit.columns, 2);
  assert.ok(markup.includes('<ul class="card__steps card__steps--two">'));
  assert.ok(Math.abs(fit.region.height - (fit.room - fit.key - 4 - fit.exit - fit.firstSteps)) < 1e-9);
  assert.ok(fit.layout.height <= fit.region.height + 1e-9);
  // landscape: no smaller than before (3.47 mm on Letter, 3.27 on A4) on a card the closing line does not follow
  for (const [size, was] of [['letter', 3.467], ['a4', 3.27]]) {
    const side = fitOf(project, 'rsample303', { size, orientation: 'landscape' }, false);
    assert.ok(side.layout.cell >= was, size + ' landscape: ' + side.layout.cell);
    assert.equal(side.sheets.length, 1, size + ' landscape: one sheet');
  }
  // every sample card on every paper is still one sheet (the test above), and
  // each arrangement is one scale: a row, a stack, rows, columns
  const rows = doorCards.mapLayout([{ width: 30, height: 10 }, { width: 14, height: 10 }, { width: 14, height: 10 }], 100, 100);
  assert.deepEqual([rows.kind, rows.groups], ['rows', [[0], [1, 2]]]);
  const columns = doorCards.mapLayout([{ width: 10, height: 30 }, { width: 10, height: 14 }, { width: 10, height: 14 }], 100, 120);
  assert.deepEqual([columns.kind, columns.groups], ['columns', [[0], [1, 2]]]);
});

// The box a door name's text could take, on the safe side, from the markup:
// 0.6 of the size a character (the plan's face runs about 0.5), 0.7 in a
// script the face has not got, and the line's height round its centre.
function nameBoxes(svg) {
  return Array.from(svg.matchAll(/<text class="plan__exit-name( plan__exit-name--([we]))?" x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)">([^<]*)<\/text>/g)).map((match) => {
    const [, , side, x, y, size, name] = match;
    const width = Array.from(name).reduce((sum, character) => sum + (character.codePointAt(0) < 0x0250 ? 0.6 : 0.7), 0) * Number(size);
    const left = side === 'w' ? Number(x) - width : side === 'e' ? Number(x) : Number(x) - width / 2;
    return { name, left, right: left + width, top: Number(y) - Number(size) * 0.6, bottom: Number(y) + Number(size) * 0.6 };
  });
}

test('the exit\'s door name is wholly on the card\'s map: the window grows past the floor\'s edge on the exit\'s side', () => {
  const check = (project, ids, names) => {
    const cards = cardsOf(doorCards.render(project, null, { ...NOW, roomIds: ids }).html);
    const seen = [];
    for (const id of ids) {
      for (const figure of cards.get(id).matchAll(/<figure class="card__map"[\s\S]*?<\/figure>/g)) {
        const [vx, vy, vw, vh] = figure[0].match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
        for (const box of nameBoxes(figure[0])) {
          seen.push(box.name);
          assert.ok(box.left >= vx && box.right <= vx + vw && box.top >= vy && box.bottom <= vy + vh, id + ': ' + box.name + ' ' + JSON.stringify(box) + ' in ' + [vx, vy, vw, vh]);
        }
      }
    }
    for (const name of names) assert.ok(seen.includes(esc(name)), name + ' is drawn');
  };
  // Door A below Floor 1 (Rooms 101 and 303), Door B to the east (the gym)
  check(sampleSchool(), ['rsample101', 'rsamplegym', 'rsample303'], ['Door A', 'Door B']);
  const long = sampleSchool();
  const first = long.building.floors[0];
  first.exits.find((exit) => exit.doorName === 'Door A').doorName = 'Main entrance by the bus loop and the staff car park';
  first.exits.find((exit) => exit.doorName === 'Door B').doorName = 'דלת הכניסה המזרחית';
  check(long, ['rsample101', 'rsamplegym', 'rsample303'], ['Main entrance by the bus loop and the staff car park', 'דלת הכניסה המזרחית']);
  // a plan with no route keeps its window as asked, the floor's edge and all
  const floor = first;
  assert.ok(planSvg(long, floor, { crop: { x: 0, y: 0, width: floor.width, height: floor.height } }).svg.includes('viewBox="0 0 ' + floor.width * 20 + ' ' + floor.height * 20 + '"'));
});

test('the last card keeps room for the closing line, page boxes or none: windingCorridor(3) upright reserves it in its estimate', () => {
  const project = windingCorridor(3);
  for (const size of ['letter', 'a4']) {
    const paper = { size, orientation: 'portrait' };
    const last = fitOf(project, roomId('1A'), paper, true);
    const inPile = fitOf(project, roomId('1A'), paper, false);
    assert.equal(last.foot, doorCards.FOOT_MM, size);
    assert.equal(inPile.foot, 0, size);
    assert.ok(Math.abs(inPile.room - last.room - doorCards.FOOT_MM) < 1e-9, size + ': the first sheet\'s room');
    assert.ok(Math.abs(inPile.later - last.later - doorCards.FOOT_MM) < 1e-9, size + ': a later sheet\'s room');
    assert.ok(last.region.height + last.firstSteps + last.key + 4 + last.exit + doorCards.FOOT_MM <= inPile.room + 1e-9, size + ': maps, steps and the closing line fit the sheet');
    // the document lays its last card out that way
    const markup = cardsOf(doorCards.render(project, null, { ...NOW, paper }).html).get(roomId('1A'));
    assert.ok(Math.abs(cellIn(markup, last.plans[0]) - last.layout.cell) < 0.01, size + ': the card is the last card\'s fit');
    assert.equal(countOf(markup, 'new-sheet'), 0, size + ': one sheet');
  }
  assert.ok(doorCards.FOOT_MM >= 12, 'the closing line: 6 mm, 2 mm, its rule, 8 pt');
});

test('a floor that is not in the building, or room ids that are not a list, print one sheet saying so, never every room', () => {
  const project = sampleSchool();
  for (const options of [{ floorId: 'nosuchfloor' }, { floorId: 42 }]) {
    const { html } = doorCards.render(project, null, { ...NOW, ...options });
    assert.equal(cardOrder(html).length, 0, JSON.stringify(options));
    assert.equal(countOf(html, '<section class="page">'), 1);
    assert.ok(html.includes('<p class="doc-lead">' + doorCards.NOTHING_SAYS + '</p>'));
    assert.equal(countOf(html, 'one for each room in the building'), 0);
  }
  const notList = doorCards.render(project, null, { ...NOW, roomIds: 'rsample101' }).html;
  assert.equal(cardOrder(notList).length, 0);
  assert.ok(notList.includes('None of the rooms chosen is in the building.'));
  // left out, '' and 'all' are still every room
  for (const floorId of [undefined, null, '', 'all']) assert.equal(cardOrder(doorCards.render(project, null, { ...NOW, floorId }).html).length, 13, String(floorId));
});

test('the routing engine\'s sentences on a no-route card and the first sheet are set like names: a right-to-left room name reads in its own direction', () => {
  const project = disconnectedWing();
  project.building.floors[0].spaces.find((space) => space.id === roomId('1C')).number = 'חדר ג';
  const { html } = doorCards.render(project, null, NOW);
  const entry = noRoute(project, evacuationRoutes(project)).find((candidate) => candidate.roomId === roomId('1C'));
  assert.ok(entry.sentence.includes('חדר ג'));
  const sentence = '<span dir="auto">' + esc(entry.sentence) + '</span>';
  assert.ok(cardsOf(html).get(roomId('1C')).includes('<p class="card__none">' + sentence + '</p>'));
  assert.ok(html.includes('<li data-room="' + roomId('1C') + '">' + sentence + '</li>'));
});

test('a room whose only way out is by elevator says so on its card and on the first sheet', () => {
  // two floors joined twice, both joins elevators: Room 2A's only way down
  const floor = ['..AA......', '..AA......', 'S########S', '..........', '..........'];
  const project = planProject([floor, floor], {
    doors: { '1A': [[2, 1, 's']], '2A': [[2, 1, 's']] },
    connections: [[1, 0, 2, 2, 0, 2], [1, 9, 2, 2, 9, 2]],
    exits: [[1, 1, 2, 'West Door']],
  });
  for (const connection of project.building.connections) connection.kind = ELEVATOR_KIND;
  assert.deepEqual(evacuationRoutes(project).rooms.map((entry) => entry.onlyByElevator), [false, true]);
  const { html } = doorCards.render(project, null, NOW);
  const card = cardsOf(html).get(roomId('2A'));
  assert.ok(card.includes('<p class="card__none"><span dir="auto">There is no way through from Room 2A on Floor 2 to an exit.</span></p><p class="card__lift">' + doorCards.ELEVATOR_SAYS + '</p>'));
  assert.equal(countOf(cardsOf(html).get(roomId('1A')), doorCards.ELEVATOR_SAYS), 0);
  assert.ok(html.includes('<li data-room="' + roomId('2A') + '"><span dir="auto">There is no way through from Room 2A on Floor 2 to an exit.</span> ' + doorCards.ELEVATOR_SAYS + '</li>'));
  assert.ok(html.includes('<span class="card-cover__to">no way out but by elevator</span>'));
  // with the elevators made stairs, the room has its way out and nothing is said
  for (const connection of project.building.connections) delete connection.kind;
  assert.equal(countOf(doorCards.render(project, null, NOW).html, doorCards.ELEVATOR_SAYS), 0);
});

// ---------------------------------------------------------------- planSvg's two options

// Every floor of these, drawn with no options and hashed. The hash was taken
// from planSvg as it was before crop and route existed (sv2 at c3fe77e), and
// so was the floor plan print's.
const PLAN_HASH = '4e886855bc6973ccef36d5e35d151faae06e23287dd16939f933bed6b019a160';
const FLOOR_PLAN_HASH = '9e630c4687bfd6d29f439dea31c72bacba092620f8e1c91602c4a2d3175713d3';

test('with neither option, planSvg and the floor plan print are byte for byte what they were', () => {
  const hash = createHash('sha256');
  for (const project of [sampleSchool(), threeFloors(), twoRooms(), disconnectedWing(), splitLevel()]) {
    for (const floor of project.building.floors) {
      const plain = planSvg(project, floor);
      hash.update(JSON.stringify(plain));
      assert.deepEqual(planSvg(project, floor, {}), plain);
      assert.deepEqual(planSvg(project, floor, { crop: null, route: null }), plain);
      assert.deepEqual(planSvg(project, floor, { crop: { x: 'a' }, route: 'no' }), plain, 'what is not a window or a route is no option');
    }
  }
  assert.equal(hash.digest('hex'), PLAN_HASH);
  const print = createHash('sha256');
  for (const paper of [{ size: 'letter', orientation: 'portrait' }, { size: 'a4', orientation: 'landscape' }]) print.update(floorPlan(sampleSchool(), null, { ...NOW, paper }).html);
  assert.equal(print.digest('hex'), FLOOR_PLAN_HASH);
});

test('crop draws only the window, edge to edge, and counts only what is in it', () => {
  const project = sampleSchool();
  const floor = project.building.floors[0];
  const whole = planSvg(project, floor);
  const room101 = floor.spaces.find((space) => space.id === 'rsample101');
  const xs = room101.cells.map((cell) => cell % floor.width);
  const ys = room101.cells.map((cell) => Math.floor(cell / floor.width));
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
  const cropped = planSvg(project, floor, { crop: box });
  assert.equal(cropped.width, box.width);
  assert.equal(cropped.height, box.height);
  assert.ok(cropped.svg.includes('viewBox="' + [box.x * 20, box.y * 20, box.width * 20, box.height * 20].join(' ') + '"'));
  assert.equal(cropped.rooms, 1);
  assert.ok(cropped.rooms < whole.rooms);
  assert.ok(cropped.svg.includes('>101</text>'));
  assert.ok(!cropped.svg.includes('>Gym</text>'), 'a room wholly outside is left out');
  assert.ok(cropped.svg.length < whole.svg.length);
  // clamped to the floor
  const past = planSvg(project, floor, { crop: { x: -5, y: -5, width: floor.width + 20, height: floor.height + 20 } });
  assert.equal(past.width, floor.width);
  assert.equal(past.height, floor.height);
  assert.ok(past.svg.includes('viewBox="0 0 ' + floor.width * 20 + ' ' + floor.height * 20 + '"'));
});

test('route draws the way out: a line through the cells, starting again at a jump, the round start and the square exit', () => {
  const project = twoRooms();
  const floor = project.building.floors[0];
  const at = (x, y) => y * floor.width + x;
  const plan = planSvg(project, floor, { route: { cells: [at(1, 2), at(2, 2), at(3, 2), at(6, 2), at(7, 2), 'x', -1, 9999], start: at(1, 1), exit: at(7, 2) } });
  const line = plan.svg.match(/<path class="plan__route" d="([^"]+)"\/>/)[1];
  // from the start in the room down to the corridor, along, then a fresh line where the cells do not touch
  assert.equal(line, 'M30 30L30 50L50 50L70 50M130 50L150 50');
  assert.ok(plan.svg.includes('<path class="plan__route-band" d="' + line + '"/>'));
  assert.equal(countOf(plan.svg, 'class="plan__start"'), 1);
  assert.equal(countOf(plan.svg, 'class="plan__end"'), 1);
  // the way is drawn over everything else
  assert.ok(plan.svg.lastIndexOf('<g class="plan__way">') > plan.svg.lastIndexOf('class="plan__exit"'));
  // no start, no exit: only the line
  const through = planSvg(project, floor, { route: { cells: [at(2, 2), at(3, 2)], start: null, exit: null } });
  assert.equal(countOf(through.svg, 'plan__start'), 0);
  assert.equal(countOf(through.svg, 'plan__end'), 0);
  assert.ok(through.svg.includes('d="M50 50L70 50"'));
});

test('print.css has the door card\'s rules, the route\'s marks among them', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8');
  for (const selector of ['.print-doc .card__step', '.print-doc .card__exit', '.print-doc .card__body--side', '.print-doc .plan__route', '.print-doc .plan__start', '.print-doc .plan__end']) {
    assert.ok(css.includes(selector + ' {'), selector);
  }
  // the step's size is the one door-cards.js counts with (11 pt, 1.35 lines, a 1.6 mm gap)
  const step = css.slice(css.indexOf('.print-doc .card__step {'), css.indexOf('}', css.indexOf('.print-doc .card__step {')));
  assert.match(step, /font-size: 11pt;/);
  assert.match(step, /line-height: 1\.35;/);
  assert.match(step, /margin: 0 0 1\.6mm;/);
});
