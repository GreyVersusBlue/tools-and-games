// The staff browser's teacher, group, room, building map and staffing pages:
// node test/browser/staff-views-a.mjs
//
// First in plain Node: the sentences, the day types put together, who shares
// a group, who is in a room, the staffing counts, where a floor falls in the
// picture and what a tap means. Then in Chromium, on a published file opened
// from disk the way test/browser/staff-shell.mjs opens one (assembled here as
// the planner assembles it, nothing between the page and the network): every
// page at 390 px and at 1280 px, in both themes, with axe on each.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, TOOL_DIR } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { publishedModel } from '../../engine/publish-data.js';
import { periodName } from '../../engine/bells.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { mix, labelOn, GROUP_PRESETS } from '../../ui/colour.js';
import { openSchool } from '../../staff/model.js';
import { floorExtentOf, planOf, roomsAtTap, mapMix, mapLabelOn, MAP_TAP_RADIUS, MAP_MAX_CELL } from '../../staff/map.js';
import { teacherSummaryOf, partsToText, dayKindsOf, sharersOf, teachersOfSlot, wordsJoined } from '../../staff/views/teacher.js';
import { groupTeaching, groupSummaryOf, shortPeriod } from '../../staff/views/group.js';
import { roomUse, roomSummaryOf } from '../../staff/views/room.js';
import { roomsInOrder, floorLegend } from '../../staff/views/map.js';
import { staffingRows } from '../../staff/views/staffing.js';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';
const LIGHT = { paper: '#f6f3ec', ink: '#1f2328', accent: '#0f6e66' };
const DARK = { paper: '#15181c', ink: '#e8e6e1', accent: '#5fc2b8' };

const future = () => new Date('2999-01-01T12:00:00Z');
const school = (change) => {
  const project = sampleSchool();
  if (change) change(project);
  return openSchool(publishedModel(project, { clock: future }));
};
// B Day follows A Day: no bells and no days of its own.
const followed = (project) => {
  project.dayTypes[1].own = false;
  project.dayTypes[1].bells = [];
  for (const group of project.groups) delete group.days.dsample00b;
};

// ================================================================ plain Node

test('a teacher\'s sentence counts the classes and names the planning, day type by day type', () => {
  const sample = school();
  assert.equal(partsToText(teacherSummaryOf(sample, 'tsample007')), 'Teaches 6 classes on A Day and 5 on B Day. Planning is Period 5 and Period 6 on A Day; Period 3, Period 4 and Period 5 on B Day.');
  // more than three planning periods are counted, not named
  assert.equal(partsToText(teacherSummaryOf(sample, 'tsample001')), 'Teaches 2 classes on A Day and 3 on B Day. Has 6 planning periods on A Day and 5 on B Day.');
  const typed = teacherSummaryOf(sample, 'tsample007').filter((part) => typeof part !== 'string').map((part) => part.typed);
  assert.deepEqual(typed, ['A Day', 'B Day', 'A Day', 'B Day'], 'a day type\'s name is a typed part, never pluralised');
});

test('when the day types are the same the sentence says it once', () => {
  const same = school(followed);
  assert.equal(partsToText(teacherSummaryOf(same, 'tsample007')), 'Teaches 6 classes. Planning is Period 5 and Period 6.');
  const blocks = school((project) => {
    followed(project);
    project.settings.periodWord = 'Block';
  });
  assert.equal(partsToText(teacherSummaryOf(blocks, 'tsample007')), 'Teaches 6 classes. Planning is Block E and Block F.');
});

test('a teacher with one planning period a day, no planning, or no classes is said plainly', () => {
  const one = school((project) => {
    project.settings.periods = 2;
    for (const dayType of project.dayTypes) dayType.bells = dayType.bells.slice(0, 2);
    for (const group of project.groups) {
      for (const id of Object.keys(group.days)) group.days[id] = group.days[id].slice(0, 2).map(() => ({ room: null, roomText: '', label: '', teacherIds: [] }));
    }
    project.groups[0].days.dsample00a[0] = { room: 'rsample101', roomText: '', label: '', teacherIds: [] };
    project.groups[0].days.dsample00b[1] = { room: 'rsample101', roomText: '', label: '', teacherIds: [] };
    project.groups[1].days.dsample00a[0] = { room: 'rsample102', roomText: '', label: '', teacherIds: [] };
    project.groups[1].days.dsample00a[1] = { room: 'rsample102', roomText: '', label: '', teacherIds: [] };
    project.groups[1].days.dsample00b[0] = { room: 'rsample102', roomText: '', label: '', teacherIds: [] };
  });
  assert.equal(partsToText(teacherSummaryOf(one, 'tsample001')), 'Teaches 1 class. Planning is Period 2 on A Day and Period 1 on B Day.');
  assert.equal(partsToText(teacherSummaryOf(one, 'tsample002')), 'Teaches 2 classes on A Day and 1 on B Day. Planning is none on A Day and Period 2 on B Day.');
  assert.equal(partsToText(teacherSummaryOf(one, 'tsample003')), 'Has no classes in this schedule.');
});

test('day types are put together only when the bells and the day are both the same', () => {
  const describe = (sample, teacherId) => (dayType) => sample.teacherDay(teacherId, dayType.id).map((entry) => entry.groups);
  const sample = school();
  assert.deepEqual(dayKindsOf(sample, describe(sample, 'tsample007')).map((kind) => kind.dayTypes.map((dayType) => dayType.name)), [['A Day'], ['B Day']]);
  const same = school(followed);
  assert.deepEqual(dayKindsOf(same, describe(same, 'tsample007')).map((kind) => kind.dayTypes.map((dayType) => dayType.name)), [['A Day', 'B Day']]);
  // B Day is its own copy with the same day, but its bells still differ
  const bells = school((project) => {
    for (const group of project.groups) group.days.dsample00b = JSON.parse(JSON.stringify(group.days.dsample00a));
  });
  assert.equal(dayKindsOf(bells, describe(bells, 'tsample007')).length, 2);
  const copy = school((project) => {
    for (const group of project.groups) group.days.dsample00b = JSON.parse(JSON.stringify(group.days.dsample00a));
    project.dayTypes[1].bells = JSON.parse(JSON.stringify(project.dayTypes[0].bells));
  });
  assert.equal(dayKindsOf(copy, describe(copy, 'tsample007')).length, 1);
});

test('teachers who share groups are listed with the groups they share', () => {
  const tiny = school((project) => {
    const empty = () => ({ room: null, roomText: '', label: '', teacherIds: [] });
    for (const group of project.groups) {
      for (const id of Object.keys(group.days)) group.days[id] = group.days[id].map(empty);
    }
    project.groups[0].days.dsample00a[0].room = 'rsample101'; // 6A with Halloran
    project.groups[0].days.dsample00b[3].room = 'rsample102'; // 6A with Brightwater, on the other day type
    project.groups[1].days.dsample00a[1].room = 'rsample102'; // 6B with Brightwater
    project.groups[2].days.dsample00a[2].room = 'rsample103'; // 6C with Quillfeather
  });
  assert.deepEqual(sharersOf(tiny, 'tsample001').map((sharer) => [sharer.teacher.name, sharer.groups.map((group) => group.name)]), [['Mr. Brightwater', ['6A']]]);
  assert.deepEqual(sharersOf(tiny, 'tsample002').map((sharer) => [sharer.teacher.name, sharer.groups.map((group) => group.name)]), [['Ms. Halloran', ['6A']]]);
  assert.deepEqual(sharersOf(tiny, 'tsample003'), []);
  assert.deepEqual(teachersOfSlot(tiny, 'dsample00b', 'gsample06a', 3).map((teacher) => teacher.name), ['Mr. Brightwater']);
  assert.deepEqual(teachersOfSlot(tiny, 'dsample00b', 'gsample06a', 0), []);
});

test('a slot that names a teacher takes the group from the room\'s own teacher, on every page', () => {
  const named = school((project) => {
    project.groups[0].days.dsample00a[0].teacherIds = ['tsample002']; // 6A, Period 1, Room 201 (Oyelaran's), taught by Brightwater
  });
  assert.deepEqual(teachersOfSlot(named, 'dsample00a', 'gsample06a', 0).map((teacher) => teacher.name), ['Mr. Brightwater']);
  assert.deepEqual(roomUse(named, 'rsample201', 'dsample00a')[0].map((use) => use.teachers.map((teacher) => teacher.name)), [['Mr. Brightwater']]);
});

test('who teaches a group: a row for each teacher in each room, with the periods on each kind of day', () => {
  const sample = school();
  const kinds = dayKindsOf(sample, (dayType) => sample.groupDay('gsample06a', dayType.id));
  const rows = groupTeaching(sample, 'gsample06a', kinds);
  const said = rows.map((row) => [row.teacher ? row.teacher.name : null, row.room.number, row.periods]);
  assert.deepEqual(said[0], ['Ms. Oyelaran', '201', [[0], [0]]]);
  assert.deepEqual(said[3], [null, 'Cafeteria', [[3], [3]]], 'a room with no teacher still has its row');
  assert.deepEqual(said.find((row) => row[0] === 'Coach Dunmore'), ['Coach Dunmore', 'Gym', [[], [2]]]);
  assert.equal(rows.length, 12);
  assert.equal(partsToText(groupSummaryOf(sample, sample.group('gsample06a'), rows)), 'Grade 6. Taught by 11 teachers in 12 rooms.');
  assert.equal(partsToText(groupSummaryOf(sample, { name: 'X', grade: '' }, [])), 'Has nothing scheduled in this copy.');
});

test('a room\'s day shows every group in it, two at once included, and counts its periods in use', () => {
  const sample = school();
  const use = roomUse(sample, 'rsample203', 'dsample00a');
  assert.deepEqual(use.map((period) => period.map((each) => each.group.name)), [['6B'], ['6C', '7C'], ['8A'], ['8B'], [], [], ['7A'], ['6A']]);
  assert.deepEqual(use[1].map((each) => each.teachers.map((teacher) => teacher.name)), [['Ms. Vandermeer'], ['Ms. Vandermeer']]);
  assert.equal(partsToText(roomSummaryOf(sample, sample.room('rsample203'))), 'On Floor 2. In use for 6 of 8 periods on A Day and 5 on B Day.');
  const same = school(followed);
  assert.equal(partsToText(roomSummaryOf(same, same.room('rsample203'))), 'On Floor 2. In use for 6 of 8 periods.');
  const unused = school((project) => {
    for (const group of project.groups) {
      for (const day of Object.values(group.days)) {
        for (const slot of day) if (slot.room === 'rsamplelib') slot.room = null;
      }
    }
  });
  assert.equal(partsToText(roomSummaryOf(unused, unused.room('rsamplelib'))), 'On Floor 2. Not used in this schedule.');
});

test('staffing has a row for every subject, with or without a teacher, and one for teachers with none', () => {
  const sample = school();
  const rows = staffingRows(sample);
  assert.deepEqual(rows.map((row) => [row.subject.code, row.teachers.length, row.taught]), [
    ['MATH', 2, [7, 8]], ['ENG', 2, [8, 8]], ['SCI', 2, [8, 8]], ['SOC', 1, [6, 5]], ['LANG', 1, [6, 5]], ['ART', 1, [6, 6]], ['MUS', 1, [4, 6]], ['PE', 1, [5, 5]], ['LIB', 1, [5, 5]],
  ]);
  const odd = school((project) => {
    project.subjects.push({ id: 'ssamplenew', code: 'DRA', name: 'Drama', colour: '#444444' });
    project.teachers[0].subjectId = null;
  });
  const said = staffingRows(odd).map((row) => [row.subject ? row.subject.code : null, row.teachers.length, row.taught]);
  assert.deepEqual(said[0], ['MATH', 1, [5, 5]]);
  assert.deepEqual(said[9], ['DRA', 0, [0, 0]], 'a subject nobody teaches is still listed');
  assert.deepEqual(said[10], [null, 1, [2, 3]], 'a teacher with no subject is counted in a row of their own');
  const same = school(followed);
  assert.deepEqual(staffingRows(same)[0].taught, [7], 'a day type that follows A Day has no column of its own');
});

test('the short form of a period is what is left when the school\'s word is taken away', () => {
  const short = (word, index) => shortPeriod(periodName({ periodWord: word }, index));
  assert.deepEqual([short('Period', 2), short('Mod', 11), short('Block', 2), short('Hour', 2)], ['3', '12', 'C', '3rd']);
});

test('rooms are listed by number, numbers counted as numbers, a room with none last', () => {
  const floor = { spaces: ['Gym', '12', '', '101', '9', '9B'].map((number, at) => ({ id: 'r' + at, kind: 'room', number })).concat({ id: 'o1', kind: 'other', label: 'Office' }) };
  assert.deepEqual(roomsInOrder(floor).map((room) => room.number), ['9', '9B', '12', '101', 'Gym', '']);
  const sample = school();
  assert.deepEqual(floorLegend(sample, sample.floor('fsample001')), { subjects: [sample.subject('ssample001'), sample.subject('ssample003'), sample.subject('ssample008')], none: true });
});

test('a floor falls in the picture where the arithmetic says: Floor 1 at 410 px is 10 px a cell', () => {
  const floor = school().floor('fsample001');
  // drawn from column 1 to 39 and row 1 to 13, with one empty cell around it
  assert.deepEqual(floorExtentOf(floor), { x: 0, y: 0, w: 41, h: 15 });
  const plan = planOf(floor, 410, 1, 0);
  assert.equal(plan.cell, 10);
  assert.equal(plan.height, 150);
  assert.equal(plan.maxPan, 0);
  const room = plan.shapes.find((shape) => shape.id === 'rsample103'); // columns 13 to 17, rows 3 to 6
  assert.deepEqual(room.box, { x: 130, y: 30, w: 50, h: 40 });
  assert.equal(room.rects.length, 4, 'a row of cells is one rectangle');
  // zoomed in, the floor is wider than the picture and can be moved by exactly the difference
  const zoomed = planOf(floor, 410, 2, 9999);
  assert.equal(zoomed.cell, 20);
  assert.equal(zoomed.maxPan, 410);
  assert.equal(zoomed.pan, 410, 'a move past the end stops at the end');
  assert.equal(zoomed.shapes.find((shape) => shape.id === 'rsample103').box.x, 260 - 410);
  // a small building is not blown up, and sits in the middle
  const small = { id: 'f1', width: 6, height: 5, cells: '.......##...........##........', spaces: [] };
  assert.deepEqual(floorExtentOf(small), { x: 0, y: 0, w: 5, h: 5 });
  const little = planOf(small, 400, 1, 0);
  assert.equal(little.cell, MAP_MAX_CELL);
  assert.equal(little.ox, (400 - 5 * MAP_MAX_CELL) / 2);
  assert.deepEqual(floorExtentOf({ width: 4, height: 3, cells: '............', spaces: [] }), { x: 0, y: 0, w: 4, h: 3 });
});

test('a tap picks the nearest room within 22 px, and asks when a second is nearly as near', () => {
  const room = (id, x) => ({ id, kind: 'room', rects: [{ x, y: 0, w: 40, h: 40 }] });
  const shapes = [room('a', 0), room('b', 48), { id: 'o', kind: 'other', rects: [{ x: 0, y: 60, w: 200, h: 40 }] }, room('far', 300)];
  assert.equal(MAP_TAP_RADIUS, 22);
  assert.deepEqual(roomsAtTap(shapes, 20, 20), { pick: 'a', choices: [] }, 'inside a room, the next one 28 px away');
  assert.deepEqual(roomsAtTap(shapes, 44, 20), { pick: null, choices: ['a', 'b'] }, 'in the gap between two');
  assert.deepEqual(roomsAtTap(shapes, 38, 20), { pick: null, choices: ['a', 'b'] }, 'inside one but only 10 px from the other: a finger cannot tell them apart');
  assert.deepEqual(roomsAtTap(shapes, 28, 20), { pick: 'a', choices: [] }, 'inside one, the other 20 px off: within the radius but clearly farther');
  assert.deepEqual(roomsAtTap(shapes, 300 + 40 + 22, 20), { pick: 'far', choices: [] }, 'exactly 22 px away still counts');
  assert.deepEqual(roomsAtTap(shapes, 300 + 40 + 22.5, 20), { pick: null, choices: [] }, 'beyond 22 px nothing is picked');
  assert.deepEqual(roomsAtTap(shapes, 150, 80), { pick: null, choices: [] }, 'an other space is never picked');
});

test('the label colour on the plan is ui/colour.js\'s, for every subject and preset in both themes', () => {
  const colours = sampleSchool().subjects.map((subject) => subject.colour).concat(GROUP_PRESETS, ['#fff', '#000000', '#e9e4d9', '#2f343b']);
  let compared = 0;
  for (const theme of [LIGHT, DARK]) {
    for (const colour of colours) {
      const fill = mix(colour, theme.paper, 0.7);
      assert.equal(mapMix(colour, theme.paper, 0.7), fill);
      assert.equal(mapLabelOn(fill, theme.ink, theme.paper), labelOn(fill, theme.ink, theme.paper), colour + ' on ' + theme.paper);
      compared += 1;
    }
  }
  assert.ok(compared >= 40);
  assert.deepEqual(wordsJoined(['a', 'b', 'c']).join(''), 'a, b and c');
});

// ================================================================ Chromium

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-views-a-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, change) {
  const project = sampleSchool();
  project.publish.passcode = '';
  if (change) change(project);
  const published = await publishDocument(read, project, { clock: future, random: seededRandom('staff-views-a ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href };
}

before(async () => {
  await write('open');
  await write('same', followed);
  await write('hostile', (project) => {
    project.teachers[0].name = HOSTILE + ' T';
    project.groups[0].name = HOSTILE + ' G';
    project.subjects[0].name = HOSTILE + ' S';
    project.building.floors[0].name = HOSTILE + ' F';
    project.building.floors[0].spaces[0].number = HOSTILE + ' 1';
    project.building.floors[0].spaces[0].wing = HOSTILE + ' W';
    project.dayTypes[1].name = HOSTILE + ' D';
  });
  await write('partial', (project) => {
    project.publish.views.room = false;
    project.publish.views.group = false;
    project.publish.views.coverage = false;
    project.publish.teacherNamesOnMap = false;
  });
  await write('nomap', (project) => { project.publish.views.map = false; });
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// The clock every page here reads: a Tuesday, 9:00 in the morning, in UTC.
// On A Day that is Period 2 (8:52 to 9:40); on B Day, Period 1 (8:20 to 9:08).
const pinClock = () => {
  const fixed = Date.parse('2026-09-01T09:00:00Z');
  const Real = Date;
  class Pinned extends Real {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = Pinned;
};

async function openPage(options) {
  const opts = options || {};
  const phone = (opts.width || 390) < 900;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone('UTC');
  const features = [{ name: 'prefers-color-scheme', value: opts.theme || 'light' }];
  if (opts.still) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  await page.emulateMediaFeatures(features);
  await page.evaluateOnNewDocument(pinClock);
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, requests, errors, phone, close: () => context.close() };
}

const asked = (session, own) => session.requests.filter((url) => url !== own && !url.startsWith(own + '#') && !url.startsWith('data:'));
const text = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent), selector);
const one = (page, selector) => page.evaluate((s) => {
  const found = document.querySelector(s);
  return found ? found.textContent : null;
}, selector);
const hash = (page) => page.evaluate(() => location.hash);

// Open an address of a file and wait until its page, and its map if it has
// one, are drawn.
async function visit(page, file, address) {
  await page.goto('about:blank');
  await page.goto(file.url + address, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.map')).every((map) => map.dataset.cell), { timeout: 10000 });
}

async function axe(page, name) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

// Where a room is in the picture on screen, from the picture's own width.
async function roomBox(page, floorId, roomId) {
  const frame = await page.evaluate(() => {
    const canvas = document.querySelector('.map__plan');
    const box = canvas.getBoundingClientRect();
    const map = canvas.closest('.map');
    return { left: box.left, top: box.top, width: map.clientWidth, zoom: Number(map.dataset.zoom) };
  });
  const plan = planOf(school().floor(floorId), frame.width, frame.zoom, 0);
  const box = plan.shapes.find((shape) => shape.id === roomId).box;
  return { ...box, left: frame.left, top: frame.top, cell: plan.cell };
}

const pixel = (page, x, y) => page.evaluate((px, py) => {
  const canvas = document.querySelector('.map__plan');
  const data = canvas.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data;
  return '#' + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}, x, y);

// A tap (a finger on the phone, a click on the desktop) at a point of the
// picture, given from the picture's own corner.
async function tap(session, x, y) {
  const at = await session.page.evaluate(() => {
    const canvas = document.querySelector('.map__plan');
    canvas.scrollIntoView({ block: 'center' });
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top };
  });
  if (session.phone) await session.page.touchscreen.tap(at.left + x, at.top + y);
  else await session.page.mouse.click(at.left + x, at.top + y);
}

const PAGES = [
  ['#/teacher/tsample007', 'the teacher page'],
  ['#/group/gsample06a', 'the group page'],
  ['#/room/rsample203', 'the room page'],
  ['#/map/fsample001', 'the building map'],
  ['#/staffing', 'the staffing page'],
];

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test('at ' + width + ' px, ' + theme + ': every page draws, fits the window, passes axe and asks for nothing', async () => {
      const session = await openPage({ width, theme });
      try {
        const { page } = session;
        for (const [address, name] of PAGES) {
          await visit(page, files.open, address);
          const said = await page.evaluate(() => ({
            lede: document.querySelector('.lede').textContent,
            built: !document.body.innerText.includes('not built yet'),
            wide: document.documentElement.scrollWidth,
            window: window.innerWidth,
            paper: getComputedStyle(document.body).backgroundColor,
          }));
          assert.ok(said.built, name + ' is still the stub');
          assert.ok(said.lede.length > 10 && said.lede.endsWith('.'), name + ' starts with a sentence: ' + said.lede);
          assert.ok(said.wide <= said.window, name + ' is ' + said.wide + ' px wide in a window of ' + said.window);
          assert.equal(said.paper, theme === 'light' ? 'rgb(246, 243, 236)' : 'rgb(21, 24, 28)');
          await axe(page, name + ' at ' + width + ' px, ' + theme);
        }
        assert.deepEqual(asked(session, files.open.url).filter((url) => url !== 'about:blank'), [], 'a published file asks for nothing');
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });
  }
}

test('the teacher page: the sentence, the header card, a card a day type, the groups, and who shares them', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await visit(page, files.open, '#/teacher/tsample007');
    assert.equal(await one(page, 'h1'), 'Ms. Vandermeer');
    assert.equal(await page.title(), 'Ms. Vandermeer · Marrowby Middle School (sample)');
    assert.equal(await one(page, '.lede'), 'Teaches 6 classes on A Day and 5 on B Day. Planning is Period 5 and Period 6 on A Day; Period 3, Period 4 and Period 5 on B Day.');
    assert.deepEqual(await text(page, '.facts dt'), ['Subject', 'Room']);
    assert.equal(await one(page, '.facts .chip'), 'Social Studies');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.facts .chip'), '::before').backgroundColor), 'rgb(183, 121, 31)', 'the chip\'s dot is the subject\'s colour');
    assert.equal(await page.evaluate(() => document.querySelector('.facts a').getAttribute('href')), '#/room/rsample203');
    assert.equal(await one(page, '.facts div:nth-child(2) dd'), 'Room 203 · Floor 2');

    assert.equal(await page.evaluate(() => document.querySelector('.days').dataset.count), '2', 'the day types differ, so there are two cards');
    assert.deepEqual(await text(page, '.day .card__title'), ['A Day', 'B Day']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row--now').length), 0, 'nobody has said which day type today is, so no period is marked');
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.day:first-child .row'), (row) => Array.from(row.children, (cell) => cell.textContent)));
    assert.equal(rows.length, 8);
    assert.deepEqual(rows[0], ['Period 18:00 AM to 8:48 AM', '6B', 'Room 203']);
    assert.deepEqual(rows[1], ['Period 28:52 AM to 9:40 AM', '6C and 7C', 'Room 203'], 'two groups at once are both shown');
    assert.deepEqual(rows[4], ['Period 511:28 AM to 12:16 PM', 'Planning', '']);
    assert.equal(await page.evaluate(() => document.querySelector('.day .row a').getAttribute('href')), '#/group/gsample06b');

    assert.deepEqual(await text(page, '.part__title'), ['Groups taught', 'Teachers who share these groups']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-label="Groups taught"] a').length), 8);
    const sharers = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Teachers who share these groups"] a'), (link) => [link.getAttribute('href'), link.querySelector('.list__name').textContent, link.querySelector('.list__detail').textContent]));
    assert.equal(sharers.length, 11);
    assert.deepEqual(sharers[0], ['#/teacher/tsample001', 'Ms. Halloran', 'Shares 6A, 7A, 7B, 8A and 8B']);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.actions a'), (link) => [link.textContent, link.getAttribute('href')])), [['Coverage', '#/coverage/tsample007'], ['Substitute plan', '#/sub/tsample007']]);

    // the small map: the teacher's floor, the room ringed in the accent, and said in words
    assert.equal(await page.evaluate(() => document.querySelector('.map').dataset.floor), 'fsample002');
    assert.equal(await one(page, '.map__says'), 'Room 203 is ringed.');
    const box = await roomBox(page, 'fsample002', 'rsample203');
    assert.equal(await pixel(page, box.x - 1, box.y + box.h / 2), LIGHT.accent, 'the ring around Room 203');
    const other = await roomBox(page, 'fsample002', 'rsample202');
    assert.notEqual(await pixel(page, other.x - 1, other.y + other.h / 2), LIGHT.accent, 'no ring around Room 202');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.map__pulse')).animationName), 'map-pulse', 'the ringed room pulses once');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.map__pulse')).animationIterationCount), '1');
    // another floor: said in words, and nothing ringed
    await page.click('.map__tabs .tab[data-floor="fsample001"]');
    assert.equal(await one(page, '.map__says'), 'Ms. Vandermeer has no room on Floor 1.');
    assert.equal(await page.evaluate(() => document.querySelector('.map__pulse').hidden), true);
    assert.equal(await hash(page), '#/teacher/tsample007', 'the floor changes in place');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('with reduced motion the ring is still and still there', async () => {
  const session = await openPage({ still: true });
  try {
    const { page } = session;
    await visit(page, files.open, '#/room/rsample203');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.map__pulse')).animationName), 'none');
    const box = await roomBox(page, 'fsample002', 'rsample203');
    assert.equal(await pixel(page, box.x - 1, box.y + box.h / 2), LIGHT.accent);
  } finally {
    await session.close();
  }
});

test('identical day types are one card, and the current period is marked when the day is known', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await visit(page, files.same, '#/teacher/tsample007');
    assert.equal(await page.evaluate(() => document.querySelector('.days').dataset.count), '1');
    assert.deepEqual(await text(page, '.day .card__title'), ['A Day and B Day']);
    assert.equal(await one(page, '.lede'), 'Teaches 6 classes. Planning is Period 5 and Period 6.');
    // 9:00 is in Period 2 (8:52 to 9:40)
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.row--now'), (row) => [row.dataset.period, row.querySelector('.row__mark').textContent])), [['1', 'Now']]);
    await visit(page, files.same, '#/room/rsample203');
    assert.deepEqual(await text(page, '.day .card__title'), ['A Day and B Day']);
    await visit(page, files.same, '#/group/gsample06a');
    assert.deepEqual(await text(page, '.day .card__title'), ['A Day and B Day']);
    assert.deepEqual(await text(page, '.table thead th'), ['Subject', 'Teacher', 'Room', 'A Day and B Day']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.part > .tabs').length), 0, 'one kind of day needs no day tabs over the map');
    await visit(page, files.same, '#/staffing');
    assert.deepEqual(await text(page, '.table thead th'), ['Subject', 'Teachers', 'Taught periods on A Day']);
    assert.equal(await one(page, '.page__body > .muted'), 'B Day is the same as A Day.');

    // two kinds of day: marked only on the one the reader said today is
    await visit(page, files.open, '#/teacher/tsample007');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row--now').length), 0);
    await page.evaluate(() => localStorage.setItem('sv2staff:psample001:day', 'dsample00b'));
    await visit(page, files.open, '#/teacher/tsample007');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.row--now'), (row) => [row.closest('.day').dataset.days, row.dataset.period])), [['dsample00b', '0']]);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the group page: grade, who teaches it, its day, and where it goes on each day type', async () => {
  const session = await openPage({ width: 1280 });
  try {
    const { page } = session;
    await visit(page, files.open, '#/group/gsample06a');
    assert.equal(await one(page, 'h1'), '6A');
    assert.equal(await one(page, '.lede'), 'Grade 6. Taught by 11 teachers in 12 rooms.');
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!/head count|students|24/i.test(body.replace(/\d+:\d+/g, '')), 'a head count is never shown');
    assert.deepEqual(await text(page, '.table thead th'), ['Subject', 'Teacher', 'Room', 'A Day', 'B Day']);
    const table = await page.evaluate(() => Array.from(document.querySelectorAll('.table tbody tr'), (row) => Array.from(row.cells, (cell) => cell.textContent)));
    assert.equal(table.length, 12);
    assert.deepEqual(table[0], ['English', 'Ms. Oyelaran', 'Room 201', 'Period 1', 'Period 1']);
    assert.deepEqual(table[1], ['Science', 'Dr. Quillfeather', 'Room 103', 'Period 2', 'None']);
    assert.deepEqual(table[3], ['Lunch', 'No teacher', 'Cafeteria', 'Period 4', 'Period 4']);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.table tbody tr:first-child a'), (link) => link.getAttribute('href'))), ['#/teacher/tsample005', '#/room/rsample201']);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.day:first-child .row'), (row) => Array.from(row.children, (cell) => cell.textContent)));
    assert.deepEqual(rows[0], ['Period 18:00 AM to 8:48 AM', 'Ms. Oyelaran', 'Room 201']);
    assert.deepEqual(rows[3], ['Period 410:36 AM to 11:24 AM', 'Lunch', 'Cafeteria']);
    // side by side from 900 px: the two cards share a line, and the map stands beside the page
    const laid = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.day'), (card) => card.getBoundingClientRect());
      const map = document.querySelector('.map').getBoundingClientRect();
      return { sameLine: cards[0].top === cards[1].top, beside: map.left >= cards[1].right, mapTop: map.top, cardsTop: cards[0].top };
    });
    assert.ok(laid.sameLine, 'the day cards are side by side');
    assert.ok(laid.beside && laid.mapTop < laid.cardsTop, 'the map is beside the page');

    // the map: A Day first, on the floor of the first room of the day, badged with period and time
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.part > .tabs .tab'), (tab) => [tab.textContent, tab.getAttribute('aria-current')])), [['A Day', 'true'], ['B Day', null]]);
    assert.equal(await page.evaluate(() => document.querySelector('.map').dataset.floor), 'fsample002');
    assert.equal(await one(page, '.map__says'), 'On Floor 2: Room 201 (Period 1 at 8:00 AM), Room 204 (Period 7 at 1:12 PM) and Room 203 (Period 8 at 2:04 PM).');
    const box = await roomBox(page, 'fsample002', 'rsample201');
    assert.equal(await pixel(page, box.x + box.w / 2 - 12, box.y + 5), LIGHT.accent, 'the badge on Room 201');
    const none = await roomBox(page, 'fsample002', 'rsample202');
    assert.notEqual(await pixel(page, none.x + none.w / 2 - 12, none.y + 5), LIGHT.accent, 'no badge on Room 202, where 6A never goes');
    await page.click('.part > .tabs .tab[data-kind="1"]');
    assert.equal(await one(page, '.map__says'), 'On Floor 2: Room 201 (Period 1 at 8:20 AM), Room 204 (Period 2 at 9:12 AM) and Library (Period 6 at 12:40 PM).');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'B Day', 'focus stays on the tab that was pressed');
    await page.click('.map__tabs .tab[data-floor="fsample001"]');
    assert.equal(await one(page, '.map__says'), 'On Floor 1: Gym (Period 3 at 10:04 AM), Cafeteria (Period 4 at 10:56 AM) and Room 102 (Period 5 at 11:48 AM).');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the room page: who is in it each period, when it is empty, its subject, capacity and features', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await visit(page, files.open, '#/room/rsample203');
    assert.equal(await one(page, 'h1'), 'Room 203');
    assert.equal(await one(page, '.lede'), 'On Floor 2. In use for 6 of 8 periods on A Day and 5 on B Day.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.facts > div'), (line) => [line.children[0].textContent, line.children[1].textContent])), [
      ['Subject', 'Social Studies'], ['Teacher', 'Ms. Vandermeer'], ['Capacity', '30'], ['Features', 'None listed'], ['Floor', 'Floor 2'],
    ]);
    assert.equal(await page.evaluate(() => document.querySelector('.facts div:last-child a').getAttribute('href')), '#/map/fsample002');
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.day:first-child .row'), (row) => Array.from(row.children, (cell) => cell.textContent)));
    assert.deepEqual(rows[1], ['Period 28:52 AM to 9:40 AM', '6C and 7C', 'Ms. Vandermeer'], 'a double-booking is shown as it is');
    assert.deepEqual(rows[4], ['Period 511:28 AM to 12:16 PM', 'Empty', '']);
    assert.equal(await one(page, '.map__says'), 'Room 203 is ringed.');

    // a room with no teacher has a page all the same
    await visit(page, files.open, '#/room/rsamplecaf');
    assert.equal(await one(page, 'h1'), 'Cafeteria');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.facts > div'), (line) => [line.children[0].textContent, line.children[1].textContent])), [
      ['Subject', 'No subject'], ['Teacher', 'No teacher is based here'], ['Capacity', '150'], ['Features', 'Shared space'], ['Floor', 'Floor 1'],
    ]);
    const lunch = await page.evaluate(() => Array.from(document.querySelector('.day .row[data-period="3"]').children, (cell) => cell.textContent));
    assert.equal(lunch[2], 'No teacher');
    assert.match(lunch[1], /^6A Lunch, /);
    await visit(page, files.open, '#/room/rsamplegym');
    assert.equal(await one(page, '.facts div:nth-child(4) dd'), 'Shared space and Wing: East');
    await visit(page, files.open, '#/room/rnothere00');
    assert.equal(await one(page, 'h1'), 'Not in this schedule');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

for (const width of [390, 1280]) {
  test('the building map at ' + width + ' px: floor tabs, subject colours, a tap on a room, the short list, zoom, the list in words', async () => {
    const session = await openPage({ width });
    try {
      const { page } = session;
      await visit(page, files.open, '#/map');
      assert.equal(await one(page, 'h1'), 'Building map: Floor 1');
      assert.equal(await one(page, '.lede'), 'Floor 1 has 5 rooms. Tap a room for its page.');
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.map__tabs .tab'), (tab) => [tab.textContent, tab.getAttribute('href'), tab.getAttribute('aria-current')])), [
        ['Floor 1', '#/map/fsample001', 'page'], ['Floor 2', '#/map/fsample002', null], ['Floor 3', '#/map/fsample003', null],
      ]);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.map')).touchAction), 'pan-y', 'one finger on the map still scrolls the page');
      assert.equal(await page.evaluate(() => document.querySelector('.map__plan').getAttribute('role')), 'img');
      assert.match(await page.evaluate(() => document.querySelector('.map__plan').getAttribute('aria-label')), /^Building map: Floor 1\./);

      // the list in words: every room a link, then the other spaces
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Rooms on this floor"] a'), (link) => [link.getAttribute('href'), link.querySelector('.list__name').textContent, link.querySelector('.list__detail') ? link.querySelector('.list__detail').textContent : ''])), [
        ['#/room/rsample101', 'Room 101', 'Mathematics · Ms. Halloran'],
        ['#/room/rsample102', 'Room 102', 'Mathematics · Mr. Brightwater'],
        ['#/room/rsample103', 'Room 103', 'Science · Dr. Quillfeather'],
        ['#/room/rsamplecaf', 'Cafeteria', ''],
        ['#/room/rsamplegym', 'Gym', 'Physical Education · Coach Dunmore'],
      ]);
      assert.deepEqual(await text(page, '.plain li'), ['Office', 'Bathrooms', 'Kitchen', 'Courtyard']);
      assert.deepEqual(await text(page, '.legend li'), ['Mathematics', 'Science', 'Physical Education', 'No subject']);

      // the picture: a room is its subject's colour at 70% over paper, a corridor is white
      const science = await roomBox(page, 'fsample001', 'rsample103');
      assert.equal(await pixel(page, science.x + 3, science.y + 3), mix('#3f8f5b', LIGHT.paper, 0.7), 'Room 103 is Science');
      const maths = await roomBox(page, 'fsample001', 'rsample101');
      assert.equal(await pixel(page, maths.x + 3, maths.y + 3), mix('#2a6f97', LIGHT.paper, 0.7), 'Room 101 is Mathematics');
      assert.equal(await pixel(page, science.x + 3, science.y + science.h + science.cell / 2), '#ffffff', 'the corridor under Room 103');
      assert.notEqual(await page.evaluate(() => document.querySelector('.map__plan').dataset.labelrsample101), '0', 'Room 101 carries its number');

      // zoom: out is at its end, in makes a cell bigger, Fit puts it back
      const zoom = () => page.evaluate(() => ({ zoom: document.querySelector('.map').dataset.zoom, cell: Number(document.querySelector('.map').dataset.cell), out: document.querySelector('[aria-label="Zoom out"]').getAttribute('aria-disabled'), tall: document.querySelector('.map__plan').getBoundingClientRect().height }));
      const before = await zoom();
      assert.deepEqual([before.zoom, before.out], ['1', 'true']);
      await page.click('[aria-label="Zoom in"]');
      const closer = await zoom();
      assert.equal(closer.zoom, '1.5');
      assert.ok(Math.abs(closer.cell - before.cell * 1.5) < 0.001 && closer.tall > before.tall && closer.out === 'false');
      await page.click('[aria-label="Fit the floor to the window"]');
      assert.deepEqual(await zoom(), before);

      // a tap in the gap between Room 101 and Room 102 is near both: a short list asks which
      await tap(session, maths.x + maths.w + maths.cell / 2, maths.y + maths.h / 2);
      await page.waitForFunction(() => document.querySelectorAll('.map__which a').length > 0, { timeout: 5000 });
      assert.equal(await one(page, '.map__ask'), 'Which room?');
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.map__which a'), (link) => [link.textContent, link.getAttribute('href')])), [['Room 101', '#/room/rsample101'], ['Room 102', '#/room/rsample102']]);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '#/room/rsample101', 'focus moves to the first of them');
      assert.equal(await hash(page), '#/map', 'nothing was picked yet');

      // a tap far from any room does nothing and clears the list
      const courtyard = await roomBox(page, 'fsample001', 'osample004');
      await tap(session, courtyard.x + courtyard.w / 2, courtyard.y + courtyard.h - 2);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.map__which a').length), 0);
      assert.equal(await hash(page), '#/map');

      // a tap inside the Gym opens its page; Back returns to the map
      const gym = await roomBox(page, 'fsample001', 'rsamplegym');
      await tap(session, gym.x + gym.w / 2, gym.y + gym.h / 2);
      // the address changes first and the page is drawn on the event after it
      await page.waitForFunction(() => location.hash === '#/room/rsamplegym' && document.querySelector('h1').textContent === 'Gym', { timeout: 5000 });
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#/map' && document.querySelector('h1').textContent === 'Building map: Floor 1', { timeout: 5000 });

      // a floor tab is an address
      await page.waitForFunction(() => document.querySelector('.map') && document.querySelector('.map').dataset.cell, { timeout: 5000 });
      await page.click('.map__tabs .tab[data-floor="fsample003"]');
      await page.waitForFunction(() => location.hash === '#/map/fsample003' && document.querySelector('h1').textContent === 'Building map: Floor 3', { timeout: 5000 });
      assert.deepEqual(await text(page, '[aria-label="Rooms on this floor"] .list__name'), ['Room 301', 'Room 302', 'Room 303']);
      await visit(page, files.open, '#/map/fnothere00');
      assert.equal(await one(page, 'h1'), 'Not in this schedule');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('in the dark theme the plan is drawn in the dark tokens', async () => {
  const session = await openPage({ theme: 'dark' });
  try {
    const { page } = session;
    await visit(page, files.open, '#/room/rsample103');
    const box = await roomBox(page, 'fsample001', 'rsample103');
    assert.equal(await pixel(page, box.x + 3, box.y + 3), mix('#3f8f5b', DARK.paper, 0.7));
    assert.equal(await pixel(page, box.x - 1, box.y + box.h / 2), DARK.accent, 'the ring');
    assert.equal(await pixel(page, box.x + 3, box.y + box.h + box.cell / 2), '#2a2f36', 'the corridor');
  } finally {
    await session.close();
  }
});

test('the staffing page: teachers and taught periods for every subject, and the totals', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await visit(page, files.open, '#/staffing');
    assert.equal(await one(page, 'h1'), 'Staffing');
    assert.equal(await one(page, '.lede'), '12 teachers in 9 subjects.');
    assert.deepEqual(await text(page, '.table thead th'), ['Subject', 'Teachers', 'Taught periods on A Day', 'Taught periods on B Day']);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.table tbody tr'), (row) => [row.querySelector('.chip').textContent].concat(Array.from(row.querySelectorAll('td'), (cell) => cell.textContent))));
    assert.equal(rows.length, 9);
    assert.deepEqual(rows[0], ['Mathematics', '2', '7', '8']);
    assert.deepEqual(rows[6], ['Music', '1', '4', '6']);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.table tfoot tr > *'), (cell) => cell.textContent)), ['All subjects', '12', '55', '56']);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.table tbody tr:first-child a'), (link) => link.getAttribute('href'))), ['#/teacher/tsample001', '#/teacher/tsample002']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a name with markup in it is shown exactly as typed on every page', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    for (const [address, word] of [['#/teacher/tsample001', ' T'], ['#/group/gsample06a', ' G'], ['#/room/rsample101', ' 1'], ['#/map/fsample001', ' F'], ['#/staffing', ' S']]) {
      await visit(page, files.hostile, address);
      const body = await page.evaluate(() => document.body.innerText);
      assert.ok(body.includes(HOSTILE + word), address + ' shows the name as typed');
      assert.equal(await page.evaluate(() => document.querySelectorAll('#page img, #page b').length), 0, address + ' made markup of a name');
    }
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    await visit(page, files.hostile, '#/teacher/tsample007');
    assert.match(await one(page, '.lede'), / on <img src=x onerror="window\.__pwned=1"> <\/script><b>"Ünï" 東京 D\./, 'a day type\'s name in the sentence');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.lede bdi').length), 4, 'each typed name in the sentence is kept apart');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('views the publisher left out are named in plain text, never linked, and the map does not open them', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await visit(page, files.partial, '#/teacher/tsample007');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#page a[href^="#/room/"], #page a[href^="#/group/"], #page a[href^="#/coverage/"]').length), 0);
    assert.deepEqual(await text(page, '.actions a'), ['Substitute plan']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-label="Groups taught"] .list__name').length), 8, 'the groups are still named');
    await visit(page, files.partial, '#/map/fsample001');
    assert.equal(await one(page, '.lede'), 'Floor 1 has 5 rooms. The rooms are listed below.');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#page a[href^="#/room/"]').length), 0);
    assert.deepEqual(await text(page, '[aria-label="Rooms on this floor"] .list__detail'), ['Mathematics', 'Mathematics', 'Science', 'Physical Education'], 'teacher names were left off the map');
    const gym = await roomBox(page, 'fsample001', 'rsamplegym');
    await tap(session, gym.x + gym.w / 2, gym.y + gym.h / 2);
    assert.equal(await hash(page), '#/map/fsample001');
    await axe(page, 'the map with the room page left out');
    // with the map left out, a page has no picture and still has everything else
    await visit(page, files.nomap, '#/room/rsample203');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.map, #page a[href^="#/map"]').length), 0);
    assert.equal(await one(page, '.facts div:last-child dd'), 'Floor 2');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});
