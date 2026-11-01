// Marks and duties in the staff browser (SV2-86), driven in Chromium from
// published files on disk: node test/browser/staff-duties.mjs
//
// The school is the invented sample with a calendar and these laid on it
// (FIXTURE below). Periods count from 0; on A Day tsample001 teaches periods
// 1 and 2 and is free in the rest:
//
//   Lunch for grade 6, every day type, in period 3 (6A is then in the cafeteria)
//   No class for 6A on A Day, in period 1 (Room 103 is then empty)
//   An assembly (an activity mark, the whole school) on B Day, in period 7
//   tsample001: "Lunch duty" in period 3 at the cafeteria, every day
//   tsample001 and tsample002: "Bus duty" after school, 3:05 to 3:25 PM
//   tsample002: "Door duty" before school, 7:40 to 7:55 AM
//   the science teachers: a "Science department" meeting in period 4, on
//   Wednesdays only
//
// What each date is, from the calendar (Monday to Friday, A Day then B Day):
//
//   Wed 2 Sep 2026   A Day, a Wednesday
//   Thu 3 Sep 2026   B Day, a Thursday
//
// The page's clock is pinned through `sv2StaffClock` (staff/clock.js) at
// 11:40 in New York, which is Period 5 (11:28 to 12:16). Every wait is on
// something the page sets: the document's data-ready, the frame's
// data-state, the view on <main>, a lede's data-period, a list that is there.
// Nothing waits on a first paint or a fixed sleep.

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
import { newMark, newDuty } from '../../engine/schema.js';
import { sampleSchool } from '../../data/sample-school.js';
import { openSchool } from '../../staff/model.js';
import { lockScreenLayout } from '../../staff/outputs.js';
import { dayKindsOf } from '../../staff/views/teacher.js';

const ZONE = 'America/New_York';
const A = 'dsample00a';
const B = 'dsample00b';
const WED = '2026-09-02T15:40:00Z'; // Wed 11:40: A Day, Period 5
const THU = '2026-09-03T15:40:00Z'; // Thu 11:40: B Day, Period 5
const TUE_LATE = '2026-09-02T03:59:00Z'; // Tue 23:59: B Day, two minutes before Wednesday
const WED_EARLY = '2026-09-02T04:01:00Z'; // Wed 00:01: A Day
const HOSTILE = '<img src=x onerror=alert(1)>';
const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }];

function fixture(opts) {
  const project = sampleSchool();
  project.publish.passcode = '';
  const lunch = newMark('mduty00001', 'lunch', 3);
  lunch.scope = 'grades';
  lunch.grades = ['6'];
  const noclass = newMark('mduty00002', 'noclass', 1);
  noclass.scope = 'groups';
  noclass.groupIds = ['gsample06a'];
  noclass.dayTypeIds = [A];
  const assembly = newMark('mduty00003', 'activity', 7);
  assembly.label = 'Assembly';
  assembly.dayTypeIds = [B];
  project.marks = [lunch, noclass, assembly];
  const lunchDuty = newDuty('uduty00001', 'duty');
  Object.assign(lunchDuty, { label: opts && opts.evil ? HOSTILE : 'Lunch duty', when: 'period', period: 3, place: 'Cafeteria', teacherIds: ['tsample001'] });
  const bus = newDuty('uduty00002', 'duty');
  Object.assign(bus, { label: 'Bus duty', when: 'after', start: '15:05', end: '15:25', place: 'Bus loop', teacherIds: ['tsample001', 'tsample002'] });
  const door = newDuty('uduty00003', 'duty');
  Object.assign(door, { label: 'Door duty', when: 'before', start: '07:40', end: '07:55', place: 'Front door', teacherIds: ['tsample002'] });
  const meeting = newDuty('uduty00004', 'meeting');
  Object.assign(meeting, { label: 'Science department', when: 'period', period: 4, weekdays: [2], subjectIds: ['ssample003'] });
  project.duties = [lunchDuty, bus, door, meeting];
  project.calendar = {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day: day < 5 ? 'rotation' : 'closed', bells: null })),
    rotation: [A, B],
    dates: [],
    changedAt: null,
  };
  if (opts && opts.nocal) delete project.calendar;
  return project;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-duties-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, project, at) {
  const made = await publishDocument(read, project, { clock: () => new Date(at), random: seededRandom('staff-duties ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, made.html);
  files[name] = { file, url: pathToFileURL(file).href, model: made.model };
}

before(async () => {
  await write('duties', fixture(), '2026-08-25T12:00:00Z');
  await write('evil', fixture({ evil: true }), '2026-08-25T12:00:00Z');
  await write('nocal', fixture({ nocal: true }), '2026-08-25T12:00:00Z');
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
// read again only when an hour has passed (never, in a case). `every` is how
// often the page looks at it again; `moveClock` sets it to another moment.
async function openPage(options) {
  const opts = options || {};
  const size = opts.size || SIZES[0];
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = size.width < 640;
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
  await page.evaluateOnNewDocument((at, every) => {
    globalThis.sv2At = at;
    globalThis.sv2StaffClock = { now: () => globalThis.sv2At, every };
    globalThis.print = () => {};
  }, opts.at || WED, opts.every || 3600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, errors, close: () => context.close() };
}

const moveClock = (page, at) => page.evaluate((to) => { globalThis.sv2At = to; }, at);

async function goto(page, file, hash) {
  await page.goto(file.url + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
  await viewDrawn(page, hash);
}

async function viewDrawn(page, hash) {
  const view = hash.replace(/^#\//, '').split(/[/?]/)[0];
  await page.waitForFunction((want) => document.querySelector('main.page')?.dataset.view === want && document.querySelector('h1'), { timeout: 10000 }, view);
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const texts = (page, selector) => page.evaluate((s, fn) => Array.from(document.querySelectorAll(s), (el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const one = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, selector);
const count = (page, selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);

// The row of a period on today's card.
const row = (period) => '.day[data-today="true"] .row[data-period="' + period + '"]';

async function noOverflow(page, where) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, where + ': the page is ' + wide + ' px wider than the screen');
}

// The Free page, settled on period 4 (Period 5): the lede says which period it shows.
async function freeReady(page) {
  try {
    await page.waitForFunction(() => document.querySelector('.lede[role="status"]')?.dataset.period === '4' && document.querySelector('[data-list="teachers"]'), { timeout: 10000 });
  } catch (error) {
    assert.fail('Free right now never settled: ' + await page.evaluate(() => document.querySelector('main').textContent.replace(/\s+/g, ' ').slice(0, 400)));
  }
}

// Tab until `selector` has the focus: the way a keyboard reader gets there.
async function tabTo(page, selector, limit) {
  for (let step = 0; step < (limit || 80); step += 1) {
    if (await page.evaluate((s) => document.activeElement && document.activeElement.matches(s), selector)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail('the keyboard never reached ' + selector);
}

// ---------------------------------------------------------------- the fixture

test('the fixture is a valid project, and its calendar says what the header says', () => {
  assert.deepEqual(validate(fixture()), []);
  const school = openSchool(publishedModel(fixture(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  assert.equal(school.dayOn('2026-09-02').dayTypeId, A);
  assert.equal(school.weekdayOf('2026-09-02'), 2, 'a Wednesday');
  assert.equal(school.dayOn('2026-09-03').dayTypeId, B);
  assert.equal(school.data.marks.length, 3, 'the published file carries the marks');
  assert.equal(school.data.duties.length, 4, 'and the duties');
});

// ---------------------------------------------------------------- the lock-screen image

test('the lock-screen image names the duty that takes a free period and lists the duties before and after the day', () => {
  const school = openSchool(publishedModel(fixture(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const lines = (teacherId) => {
    const teacher = school.teacher(teacherId);
    const kinds = dayKindsOf(school, (dayType) => (school.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => [taught.groupId, taught.roomId])));
    return lockScreenLayout(school, teacher, kinds, { locale: 'en-GB', zone: 'UTC' }).items.filter((item) => item.kind === 'text').map((item) => item.text);
  };
  const one = lines('tsample001');
  assert.ok(one.includes('Lunch duty · Cafeteria'), 'the lunch duty: ' + one.filter((t) => /duty/i.test(t)));
  assert.ok(one.includes('Bus duty · Bus loop'));
  const two = lines('tsample002');
  assert.ok(two.includes('Door duty · Front door'));
  assert.ok(two.indexOf('Door duty · Front door') < two.indexOf('Bus duty · Bus loop'), 'before school is above, after school below');
  assert.ok(two.includes('7:40 AM') || two.includes('7:40 AM to 7:55 AM'), 'its time: ' + two.slice(0, 12));
});

// ---------------------------------------------------------------- a teacher's day

for (const size of SIZES) {
  test('a teacher\'s day at ' + size.width + ' px: the duty takes the free period with "Duty" over it, and the edges of the day are rows without a period', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.duties, '#/teacher/tsample001');
      assert.equal(await count(page, '.day[data-today="true"]'), 1, 'today\'s card is first');
      const lunch = await one(page, row(3));
      assert.match(lunch, /Duty/);
      assert.match(lunch, /Lunch duty/);
      assert.match(lunch, /Cafeteria/);
      assert.equal(await one(page, row(3) + ' .row__eyebrow'), 'Duty');
      assert.match(await one(page, row(4)), /Planning$/, 'the free period nothing takes is still planning');
      assert.doesNotMatch(await one(page, row(4)), /Duty|Lunch|Meeting/);
      // after school: a row below the last period, with its times, and no period number
      const after = await one(page, '.day[data-today="true"] .row--edge[data-edge="after"]');
      assert.match(after, /After school/);
      assert.match(after, /3:05 PM to 3:25 PM/);
      assert.match(after, /Bus duty/);
      assert.match(after, /Bus loop/);
      assert.doesNotMatch(after, /Period/);
      assert.equal(await count(page, '.day[data-today="true"] .row--edge[data-edge="before"]'), 0, 'she has no duty before school');
      // the row is the last of its card; periods keep their number order
      const order = await page.evaluate(() => Array.from(document.querySelectorAll('.day[data-today="true"] .rows > li'), (li) => li.dataset.edge || li.dataset.period));
      assert.deepEqual(order, ['0', '1', '2', '3', '4', '5', '6', '7', 'after']);
      await noOverflow(page, 'teacher page');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('a duty before school is a row above the first period, and one after school below the last', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/teacher/tsample002');
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('.day[data-today="true"] .rows > li'), (li) => li.dataset.edge || li.dataset.period));
    assert.deepEqual(order, ['before', '0', '1', '2', '3', '4', '5', '6', '7', 'after']);
    const before = await one(page, '.row--edge[data-edge="before"]');
    assert.match(before, /Before school/);
    assert.match(before, /7:40 AM to 7:55 AM/);
    assert.match(before, /Door duty/);
    assert.match(before, /Front door/);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a duty that holds on Wednesdays takes the period on today\'s card on a Wednesday, is left out on a Thursday, and is listed with its day on the other card', async () => {
  const wed = await openPage({ at: WED });
  try {
    const { page } = wed;
    await goto(page, files.duties, '#/teacher/tsample003');
    const meeting = await one(page, row(4));
    assert.match(meeting, /Science department/);
    assert.equal(await one(page, row(4) + ' .row__eyebrow'), 'Meeting');
    assert.equal(await count(page, row(4) + ' .row__also'), 0, 'it holds today, so it is not an aside');
    // the other card is not today's: the same duty is listed with its day, and takes nothing
    const other = await one(page, '.day:not([data-today]) .row[data-period="4"]');
    assert.match(other, /Science department \(Wednesdays\)/);
    assert.doesNotMatch(other, /Meeting/);
  } finally {
    await wed.close();
  }
  const thu = await openPage({ at: THU });
  try {
    const { page } = thu;
    await goto(page, files.duties, '#/teacher/tsample003');
    assert.equal(await count(page, '.day[data-today="true"] .row[data-period="4"] .row__eyebrow'), 0, 'not a meeting on a Thursday');
    assert.doesNotMatch(await one(page, row(4)), /Science department/, 'left out of today\'s card altogether');
    assert.match(await one(page, '.day:not([data-today]) .row[data-period="4"]'), /Science department \(Wednesdays\)/, 'the Wednesday card still lists it');
    assert.deepEqual(thu.errors, []);
  } finally {
    await thu.close();
  }
});

test('a file with neither list shows the teacher\'s day as it was: Planning, and no row without a period', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.plain, '#/teacher/tsample001');
    assert.equal(await count(page, '.row--edge'), 0);
    assert.equal(await count(page, '.row__eyebrow'), 0);
    assert.match(await one(page, '.day .row[data-period="3"]'), /Planning$/);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- free right now

for (const size of SIZES) {
  test('Free right now at ' + size.width + ' px: a teacher at a meeting today is not free, and is free on a Thursday', async () => {
    const wed = await openPage({ size, at: WED });
    try {
      const { page } = wed;
      await goto(page, files.duties, '#/free');
      await freeReady(page);
      const free = await texts(page, '[data-list="teachers"] .list__name');
      assert.ok(free.includes('Ms. Halloran'), 'free in period 5');
      assert.ok(!free.includes('Dr. Quillfeather'), 'at the Wednesday science meeting: ' + free.join(', '));
      assert.ok(!free.includes('Ms. Thistlewood'), 'every science teacher');
      assert.deepEqual(wed.errors, []);
    } finally {
      await wed.close();
    }
    const thu = await openPage({ size, at: THU });
    try {
      const { page } = thu;
      // A Day's Period 5 looked at on a Thursday: no date makes it a Wednesday
      await goto(page, files.duties, '#/free?p=4&d=' + A);
      await page.waitForFunction(() => document.querySelector('.lede[role="status"]')?.dataset.period === '4' && document.querySelector('[data-list="teachers"]'), { timeout: 10000 });
      const free = await texts(page, '[data-list="teachers"] .list__name');
      assert.ok(free.includes('Dr. Quillfeather'), 'a Thursday: the Wednesday meeting takes nothing: ' + free.join(', '));
    } finally {
      await thu.close();
    }
  });
}

test('Free right now by keyboard: choose Period 4 and the lunch duty is not free; choose Period 2 and Room 103 is empty because 6A has no class', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/free');
    await freeReady(page);
    await tabTo(page, '[data-pick="period"]');
    const choose = async (period) => {
      // ArrowDown on the focused list moves one option and tells the page
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction((want) => document.querySelector('.lede[role="status"]')?.dataset.period === want && document.activeElement?.dataset.pick === 'period', { timeout: 10000 }, String(period));
    };
    // from Now, the options are Now, Period 1, Period 2, ...
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.lede[role="status"]')?.dataset.period === '0' && document.activeElement?.dataset.pick === 'period');
    await choose(1);
    // A Day, Period 2: Room 103 has no group in it, since 6A's period is No class
    const rooms = await texts(page, '[data-list="rooms"] .list__name');
    assert.ok(rooms.some((name) => /103/.test(name)), 'Room 103 is empty: ' + rooms.join(', '));
    await choose(2);
    await choose(3);
    const free = await texts(page, '[data-list="teachers"] .list__name');
    assert.ok(!free.includes('Ms. Halloran'), 'on lunch duty in Period 4');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- where right now

test('Where right now: a No class period, a lunch with its room, and a teacher on duty', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/now?g=gsample06a&p=1&d=' + A);
    assert.match(await one(page, '[data-where="sentence"]'), /^6A has no class in Period 2\.$/);
    await goto(page, files.duties, '#/now?g=gsample06a&p=3&d=' + A);
    const lunch = await one(page, '[data-where="sentence"]');
    assert.match(lunch, /^6A is at Lunch in Period 4 in .*afeteria/);
    await goto(page, files.duties, '#/now?t=tsample001&p=3&d=' + A);
    assert.match(await one(page, '[data-where="sentence"]'), /^Ms\. Halloran has Lunch duty in Period 4 in Cafeteria\.$/);
    await goto(page, files.duties, '#/now?t=tsample001&p=4&d=' + A);
    assert.match(await one(page, '[data-where="sentence"]'), /it is planning\.$/, 'a free period nothing takes');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- groups and rooms

for (const size of SIZES) {
  test('a group at ' + size.width + ' px: No class reads No class, a lunch reads Lunch with its room', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.duties, '#/group/gsample06a');
      const none = await one(page, row(1));
      assert.match(none, /No class/);
      assert.equal(await count(page, row(1) + ' [data-mark="noclass"]'), 1);
      const lunch = await one(page, row(3));
      assert.match(lunch, /Lunch/);
      assert.match(lunch, /afeteria/, 'the room it keeps');
      // the table of who teaches does not list the lunch or the No class period as a lesson
      const table = await one(page, '.table');
      assert.doesNotMatch(table, /Lunch/);
      await noOverflow(page, 'group page');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('a room page and a door sign: a room is empty in a period its group has no class in', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/room/rsample103');
    assert.match(await one(page, row(1)), /Empty$/);
    await goto(page, files.plain, '#/room/rsample103');
    assert.doesNotMatch(await one(page, '.day .row[data-period="1"]'), /Empty$/, 'with no mark 6A is there');
    await goto(page, files.duties, '#/door/rsample103?day=1');
    await page.waitForFunction(() => document.querySelector('[data-sheet="door"]'));
    const sign = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sheet="door"] tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(sign.some((line) => /Period 2.*Empty/.test(line)), 'the sign\'s day: ' + sign.slice(0, 4).join(' | '));
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- coverage

for (const size of SIZES) {
  test('Coverage at ' + size.width + ' px by keyboard: a teacher on duty is under a folded Not free list with the reason, not among those free', async () => {
    const session = await openPage({ size });
    try {
      const { page } = session;
      await goto(page, files.duties, '#/coverage/tsample002');
      const card = '[data-period="3"]';
      assert.ok(await count(page, card + ' [data-list="candidates"]') > 0, 'somebody is free in Period 4');
      const free = await texts(page, card + ' [data-list="candidates"] .list__name');
      assert.ok(!free.some((name) => name.startsWith('Ms. Halloran')), 'on duty, so not a candidate: ' + free.join(', '));
      assert.equal(await page.evaluate((s) => document.querySelector(s).open, card + ' details.notfree'), false, 'folded');
      assert.match(await one(page, card + ' .notfree__summary'), /^Not free \(\d+\)$/);
      await tabTo(page, card + ' .notfree__summary');
      await page.keyboard.press('Enter');
      await page.waitForFunction((s) => document.querySelector(s).open, {}, card + ' details.notfree');
      const busy = await texts(page, card + ' [data-list="notfree"] li');
      assert.ok(busy.some((line) => /Ms\. Halloran.*On duty: Lunch duty/.test(line)), busy.join(' | '));
      await noOverflow(page, 'coverage');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('Coverage with no duty in the file has no Not free list', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.plain, '#/coverage/tsample002');
    assert.equal(await count(page, '.notfree'), 0);
    assert.ok((await count(page, '[data-list="candidates"]')) > 0);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- the substitute plan

test('the substitute plan lists the absent teacher\'s duties with times and places, for the date shown', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/sub/tsample001?date=2026-09-02');
    await page.waitForFunction(() => document.querySelector('[data-sub="duties"]'));
    const duties = await texts(page, '[data-sub="duties"] li');
    assert.deepEqual(duties, ['Period 4: Lunch duty · Cafeteria', 'After school: Bus duty · Bus loop · 3:05 PM to 3:25 PM']);
    // the day above says the same of the free period
    assert.match(await one(page, '[data-sub="day"] [data-period="3"]'), /Lunch duty · Cafeteria/);
    // a science teacher: the meeting is on this Wednesday and not on the Thursday
    await goto(page, files.duties, '#/sub/tsample003?date=2026-09-02');
    await page.waitForFunction(() => document.querySelector('[data-sub="day"]'));
    assert.deepEqual(await texts(page, '[data-sub="duties"] li'), ['Period 5: Science department']);
    await goto(page, files.duties, '#/sub/tsample003?date=2026-09-03');
    await page.waitForFunction(() => document.querySelector('[data-sub="day"]'));
    assert.equal(await count(page, '[data-sub="duties"]'), 0, 'no duty on a Thursday: no card');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- common planning

test('common planning: the teacher on duty is not free with the others', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/common?t=tsample001,tsample002');
    await page.waitForFunction(() => document.querySelector('[data-out="common"] .card'));
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-out="common"] .card')[0].querySelectorAll('tbody tr'), (tr) => ({ period: tr.dataset.period, all: tr.dataset.all === 'true', text: tr.textContent.replace(/\s+/g, ' ').trim() })));
    const four = rows.find((each) => each.period === '3');
    assert.equal(four.all, false);
    assert.match(four.text, /Lunch duty/, 'her cell reads the duty, not Free');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- names are text

test('a duty named with markup is shown as typed and never as markup', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.evil, '#/teacher/tsample001');
    assert.match(await one(page, row(3)), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await count(page, 'img'), 0, 'no element was made of it');
    await goto(page, files.evil, '#/coverage/tsample002');
    await tabTo(page, '[data-period="3"] .notfree__summary');
    await page.keyboard.press('Enter');
    const busy = await texts(page, '[data-period="3"] [data-list="notfree"] li');
    assert.ok(busy.some((line) => line.includes('On duty: <img src=x onerror=alert(1)>')), busy.join(' | '));
    assert.equal(await count(page, 'img'), 0);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- on paper

test('on paper the duties before and after school are rows of the day', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/teacher/tsample002');
    await page.emulateMediaType('print');
    const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.day[data-today="true"] .row--edge'), (el) => el.offsetHeight > 0));
    assert.deepEqual(shown, [true, true]);
    await page.emulateMediaType('screen');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- with no calendar, and past midnight

test('with no calendar, a Wednesday meeting takes a teacher out of Free right now and Where right now', async () => {
  const session = await openPage({ at: WED });
  try {
    const { page } = session;
    await goto(page, files.nocal, '#/free');
    await freeReady(page);
    await page.waitForFunction(() => document.querySelector('[data-list="teachers"]'));
    const free = await texts(page, '[data-list="teachers"] .list__name');
    assert.ok(free.length > 0 && !free.includes('Dr. Quillfeather') && !free.includes('Ms. Thistlewood'), 'at the science meeting: ' + free.join(', '));
    // the same school on a Thursday: the meeting does not hold
    const thursday = await openPage({ at: THU });
    try {
      await goto(thursday.page, files.nocal, '#/free');
      await freeReady(thursday.page);
      assert.ok((await texts(thursday.page, '[data-list="teachers"] .list__name')).includes('Dr. Quillfeather'), 'free on a Thursday');
    } finally {
      await thursday.close();
    }
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Common planning and Coverage redraw past midnight, and a duty that holds on the new date applies', async () => {
  const session = await openPage({ at: TUE_LATE, every: 200 });
  try {
    const { page } = session;
    // Common planning: Tuesday night, the two science teachers are free together in Period 5 on A Day
    await goto(page, files.duties, '#/common?t=tsample003,tsample010');
    const cell = '[data-out="common"] .card[data-days~="dsample00a"] tr[data-period="4"]';
    await page.waitForFunction((s) => document.querySelector(s)?.dataset.all === 'true', { timeout: 10000 }, cell);
    await moveClock(page, WED_EARLY);
    await page.waitForFunction((s) => document.querySelector(s) && document.querySelector(s).dataset.all !== 'true', { timeout: 10000 }, cell);
    assert.match(await one(page, cell), /Science department/, 'the Wednesday meeting');
    // Coverage with A Day chosen: Dr. Quillfeather is a candidate until Wednesday begins
    await moveClock(page, TUE_LATE);
    await goto(page, files.duties, '#/coverage/tsample004?d=dsample00a');
    const card = '[data-period="4"]';
    await page.waitForFunction((s) => document.querySelector(s + ' [data-list="candidates"]'), { timeout: 10000 }, card);
    assert.ok((await texts(page, card + ' [data-list="candidates"] .list__name')).some((name) => name.startsWith('Dr. Quillfeather')), 'free before midnight');
    await moveClock(page, WED_EARLY);
    await page.waitForFunction((s) => document.querySelector(s + ' [data-list="notfree"]'), { timeout: 10000 }, card);
    assert.ok(!(await texts(page, card + ' [data-list="candidates"] .list__name')).some((name) => name.startsWith('Dr. Quillfeather')), 'a candidate no more');
    assert.ok((await texts(page, card + ' [data-list="notfree"] li')).some((line) => /Dr\. Quillfeather.*At a meeting: Science department/.test(line)));
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a door sign prints a group\'s mark in the day table', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.duties, '#/door/rsamplecaf?day=1');
    await page.waitForFunction(() => document.querySelector('[data-sheet="door"]'));
    const sign = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sheet="door"] tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(sign.some((line) => /^Period 4.*6A \(Lunch\)/.test(line)), 'the lunch is printed: ' + sign.slice(0, 5).join(' | '));
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});
