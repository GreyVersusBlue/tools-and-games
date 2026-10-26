// The Calendar tab in a real browser: node test/browser/calendar.mjs
//
// DESIGN 11.4 by pointer, keyboard and touch, with the clock pinned to
// Tuesday 1 September 2026 at 9:00 in UTC. On the sample school, with an
// Early Release bell schedule: a calendar is made from the setup card, from
// 31 August 2026 to 11 June 2027, Wednesdays on Early Release bells and a
// winter break; then a snow day and its toast, a Saturday make-up day, a
// re-sync, a change of bells alone (day null: as the weekday says), each
// undone and done again; the year by keyboard, with a date's name as a
// screen reader has it; a run through the dialog's Through; the list; the
// print preview; the CSV saved and read back; Remove and Undo; the publish
// form's two calendar lines; and the tab at 390 by 844 with touch. Every wait
// is on a state the page sets (`data-pending` gone from the section, a
// dialog open or gone, a toast's words), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch, loadModule, assertTouch } from './harness.mjs';

let server;
let browser;
let session;
let page;

// The clock every page here reads: Tuesday 1 September 2026, 9:00, UTC.
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

const TODAY = '2026-09-01';

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
// a toast's words; on a miss, the words it had are what the failure says
async function toastSays(words) {
  try {
    await shows((wanted) => document.querySelector('.toast .toast__text')?.textContent === wanted, words);
  } catch (error) {
    assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null), words);
  }
}
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());
const cell = (date) => '.cal-day[data-date="' + date + '"]';
const nameOf = (date) => page.$eval(cell(date), (el) => el.getAttribute('aria-label'));
const activeDate = () => page.evaluate(() => document.activeElement?.dataset.date || null);
const dialogOpen = () => shows(() => document.getElementById('calendar-date-dialog')?.open === true);
const dialogGone = () => shows(() => document.getElementById('calendar-date-dialog') === null);
const dayOn = (date) => page.evaluate((wanted) => globalThis.sv2modules.calendar.dayOn(globalThis.sv2.store.project, wanted), date);
const ownChange = (date) => page.evaluate((wanted) => (globalThis.sv2.store.project.calendar?.dates || []).find((entry) => entry.date === wanted) || null, date);
const dayName = (id) => page.evaluate((wanted) => globalThis.sv2.store.project.dayTypes.find((dayType) => dayType.id === wanted)?.name, id);

async function click(selector) {
  await settled();
  if (!selector.startsWith('.toast')) await closeToast();
  await page.click(selector);
}

// A date input given a value as the date picker would: input, then change.
async function setDate(selector, value) {
  await settled();
  await page.$eval(selector, (el, wanted) => {
    el.focus();
    el.value = wanted;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await settled();
}

async function chooseRadio(part, value) {
  await page.$eval('#calendar-date-dialog [data-part="' + part + '"] input[value="' + value + '"]', (input) => input.click());
}

async function undoFromToast() {
  await page.evaluate(() => Array.from(document.querySelectorAll('.toast button')).find((button) => button.textContent === 'Undo').click());
  await shows(() => (document.querySelector('.toast .toast__text')?.textContent || '').startsWith('Undid: '));
  await settled();
}

async function redo() {
  await page.evaluate(() => globalThis.sv2.ctx.redo());
  await shows(() => (document.querySelector('.toast .toast__text')?.textContent || '').startsWith('Redid: '));
  await settled();
}

// Open the date dialog on a date by a click, and wait for it.
async function openDate(date) {
  await click(cell(date));
  await dialogOpen();
  await shows((wanted) => document.getElementById('calendar-date-dialog').querySelector('.dialog__title').textContent.length > 0, date);
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 800 });
  page = session.page;
  await page.emulateTimezone('UTC');
  await page.evaluateOnNewDocument(pinClock);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.sch');
  await settled();
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'calendar', 'engine/calendar.js');
  // an Early Release bell schedule, as the Day tab makes one
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addBellSchedule, { name: 'Early Release' }));
  await go(page, '#schedule/calendar');
  await settled();
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('the clock is pinned: the page’s today is Tuesday 1 September 2026', async () => {
  assert.equal(await page.evaluate(() => new Date().toISOString()), '2026-09-01T09:00:00.000Z');
});

test('with no calendar the tab says what one is for, with one button; the tab sits after Day', async () => {
  assert.deepEqual(await page.$$eval('.sch .tabs__tab', (all) => all.map((tab) => tab.textContent)), ['Groups', 'Grid', 'Teachers', 'Subjects', 'Day', 'Calendar', 'Checks', 'Import']);
  assert.equal(await text('[data-empty="calendar"] .sch-empty__text'), 'No calendar yet. A calendar says which day type each date is, so the staff browser knows what today is.');
  assert.deepEqual(await page.$$eval('[data-empty="calendar"] button', (all) => all.map((el) => el.textContent)), ['Make a calendar']);
});

test('the setup card: dates, Monday to Friday on, Wednesdays on Early Release bells, a winter break counted in school days', async () => {
  await click('[data-action="make-a-calendar"]');
  await page.waitForSelector('.cal-setup');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'cal-setup-start', 'the focus is on the first field');
  assert.deepEqual(await page.$$eval('.cal-toggle', (all) => all.map((el) => el.textContent + ':' + el.getAttribute('aria-pressed'))), ['Monday:true', 'Tuesday:true', 'Wednesday:true', 'Thursday:true', 'Friday:true', 'Saturday:false', 'Sunday:false']);
  assert.deepEqual(await page.$$eval('.cal-setup .cal-chip__name', (all) => all.map((el) => el.textContent)), ['A Day', 'B Day']);
  await setDate('[data-key="cal-setup-start"]', '2026-08-31');
  await setDate('[data-key="cal-setup-end"]', '2027-06-11');
  const early = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  await page.select('[data-key="cal-setup-bells:2"]', early);
  await click('[data-key="cal-setup-add-break"]');
  await page.waitForSelector('[data-key="cal-setup-break:0:from"]');
  await setDate('[data-key="cal-setup-break:0:from"]', '2026-12-21');
  await setDate('[data-key="cal-setup-break:0:to"]', '2027-01-01');
  await page.focus('[data-key="cal-setup-break:0:name"]');
  await page.keyboard.type('Winter break');
  assert.equal(await text('.cal-break [data-says="break-days"]'), '10 school days', 'the break says how many school days it closes, not its 12 dates');
  await click('[data-action="make-calendar"]');
  await page.waitForSelector('.cal-year .cal-day');
  const school = await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).filter((day) => day.school).length);
  await toastSays('Made the calendar: ' + school + ' school days from 31 August 2026 to 11 June 2027. Winter break: 10 school days.');
  assert.equal(await activeDate(), TODAY, 'the focus is on today in the year');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.calendar.weekdays[2].bells !== null), true);
});

test('the year: eleven months, each a grid named by its heading; today ringed and the one Tab stop; a date named by its whole sentence', async () => {
  const months = await page.$$eval('.cal-month', (all) => all.map((month) => {
    const grid = month.querySelector('table');
    return [month.querySelector('h3').textContent, grid.getAttribute('role'), document.getElementById(grid.getAttribute('aria-labelledby')).textContent];
  }));
  assert.equal(months.length, 11);
  assert.deepEqual(months[0], ['August 2026', 'grid', 'August 2026']);
  assert.deepEqual(months[10], ['June 2027', 'grid', 'June 2027']);
  assert.deepEqual(await page.$$eval('.cal-day[tabindex="0"]', (all) => all.map((el) => el.dataset.date)), [TODAY]);
  assert.equal(await page.$eval(cell(TODAY), (el) => el.getAttribute('aria-current')), 'date');
  assert.equal(await nameOf(TODAY), 'Tuesday 1 September 2026: B Day. Today.');
  assert.equal(await nameOf('2026-09-02'), 'Wednesday 2 September 2026: A Day with Early Release bells.');
  assert.equal(await nameOf('2026-12-24'), 'Thursday 24 December 2026: no school, Winter break. Changed by hand.');
  assert.deepEqual(await page.$eval(cell('2026-09-02'), (el) => [el.querySelector('.cal-day__t').textContent, el.querySelector('.cal-day__b').textContent]), ['A', 'ER']);
  assert.equal(await page.$eval(cell('2026-12-24') + ' .cal-day__t', (el) => el.textContent), 'Winter');
  assert.equal(await page.$eval(cell('2026-09-05') + ' .cal-day__t', (el) => el.textContent), 'No');
  // weekday headers carry the whole name; the blank cells are presentation
  assert.equal(await page.$eval('.cal-month__grid th abbr', (el) => el.title), 'Sunday');
  assert.ok(await exists('.cal-month__grid td[role="presentation"]'));
  // the panel, in the inspector at this width, with its sentence
  assert.equal(await page.$eval('#inspector .cal-panel [data-says="summary"]', (el) => el.textContent), (await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).filter((day) => day.school).length)) + ' school days from 31 August 2026 to 11 June 2027. Today is a B Day.');
});

test('a screen reader hears a date as its whole sentence, inside a grid named by its month', async () => {
  await page.focus(cell(TODAY));
  const handle = await page.$(cell(TODAY));
  const node = await page.accessibility.snapshot({ root: handle, interestingOnly: false });
  assert.equal(node.role, 'gridcell');
  assert.equal(node.name, 'Tuesday 1 September 2026: B Day. Today.');
  const grid = await page.$('.cal-month[data-month="2026-09"] table');
  const table = await page.accessibility.snapshot({ root: grid, interestingOnly: false });
  assert.equal(table.role, 'grid');
  assert.equal(table.name, 'September 2026');
  assert.equal(table.multiselectable, true);
});

test('a snow day by pointer: the dialog, Apply naming it, the toast saying later dates moved, the focus back on the date; Undo and Redo', async () => {
  const before15 = (await dayOn('2026-10-15')).dayTypeId;
  await openDate('2026-10-14');
  assert.equal(await text('#calendar-date-dialog .dialog__title'), 'Wednesday 14 October 2026');
  assert.equal(await page.evaluate(() => document.getElementById('calendar-date-dialog').getAttribute('aria-labelledby') === document.querySelector('#calendar-date-dialog .dialog__title').id), true, 'the dialog is named by the date');
  assert.equal(await page.evaluate(() => document.activeElement.type === 'radio' && document.activeElement.checked), true, 'the focus is on the day it has');
  assert.equal(await page.evaluate(() => document.getElementById('calendar-date-dialog').matches(':modal')), false, 'the dialog is not modal');
  await chooseRadio('day', 'closed');
  await page.focus('#calendar-date-dialog input[name="note"]');
  await page.keyboard.type('Snow day');
  assert.equal(await text('[data-action="apply-date"]'), 'Set 14 October to No school');
  await page.click('[data-action="apply-date"]');
  await dialogGone();
  await toastSays('No school on 14 October. The rotation moves back a day from 15 October.');
  assert.equal(await activeDate(), '2026-10-14', 'the focus is back on the date');
  assert.equal(await nameOf('2026-10-14'), 'Wednesday 14 October 2026: no school, Snow day. Changed by hand.');
  assert.notEqual((await dayOn('2026-10-15')).dayTypeId, before15, 'the next school day moved back');
  await undoFromToast();
  assert.equal(await ownChange('2026-10-14'), null);
  assert.equal((await dayOn('2026-10-15')).dayTypeId, before15);
  await redo();
  assert.deepEqual(await ownChange('2026-10-14'), { date: '2026-10-14', day: 'closed', bells: null, label: 'Snow day' });
});

test('a Saturday make-up day takes the next in the rotation, and the rotation moves on; Undo and Redo', async () => {
  assert.equal((await dayOn('2026-10-17')).school, false);
  await openDate('2026-10-17');
  await chooseRadio('day', 'rotation');
  assert.equal(await text('[data-action="apply-date"]'), 'Set 17 October to Next in the rotation');
  await page.click('[data-action="apply-date"]');
  await dialogGone();
  await toastSays('17 October takes the next day in the rotation. The rotation moves on from 19 October.');
  assert.equal((await dayOn('2026-10-17')).school, true);
  await undoFromToast();
  assert.equal((await dayOn('2026-10-17')).school, false);
  await redo();
  assert.equal((await dayOn('2026-10-17')).school, true);
});

test('a re-sync: a date set to a day type in the rotation, and the days after follow on from it; Undo and Redo', async () => {
  const was = await dayOn('2026-10-19');
  const ids = await page.evaluate(() => globalThis.sv2.store.project.dayTypes.map((dayType) => dayType.id));
  const other = ids.find((id) => id !== was.dayTypeId);
  const name = await dayName(other);
  await openDate('2026-10-19');
  await chooseRadio('day', other);
  assert.equal(await text('[data-action="apply-date"]'), 'Set 19 October to ' + name);
  await page.click('[data-action="apply-date"]');
  await dialogGone();
  await toastSays('19 October is ' + name + '. Later dates follow on from it, from 20 October.');
  assert.equal((await dayOn('2026-10-20')).dayTypeId, was.dayTypeId, 'the next school day follows on');
  await undoFromToast();
  assert.equal((await dayOn('2026-10-19')).dayTypeId, was.dayTypeId);
  await redo();
  assert.equal((await dayOn('2026-10-19')).dayTypeId, other);
});

test('a change of bells alone writes day null (as the weekday says) and moves nothing later; Undo', async () => {
  const later = await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).map((day) => day.dayTypeId).join());
  const early = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  await openDate('2026-10-22');
  await chooseRadio('bells', early);
  assert.equal(await text('[data-action="apply-date"]'), 'Change 22 October in the calendar');
  await page.click('[data-action="apply-date"]');
  await dialogGone();
  await toastSays('22 October has Early Release bells.');
  assert.deepEqual(await ownChange('2026-10-22'), { date: '2026-10-22', day: null, bells: early, label: '' });
  assert.equal(await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).map((day) => day.dayTypeId).join()), later, 'no day type moved');
  assert.match(await nameOf('2026-10-22'), /with Early Release bells\. Changed by hand\.$/);
  await undoFromToast();
  assert.equal(await ownChange('2026-10-22'), null);
});

test('the year by keyboard: arrows in date order across a month’s edge, Page Down, Home and End, a Shift run with its status, Enter on the run, Escape back to the date', async () => {
  await closeToast();
  await page.focus(cell('2026-09-30'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeDate(), '2026-10-01', 'right from 30 September is 1 October, in the next month');
  await page.keyboard.press('ArrowUp');
  assert.equal(await activeDate(), '2026-09-24');
  await page.keyboard.press('PageDown');
  assert.equal(await activeDate(), '2026-10-24');
  await page.keyboard.press('Home');
  assert.equal(await activeDate(), '2026-10-18', 'Home is the Sunday the week starts on');
  await page.keyboard.press('End');
  assert.equal(await activeDate(), '2026-10-24');
  // the roving stop moved with the focus
  assert.deepEqual(await page.$$eval('.cal-day[tabindex="0"]', (all) => all.map((el) => el.dataset.date)), ['2026-10-24']);
  await page.focus(cell('2026-12-21'));
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  assert.equal(await text('.cal-status'), '5 dates selected, 21 to 25 December');
  assert.deepEqual(await page.$$eval('.cal-day[aria-selected="true"]', (all) => all.map((el) => el.dataset.date)), ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25']);
  await page.keyboard.press('Enter');
  await dialogOpen();
  assert.equal(await text('#calendar-date-dialog .dialog__title'), '21 to 25 December');
  assert.equal(await page.$eval('#calendar-date-dialog input[name="through"]', (el) => el.value), '2026-12-25');
  await page.keyboard.press('Escape');
  await dialogGone();
  assert.equal(await activeDate(), '2026-12-21', 'Escape returns the focus to the date the dialog was opened from');
});

test('Through: a run of dates without a Shift key, set to No school in one step, the button counting school days', async () => {
  await openDate('2026-11-23');
  await page.$eval('#calendar-date-dialog input[name="through"]', (el) => {
    el.value = '2026-11-29';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await text('#calendar-date-dialog .dialog__title'), '23 to 29 November');
  await chooseRadio('day', 'closed');
  assert.equal(await text('[data-action="apply-date"]'), 'Set 5 school days to No school', 'the weekend inside the run is not counted');
  await page.click('[data-action="apply-date"]');
  await dialogGone();
  assert.equal((await dayOn('2026-11-25')).school, false);
  assert.match(await page.evaluate(() => document.querySelector('.toast .toast__text').textContent), /^No school on 23 to 29 November\./);
  await undoFromToast();
  assert.equal((await dayOn('2026-11-25')).school, true);
});

test('every date as a list: one row per date, with why', async () => {
  assert.equal(await page.$eval('.cal-list', (el) => el.open), false, 'folded on a wide screen');
  await click('.cal-list__summary');
  await page.waitForSelector('.cal-list__table');
  const rows = await page.$$eval('.cal-list__table tbody tr', (all) => all.length);
  assert.equal(rows, await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).length));
  assert.deepEqual(await page.$eval('.cal-list__table tr[data-date="2026-10-14"]', (row) => Array.from(row.children, (each) => each.textContent)), ['14 October 2026', 'Wednesday', 'No school', '', 'changed by hand', 'Snow day']);
  assert.deepEqual(await page.$eval('.cal-list__table tr[data-date="2026-09-02"]', (row) => Array.from(row.children, (each) => each.textContent)), ['2 September 2026', 'Wednesday', 'A Day', 'Early Release', 'rotation; Wednesdays have Early Release bells', '']);
  await click('.cal-list__summary');
  await shows(() => document.querySelector('.cal-list__table') === null);
});

test('Print the calendar: the preview shows the year as months with the key', async () => {
  await click('#print-calendar');
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 15000 });
  const doc = await page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe').contentDocument;
    return { months: frame.querySelectorAll('.cal-print__month').length, key: frame.querySelectorAll('.cal-print__key li').length, title: document.querySelector('.preview__title').textContent };
  });
  assert.deepEqual(doc, { months: 11, key: 5, title: 'Print: Calendar' });
  await page.keyboard.press('Escape');
  await shows(() => document.getElementById('print-preview') === null);
});

test('Save as CSV, then Import dates… with that file: nothing to change; a changed row is shown before Apply', async () => {
  // the file the button hands the browser, kept as it is made
  await page.evaluate(() => {
    const made = URL.createObjectURL.bind(URL);
    globalThis.sv2saved = [];
    URL.createObjectURL = (blob) => {
      globalThis.sv2saved.push(blob);
      return made(blob);
    };
  });
  await click('[data-action="save-calendar-csv"]');
  await toastSays('Saved the calendar as a CSV file: one row per date, ready for a spreadsheet.');
  const csv = await page.evaluate(() => globalThis.sv2saved[globalThis.sv2saved.length - 1].text());
  // a Blob read as text loses its byte-order mark: the bytes keep it
  assert.deepEqual(await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.sv2saved[globalThis.sv2saved.length - 1].arrayBuffer()).slice(0, 3))), [0xef, 0xbb, 0xbf]);
  assert.match(csv, /^Date,Weekday,Day type,Bells,Note\r\n2026-08-31,Monday,A Day,Regular,\r\n/);
  assert.match(csv, /\r\n2026-10-14,Wednesday,No school,,Snow day\r\n/);
  await click('[data-action="import-dates"]');
  await page.waitForSelector('#calendar-import[open]');
  await page.evaluate((body) => document.getElementById('calendar-import').calendarRead('calendar.csv', body), csv);
  const days = await page.evaluate(() => globalThis.sv2modules.calendar.calendarDays(globalThis.sv2.store.project).length);
  assert.equal(await text('[data-says="import"]'), 'calendar.csv: ' + days + ' dates are as the calendar has them.');
  assert.equal(await page.$eval('[data-action="apply-import"]', (el) => el.disabled), true, 'the file the tool wrote reads back to no change');
  // one date changed in the file: shown before anything changes
  const changed = csv.replace(/\r\n2026-11-26,Thursday,[^\r]*\r\n/, '\r\n2026-11-26,Thursday,No school,,Thanksgiving\r\n');
  assert.notEqual(changed, csv);
  await page.evaluate((body) => document.getElementById('calendar-import').calendarRead('calendar.csv', body), changed);
  await shows(() => document.querySelectorAll('.cal-import__table tbody tr').length === 1);
  assert.deepEqual(await page.$eval('.cal-import__table tbody tr', (row) => Array.from(row.children, (each) => each.textContent)).then((cells) => cells[0]), 'Thursday 26 November 2026');
  assert.equal(await ownChange('2026-11-26'), null, 'nothing changed before Apply');
  assert.equal(await text('[data-action="apply-import"]'), 'Apply: 1 date changes');
  await page.click('[data-action="apply-import"]');
  await toastSays('Imported dates: 1 date changes; ' + (days - 1) + ' dates are as the calendar has them.');
  assert.deepEqual(await ownChange('2026-11-26'), { date: '2026-11-26', day: 'closed', bells: null, label: 'Thanksgiving' });
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Import dates: 1 date changes; ' + (days - 1) + ' dates are as the calendar has them');
  await undoFromToast();
  assert.equal(await ownChange('2026-11-26'), null);
});

test('a file naming a day type the project does not have is refused whole, and nothing changes', async () => {
  await closeToast();
  await click('[data-action="import-dates"]');
  await page.waitForSelector('#calendar-import[open]');
  await page.evaluate(() => document.getElementById('calendar-import').calendarRead('holidays.csv', 'Date,Day type\r\n2026-11-27,Z Day\r\n'));
  assert.match(await text('[data-says="import"]'), /^holidays\.csv: .*Z Day.* Nothing has changed\.$/);
  assert.equal(await page.$eval('[data-action="apply-import"]', (el) => el.disabled), true);
  await page.keyboard.press('Escape');
  await shows(() => document.getElementById('calendar-import') === null);
});

test('the panel’s setup: a weekday made always one day type, the rotation added to, each one undo step', async () => {
  await settled();
  const ids = await page.evaluate(() => globalThis.sv2.store.project.dayTypes.map((dayType) => dayType.id));
  await page.select('[data-key="cal-weekday:4"]', ids[1]);
  await toastSays('Fridays: Always B Day.');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.calendar.weekdays[4].day), ids[1]);
  await undoFromToast();
  await page.select('[data-key="cal-rotation-add"]', ids[0]);
  await toastSays('Added A Day to the rotation.');
  assert.deepEqual(await page.$$eval('#inspector .cal-chip__name', (all) => all.map((el) => el.textContent)), ['A Day', 'B Day', 'A Day']);
  await undoFromToast();
  assert.deepEqual(await page.$$eval('#inspector .cal-chip__name', (all) => all.map((el) => el.textContent)), ['A Day', 'B Day']);
  assert.deepEqual(await page.$$eval('#inspector [data-part="breaks"] li > span', (all) => all.map((el) => el.textContent)), ['Snow day: 14 October, 1 school day', 'Winter break: 21 December 2026 to 1 January 2027, 10 school days']);
});

test('the publish form: the day after the calendar ends sets the out-of-date day; a calendar changed since the last publish is said', async () => {
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setPublishSetting, { key: 'lastPublishedAt', value: '2026-08-31T12:00:00.000Z' }));
  await go(page, '#staff');
  await page.waitForSelector('[data-says="calendar-changed"]');
  assert.equal(await page.$eval('[data-says="stale-at-end"]', (el) => el.querySelector('input') !== null), true, 'the tick is there with a calendar');
  assert.equal(await page.$eval('[data-says="stale-at-end"] input', (el) => el.checked), true);
  assert.match(await page.$eval('#publish-stale', (el) => document.getElementById(el.getAttribute('aria-describedby').split(' ')[0]).textContent), /a file published today is current until 12 June 2027, the day after the calendar ends\./);
  assert.equal(await page.$eval('[data-says="calendar-changed"]', (el) => (el.hidden ? '' : el.textContent)), 'The calendar changed after your last publish on 31 August 2026. Staff copies still have the old one.');
  // a calendar that has already ended (noon on the day after its last is
  // before now): the days say, and the form says why
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setCalendarRange, { start: '2026-06-01', end: '2026-08-30' }));
  await shows(() => /^The calendar ended on 30 August 2026, so the days below say when the file is out of date: published today, it is current until /.test(document.getElementById(document.getElementById('publish-stale').getAttribute('aria-describedby').split(' ')[0]).textContent));
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  // a publish after the change: the line goes
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setPublishSetting, { key: 'lastPublishedAt', value: '2026-09-02T12:00:00.000Z' }));
  await shows(() => document.querySelector('[data-says="calendar-changed"]').hidden === true);
  await go(page, '#schedule/calendar');
  await settled();
});

test('Remove the calendar, and Undo brings it back', async () => {
  await click('[data-action="remove-calendar"]');
  await toastSays('Removed the calendar.');
  await page.waitForSelector('[data-empty="calendar"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'cal-start');
  assert.equal(await exists('#inspector .cal-panel'), false, 'the panel left the inspector');
  await undoFromToast();
  await page.waitForSelector('.cal-year .cal-day');
  assert.equal(await exists('#inspector .cal-panel'), true);
});

test('the tab row is one row at 1024 px with the inspector open', async () => {
  await page.setViewport({ width: 1024, height: 800, deviceScaleFactor: 1 });
  await settled();
  const tops = await page.$$eval('.sch .tabs__tab', (all) => all.map((tab) => Math.round(tab.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, 'the tabs are one row: ' + tops.join(', '));
  assert.ok(await page.evaluate(() => document.getElementById('inspector').getBoundingClientRect().width > 100), 'the inspector is open');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await settled();
});

test('at 390 by 844 with touch: the list open and the months folded; Show the months; a tap opens the dialog as a bottom sheet with 16 px fields; the tab row scrolls to Calendar', async () => {
  // a page of its own, with a calendar put in by the store. The desktop page
  // goes first: a second tab of the planner is read-only (storage/tabs.js).
  await page.close();
  const phone = await openPlanner({ server, browser, hash: '#schedule/calendar', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  try {
    await assertTouch(p, 'calendar on a phone');
    await loadModule(p, 'actions', 'engine/actions.js');
    await p.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.makeCalendar, { start: '2026-08-31', end: '2027-06-11' }));
    await p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.cal-list'));
    assert.equal(await p.$eval('.cal-list', (el) => el.open), true, 'the list is open on a phone');
    assert.equal(await p.$eval('.cal-year', (el) => el.hidden), true, 'the squares are folded');
    assert.equal(await p.$eval('[data-key="cal-show-months"]', (el) => el.getAttribute('aria-expanded')), 'false');
    // the panel is under the year, not in a shut sheet
    assert.equal(await p.$eval('.cal-slot .cal-panel', (el) => el !== null), true);
    // the active tab is in view in the scrolling row
    const seen = await p.evaluate(() => {
      const row = document.querySelector('.sch > .tabs > .tabs__list').getBoundingClientRect();
      const tab = document.querySelector('.sch .tabs__tab[aria-selected="true"]').getBoundingClientRect();
      return { inside: tab.left >= row.left - 1 && tab.right <= row.right + 1, height: tab.height, scrolls: document.querySelector('.sch > .tabs > .tabs__list').scrollWidth > row.width };
    });
    assert.deepEqual(seen, { inside: true, height: 44, scrolls: true });
    const show = await p.$('[data-key="cal-show-months"]');
    const box = await show.boundingBox();
    assert.ok(box.height >= 44, 'Show the months is 44 px tall');
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForFunction(() => document.querySelector('.cal-year').hidden === false && document.querySelector('.sch').dataset.pending !== 'true');
    const date = '2026-09-03';
    await p.$eval(cell(date), (el) => el.scrollIntoView({ block: 'center' }));
    const square = await (await p.$(cell(date))).boundingBox();
    assert.ok(square.height >= 44 && square.width >= 44, 'a date is a 44 px target: ' + square.width + ' by ' + square.height);
    await p.touchscreen.tap(square.x + square.width / 2, square.y + square.height / 2);
    await p.waitForFunction(() => document.getElementById('calendar-date-dialog')?.open === true && document.getElementById('calendar-date-dialog').getAnimations().every((each) => each.playState === 'finished'));
    const sheet = await p.evaluate(() => {
      const dialog = document.getElementById('calendar-date-dialog');
      const rect = dialog.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        fields: Array.from(dialog.querySelectorAll('input[type="date"], input[type="text"]'), (el) => getComputedStyle(el).fontSize),
        radios: Array.from(dialog.querySelectorAll('.cal-dialog__radio'), (el) => el.getBoundingClientRect().height >= 44).every(Boolean),
      };
    });
    assert.deepEqual(sheet, { bottom: 844, width: 390, fields: ['16px', '16px'], radios: true });
    await p.$eval('[data-action="close-date"]', (el) => el.click());
    await p.waitForFunction(() => document.getElementById('calendar-date-dialog') === null);
  } finally {
    await p.close();
  }
});
