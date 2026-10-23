// The M4 pass on the published file (SV2-45), driven in Chromium:
//   node test/browser/m4-pass.mjs
//
// What a reader of the staff file meets on a phone: the sample school
// published with no passcode, opened from disk at 390 by 844 with touch, in
// the light theme and the dark, and at 1280 by 800 where a case says so.
//
//   M1  a period's times stay on one line, and the rows of a day line up
//   M2  directions are in cells, spec 2's one word, as the planner says it
//   M3  a way with no stairs that does not exist is said plainly
//   M4  "Print this page" stands only on a page with something to print
//   M5  a link in a row or a table is 44 px high under a finger
//   M6  a corridor reads against the floor's ground at 3:1 in both themes
//   M7  the substitute plan on paper: the date as words, every name listed
//   M8  an address the file does not know says so above Search
//   10  the shell names the view on the frame, so the door sign's paper
//       rules need no :has()
//
// A wait here is for a state the page sets (data-state, data-cell, a box),
// never for a count of frames.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, TOOL_DIR } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { sampleSchool } from '../../data/sample-school.js';
import { seededRandom } from '../../engine/ids.js';
import { planOf } from '../../staff/map.js';

const future = () => new Date('2026-09-01T12:00:00Z');

// The files are written to a folder of this suite's own and taken away when
// it ends: SV2_SCRATCH when the machine names a place, otherwise
// test/.scratch inside the tool.
const SCRATCH_ROOT = process.env.SV2_SCRATCH ? path.resolve(process.env.SV2_SCRATCH) : path.join(TOOL_DIR, 'test', '.scratch');
mkdirSync(SCRATCH_ROOT, { recursive: true });
const scratch = mkdtempSync(path.join(SCRATCH_ROOT, 'm4-pass-'));
const files = {};
let browser;

async function write(name, change) {
  const project = sampleSchool();
  project.publish.passcode = '';
  if (change) change(project);
  const published = await publishDocument(diskReader(), project, { clock: future, random: seededRandom('m4-pass ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href, project };
}

// A name that is one unbroken word (no space, no hyphen to break at), wider
// than a phone's column.
const LONG = 'Featherstonehaughcholmondeleymarjoribanksworthington';

before(async () => {
  await write('open');
  await write('long', (project) => {
    project.teachers[0].name = 'Ms. ' + LONG;
    project.groups[0].name = LONG;
    project.building.floors[0].spaces[0].number = LONG;
    project.subjects[0].name = LONG;
  });
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
  try {
    rmdirSync(SCRATCH_ROOT);
  } catch (error) {
    // another suite's files are still in it, or the machine named it
  }
});

// The clock every page here reads: a Tuesday, 9:00 in the morning, in UTC.
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

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };

async function openPage(options) {
  const opts = options || {};
  const size = opts.size || PHONE;
  const phone = size.width < 900;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone('UTC');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme || 'light' }]);
  await page.evaluateOnNewDocument(pinClock);
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, errors, requests, phone, close: () => context.close() };
}

// Open an address of the file and wait until its page, and its map if it has
// one, are drawn.
async function visit(page, address) {
  await page.goto('about:blank');
  await page.goto(files.open.url + address, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.map')).every((map) => map.dataset.cell), { timeout: 10000 });
}

// Run a case in a page of its own; the page asks for nothing and reports nothing.
async function withPage(options, run) {
  const session = await openPage(options);
  try {
    await run(session.page, session);
    const own = Object.values(files).map((file) => file.url);
    assert.deepEqual(session.requests.filter((url) => !own.some((file) => url === file || url.startsWith(file + '#')) && !url.startsWith('data:') && url !== 'about:blank'), [], 'a published file asks for nothing');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
}

const both = (name, run) => {
  for (const theme of ['light', 'dark']) test(name + ' (' + theme + ')', () => withPage({ theme }, (page, session) => run(page, session, theme)));
};

// Is "Print this page" (or a page's own print button) on screen?
const printShown = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-print]')).some((button) => button.getClientRects().length > 0));

// ---------------------------------------------------------------- M1

const dayRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.day'), (card) => ({
  // the lines a time is set on: its words' boxes, counted by where they start
  // (the element is a box of its own, with one rectangle however it wraps)
  times: Array.from(card.querySelectorAll('.row__time'), (time) => {
    const words = document.createRange();
    words.selectNodeContents(time);
    return { text: time.textContent, lines: new Set(Array.from(words.getClientRects(), (rect) => Math.round(rect.top))).size, box: time.getBoundingClientRect().height > 0 };
  }),
  whatLefts: Array.from(new Set(Array.from(card.querySelectorAll('.row__what'), (what) => Math.round(what.getBoundingClientRect().left)))),
  rowHeights: Array.from(card.querySelectorAll('.row'), (row) => Math.round(row.getBoundingClientRect().height)),
  over: card.scrollWidth > card.clientWidth,
})));

function oneLineTimes(cards, where) {
  assert.ok(cards.length >= 1, where + ': the day is on the page');
  for (const card of cards) {
    assert.ok(card.times.length >= 6, where + ': a card has a time for each period');
    for (const time of card.times) {
      assert.ok(time.box, where + ': ' + time.text + ' has a box');
      assert.equal(time.lines, 1, where + ': "' + time.text + '" is on one line');
    }
    assert.equal(card.whatLefts.length, 1, where + ': every row\'s group starts at the same place, ' + card.whatLefts.join(' and '));
    assert.equal(card.over, false, where + ': the card does not run off sideways');
  }
}

// A row was 82 px with its times on two lines, and Coach Dunmore's page
// 3908 px. In a narrow card the period and its times are now one line, with
// the group and the room on the line under it at the height of a target:
// 69 px a row, and the page 3361 px.
const ROW_MOST = 70;

both('M1: a period\'s times are on one line on a teacher\'s page and on My schedule, at 390 px, and no row is over 70 px', async (page) => {
  await visit(page, '#/teacher/tsample004');
  const cards = await dayRows(page);
  oneLineTimes(cards, 'Coach Dunmore at 390');
  for (const card of cards) for (const height of card.rowHeights) assert.ok(height <= ROW_MOST, 'a row is ' + height + ' px high');
  const long = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(long < 3500, 'the page is ' + long + ' px long; it was 3908');

  await visit(page, '#/me');
  await page.select('#me-who', 'tsample012');
  await page.click('[data-me="choose"]');
  await page.waitForFunction(() => document.querySelector('.page__title').textContent === 'My schedule' && document.querySelector('.day') !== null);
  oneLineTimes(await dayRows(page), 'My schedule at 390');
  await page.evaluate(() => localStorage.clear());
});

test('M1: at 1280 px, the two day types side by side, the times are on one line too', () => withPage({ size: DESK }, async (page) => {
  await visit(page, '#/teacher/tsample004');
  const cards = await dayRows(page);
  assert.equal(cards.length, 2, 'A Day and B Day');
  const lefts = await page.evaluate(() => Array.from(document.querySelectorAll('.day'), (card) => Math.round(card.getBoundingClientRect().left)));
  assert.notEqual(lefts[0], lefts[1], 'the two cards are side by side');
  oneLineTimes(cards, 'Coach Dunmore at 1280');
}));

// ---------------------------------------------------------------- M2, M3

both('M2: directions are written in cells, in the steps and in the line under them, and nowhere in squares', async (page) => {
  await visit(page, '#/directions?from=rsample101&to=rsample302');
  await page.waitForFunction(() => document.querySelector('[data-directions="steps"]') !== null);
  const said = await page.evaluate(() => ({
    walks: Array.from(document.querySelectorAll('.steps__step[data-kind="walk"]'), (step) => step.textContent),
    under: document.querySelector('[data-directions="time"]').textContent,
    all: document.querySelector('[data-out="directions"]').textContent,
  }));
  assert.ok(said.walks.length >= 3, 'the way crosses the building: ' + said.walks.length + ' walks');
  for (const walk of said.walks) assert.match(walk, /^Walk \d+ cells?\b/, walk);
  assert.equal(said.walks[0], 'Walk 9 cells along Main Corridor, past Room 102.');
  assert.match(said.under, /Distances are in cells of the floor plan\.$/);
  assert.doesNotMatch(said.all, /\bsquares?\b/, 'spec 2 has one word for a cell, and "square" is not it');
});

both('M3: a way with no stairs between two floors is refused plainly, and the line that offers the stairs follows', async (page) => {
  await visit(page, '#/directions?from=rsample101&to=rsample302&stepfree=1');
  const said = await page.evaluate(() => ({
    says: document.querySelector('.lede[role="status"]').textContent,
    ok: document.querySelector('.lede[role="status"]').dataset.ok,
    next: document.querySelector('[data-directions="stairs"]').textContent,
    button: document.querySelector('[data-directions="stairs"] button').getClientRects().length,
  }));
  assert.equal(said.says, 'There is no way from Room 101 to Room 302 without stairs.');
  assert.equal(said.ok, 'false');
  assert.equal(said.next, 'There is a way that uses stairs. Show the way with stairs');
  assert.equal(said.button, 1);
  // and the button gives the way
  await page.tap('[data-directions="stairs"] button');
  await page.waitForFunction(() => document.querySelector('[data-directions="steps"]') !== null);
  assert.equal(await page.evaluate(() => location.hash), '#/directions?from=rsample101&to=rsample302');
});

// ---------------------------------------------------------------- M4

test('M4: "Print this page" is on a page only when the page has a result: seven pages that are still asking, then each with its answer', () => withPage({}, async (page) => {
  // [address, what it is, how the reader gives it something to show]
  const asking = [
    ['#/search', 'Search with nothing typed', async () => {
      await page.type('#find', 'hal');
      await page.waitForFunction(() => document.querySelectorAll('a[data-result]').length > 0);
    }],
    ['#/directions', 'Directions before two rooms are chosen', async () => {
      await page.select('#directions-from', 'rsample101');
      assert.equal(await printShown(page), false, 'one room is not a way');
      await page.select('#directions-to', 'rsample103');
      await page.waitForFunction(() => document.querySelector('[data-directions="steps"]') !== null);
    }],
    ['#/coverage', 'Coverage before a teacher is chosen', async () => {
      await page.select('#coverage-teacher', 'tsample004');
      await page.waitForFunction(() => document.querySelector('[data-out="coverage"]') !== null);
    }],
    ['#/sub', 'the substitute plan before a teacher is chosen', async () => {
      await page.select('#sub-teacher', 'tsample004');
      await page.waitForFunction(() => document.querySelector('[data-out="sub"]') !== null);
    }],
    ['#/common', 'Common planning with nobody chosen', async () => {
      await page.select('#common-add', 'tsample001');
      assert.equal(await printShown(page), false, 'one teacher has nobody to be free with');
      await page.select('#common-add', 'tsample002');
      await page.waitForFunction(() => document.querySelector('[data-common="sentence"]') !== null);
    }],
    ['#/me', 'My schedule before a choice', async () => {
      await page.select('#me-who', 'tsample012');
      await page.click('[data-me="choose"]');
      await page.waitForFunction(() => document.querySelector('.day') !== null);
    }],
    ['#/now', 'Where right now with nobody chosen', async () => {
      await page.select('#now-who', 'g:gsample06a');
      await page.waitForFunction(() => document.querySelector('[data-where="sentence"]') !== null);
    }],
  ];
  for (const [address, name, answer] of asking) {
    await visit(page, address);
    assert.equal(await page.evaluate(() => document.querySelector('.page__body').dataset.result), 'none', name);
    assert.equal(await printShown(page), false, name + ': nothing to print, so no button');
    assert.equal(await page.evaluate(() => {
      const outputs = document.querySelector('.page__outputs');
      return !outputs || outputs.getClientRects().length === 0 || Array.from(outputs.children).some((child) => child.getClientRects().length > 0);
    }), true, name + ': no empty frame is left where the button stood');
    await answer();
    assert.equal(await printShown(page), true, name + ', answered: the button is there');
  }
  // and it goes again when the answer does
  await visit(page, '#/search?q=hal');
  assert.equal(await printShown(page), true, 'a search kept in the address has its results, and its button');
  await page.focus('#find');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.page__body').dataset.result === 'none');
  assert.equal(await printShown(page), false, 'the box emptied');
  // Something found, then nothing: the button comes with the results and goes
  // with them. Each step waits on what the page sets, so the last line is
  // read after the search for "halzzzz" was drawn, and the gate is seen to move.
  await page.type('#find', 'hal');
  await page.waitForFunction(() => document.querySelector('.page__body').dataset.result === 'true' && document.querySelectorAll('a[data-result]').length > 0);
  assert.equal(await printShown(page), true, 'results again, and their button');
  await page.type('#find', 'zzzz');
  await page.waitForFunction(() => document.getElementById('find').value === 'halzzzz' && location.hash.endsWith('q=halzzzz') && document.querySelectorAll('a[data-result]').length === 0 && document.querySelector('.page__body').dataset.result === 'none');
  assert.equal(await printShown(page), false, 'nothing found is nothing to print');
  // a page that names something this file does not have
  for (const address of ['#/teacher/tgone000001', '#/coverage/tgone000001', '#/door/rgone000001']) {
    await visit(page, address);
    assert.equal(await printShown(page), false, address);
  }
  // pages that always have something keep theirs
  for (const address of ['#/teacher/tsample004', '#/group/gsample06a', '#/room/rsample203', '#/map/fsample001', '#/staffing', '#/free', '#/coverage/tsample004', '#/sub/tsample004']) {
    await visit(page, address);
    assert.equal(await printShown(page), true, address);
  }
  // Where each of those prints from (SV2-49 item 10): a teacher's page has its
  // own button, "Print this schedule", in the row under the day with the image
  // and the door sign, so it is given no second one reading "Print this page".
  const printButtons = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-print]')).filter((button) => button.getClientRects().length > 0).map((button) => button.textContent + ' in ' + (button.closest('[data-actions]') || document.body).dataset.actions));
  await visit(page, '#/teacher/tsample004');
  assert.deepEqual(await printButtons(), ['Print this schedule in outputs']);
  await visit(page, '#/room/rsample203');
  assert.deepEqual(await printButtons(), ['Print this page in print']);
  await page.evaluate(() => localStorage.clear());
}));

// ---------------------------------------------------------------- M5

// Do any two of the links share a point? A target that lies over another
// gives the finger the wrong one.
const linksOverlap = (page, selector) => page.evaluate((s) => {
  const boxes = Array.from(document.querySelectorAll(s)).filter((link) => link.getClientRects().length > 0).map((link) => ({ text: link.textContent, box: link.getBoundingClientRect() }));
  const found = [];
  boxes.forEach((a, at) => {
    for (const b of boxes.slice(at + 1)) {
      const wide = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const high = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (wide > 0.5 && high > 0.5) found.push(a.text + ' and ' + b.text + ' by ' + Math.round(high) + ' px');
    }
  });
  return found;
}, selector);

const linkBoxes = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((link) => link.getClientRects().length > 0).map((link) => {
  const box = link.getBoundingClientRect();
  const holder = link.closest('.row, tr').getBoundingClientRect();
  // `line` is the tallest of the link's boxes: one for a link on one line
  const line = Math.max(...Array.from(link.getClientRects(), (rect) => rect.height));
  return { text: link.textContent, height: Math.round(box.height * 10) / 10, line: Math.round(line * 10) / 10, inside: box.top >= holder.top - 0.5 && box.bottom <= holder.bottom + 0.5, holder: Math.round(holder.height) };
}), selector);

both('M5: under a finger, a link in a row of a day or in a table is at least 44 px high and stays inside its row', async (page) => {
  const pages = [
    ['#/teacher/tsample004', '.day .row a', 'the groups and rooms of a teacher\'s day', 8],
    ['#/staffing', '.table a', 'the names in Staffing', 6],
    ['#/group/gsample06a', '.table a, .day .row a', 'the teachers and rooms of a group', 8],
    ['#/room/rsample203', '.day .row a', 'the groups of a room\'s day', 4],
  ];
  for (const [address, selector, name, least] of pages) {
    await visit(page, address);
    const links = await linkBoxes(page, selector);
    assert.ok(links.length >= least, name + ': ' + links.length + ' links measured');
    for (const link of links) {
      assert.ok(link.height >= 44, name + ': "' + link.text + '" is ' + link.height + ' px high');
      assert.ok(link.inside, name + ': "' + link.text + '" reaches outside its row of ' + link.holder + ' px');
    }
    assert.deepEqual(await linksOverlap(page, selector), [], name + ': no target lies over another');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, name + ': the page does not scroll sideways');
  }
  // a name that is one long word still breaks inside its link: the page never scrolls sideways for it
  for (const address of ['#/teacher/tsample001', '#/group/gsample06a', '#/room/rsample101', '#/staffing']) {
    await page.goto('about:blank');
    await page.goto(files.long.url + address, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
    const wide = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      window: window.innerWidth,
      links: document.querySelectorAll('.row a, .table a').length,
      out: Array.from(document.querySelectorAll('.day .row a')).filter((link) => link.getBoundingClientRect().right > link.closest('.row').getBoundingClientRect().right + 0.5).map((link) => link.textContent),
    }));
    assert.ok(wide.links >= 4, address + ' has its links');
    assert.ok(wide.page <= wide.window, address + ' with long names is ' + wide.page + ' px wide in a window of ' + wide.window);
    assert.deepEqual(wide.out, [], address + ': a long name breaks inside its row, it does not run out of it');
  }
  await visit(page, '#/search');
  // on paper, from the same phone, a link is as tall as its words
  await visit(page, '#/teacher/tsample004');
  await page.emulateMediaType('print');
  for (const link of await linkBoxes(page, '.day .row a')) assert.ok(link.line < 30, 'on paper "' + link.text + '" is ' + link.line + ' px high');
  await page.emulateMediaType('screen');
});

test('M5: with a mouse at 1280 px the same links are as tall as their words', () => withPage({ size: DESK }, async (page) => {
  await visit(page, '#/teacher/tsample004');
  for (const link of await linkBoxes(page, '.day .row a')) assert.ok(link.height < 30, '"' + link.text + '" is ' + link.height + ' px high with a mouse');
}));

// ---------------------------------------------------------------- M6

function luminance(hex) {
  const channel = (at) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

both('M6: on the map a corridor reads against the floor\'s ground at 3:1: its outline in both themes, and its fill too in the dark', async (page, session, theme) => {
  await visit(page, '#/map/fsample001');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.map'));
    const read = (name) => style.getPropertyValue(name).trim();
    return { ground: read('--grid'), corridor: read('--map-corridor'), edge: read('--line-strong'), planner: read('--corridor') };
  });
  assert.match(tokens.corridor, /^#[0-9a-f]{6}$/, '--map-corridor is set');
  assert.ok(contrast(tokens.edge, tokens.ground) >= 3, 'the outline (--line-strong ' + tokens.edge + ') on the ground (--grid ' + tokens.ground + ') is ' + contrast(tokens.edge, tokens.ground).toFixed(2) + ':1');
  if (theme === 'dark') {
    assert.ok(contrast(tokens.corridor, tokens.ground) >= 3, 'the corridor (--map-corridor ' + tokens.corridor + ') on the ground is ' + contrast(tokens.corridor, tokens.ground).toFixed(2) + ':1');
    assert.ok(contrast(tokens.planner, tokens.ground) < 1.5, 'which the planner\'s --corridor is not: the reason the map has a token of its own');
  } else {
    assert.ok(contrast(tokens.edge, tokens.corridor) >= 3, 'the outline on the corridor is ' + contrast(tokens.edge, tokens.corridor).toFixed(2) + ':1');
  }

  // and the picture is drawn with them: a corridor square with open ground above it
  const floor = files.open.project.building.floors[0];
  const owned = new Set(floor.spaces.flatMap((space) => space.cells));
  const exits = new Set((floor.exits || []).map((exit) => exit.cell));
  let at = -1;
  for (let index = floor.width; index < floor.cells.length && at === -1; index += 1) {
    const above = index - floor.width;
    const beside = [index - 1, index + 1];
    if (floor.cells[index] === '#' && floor.cells[above] === '.' && !owned.has(above) && !exits.has(index) && beside.every((cell) => floor.cells[cell] === '#' && !exits.has(cell))) at = index;
  }
  assert.notEqual(at, -1, 'the sample has a corridor square under open ground');
  const frame = await page.evaluate(() => {
    const map = document.querySelector('.map');
    return { width: map.clientWidth, zoom: Number(map.dataset.zoom) };
  });
  const plan = planOf(floor, frame.width, frame.zoom, 0);
  const x = plan.px(at % floor.width);
  const y = plan.py(Math.floor(at / floor.width));
  const pixel = (px, py) => page.evaluate((left, top) => {
    const data = document.querySelector('.map__plan').getContext('2d').getImageData(left, top, 1, 1).data;
    return '#' + [data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, '0')).join('');
  }, px, py);
  const middle = Math.round(x + plan.cell / 2);
  assert.equal(await pixel(middle, Math.round(y + plan.cell / 2)), tokens.corridor, 'the corridor is filled with --map-corridor');
  assert.equal(await pixel(middle, Math.round(y)), tokens.edge, 'its edge is one whole pixel of --line-strong, not half of it on two');
  assert.equal(await pixel(middle, Math.round(y) - 2), tokens.ground, 'and the ground above is --grid');
});

// ---------------------------------------------------------------- M7

test('M7: the substitute plan on paper: the date is a line of words with no field or picker, and every teacher who could cover is named', () => withPage({}, async (page) => {
  await visit(page, '#/sub/tsample004?date=2026-09-08');
  const words = await page.evaluate(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(2026, 8, 8)));
  const read = () => page.evaluate(() => {
    const boxed = (element) => Boolean(element) && element.getClientRects().length > 0;
    const cover = Array.from(document.querySelectorAll('[data-sub="cover"] li'), (line) => ({
      named: Array.from(line.querySelectorAll('[data-candidate]')).filter(boxed).length,
      all: line.querySelectorAll('[data-candidate]').length,
      more: boxed(line.querySelector('[data-sub="more"]')),
      text: line.textContent,
    }));
    return {
      date: boxed(document.querySelector('[data-sub="date"]')) ? document.querySelector('[data-sub="date"]').textContent : null,
      field: boxed(document.getElementById('sub-date')),
      label: boxed(document.querySelector('label[for="sub-date"]')),
      cover,
    };
  });
  const screen = await read();
  assert.equal(screen.date, null, 'on screen the date is the field');
  assert.equal(screen.field, true);
  const long = screen.cover.filter((line) => line.all > 3);
  assert.ok(long.length >= 1, 'a period of the sample has more than three teachers free');
  for (const line of long) {
    assert.equal(line.named, 3, 'on screen the first three: ' + line.text);
    assert.equal(line.more, true);
    assert.match(line.text, new RegExp(', and ' + (line.all - 3) + ' more$'));
  }

  await page.emulateMediaType('print');
  const paper = await read();
  assert.equal(paper.date, 'Date: ' + words);
  assert.equal(paper.field, false, 'no date field, so no picker icon, on paper');
  assert.equal(paper.label, false);
  for (const line of paper.cover) {
    assert.equal(line.named, line.all, 'on paper every one is named: ' + line.text);
    assert.equal(line.more, false, 'and nothing is cut at "and N more"');
  }
  await page.emulateMediaType('screen');

  // the line follows the field, and an emptied field leaves a line to write on
  await page.evaluate(() => {
    const field = document.getElementById('sub-date');
    field.value = '2026-09-09';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const next = await page.evaluate(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(2026, 8, 9)));
  assert.equal(await page.evaluate(() => document.querySelector('[data-sub="date"]').textContent), 'Date: ' + next);
  await page.evaluate(() => {
    const field = document.getElementById('sub-date');
    field.value = '';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => document.querySelector('[data-sub="date"]').textContent), 'Date: ________________');
}));

// ---------------------------------------------------------------- M8

both('M8: an address the file does not know shows Search with a line saying so, and the address becomes the search page\'s', async (page) => {
  await visit(page, '#/nonsense/route');
  const said = await page.evaluate(() => {
    const notice = document.querySelector('[data-notice="unknown"]');
    const title = document.querySelector('.page__title');
    return {
      notice: notice && notice.getClientRects().length > 0 ? notice.textContent : null,
      above: Boolean(notice) && notice.getBoundingClientRect().bottom <= title.getBoundingClientRect().top + 0.5,
      aboveBox: Boolean(notice) && notice.getBoundingClientRect().bottom <= document.getElementById('find').getBoundingClientRect().top,
      title: title.textContent,
      hash: location.hash,
      role: notice ? notice.getAttribute('role') : null,
      view: document.getElementById('app').dataset.view,
      tab: document.title,
    };
  });
  assert.deepEqual(said, { notice: 'That page is not in this schedule.', above: true, aboveBox: true, title: 'Search', hash: '#/search', role: 'status', view: 'search', tab: 'Search · Marrowby Middle School (sample)' });
  assert.equal(await printShown(page), false);
  // the line belongs to that arrival: it is gone on the next page, and Search reached by its own address has none
  await page.evaluate(() => { location.hash = '#/staffing'; });
  await page.waitForFunction(() => document.querySelector('.page__title').textContent === 'Staffing');
  assert.equal(await page.evaluate(() => document.querySelector('[data-notice]')), null);
  await visit(page, '#/search');
  assert.equal(await page.evaluate(() => document.querySelector('[data-notice]')), null);
  // a view's name with nothing after it is a page of the file, not an unknown one
  await visit(page, '#/staffing/extra/words');
  assert.equal(await page.evaluate(() => document.querySelector('[data-notice]')), null);
  assert.equal(await page.evaluate(() => location.hash), '#/staffing/extra/words');
});

// ---------------------------------------------------------------- item 10

test('10: the frame carries the view\'s name, and the door sign prints with no school line or footer by that name alone', () => withPage({}, async (page) => {
  // no rule for paper leans on :has(); the one left in the sheet widens a page on a desktop screen
  const css = readFileSync(path.join(TOOL_DIR, 'staff', 'staff.css'), 'utf8').replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const paper = css.split('\n@media print {').slice(1).map((block) => block.slice(0, block.indexOf('\n}\n')));
  assert.ok(paper.length >= 3, 'the paper rules were found');
  for (const block of paper) assert.ok(!block.includes(':has('), 'a paper rule uses :has()');
  assert.match(paper.join('\n'), /\n  \.app\[data-view="door"\] \.top,\n  \.app\[data-view="door"\] \.foot \{\n    display: none;\n  \}/);
  const boxed = (selector) => page.evaluate((s) => document.querySelector(s).getClientRects().length > 0, selector);

  await visit(page, '#/door/rsample203');
  assert.equal(await page.evaluate(() => document.getElementById('app').dataset.view), 'door');
  assert.equal(await boxed('.top'), true, 'on screen the school\'s line is there');
  await page.emulateMediaType('print');
  assert.equal(await boxed('.top'), false, 'on paper the sign stands alone');
  assert.equal(await boxed('.foot'), false);
  assert.equal(await boxed('.sheet'), true);
  await page.emulateMediaType('screen');

  // every other page keeps its header on paper, and the name follows the page
  await page.evaluate(() => { location.hash = '#/teacher/tsample004'; });
  await page.waitForFunction(() => document.getElementById('app').dataset.view === 'teacher');
  await page.emulateMediaType('print');
  assert.equal(await boxed('.top'), true);
  assert.equal(await boxed('.foot'), true);
  await page.emulateMediaType('screen');
}));
