// The staff browser's today, its bells, the calendar page and a school of
// many day types (SV2-81), driven in Chromium from published files on disk:
// node test/browser/staff-calendar.mjs
//
// The school is the invented sample with five more day types and a year's
// calendar laid on it here (FIXTURE below): C Day with classes of its own,
// D Day and Testing Day the same as C Day, F Day the same as B Day, and Late
// Start with its own classes and bells an hour late; an "Early Release" bell
// schedule (periods 5 to 8 do not meet) rung every Wednesday; the rotation A,
// B, C on weekdays, Fridays always D Day; Thanksgiving, a snow day on Tuesday
// 8 December and the day after it set to A Day so the old order holds (a
// re-sync). What each date is was read off by hand from that calendar:
//
//   Tue  1 Sep 2026   B Day                      the rotation
//   Wed  2 Sep 2026   C Day, Early Release       a Wednesday
//   Thu 26 Nov 2026   no school, Thanksgiving
//   Wed  9 Dec 2026   A Day, Early Release       re-synced after the snow day
//   Thu  1 Jul 2027   not in the calendar        (it ends 11 June 2027)
//
// The page's clock is pinned through `sv2StaffClock` (staff/clock.js) and the
// zone is New York, so a date worked out in UTC instead of the reader's own
// is a different date at 22:30 and fails. Every wait is on something the page
// sets: the document's data-ready, the frame's data-state, the view on
// <main>, and the line or list a case is about. Nothing waits on a first
// paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { publishedModel } from '../../engine/publish-data.js';
import { validate } from '../../engine/validate.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { openSchool } from '../../staff/model.js';
import { lockScreenLayout, LOCK_TOP, LOCK_BOTTOM, LOCK_ROW_LEAST } from '../../staff/outputs.js';
import { dayKindsOf } from '../../staff/views/teacher.js';
import { articleFor } from '../../staff/clock.js';

const ZONE = 'America/New_York';
const ER = 'bfixtureer';
const C = 'dfixture0c';
const DAY_KEY = 'sv2staff:psample001:day';
const DAY_ON_KEY = 'sv2staff:psample001:dayOn';
const ME_KEY = 'sv2staff:psample001:me';

// New York is four hours behind UTC until 1 November, then five.
const ROTATION = '2026-09-01T13:50:00Z'; // Tue 9:50: B Day, Period 2 (9:12 to 10:00)
const EARLY = '2026-09-02T13:30:00Z'; // Wed 9:30: C Day, Early Release, Period 3 (9:28 to 10:08)
const NO_SCHOOL = '2026-11-26T15:00:00Z'; // Thanksgiving, 10:00
const RESYNCED = '2026-12-09T14:00:00Z'; // Wed 9:00: A Day, Early Release, Period 2 (8:44 to 9:24)
const OUTSIDE = '2027-07-01T14:00:00Z';
const LATE_ON_1_SEP = '2026-09-02T02:30:00Z'; // 22:30 on 1 September in New York, already the 2nd in UTC
const NEXT_MORNING = '2026-09-02T12:00:00Z'; // 8:00 on the 2nd

// A name with markup in it: shown as typed, never as markup.
const HOSTILE = '<img src=x onerror=alert(1)>';
const BELLS_KEY = 'sv2staff:psample001:bells';

const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }];

// Bells moved `minutes` later.
function later(bells, minutes) {
  const move = (time) => {
    const at = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
    return String(Math.floor(at / 60)).padStart(2, '0') + ':' + String(at % 60).padStart(2, '0');
  };
  return bells.map((bell) => ({ start: move(bell.start), end: move(bell.end) }));
}

// The sample, with the day types, the bells and the calendar of the header.
function manyDays(opts) {
  const evil = opts && opts.evil ? HOSTILE : null;
  const project = sampleSchool();
  project.publish.passcode = '';
  const a = project.dayTypes[0];
  project.dayTypes.push(
    { id: C, name: evil || 'C Day', own: true, sameAs: null, short: '', bells: a.bells.map((bell) => ({ ...bell })) },
    { id: 'dfixture0d', name: 'D Day', own: false, sameAs: C, short: '', bells: a.bells.map(() => null) },
    { id: 'dfixture0t', name: 'Testing Day', own: false, sameAs: C, short: '', bells: a.bells.map(() => null) },
    { id: 'dfixture0f', name: 'F Day', own: false, sameAs: 'dsample00b', short: '', bells: a.bells.map(() => null) },
    { id: 'dfixture0h', name: 'Late Start', own: true, sameAs: null, short: 'LS', bells: later(a.bells, 60) },
  );
  for (const group of project.groups) {
    // C Day is A Day's classes in the other order; Late Start is A Day's at other times
    group.days[C] = group.days[a.id].slice().reverse().map((slot) => ({ ...slot, teacherIds: slot.teacherIds.slice() }));
    group.days.dfixture0h = group.days[a.id].map((slot) => ({ ...slot, teacherIds: slot.teacherIds.slice() }));
  }
  project.bellSchedules = [{
    id: ER,
    name: evil || 'Early Release',
    short: '',
    bells: [['08:00', '08:40'], ['08:44', '09:24'], ['09:28', '10:08'], ['10:12', '10:52'], null, null, null, null].map((times) => (times ? { start: times[0], end: times[1] } : null)),
    off: [4, 5, 6, 7],
  }];
  project.calendar = {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays: [
      { day: 'rotation', bells: null },
      { day: 'rotation', bells: null },
      { day: 'rotation', bells: ER },
      { day: 'rotation', bells: null },
      { day: 'dfixture0d', bells: null },
      { day: 'closed', bells: null },
      { day: 'closed', bells: null },
    ],
    rotation: [a.id, 'dsample00b', C],
    dates: [
      { date: '2026-10-30', day: 'dfixture0h', bells: null, label: 'Conferences' },
      { date: '2026-11-26', day: 'closed', bells: null, label: evil || 'Thanksgiving' },
      { date: '2026-12-08', day: 'closed', bells: null, label: 'Snow day' },
      { date: '2026-12-09', day: a.id, bells: null, label: '' },
    ],
    changedAt: '2026-08-20T12:00:00.000Z',
  };
  return project;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-calendar-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, project, at) {
  const made = await publishDocument(read, project, { clock: () => new Date(at), random: seededRandom('staff-calendar ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, made.html);
  files[name] = { file, url: pathToFileURL(file).href, model: made.model };
}

before(async () => {
  await write('many', manyDays(), '2026-08-25T12:00:00Z');
  // the same school, published again on 2 September: a newer file
  await write('newer', manyDays(), '2026-09-02T11:00:00Z');
  // published the afternoon of 2 September: a correction from the office the day a reader answered
  await write('sameday', manyDays(), '2026-09-02T18:00:00Z');
  await write('evil', manyDays({ evil: true }), '2026-08-25T12:00:00Z');
  const plain = sampleSchool();
  plain.publish.passcode = '';
  await write('plain', plain, '2026-08-25T12:00:00Z');
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a profile of its own, in New York, its clock pinned at `at` and
// read again every `every` milliseconds (an hour when left out: a timer that
// never fires during a case). `kept` is put in storage before the page runs.
async function openPage(options) {
  const opts = options || {};
  const size = opts.size || SIZES[0];
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = size.width < 640;
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(opts.zone || ZONE);
  await page.evaluateOnNewDocument((at, every, kept, noStorage) => {
    globalThis.sv2Pinned = at;
    globalThis.sv2StaffClock = { now: () => globalThis.sv2Pinned, every };
    globalThis.print = () => {};
    globalThis.__alerts = 0;
    globalThis.alert = () => {
      globalThis.__alerts += 1;
    };
    try {
      for (const [key, value] of Object.entries(kept)) localStorage.setItem(key, value);
    } catch (error) {
      // nothing to keep
    }
    // a device that refuses to say what it keeps: asking is itself an error
    if (noStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  }, opts.at || ROTATION, opts.every || 3600000, opts.kept || {}, opts.noStorage === true);
  const errors = [];
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, errors, close: () => context.close() };
}

// Open a file at an address and wait for the page the address names.
async function goto(page, file, hash) {
  await page.goto(file.url + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
  await viewDrawn(page, hash);
}

async function viewDrawn(page, hash) {
  const view = hash.replace(/^#\//, '').split(/[/?]/)[0];
  await page.waitForFunction((want) => document.querySelector('main.page')?.dataset.view === want && document.querySelector('h1'), { timeout: 10000 }, view);
}

// Move to an address of the file already open.
async function move(page, hash) {
  await page.evaluate((to) => {
    location.hash = to;
  }, hash);
  await viewDrawn(page, hash);
}

const line = (page) => page.evaluate(() => {
  const found = document.querySelector('.today__says');
  return found ? found.textContent.replace(/\s+/g, ' ').trim() : null;
});
const lede = (page) => page.evaluate(() => document.querySelector('.lede[role="status"]').textContent.replace(/\s+/g, ' ').trim());
const texts = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const count = (page, selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);
const kept = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? (el.dataset.today || el.className || el.tagName) : null;
});

// A tap on something, scrolled to the middle of the screen first, so the bar
// along a phone's bottom is never what is under the finger.
async function press(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(selector);
}

async function lineIs(page, want) {
  try {
    await page.waitForFunction((w) => {
      const found = document.querySelector('.today__says');
      return found && found.textContent.replace(/\s+/g, ' ').trim() === w;
    }, { timeout: 10000 }, want);
  } catch (error) {
    assert.equal(await line(page), want, 'the line, after waiting for it, on: ' + await page.evaluate(() => document.querySelector('main').textContent.slice(0, 300)));
    throw error;
  }
}

// ---------------------------------------------------------------- the fixture and the words

test('the fixture is a valid project, and its calendar says what the header says', () => {
  assert.deepEqual(validate(manyDays()), []);
  const school = openSchool(publishedModel(manyDays(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const day = (date) => {
    const found = school.dayOn(date);
    return found.known ? (found.school ? [found.dayTypeId, found.bellsId] : ['closed', found.label]) : ['outside'];
  };
  assert.deepEqual(day('2026-09-01'), ['dsample00b', null]);
  assert.deepEqual(day('2026-09-02'), [C, ER]);
  assert.deepEqual(day('2026-11-26'), ['closed', 'Thanksgiving']);
  assert.deepEqual(day('2026-12-09'), ['dsample00a', ER]);
  assert.deepEqual(day('2027-07-01'), ['outside']);
});

test('"a" or "an" as the name is said', () => {
  assert.deepEqual(['A Day', 'B Day', 'C Day', 'F Day', 'H Day', 'Early Release', 'Late Start', 'Uniform Day', 'Testing Day'].map(articleFor), ['an', 'a', 'a', 'an', 'an', 'an', 'a', 'an', 'a']);
});

// ---------------------------------------------------------------- the lock-screen image

test('the lock-screen image of a teacher with four kinds of day holds them all, and with eleven holds what keeps every row readable and says how many more', () => {
  const at = { locale: 'en-GB', zone: 'UTC' };
  const check = (layout, name) => {
    const items = layout.items.filter((item) => item.kind === 'text');
    for (const item of items) {
      assert.ok(item.y - item.size >= LOCK_TOP - 1, name + ': "' + item.text + '" is in the clock\'s place');
      assert.ok(item.size >= 7, name + ': "' + item.text + '" is set at ' + item.size);
    }
    for (const item of items.slice(0, -2)) assert.ok(item.y <= LOCK_BOTTOM, name + ': "' + item.text + '" is in the buttons\' place');
    // the period numbers of one column are at least LOCK_ROW_LEAST apart
    const labels = items.filter((item) => item.face === 'plan');
    const byColumn = new Map();
    for (const item of labels) {
      if (!byColumn.has(item.x)) byColumn.set(item.x, []);
      byColumn.get(item.x).push(item.y);
    }
    for (const ys of byColumn.values()) {
      ys.sort((p, q) => p - q);
      for (let i = 1; i < ys.length; i += 1) if (ys[i] - ys[i - 1] > 0 && ys[i] - ys[i - 1] < 40) assert.ok(ys[i] - ys[i - 1] >= LOCK_ROW_LEAST - 0.01, name + ': rows ' + (ys[i] - ys[i - 1]) + ' apart');
    }
    return items.map((item) => item.text);
  };

  const school = openSchool(publishedModel(manyDays(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const teacher = school.teacher('tsample007');
  const kindsOf = (from) => dayKindsOf(from, (dayType) => (from.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => [taught.groupId, taught.roomId])));
  const four = check(lockScreenLayout(school, teacher, kindsOf(school), at), 'four kinds');
  assert.deepEqual(four.filter((text) => / Day|Late Start/.test(text) && !text.includes('·')), ['A Day', 'B Day and F Day', 'C Day, D Day and Testing Day', 'Late Start'], 'a column for several day types names them as a list');
  assert.equal(four.some((text) => text.startsWith('And ')), false, 'nothing is left off');

  // eleven kinds: seven more day types of their own, each its own times
  const project = manyDays();
  for (let n = 0; n < 7; n += 1) {
    const id = 'dextra000' + n;
    project.dayTypes.push({ id, name: 'Extra ' + (n + 1), own: true, sameAs: null, short: '', bells: later(project.dayTypes[0].bells, n + 1) });
    for (const group of project.groups) group.days[id] = group.days.dsample00a.map((slot) => ({ ...slot, teacherIds: slot.teacherIds.slice() }));
  }
  const many = openSchool(publishedModel(project, { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const kinds = kindsOf(many);
  assert.equal(kinds.length, 11);
  const eleven = check(lockScreenLayout(many, many.teacher('tsample007'), kinds, at), 'eleven kinds');
  assert.ok(eleven.slice(eleven.findIndex((text) => text.startsWith('And ')), -2).join(' ') === 'And 2 more kinds of day: Extra 6 and Extra 7. Print the schedule for every one.', 'nine fit three bands of eight periods: ' + eleven.filter((text) => text.startsWith('And')));
  assert.equal(eleven.filter((text) => /^Extra \d$/.test(text)).length, 5, 'the first nine kinds: four of the school\'s and five extras');
});

// ---------------------------------------------------------------- today, at both widths

for (const size of SIZES) {
  test('a rotation day at ' + size.width + ' px: "Today is a B Day.", nothing asked, today\'s card first', async () => {
    const session = await openPage({ size, at: ROTATION });
    try {
      const { page } = session;
      await goto(page, files.many, '#/free');
      assert.equal(await line(page), 'Today is a B Day. Not right?');
      assert.equal(await count(page, '[data-pick="day"]'), 0, 'the calendar says which day: no day type is asked');
      assert.equal(await count(page, '[data-pick="bells"]'), 0);
      assert.match(await lede(page), /^It is Period 2 on B Day, 9:12 AM to 10:00 AM\. \d+ teachers? and \d+ rooms? are free\.$/);
      assert.deepEqual(await texts(page, '.tabs[aria-label="Now"] .tab'), ['Where right now', 'Free right now', 'Calendar']);
      // every tab is a whole target and none is out of sight
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tabs[aria-label="Now"] .tab'), (tab) => {
        const box = tab.getBoundingClientRect();
        return [box.height, box.left >= 0 && box.right <= window.innerWidth];
      }));
      for (const [height, inside] of tabs) {
        assert.ok(height >= 44, 'a tab ' + height + ' px tall');
        assert.equal(inside, true, 'a tab off the side of the screen');
      }

      await move(page, '#/teacher/tsample007');
      assert.equal(await line(page), 'Today is a B Day. Not right?');
      assert.deepEqual(await texts(page, '.day .card__title'), ['B Day and F Day', 'A Day', 'C Day, D Day and Testing Day', 'Late Start']);
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.day'), (day) => [day.tagName, day.getAttribute('data-today') || ''])), [['SECTION', 'true'], ['DETAILS', ''], ['DETAILS', ''], ['DETAILS', '']], 'four cards: today\'s open, the rest folded');
      assert.deepEqual(await texts(page, '.day__tag'), ['Today: B Day'], 'the card is shared by B Day and F Day: it says which one today is');
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.row--now'), (row) => [row.closest('.day').dataset.today, row.dataset.period])), [['true', '1']], 'Period 2 is marked on today\'s card only');
      // a folded card opens by keyboard
      await page.focus('details.day summary');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('details.day').open);
      assert.equal(await page.evaluate(() => document.querySelector('details.day').getBoundingClientRect().width > 200), true);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });

  test('an Early Release Wednesday at ' + size.width + ' px: today\'s bells on Free right now, Where right now and today\'s own card', async () => {
    const session = await openPage({ size, at: EARLY });
    try {
      const { page } = session;
      await goto(page, files.many, '#/free');
      assert.equal(await line(page), 'Today is a C Day with Early Release bells. Not right?');
      assert.match(await lede(page), /^It is Period 3 on C Day with Early Release bells, 9:28 AM to 10:08 AM\. /);
      assert.deepEqual((await texts(page, '[data-pick="period"] option')).slice(4, 6), ['Period 4, 10:12 AM to 10:52 AM', 'Period 5, no class']);

      // a period chosen by hand: its day type and bells travel in the address, and any day can be looked at
      await page.select('[data-pick="period"]', '4');
      await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'off');
      assert.equal(await lede(page), 'Period 5 does not meet on C Day with Early Release bells.');
      assert.equal(await page.evaluate(() => location.hash), '#/free?p=4&d=dfixture0c&b=bfixtureer');
      assert.equal(await count(page, '[data-pick="day"]'), 1, 'a chosen period can be looked at on any day');
      assert.equal(await focused(page), 'field__input', 'focus stays on the period');
      await page.click('[data-pick="bells"] .pick__item:first-child');
      await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'chosen');
      assert.match(await lede(page), /^Period 5, 11:28 AM to 12:16 PM on C Day: /);
      assert.equal(await page.evaluate(() => location.hash), '#/free?p=4&d=dfixture0c');

      await move(page, '#/now?t=tsample007');
      assert.equal(await line(page), 'Today is a C Day with Early Release bells. Not right?');
      assert.match(await lede(page), /^It is Period 3 on C Day with Early Release bells/);

      await move(page, '#/teacher/tsample007');
      assert.deepEqual(await texts(page, '.day .card__title'), ['C Day, D Day and Testing Day', 'A Day', 'B Day and F Day', 'C Day, D Day and Testing Day', 'Late Start'], 'today\'s own card, then the regular ones in order');
      assert.deepEqual(await texts(page, '.day[data-own="true"] .day__bells'), ['Early Release bells']);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.day[data-own="true"] .row'), (row) => Array.from(row.children, (cell) => cell.textContent.replace(/\s+/g, ' ').trim())));
      assert.deepEqual(rows[0], ['Period 18:00 AM to 8:40 AM', '6A', 'Room 203']);
      assert.deepEqual(rows[2], ['Period 39:28 AM to 10:08 AMNow', 'Planning', '']);
      assert.deepEqual(rows.slice(4).map((row) => row.slice(0, 2)), [['Period 5', 'No class'], ['Period 6', 'No class'], ['Period 7', 'No class'], ['Period 8', 'No class']]);
      // the day type's own card keeps its regular times
      assert.equal(await page.evaluate(() => document.querySelectorAll('.day')[3].querySelector('.row .row__time').textContent), '8:00 AM to 8:48 AM');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });

  test('no school, and a date outside the calendar, at ' + size.width + ' px: said, and the day picked by hand', async () => {
    const session = await openPage({ size, at: NO_SCHOOL });
    try {
      const { page } = session;
      await goto(page, files.many, '#/free');
      assert.equal(await line(page), 'No school today: Thanksgiving. Not right?');
      assert.equal(await count(page, '[data-pick="day"]'), 1, 'the picker to look at any day');
      assert.match(await lede(page), /^Showing Period 3, 9:44 AM to 10:32 AM on A Day: /);
      await move(page, '#/teacher/tsample007');
      assert.equal(await count(page, '.day__tag'), 0, 'no card is today\'s');
      assert.equal(await count(page, '.row--now'), 0);
    } finally {
      await session.close();
    }
    const outside = await openPage({ size, at: OUTSIDE, kept: { [DAY_KEY]: 'dsample00b' } });
    try {
      const { page } = outside;
      await goto(page, files.many, '#/free');
      assert.equal(await line(page), 'Today, 1 July 2027, is not in this schedule\'s calendar, which runs from 31 August 2026 to 11 June 2027.');
      assert.equal(await count(page, '[data-today="not-right"]'), 0);
      assert.equal(await page.evaluate(() => document.querySelector('[data-pick="day"] input:checked').value), 'dsample00b', 'the day chosen by hand, as before there was a calendar');
      assert.deepEqual(outside.errors, []);
    } finally {
      await outside.close();
    }
  });

  test('the re-synced day after a snow day, and the calendar page, at ' + size.width + ' px', async () => {
    const session = await openPage({ size, at: RESYNCED });
    try {
      const { page } = session;
      await goto(page, files.many, '#/calendar');
      assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), 'Calendar');
      assert.equal(await page.evaluate(() => document.querySelector('.page__body > .lede').textContent), 'Calendar as published on 25 August. It covers 31 August 2026 to 11 June 2027.');
      assert.equal(await line(page), 'Today is an A Day with Early Release bells. Not right?');
      assert.equal(await page.evaluate(() => document.querySelector('.cal__month').textContent), 'December 2026', 'the month of today');
      const list = await texts(page, '.cal__item');
      assert.equal(list[0], 'Tuesday 1 December: B Day');
      assert.ok(list.includes('Tuesday 8 December: No school, Snow day'));
      assert.ok(list.includes('Wednesday 9 December: A Day, Early Release bells Today'));
      assert.ok(list.includes('Thursday 10 December: B Day'), 'the old order holds after the re-sync');
      assert.equal(list.some((item) => item.startsWith('Saturday')), false, 'a weekend with nothing to say is not listed');
      assert.deepEqual(await page.evaluate(() => {
        const square = (date) => document.querySelector('.cal__date[data-date="' + date + '"]');
        return [square('2026-12-08').textContent, square('2026-12-09').textContent, square('2026-12-09').getAttribute('aria-current'), document.querySelectorAll('[aria-current="date"]').length];
      }), ['8Snow', '9AER', 'date', 2], 'the snow day says so, today is ringed (its square and its line)');
      // squares fit the phone: none runs past its column
      assert.equal(await page.evaluate(() => {
        const table = document.querySelector('.cal').getBoundingClientRect();
        return table.right <= document.querySelector('.cal__card').getBoundingClientRect().right + 0.5;
      }), true);

      // by keyboard: next month, and Back
      await page.focus('.cal__step[data-step="next"]');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.cal__month')?.textContent === 'January 2027');
      assert.equal(await page.evaluate(() => location.hash), '#/calendar?m=2027-01');
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('.cal__month')?.textContent === 'December 2026');
      // the first month has no previous one
      await move(page, '#/calendar?m=2026-08');
      assert.equal(await page.evaluate(() => document.querySelector('.cal__step[data-step="previous"]').getAttribute('aria-disabled')), 'true');
      assert.equal(await page.evaluate(() => document.querySelector('.cal__month').textContent), 'August 2026');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

// ---------------------------------------------------------------- Not right?

test('"Not right?" by keyboard: Just today holds for today only', async () => {
  const session = await openPage({ at: ROTATION, every: 150 });
  try {
    const { page } = session;
    await goto(page, files.many, '#/free');
    await page.focus('[data-today="not-right"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-today="not-right"]').getAttribute('aria-expanded') === 'true');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'dsample00b', 'focus on today\'s day type');
    // Escape closes it and gives focus back
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.today__panel').hidden), true);
    assert.equal(await focused(page), 'not-right');
    await page.keyboard.press('Enter');
    // B → C Day with the arrow, then Early Release in the bells, then "Just today"
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'just');
    await page.keyboard.press('Enter');
    await lineIs(page, 'Today is a C Day with Early Release bells. You said so on this device. Not right?');
    assert.equal(await focused(page), 'today__says', 'focus on the line, rewritten');
    assert.deepEqual(JSON.parse(await kept(page, DAY_ON_KEY)), { just: { date: '2026-09-01', dayTypeId: C, bellsId: ER, at: ROTATION.replace('Z', '.000Z') }, follow: null });
    assert.match(await lede(page), /on C Day with Early Release bells/);

    // the next morning the calendar is back: 2 September is C Day with Early Release anyway, so look at the 3rd
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-03T12:00:00Z';
    });
    await lineIs(page, 'Today is an A Day. Not right?');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('"Not right?": the days after follow on from it, until a newer file is opened', async () => {
  const session = await openPage({ at: ROTATION, every: 150 });
  try {
    const { page } = session;
    await goto(page, files.many, '#/teacher/tsample007');
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-pick="today-day"] input[value="dsample00a"]');
    await press(page, '[data-today="follow"]');
    await lineIs(page, 'Today is an A Day. You said so on this device. Not right?');
    assert.deepEqual(await texts(page, '.day[data-today="true"] .card__title'), ['A Day']);
    assert.deepEqual(JSON.parse(await kept(page, DAY_ON_KEY)), { just: null, follow: { date: '2026-09-01', dayTypeId: 'dsample00a', bellsId: null, at: ROTATION.replace('Z', '.000Z') } });

    // the next day follows on from A: B Day, and Wednesday's bells
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T12:00:00Z';
    });
    await lineIs(page, 'Today is a B Day with Early Release bells. It follows on from what you said on 1 September. Not right?');
    assert.deepEqual(await texts(page, '.day[data-today="true"] .card__title'), ['B Day and F Day']);
    await move(page, '#/calendar?m=2026-09');
    const list = await texts(page, '.cal__item');
    assert.equal(list[0], 'Tuesday 1 September: A Day');
    assert.equal(list[1], 'Wednesday 2 September: B Day, Early Release bells Today');
    assert.equal(list[2], 'Thursday 3 September: C Day');

    // "As the calendar says" takes the answer away
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-today="calendar"]');
    await lineIs(page, 'Today is a C Day with Early Release bells. Not right?');
    assert.equal(await kept(page, DAY_ON_KEY), null);

    // follow again, then open a file published after that date: it clears the answer
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-01T13:50:00Z';
    });
    await lineIs(page, 'Today is a B Day. Not right?');
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-pick="today-day"] input[value="dsample00a"]');
    await press(page, '[data-today="follow"]');
    await lineIs(page, 'Today is an A Day. You said so on this device. Not right?');
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T12:00:00Z';
    });
    await lineIs(page, 'Today is a B Day with Early Release bells. It follows on from what you said on 1 September. Not right?');
    // (a page loaded afresh is pinned again at 1 September, the answer's own
    // date: kept, the answer would say A Day)
    await goto(page, files.newer, '#/free');
    assert.equal(await line(page), 'Today is a B Day. Not right?', 'the newer file\'s calendar, the answer cleared');
    assert.equal(await kept(page, DAY_ON_KEY), null);
    // and opening the older file again does not bring it back
    await goto(page, files.many, '#/free');
    assert.equal(await line(page), 'Today is a B Day. Not right?');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- worked out again

test('the line is worked out again when the date changes while the page is open, and when the page comes back into view', async () => {
  // late on 1 September by the reader's clock, already the 2nd in UTC
  const session = await openPage({ at: LATE_ON_1_SEP, every: 150 });
  try {
    const { page } = session;
    await goto(page, files.many, '#/teacher/tsample007');
    assert.equal(await line(page), 'Today is a B Day. Not right?', 'the reader\'s date, not UTC\'s');
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T04:05:00Z'; // 00:05 on the 2nd
    });
    await lineIs(page, 'Today is a C Day with Early Release bells. Not right?');
    assert.deepEqual(await texts(page, '.day[data-today="true"] .day__bells'), ['Early Release bells']);
  } finally {
    await session.close();
  }

  // a timer that never fires: only coming back into view reads the clock again
  const asleep = await openPage({ at: ROTATION });
  try {
    const { page } = asleep;
    await goto(asleep.page, files.many, '#/free');
    assert.equal(await line(page), 'Today is a B Day. Not right?');
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T13:30:00Z';
    });
    assert.equal(await line(page), 'Today is a B Day. Not right?', 'nothing reads the clock yet');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await lineIs(page, 'Today is a C Day with Early Release bells. Not right?');
    assert.match(await lede(page), /^It is Period 3 on C Day with Early Release bells/);
    assert.deepEqual(asleep.errors, []);
  } finally {
    await asleep.close();
  }
});

// ---------------------------------------------------------------- paper, notes, staffing, no calendar

test('on paper: every card open, three across then the next row, no today\'s own card, no tag; the calendar as the month and its list', async () => {
  const session = await openPage({ size: { width: 1000, height: 1300 }, at: EARLY, kept: { [ME_KEY]: 'tsample007' } });
  try {
    const { page } = session;
    await goto(page, files.many, '#/me');
    // notes say which day types a card is for, as a list
    assert.deepEqual(await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('.note__input[aria-label$="Period 1 on C Day, D Day and Testing Day"], .note__input[aria-label$="Period 1 on B Day and F Day"]'), (input) => input.getAttribute('aria-label'))))), ['Note for Period 1 on B Day and F Day', 'Note for Period 1 on C Day, D Day and Testing Day']);
    // a note typed on C Day's card shows on today's own card at once
    await page.click('[data-toggle="notes"]');
    // C Day's own card is folded (five cards): open it, then type
    await page.click('details.day[data-days="dfixture0c dfixture0d dfixture0t"] summary');
    await page.type('.day:not([data-own]) .note[data-note="dfixture0c:0"] .note__input', 'Fire drill');
    await page.click('[data-toggle="notes"]');
    assert.deepEqual(await texts(page, '.note[data-note="dfixture0c:0"] .note__paper'), ['Fire drill', 'Fire drill']);

    await page.emulateMediaType('print');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const paper = await page.evaluate(() => {
      const shown = Array.from(document.querySelectorAll('.day')).filter((day) => day.getClientRects().length > 0);
      return {
        cards: shown.map((day) => day.querySelector('.card__title').textContent),
        tops: shown.map((day) => Math.round(day.getBoundingClientRect().top)),
        open: shown.every((day) => day.tagName === 'SECTION' || day.open),
        tags: Array.from(document.querySelectorAll('.day__tag, .today')).filter((el) => el.getClientRects().length > 0).length,
      };
    });
    assert.deepEqual(paper.cards, ['A Day', 'B Day and F Day', 'C Day, D Day and Testing Day', 'Late Start']);
    assert.equal(paper.open, true, 'every disclosure is open on paper');
    assert.equal(paper.tops[0], paper.tops[1]);
    assert.equal(paper.tops[1], paper.tops[2]);
    assert.ok(paper.tops[3] > paper.tops[0], 'the fourth on the next row');
    assert.equal(paper.tags, 0, 'no "Today" and no "Not right?" on paper');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMediaType('screen');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('details.day')).filter((day) => day.open).map((day) => day.dataset.days)), ['dfixture0c dfixture0d dfixture0t'], 'after paper, folded again but for the one the reader opened');

    await move(page, '#/calendar?m=2026-11');
    await page.emulateMediaType('print');
    const calendar = await page.evaluate(() => ({
      grid: document.querySelector('.cal').getClientRects().length > 0,
      nav: document.querySelector('.cal__nav').getClientRects().length,
      items: Array.from(document.querySelectorAll('.cal__item')).filter((item) => item.getClientRects().length > 0).length,
      thanksgiving: document.querySelector('.cal__date[data-date="2026-11-26"]').textContent,
      ring: getComputedStyle(document.querySelector('.cal__date[aria-current="date"]') || document.body).boxShadow,
    }));
    assert.equal(calendar.grid, true);
    assert.equal(calendar.nav, 0);
    assert.equal(calendar.items, 21, 'the month\'s 20 school days and Thanksgiving');
    assert.equal(calendar.thanksgiving, '26No', 'a word too long for a square reads "No"');
    await page.emulateMediaType('screen');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('staffing names each day type that is the same as another by the one it follows', async () => {
  const session = await openPage({ at: ROTATION });
  try {
    const { page } = session;
    await goto(page, files.many, '#/staffing');
    assert.equal(await page.evaluate(() => document.querySelector('[data-part="same"]').textContent), 'F Day is the same as B Day. D Day and Testing Day are the same as C Day.');
    assert.deepEqual((await texts(page, '.table thead th')).slice(2), ['Taught periods on A Day', 'Taught periods on B Day', 'Taught periods on C Day', 'Taught periods on Late Start']);
  } finally {
    await session.close();
  }
});

test('a file with no calendar is as it was: no line, the day chosen by hand, no Calendar tab, and its calendar address says there is none', async () => {
  const session = await openPage({ at: ROTATION });
  try {
    const { page } = session;
    await goto(page, files.plain, '#/free');
    assert.equal(await count(page, '.today'), 0);
    assert.equal(await count(page, '[data-pick="day"]'), 1);
    assert.deepEqual(await texts(page, '.tabs[aria-label="Now"] .tab'), ['Where right now', 'Free right now']);
    await move(page, '#/teacher/tsample007');
    assert.equal(await count(page, '.today'), 0);
    assert.deepEqual(await texts(page, '.day .card__title'), ['A Day', 'B Day']);
    await move(page, '#/calendar');
    assert.equal(await page.evaluate(() => document.querySelector('.page__body > .lede').textContent), 'This copy of the schedule has no calendar. Which day type each day is comes from the office.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- SV2-81b: what the review found

const FRIDAY = '2026-09-04T14:00:00Z'; // Fri 10:00: D Day, the same as C Day and Testing Day
const school81 = () => openSchool(publishedModel(manyDays(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
const dayName = (school, date) => {
  const day = school.dayOn(date);
  return day.school ? school.dayTypes.find((dayType) => dayType.id === day.dayTypeId).name : null;
};
const SAYS = (name) => (name === null ? /^No school today/ : new RegExp('^Today is an? ' + name + '[ .]'));

test('two answers: "Just today" never removes a standing follow answer', async () => {
  const session = await openPage({ at: ROTATION, every: 150 });
  try {
    const { page } = session;
    await goto(page, files.many, '#/free');
    // Tuesday: C Day, and the days after follow on from it
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-pick="today-day"] input[value="' + C + '"]');
    await press(page, '[data-today="follow"]');
    await lineIs(page, 'Today is a C Day. You said so on this device. Not right?');
    // Wednesday follows on: A Day (with the Wednesday bells). Just today, it is B Day
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T13:00:00Z';
    });
    await lineIs(page, 'Today is an A Day with Early Release bells. It follows on from what you said on 1 September. Not right?');
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-pick="today-day"] input[value="dsample00b"]');
    await press(page, '[data-today="just"]');
    await lineIs(page, 'Today is a B Day with Early Release bells. You said so on this device. Not right?');
    const both = JSON.parse(await kept(page, DAY_ON_KEY));
    assert.equal(both.follow.dayTypeId, C, 'the follow answer is still kept');
    assert.equal(both.just.dayTypeId, 'dsample00b');
    assert.equal(both.follow.at, '2026-09-01T13:50:00.000Z');
    assert.equal(both.just.at, '2026-09-02T13:00:00.000Z');
    // Thursday follows on from Tuesday's answer, not from Wednesday's
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-03T13:00:00Z';
    });
    await lineIs(page, 'Today is a B Day. It follows on from what you said on 1 September. Not right?');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a file published after the answer was given clears a follow answer, the same day too', async () => {
  const answer = JSON.stringify({ just: null, follow: { date: '2026-09-02', dayTypeId: 'dsample00b', bellsId: null, at: '2026-09-02T13:00:00.000Z' } });
  const at = '2026-09-03T13:00:00Z';
  const standing = await openPage({ at, kept: { [DAY_ON_KEY]: answer } });
  try {
    await goto(standing.page, files.many, '#/free');
    assert.equal(await line(standing.page), 'Today is a C Day. It follows on from what you said on 2 September. Not right?', 'a file from before the answer: kept');
    assert.deepEqual(standing.errors, []);
  } finally {
    await standing.close();
  }
  const corrected = await openPage({ at, kept: { [DAY_ON_KEY]: answer } });
  try {
    await goto(corrected.page, files.sameday, '#/free');
    assert.equal(await line(corrected.page), 'Today is an A Day. Not right?', 'the office republished at 2 pm that day: its calendar is the newer word');
    assert.equal(await kept(corrected.page, DAY_ON_KEY), null, 'nothing else was kept, so nothing is');
    assert.deepEqual(corrected.errors, []);
  } finally {
    await corrected.close();
  }
});

test('an answer is stored under the date of the click, not the date the line was drawn with', async () => {
  // drawn at 23:58 on 1 September in New York; the timer is asleep (an hour) and the click is at 00:05 on the 2nd
  const session = await openPage({ at: '2026-09-02T03:58:00Z' });
  try {
    const { page } = session;
    await goto(page, files.many, '#/free');
    assert.equal(await line(page), 'Today is a B Day. Not right?');
    await press(page, '[data-today="not-right"]');
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T04:05:00Z';
    });
    await press(page, '[data-pick="today-day"] input[value="dsample00a"]');
    await press(page, '[data-today="just"]');
    await lineIs(page, 'Today is an A Day. You said so on this device. Not right?');
    const answer = JSON.parse(await kept(page, DAY_ON_KEY)).just;
    assert.equal(answer.date, '2026-09-02', 'the date of the click');
    assert.equal(answer.at, '2026-09-02T04:05:00.000Z');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a date with no school marks no period "Now" anywhere, whatever the day chosen by hand', async () => {
  const session = await openPage({ at: NO_SCHOOL, kept: { [DAY_KEY]: 'dsample00a', [BELLS_KEY]: ER } });
  try {
    const { page } = session;
    await goto(page, files.many, '#/free');
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.moment), 'closed');
    assert.doesNotMatch(await lede(page), /^It is /);
    await move(page, '#/now?t=tsample007');
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.moment), 'closed');
    assert.doesNotMatch(await lede(page), /right now/);
    await move(page, '#/teacher/tsample007');
    assert.equal(await count(page, '.row--now'), 0);
    assert.equal(await count(page, '.row__mark'), 0);
    await move(page, '#/group/gsample001');
    assert.equal(await count(page, '.row--now'), 0);
    await move(page, '#/room/rsample001');
    assert.equal(await count(page, '.row--now'), 0);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('#/calendar?m= with a month that is not 01 to 12 shows today\'s month, as other bad values do', async () => {
  const session = await openPage({ at: ROTATION });
  try {
    const { page } = session;
    await goto(page, files.many, '#/calendar');
    for (const bad of ['2026-13', '2026-00', '2026-99', '2026-1', 'x', '']) {
      await move(page, '#/calendar?m=' + bad);
      assert.equal(await page.evaluate(() => document.querySelector('.cal__month').textContent), 'September 2026', 'm=' + bad);
    }
    await move(page, '#/calendar?m=2026-12');
    assert.equal(await page.evaluate(() => document.querySelector('.cal__month').textContent), 'December 2026');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Previous and Next month keep the focus on the pressed control and say the new month', async () => {
  const session = await openPage({ at: RESYNCED });
  try {
    const { page } = session;
    await goto(page, files.many, '#/calendar');
    await page.focus('.cal__step[data-step="next"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-says="month"]')?.textContent === 'January 2027');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.step), 'next');
    assert.equal(await page.evaluate(() => document.querySelector('[data-says="month"]').getAttribute('role')), 'status');
    await page.focus('.cal__step[data-step="previous"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-says="month"]')?.textContent === 'December 2026');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.step), 'previous');
    // the last month has no next: the focus goes to the control that is left
    await move(page, '#/calendar?m=2027-05');
    await page.focus('.cal__step[data-step="next"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-says="month"]')?.textContent === 'June 2027');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.step), 'previous');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a card shared by several day types marks which one is today', async () => {
  const session = await openPage({ at: FRIDAY });
  try {
    const { page } = session;
    await goto(page, files.many, '#/teacher/tsample007');
    assert.equal(await line(page), 'Today is a D Day. Not right?');
    assert.deepEqual(await texts(page, '.day[data-today="true"] .card__title'), ['C Day, D Day and Testing Day']);
    assert.deepEqual(await texts(page, '.day__tag'), ['Today: D Day']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('hand-chosen bells set the times and "Now" on day cards; Coverage and the substitute plan use them and leave out periods that do not meet', async () => {
  // 1 July 2027 is outside the calendar: the day and the bells are the reader's
  const session = await openPage({ at: OUTSIDE, kept: { [DAY_KEY]: 'dsample00b', [BELLS_KEY]: ER } });
  try {
    const { page } = session;
    await goto(page, files.many, '#/teacher/tsample007');
    assert.deepEqual(await texts(page, '.day[data-own="true"] .day__bells'), ['Early Release bells']);
    assert.equal(await count(page, '.day__tag'), 0, 'nothing here says it is today');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.row--now'), (row) => [row.closest('.day').dataset.bells || '', row.dataset.period])), [[ER, '2']], '10:00 is Period 3 under Early Release bells');
    assert.equal(await page.evaluate(() => document.querySelector('.day[data-own="true"] .row .row__time').textContent), '8:00 AM to 8:40 AM');
    await move(page, '#/coverage/tsample007');
    assert.match(await lede(page), /of 4 periods on B Day with Early Release bells\./);
    assert.equal(await count(page, 'section[data-period]') > 0, true);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('section[data-period]'), (card) => Number(card.dataset.period)).filter((period) => period > 3)), []);
    assert.equal(await page.evaluate(() => document.querySelector('section[data-period="0"] .card__when').textContent), '8:00 AM to 8:40 AM');
    await move(page, '#/sub/tsample007');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sub="day"] .row'), (row) => Number(row.dataset.period))), [0, 1, 2, 3]);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sub="cover"] li'), (li) => Number(li.dataset.period)).filter((period) => period > 3)), []);
    assert.equal(await page.evaluate(() => document.querySelector('[data-sub="day"] .row .row__when').textContent), 'Period 18:00 AM to 8:40 AM');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
  // on an Early Release Wednesday it is today's bells, with no choice by hand
  const today = await openPage({ at: EARLY });
  try {
    const { page } = today;
    await goto(page, files.many, '#/coverage/tsample007');
    assert.match(await lede(page), /of 4 periods on C Day with Early Release bells\./);
    await goto(page, files.many, '#/sub/tsample007');
    assert.equal(await count(page, '[data-sub="day"] .row'), 4);
    assert.deepEqual(today.errors, []);
  } finally {
    await today.close();
  }
});

test('Search\'s More row lists Calendar when the school has one, and not otherwise', async () => {
  const session = await openPage({ at: ROTATION });
  try {
    const { page } = session;
    await goto(page, files.many, '#/search');
    assert.ok((await texts(page, '.more .list__name')).includes('Calendar'));
    assert.equal(await page.evaluate(() => document.querySelector('.more a[href="#/calendar"]') !== null), true);
    await goto(page, files.plain, '#/search');
    assert.equal((await texts(page, '.more .list__name')).includes('Calendar'), false);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- what the tests missed

for (const [zone, name] of [['America/New_York', 'New York'], ['Pacific/Auckland', 'Auckland']]) {
  test('the date is the reader\'s own at 23:30 and 00:30 in ' + name + ', and across the clocks changing', async () => {
    const school = school81();
    // [instant, the reader's date there]
    const moments = zone === 'America/New_York'
      ? [['2026-09-02T03:30:00Z', '2026-09-01'], ['2026-09-02T04:30:00Z', '2026-09-02'], // summer time
        ['2026-11-02T04:30:00Z', '2026-11-01'], ['2026-11-02T05:30:00Z', '2026-11-02'], // the night the clocks went back
        ['2027-03-15T03:30:00Z', '2027-03-14'], ['2027-03-15T04:30:00Z', '2027-03-15']] // the night they went forward, 14 March 2027, 2 am
      : [['2026-09-01T11:30:00Z', '2026-09-01'], ['2026-09-01T12:30:00Z', '2026-09-02'], // winter time, UTC+12
        ['2026-09-28T10:30:00Z', '2026-09-28'], ['2026-09-28T11:30:00Z', '2026-09-29'], // after the clocks went forward, UTC+13
        ['2027-04-04T10:30:00Z', '2027-04-04'], ['2027-04-04T12:30:00Z', '2027-04-05']]; // the night they went back (UTC+13 then +12)
    for (const [at, date] of moments) {
      const session = await openPage({ at, zone });
      try {
        const { page } = session;
        await goto(page, files.many, '#/free');
        const want = dayName(school, date);
        const said = await line(page);
        if (want === null) assert.match(said, SAYS(null), zone + ' ' + at + ' is ' + date);
        else assert.match(said, SAYS(want), zone + ' ' + at + ' is ' + date + ', ' + want + ': ' + said);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    }
  });
}

test('with storage unavailable the answer holds for as long as the page is open, and nothing breaks', async () => {
  const session = await openPage({ at: ROTATION, every: 150, noStorage: true });
  try {
    const { page } = session;
    await goto(page, files.many, '#/free');
    assert.equal(await line(page), 'Today is a B Day. Not right?');
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-pick="today-day"] input[value="' + C + '"]');
    await press(page, '[data-today="follow"]');
    await lineIs(page, 'Today is a C Day. You said so on this device. Not right?');
    await move(page, '#/teacher/tsample007');
    assert.equal(await line(page), 'Today is a C Day. You said so on this device. Not right?');
    assert.equal(await count(page, '[data-band="notkept"], .band'), 1, 'the reader is told it is not kept');
    await page.evaluate(() => {
      globalThis.sv2Pinned = '2026-09-02T13:00:00Z';
    });
    await lineIs(page, 'Today is an A Day with Early Release bells. It follows on from what you said on 1 September. Not right?');
    await move(page, '#/calendar');
    assert.equal(await count(page, '.cal__item'), 22);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('names with markup in them are shown as typed on the new pages, and the key holds no name', async () => {
  const session = await openPage({ at: EARLY });
  try {
    const { page } = session;
    for (const hash of ['#/free', '#/now?t=tsample007', '#/teacher/tsample007', '#/calendar?m=2026-09', '#/calendar?m=2026-11', '#/coverage/tsample007', '#/sub/tsample007', '#/staffing', '#/search']) {
      await goto(page, files.evil, hash);
      assert.equal(await count(page, 'main img'), 0, hash + ': no element came of a name');
    }
    await goto(page, files.evil, '#/free');
    assert.ok((await line(page)).includes(HOSTILE + ' with ' + HOSTILE + ' bells'), 'the day type and the bells, as typed: ' + await line(page));
    await goto(page, files.evil, '#/calendar?m=2026-11');
    assert.ok((await texts(page, '.cal__item')).some((item) => item.includes('No school, ' + HOSTILE)), 'the note of a date, as typed');
    await goto(page, files.evil, '#/free');
    await press(page, '[data-today="not-right"]');
    await press(page, '[data-today="just"]');
    await page.waitForFunction((key) => localStorage.getItem(key) !== null, {}, DAY_ON_KEY);
    assert.equal((await kept(page, DAY_ON_KEY)).includes('<'), false, 'ids, not names, are kept');
    assert.equal(await page.evaluate(() => globalThis.__alerts), 0);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a file with no calendar shows no today line and writes no dayOn, whichever pages are opened', async () => {
  const session = await openPage({ at: ROTATION });
  try {
    const { page } = session;
    for (const hash of ['#/free', '#/now', '#/teacher/tsample007', '#/group/gsample001', '#/room/rsample001', '#/staffing', '#/search']) {
      await goto(page, files.plain, hash);
      assert.equal(await count(page, '.today'), 0, hash);
    }
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.endsWith(':dayOn'))), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('twelve kinds of day on the lock-screen image: today\'s is there, and the closing line names the ones left out', () => {
  const project = manyDays();
  for (let n = 0; n < 8; n += 1) {
    const id = 'dextra000' + n;
    project.dayTypes.push({ id, name: 'Extra ' + (n + 1), own: true, sameAs: null, short: '', bells: later(project.dayTypes[0].bells, n + 1) });
    for (const group of project.groups) group.days[id] = group.days.dsample00a.map((slot) => ({ ...slot, teacherIds: slot.teacherIds.slice() }));
  }
  const many = openSchool(publishedModel(project, { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const teacher = many.teacher('tsample007');
  const kinds = dayKindsOf(many, (dayType) => (many.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => [taught.groupId, taught.roomId])));
  assert.equal(kinds.length, 12);
  const names = (layout) => layout.items.filter((item) => item.kind === 'text').map((item) => item.text);
  // the closing line, over the lines it is set in: from "And" to the school's name
  const closing = (texts) => texts.slice(texts.findIndex((text) => text.startsWith('And ')), -2).join(' ');
  const plain = names(lockScreenLayout(many, teacher, kinds, { locale: 'en-GB', zone: 'UTC' }));
  assert.equal(plain.includes('Extra 8'), false, 'the last kind does not fit');
  const line = closing(plain);
  assert.match(line, /^And 3 more kinds of day: Extra 6, Extra 7 and Extra 8\. Print the schedule for every one\.$/);
  // today is the last of them: it stays, and another is named instead
  const today = names(lockScreenLayout(many, teacher, kinds, { locale: 'en-GB', zone: 'UTC', today: 'dextra0007' }));
  assert.ok(today.includes('Extra 8'), 'today\'s kind of day is on the image');
  const said = closing(today);
  assert.match(said, /^And 3 more kinds of day: Extra 5, Extra 6 and Extra 7\. Print the schedule for every one\.$/);
  // nothing left out, no line
  assert.equal(names(lockScreenLayout(many, teacher, kinds.slice(0, 3), { locale: 'en-GB', zone: 'UTC', today: 'dextra0007' })).some((text) => text.startsWith('And ')), false);
});
