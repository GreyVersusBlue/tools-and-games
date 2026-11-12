// The evacuation poster on paper (ui/prints/evacuation-poster.js; SV2-110; DESIGN 14.6 and
// 14.7 item 1), rendered in plain Node and read as a string.
//
//   node test/engine/prints-evacuation-poster.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as sheet from '../../ui/prints/evacuation-poster.js';
import { OUTPUTS, outputFor } from '../../ui/prints/index.js';
import { frame, esc, paperOf, printableBox, PAPERS as SHEETS } from '../../ui/prints/document.js';
import { PRINT_EXIT_COLOURS } from '../../ui/prints/plan-svg.js';
import { school, PINNED } from './helpers.mjs';
import { withElevator } from '../fixtures/step-free.mjs';
import { planProject } from '../fixtures/buildings/plans.mjs';

const NOW = { now: PINNED };
const PRINT_CSS = readFileSync(new URL('../../ui/print.css', import.meta.url), 'utf8');
const ARABIC = 'باب الشمال';
const FSI = '\u2068';
const PDI = '\u2069';
const OVERRIDE = '\u202Eevil door';   // a right-to-left override that is never closed
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
  return value.replace(/[\u2068\u2069]/g, '').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
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
  // the stairs are named as stairsName names them, with their floors
  assert.equal(said, 'If you cannot use the stairs, wait at Safe spot by Stairs A, Floor 1 to Floor 2 and tell a member of staff.');
  // two stairs within two cells: the nearer wins, and on a tie the lower label, then the lower id
  const pair = withElevator();
  const base = { ...pair.building.connections[0], kind: 'stairs' };
  delete base.car;
  const here = base.a.floorId === 'fsample001' ? 'a' : 'b';
  pair.building.floors[0].refuges = [{ id: 'asample002', cell: base[here].cell, name: 'Safe spot' }];
  const mover = (label, id, by) => ({ ...base, id, label, [here]: { ...base[here], cell: base[here].cell + by } });
  const far = mover('0', 'cfar', 2);
  const nearB = mover('B', 'cnearb', 0);
  const nearA = mover('A', 'cneara', 0);
  const pick = () => line(sheet.pages(pair, null, { ...NOW, floorIds: ['fsample001'] })[0].body, 'refuge');
  pair.building.connections = [far, nearB];
  assert.match(pick(), /by Stairs B, Floor 1 to Floor 2 and/, 'the nearer one, though its label sorts later');
  pair.building.connections = [far, nearB, nearA];
  const tied = pick();
  assert.match(tied, /by Stairs A, Floor 1 to Floor 2 and/, 'on a tie the lower label');
  pair.building.connections = [nearA, nearB, far];
  assert.equal(pick(), tied, 'the order of the connections does not matter');
});

test('rooms with no way out are named on the poster they are missing from', () => {
  const project = withElevator();
  const [, two] = sheet.pages(project, null, NOW);
  assert.equal(line(two.body, 'no-route'), 'Room 201, Room 202, Room 203, Room 204, Library have no way out and are not on this poster.');
  // every room here has none: the list of them is the whole message
  assert.equal(line(two.body, 'no-way'), null);
  assert.equal(countOf(two.body, 'No room here has a way out to show.'), 0);
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
  // ids that match no named corridor ask for every named one, as floorsFor does for floors
  const some = (ids) => sheet.pages(project, null, { ...NOW, by: 'corridor', corridorIds: ids }).map((page) => page.what);
  const every = some(undefined);
  assert.equal(every.length, 4);
  assert.deepEqual(some(['ksample002']), every, 'asked for the unnamed one only: every named corridor');
  assert.deepEqual(some(['nope']), every);
  assert.deepEqual(some([]), every);
  assert.deepEqual(some(['ksample002', 'ksample005']), ['Evacuation · Top Corridor, Floor 3'], 'a mix: the named one asked for');
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

// the plan's box and the free room the layout promised it, in millimetres, for every sheet of a render
function boxes(html) {
  const found = [];
  for (const part of html.split('<div class="poster ').slice(1)) {
    const free = /--poster-free-w: ([\d.]+)mm; --poster-free-h: ([\d.]+)mm;/.exec(part);
    const picture = /class="poster__picture" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/.exec(part);
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
  for (const by of ['floor', 'corridor']) {
    for (const paper of FILLED) {
      const at = by + ' ' + paper.size + ' ' + paper.orientation;
      const box = printableBox(paperOf(project, { paper }));
      for (const found of boxes(sheet.render(project, null, { ...NOW, paper, by }).html)) {
        const bound = Math.max(found.width / found.freeW, found.height / found.freeH);
        assert.ok(bound >= 0.85, at + ': the plan is ' + Math.round(bound * 100) + ' % of the room it was given');
        assert.ok(found.width <= found.freeW + 0.01 && found.height <= found.freeH + 0.01, at + ': inside its room');
        // the room itself is not made small to make the sum come out: a very wide plan takes the sheet's width
        assert.ok(found.freeW >= box.width * 0.5 && found.freeH >= box.height * 0.3, at + ': the room left is a fair share of the sheet');
        // the sample's plans are three times as wide as high: across the width, whichever way the sheet lies
        assert.ok(found.width >= box.width * 0.85, at + ': the plan is ' + found.width + ' mm of ' + box.width);
      }
    }
  }
});

test('a plan about as tall as it is wide goes beside its text on a landscape sheet and fills the height', () => {
  const rows = ['AAAA.BBBB', 'AAAA.BBBB', 'AAAA.BBBB', 'AAAA.BBBB', '#########', '.........', '.........', 'CCCC.DDDD', 'CCCC.DDDD', 'CCCC.DDDD', 'CCCC.DDDD'];
  const project = planProject([rows], { doors: { '1A': [[1, 3, 's']], '1B': [[6, 3, 's']], '1C': [[1, 7, 'n']], '1D': [[6, 7, 'n']] }, exits: [[1, 0, 5, 'West'], [1, 8, 5, 'East']] });
  const paper = { size: 'letter', orientation: 'landscape' };
  const box = printableBox(paperOf(project, { paper }));
  const [found] = boxes(sheet.render(project, null, { ...NOW, paper }).html);
  assert.equal(found.layout, 'beside');
  assert.ok(found.height >= 0.85 * found.freeH, 'the height binds: ' + found.height + ' of ' + found.freeH);
  assert.ok(found.height >= box.height * 0.6, 'and it is most of the sheet: ' + found.height + ' of ' + box.height);
  assert.ok(found.freeW + 6 < box.width, 'the text has a column');
});

test('the sheet\'s headline is 28 pt and grows with the sheet like the poster\'s text, never under its Letter size', () => {
  assert.match(PRINT_CSS, /\.print-doc\[data-output="evacuation-poster"\] \.doc-head__what \{\s*font-size: calc\(28pt \* var\(--poster-head-scale, 1\)\);/);
  for (const [key, paper] of Object.entries(SHEETS)) {
    const rule = new RegExp('\\.print-doc\\[data-output="evacuation-poster"\\]\\[data-paper="' + key + '"\\] \\{ --poster-head-scale: ([\\d.]+); \\}').exec(PRINT_CSS);
    assert.ok(rule, key + ' has a headline scale');
    // the same scale the poster's text takes: --poster-scale on the sheet, from the short side
    const portrait = { size: key, orientation: 'portrait' };
    const want = Number(/--poster-scale: ([\d.]+);/.exec(sheet.render(school(), null, { ...NOW, paper: portrait }).html)[1]);
    assert.ok(Math.abs(Number(rule[1]) - want) < 0.01, key + ': headline ' + rule[1] + ', text ' + want);
    assert.ok(Number(rule[1]) >= 1, key + ' is never under Letter');
  }
  assert.ok(Number(/data-paper="a2"\] \{ --poster-head-scale: ([\d.]+)/.exec(PRINT_CSS)[1]) > 2, 'A2 sets it over twice Letter');
});

// a plain-text line of one sentence's markup, with every isolated name taken out: what is left is the words round the names
function words(body, name) {
  const match = new RegExp('data-line="' + name + '">(.*?)</p>').exec(body);
  assert.ok(match, name + ' is on the page');
  return match[1].replace(/\u2068.*?\u2069/g, '#').replace(/<span dir="auto">.*?<\/span>/g, '#');
}

test('a typed name inside a sentence is isolated: an Arabic name and an override nobody closed leave the words and "(1)" where they are', () => {
  const project = withElevator();
  const [f1, f2] = project.building.floors;
  f1.exits[0].doorName = ARABIC;
  f1.exits[1].doorName = OVERRIDE;
  f1.refuges = [{ id: 'asample002', cell: 331, name: OVERRIDE }];
  project.building.connections[0].kind = 'stairs';
  delete project.building.connections[0].car;
  project.building.connections[0].label = ARABIC;
  f1.corridors[0].name = OVERRIDE + ' hall';
  f2.refuges = [{ id: 'asample003', cell: 331, name: ARABIC }];
  for (const by of ['floor', 'corridor']) {
    const pages = sheet.pages(project, null, { ...NOW, by });
    for (const page of pages) {
      for (const name of ['stairs', 'refuge', 'corridor']) {
        const match = new RegExp('data-line="' + name + '">(.*?)</p>').exec(page.body);
        if (!match) continue;
        const rest = words(page.body, name);
        assert.doesNotMatch(rest, /[؀-ۿ‪-‮⁦-⁩]/, by + ' ' + name + ': a typed name outside its isolate: ' + rest);
      }
    }
  }
  const [one, two] = sheet.pages(project, null, NOW);
  assert.ok(words(one.body, 'refuge').startsWith('If you cannot use the stairs, wait at # by # and tell a member of staff.'), words(one.body, 'refuge'));
  assert.equal(words(two.body, 'stairs'), 'Rooms on this floor go down # to # (1).');
  assert.ok(one.body.includes('by ' + FSI + 'Stairs ' + ARABIC + ', Floor 1 to Floor 2' + PDI + ' and'), 'the stairs name is whole inside its isolate');
  assert.ok(two.body.includes('to ' + FSI + ARABIC + PDI + ' (1).'), 'the "(1)" is outside the isolate: ' + words(two.body, 'stairs'));
  assert.ok(one.body.includes(FSI + OVERRIDE + PDI), 'the override is inside an isolate that closes');
  const upper = sheet.pages(project, null, { ...NOW, by: 'corridor' }).find((page) => page.what.includes('Floor 1'));
  assert.equal(words(upper.body, 'corridor'), 'Rooms on # go out by # (1), 4 rooms, and # (2), 1 room.');
  assert.ok(upper.body.includes(FSI + OVERRIDE + PDI + ' (2), 1 room'));
});

// ten exits along one corridor, a room beside each
function tenExits() {
  const row = (letters) => letters.split('').flatMap((letter) => [letter, letter]).join('');
  const rooms = row('ABCDEFGHIJ');
  const doors = {};
  'ABCDEFGHIJ'.split('').forEach((letter, i) => { doors['1' + letter] = [[2 * i + 1, 1, 's']]; });
  const dots = '.'.repeat(20);
  // each room's door is a gap in the wall row, and each exit another gap in it, beside its room's door (a tie goes to the lower exit, which is its own)
  return planProject([[rooms, rooms, '#'.repeat(20), dots, dots]], { doors, exits: Array.from({ length: 10 }, (_, i) => [1, 2 * i, 2, 'Door ' + String.fromCharCode(65 + i)]) });
}

test('ten exits on one floor: the key lists every exit its rooms use, with ten different badge numbers', () => {
  const project = tenExits();
  const [page] = sheet.pages(project, null, NOW);
  const rows = key(page.body);
  assert.equal(rows.length, 10, rows.join(' / '));
  const numbers = Array.from(page.body.matchAll(/class="poster__badge" style="[^"]*">(\d+)<\/span>/g)).map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(rows.map((row) => row.split(' · ')[0]), Array.from({ length: 10 }, (_, i) => 'Door ' + String.fromCharCode(65 + i)));
  // the plan carries every number too, so no exit is told by colour alone
  const onPlan = new Set(Array.from(page.body.matchAll(/class="plan__badge-number"[^>]*>(\d+)</g)).map((match) => Number(match[1])));
  for (let n = 1; n <= 10; n++) assert.ok(onPlan.has(n), 'badge ' + n + ' is drawn on the plan');
});

test('every paper size, both ways round, renders and keeps the plan inside the sheet', () => {
  const project = school();
  for (const key of Object.keys(SHEETS)) {
    for (const orientation of ['portrait', 'landscape']) {
      const paper = { size: key, orientation };
      const at = key + ' ' + orientation;
      const box = printableBox(paperOf(project, { paper }));
      for (const by of ['floor', 'corridor']) {
        const { html } = sheet.render(project, null, { ...NOW, paper, by });
        assert.ok(html.includes('data-paper="' + key + '"') && html.includes('data-orientation="' + orientation + '"'), at);
        const found = boxes(html);
        assert.equal(found.length, by === 'floor' ? 3 : 5, at);
        for (const one of found) {
          assert.ok(one.width <= box.width + 0.01 && one.height <= box.height + 0.01, at + ': inside the sheet');
          assert.ok(one.width > 20 && one.height > 8, at + ': not tiny');
          assert.ok(one.width >= 0.85 * box.width, at + ': a wide plan takes the width: ' + one.width + ' of ' + box.width);
          assert.ok(one.height + 12 < box.height, at + ': the header and the text have their room');
        }
      }
    }
  }
});
