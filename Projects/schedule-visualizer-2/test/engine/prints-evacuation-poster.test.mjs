// The evacuation poster on paper (ui/prints/evacuation-poster.js; SV2-110; DESIGN 14.6 and
// 14.7 item 1), rendered in plain Node and read as a string.
//
//   node test/engine/prints-evacuation-poster.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sheet from '../../ui/prints/evacuation-poster.js';
import { OUTPUTS, outputFor } from '../../ui/prints/index.js';
import { frame, esc, paperOf, printableBox } from '../../ui/prints/document.js';
import { PRINT_EXIT_COLOURS } from '../../ui/prints/plan-svg.js';
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

function text(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// the words of one data-line paragraph of a page body, or null
function line(body, name) {
  const match = new RegExp('data-line="' + name + '">(.*?)</p>').exec(body);
  return match ? text(match[1]) : null;
}

function key(body) {
  return Array.from(body.matchAll(/poster__exit-text">(.*?)<\/span><\/li>/g)).map((match) => text(match[1]));
}

// every way drawn on a page: its colour and whether it is faint
function ways(body) {
  return Array.from(body.matchAll(/<path class="plan__way-line" stroke="(#[0-9a-f]{6})"( stroke-opacity="0.3")? d=/g)).map((match) => ({ colour: match[1], faint: match[2] !== undefined }));
}

test('the output is registered, landscape, and exports pages() and render = frame(pages)', () => {
  assert.equal(sheet.id, 'evacuation-poster');
  assert.equal(sheet.orientation, 'landscape');
  assert.equal(outputFor('evacuation-poster'), sheet);
  assert.equal(OUTPUTS.filter((output) => output.id === 'evacuation-poster').length, 1);
  const project = school();
  for (const options of [NOW, { ...NOW, by: 'corridor' }, { ...NOW, floorIds: ['fsample002'] }]) {
    const pages = sheet.pages(project, null, options);
    assert.deepEqual(sheet.render(project, null, options), frame(project, { output: 'evacuation-poster', what: 'Evacuation poster', pages, options }));
  }
  assert.deepEqual(sheet.pages(project, null, NOW).map((page) => page.what), ['Evacuation routes · Floor 1', 'Evacuation routes · Floor 2', 'Evacuation routes · Floor 3']);
  assert.equal(sheet.render(project, null, NOW).title, 'Evacuation poster · Marrowby Middle School (sample)');
});

test('a floor poster draws every room\'s way in its exit\'s colour, and the key says which exit is which', () => {
  const project = school();
  const [one] = sheet.pages(project, null, { ...NOW, floorIds: ['fsample001'] });
  const drawn = ways(one.body);
  assert.ok(drawn.length >= 5, 'a way for each of the five rooms');
  assert.deepEqual(Array.from(new Set(drawn.filter((way) => !way.faint).map((way) => way.colour))).sort(), [PRINT_EXIT_COLOURS[0], PRINT_EXIT_COLOURS[1]].sort());
  assert.deepEqual(key(one.body), [
    'Door A · Floor 1 · Assembly: Front lawn by the flagpole · 4 rooms on this floor',
    'Door B · Floor 1 · Assembly: East field by the backstop · 1 room on this floor',
  ]);
  // each exit's number is in a badge on the plan and in the key, never colour alone
  assert.ok(countOf(one.body, 'class="plan__badge-number"') >= 2);
  assert.ok(one.body.includes('class="poster__badge" style="background: ' + PRINT_EXIT_COLOURS[0]));
  assert.equal(line(one.body, 'find'), 'Find your room’s number on the plan and follow its colour to the exit.');
  assert.equal(line(one.body, 'stairs'), null, 'the ground floor takes no stairs');
  assert.equal(line(one.body, 'elevator'), null, 'no elevator, no elevator line');
  assert.equal(line(one.body, 'refuge'), null);
});

test('an upper floor says which stairs go to which exit; the part below is drawn faint', () => {
  const project = school();
  const [, two, three] = sheet.pages(project, null, NOW);
  assert.equal(line(two.body, 'stairs'), 'Rooms on this floor go down Stairs A to Door A (1).');
  assert.equal(line(three.body, 'stairs'), 'Rooms on this floor go down Stairs B to Door A (1).');
  assert.deepEqual(key(two.body), ['Door A · Floor 1 · Assembly: Front lawn by the flagpole · 5 rooms on this floor']);
  const mine = ways(two.body);
  assert.ok(mine.filter((way) => !way.faint).length >= 5, 'a way for each room');
  assert.ok(mine.filter((way) => !way.faint).every((way) => way.colour === PRINT_EXIT_COLOURS[0]), 'one exit, one colour');
  // Floor 3's rooms come down through Floor 2: that part is on Floor 2's plan, faint and in grey
  assert.ok(mine.some((way) => way.faint && !PRINT_EXIT_COLOURS.includes(way.colour)), 'the ways from above are faint grey');
});

test('with an elevator the building says never to use it, and a floor with an area of refuge says where to wait', () => {
  const project = withElevator();
  const [one, two] = sheet.pages(project, null, NOW);
  assert.equal(line(one.body, 'elevator'), 'Never use an elevator in an evacuation.');
  assert.ok(one.body.includes('poster__line poster__line--bold" data-line="elevator"'));
  assert.equal(line(one.body, 'refuge'), 'If you cannot use the stairs, wait at Area of refuge and tell a member of staff.');
  assert.equal(line(two.body, 'elevator'), 'Never use an elevator in an evacuation.');
  assert.equal(line(two.body, 'refuge'), null, 'Floor 2 has none');
  // stairs B joins Floors 2 and 3, and an area of refuge by one is said "by Stairs B"
  const beside = withElevator();
  beside.building.floors[0].refuges = [{ id: 'asample002', cell: 33 * 0 + 332 - 1, name: 'Safe spot' }];
  beside.building.connections[0].kind = 'stairs';
  delete beside.building.connections[0].car;
  const said = line(sheet.pages(beside, null, { ...NOW, floorIds: ['fsample001'] })[0].body, 'refuge');
  assert.equal(said, 'If you cannot use the stairs, wait at Safe spot by Stairs A and tell a member of staff.');
});

test('rooms with no way out are named on the poster they are missing from', () => {
  const project = withElevator();
  const [, two] = sheet.pages(project, null, NOW);
  assert.equal(line(two.body, 'no-route'), 'Room 201, Room 202, Room 203, Room 204, Library have no way out and are not on this poster.');
  assert.equal(line(two.body, 'no-way'), 'No room here has a way out to show.');
  assert.deepEqual(key(two.body), []);
});

test('a corridor poster: "You are here", the corridor in the accent band, its rooms\' ways in colour and the rest faint', () => {
  const project = school();
  const pages = sheet.pages(project, null, { ...NOW, by: 'corridor' });
  assert.deepEqual(pages.map((page) => page.what), [
    'Evacuation · Main Corridor, Floor 1',
    'Evacuation · Front Hall, Floor 1',
    'Evacuation · Upper Corridor, Floor 2',
    'Evacuation · Music Wing, Floor 3',
    'Evacuation · Top Corridor, Floor 3',
  ]);
  const upper = pages[2].body;
  assert.equal(countOf(upper, 'class="plan__marker"'), 1);
  assert.equal(countOf(upper, '>You are here<'), 1);
  assert.ok(upper.includes('class="plan__highlight"'), 'the corridor is highlighted');
  assert.equal(line(upper, 'corridor'), 'Rooms on Upper Corridor go out by Door A (1), 5 rooms.');
  assert.deepEqual(key(upper), ['Door A · Floor 1 · Assembly: Front lawn by the flagpole · 5 rooms on this corridor']);
  assert.equal(line(upper, 'stairs'), null);
  // Top Corridor on Floor 3: its two rooms in colour, Music Wing's room faint
  const top = pages[4].body;
  assert.equal(line(top, 'corridor'), 'Rooms on Top Corridor go out by Door A (1), 2 rooms.');
  const drawn = ways(top);
  assert.ok(drawn.some((way) => !way.faint) && drawn.some((way) => way.faint), 'some in colour, some faint');
  // two exits on one corridor: the sentence says each with its count, largest first
  assert.equal(line(pages[0].body, 'corridor'), 'Rooms on Main Corridor go out by Door A (1), 4 rooms, and Door B (2), 1 room.');
  assert.equal(key(pages[0].body).length, 2);
});

test('the "You are here" cell is the corridor\'s cell nearest its middle', () => {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']], { exits: [[1, 6, 2, 'Door']] });
  project.building.floors[0].corridors = [{ id: 'kplan', name: 'Hall', cells: [14, 15, 16, 17, 18, 19, 20] }];
  const page = sheet.pages(project, null, { ...NOW, by: 'corridor' })[0];
  assert.equal(countOf(page.body, 'class="plan__marker"'), 1);
  // seven cells wide: the marker is on the fourth (x = 3)
  const cx = Number(/class="plan__marker" cx="([\d.]+)"/.exec(page.body)[1]);
  const px = 3.5 * 20 - 0;
  assert.ok(Math.abs(cx - px) < 25, 'the marker is in the middle of the corridor: ' + cx);
});

test('an unnamed corridor is not offered; with none named the one sheet says to name them', () => {
  const project = school();
  project.building.floors[0].corridors[1].name = '';
  const pages = sheet.pages(project, null, { ...NOW, by: 'corridor' });
  assert.equal(pages.length, 4);
  assert.ok(!pages.some((page) => page.what.includes('Front Hall')));
  assert.equal(sheet.pages(project, null, { ...NOW, by: 'corridor', corridorIds: ['ksample002'] }).length, 1, 'asked for the unnamed one: the sheet that says to name');
  for (const floor of project.building.floors) for (const corridor of floor.corridors) corridor.name = '  ';
  const none = sheet.pages(project, null, { ...NOW, by: 'corridor' });
  assert.equal(none.length, 1);
  assert.equal(line(none[0].body, 'no-corridor'), 'No corridor has a name yet. Name corridors in Building to make a poster for each.');
});

test('corridorIds picks the corridors and floorIds the floors', () => {
  const project = school();
  assert.deepEqual(sheet.pages(project, null, { ...NOW, by: 'corridor', corridorIds: ['ksample005', 'ksample001'] }).map((page) => page.what), ['Evacuation · Main Corridor, Floor 1', 'Evacuation · Top Corridor, Floor 3']);
  assert.deepEqual(sheet.pages(project, null, { ...NOW, floorIds: ['fsample003'] }).map((page) => page.what), ['Evacuation routes · Floor 3']);
  assert.equal(sheet.pages(project, null, { ...NOW, floorIds: ['nope'] }).length, 3);
});

test('an unnamed exit is called by its floor, a building with no exit says so, a floor with no rooms and one with nothing drawn print', () => {
  const project = school();
  project.building.floors[0].exits[1].doorName = '';
  project.building.floors[0].exits[1].assembly = '';
  const [one] = sheet.pages(project, null, NOW);
  assert.deepEqual(key(one.body), [
    'Door A · Floor 1 · Assembly: Front lawn by the flagpole · 4 rooms on this floor',
    'The exit on Floor 1 · Floor 1 · Assembly point not set · 1 room on this floor',
  ]);

  const none = school();
  for (const floor of none.building.floors) floor.exits = [];
  const [first] = sheet.pages(none, null, NOW);
  assert.equal(line(first.body, 'no-exit'), 'This building has no exit yet. Add one in Building.');
  assert.ok(line(first.body, 'no-route').startsWith('Room 101'));

  const odd = planProject([['.....', '#####', '.....'], ['.....']], { exits: [[1, 0, 1, 'Only Door']] });
  const pages = sheet.pages(odd, null, NOW);
  assert.equal(line(pages[0].body, 'no-way'), 'There are no rooms on Floor 1.');
  assert.ok(pages[1].body.includes('Nothing is drawn on Floor 2 yet.'));
  assert.equal(sheet.render(odd, null, NOW).html.split('<section class="page">').length - 1, 2);
});

test('hostile names are text: a door, an assembly point, a corridor, a floor, a room and stairs', () => {
  const project = school();
  const mean = ['<script>alert(1)</script>', '"><img src=x onerror=alert(2)>', "O'Neil & <b>Sons</b>", '</title><svg onload=alert(3)>', '<!-- -->&amp;'];
  const [f1, f2] = project.building.floors;
  project.settings.schoolName = mean[0];
  f1.name = mean[1];
  f1.exits[0].doorName = mean[2];
  f1.exits[0].assembly = mean[3];
  f1.spaces[0].number = mean[4];
  f1.corridors[0].name = mean[0] + ' hall';
  f2.corridors[0].name = mean[3] + ' up';
  project.building.connections[0].label = mean[1] + ' stairs';
  for (const by of ['floor', 'corridor']) {
    const { html } = sheet.render(project, null, { ...NOW, by });
    for (const raw of mean) {
      assert.equal(countOf(html, raw), 0, by + ': ' + raw + ' is in the markup as typed');
      assert.ok(html.includes(esc(raw)), by + ': ' + raw + ' is there, escaped');
    }
    assert.equal(countOf(html, '<script'), 0);
    assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, by + ': an event handler attribute');
    assert.equal(countOf(html, '<style'), 1);
    assert.equal(countOf(html, '<title>'), 1);
  }
});

test('every paper, both ways round, gets a plan that fits its sheet; a larger sheet scales its words', () => {
  const project = school();
  for (const by of ['floor', 'corridor']) {
    for (const paper of PAPERS) {
      const at = by + ' ' + paper.size + ' ' + paper.orientation;
      const box = printableBox(paperOf(project, { paper }));
      const { html } = sheet.render(project, null, { ...NOW, paper, by });
      assert.equal(countOf(html, 'poster--' + (paper.orientation === 'landscape' ? 'wide' : 'tall')), by === 'floor' ? 3 : 5, at);
      for (const match of html.matchAll(/class="poster__picture" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/g)) {
        assert.ok(Number(match[1]) <= box.width + 0.01 && Number(match[2]) <= box.height + 0.01, at + ': the plan is larger than the sheet');
        assert.ok(Number(match[1]) > 20, at + ': not tiny');
      }
    }
  }
  const scales = (paper) => Array.from(sheet.render(project, null, { ...NOW, paper }).html.matchAll(/--poster-scale: ([\d.]+);/g)).map((match) => Number(match[1]));
  assert.deepEqual(scales({ size: 'letter', orientation: 'landscape' }), [1, 1, 1]);
  assert.ok(scales({ size: 'a2', orientation: 'landscape' })[0] > 1.8, 'the text grows with the sheet');
});

test('the routes are the evacuation search\'s, and the poster prints the building as it is: same document twice, no clock', () => {
  const a = sheet.render(school(), null, NOW).html;
  assert.equal(a, sheet.render(school(), null, NOW).html);
  assert.equal(a, sheet.render(school(), null, { ...NOW, by: 'floor' }).html);
  assert.ok(a.includes('<p class="doc-head__date">1 September 2026</p>'));
  assert.ok(!sheet.render(school(), null, {}).html.includes('doc-head__date'));
});
