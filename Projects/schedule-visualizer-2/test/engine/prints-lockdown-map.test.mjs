// The lockdown map on paper (ui/prints/lockdown-map.js; SV2-110; DESIGN 14.6 and 14.7 item 6),
// rendered in plain Node and read as a string.
//
//   node test/engine/prints-lockdown-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sheet from '../../ui/prints/lockdown-map.js';
import { OUTPUTS, outputFor } from '../../ui/prints/index.js';
import { frame, esc, paperOf, printableBox } from '../../ui/prints/document.js';
import { planSvg, gridSquare } from '../../ui/prints/plan-svg.js';
import { school, PINNED } from './helpers.mjs';
import { withElevator } from '../fixtures/step-free.mjs';
import { planProject } from '../fixtures/buildings/plans.mjs';

const NOW = { now: PINNED };
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
  assert.deepEqual(rooms.slice(0, named).map((line) => line.split(' · ')[0]), ['Cafeteria', 'Gym', '101', '102', '103']);
  assert.deepEqual(rooms.slice(named).map((line) => line.split(' · ')[0]), ['Bathrooms', 'Courtyard', 'Kitchen', 'Office']);
  assert.match(rooms[2], /^101 · [A-L]([1-9]|1[0-2])$/);
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
  assert.ok(lines.includes('Elevator A · Floors Floor 1 and Floor 2 · staff only'), lines.join(' / '));
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
