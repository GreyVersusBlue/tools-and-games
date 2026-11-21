// The staff browser's W7 screens (SV2-133), driven in Chromium from published
// files on disk: node test/browser/staff-w7.mjs
//
// Two published files. `plain` is the invented sample with none of the W7
// fields: its pages must read as they did before (no chips, no part-time
// line, no "Not in school"). `w7` is the sample with all of them (fixture()):
//
//   features   Lab (rooms 103, 201, 203, 301), Sink (103, 201, 204),
//              Projector (101, 102, Library), Kiln (204 only) and one with a
//              hostile name, on room 301
//   away       Ms. Halloran: Fridays; Mr. Brightwater: Lessons 7 to 8 on
//              B Day; Ms. Oyelaran: Lessons 2, 3 and 5 on A Day (she is
//              free, not teaching, in 2 and 3 and in 5)
//   words      the period word "Lesson" (custom, counted by number), and
//              Lesson 7 named "Advisory"
//   stairwell  Stairwell W through Floors 1, 2 and 3 (three stops, two flights)
//
// The clock is pinned through `sv2StaffClock` at Wed 2 Sep 2026, 11:40 in New
// York: A Day, the fifth period (index 4). On A Day at that period nine rooms
// are empty (101, 102, 103, 201, 202, 203, Library, 303, 301), and these have
// the features: Lab 103, 201, 203, 301 (4); Sink 103, 201 (2); Projector 101,
// 102, Library (3); Kiln none (the only Kiln room is in use); the hostile one
// 301 (1). Every wait is on something the page sets (data-ready, the frame's
// data-state, the view on <main>, a lede's data-period, a chip's aria-pressed,
// the count line); nothing waits on a first paint or a fixed sleep.

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
import { validate } from '../../engine/validate.js';
import { seededRandom } from '../../engine/ids.js';
import { stairwells } from '../../engine/schema.js';
import { plainSchool as sampleSchool } from '../engine/helpers.mjs';
import { openSchool } from '../../staff/model.js';

const ZONE = 'America/New_York';
const A = 'dsample00a';
const B = 'dsample00b';
const WED = '2026-09-02T15:40:00Z'; // Wed 11:40: A Day, the fifth period
const HOSTILE = '<img src=x onerror=__pwned=1>';
const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }];
const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const FEATURE = { lab: 'hsample001', sink: 'hsample002', projector: 'hsample003', kiln: 'hsample004', hostile: 'hsample005' };

function fixture() {
  const project = sampleSchool();
  project.publish.passcode = '';
  project.calendar = {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day: day < 5 ? 'rotation' : 'closed', bells: null })),
    rotation: [A, B],
    dates: [],
    changedAt: null,
  };
  const { building } = project;
  building.features = [
    { id: FEATURE.lab, name: 'Lab' },
    { id: FEATURE.sink, name: 'Sink' },
    { id: FEATURE.projector, name: 'Projector' },
    { id: FEATURE.kiln, name: 'Kiln' },
    { id: FEATURE.hostile, name: HOSTILE },
  ];
  const give = { rsample103: ['lab', 'sink'], rsample201: ['lab', 'sink'], rsample203: ['lab'], rsample301: ['lab', 'hostile'], rsample204: ['sink', 'kiln'], rsample101: ['projector'], rsample102: ['projector'], rsamplelib: ['projector'] };
  for (const floor of building.floors) {
    for (const space of floor.spaces) {
      if (give[space.id]) space.featureIds = give[space.id].map((key) => FEATURE[key]);
    }
  }
  // one stairwell, W, through all three floors at one place
  for (const floor of building.floors) floor.cells = floor.cells.slice(0, 332) + 'S' + floor.cells.slice(333);
  building.connections = [
    { id: 'csample00a', label: 'A', a: { floorId: 'fsample001', cell: 332 }, b: { floorId: 'fsample002', cell: 332 }, direction: 'both', well: 'W' },
    { id: 'csample00b', label: 'B', a: { floorId: 'fsample002', cell: 332 }, b: { floorId: 'fsample003', cell: 332 }, direction: 'both', well: 'W' },
  ];
  const teacher = (id) => project.teachers.find((each) => each.id === id);
  teacher('tsample001').away = [{ dayTypeIds: [], weekdays: [4], periods: [] }];
  teacher('tsample002').away = [{ dayTypeIds: [B], weekdays: [], periods: [6, 7] }];
  teacher('tsample005').away = [{ dayTypeIds: [A], weekdays: [], periods: [1, 2, 4] }];
  project.settings.periodCustom = { word: 'Lesson', plural: 'Lessons', count: 'number' };
  project.settings.periodNames = ['', '', '', '', '', '', 'Advisory'];
  return project;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-w7-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, project) {
  const made = await publishDocument(read, project, { clock: () => new Date('2026-08-25T12:00:00Z'), random: seededRandom('staff-w7 ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, made.html);
  files[name] = { file, url: pathToFileURL(file).href, model: made.model };
}

before(async () => {
  const plain = sampleSchool();
  plain.publish.passcode = '';
  await write('plain', plain);
  await write('w7', fixture());
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a profile of its own, in New York, its clock pinned. Every
// fillText the map makes is kept in `sv2Drawn`, so a letter drawn on a canvas
// can be read.
async function openPage(options) {
  const opts = options || {};
  const size = opts.size || SIZES[0];
  const phone = size.width < 640;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
  if (opts.theme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme }]);
  await page.evaluateOnNewDocument((at) => {
    // a test moves the clock with sv2At and a visibilitychange (staff/clock.js looks again then)
    globalThis.sv2StaffClock = { now: () => globalThis.sv2At || at, every: 3600000 };
    globalThis.print = () => {};
    globalThis.sv2Drawn = [];
    const was = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function fillText(text, ...rest) {
      globalThis.sv2Drawn.push(String(text));
      return was.call(this, text, ...rest);
    };
  }, opts.at || WED);
  const errors = [];
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, errors, close: () => context.close() };
}

async function goto(page, file, hash) {
  await page.goto(file.url + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
  await viewDrawn(page, hash);
}

async function viewDrawn(page, hash) {
  const view = hash.replace(/^#\//, '').split(/[/?]/)[0];
  await page.waitForFunction((want) => document.querySelector('main.page')?.dataset.view === want && document.querySelector('h1'), { timeout: 10000 }, view);
}

const hashOf = (page) => page.evaluate(() => location.hash);
const texts = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const one = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, selector);
const count = (page, selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);

async function noOverflow(page, where) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, where + ': the page is ' + wide + ' px wider than the screen');
}

async function axe(page, name) {
  if (!(await page.evaluate(() => typeof globalThis.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

// The Free page, settled on the fifth period (index 4).
async function freeReady(page) {
  await page.waitForFunction(() => document.querySelector('.lede[role="status"]')?.dataset.period === '4' && document.querySelector('[data-list="teachers"]'), { timeout: 10000 });
}

const chipsOf = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-out="features"] button'), (el) => ({ id: el.dataset.feature, text: el.textContent.replace(/\s+/g, ' ').trim(), pressed: el.getAttribute('aria-pressed'), disabled: el.disabled, count: el.dataset.count })));
const roomsOf = (page) => texts(page, '[data-list="rooms"] .list__name');

// Press a chip and wait for the page to say it is pressed (or not).
async function press(page, id, want) {
  await page.click('[data-out="features"] [data-feature="' + id + '"]');
  await page.waitForFunction((feature, on) => document.querySelector('[data-out="features"] [data-feature="' + feature + '"]')?.getAttribute('aria-pressed') === on, { timeout: 5000 }, id, want ? 'true' : 'false');
}

// ---------------------------------------------------------------- the fixtures

test('the fixture is a valid project with a three-stop stairwell, and the published file carries every W7 field', () => {
  const project = fixture();
  assert.deepEqual(validate(project), []);
  const wells = stairwells(project.building);
  assert.equal(wells.length, 1);
  assert.equal(wells[0].letter, 'W');
  assert.equal(wells[0].stops.length, 3, 'three stops');
  const model = openSchool(publishedModel(project, { clock: () => new Date('2026-08-25T12:00:00Z') }));
  assert.deepEqual(model.features().map((feature) => feature.name), ['Lab', 'Sink', 'Projector', 'Kiln', HOSTILE]);
  assert.equal(model.data.settings.periodCustom.word, 'Lesson');
  assert.equal(model.teacher('tsample001').away.length, 1);
  assert.equal(model.data.building.connections.every((link) => link.well === 'W'), true);
  const plain = openSchool(publishedModel(sampleSchool(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  assert.deepEqual(plain.features(), [], 'the sample publishes no feature');
  assert.equal(plain.awayLine('tsample001'), '');
  assert.equal('features' in plain.data.building, false);
  assert.equal(plain.teachers.some((teacher) => 'away' in teacher), false);
});

test('the model says the part-time line in the engine\'s words', () => {
  const school = openSchool(publishedModel(fixture(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  assert.equal(school.awayLine('tsample001'), 'Part-time: not in school on Fridays');
  assert.equal(school.awayLine('tsample002'), 'Part-time: not in school in Lessons 7 to 8 when it is B Day');
  assert.equal(school.awayLine('tsample003'), '');
});

// ---------------------------------------------------------------- Free: rooms by feature

for (const size of SIZES) {
  test('Free right now at ' + size.width + ' px: a chip for each feature with its count, none at 0 pressable, AND, the count line, the address', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.w7, '#/free');
      await freeReady(page);
      const start = await chipsOf(page);
      assert.deepEqual(start.map((chip) => chip.text), ['Lab (4)', 'Sink (2)', 'Projector (3)', 'Kiln (0)', HOSTILE + ' (1)']);
      assert.deepEqual(start.map((chip) => chip.disabled), [false, false, false, true, false], 'Kiln gives no room and is disabled');
      assert.ok(start.every((chip) => chip.pressed === 'false'));
      assert.equal(await one(page, '[data-out="features-count"]'), '', 'the count line is empty while no chip is pressed');
      // the one count line, kept, so its words are what a screen reader hears
      await page.evaluate(() => { globalThis.sv2Line = document.querySelector('[data-out="features-count"]'); });
      const sameLine = () => page.evaluate(() => document.querySelectorAll('[data-out="features-count"]').length === 1 && document.querySelector('[data-out="features-count"]') === globalThis.sv2Line && globalThis.sv2Line.getAttribute('role') === 'status');
      assert.deepEqual(await roomsOf(page), ['Room 101', 'Room 102', 'Room 103', 'Room 201', 'Room 202', 'Room 203', 'Library', 'Room 303', 'Room 301']);
      assert.equal(await count(page, 'img'), 0, 'a feature named as markup is text');
      assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);

      await press(page, FEATURE.lab, true);
      assert.deepEqual(await roomsOf(page), ['Room 103', 'Room 201', 'Room 203', 'Room 301']);
      assert.equal(await one(page, '[data-out="features-count"]'), '4 empty rooms have Lab · 5 other empty rooms lack it.');
      assert.equal(await sameLine(), true, 'turning Lab on changes the words of the same status line');
      assert.equal(await hashOf(page), '#/free?features=' + FEATURE.lab);
      // each chip's name starts with its words and says what its count is
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-out="features"] button'), (el) => el.getAttribute('aria-label'))), [
        'Lab (4), chosen: 4 empty rooms shown', 'Sink (2), would show 2 empty rooms', 'Projector (0), no empty room has it', 'Kiln (0), no empty room has it', HOSTILE + ' (1), would show 1 empty room']);
      // with Lab chosen each chip says what it would give with Lab
      assert.deepEqual((await chipsOf(page)).map((chip) => chip.text), ['Lab (4)', 'Sink (2)', 'Projector (0)', 'Kiln (0)', HOSTILE + ' (1)']);
      assert.deepEqual((await chipsOf(page)).map((chip) => chip.disabled), [false, false, true, true, false], 'Projector gives none with Lab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.feature), FEATURE.lab, 'the chip pressed keeps the focus');

      await press(page, FEATURE.sink, true);
      assert.deepEqual(await roomsOf(page), ['Room 103', 'Room 201'], 'a room needs every chip chosen');
      assert.equal(await one(page, '[data-out="features-count"]'), '2 empty rooms have Lab and Sink · 7 other empty rooms lack one of them.');
      assert.equal(await hashOf(page), '#/free?features=' + FEATURE.lab + '%2C' + FEATURE.sink);

      await press(page, FEATURE.lab, false);
      assert.deepEqual(await roomsOf(page), ['Room 103', 'Room 201']);
      assert.equal(await one(page, '[data-out="features-count"]'), '2 empty rooms have Sink · 7 other empty rooms lack it.');
      await press(page, FEATURE.sink, false);
      assert.equal(await hashOf(page), '#/free');
      assert.equal(await one(page, '[data-out="features-count"]'), '', 'turning the last chip off empties the line');
      assert.equal(await sameLine(), true, 'the same status line, never made again');
      await noOverflow(page, 'Free at ' + size.width);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('Free right now keeps the chips through a reload and Back, and a seat count narrows with them', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.w7, '#/free?features=' + FEATURE.lab + '%2C' + FEATURE.sink);
    await freeReady(page);
    assert.deepEqual((await chipsOf(page)).map((chip) => chip.pressed), ['true', 'true', 'false', 'false', 'false']);
    assert.deepEqual(await roomsOf(page), ['Room 103', 'Room 201']);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
    await freeReady(page);
    assert.deepEqual((await chipsOf(page)).map((chip) => chip.pressed), ['true', 'true', 'false', 'false', 'false'], 'pressed again after a reload');
    assert.deepEqual(await roomsOf(page), ['Room 103', 'Room 201']);
    // go to a room, then Back
    await page.click('[data-list="rooms"] a');
    await page.waitForFunction(() => document.querySelector('main.page')?.dataset.view === 'room', { timeout: 10000 });
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('main.page')?.dataset.view === 'free', { timeout: 10000 });
    await freeReady(page);
    assert.deepEqual((await chipsOf(page)).map((chip) => chip.pressed), ['true', 'true', 'false', 'false', 'false'], 'pressed again after Back');
    assert.equal(await hashOf(page), '#/free?features=' + FEATURE.lab + '%2C' + FEATURE.sink);
    // seats narrow the chips' own counts: no room has 31 seats
    await page.type('#free-seats', '31');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-out="features"] button')).every((el) => el.dataset.count === '0'), { timeout: 5000 });
    // a feature id the file does not have is dropped from the choice
    await goto(page, files.w7, '#/free?features=hnothing01%2C' + FEATURE.kiln);
    await freeReady(page);
    assert.deepEqual((await chipsOf(page)).map((chip) => chip.pressed), ['false', 'false', 'false', 'true', 'false'], 'the unknown one is ignored; Kiln, chosen, stays');
    assert.equal(await one(page, '[data-out="features-count"]'), '0 empty rooms have Kiln · 9 other empty rooms lack it.');
    assert.equal((await chipsOf(page))[3].disabled, false, 'a chosen chip is never disabled, so it can be turned off');
  } finally {
    await session.close();
  }
});

// Move the pinned clock and let the page look again, as it does when it is shown.
async function clockTo(page, at, period) {
  await page.evaluate((when) => {
    globalThis.sv2At = when;
    document.dispatchEvent(new Event('visibilitychange'));
  }, at);
  await page.waitForFunction((want) => document.querySelector('.lede[role="status"]')?.dataset.period === want, { timeout: 5000 }, period);
}
const focusedChip = (page) => page.evaluate(() => (document.activeElement && document.activeElement.closest('[data-out="features"]') ? { id: document.activeElement.dataset.feature, disabled: document.activeElement.disabled } : document.activeElement.tagName.toLowerCase() + '#' + document.activeElement.id));

test('Free right now keeps the focus on a chip when the bell changes the period, and moves it to the nearest one when that chip is disabled', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    // Lab pressed and focused; at 12:30 the sixth period (index 5) has 2 rooms with Lab
    await goto(page, files.w7, '#/free');
    await freeReady(page);
    await press(page, FEATURE.lab, true);
    assert.deepEqual(await focusedChip(page), { id: FEATURE.lab, disabled: false });
    await clockTo(page, '2026-09-02T16:30:00Z', '5');
    assert.deepEqual((await chipsOf(page)).map((chip) => chip.text), ['Lab (2)', 'Sink (0)', 'Projector (0)', 'Kiln (0)', HOSTILE + ' (1)'], 'the chips are made again for the new period');
    assert.deepEqual(await focusedChip(page), { id: FEATURE.lab, disabled: false }, 'the same chip keeps the focus');
    // Sink focused, nothing chosen; at 12:30 no empty room has a sink, so its chip is disabled
    await page.evaluate(() => { globalThis.sv2At = null; });
    await goto(page, files.w7, '#/free');
    await freeReady(page);
    await page.focus('[data-out="features"] [data-feature="' + FEATURE.sink + '"]');
    await clockTo(page, '2026-09-02T16:30:00Z', '5');
    assert.equal((await chipsOf(page))[1].disabled, true, 'Sink gives none now');
    assert.deepEqual(await focusedChip(page), { id: FEATURE.projector, disabled: false }, 'the focus goes to the next chip that is not disabled, not to the page');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a school with no features has no chips and no empty heading on Free right now', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.plain, '#/free');
    await freeReady(page);
    assert.equal(await count(page, '[data-out="features"] button'), 0);
    assert.equal(await page.evaluate(() => document.querySelector('[data-out="features"]').hidden), true);
    assert.equal(await one(page, '[data-out="features-count"]'), '', 'no count line words');
    assert.equal(await page.evaluate(() => document.querySelector('[data-out="features-count"]').getBoundingClientRect().height), 0);
    // an address that asks for a feature asks for nothing
    await goto(page, files.plain, '#/free?features=' + FEATURE.lab);
    await freeReady(page);
    assert.equal((await roomsOf(page)).length, 9);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- the Room page

test('the Room page lists the room\'s features before the shared space, as typed, and the wing on a line of its own', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.w7, '#/room/rsample103');
    const facts = () => page.evaluate(() => Array.from(document.querySelectorAll('.facts > div'), (line) => [line.children[0].textContent, line.children[1].textContent]));
    // Room 103: "Features: Lab and Sink", then "Wing: West" as its own fact (DESIGN 16.9), never in the features
    assert.equal(await one(page, '.facts div:nth-child(4) dd'), 'Lab and Sink');
    assert.deepEqual((await facts()).filter(([term]) => term === 'Features' || term === 'Wing'), [['Features', 'Lab and Sink'], ['Wing', 'West']]);
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.facts > div'), (line) => line.children[0].textContent).indexOf('Wing') - Array.from(document.querySelectorAll('.facts > div'), (line) => line.children[0].textContent).indexOf('Features')), 1, 'the wing comes right after the features');
    await goto(page, files.w7, '#/room/rsample301');
    assert.match(await one(page, '.facts div:nth-child(4) dd'), /^Lab(,| and) /, 'the features come first, in the school\'s order');
    assert.ok((await one(page, '.facts div:nth-child(4) dd')).includes(HOSTILE));
    assert.equal(await count(page, '.facts img'), 0, 'a feature named as markup is text');
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    await goto(page, files.plain, '#/room/rsample103');
    assert.equal(await one(page, '.facts div:nth-child(4) dd'), 'None listed', 'a room with only a wing lists no features');
    assert.deepEqual((await facts()).find(([term]) => term === 'Wing'), ['Wing', 'West']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- part-time teachers

for (const size of SIZES) {
  test('a part-time teacher\'s page at ' + size.width + ' px: the line under the name and "Not in school" in the periods it names', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.w7, '#/teacher/tsample002');
      assert.equal(await one(page, '[data-part="part-time"]'), 'Part-time: not in school in Lessons 7 to 8 when it is B Day');
      assert.equal(await page.evaluate(() => document.querySelector('h1.page__title').nextElementSibling?.dataset.part), 'part-time', 'the line is directly under the name, before the summary');
      await goto(page, files.w7, '#/teacher/tsample001');
      assert.equal(await one(page, '[data-part="part-time"]'), 'Part-time: not in school on Fridays');
      // a Friday-only entry is listed beside the periods, not taking them
      assert.ok(await count(page, '[data-also="away"]') > 0);
      assert.ok((await texts(page, '[data-also="away"]')).every((words) => words === 'Not in school on Fridays'));
      // Ms. Oyelaran is not in school in the fifth period on A Day: that row says so
      await goto(page, files.w7, '#/teacher/tsample005');
      assert.equal(await one(page, '[data-part="part-time"]'), 'Part-time: not in school in Lessons 2 to 3 and Lesson 5 when it is A Day');
      const rows = await texts(page, '.day[data-today="true"] .row');
      assert.match(rows[4], /Not in school/, 'the fifth period: ' + rows[4]);
      assert.doesNotMatch(rows[3], /Not in school/);
      await noOverflow(page, 'teacher at ' + size.width);
      // a teacher with none has no line
      await goto(page, files.w7, '#/teacher/tsample003');
      assert.equal(await count(page, '[data-part="part-time"]'), 0);
      assert.equal((await texts(page, '.row')).some((row) => /Not in school/.test(row)), false);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('the sample as published today has no part-time line and no "Not in school" anywhere on a teacher page', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    for (const id of ['tsample001', 'tsample002', 'tsample005']) {
      await goto(page, files.plain, '#/teacher/' + id);
      assert.equal(await count(page, '[data-part="part-time"]'), 0);
      assert.doesNotMatch(await one(page, 'main'), /Not in school|Part-time/);
    }
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- an away teacher is left out

test('Free right now leaves a teacher who is not in school out of the period they are away', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.w7, '#/free');
    await freeReady(page);
    const names = await texts(page, '[data-list="teachers"] .list__name');
    assert.equal(names.includes('Ms. Oyelaran'), false, 'away in this period on A Day');
    assert.equal(names.includes('Mr. Castellanos'), true, 'her colleague is free');
    await goto(page, files.plain, '#/free');
    await freeReady(page);
    assert.equal((await texts(page, '[data-list="teachers"] .list__name')).includes('Ms. Oyelaran'), true, 'on the plain sample she is free');
  } finally {
    await session.close();
  }
});

// The periods a Common planning card marks as every teacher free, and its
// sentence, for the card that holds day type `day`.
const commonOf = (page, day) => page.evaluate((id) => {
  const card = Array.from(document.querySelectorAll('[data-out="common"] .card')).find((el) => el.dataset.days.split(' ').includes(id));
  return card ? { periods: Array.from(card.querySelectorAll('tr[data-all="true"]'), (el) => el.dataset.period), sentence: card.querySelector('[data-common="sentence"]').textContent.replace(/\s+/g, ' ').trim() } : null;
}, day);

test('Common planning leaves a teacher who is not in school out of the periods they are away', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.w7, '#/common?t=tsample005,tsample006');
    const w7 = await commonOf(page, A);
    assert.ok(w7, 'an A Day card');
    assert.equal(w7.periods.includes('4'), false, 'Lesson 5 on A Day is not shared: Ms. Oyelaran is not in school then (' + w7.periods.join(' ') + ')');
    assert.equal(w7.periods.some((period) => ['1', '2'].includes(period)), false, 'nor Lessons 2 and 3');
    assert.doesNotMatch(w7.sentence, /Lesson 5\b/);
    // with no away entry (the plain sample) Lesson 5 on A Day is shared
    await goto(page, files.plain, '#/common?t=tsample005,tsample006');
    const plain = await commonOf(page, A);
    assert.ok(plain, 'an A Day card on the plain sample');
    assert.equal(plain.periods.includes('4'), true, 'Period 5 on A Day is shared when she is in school (' + plain.periods.join(' ') + ')');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Coverage says who is not in school then, in a line of its own, and does not offer them', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.w7, '#/coverage/tsample001?d=' + A);
    await page.waitForFunction(() => document.querySelector('[data-out="coverage"] .card'), { timeout: 10000 });
    const lines = await texts(page, '[data-coverage="away"]');
    assert.ok(lines.length > 0, 'a line for the away teacher');
    assert.ok(lines.every((line) => line === 'Ms. Oyelaran is not in school then.'), lines.join(' | '));
    const offered = await texts(page, '[data-list="candidates"] .list__name');
    assert.equal(offered.some((name) => name.startsWith('Ms. Oyelaran')), false);
    const notFree = await texts(page, '[data-list="notfree"] .list__name');
    assert.equal(notFree.some((name) => name.startsWith('Ms. Oyelaran')), false, 'she is in the line, not in the list of the busy');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-out="coverage"] .card'), (el) => el.dataset.period)), ['1', '2'], 'Ms. Halloran teaches in the two periods she is away');
    await goto(page, files.plain, '#/coverage/tsample001?d=' + A);
    await page.waitForFunction(() => document.querySelector('[data-out="coverage"] .card'), { timeout: 10000 });
    assert.equal(await count(page, '[data-coverage="away"]'), 0);
  } finally {
    await session.close();
  }
});

// Ms. Halloran's entry names Fridays only (DESIGN 16.12 item 4: the staff
// browser leaves her out on Fridays by the calendar). Fri 4 Sep 2026 is an
// A Day by the rotation; at 11:40 it is the fifth period, as on Wednesday.
const FRI = '2026-09-04T15:40:00Z';

test('on a Friday, by the calendar, Free right now, Coverage and Common planning leave out the teacher away on Fridays', async () => {
  for (const [at, friday] of [[WED, false], [FRI, true]]) {
    const session = await openPage({ at });
    try {
      const { page } = session;
      const when = friday ? 'on Friday' : 'on Wednesday';
      await goto(page, files.w7, '#/free');
      await freeReady(page);
      assert.match(await one(page, '.lede[role="status"]'), /A Day/, 'A Day ' + when);
      const names = await texts(page, '[data-list="teachers"] .list__name');
      assert.equal(names.includes('Ms. Halloran'), !friday, 'Ms. Halloran is free in Lesson 5 ' + when + ': ' + names.join(', '));
      assert.equal(names.includes('Mr. Castellanos'), true, 'her colleague is free ' + when);

      // Coverage for a teacher who teaches then: she is offered on Wednesday, and on Friday is in the line of her own
      await goto(page, files.w7, '#/coverage/tsample004');
      await page.waitForFunction(() => document.querySelector('[data-out="coverage"] .card[data-period="4"]'), { timeout: 10000 });
      const offered = await texts(page, '[data-out="coverage"] .card[data-period="4"] [data-list="candidates"] .list__name');
      assert.equal(offered.some((name) => name.startsWith('Ms. Halloran')), !friday, 'offered ' + when + ': ' + offered.join(', '));
      const away = await texts(page, '[data-out="coverage"] .card[data-period="4"] [data-coverage="away"]');
      // Ms. Oyelaran is away then on every A Day; Ms. Halloran joins her in the line on a Friday only
      assert.equal(away.length, 1, 'one away line ' + when);
      assert.equal(away[0].includes('Ms. Halloran'), friday, 'the away line ' + when + ': ' + away[0]);
      assert.match(away[0], /Ms\. Oyelaran/);
      const notFree = await texts(page, '[data-out="coverage"] [data-list="notfree"] .list__name');
      assert.equal(notFree.some((name) => name.startsWith('Ms. Halloran')), false, 'never in the list of the busy ' + when);

      // Common planning: on Wednesday she and Mr. Castellanos share Lesson 5 on A Day; on Friday, nothing
      await goto(page, files.w7, '#/common?t=tsample001,tsample003');
      const common = await commonOf(page, A);
      assert.ok(common, 'an A Day card ' + when);
      if (friday) assert.deepEqual(common.periods, [], 'no shared period on A Day on a Friday');
      else assert.equal(common.periods.includes('4'), true, 'Lesson 5 on A Day is shared on Wednesday (' + common.periods.join(' ') + ')');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  }
});

// ---------------------------------------------------------------- the stairwell

// The map writes a stairs cell's letter where a cell is 10 px or more across
// (staff/map.js), which a 40-cell floor is at 1280 px and is not at 390: the
// letters are read at 1280, the written way at both sizes.
test('a three-stop stairwell is drawn on each floor of the staff map as one letter W (1280 px)', async () => {
  const session = await openPage({ size: SIZES[1] });
  try {
    const { page } = session;
    // the plan is drawn more than once as the page settles: each time, a floor's
    // first room's number is written once and a stop's letter once
    for (const [at, floor] of ['fsample001', 'fsample002', 'fsample003'].entries()) {
      // one document serves the three addresses: what was drawn before is forgotten
      await page.evaluate(() => { if (globalThis.sv2Drawn) globalThis.sv2Drawn.length = 0; });
      await goto(page, files.w7, '#/map/' + floor);
      await page.waitForFunction((id) => document.querySelector('.map')?.dataset.floor === id && document.querySelector('.map canvas'), { timeout: 10000 }, floor);
      await page.waitForFunction(() => globalThis.sv2Drawn.includes('101') || globalThis.sv2Drawn.includes('201') || globalThis.sv2Drawn.includes('301'), { timeout: 10000 });
      const drawn = await page.evaluate(() => globalThis.sv2Drawn.slice());
      assert.ok(drawn.includes('W'), 'the letter W is drawn on floor ' + (at + 1) + ': ' + drawn.join(' '));
      assert.equal(drawn.filter((text) => text === 'W').length, drawn.filter((text) => text === String((at + 1) * 100 + 1)).length, 'one badge for the stop, not one for each flight, on floor ' + (at + 1) + ': ' + drawn.join(' '));
      assert.equal(drawn.includes('A') || drawn.includes('B'), false, 'neither flight\'s own letter, on floor ' + (at + 1));
    }
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

for (const size of SIZES) {
  test('Directions through the three-stop stairwell at ' + size.width + ' px says stairs W, once, and that the way stays on them past Floor 2', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.w7, '#/directions?from=rsample101&to=rsample303');
      await page.waitForFunction(() => document.querySelector('[data-directions="floors"] li'), { timeout: 10000 });
      const floors = await texts(page, '[data-directions="floors"] li');
      assert.deepEqual(floors, ['Floor 1, then stairs W', 'Floor 2, stays on stairs W', 'Floor 3, where the walk ends']);
      assert.match(await one(page, '.page__body > .lede'), /2 flights of stairs/);
      const steps = (await texts(page, 'ol li')).join(' | ');
      assert.match(steps, /stairs W up to Floor 3/);
      assert.doesNotMatch(steps, /stairs [AB]\b/);
      await noOverflow(page, 'Directions at ' + size.width);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

// ---------------------------------------------------------------- axe

const AXE_PAGES = [
  ['#/free?features=' + FEATURE.lab, 'free'],
  ['#/room/rsample103', 'room'],
  ['#/teacher/tsample005', 'teacher'],
  ['#/coverage/tsample001?d=' + A, 'coverage'],
];

for (const size of SIZES) {
  for (const theme of ['light', 'dark']) {
    test('the W7 pages at ' + size.width + ' px, ' + theme + ': axe passes, nothing runs off the side, and what is tapped is big enough', async () => {
      const session = await openPage({ size, theme });
      try {
        const { page } = session;
        for (const [to, view] of AXE_PAGES) {
          await goto(page, files.w7, to);
          if (view === 'free') await freeReady(page);
          if (view === 'coverage') await page.waitForFunction(() => document.querySelector('[data-out="coverage"] .card'), { timeout: 10000 });
          const name = to + ' at ' + size.width + ' px, ' + theme;
          await axe(page, name);
          await noOverflow(page, name);
          const small = await page.evaluate(() => Array.from(document.querySelectorAll('.page a.list__link, .page button, .page select, .page input:not([type="radio"]):not([type="checkbox"])'), (el) => [el, el.getBoundingClientRect()]).filter(([, rect]) => rect.width > 0 && rect.height < 44).map(([el, rect]) => el.tagName.toLowerCase() + '.' + el.className + ' ' + Math.round(rect.height)));
          assert.deepEqual(small, [], name + ' has something under 44 px to tap');
        }
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });
  }
}
