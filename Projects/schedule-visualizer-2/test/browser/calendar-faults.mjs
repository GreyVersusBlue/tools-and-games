// The Calendar tab's second review, in a real browser: node test/browser/calendar-faults.mjs
//
// SV2-80c. The faults found in SV2-80b's work: a run of dates changes a day
// type only when the reader picks it (a note or bells alone write none; "No
// school" already checked on a run that holds school days still closes it),
// the panel's Breaks across weekends and closed weekdays, the publish record
// on the device, Apply on a 731-day calendar with "Every date as a list"
// open, and a Shift-run over dates already closed. The clock is pinned to
// Tuesday 1 September 2026, 9:00 UTC. Every wait is on a state the page sets
// (`data-pending` gone from the section, a dialog open or gone, a toast's
// words), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch, loadModule } from './harness.mjs';

let server;
let browser;
let session;
let page;
const alerts = [];

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

// Timing budgets are Huginn's; a slower runner (CI) gets three times as long.
const SLOW = process.env.CI ? 3 : 1;
const HOSTILE = '<img src=x onerror=alert(1)>';
const HOSTILE_BELLS = '<b>"Early" & late</b>';

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
async function toastSays(words) {
  try {
    await shows((wanted) => document.querySelector('.toast .toast__text')?.textContent === wanted, words);
  } catch (error) {
    assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null), words);
  }
}
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());
const cell = (date) => '.cal-day[data-date="' + date + '"]';
const activeDate = () => page.evaluate(() => document.activeElement?.dataset.date || null);
const dialogOpen = () => shows(() => document.getElementById('calendar-date-dialog')?.open === true);
const dialogGone = () => shows(() => document.getElementById('calendar-date-dialog') === null);
const dialogApply = () => text('#calendar-date-dialog [data-action="apply-date"]');
const ownChange = (date) => page.evaluate((wanted) => (globalThis.sv2.store.project.calendar?.dates || []).find((entry) => entry.date === wanted) || null, date);
const walk = () => page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).map((day) => day.dayTypeId).join());

// A calendar of exactly this shape, whatever was there; the date dialog and
// the toast gone.
async function fresh(config) {
  await page.evaluate(() => document.getElementById('calendar-date-dialog')?.querySelector('[data-action="close-date"]')?.click());
  await closeToast();
  await settled();
  await page.evaluate((given) => {
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.makeCalendar, { replace: true, ...given });
  }, config);
  await settled();
}

const YEAR = { start: '2026-08-31', end: '2027-06-11' };

async function setValue(selector, value) {
  await page.$eval(selector, (el, wanted) => {
    el.focus();
    el.value = wanted;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function openDate(date) {
  await settled();
  await closeToast();
  await page.click(cell(date));
  await dialogOpen();
}

async function closeDialog() {
  await page.keyboard.press('Escape');
  await dialogGone();
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 800 });
  page = session.page;
  page.on('dialog', async (dialog) => {
    alerts.push(dialog.message());
    await dialog.dismiss();
  });
  await page.emulateTimezone('UTC');
  await page.evaluateOnNewDocument(pinClock);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.sch');
  await settled();
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'calendar', 'engine/calendar.js');
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addBellSchedule, { name: 'Early Release' }));
  await go(page, '#schedule/calendar');
  await settled();
  await fresh(YEAR);
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(alerts, [], 'a typed name was run as markup');
});


test('a note or bells alone on a run write no day type; the picked day, and "No school" already checked on a run with school days, do', async () => {
  await fresh(YEAR);
  const early = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  const before = await walk();
  // a note on a weekday run (p6): the day checked is only the first date's own
  await openDate('2026-11-02');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-11-06');
  assert.equal(await dialogApply(), 'Apply', 'nothing chosen yet');
  await page.focus('#calendar-date-dialog input[name="note"]');
  await page.keyboard.type('Spirit week');
  assert.equal(await dialogApply(), 'Change 5 dates in the calendar');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) assert.deepEqual(await ownChange(date), { date, day: null, bells: null, label: 'Spirit week' }, date + ' has a note and no day type');
  assert.equal(await walk(), before, 'no date’s day type moved');
  // a note on a run of weekend days (p7)
  await openDate('2026-11-14');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-11-15');
  await page.focus('#calendar-date-dialog input[name="note"]');
  await page.keyboard.type('Fair');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  for (const date of ['2026-11-14', '2026-11-15']) assert.deepEqual(await ownChange(date), { date, day: null, bells: null, label: 'Fair' }, date + ' has a note and no day type');
  assert.equal(await walk(), before, 'the weekend is still closed and nothing else moved');
  // bells alone on a weekend run: no school day, nothing to change
  await openDate('2026-11-21');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-11-22');
  await page.$eval('#calendar-date-dialog [data-part="bells"] input[value="' + early + '"]', (input) => input.click());
  assert.equal(await dialogApply(), 'No school days to change');
  await closeDialog();
  // the day picked, then put back to the first date's own, on a run: chosen
  await openDate('2026-11-09');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-11-11');
  const own = await page.$eval('#calendar-date-dialog [data-part="day"] input:checked', (input) => input.value);
  await page.$eval('#calendar-date-dialog [data-part="day"] input[value="closed"]', (input) => input.click());
  await page.$eval('#calendar-date-dialog [data-part="day"] input[value="' + own + '"]', (input) => input.click());
  assert.equal(await dialogApply(), 'Set 3 dates to ' + await page.evaluate((id) => globalThis.sv2.store.project.dayTypes.find((each) => each.id === id).name, own));
  await closeDialog();
  // "No school" already checked on a run that starts on a Saturday and holds school days, with a note: the break closes
  await openDate('2027-03-13');
  await setValue('#calendar-date-dialog input[name="through"]', '2027-03-21');
  await page.focus('#calendar-date-dialog input[name="note"]');
  await page.keyboard.type('Spring break');
  assert.equal(await dialogApply(), 'Set 5 school days to No school');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  assert.equal((await ownChange('2027-03-17')).day, 'closed');
  assert.equal(await ownChange('2027-03-14') === null || (await ownChange('2027-03-14')).day === null, true, 'the Sunday inside it is not given a day');
});

test('the panel’s Breaks: a spring break that starts on a Friday is one break, where the engine’s test holds the rest (p10)', async () => {
  await fresh(YEAR);
  await openDate('2027-04-09');
  await setValue('#calendar-date-dialog input[name="through"]', '2027-04-16');
  await page.$eval('#calendar-date-dialog input[value="closed"]', (input) => input.click());
  await page.focus('#calendar-date-dialog input[name="note"]');
  await page.keyboard.type('Spring break');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  const breaks = () => page.$$eval('[data-part="breaks"] li > span', (all) => all.map((each) => each.textContent));
  assert.deepEqual(await breaks(), ['Spring break: 9 to 16 April, 6 school days'], 'one break across the weekend');
});
