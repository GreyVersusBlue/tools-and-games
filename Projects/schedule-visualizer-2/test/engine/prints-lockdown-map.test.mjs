// The lockdown map on paper (ui/prints/lockdown-map.js; SV2-110; DESIGN 14.6 and 14.7 item 6),
// rendered in plain Node and read as a string.
//
//   node test/engine/prints-lockdown-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as sheet from '../../ui/prints/lockdown-map.js';
import { OUTPUTS, outputFor } from '../../ui/prints/index.js';
import { frame, esc, paperOf, printableBox, PAPERS as SHEETS } from '../../ui/prints/document.js';
import { planSvg, gridSquare } from '../../ui/prints/plan-svg.js';
import { school, PINNED } from './helpers.mjs';
import { withElevator } from '../fixtures/step-free.mjs';
import { planProject } from '../fixtures/buildings/plans.mjs';

const NOW = { now: PINNED };
const PRINT_CSS = readFileSync(new URL('../../ui/print.css', import.meta.url), 'utf8');
const PAPERS = [
  { size: 'letter', orientation: 'landscape' },
  { size: 'letter', orientation: 'portrait' },
  { size: 'a4', orientation: 'landscape' },
  { size: 'a4', orientation: 'portrait' },
  { size: 'a2', orientation: 'landscape' },
];

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

// the lines of one block of the index, as text
function block(html, name) {
  const from = html.indexOf('data-block="' + name + '"');
  assert.ok(from > 0, 'the ' + name + ' block is there');
  return html.slice(from, html.indexOf('</section>', from));
}

function items(html) {
  return Array.from(html.matchAll(/<li[^>]*>(.*?)<\/li>/g)).map((match) => text(match[1]).trim());
}

test('the output is registered, landscape, and exports pages() and render = frame(pages)', () => {
  assert.equal(sheet.id, 'lockdown-map');
  assert.equal(sheet.orientation, 'landscape');
  assert.equal(outputFor('lockdown-map'), sheet);
  assert.equal(OUTPUTS.filter((output) => output.id === 'lockdown-map').length, 1);
  const project = school();
  const pages = sheet.pages(project, null, NOW);
  assert.equal(pages.length, 3, 'one sheet a floor');
  assert.deepEqual(pages.map((page) => page.what), ['Lockdown map · Floor 1', 'Lockdown map · Floor 2', 'Lockdown map · Floor 3']);
  const whole = sheet.render(project, null, NOW);
  assert.deepEqual(whole, frame(project, { output: 'lockdown-map', what: 'Lockdown map', pages, options: NOW }));
  assert.equal(whole.title, 'Lockdown map · Marrowby Middle School (sample)');
});

test('the index gives every room and labelled space the grid square the picture drew it in', () => {
  const project = school();
  const { html } = sheet.render(project, null, { ...NOW, floorIds: ['fsample001'] });
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { refGrid: true });
  const want = floor.spaces.map((space) => {
    const name = space.kind === 'room' ? space.number : space.label;
    return name + ' · ' + gridSquare(plan.grid, floor.width, plan.labelCells.get(space.id));
  });
  const rooms = items(block(html, 'rooms'));
  assert.equal(rooms.length, want.length);
  for (const line of want) assert.ok(rooms.includes(line), line + ' is in the index: ' + rooms.join(' / '));
  // the rooms by number first, then the other spaces by label
  const named = floor.spaces.filter((space) => space.kind === 'room').length;
  assert.deepEqual(rooms.slice(0, named).map((line) => line.split(' · ')[0]), ['101', '102', '103', 'Cafeteria', 'Gym']);
  assert.deepEqual(rooms.slice(named).map((line) => line.split(' · ')[0]), ['Bathrooms', 'Courtyard', 'Kitchen', 'Office']);
  assert.match(rooms[0], /^101 · [A-L]([1-9]|1[0-2])$/);
  // the grid is 12 columns or fewer and 12 rows or fewer, and is in the picture
  assert.ok(plan.grid.cols <= 12 && plan.grid.rows <= 12);
  assert.ok(html.includes('plan__grid-lines'));
});

test('the exits are numbered as everywhere, with their door names and floors; the stairs by letter', () => {
  const project = school();
  const { html } = sheet.render(project, null, { ...NOW, floorIds: ['fsample002'] });
  assert.deepEqual(items(block(html, 'exits')), ['1 Door A · Floor 1', '2 Door B · Floor 1']);
  assert.deepEqual(items(block(html, 'stairs')), ['Stairs A, Floor 1 to Floor 2', 'Stairs B, Floor 2 to Floor 3']);
  // Floor 1 touches only A
  const first = sheet.render(project, null, { ...NOW, floorIds: ['fsample001'] }).html;
  assert.deepEqual(items(block(first, 'stairs')), ['Stairs A, Floor 1 to Floor 2']);
});

test('an elevator is listed with its floors, and "staff only" when it is', () => {
  const project = withElevator();
  const { html } = sheet.render(project, null, { ...NOW, floorIds: ['fsample002'] });
  const lines = items(block(html, 'stairs'));
  assert.ok(lines.includes('Elevator A · Floor 1 and Floor 2 · staff only'), lines.join(' / '));
  assert.ok(lines.includes('Stairs B, Floor 2 to Floor 3'));
});

test('the three footer lines are on every sheet', () => {
  const { html } = sheet.render(school(), null, NOW);
  assert.equal(countOf(html, 'class="lockdown__foot"'), 3);
  for (const line of sheet.FOOTER_LINES) assert.equal(countOf(html, '<p>' + esc(line) + '</p>'), 3, line);
  assert.deepEqual(sheet.FOOTER_LINES, [
    'Rooms, exits, stairs and elevators only: no staff or student lists.',
    'Not every exit opens from outside.',
    'Room labels print as typed in Building.',
  ]);
});

test('no teacher, group or head count is anywhere on it', () => {
  const project = school();
  for (const paper of PAPERS) {
    const { html } = sheet.render(project, null, { ...NOW, paper });
    const said = text(html);
    for (const teacher of project.teachers) {
      assert.equal(countOf(said, teacher.name), 0, teacher.name + ' is on the sheet');
      // not even the surname that sits under a room number
      const surname = teacher.name.split(' ').pop();
      assert.equal(countOf(html, '>' + esc(surname) + '<'), 0, surname + ' is in the picture');
    }
    for (const group of project.groups) assert.equal(countOf(said, ' ' + group.name + ' '), 0, group.name);
    assert.doesNotMatch(said, /\bcapacity\b|\bhead count\b|\bpeople\b/i);
  }
});

test('floorIds picks the floors; a list with none of the building\'s floors prints them all', () => {
  const project = school();
  const some = sheet.pages(project, null, { ...NOW, floorIds: ['fsample003', 'fsample001'] });
  assert.deepEqual(some.map((page) => page.what), ['Lockdown map · Floor 1', 'Lockdown map · Floor 3']);
  assert.equal(sheet.pages(project, null, { ...NOW, floorIds: ['nope'] }).length, 3);
  assert.equal(sheet.pages(project, null, { ...NOW, floorIds: [] }).length, 3);
});

test('an unnamed exit is called by its floor, a building with no exit says so, and a room with no number is counted', () => {
  const project = school();
  project.building.floors[0].exits[1].doorName = '';
  const { html } = sheet.render(project, null, { ...NOW, floorIds: ['fsample001'] });
  assert.deepEqual(items(block(html, 'exits')), ['1 Door A · Floor 1', '2 The exit on Floor 1 · Floor 1']);

  const none = school();
  for (const floor of none.building.floors) floor.exits = [];
  const bare = sheet.render(none, null, NOW).html;
  assert.equal(countOf(bare, 'data-line="no-exit"'), 3);
  assert.ok(bare.includes('The building has no exit yet. Add one in Building.'));

  const numberless = school();
  numberless.building.floors[0].spaces[0].number = '';
  numberless.building.floors[0].spaces[1].number = ' ';
  const said = sheet.render(numberless, null, { ...NOW, floorIds: ['fsample001'] }).html;
  assert.ok(said.includes('2 rooms with no number are not listed.'));
  assert.equal(items(block(said, 'rooms')).length, 9 - 2);
});

test('a floor with no rooms, and a floor with nothing drawn, each still print a sheet with the footer', () => {
  const project = planProject([['.....', '#####', '.....'], ['.....']], { exits: [[1, 0, 1, 'Only Door']] });
  const { html } = sheet.render(project, null, NOW);
  assert.equal(countOf(html, '<section class="page">'), 2);
  assert.ok(html.includes('No rooms or labelled spaces on this floor.'));
  assert.ok(html.includes('Nothing is drawn on Floor 2 yet.'));
  assert.equal(countOf(html, 'class="lockdown__foot"'), 2);
  const empty = planProject([['.....']]);
  const blank = sheet.render(empty, null, NOW).html;
  assert.ok(blank.includes('Nothing is drawn on Floor 1 yet.'));
});

test('hostile names are text: a room, a space, a door, a floor, stairs and the school', () => {
  const project = school();
  const mean = ['<script>alert(1)</script>', '"><img src=x onerror=alert(2)>', "O'Neil & <b>Sons</b>", '</title><svg onload=alert(3)>', '<!-- -->&amp;'];
  const [f1] = project.building.floors;
  project.settings.schoolName = mean[0];
  f1.name = mean[1];
  f1.spaces[0].number = mean[2];
  f1.spaces[4].number = mean[3];
  f1.spaces.find((space) => space.kind === 'other').label = mean[4];
  f1.exits[0].doorName = mean[3] + ' door';
  project.building.connections[0].label = mean[2] + ' stairs';
  const { html } = sheet.render(project, null, { ...NOW, floorIds: [f1.id] });
  for (const raw of mean) assert.equal(countOf(html, raw), 0, raw + ' is in the markup as typed');
  for (const raw of mean) assert.ok(html.includes(esc(raw)), raw + ' is there, escaped');
  assert.equal(countOf(html, '<script'), 0);
  assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, 'an event handler attribute');
  assert.equal(countOf(html, '<style'), 1);
  assert.equal(countOf(html, '<title>'), 1);
});

test('every paper, both ways round, gets a plan that fits its sheet and the index beside it or under it', () => {
  const project = school();
  for (const paper of PAPERS) {
    const at = paper.size + ' ' + paper.orientation;
    const box = printableBox(paperOf(project, { paper }));
    const { html } = sheet.render(project, null, { ...NOW, paper });
    assert.equal(countOf(html, '<section class="page">'), 3, at);
    assert.equal(countOf(html, 'lockdown--' + (paper.orientation === 'landscape' ? 'wide' : 'tall')), 3, at);
    assert.equal(countOf(html, 'data-orientation="' + paper.orientation + '"'), 1, at);
    for (const match of html.matchAll(/class="lockdown__picture" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/g)) {
      assert.ok(Number(match[1]) <= box.width + 0.01 && Number(match[2]) <= box.height + 0.01, at + ': the plan is larger than the sheet: ' + match[1] + ' by ' + match[2]);
      assert.ok(Number(match[1]) > 20, at + ': the plan is not tiny');
    }
    for (const block of ['rooms', 'exits', 'stairs']) assert.equal(countOf(html, 'data-block="' + block + '"'), 3, at + ' ' + block);
  }
});

test('the same project and options give the same document, with a default render and a pinned clock', () => {
  const a = sheet.render(school(), null, NOW).html;
  assert.equal(a, sheet.render(school(), null, NOW).html);
  assert.equal(a, sheet.render(school(), null, { ...NOW, by: 'floor', paper: undefined }).html);
  assert.ok(a.includes('<p class="doc-head__date">1 September 2026</p>'));
});

// the plan's box and the free room the layout promised it, in millimetres, for every sheet of a render
function boxes(html) {
  const found = [];
  for (const part of html.split('<div class="lockdown ').slice(1)) {
    const free = /--lockdown-free-w: ([\d.]+)mm; --lockdown-free-h: ([\d.]+)mm;/.exec(part);
    const picture = /class="lockdown__picture" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/.exec(part);
    found.push({ freeW: Number(free[1]), freeH: Number(free[2]), width: Number(picture[1]), height: Number(picture[2]), layout: /data-layout="(\w+)"/.exec(part)[1] });
  }
  return found;
}

const FILLED = [
  { size: 'letter', orientation: 'landscape' },
  { size: 'a4', orientation: 'portrait' },
  { size: 'a2', orientation: 'landscape' },
];

test('the plan is the largest that fits the room left: at least 85 % of the free width or the free height, whichever binds', () => {
  const project = school();
  for (const paper of FILLED) {
    const at = paper.size + ' ' + paper.orientation;
    const box = printableBox(paperOf(project, { paper }));
    for (const found of boxes(sheet.render(project, null, { ...NOW, paper }).html)) {
      const bound = Math.max(found.width / found.freeW, found.height / found.freeH);
      assert.ok(bound >= 0.85, at + ': the plan is ' + Math.round(bound * 100) + ' % of the room it was given');
      assert.ok(found.width <= found.freeW + 0.01 && found.height <= found.freeH + 0.01, at + ': inside its room');
      // the room itself is not made small to make the sum come out
      assert.ok(found.freeW >= box.width * 0.5 && found.freeH >= box.height * 0.3, at + ': the room left is a fair share of the sheet');
      // the sample's plans are three times as wide as high: across the width, whichever way the sheet lies
      assert.ok(found.width >= box.width * 0.85, at + ': the plan is ' + found.width + ' mm of ' + box.width);
    }
  }
});

test('a plan about as tall as it is wide goes beside the index on a landscape sheet and fills the height', () => {
  const rows = ['AAAA.BBBB', 'AAAA.BBBB', 'AAAA.BBBB', 'AAAA.BBBB', '#########', '.........', '.........', 'CCCC.DDDD', 'CCCC.DDDD', 'CCCC.DDDD', 'CCCC.DDDD'];
  const project = planProject([rows], { doors: { '1A': [[1, 3, 's']], '1B': [[6, 3, 's']], '1C': [[1, 7, 'n']], '1D': [[6, 7, 'n']] }, exits: [[1, 0, 5, 'West'], [1, 8, 5, 'East']] });
  const paper = { size: 'letter', orientation: 'landscape' };
  const box = printableBox(paperOf(project, { paper }));
  const [found] = boxes(sheet.render(project, null, { ...NOW, paper }).html);
  assert.equal(found.layout, 'beside');
  assert.ok(found.height >= 0.85 * found.freeH, 'the height binds: ' + found.height + ' of ' + found.freeH);
  assert.ok(found.height >= box.height * 0.6, 'and it is most of the sheet: ' + found.height + ' of ' + box.height);
  assert.ok(found.freeW + 6 < box.width, 'the index has a column');
  // the same building on an upright sheet goes over its index
  assert.equal(boxes(sheet.render(project, null, { ...NOW, paper: { size: 'letter', orientation: 'portrait' } }).html)[0].layout, 'under');
});

// a floor of rooms numbered and named every way the index has to sort
function mixed() {
  const rows = ['AB.CD.EF.GH', 'AB.CD.EF.GH', 'IJ.kk.ll.mm', 'IJ.kk.ll.mm'];
  const project = planProject([rows], { numbers: { '1A': '102', '1B': 'B12', '1C': 'Gym', '1D': '', '1E': '101', '1F': '9', '1G': 'Cafeteria', '1H': '', '1I': '20', '1J': '2nd office' } });
  const floor = project.building.floors[0];
  floor.spaces.find((space) => space.id === 'rplan1d000').label = 'Annex';
  floor.spaces.find((space) => space.id === 'oplan1k000').label = 'Boiler room';
  return project;
}

test('the index: rooms with a number in natural order, then rooms named in words, then other spaces by label', () => {
  const project = mixed();
  const { html } = sheet.render(project, null, NOW);
  const rooms = items(block(html, 'rooms')).map((line) => line.split(' · ')[0]);
  // every number with a digit in it, in natural order (2 before 9 before 20 before 101); then the words: Annex (a label, no number), Cafeteria, Gym
  assert.deepEqual(rooms.slice(0, 6), ['2nd office', '9', '20', '101', '102', 'B12']);
  assert.deepEqual(rooms.slice(6, 9), ['Annex', 'Cafeteria', 'Gym']);
  assert.equal(rooms[9], 'Boiler room', 'the other spaces by label come last');
  assert.ok(rooms.includes('Space l'), rooms.join(' / '));
  // a room with a label but no number is indexed by its label; only a room with neither is counted
  assert.ok(html.includes('1 room with no number is not listed.'), 'room H has neither');
  assert.equal(countOf(html, 'data-line="unnumbered"'), 1);
});

test('ten exits on one floor are all in the exit list, numbered 1 to 10', () => {
  const row = (letters) => letters.split('').flatMap((letter) => [letter, letter]).join('');
  const rooms = row('ABCDEFGHIJ');
  const doors = {};
  'ABCDEFGHIJ'.split('').forEach((letter, i) => { doors['1' + letter] = [[2 * i + 1, 1, 's']]; });
  const project = planProject([[rooms, rooms, '#'.repeat(20), '.'.repeat(20), '.'.repeat(20)]], { doors, exits: Array.from({ length: 10 }, (_, i) => [1, 2 * i, 2, 'Door ' + String.fromCharCode(65 + i)]) });
  const { html } = sheet.render(project, null, NOW);
  const lines = items(block(html, 'exits'));
  assert.equal(lines.length, 10, lines.join(' / '));
  assert.deepEqual(lines.map((line) => Number(line.split(' ')[0])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(lines.map((line) => line.split(' ').slice(1, 3).join(' ')), Array.from({ length: 10 }, (_, i) => 'Door ' + String.fromCharCode(65 + i)));
  const badges = Array.from(html.matchAll(/class="lockdown__badge"[^>]*>(\d+)</g)).map((match) => Number(match[1]));
  assert.deepEqual(badges, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(Array.from(html.matchAll(/class="plan__mark-number"[^>]*>(\d+)</g)).map((match) => match[1])).size, 10, 'the plan numbers them too');
});

test('an elevator names its floors once: "Floor 1, Floor 2 and Floor 3", never "Floors Floor 1"', () => {
  const project = withElevator();
  const [, f2, f3] = project.building.floors;
  const b = project.building.connections[1];
  b.kind = 'elevator';
  b.car = 'A';
  b.a = { floorId: f2.id, cell: 332 };
  b.b = { floorId: f3.id, cell: 332 };
  f3.lifts = [332];
  const { html } = sheet.render(project, null, { ...NOW, floorIds: [f2.id] });
  const lines = items(block(html, 'stairs'));
  assert.ok(lines.includes('Elevator A · Floor 1, Floor 2 and Floor 3 · staff only'), lines.join(' / '));
  assert.doesNotMatch(html, /Floors /);
});

test('the index text scales with the sheet like the footer, and a long list never takes type under 7 pt', () => {
  assert.match(PRINT_CSS, /\.lockdown__index \{[^}]*font-size: calc\(var\(--lockdown-fs, 8pt\) \* var\(--lockdown-scale, 1\)\);/);
  assert.match(PRINT_CSS, /\.lockdown__foot \{[^}]*font-size: calc\(8pt \* var\(--lockdown-scale, 1\)\);/);
  const project = school();
  const floor = project.building.floors[0];
  const { html } = sheet.render(project, null, { ...NOW, floorIds: [floor.id], paper: { size: 'a2', orientation: 'landscape' } });
  // the inline size no longer beats the rule
  assert.doesNotMatch(html, /class="lockdown__index"[^>]*style=/);
  assert.ok(Number(/--lockdown-scale: ([\d.]+);/.exec(html)[1]) > 1.8, 'A2 scales it');
  assert.equal(/--lockdown-fs: ([\d.]+)pt;/.exec(html)[1], '8');
  // a floor with a long index takes smaller type, and more of it fits by columns
  const long = (extra) => {
    const crowded = school();
    const f = crowded.building.floors[0];
    for (let i = 0; i < extra; i++) f.spaces.push({ ...f.spaces[f.spaces.length - 1], id: 'xlong' + i, label: 'Place ' + i });
    return sheet.render(crowded, null, { ...NOW, floorIds: [f.id] }).html;
  };
  const sizes = [0, 40, 80].map((extra) => Number(/--lockdown-fs: ([\d.]+)pt;/.exec(long(extra))[1]));
  assert.deepEqual(sizes, [8, 7.5, 7]);
  for (const size of sizes) assert.ok(size >= 7, size + ' pt');
});

test('every paper size, both ways round, keeps the plan inside the sheet and the index with it', () => {
  const project = school();
  for (const key of Object.keys(SHEETS)) {
    for (const orientation of ['portrait', 'landscape']) {
      const paper = { size: key, orientation };
      const at = key + ' ' + orientation;
      const box = printableBox(paperOf(project, { paper }));
      const { html } = sheet.render(project, null, { ...NOW, paper });
      assert.ok(html.includes('data-paper="' + key + '"') && html.includes('data-orientation="' + orientation + '"'), at);
      const found = boxes(html);
      assert.equal(found.length, 3, at);
      for (const one of found) {
        assert.ok(one.width <= box.width + 0.01 && one.height <= box.height + 0.01, at + ': inside the sheet');
        assert.ok(one.width > 20 && one.height > 8, at + ': not tiny');
        assert.ok(one.width >= 0.85 * box.width, at + ': a wide plan takes the width: ' + one.width + ' of ' + box.width);
        assert.ok(one.height + 23 < box.height, at + ': the header and the index have their room');
      }
      for (const name of ['rooms', 'exits', 'stairs']) assert.equal(countOf(html, 'data-block="' + name + '"'), 3, at + ' ' + name);
    }
  }
});

test('an Arabic name and a name with an override nobody closed are each in their own isolated span, in every list', () => {
  const ARABIC = 'باب الشمال';
  const OVERRIDE = '‮evil';
  const project = withElevator();
  const [f1, f2] = project.building.floors;
  f1.exits[0].doorName = ARABIC;
  f1.exits[1].doorName = OVERRIDE;
  f1.spaces[0].number = OVERRIDE;
  f1.spaces[1].number = ARABIC;
  project.building.connections[0].kind = 'stairs';
  delete project.building.connections[0].car;
  project.building.connections[0].label = ARABIC;
  project.building.connections[1].label = OVERRIDE;
  f1.name = ARABIC;
  f2.name = OVERRIDE;
  const { html } = sheet.render(project, null, NOW);
  for (const page of html.split('<section class="page">').slice(1)) {
    const rest = page.replace(/<span dir="auto">.*?<\/span>/g, '#').replace(/<header.*?<\/header>/s, '').replace(/<svg.*?<\/svg>/gs, '');
    assert.doesNotMatch(rest, /[؀-ۿ‪-‮⁦-⁩]/, 'a typed name outside its isolate');
  }
  for (const name of [ARABIC, OVERRIDE]) assert.ok(html.includes('<span dir="auto">' + name + '</span>'), name);
  assert.ok(html.includes('<span dir="auto">Stairs ' + ARABIC + ', ' + ARABIC + ' to ' + OVERRIDE + '</span>'), 'a stairs line is one isolated span');
});
