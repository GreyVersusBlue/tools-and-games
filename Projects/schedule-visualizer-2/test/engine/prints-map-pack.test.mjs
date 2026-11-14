// The map pack on paper (ui/prints/map-pack.js; SV2-111; spec 10.3, 17; DESIGN 14.6;
// ARCHITECTURE 20.5, 20.9 item 4), rendered in plain Node and read as a string:
//
//   node test/engine/prints-map-pack.test.mjs
//
// The cover and its counts, the sections and their order, one orientation for the whole
// document, the running heads, the exits table and the rooms with no way out, the door cards'
// foot on the pack's last sheet alone, floorIds, names as typed, and that the pack composes the
// other modules' pages and never draws them again.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as pack from '../../ui/prints/map-pack.js';
import * as floorPlan from '../../ui/prints/floor-plan.js';
import * as lockdownMap from '../../ui/prints/lockdown-map.js';
import * as poster from '../../ui/prints/evacuation-poster.js';
import * as doorCards from '../../ui/prints/door-cards.js';
import * as stepFree from '../../ui/prints/step-free.js';
import { OUTPUTS, outputFor, renderOutput } from '../../ui/prints/index.js';
import { esc } from '../../ui/prints/document.js';
import { HEAVY_WORDS } from '../../ui/safety/exits.js';
import { sampleSchool } from '../../data/sample-school.js';
import { exitNumbers } from '../../engine/exit-load.js';
import { planProject, disconnectedWing, twoRooms } from '../fixtures/buildings/plans.mjs';
import { PINNED } from './helpers.mjs';

const NOW = { now: PINNED };
const ALL = ['plans', 'lockdown', 'posters', 'exits', 'cards', 'step-free'];
const PAPERS = [
  { size: 'letter', orientation: 'portrait' },
  { size: 'letter', orientation: 'landscape' },
  { size: 'a4', orientation: 'portrait' },
  { size: 'a4', orientation: 'landscape' },
  { size: 'a2', orientation: 'landscape' },
];

const FSI = '\u2068';
const PDI = '\u2069';
const withoutMarks = (text) => text.replace(/[\u2068\u2069]/g, '');
// the text of a sheet's markup
const textOf = (html) => withoutMarks(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// the heading of every sheet, as written in the document
function headsOf(html) {
  return Array.from(html.matchAll(/<h1 class="doc-head__what">([^<]*)<\/h1>/g)).map((match) => match[1]);
}

// the contents list of the cover: [{ id, sheets }]
function contentsOf(html) {
  return Array.from(html.matchAll(/<li data-section="([^"]+)" data-sheets="(\d+)">/g)).map((match) => ({ id: match[1], sheets: Number(match[2]) }));
}

// a corridor that winds back and forth, so that a door card's steps run on to a second sheet
function winding(turns) {
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

// ---------------------------------------------------------------- the output

test('the map pack is an output: map-pack, named Map pack, across the sheet', () => {
  assert.equal(pack.id, 'map-pack');
  assert.equal(pack.name, 'Map pack');
  assert.equal(pack.orientation, 'landscape');
  assert.equal(outputFor('map-pack'), pack);
  assert.equal(OUTPUTS.filter((output) => output.id === 'map-pack').length, 1);
  assert.equal(renderOutput('map-pack', sampleSchool(), null, NOW).title, 'Map pack · Marrowby Middle School (sample)');
  assert.deepEqual(pack.SECTIONS.map((section) => section.id), ALL);
  assert.deepEqual(pack.SECTIONS.map((section) => section.label), ['Floor plans', 'Lockdown maps', 'Evacuation posters', 'Exits and assembly points', 'Door cards', 'Step-free ways out']);
  assert.deepEqual(pack.DEFAULT_SECTIONS, ['plans', 'lockdown', 'posters', 'exits']);
});

test('sectionsFor: the ones asked for in the pack\'s order, unknown ids ignored, none asked for the default', () => {
  assert.deepEqual(pack.sectionsFor({ sections: ['exits', 'plans'] }), ['plans', 'exits']);
  assert.deepEqual(pack.sectionsFor({ sections: ['cards', 'nope', 'step-free'] }), ['cards', 'step-free']);
  for (const options of [undefined, null, {}, { sections: [] }, { sections: ['nope'] }, { sections: 'plans' }]) {
    assert.deepEqual(pack.sectionsFor(options), pack.DEFAULT_SECTIONS, JSON.stringify(options));
  }
});

// ---------------------------------------------------------------- the cover and the sections

test('by default: a cover, a sheet a floor of the plans, the maps and the posters, then the exits', () => {
  const project = sampleSchool();
  const made = pack.pages(project, null, NOW);
  const floors = project.building.floors.map((floor) => floor.name);
  assert.deepEqual(made.map((page) => page.what), [
    'Map pack',
    ...floors.map((name) => 'Map pack · Floor plan: ' + name),
    ...floors.map((name) => 'Map pack · Lockdown map · ' + name),
    ...floors.map((name) => 'Map pack · Evacuation routes · ' + name),
    'Map pack · Exits and assembly points',
  ]);
  const { html } = pack.render(project, null, NOW);
  assert.equal(countOf(html, '<section class="page">'), 11);
  assert.deepEqual(headsOf(html), made.map((page) => esc(page.what)));
});

test('the cover names the school, "Building map pack" and the date, and counts the sheets of each section', () => {
  const project = sampleSchool();
  const cover = pack.pages(project, null, NOW)[0].body;
  assert.ok(cover.includes('>' + esc(project.settings.schoolName) + '</span>'), 'the school');
  assert.ok(cover.includes('>Building map pack</h2>'), 'what it is');
  assert.ok(cover.includes('1 September 2026'), 'the date');
  assert.deepEqual(contentsOf(cover), [{ id: 'plans', sheets: 3 }, { id: 'lockdown', sheets: 3 }, { id: 'posters', sheets: 3 }, { id: 'exits', sheets: 1 }]);
  assert.ok(cover.includes('11 sheets in all, with this cover.'));
  assert.ok(cover.includes('Floor plans</span> <span class="card-cover__to">3 sheets, one a floor'));
});

test('the cover\'s counts are the sheets of the document: every section, on every paper', () => {
  const project = sampleSchool();
  for (const paper of PAPERS) {
    const options = { ...NOW, paper, sections: ALL };
    const made = pack.pages(project, null, options);
    const counts = contentsOf(made[0].body);
    assert.deepEqual(counts.map((entry) => entry.id), ALL);
    const sheets = made.slice(1).reduce((sum, page) => sum + 1 + countOf(page.body, 'class="card__more new-sheet"'), 0);
    assert.equal(counts.reduce((sum, entry) => sum + entry.sheets, 0), sheets, paper.size + ' ' + paper.orientation);
    assert.ok(made[0].body.includes((sheets + 1) + ' sheets in all'), paper.size);
  }
});

test('door cards say how many sheets they take, a long card\'s second sheets counted', () => {
  const project = winding(7);
  const paper = { size: 'letter', orientation: 'portrait' };
  const options = { ...NOW, paper, sections: ['cards'] };
  const cards = doorCards.pages(project, null, { ...NOW, paper });
  const more = cards.reduce((sum, page) => sum + countOf(page.body, 'class="card__more new-sheet"'), 0);
  assert.ok(more >= 1, 'the fixture\'s card runs on to a second sheet');
  const counted = contentsOf(pack.pages(project, null, options)[0].body);
  assert.deepEqual(counted, [{ id: 'cards', sheets: cards.length + more }]);
});

test('a section with nothing to print says so on the cover, and the pack still renders', () => {
  const project = sampleSchool();
  project.building.floors = [];
  project.building.connections = [];
  const made = pack.pages(project, null, { ...NOW, sections: ['plans', 'lockdown', 'posters'] });
  assert.equal(made.length, 1);
  assert.deepEqual(contentsOf(made[0].body), [{ id: 'plans', sheets: 0 }, { id: 'lockdown', sheets: 0 }, { id: 'posters', sheets: 0 }]);
  assert.ok(made[0].body.includes('nothing to print yet'));
  assert.ok(pack.render(project, null, NOW).html.includes('Building map pack'));
});

test('the sections asked for are the sections printed, in the pack\'s order, each starting on a new sheet', () => {
  const project = sampleSchool();
  const only = pack.pages(project, null, { ...NOW, sections: ['exits', 'lockdown'] });
  assert.deepEqual(only.map((page) => page.what).filter((what, i) => i > 0 && !/Lockdown/.test(what)), ['Map pack · Exits and assembly points']);
  assert.equal(only.length, 1 + 3 + 1);
  assert.deepEqual(contentsOf(only[0].body).map((entry) => entry.id), ['lockdown', 'exits']);
  assert.ok(!pack.render(project, null, { ...NOW, sections: ['exits'] }).html.includes('class="plan"'), 'no plan in a pack of the exits alone');
});

// ---------------------------------------------------------------- composing

test('the pack\'s sheets are the modules\' own, byte for byte: nothing is drawn twice or differently', () => {
  const project = sampleSchool();
  const options = { ...NOW, sections: ALL, stepFree: true };
  const made = pack.pages(project, null, options);
  const own = [
    ...floorPlan.pages(project, null, options),
    ...lockdownMap.pages(project, null, options),
    ...poster.pages(project, null, options),
  ];
  assert.deepEqual(made.slice(1, 1 + own.length).map((page) => page.body), own.map((page) => page.body));
  const cards = doorCards.pages(project, null, { ...options, last: false });
  const at = made.findIndex((page) => page.what === 'Map pack · Door cards');
  assert.deepEqual(made.slice(at, at + cards.length).map((page) => page.body), cards.map((page) => page.body));
  assert.deepEqual(made[made.length - 1].body, stepFree.pages(project, null, options)[0].body);
  assert.equal(made[made.length - 1].what, 'Map pack · Step-free ways out');
});

test('floorIds picks the floors of the plans, the maps and the posters; floorId, which the preview sheet forces, is not read', () => {
  const project = sampleSchool();
  const [one, two] = project.building.floors;
  const made = pack.pages(project, null, { ...NOW, floorIds: [two.id] });
  assert.deepEqual(made.map((page) => page.what), ['Map pack', 'Map pack · Floor plan: ' + two.name, 'Map pack · Lockdown map · ' + two.name, 'Map pack · Evacuation routes · ' + two.name, 'Map pack · Exits and assembly points']);
  assert.deepEqual(contentsOf(made[0].body).map((entry) => entry.sheets), [1, 1, 1, 1]);
  const forced = pack.pages(project, null, { ...NOW, floorId: one.id });
  assert.equal(forced.length, 11, 'floorId changes nothing');
  assert.deepEqual(pack.pages(project, null, { ...NOW, floorId: 'all', floorIds: [one.id] }).map((page) => page.what).slice(1, 2), ['Map pack · Floor plan: ' + one.name]);
});

test('the pack prints the building as built: a trial in the options, the posters\' choices and a traced image change nothing', () => {
  const project = sampleSchool();
  const plain = pack.render(project, null, NOW).html;
  const blocked = { exits: [project.building.floors[0].exits[0].id], connections: [], cells: [] };
  assert.equal(pack.render(project, null, { ...NOW, blocked, by: 'corridor', corridorIds: ['nope'], roomIds: ['x'], traceImage: true }).html, plain);
});

// ---------------------------------------------------------------- one orientation, the heads

test('one paper and one orientation for the whole pack: one page rule, every sheet\'s head, on every paper', () => {
  const project = sampleSchool();
  for (const paper of PAPERS) {
    const { html } = pack.render(project, null, { ...NOW, paper, sections: ALL });
    const at = paper.size + ' ' + paper.orientation;
    assert.equal(countOf(html, '@page'), 1, at);
    assert.equal(countOf(html, '<style id="page-size">'), 1, at);
    assert.ok(html.includes('data-output="map-pack" data-paper="' + paper.size + '" data-orientation="' + paper.orientation + '"'), at);
    assert.equal(countOf(html, '<header class="doc-head">'), countOf(html, '<section class="page">'), at);
    for (const head of headsOf(html)) assert.ok(head === 'Map pack' || head.startsWith('Map pack · '), at + ': ' + head);
  }
});

test('the running head of a sheet is its page\'s `what` under "Map pack · "; door cards and the step-free report have one too', () => {
  const project = sampleSchool();
  const heads = headsOf(pack.render(project, null, { ...NOW, sections: ['cards', 'step-free'] }).html);
  assert.equal(heads[0], 'Map pack');
  assert.equal(heads[1], 'Map pack · Door cards');
  assert.ok(heads.slice(2, -1).every((head) => head === 'Map pack · Evacuation route'));
  assert.equal(heads[heads.length - 1], 'Map pack · Step-free ways out');
});

// ---------------------------------------------------------------- the exits table

test('the exits table: every exit by its number, door, floor, assembly point, rooms and people; heavy in words', () => {
  const project = sampleSchool();
  const page = pack.pages(project, null, { ...NOW, sections: ['exits'] })[1].body;
  const numbers = exitNumbers(project);
  const exits = project.building.floors.flatMap((floor) => floor.exits.map((exit) => ({ exit, floor })));
  assert.equal(countOf(page, '<tr data-exit="'), exits.length);
  for (const { exit, floor } of exits) {
    const row = page.slice(page.indexOf('<tr data-exit="' + exit.id + '"'));
    const text = row.slice(0, row.indexOf('</tr>'));
    assert.ok(text.includes('>' + numbers.get(exit.id) + '</span>'), 'its number');
    assert.ok(text.includes(esc(exit.doorName)) && text.includes(esc(exit.assembly)) && text.includes(esc(floor.name)));
  }
  assert.ok(page.includes('<th scope="col">People at full capacity</th>'));
  // the sample sends 520 of 640 people out of Door A: far more than the others, in words, once
  assert.equal(countOf(page, HEAVY_WORDS), 1);
  assert.ok(/<tr data-exit="[^"]+" data-heavy="true"><th scope="row">[^]*?Door A/.test(page));
  assert.ok(page.includes('data-line="heavy"') && withoutMarks(page).includes('Door A (1) is the way out for rooms holding 520 of 640 people'));
});

test('a building with every room out says so; nothing is flagged without a heavy exit', () => {
  const project = twoRooms();
  const page = pack.pages(project, null, { ...NOW, sections: ['exits'] })[1].body;
  assert.ok(page.includes('data-line="all-out"'));
  assert.ok(!page.includes(pack.NO_WAY_OUT_HEAD));
  assert.equal(countOf(page, HEAVY_WORDS), 0);
});

test('rooms with no way out are listed under "Rooms with no way out: fix before posting", each with its sentence', () => {
  const project = disconnectedWing();
  const made = pack.pages(project, null, { ...NOW, sections: ['exits'] });
  assert.equal(made.length, 3, 'the cover, the table, then the list');
  assert.ok(made[1].body.includes('<table'), 'the table first');
  const list = made[2].body;
  assert.ok(list.includes('<h2>' + pack.NO_WAY_OUT_HEAD + '</h2>'));
  assert.equal(countOf(list, '<li data-room="'), 2, 'the east wing\'s two rooms');
  assert.ok(list.includes('Room 1C') && list.includes('Room 1D'));
  assert.ok(!made[1].body.includes('data-line="all-out"'));
  // the heading is the contract: it is also the one place the words are written
  assert.equal(pack.NO_WAY_OUT_HEAD, 'Rooms with no way out: fix before posting');
});

test('a building with no exit says so in the table\'s place, and still lists its rooms', () => {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']], {});
  const made = pack.pages(project, null, { ...NOW, sections: ['exits'] });
  assert.ok(made[1].body.includes('data-line="no-exit"'));
  assert.ok(made[1].body.includes(esc(pack.NO_EXIT_SAYS)));
  assert.ok(made.some((page) => page.body.includes(pack.NO_WAY_OUT_HEAD)), 'every room has no way out');
});

test('a building with one exit gets the one-way-out note, not a warning', () => {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']], { exits: [[1, 0, 3, 'Only Door']] });
  const page = pack.pages(project, null, { ...NOW, sections: ['exits'] })[1].body;
  assert.ok(page.includes('data-line="one-exit"'));
  assert.ok(!page.includes('data-line="heavy"') && !page.includes('>Warning<'));
});

// exits added to the sample's ground floor: short names, or 120-character assembly points
function withExits(project, n, assembly) {
  const floor = project.building.floors[0];
  const spare = floor.exits[0];
  for (let i = 0; i < n; i += 1) floor.exits.push({ ...spare, id: 'xextra' + String(i).padStart(5, '0'), doorName: 'Extra ' + i, assembly: assembly ? assembly(i) : spare.assembly });
  return project;
}
const LONG_ASSEMBLY = (i) => ('Assembly field ' + i + ' ').padEnd(120, 'by the far fence ');
const LETTER = { size: 'letter', orientation: 'landscape' };
const A4 = { size: 'a4', orientation: 'portrait' };
// the exits sheets of a pack, and the rows on each
const exitSheets = (made) => made.filter((page) => page.what === 'Map pack · Exits and assembly points');
const rowsOn = (page) => countOf(page.body, '<tr data-exit="');

test('a long table goes on to more sheets of its own, every sheet with its head row; the cover counts them', () => {
  const made = pack.pages(withExits(sampleSchool(), 24), null, { ...NOW, paper: LETTER, sections: ['exits'] });
  const sheets = exitSheets(made);
  assert.ok(sheets.length >= 3, 'twenty-six exits do not fit on two sheets');
  assert.ok(sheets[1].body.includes('(continued)'));
  for (const page of sheets) assert.ok(page.body.includes('<thead>'), 'the head repeats on every sheet');
  assert.equal(sheets.reduce((sum, page) => sum + rowsOn(page), 0), 26);
  assert.equal(contentsOf(made[0].body)[0].sheets, sheets.length);
});

test('the first sheet of the table holds fewer rows by the lead lines it carries; the later sheets are as full as each other', () => {
  const project = withExits(sampleSchool(), 40);
  // every row the same words, so that only the lead lines make the first sheet's room smaller
  for (const floor of project.building.floors) for (const exit of floor.exits) Object.assign(exit, { doorName: 'Door', assembly: 'Front lawn' });
  const made = exitSheets(pack.pages(project, null, { ...NOW, paper: LETTER, sections: ['exits'] }));
  assert.ok(made[0].body.includes('data-line="heavy"'), 'the first sheet carries the heavy exit\'s warning');
  // the warning's lines and the basis line are about three rows high; the heavy row itself is a line taller than the rest, so one row of the gap is not the lead's
  assert.ok(rowsOn(made[1]) - rowsOn(made[0]) >= 2, rowsOn(made[0]) + ' on the first sheet, ' + rowsOn(made[1]) + ' on the second');
  assert.equal(rowsOn(made[1]), rowsOn(made[2]));
});

test('long wrapped names take room: 120-character assembly points put fewer rows on a sheet, on any paper', () => {
  for (const paper of [LETTER, A4]) {
    const short = exitSheets(pack.pages(withExits(sampleSchool(), 40), null, { ...NOW, paper, sections: ['exits'] }));
    const long = exitSheets(pack.pages(withExits(sampleSchool(), 40, LONG_ASSEMBLY), null, { ...NOW, paper, sections: ['exits'] }));
    assert.ok(rowsOn(long[1]) < rowsOn(short[1]), paper.size + ': ' + rowsOn(long[1]) + ' long rows to a sheet, ' + rowsOn(short[1]) + ' short');
    assert.ok(rowsOn(long[1]) >= 1);
  }
});

test('the closing line: a pack that ends on the exits keeps room for it, so it never lands on a sheet nobody counted', () => {
  // the same exits with something after them (door cards: not the pack's last) and with nothing after
  let tighter = 0;
  for (let n = 0; n < 60; n += 1) {
    const project = withExits(sampleSchool(), n);
    const ends = exitSheets(pack.pages(project, null, { ...NOW, paper: LETTER, sections: ['exits'] }));
    const goes = exitSheets(pack.pages(project, null, { ...NOW, paper: LETTER, sections: ['exits', 'cards'] }));
    assert.ok(ends.length >= goes.length, n + ' exits');
    if (ends.length > goes.length) tighter += 1;
  }
  assert.ok(tighter >= 1, 'some count of exits fills the last sheet to the foot');
});

test('the exits section scales with the paper: --exits-scale is 1 on Letter and grows on A2, as the lockdown index does', () => {
  const scaleOn = (paper) => Number(/--exits-scale: ([\d.]+)/.exec(pack.pages(sampleSchool(), null, { ...NOW, paper, sections: ['exits'] })[1].body)[1]);
  assert.equal(scaleOn(LETTER), 1);
  assert.equal(scaleOn(A4), 1);
  assert.ok(scaleOn({ size: 'a2', orientation: 'landscape' }) > 2);
});

// ---------------------------------------------------------------- the no-way-out intro and the lines that say all is well

test('the no-way-out intro agrees with its count, and names door cards and posters only when they are in the pack', () => {
  const one = twoRooms();
  one.building.floors[0].exits = [];
  // two rooms and no exit: two rooms have no way out
  const many = (sections) => textOf(exitSheets(pack.pages(one, null, { ...NOW, sections }))[1].body);
  assert.ok(many(['exits', 'cards', 'posters']).includes('2 rooms have no way out, so their door cards say so and their routes are missing from the posters.'));
  assert.ok(many(['exits', 'cards']).includes('2 rooms have no way out, so their door cards say so.'));
  assert.ok(many(['exits', 'posters']).includes('2 rooms have no way out, so their routes are missing from the posters.'));
  assert.ok(many(['exits']).includes('2 rooms have no way out.'));
});

test('one room with no way out: "1 room has no way out, so its door card says so and its route is missing from the posters."', () => {
  const project = disconnectedWing();
  const floor = project.building.floors[0];
  floor.spaces = floor.spaces.filter((space) => space.kind !== 'room' || space.number !== '1D');
  const intro = textOf(exitSheets(pack.pages(project, null, { ...NOW, sections: ['posters', 'cards', 'exits'] }))[1].body);
  assert.ok(intro.includes('1 room has no way out, so its door card says so and its route is missing from the posters.'), intro);
  assert.ok(textOf(exitSheets(pack.pages(project, null, { ...NOW, sections: ['exits'] }))[1].body).includes('1 room has no way out.'));
});

test('a building with no exit, or no room, does not also say "Every room has a way out."', () => {
  const noExit = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']], {});
  const noRooms = planProject([['.......', '.......', '#######', '.......', '.......']], { exits: [[1, 0, 3, 'Only Door']] });
  const neither = planProject([['.......', '.......', '#######', '.......', '.......']], {});
  for (const [what, project] of [['no exit', noExit], ['no room', noRooms], ['neither', neither]]) {
    const html = pack.render(project, null, { ...NOW, sections: ['exits'] }).html;
    assert.ok(!html.includes(pack.ALL_HAVE_WAY), what);
    assert.ok(!html.includes('data-line="all-out"'), what);
  }
  assert.ok(pack.render(noExit, null, { ...NOW, sections: ['exits'] }).html.includes(pack.NO_WAY_OUT_HEAD));
  assert.ok(pack.render(twoRooms(), null, { ...NOW, sections: ['exits'] }).html.includes(pack.ALL_HAVE_WAY), 'a building with an exit and every room out still says so');
});

test('with no room to make a door card for, the cover says "nothing to print yet" and counts no sheet', () => {
  const project = planProject([['.......', '.......', '#######', '.......', '.......']], { exits: [[1, 0, 3, 'Only Door']] });
  const made = pack.pages(project, null, { ...NOW, sections: ['cards', 'exits'] });
  const cover = made[0].body;
  assert.ok(/Door cards<\/span> <span class="card-cover__to">nothing to print yet</.test(cover), cover);
  assert.ok(!cover.includes('one or two sheets a room'));
  assert.deepEqual(contentsOf(cover), [{ id: 'exits', sheets: made.length - 1 }, { id: 'cards', sheets: 0 }]);
  assert.ok(cover.includes(made.length + ' sheets in all') || cover.includes(made.length + ' sheet in all'));
});

test('the cover lists the sections in one column, in the pack\'s order', () => {
  const cover = pack.pages(sampleSchool(), null, { ...NOW, sections: ALL })[0].body;
  assert.deepEqual(Array.from(cover.matchAll(/<li data-section="([^"]+)"/g)).map((match) => match[1]), ALL);
  assert.ok(cover.includes('class="card-cover__list mpack__list"'), 'the pack\'s own list class, which print.css sets to one column');
});

// ---------------------------------------------------------------- right-to-left names

test('typed names in a head and a sentence are isolated: a right-to-left floor, door and room name never reorders the line', () => {
  const floorName = 'الطابق الأول';
  const doorName = 'المدخل الرئيسي';
  const roomName = 'مكتبة';
  const project = sampleSchool();
  project.building.floors[1].name = floorName;
  project.building.floors[0].exits[0].doorName = doorName;
  const heads = pack.pages(project, null, { ...NOW, sections: ALL }).map((page) => page.what);
  assert.ok(heads.includes('Map pack · Floor plan: ' + FSI + floorName + PDI), 'the floor plan\'s head');
  assert.ok(heads.includes('Map pack · Lockdown map · ' + FSI + floorName + PDI), 'the lockdown map\'s head');
  assert.ok(heads.includes('Map pack · Evacuation routes · ' + FSI + floorName + PDI), 'the poster\'s head');
  assert.ok(heads.includes('Map pack · Floor plan: Floor 1'), 'a plain name is left as it reads');
  const exits = exitSheets(pack.pages(project, null, { ...NOW, sections: ['exits'] }))[0].body;
  assert.ok(exits.includes(FSI + doorName + PDI + ' (1) is the way out'), 'the load sentence');
  // a room that has no way out, numbered in Arabic, first in its sentence
  const wing = disconnectedWing();
  wing.building.floors[0].name = floorName;
  const room = wing.building.floors[0].spaces.find((space) => space.number === '1C');
  room.number = roomName;
  const list = pack.pages(wing, null, { ...NOW, sections: ['exits'] }).map((page) => page.body).find((body) => body.includes(pack.NO_WAY_OUT_HEAD));
  assert.ok(list.includes(FSI + roomName + PDI), 'the room\'s name is isolated in its sentence');
  assert.ok(list.includes(FSI + floorName + PDI), 'and the floor\'s');
});

// ---------------------------------------------------------------- the door cards' foot

test('door cards keep room for the closing line only on the pack\'s last sheet', () => {
  const project = sampleSchool();
  const paper = { size: 'letter', orientation: 'landscape' };
  const bodies = (made) => made.filter((page) => page.what === 'Map pack · Evacuation route').map((page) => page.body);
  const own = (last) => doorCards.pages(project, null, { ...NOW, paper, last }).filter((page) => page.what === 'Evacuation route').map((page) => page.body);
  // last of the pack: the foot is kept, as the module does alone
  assert.deepEqual(bodies(pack.pages(project, null, { ...NOW, paper, sections: ['cards'] })), own(true));
  // followed by the step-free report, or the exits: it is not
  assert.deepEqual(bodies(pack.pages(project, null, { ...NOW, paper, sections: ['cards', 'step-free'] })), own(false));
  assert.deepEqual(bodies(pack.pages(project, null, { ...NOW, paper, sections: ['exits', 'cards'] })), own(true));
  assert.notDeepEqual(own(true), own(false), 'the two differ, or the test says nothing');
});

test('the step-free tick: door cards carry their second block, and the report follows', () => {
  const project = sampleSchool();
  const withSteps = pack.render(project, null, { ...NOW, sections: ['cards', 'step-free'], stepFree: true }).html;
  const without = pack.render(project, null, { ...NOW, sections: ['cards'], stepFree: false }).html;
  assert.ok(countOf(withSteps, 'data-stepfree="') > 0);
  assert.equal(countOf(without, 'data-stepfree="'), 0);
  assert.ok(withSteps.includes('data-line="views"'), 'the report\'s last line');
  assert.ok(!without.includes('data-line="views"'));
});

// ---------------------------------------------------------------- names as typed

test('names are text: the school, door, assembly point, floor and room, in any script, never markup', () => {
  const project = twoRooms();
  const hostile = ['"><img src=x onerror=alert(1)>', '<b>Hall</b> & "co"', 'مدرسة النور', '学校の出口'];
  project.settings.schoolName = hostile[0];
  project.building.floors[0].name = hostile[1];
  project.building.floors[0].exits[0].doorName = hostile[2];
  project.building.floors[0].exits[0].assembly = hostile[3];
  const { html } = pack.render(project, null, { ...NOW, sections: ALL });
  for (const raw of [hostile[0], hostile[1]]) assert.equal(countOf(html, raw), 0, raw + ' is in the markup as typed');
  for (const value of hostile) assert.ok(html.includes(esc(value)), value + ' is printed, escaped');
  assert.equal(countOf(html.replace(/="[^"]*"/g, ''), '<img'), 0);
  assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i);
  assert.ok(html.includes('<span dir="auto">' + esc(hostile[2]) + '</span>'), 'the door name is set apart');
});

// ---------------------------------------------------------------- papers, determinism

test('every paper, either way up, A2 too: the same pack twice is the same document', () => {
  const project = sampleSchool();
  for (const paper of PAPERS) {
    const options = { ...NOW, paper, sections: ALL };
    const a = pack.render(project, null, options).html;
    assert.equal(a, pack.render(sampleSchool(), null, options).html, paper.size);
    assert.ok(a.length > 1000);
  }
});

test('the pack is made from the model alone: no clock but options.now, and the same with no date', () => {
  const project = sampleSchool();
  const dated = pack.render(project, null, NOW).html;
  const undated = pack.render(project, null, {}).html;
  assert.ok(dated.includes('1 September 2026'));
  assert.ok(!undated.includes('doc-head__date') && !undated.includes('data-line="date"'));
  assert.equal(pack.render(project, null, undefined).html, undated);
});
