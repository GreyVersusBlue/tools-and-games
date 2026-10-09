// What a reader keeps and takes away from the staff browser, driven in
// Chromium from a published file on disk: node test/browser/staff-outputs.mjs
//
//   My schedule and notes (kept per school on the device), paper for every
//   view, the schedule as a lock-screen image, the door sign, and what the
//   earlier views owed: the route on the map in Directions, a room's
//   surroundings on Where right now and the substitute plan, Share and Print
//   under every page.
//
// First in plain Node: the notes as they are kept and put right, the image's
// layout as a list of what is written where, the map's route and crop. Then
// the file itself, assembled here exactly as the planner assembles it and
// opened from file://, the way test/browser/staff-views-b.mjs does, with the
// clock pinned through `sv2StaffClock` and the browser's zone set to New York.
//
// Paper is checked with the print media emulated and the computed styles
// read, not from a PDF. The names asserted are the sample school's
// (data/sample-school.js), written out here by hand.

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
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { MODULES } from '../../staff/manifest.js';
import { openSchool } from '../../staff/model.js';
import { openStorage } from '../../staff/storage.js';
import { ME_KEY, NOTES_KEY, NOTES_KEPT_SENTENCE, notesFrom, readNotes, noteOf, writeNote, meOf, isMe, chooseMe, forgetMe } from '../../staff/notes.js';
import { LOCK_WIDTH, LOCK_HEIGHT, LOCK_TOP, LOCK_BOTTOM, lockScreenLayout, imageName } from '../../staff/outputs.js';
import { MAP_REACH, planOf, floorExtentOf, aroundExtentOf, routeOnFloor } from '../../staff/map.js';
import { dayKindsOf } from '../../staff/views/teacher.js';
import { signFit } from '../../staff/views/door-sign.js';
import { ME_CHOOSE_SENTENCE } from '../../staff/me.js';
import * as clockModule from '../../staff/clock.js';
import * as teacherModule from '../../staff/views/teacher.js';
import * as pageModule from '../../staff/page.js';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const SCHOOL_ID = 'psample001';
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';
const ZONE = 'America/New_York';
const ME_AT = 'sv2staff:' + SCHOOL_ID + ':me';
const NOTES_AT = 'sv2staff:' + SCHOOL_ID + ':notes';

// New York is four hours behind UTC in September.
const AT_0950 = '2026-09-01T13:50:00Z'; // A Day: Period 3 (9:44 to 10:32)
const AT_2230 = '2026-09-02T02:30:00Z'; // 2 September in UTC, still 1 September in New York

const future = () => new Date('2999-01-01T12:00:00Z');
const later = () => new Date('2999-02-01T12:00:00Z');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-outputs-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, change, clock) {
  const project = sampleSchool();
  project.publish.passcode = '';
  if (change) change(project);
  const published = await publishDocument(read, project, { clock: clock || future, random: seededRandom('staff-outputs ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href, model: published.model };
  return files[name];
}

// ---------------------------------------------------------------- plain Node

const sample = openSchool(publishedModel(sampleSchool(), { clock: () => new Date('2026-09-12T12:00:00Z') }));

function memoryBackend() {
  const kept = new Map();
  return {
    kept,
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => { kept.set(key, String(value)); },
    removeItem: (key) => { kept.delete(key); },
  };
}

test('notes are kept under the school\'s own key, as typed, and an empty note is taken away', () => {
  const backend = memoryBackend();
  const store = openStorage(SCHOOL_ID, () => backend);
  assert.deepEqual(readNotes(store), {});
  writeNote(store, ['dsample00a'], 1, HOSTILE);
  assert.deepEqual(Array.from(backend.kept.keys()), [NOTES_AT]);
  assert.deepEqual(JSON.parse(backend.kept.get(NOTES_AT)), { dsample00a: { 1: HOSTILE } });
  assert.equal(noteOf(readNotes(store), 'dsample00a', 1), HOSTILE, 'the note comes back character for character');
  assert.equal(noteOf(readNotes(store), 'dsample00a', 2), '');
  assert.equal(noteOf(readNotes(store), 'dsample00b', 1), '');
  // one card standing for two day types keeps the note against both
  writeNote(store, ['dsample00a', 'dsample00b'], 4, 'Hall duty');
  assert.deepEqual(readNotes(store), { dsample00a: { 1: HOSTILE, 4: 'Hall duty' }, dsample00b: { 4: 'Hall duty' } });
  writeNote(store, ['dsample00a', 'dsample00b'], 4, '');
  assert.deepEqual(readNotes(store), { dsample00a: { 1: HOSTILE } });
  writeNote(store, ['dsample00a'], 1, '');
  assert.equal(backend.kept.has(NOTES_AT), false, 'with no note left the key is gone');
});

test('whatever was kept is read as the notes it still holds', () => {
  assert.deepEqual(notesFrom(null), {});
  assert.deepEqual(notesFrom('not json {'), {});
  assert.deepEqual(notesFrom('[1,2]'), {});
  assert.deepEqual(notesFrom('"text"'), {});
  assert.deepEqual(notesFrom(JSON.stringify({ d1: 5, d2: null, d3: ['x'], d4: { 0: 'kept', 1: '', 2: 7, x: 'no period', 3: { deep: true } } })), { d4: { 0: 'kept' } });
});

test('who the reader is and their notes belong to one school: another school\'s file sees neither', () => {
  const backend = memoryBackend();
  const mine = { school: sample, store: openStorage(SCHOOL_ID, () => backend) };
  const other = { school: sample, store: openStorage('pother0001', () => backend) };
  chooseMe(mine, 'tsample001');
  writeNote(mine.store, ['dsample00a'], 0, 'Mine');
  assert.equal(backend.kept.get(ME_AT), 'tsample001');
  assert.equal(meOf(mine).name, 'Ms. Halloran');
  assert.equal(isMe(mine, 'tsample001'), true);
  assert.equal(isMe(mine, 'tsample002'), false);
  assert.equal(meOf(other), null);
  assert.deepEqual(readNotes(other.store), {});
  writeNote(other.store, ['dsample00a'], 0, 'Theirs');
  assert.equal(noteOf(readNotes(mine.store), 'dsample00a', 0), 'Mine');
  chooseMe(mine, 'tnobody000');
  assert.equal(backend.kept.get(ME_AT), 'tsample001', 'an id that names nobody is not kept');
  forgetMe(mine);
  assert.equal(backend.kept.has(ME_AT), false);
  assert.equal(meOf(mine), null);
  assert.equal(ME_KEY, 'me');
  assert.equal(NOTES_KEY, 'notes');
});

test('a choice that names nobody in this copy reads as nobody and is left where it is', () => {
  const backend = memoryBackend();
  backend.setItem(ME_AT, 'tgone00001');
  const ctx = { school: sample, store: openStorage(SCHOOL_ID, () => backend) };
  assert.equal(meOf(ctx), null);
  assert.equal(backend.kept.get(ME_AT), 'tgone00001', 'the next copy may have that teacher again');
});

const halloran = sample.teacher('tsample001');
const halloranKinds = dayKindsOf(sample, (dayType) => sample.teacherDay('tsample001', dayType.id));

test('the lock-screen image says who, both day types, the school and the publish date, and nothing else', () => {
  const layout = lockScreenLayout(sample, halloran, halloranKinds, { locale: 'en-GB', zone: 'UTC' });
  assert.equal(layout.width * 3, LOCK_WIDTH);
  assert.equal(layout.height * 3, LOCK_HEIGHT);
  assert.equal(LOCK_WIDTH + ' by ' + LOCK_HEIGHT, '1170 by 2532');
  const texts = layout.items.filter((item) => item.kind === 'text').map((item) => item.text);
  const day = (name, times, whats) => [name].concat(...times.map((time, period) => [String(period + 1), time, whats[period]]));
  assert.deepEqual(texts, [
    'Ms. Halloran',
    'Mathematics · Room 101',
    ...day('A Day', ['8:00 AM', '8:52 AM', '9:44 AM', '10:36 AM', '11:28 AM', '12:20 PM', '1:12 PM', '2:04 PM'], ['Planning', '8B · 101', '6A · 101', 'Planning', 'Planning', 'Planning', 'Planning', 'Planning']),
    ...day('B Day', ['8:20 AM', '9:12 AM', '10:04 AM', '10:56 AM', '11:48 AM', '12:40 PM', '1:32 PM', '2:24 PM'], ['Planning', '7B · 101', 'Planning', 'Planning', 'Planning', 'Planning', '7A · 101', '8A · 101']),
    SCHOOL,
    'Published 12 September 2026',
  ], 'every word on the image; a clock or a "made on" line would be one more');
  // the two day types stand side by side
  const heads = layout.items.filter((item) => item.text === 'A Day' || item.text === 'B Day');
  assert.equal(heads[0].y, heads[1].y);
  assert.ok(heads[1].x > heads[0].x + 100);
});

test('the image leaves the lock screen\'s clock and buttons clear, however long the day', () => {
  const check = (layout, name) => {
    const texts = layout.items.filter((item) => item.kind === 'text');
    for (const item of texts) {
      assert.ok(item.y - item.size >= LOCK_TOP - 1, name + ': "' + item.text + '" is in the clock\'s place');
      assert.ok(item.size >= 7, name + ': "' + item.text + '" is set at ' + item.size);
      assert.ok(item.x >= 0 && item.x + (item.align === 'center' ? 0 : item.fit) <= layout.width + 0.5, name + ': "' + item.text + '" runs off the side');
    }
    const rows = texts.slice(0, -2);
    for (const item of rows) assert.ok(item.y <= LOCK_BOTTOM, name + ': "' + item.text + '" is in the buttons\' place');
    const foot = texts.slice(-2);
    assert.ok(foot.every((item) => item.align === 'center' && item.fit <= 230 && item.y > LOCK_BOTTOM), name + ': the school and the date sit between the two buttons');
  };
  check(lockScreenLayout(sample, halloran, halloranKinds), 'the sample');

  // sixteen periods and five kinds of day: two bands of columns
  const long = {
    name: 'Long Day School',
    data: { publishedAt: '2026-09-12T12:00:00Z' },
    subject: () => null,
    room: () => null,
    roomName: () => 'a room with no number',
    group: () => ({ name: 'Group with a long name' }),
    periodLabel: (index) => String(index + 1),
    time: (value) => value,
    bells: () => Array.from({ length: 16 }, (unused, period) => ({ start: String(period + 7).padStart(2, '0') + ':00', end: String(period + 7).padStart(2, '0') + ':50' })),
    teacherDay: () => Array.from({ length: 16 }, (unused, period) => ({ period, kind: 'teaching', groups: [{ groupId: 'g', roomId: null, roomText: 'Annex 12' }] })),
  };
  const kinds = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ first: { id: 'd' + name }, dayTypes: [{ id: 'd' + name, name: name + ' Day' }] }));
  const layout = lockScreenLayout(long, { id: 't', name: 'A Teacher', subjectId: null, roomIds: [] }, kinds);
  check(layout, 'sixteen periods, five day types');
  const heads = layout.items.filter((item) => / Day$/.test(item.text));
  assert.deepEqual(heads.map((item) => item.text), ['A Day', 'B Day', 'C Day', 'D Day', 'E Day']);
  assert.equal(new Set(heads.map((item) => item.y)).size, 2, 'three columns, then two under them');
  assert.equal(layout.items.filter((item) => item.text === 'Group with a long name · Annex 12').length, 80);
});

test('a name is on the image as typed, and the file is named in letters and digits only', () => {
  const data = publishedModel(sampleSchool(), { clock: () => new Date('2026-09-12T12:00:00Z') });
  data.teachers[0].name = HOSTILE;
  data.settings.schoolName = HOSTILE + ' S';
  const school = openSchool(data);
  const layout = lockScreenLayout(school, school.teacher('tsample001'), dayKindsOf(school, (dayType) => school.teacherDay('tsample001', dayType.id)));
  assert.equal(layout.items[0].text, HOSTILE);
  assert.ok(layout.items.some((item) => item.text === HOSTILE + ' S'));
  assert.equal(imageName('Ms. Halloran'), 'ms-halloran-schedule.png');
  assert.equal(imageName(HOSTILE), 'img-src-x-onerror-window-pwned-1-script-b-ünï-東京-schedule.png');
  assert.equal(imageName('../../etc/passwd'), 'etc-passwd-schedule.png');
  assert.equal(imageName('   '), 'teacher-schedule.png');
});

test('a route is cut into its line on each floor, from the first room\'s door to the last', () => {
  const found = sample.route('rsample101', 'rsample303');
  assert.equal(found.ok, true);
  const lines = sample.floors.map((floor) => routeOnFloor(found, floor.id));
  assert.deepEqual(lines.map((each) => each.length), [1, 1, 1]);
  assert.deepEqual(lines.map((each) => each[0].cells.length), [12, 24, 32]);
  assert.deepEqual(lines.map((each) => [each[0].starts, each[0].ends]), [[true, false], [false, false], [false, true]]);
  assert.equal(lines[0][0].cells[0], found.from.cell, 'the line starts inside the first room');
  assert.equal(lines[2][0].cells[31], found.to.cell, 'and ends inside the last');
  assert.deepEqual(lines[0][0].cells.slice(1), found.cells.filter((step) => step.floorId === 'fsample001').map((step) => step.cell));
  // one floor: the line starts and ends on it
  const near = routeOnFloor(sample.route('rsample101', 'rsample102'), 'fsample001');
  assert.deepEqual([near.length, near[0].starts, near[0].ends], [1, true, true]);
  assert.deepEqual(routeOnFloor(sample.route('rsample101', 'rsample102'), 'fsample002'), []);
  assert.deepEqual(routeOnFloor(sample.route('rsample101', 'rsample101'), 'fsample001'), [], 'the same room has no line');
  assert.deepEqual(routeOnFloor({ ok: false, reason: 'unreachable' }, 'fsample001'), []);
  assert.deepEqual(routeOnFloor(null, 'fsample001'), []);
});

test('"around a room" is the room and seven cells each way, never past what is drawn', () => {
  const floor = sample.floor('fsample001');
  assert.equal(MAP_REACH, 7);
  assert.deepEqual(floorExtentOf(floor), { x: 0, y: 0, w: 41, h: 15 });
  assert.deepEqual(aroundExtentOf(floor, 'rsample101', 3), { x: 0, y: 0, w: 9, h: 10 });
  const part = aroundExtentOf(floor, 'rsample101');
  assert.ok(part.w < 41 && part.w >= 9, 'a part of the floor: ' + JSON.stringify(part));
  assert.deepEqual(aroundExtentOf(floor, 'rsample101', 500), floorExtentOf(floor), 'a reach past the floor is the floor');
  assert.equal(aroundExtentOf(floor, 'rsample201', 3), null, 'a room on another floor');
  // the picture is of that part: its cells are larger than the whole floor's
  const whole = planOf(floor, 358, 1, 0);
  const close = planOf(floor, 358, 1, 0, part);
  assert.ok(close.cell > whole.cell * 1.5, whole.cell + ' px a cell for the floor, ' + close.cell + ' around the room');
  assert.deepEqual(close.extent, part);
});

test('the sign\'s number is set smaller only when it is longer than a number is', () => {
  assert.equal(signFit('204'), 1);
  assert.equal(signFit('B12'), 1);
  assert.equal(signFit('Gym 2'), 1);
  assert.equal(signFit('Cafeteria'), 7 / 9);
  assert.equal(signFit('東京東京東京東京'), 7 / 8, 'counted in characters, not in bytes');
  assert.equal(signFit('x'.repeat(60)), 0.3);
  assert.equal(signFit(''), 1);
});

test('the debts are settled: one of each pair, Share in page.js, the engine\'s answers through the school', () => {
  assert.equal('sameDayTypes' in clockModule, false, 'dayKindsOf is the one rule for "the same day"');
  assert.equal('shareRow' in clockModule, false);
  assert.equal(typeof pageModule.shareRow, 'function');
  assert.equal('teacherDaysOn' in teacherModule, false, 'everyTeacherDay is the one "every teacher\'s day"');
  assert.equal(typeof clockModule.everyTeacherDay, 'function');
  assert.equal(typeof teacherModule.dayKindsOf, 'function');
  assert.equal(sample.parseTime('08:30'), 510);
  assert.equal(sample.parseTime('8.30'), null);
  assert.equal(sample.formatDuration(259), '4 min 19 s');
  assert.deepEqual([0, 2, 7].map((period) => sample.periodLabel(period)), ['1', '3', '8']);
  // no view asks the engine itself: only the school, the shell and the reader of the file do
  const asks = [];
  for (const id of MODULES.filter((module) => module.startsWith('staff/'))) {
    if (/from '(\.\.\/)+engine\//.test(readFileSync(path.join(TOOL_DIR, ...id.split('/')), 'utf8'))) asks.push(id);
  }
  assert.deepEqual(asks, ['staff/source.js', 'staff/model.js', 'staff/shell.js']);
});

test('the paper rules are in the one stylesheet, inside @media print, with their classes listed at its top', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'staff', 'staff.css'), 'utf8').replace(/\r\n?/g, '\n');
  const page = readFileSync(path.join(TOOL_DIR, 'staff', 'index.html'), 'utf8');
  assert.equal(page.split('rel="stylesheet"').length, 2, 'one stylesheet: the baseline hashes one');
  const top = css.slice(0, css.indexOf('*/'));
  for (const name of ['.facts', '.days', '.part', '.mapbox', '.split__side', '.print-only', '.page__outputs', '.outputs', '.row__note', '.note__paper', '.sheet', '.sign__number']) {
    assert.ok(top.includes(name), name + ' is not in the list at the top of staff.css');
  }
  const block = css.slice(css.indexOf('/* ---------- SV2-23:'), css.indexOf('/* ---------- SV2-23: end'));
  assert.ok(block.length > 1000);
  const screen = block.slice(0, block.indexOf('@media print'));
  assert.match(screen, /\n\.print-only \{\n  display: none;\n\}/);
  assert.ok(!/\.(bar|top|foot|btn|controls|split|days|row|card)\b[^{]*\{/.test(screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.days\[data-notes[^{]*\{/g, '').replace(/\.row__note[^{]*\{/g, '')), 'a rule outside @media print restyles something that is on screen already');
});

// ---------------------------------------------------------------- the browser

before(async () => {
  await write('open');
  await write('hostile', (project) => {
    project.settings.schoolName = HOSTILE;
    project.teachers[0].name = HOSTILE + ' T';
    project.groups[0].name = HOSTILE + ' G';
  });
  await write('bare', (project) => {
    for (const view of ['room', 'map']) project.publish.views[view] = false;
  });
  await write('other', (project) => {
    project.id = 'pother0001';
    project.settings.schoolName = 'Another School';
  });
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a profile of its own, in New York, with the clock pinned at `at`.
// `store` is put in the device's storage before anything loads. `share` is
// 'page' for a share sheet that takes a title, 'files' for one that takes a
// file as well, 'refuses' for one that says it cannot take a file, 'closed'
// for one the reader closes without sending.
async function openPage(options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = (opts.width || 390) < 900;
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme || 'light' }]);
  await page.evaluateOnNewDocument((at, share, store) => {
    globalThis.sv2StaffClock = { now: () => at, every: 3600000 };
    try {
      for (const [key, value] of Object.entries(store)) {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      }
    } catch (error) {
      // about:blank, between two openings of the file, has no storage
    }
    globalThis.sv2Printed = 0;
    globalThis.print = () => {
      globalThis.sv2Printed += 1;
    };
    globalThis.sv2Shared = [];
    globalThis.sv2Files = [];
    globalThis.sv2Downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (this.hasAttribute('download')) globalThis.sv2Downloads.push({ name: this.download, href: this.href, onPage: this.isConnected });
      else click.call(this);
    };
    if (share) {
      Object.defineProperty(navigator, 'share', { configurable: true, value: (what) => {
        if (share === 'closed') return Promise.reject(new DOMException('closed', 'AbortError'));
        globalThis.sv2Shared.push({ title: what.title, text: what.text, url: what.url, files: what.files ? what.files.map((file) => ({ name: file.name, type: file.type })) : null });
        for (const file of what.files || []) globalThis.sv2Files.push(file);
        return Promise.resolve();
      } });
    }
    if (share === 'files' || share === 'closed') Object.defineProperty(navigator, 'canShare', { configurable: true, value: (what) => Boolean(what && what.files && what.files.length > 0) });
    if (share === 'refuses') Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  }, opts.at || AT_0950, opts.share || '', opts.store || {});
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  page.on('dialog', (dialog) => {
    errors.push('a dialog opened: ' + dialog.message());
    dialog.dismiss().catch(() => {});
  });
  return { page, context, requests, errors, close: () => context.close() };
}

// What the page asked for besides itself: the fonts inside it are `data:` and
// an image it made is a `blob:` of its own; neither leaves the device.
const asked = (session, own) => session.requests.filter((url) => url !== own && !url.startsWith(own + '#') && !url.startsWith('data:') && !url.startsWith('blob:'));
const texts = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent), selector);
const text = (page, selector) => page.evaluate((s) => {
  const found = document.querySelector(s);
  return found ? found.textContent : null;
}, selector);
const count = (page, selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);
const shown = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((el) => el.getClientRects().length > 0).length, selector);
const hash = (page) => page.evaluate(() => location.hash);
const kept = (page, key) => page.evaluate((name) => localStorage.getItem(name), key);
const says = (page) => text(page, '.page__body > .lede');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

async function move(page, to, title) {
  await page.evaluate((next) => { location.hash = next; }, to);
  await page.waitForFunction((want, where) => location.hash === where && document.querySelector('h1').textContent === want, { timeout: 5000 }, title, to);
}

// Every map on the page has been drawn at the width it has now.
async function mapsDrawn(page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.map')).every((frame) => {
    const canvas = frame.querySelector('canvas');
    return frame.dataset.cell && canvas.width === Math.round(frame.clientWidth);
  }), { timeout: 5000 });
}

async function axe(page, name) {
  if (!(await page.evaluate(() => typeof globalThis.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

const PRINTED = /^Printed (1 September 2026|September 1, 2026)$/;

// ---------------------------------------------------------------- My schedule

test('My schedule: choose yourself once, and the page is yours from then on', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/me');
    assert.equal(await text(page, 'h1'), 'My schedule');
    assert.equal(await says(page), ME_CHOOSE_SENTENCE);
    assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), 'me');
    assert.equal(await count(page, '#me-who option'), 13, 'twelve teachers and "Choose your name…"');
    assert.equal(await count(page, '.day'), 0);

    // pressed with nobody chosen: said in a sentence, and nothing is kept
    await page.click('[data-me="choose"]');
    assert.equal(await text(page, '#me-says'), 'Choose your name first.');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'me-who');
    assert.equal(await kept(page, ME_AT), null);

    await page.select('#me-who', 'tsample001');
    await page.click('[data-me="choose"]');
    await page.waitForSelector('.day');
    assert.equal(await kept(page, ME_AT), 'tsample001', 'kept under the school\'s own key');
    assert.equal(await hash(page), '#/me');
    assert.equal(await text(page, 'h1'), 'My schedule');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('h1')), true, 'focus is on the new page\'s heading');
    assert.equal(await says(page), 'Ms. Halloran. Teaches 2 classes on A Day and 3 on B Day. Has 6 planning periods on A Day and 5 on B Day.');
    assert.deepEqual(await texts(page, '.day .card__title'), ['A Day', 'B Day']);
    assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), 'me');
    assert.equal(await text(page, '[data-actions="me"] .muted'), 'This is your schedule on this device.');
    assert.equal(await text(page, '[data-part="notes"] .muted'), NOTES_KEPT_SENTENCE);

    // opened again with no address: the file opens on the reader's own page, and Back does not loop
    await page.goto('about:blank');
    await goto(page, files.open.url);
    assert.equal(await hash(page), '#/teacher/tsample001');
    assert.equal(await text(page, 'h1'), 'Ms. Halloran');
    assert.equal(await count(page, '[data-me="forget"]'), 1);
    assert.equal(await count(page, '.note'), 16, 'the reader\'s own page carries the notes');

    // somebody else's page offers "This is me" and has no notes on it
    await move(page, '#/teacher/tsample003', 'Dr. Quillfeather');
    assert.deepEqual(await texts(page, '[data-actions="me"] button'), ['This is me']);
    assert.equal(await count(page, '.note'), 0);
    assert.equal(await count(page, '[data-part="notes"]'), 0);

    // "This is not me" forgets, and the page says so by what it offers
    await move(page, '#/me', 'My schedule');
    await page.click('[data-me="forget"]');
    await page.waitForSelector('#me-who');
    assert.equal(await kept(page, ME_AT), null);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.me), 'choose');
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a choice of a teacher this copy does not have is said, and the reader can choose again', async () => {
  const session = await openPage({ store: { [ME_AT]: 'tgone00001' } });
  try {
    const { page } = session;
    await goto(page, files.open.url);
    assert.equal(await hash(page), '', 'nobody to open on');
    await move(page, '#/me', 'My schedule');
    assert.match(await text(page, '[data-me="gone"]'), /^The teacher chosen on this device is not in this copy of the schedule\./);
    assert.equal(await kept(page, ME_AT), 'tgone00001', 'left as it was until the reader chooses');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Notes

test('a note is typed on the reader\'s own day card, kept as typed, and shown as typed', async () => {
  const session = await openPage({ store: { [ME_AT]: 'tsample001' } });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/me');
    assert.equal(await page.evaluate(() => document.querySelector('.days').dataset.notes), 'read');
    assert.equal(await shown(page, '.note__input'), 0, 'no field until the reader asks to edit');
    assert.equal(await shown(page, '.note'), 0, 'and an empty note takes no room');

    await page.click('[data-toggle="notes"]');
    assert.equal(await text(page, '[data-toggle="notes"]'), 'Done with notes');
    assert.equal(await page.evaluate(() => document.querySelector('[data-toggle="notes"]').getAttribute('aria-pressed')), 'true');
    assert.equal(await shown(page, '.note__input'), 16, 'a field a period, on both day types');
    const first = await page.evaluate(() => {
      const field = document.activeElement;
      return [field.className, field.getAttribute('aria-label'), field.closest('.note').dataset.note, getComputedStyle(field).fontSize, field.maxLength];
    });
    assert.deepEqual(first, ['field__input note__input', 'Note for Period 1 on A Day', 'dsample00a:0', '17px', 200]);

    // typed as a person types it, into Period 2 of A Day
    await page.focus('[data-note="dsample00a:1"] input');
    await page.keyboard.type(HOSTILE);
    assert.deepEqual(JSON.parse(await kept(page, NOTES_AT)), { dsample00a: { 1: HOSTILE } });
    assert.equal(await page.evaluate(() => document.querySelector('[data-note="dsample00a:1"] input').value), HOSTILE);
    assert.equal(await text(page, '[data-note="dsample00a:1"] .note__paper'), HOSTILE);
    assert.equal(await count(page, '.note img, .note b, .note script'), 0, 'a note is never markup');
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);

    // Enter leaves the field; "Done with notes" shows the note as text where it was typed
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
    await page.click('[data-toggle="notes"]');
    assert.equal(await text(page, '[data-toggle="notes"]'), 'Edit my notes');
    assert.equal(await shown(page, '.note__input'), 0);
    assert.equal(await shown(page, '.note'), 1, 'the one note, and no empty ones');
    const where = await page.evaluate(() => {
      const paper = document.querySelector('[data-note="dsample00a:1"] .note__paper');
      const row = paper.closest('.row');
      return [row.dataset.period, row.closest('.day').dataset.days, getComputedStyle(paper).whiteSpace, paper.getClientRects().length > 0];
    });
    assert.deepEqual(where, ['1', 'dsample00a', 'pre-wrap', true]);

    // still there when the file is opened again; and on the teacher page, which is the same person's
    await page.goto('about:blank');
    await goto(page, files.open.url);
    assert.equal(await hash(page), '#/teacher/tsample001');
    assert.equal(await text(page, '[data-note="dsample00a:1"] .note__paper'), HOSTILE);
    assert.equal(await page.evaluate(() => document.querySelector('[data-note="dsample00a:1"] input').value), HOSTILE);

    // cleared: nothing is left behind
    await page.click('[data-toggle="notes"]');
    await page.evaluate(() => {
      const field = document.querySelector('[data-note="dsample00a:1"] input');
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await kept(page, NOTES_AT), null);
    assert.equal(await page.evaluate(() => document.querySelector('[data-note="dsample00a:1"]').dataset.empty), 'true');
    assert.deepEqual(asked(session, files.open.url), [], 'a note goes nowhere');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('who the reader is and their notes survive a newer file of the same school, and another school\'s file never sees them', async () => {
  const session = await openPage();
  const first = readFileSync(files.open.file);
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/me');
    await page.select('#me-who', 'tsample007');
    await page.click('[data-me="choose"]');
    await page.waitForSelector('.day');
    await page.click('[data-toggle="notes"]');
    await page.focus('[data-note="dsample00b:3"] input');
    await page.keyboard.type('Bus duty, front doors');
    assert.match(await text(page, '.foot'), /published (1 January 2999|January 1, 2999)/);

    // the school publishes again, a month later, and the newer file is saved over the old one
    const project = sampleSchool();
    project.publish.passcode = '';
    project.teachers[6].name = 'Ms. Vandermeer-Okoro';
    const newer = await publishDocument(read, project, { clock: later, random: seededRandom('staff-outputs newer') });
    assert.equal(newer.model.id, SCHOOL_ID);
    assert.ok(newer.model.publishedAt > files.open.model.publishedAt);
    writeFileSync(files.open.file, newer.html);
    await page.goto('about:blank');
    await goto(page, files.open.url);
    assert.match(await text(page, '.foot'), /published (1 February 2999|February 1, 2999)/, 'this is the newer copy');
    assert.equal(await hash(page), '#/teacher/tsample007', 'the reader is still known');
    assert.equal(await text(page, 'h1'), 'Ms. Vandermeer-Okoro');
    assert.equal(await text(page, '[data-note="dsample00b:3"] .note__paper'), 'Bus duty, front doors', 'and the note is still on its period');
    assert.equal(await shown(page, '.note'), 1);

    // another school's file, opened on the same device
    await page.goto('about:blank');
    await goto(page, files.other.url);
    assert.equal(await text(page, '.top__school'), 'Another School');
    assert.equal(await hash(page), '', 'nobody is chosen in this school');
    await move(page, '#/me', 'My schedule');
    assert.equal(await count(page, '#me-who'), 1);
    await move(page, '#/teacher/tsample007', 'Ms. Vandermeer');
    assert.equal(await count(page, '.note'), 0);
    assert.deepEqual(await texts(page, '[data-actions="me"] button'), ['This is me']);
    await page.click('[data-me="choose"]');
    await page.waitForSelector('[data-toggle="notes"]');
    await page.click('[data-toggle="notes"]');
    await page.focus('[data-note="dsample00b:3"] input');
    await page.keyboard.type('Other school');
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.endsWith(':me') || key.endsWith(':notes')).sort());
    assert.deepEqual(keys, ['sv2staff:pother0001:me', 'sv2staff:pother0001:notes', ME_AT, NOTES_AT]);
    assert.deepEqual(JSON.parse(await kept(page, NOTES_AT)), { dsample00b: { 3: 'Bus duty, front doors' } }, 'the first school\'s note is untouched');
    assert.deepEqual(JSON.parse(await kept(page, 'sv2staff:pother0001:notes')), { dsample00b: { 3: 'Other school' } });
    assert.deepEqual(session.errors, []);
  } finally {
    writeFileSync(files.open.file, first);
    await session.close();
  }
});

// ---------------------------------------------------------------- Paper

const NOTE_ON_B4 = JSON.stringify({ dsample00b: { 3: 'Bus duty,\tfront doors <b>' } });

test('on paper a teacher\'s schedule is one sheet: the day types side by side, the note that was typed, and nothing to press', async () => {
  // a sheet of US Letter inside this file's margins is 7.4 by 9.9 inches: 710 by 950 px
  const session = await openPage({ width: 710, height: 950, at: AT_2230, store: { [ME_AT]: 'tsample007', [NOTES_AT]: NOTE_ON_B4 } });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/me');
    const look = () => page.evaluate(() => {
      const on = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0);
      const days = on('.day').map((el) => el.getBoundingClientRect());
      return {
        school: on('.top__school').map((el) => el.textContent),
        printed: on('[data-printed="date"]').map((el) => el.textContent),
        heading: on('h1').map((el) => el.textContent),
        days: days.length,
        sideBySide: days.length === 2 && Math.abs(days[0].top - days[1].top) < 1 && days[1].left >= days[0].right,
        pressed: on('.app button, .app a.btn, .app select, .app input').length,
        bar: on('.bar').length,
        map: on('.map').length,
        lists: on('.part').length,
        notes: on('.note__paper').map((el) => el.textContent),
        emptyNotes: on('.note[data-empty="true"]').length,
        foot: on('.foot').length,
        bottom: Math.round(document.querySelector('.foot').getBoundingClientRect().bottom + window.scrollY),
        paper: getComputedStyle(document.body).backgroundColor,
      };
    });
    await mapsDrawn(page);
    const screen = await look();
    assert.equal(screen.printed.length, 0, 'the printed-date line is paper\'s only');
    assert.equal(screen.bar, 1);
    assert.ok(screen.pressed > 3);

    await page.emulateMediaType('print');
    await pause(100);
    const paper = await look();
    assert.deepEqual(paper.school, [SCHOOL], 'headed by the school');
    assert.equal(paper.printed.length, 1);
    assert.match(paper.printed[0], PRINTED, 'the date is the reader\'s own day: in UTC it is already the 2nd');
    assert.deepEqual(paper.heading, ['My schedule']);
    assert.equal(paper.days, 2);
    assert.equal(paper.sideBySide, true, 'both day types side by side');
    assert.equal(paper.pressed, 0, 'no button, link-button, picker or field');
    assert.equal(paper.bar, 0);
    assert.equal(paper.map, 0, 'the schedule and only the schedule');
    assert.equal(paper.lists, 0);
    assert.deepEqual(paper.notes, ['Bus duty,\tfront doors <b>'], 'the note prints as typed');
    assert.equal(paper.emptyNotes, 0, 'an empty note prints nothing');
    assert.equal(paper.foot, 1);
    assert.ok(paper.bottom <= 950, 'the sheet ends at ' + paper.bottom + ' px of 950');
    assert.equal(paper.paper, 'rgb(255, 255, 255)');

    // the same while the notes are being edited: a field never prints
    await page.emulateMediaType('screen');
    await page.click('[data-toggle="notes"]');
    assert.equal(await shown(page, '.note__input'), 16);
    await page.emulateMediaType('print');
    await pause(100);
    const editing = await look();
    assert.equal(editing.pressed, 0);
    assert.deepEqual(editing.notes, ['Bus duty,\tfront doors <b>']);
    assert.equal(editing.emptyNotes, 0);

    // back on screen everything is as it was
    await page.emulateMediaType('screen');
    await page.click('[data-toggle="notes"]');
    await mapsDrawn(page);
    const back = await look();
    assert.deepEqual(back, screen, JSON.stringify(back) + ' after, ' + JSON.stringify(screen) + ' before');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('paper is light when the screen is dark, and the screen is unchanged by the paper rules', async () => {
  const session = await openPage({ width: 1280, height: 900, theme: 'dark' });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/room/rsample101');
    await mapsDrawn(page);
    const read = () => page.evaluate(() => {
      const canvas = document.querySelector('.map canvas');
      const pixel = canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
      const title = document.querySelector('.page__title');
      return {
        body: getComputedStyle(document.body).backgroundColor,
        ink: getComputedStyle(document.body).color,
        grid: Array.from(pixel).slice(0, 3).join(','),
        // the heading is the first thing in the page, flush with the top of the page's own box
        // (measured from the box: a margin on the heading would move the article with it)
        headingTop: Math.round(title.getBoundingClientRect().top - document.querySelector('.page').getBoundingClientRect().top - parseFloat(getComputedStyle(document.querySelector('.page')).paddingTop)),
        printed: getComputedStyle(document.querySelector('[data-printed="date"]')).display,
        side: getComputedStyle(document.querySelector('.split__side')).position,
        split: getComputedStyle(document.querySelector('.split')).display,
        font: getComputedStyle(document.documentElement).fontSize,
      };
    });
    const screen = await read();
    assert.deepEqual(screen, { body: 'rgb(21, 24, 28)', ink: 'rgb(232, 230, 225)', grid: '26,30,35', headingTop: 0, printed: 'none', side: 'sticky', split: 'grid', font: '16px' });
    await page.emulateMediaType('print');
    await page.waitForFunction(() => Array.from(document.querySelector('.map canvas').getContext('2d').getImageData(2, 2, 1, 1).data).slice(0, 3).join(',') === '232,227,216', { timeout: 5000 });
    const paper = await read();
    assert.equal(paper.body, 'rgb(255, 255, 255)');
    assert.equal(paper.ink, 'rgb(31, 35, 40)');
    assert.equal(paper.grid, '232,227,216', 'the floor plan is drawn again in the light colours');
    assert.equal(paper.printed, 'block');
    assert.equal(paper.split, 'block');
    await page.emulateMediaType('screen');
    // this Puppeteer forgets the emulated colour scheme when the media type is set, so it is set again
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.waitForFunction(() => Array.from(document.querySelector('.map canvas').getContext('2d').getImageData(2, 2, 1, 1).data).slice(0, 3).join(',') === '26,30,35', { timeout: 5000 });
    assert.deepEqual(await read(), screen);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

const PAPER_PAGES = [
  ['#/teacher/tsample003', 'Dr. Quillfeather'],
  ['#/group/gsample06a', '6A'],
  ['#/room/rsample203', 'Room 203'],
  ['#/map/fsample001', 'Building map: Floor 1'],
  ['#/staffing', 'Staffing'],
  ['#/free', 'Free right now'],
  ['#/now?g=gsample06a', 'Where right now'],
  ['#/common?t=tsample001,tsample002', 'Common planning'],
  ['#/coverage/tsample003', 'Coverage: Dr. Quillfeather'],
  ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather'],
  ['#/directions?from=rsample101&to=rsample303', 'Directions'],
  ['#/search', 'Search'],
  ['#/me', 'My schedule'],
  // the one page whose only thing to press is a link-button in a plain paragraph
  ['#/teacher/tnobody000', 'Not in this schedule', 'Teacher'],
];

test('on paper every view is one plain column headed by the school, what the page is and the date, with nothing to press', async () => {
  const session = await openPage({ width: 1280, height: 900 });
  try {
    const { page } = session;
    await goto(page, files.open.url);
    for (const [address, title] of PAPER_PAGES) {
      await page.emulateMediaType('screen');
      await move(page, address, title);
      await page.emulateMediaType('print');
      await pause(60);
      const paper = await page.evaluate(() => {
        const on = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0);
        // the column: what is directly in the page, and directly in a page-and-map pair
        const column = on('.page__body > *').flatMap((el) => (el.classList.contains('split') ? Array.from(el.children).filter((child) => child.getClientRects().length > 0) : [el]));
        const rects = column.map((el) => el.getBoundingClientRect());
        return {
          school: on('.top__school').map((el) => el.textContent),
          printed: on('[data-printed="date"]').map((el) => el.textContent),
          heading: on('h1').map((el) => el.textContent),
          pressed: on('.app button, .app a.btn, .app select, .app input:not(#sub-date)').map((el) => el.tagName + '.' + el.className),
          bar: on('.bar').length,
          bands: on('.bands').length,
          foot: on('.foot').length,
          parts: column.length,
          lefts: Array.from(new Set(rects.map((rect) => Math.round(rect.left)))),
          stacked: rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom - 0.5),
        };
      });
      assert.deepEqual(paper.school, [SCHOOL], address);
      assert.equal(paper.printed.length, 1, address);
      assert.match(paper.printed[0], PRINTED, address);
      assert.deepEqual(paper.heading, [title], address);
      assert.deepEqual(paper.pressed, [], address + ' prints something to press');
      assert.deepEqual([paper.bar, paper.bands, paper.foot], [0, 0, 1], address);
      assert.ok(paper.parts >= 3, address + ' prints ' + paper.parts + ' parts');
      assert.equal(paper.lefts.length, 1, address + ' is not one column: its parts start at ' + paper.lefts.join(', '));
      assert.equal(paper.stacked, true, address + ' has parts side by side');
    }
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- The lock-screen image

// The PNG the page made: its first bytes, its size from the header, and what
// is drawn in the clock's place and in the middle.
const readImage = (page, from) => page.evaluate(async (source, top) => {
  const blob = source === 'shared' ? globalThis.sv2Files[0] : await (await fetch(globalThis.sv2Downloads[0].href)).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  const paper = Array.from(g.getImageData(0, 0, 1, 1).data).join(',');
  const marks = (y0, y1) => {
    const data = g.getImageData(0, y0, canvas.width, y1 - y0).data;
    let found = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] + ',' + data[at + 1] + ',' + data[at + 2] + ',' + data[at + 3] !== paper) found += 1;
    }
    return found;
  };
  return {
    type: blob.type,
    signature: Array.from(bytes.slice(0, 8)).join(' '),
    width: view.getUint32(16),
    height: view.getUint32(20),
    paper,
    inClock: marks(0, top * 3 - 6),
    inMiddle: marks(top * 3, 2100),
  };
}, from, LOCK_TOP);

test('"Download as image" hands a 1170 by 2532 picture of the schedule to the share sheet where it takes a file', async () => {
  const session = await openPage({ share: 'files' });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/teacher/tsample001');
    assert.equal(await text(page, '[data-output="image"]'), 'Download as image');
    await page.click('[data-output="image"]');
    await page.waitForFunction(() => globalThis.sv2Shared.length === 1, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => globalThis.sv2Shared), [{ title: 'Ms. Halloran · ' + SCHOOL, files: [{ name: 'ms-halloran-schedule.png', type: 'image/png' }] }]);
    await page.waitForFunction(() => document.querySelector('[data-says="image"]').textContent.startsWith('Shared.'), { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelector('[data-says="image"]').getAttribute('role')), 'status');
    assert.deepEqual(await page.evaluate(() => globalThis.sv2Downloads), [], 'shared, so not downloaded as well');
    const image = await readImage(page, 'shared');
    assert.equal(image.type, 'image/png');
    assert.equal(image.signature, '137 80 78 71 13 10 26 10', 'a PNG');
    assert.deepEqual([image.width, image.height], [1170, 2532], 'a phone\'s lock screen, whatever the device\'s own pixel ratio');
    assert.equal(image.paper, '246,243,236,255', 'the page\'s paper colour');
    assert.equal(image.inClock, 0, 'nothing is drawn where the lock screen puts its clock');
    assert.ok(image.inMiddle > 20000, 'the schedule is drawn in the middle: ' + image.inMiddle + ' px of ink');
    assert.deepEqual(asked(session, files.open.url), [], 'the image is made on the device');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('where the share sheet takes no file the image is a download, and a closed share sheet is not a failure', async () => {
  for (const share of ['', 'page', 'refuses']) {
    const session = await openPage({ share, theme: 'dark' });
    try {
      const { page } = session;
      await goto(page, files.hostile.url + '#/teacher/tsample001');
      await page.click('[data-output="image"]');
      await page.waitForFunction(() => globalThis.sv2Downloads.length === 1, { timeout: 10000 });
      const name = 'img-src-x-onerror-window-pwned-1-script-b-ünï-東京-t-schedule.png';
      const got = await page.evaluate(() => globalThis.sv2Downloads[0]);
      assert.equal(got.name, name, 'the file\'s name is letters and digits, whatever the teacher is called');
      assert.match(got.href, /^blob:/);
      assert.equal(got.onPage, true);
      assert.deepEqual(await page.evaluate(() => globalThis.sv2Shared.filter((what) => what.files)), [], 'no file went to a share sheet that cannot take one (' + (share || 'no share sheet') + ')');
      await page.waitForFunction(() => document.querySelector('[data-says="image"]').textContent.startsWith('Saved as '), { timeout: 5000 });
      assert.equal(await text(page, '[data-says="image"]'), 'Saved as ' + name + '. Set it as your lock screen from your photos or files.');
      assert.equal(await count(page, 'a[download]'), 0, 'the link used for the download is taken off the page');
      const image = await readImage(page, 'saved');
      assert.deepEqual([image.type, image.width, image.height], ['image/png', 1170, 2532]);
      assert.equal(image.paper, '21,24,28,255', 'in the dark theme the image is dark');
      assert.equal(image.inClock, 0);
      assert.ok(image.inMiddle > 20000);
      assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  }
  const session = await openPage({ share: 'closed' });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/teacher/tsample001');
    await page.click('[data-output="image"]');
    await page.waitForFunction(() => document.querySelector('[data-says="image"]').textContent === '', { timeout: 10000 });
    await pause(200);
    assert.deepEqual(await page.evaluate(() => globalThis.sv2Downloads), [], 'closing the share sheet does not start a download');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- The door sign

test('the door sign is a preview of the sheet: the room large, the teacher, the subject, and the room\'s day when asked', async () => {
  const session = await openPage({ theme: 'dark' });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/room/rsample101');
    assert.equal(await page.evaluate(() => document.querySelector('[data-output="door"]').getAttribute('href')), '#/door/rsample101', 'the room\'s page leads to its sign');
    await page.click('[data-output="door"]');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Door sign: Room 101');
    assert.equal(await page.title(), 'Door sign: Room 101 · ' + SCHOOL);
    assert.equal(await says(page), 'This is the sign as it prints: one sheet for the door.');
    assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), 'search');
    assert.deepEqual(await texts(page, '.sign > p'), ['Room', '101', 'Ms. Halloran', 'Mathematics', SCHOOL]);
    assert.equal(await count(page, '[data-sign="day"]'), 0, 'the room\'s day is not on the sign until asked for');
    const sheet = await page.evaluate(() => {
      const el = document.querySelector('.sheet');
      const number = document.querySelector('.sign__number');
      const box = el.getBoundingClientRect();
      return {
        paper: getComputedStyle(el).backgroundColor,
        ink: getComputedStyle(number).color,
        share: Math.round((parseFloat(getComputedStyle(number).fontSize) / el.clientWidth) * 1000) / 10,
        shape: Math.round((box.width / box.height) * 100) / 100,
        fits: box.right <= window.innerWidth && number.scrollWidth <= number.clientWidth,
        face: getComputedStyle(number).fontFamily.split(',')[0],
      };
    });
    assert.deepEqual(sheet, { paper: 'rgb(255, 255, 255)', ink: 'rgb(31, 35, 40)', share: 22.5, shape: 0.75, fits: true, face: '"Barlow Semi Condensed"' }, 'white paper in a dark theme, the number 22.5% of the sheet\'s width (120 pt on Letter)');

    // the room's day, by the tick box; the choice is in the address
    await page.click('#door-day');
    assert.equal(await hash(page), '#/door/rsample101?day=1');
    assert.deepEqual(await texts(page, '.sign__kindname'), ['A Day', 'B Day']);
    assert.equal(await count(page, '.sign__kind:first-child tr'), 8);
    assert.deepEqual(await texts(page, '.sign__kind:first-child tr:nth-child(3) > *'), ['Period 3', '9:44 AM to 10:32 AM', '6A', 'Ms. Halloran']);
    assert.deepEqual(await texts(page, '.sign__kind:first-child tr:nth-child(1) > *'), ['Period 1', '8:00 AM to 8:48 AM', 'Empty', '']);
    const day = await page.evaluate(() => {
      const kinds = Array.from(document.querySelectorAll('.sign__kind'), (el) => el.getBoundingClientRect());
      const box = document.querySelector('.sheet').getBoundingClientRect();
      return { sideBySide: Math.abs(kinds[0].top - kinds[1].top) < 1 && kinds[1].left >= kinds[0].right, inside: kinds.every((rect) => rect.left >= box.left && rect.right <= box.right + 0.5) };
    });
    assert.deepEqual(day, { sideBySide: true, inside: true });
    await page.click('#door-day');
    assert.equal(await hash(page), '#/door/rsample101');
    assert.equal(await count(page, '[data-sign="day"]'), 0);

    // from its address, with the day; a room with a name and no number; a long name set smaller
    await move(page, '#/door/rsamplegym?day=1', 'Door sign: Gym');
    assert.equal(await page.evaluate(() => document.getElementById('door-day').checked), true);
    assert.deepEqual(await texts(page, '.sign > p'), ['Gym', 'Coach Dunmore', 'Physical Education', SCHOOL], 'no "Room" over a room that has a name');
    assert.equal(await count(page, '.sign__kind'), 2);
    await move(page, '#/door/rsamplecaf', 'Door sign: Cafeteria');
    const long = await page.evaluate(() => {
      const number = document.querySelector('.sign__number');
      return [number.textContent, number.style.getPropertyValue('--sign-fit').trim(), number.scrollWidth <= number.clientWidth, number.getClientRects().length];
    });
    assert.deepEqual(long, ['Cafeteria', String(7 / 9), true, 1]);
    assert.deepEqual(await texts(page, '.sign > p'), ['Cafeteria', SCHOOL], 'a room with no teacher and no subject has neither line');

    await move(page, '#/door/rnobody000', 'Not in this schedule');
    // a teacher's page leads to the sign of the teacher's room
    await move(page, '#/teacher/tsample004', 'Coach Dunmore');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-actions="outputs"] [data-output="door"]'), (link) => [link.textContent, link.getAttribute('href')])), [['Door sign', '#/door/rsamplegym']]);
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('on paper the door sign is the sheet and nothing else, the room number at 120 pt, on one sheet', async () => {
  const session = await openPage({ width: 710, height: 950, theme: 'dark' });
  try {
    const { page } = session;
    await goto(page, files.hostile.url + '#/door/rsample101?day=1');
    assert.equal(await text(page, '[data-sign="teacher"]'), HOSTILE + ' T', 'a name is on the sign as typed');
    assert.equal(await text(page, '[data-sign="school"]'), HOSTILE);
    assert.equal(await text(page, '.sign__kind:first-child tr:nth-child(3) td:nth-of-type(2)'), HOSTILE + ' G');
    assert.equal(await count(page, '.sign img, .sign b, .sign script'), 0);
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    await page.click('[data-print]');
    assert.equal(await page.evaluate(() => globalThis.sv2Printed), 1, '"Print the sign" asks the browser to print');

    // the sheet is measured with the sample's own names, which are the length names are
    await goto(page, files.open.url + '#/door/rsample101?day=1');
    await page.emulateMediaType('print');
    await pause(100);
    const paper = await page.evaluate(() => {
      const on = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0);
      const size = (selector) => getComputedStyle(document.querySelector(selector)).fontSize;
      const kinds = on('.sign__kind').map((el) => el.getBoundingClientRect());
      return {
        inPage: on('.page__body > *').map((el) => el.className),
        frame: on('.top, .foot, .bar, .bands, h1, .lede, [data-printed="date"]').length,
        pressed: on('.app button, .app a.btn, .app input').length,
        number: size('.sign__number'),
        word: size('.sign__word'),
        teacher: size('.sign__teacher'),
        table: size('.sign__table'),
        border: getComputedStyle(document.querySelector('.sheet')).borderTopWidth,
        sideBySide: kinds.length === 2 && Math.abs(kinds[0].top - kinds[1].top) < 1,
        rows: on('.sign__table tr').length,
        bottom: Math.round(document.querySelector('.sheet').getBoundingClientRect().bottom + window.scrollY),
        wide: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    assert.deepEqual(paper.inPage, ['sheet'], 'the sheet is all that prints');
    assert.equal(paper.frame, 0, 'no school line, heading, date, footer or bar: the sign is not a page of the schedule');
    assert.equal(paper.pressed, 0);
    assert.equal(paper.number, '160px', '120 pt');
    assert.deepEqual([paper.word, paper.teacher, paper.table], ['29.3333px', '42.6667px', '14.6667px'], '22 pt, 32 pt and 11 pt');
    assert.equal(paper.border, '0px');
    assert.equal(paper.sideBySide, true);
    assert.equal(paper.rows, 16);
    assert.equal(paper.wide, true);
    assert.ok(paper.bottom <= 950, 'the sign with the room\'s day ends at ' + paper.bottom + ' px of a 950 px sheet');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- What the earlier views owed

// The colour of the canvas at the middle of a cell of the floor shown.
const pixelAt = (page, selector, floor, cell, part) => page.evaluate((s, width, cells, index, extent) => {
  const frame = document.querySelector(s);
  const canvas = frame.querySelector('canvas');
  const size = Number(frame.dataset.cell);
  const wide = extent.w * size;
  const left = wide <= canvas.clientWidth ? (canvas.clientWidth - wide) / 2 : 0;
  const x = left + ((index % width) - extent.x + 0.5) * size;
  const y = (Math.floor(index / width) - extent.y + 0.5) * size;
  return Array.from(canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3).join(',');
}, selector, floor.width, floor.cells.length, cell, part || floorExtentOf(floor));

test('Directions draws the route on the map, floor by floor, and says the line in words', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/directions?from=rsample101&to=rsample303');
    await mapsDrawn(page);
    const map = '[data-directions="floors"] .map';
    const found = sample.route('rsample101', 'rsample303');
    const floors = sample.floors;
    assert.equal(await count(page, map), 1);
    assert.equal(await page.evaluate((s) => document.querySelector(s).closest('.mapbox').getAttribute('aria-label'), map), 'The way on the map');
    assert.deepEqual(await page.evaluate((s) => [document.querySelector(s).dataset.floor, document.querySelector(s).dataset.route], map), ['fsample001', '12'], 'it opens on the floor the walk starts on');
    assert.equal(await text(page, '[data-directions="floors"] .map__says'), 'On Floor 1 the line runs from Room 101 to stairs A.');
    const ACCENT = '15,110,102';
    // a corridor cell on the way is the line's colour; the same cell one row off the way is corridor
    const onWay = routeOnFloor(found, 'fsample001')[0].cells[5];
    assert.equal(await pixelAt(page, map, floors[0], onWay), ACCENT, 'the line runs through the corridor cell the route crosses');
    assert.notEqual(await pixelAt(page, map, floors[0], onWay + 15), ACCENT, 'and not through one it does not');
    assert.equal(await pixelAt(page, map, floors[0], found.from.cell), ACCENT, 'the dot where the walk starts, inside the first room');

    // the other floors, by the tabs
    await page.click(map.replace(' .map', '') + ' .tab[data-floor="fsample003"]');
    await page.waitForFunction((s) => document.querySelector(s).dataset.floor === 'fsample003', {}, map);
    assert.equal(await page.evaluate((s) => document.querySelector(s).dataset.route, map), '32');
    assert.equal(await text(page, '[data-directions="floors"] .map__says'), 'On Floor 3 the line runs from stairs B to Room 303.');
    assert.equal(await pixelAt(page, map, floors[2], routeOnFloor(found, 'fsample003')[0].cells[10]), ACCENT);
    await page.click(map.replace(' .map', '') + ' .tab[data-floor="fsample002"]');
    await page.waitForFunction((s) => document.querySelector(s).dataset.floor === 'fsample002', {}, map);
    assert.equal(await text(page, '[data-directions="floors"] .map__says'), 'On Floor 2 the line runs from stairs A to stairs B.');
    assert.equal(await text(page, '[data-directions="time"]'), 'The walk is ' + sample.formatDuration(found.seconds) + ' at the school\'s walking pace, for an empty corridor. Distances are in squares of the floor plan.');

    // one floor: the other floors say the way does not cross them
    await page.select('#directions-to', 'rsample102');
    await page.waitForFunction((s) => document.querySelector(s) && document.querySelector(s).dataset.route !== undefined && document.querySelector('[data-directions="floors"] li').textContent === 'Floor 1, where the walk ends', {}, map);
    await page.click(map.replace(' .map', '') + ' .tab[data-floor="fsample002"]');
    assert.equal(await text(page, '[data-directions="floors"] .map__says'), 'The way does not cross Floor 2.');
    assert.equal(await page.evaluate((s) => document.querySelector(s).dataset.route, map), '0');
    // no way at all: no map
    await page.select('#directions-to', 'rsample303');
    await page.click('#directions-stepfree');
    assert.equal(await count(page, map), 0);
    assert.deepEqual(session.errors, []);

    const bare = await openPage();
    try {
      await goto(bare.page, files.bare.url + '#/directions?from=rsample101&to=rsample303');
      assert.equal(await count(bare.page, '[data-directions="floors"] li'), 3);
      assert.equal(await count(bare.page, '.map'), 0, 'where the publisher left the map out there is no picture');
      assert.deepEqual(bare.errors, []);
    } finally {
      await bare.close();
    }
  } finally {
    await session.close();
  }
});

test('Where right now and the substitute plan show the room and what is around it', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/now?g=gsample06a');
    await mapsDrawn(page);
    const floor = sample.floor('fsample001');
    const part = aroundExtentOf(floor, 'rsample101');
    const where = await page.evaluate(() => {
      const frame = document.querySelector('[data-where="map"] .map');
      const box = frame.closest('.mapbox');
      return {
        around: frame.dataset.around,
        floor: frame.dataset.floor,
        cell: Number(frame.dataset.cell),
        label: box.getAttribute('aria-label'),
        picture: frame.querySelector('canvas').getAttribute('aria-label'),
        tabs: box.querySelectorAll('.tab').length,
        zooms: box.querySelectorAll('.map__zoom').length,
        says: box.querySelector('.map__says').textContent,
        after: frame.closest('[data-where="map"]').previousElementSibling.dataset.where,
      };
    });
    assert.equal(where.around, 'rsample101');
    assert.equal(where.floor, 'fsample001');
    assert.equal(where.label, 'Around Room 101');
    assert.equal(where.picture, 'Around Room 101: Floor 1. The rooms are listed in words on this page.');
    assert.equal(where.tabs, 0, 'a picture of one place has no floor tabs');
    assert.equal(where.zooms, 3);
    assert.equal(where.says, 'Room 101 is ringed, with what is near it on Floor 1.');
    assert.equal(where.after, 'floor', 'the picture follows the sentence that says where the room is');
    assert.ok(where.cell > 14, 'the room and its surroundings, not the whole floor: ' + where.cell + ' px a cell');
    // the ring is drawn round the room: just outside its top-left corner is the accent
    const ring = await page.evaluate((x0, y0, extent) => {
      const frame = document.querySelector('[data-where="map"] .map');
      const canvas = frame.querySelector('canvas');
      const size = Number(frame.dataset.cell);
      const wide = extent.w * size;
      const left = wide <= canvas.clientWidth ? (canvas.clientWidth - wide) / 2 : 0;
      return Array.from(canvas.getContext('2d').getImageData(Math.round(left + (x0 - extent.x) * size + size), Math.round((y0 - extent.y) * size - 1), 1, 1).data).slice(0, 3).join(',');
    }, Math.min(...sample.room('rsample101').cells.map((cell) => cell % floor.width)), Math.min(...sample.room('rsample101').cells.map((cell) => Math.floor(cell / floor.width))), part);
    assert.equal(ring, '15,110,102');

    await move(page, '#/sub/tsample003', 'Substitute plan: Dr. Quillfeather');
    await mapsDrawn(page);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sub="room"] .map'), (frame) => [frame.dataset.around, frame.closest('.mapbox').getAttribute('aria-label')])), [['rsample103', 'Around Room 103']]);
    // it prints: the picture stays, its buttons do not
    await page.emulateMediaType('print');
    await pause(100);
    assert.deepEqual([await shown(page, '[data-sub="room"] .map canvas'), await shown(page, '[data-sub="room"] .map__zoom'), await shown(page, '[data-sub="room"] .map__says')], [1, 0, 1]);
    assert.deepEqual(session.errors, []);

    const bare = await openPage();
    try {
      await goto(bare.page, files.bare.url + '#/now?g=gsample06a');
      assert.equal(await count(bare.page, '[data-where="floor"]'), 1);
      assert.equal(await count(bare.page, '.map'), 0);
      await move(bare.page, '#/sub/tsample003', 'Substitute plan: Dr. Quillfeather');
      assert.equal(await count(bare.page, '.map'), 0);
      assert.deepEqual(bare.errors, []);
    } finally {
      await bare.close();
    }
  } finally {
    await session.close();
  }
});

const EVERY_PAGE = PAPER_PAGES.concat([
  ['#/door/rsample101', 'Door sign: Room 101'],
]);

test('every page has one Share and one Print; Share gives the page\'s name and never a file address', async () => {
  const session = await openPage({ share: 'page' });
  try {
    const { page } = session;
    await goto(page, files.open.url);
    for (const [address, title] of EVERY_PAGE) {
      await move(page, address, title);
      assert.equal(await count(page, '[data-share="share"]'), 1, address + ' Share');
      assert.equal(await count(page, '[data-print]'), 1, address + ' Print');
      assert.equal(await count(page, '[data-share="copy"]'), 0, address + ': a file on disk has no link to copy');
      await page.click('[data-share="share"]');
      await page.click('[data-print]');
    }
    const shared = await page.evaluate(() => globalThis.sv2Shared);
    // what is shared is the tab's title: the view's own name for the page, then the school
    assert.deepEqual(shared.map((what) => what.title), EVERY_PAGE.map((each) => (each[2] || each[1]) + ' · ' + SCHOOL));
    assert.ok(shared.every((what) => what.text === what.title && what.url === undefined && what.files === null));
    assert.equal(await page.evaluate(() => globalThis.sv2Printed), EVERY_PAGE.length);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
  const plain = await openPage();
  try {
    await goto(plain.page, files.open.url + '#/group/gsample06a');
    assert.equal(await count(plain.page, '[data-actions="share"]'), 0, 'no share sheet, no Share');
    assert.deepEqual(await texts(plain.page, '.page__outputs button'), ['Print this page']);
    assert.deepEqual(plain.errors, []);
  } finally {
    await plain.close();
  }
});

// ---------------------------------------------------------------- Every new page, both widths, both themes

const NOTES_TWO = JSON.stringify({ dsample00a: { 1: 'Hall duty by stairs A', 6: 'Department meeting, every second week, in the Library' } });
const SWEEP = [
  ['#/me', 'My schedule', 'My schedule with nobody chosen', {}],
  ['#/me', 'My schedule', 'My schedule', { [ME_AT]: 'tsample001', [NOTES_AT]: NOTES_TWO }],
  ['#/teacher/tsample001', 'Ms. Halloran', 'the reader\'s own teacher page, notes being edited', { [ME_AT]: 'tsample001', [NOTES_AT]: NOTES_TWO }],
  ['#/teacher/tsample003', 'Dr. Quillfeather', 'another teacher\'s page', {}],
  ['#/door/rsample101?day=1', 'Door sign: Room 101', 'the door sign with the room\'s day', {}],
  ['#/door/rsamplecaf', 'Door sign: Cafeteria', 'the door sign of a room with a long name', {}],
  ['#/directions?from=rsample101&to=rsample303', 'Directions', 'Directions with its map', {}],
  ['#/now?t=tsample004', 'Where right now', 'Where right now with its map', {}],
  ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather', 'the substitute plan with its map', {}],
  ['#/room/rsample101', 'Room 101', 'the room page with its door sign link', {}],
];

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test('at ' + width + ' px, ' + theme + ': every new page draws, fits the window, passes axe and asks for nothing', async () => {
      for (const [address, title, name, store] of SWEEP) {
        const session = await openPage({ width, height: width === 390 ? 760 : 900, theme, store });
        try {
          const { page } = session;
          await goto(page, files.open.url + address);
          assert.equal(await text(page, 'h1'), title, name);
          if (name.includes('being edited')) await page.click('[data-toggle="notes"]');
          if (await count(page, '.map')) await mapsDrawn(page);
          const said = await page.evaluate(() => ({
            lede: document.querySelector('.lede').textContent,
            wide: document.documentElement.scrollWidth,
            window: window.innerWidth,
            paper: getComputedStyle(document.body).backgroundColor,
            small: Array.from(document.querySelectorAll('.page button, .page a.btn, .page select, .page input:not([type="checkbox"])')).filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height < 44).map((el) => el.textContent || el.getAttribute('aria-label')),
          }));
          assert.ok(said.lede.length > 10 && said.lede.endsWith('.'), name + ' starts with a sentence: ' + said.lede);
          assert.ok(said.wide <= said.window, name + ' is ' + said.wide + ' px wide in a window of ' + said.window);
          assert.equal(said.paper, theme === 'light' ? 'rgb(246, 243, 236)' : 'rgb(21, 24, 28)');
          assert.deepEqual(said.small, [], name + ' has something to press that is under 44 px tall');
          await axe(page, name + ' at ' + width + ' px, ' + theme);
          assert.deepEqual(asked(session, files.open.url), [], name + ' asks for something');
          assert.deepEqual(session.errors, [], name);
        } finally {
          await session.close();
        }
      }
    });
  }
}
