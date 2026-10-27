// The Calendar tab's review faults, in a real browser: node test/browser/calendar-review.mjs
//
// SV2-80b. What test/browser/calendar.mjs does not reach: a run of dates that
// starts on a Saturday, Shift-click and Shift+Page keys, a run of bells alone,
// Through's aria-invalid, Undo of Remove and the focus it leaves, separate
// snow days in the panel's Breaks, an arrow touching only the squares that
// change, the timings of a 731-day calendar, the print's sheets counted from
// a real PDF in Letter and A4 both ways up, a one-day calendar, hostile names
// on every calendar surface, the publish form's calendar tick and lines, and
// at 390 and 320 px the date sheet with the keyboard up (the window made short
// the way a keyboard makes the visible page short) and the panel's Bells
// select. The clock is pinned to Tuesday 1 September 2026, 9:00 UTC. Every
// wait is on a state the page sets (`data-pending` gone from the section, a
// dialog open or gone, a toast's words), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch, loadModule, assertTouch } from './harness.mjs';

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
let phone;

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

// How many sheets a calendar prints on, from a real PDF of the document the
// print builds. Twelve months or fewer to a sheet.
async function sheets(size, orientation) {
  const html = await page.evaluate((paper) => globalThis.sv2modules.cprint.render(globalThis.sv2.store.project, null, { paper, firstDay: 6, now: new Date() }).html, { size, orientation });
  const doc = await browser.newPage();
  try {
    await doc.goto(page.url().split('#')[0]);
    await doc.evaluate((markup) => {
      document.open();
      document.write(markup);
      document.close();
    }, html);
    await doc.waitForFunction(() => document.readyState === 'complete' && Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every((link) => link.sheet !== null));
    const pdf = await doc.pdf({ preferCSSPageSize: true });
    const pages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const overflow = await doc.evaluate(() => Array.from(document.querySelectorAll('section.page')).filter((each) => each.scrollHeight > each.clientHeight + 1).length);
    return { pages, overflow };
  } finally {
    await doc.close();
  }
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
  await loadModule(page, 'cprint', 'ui/prints/calendar.js');
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
  if (phone) assert.deepEqual(phone.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(alerts, [], 'a typed name was run as markup');
});

test('a run that starts on a Saturday counts the checked day: Through names the school days, and the break applies', async () => {
  await fresh(YEAR);
  await openDate('2027-03-13');
  assert.equal(await dialogApply(), 'Apply', 'nothing chosen on one date: nothing to apply');
  await setValue('#calendar-date-dialog input[name="through"]', '2027-03-21');
  assert.equal(await dialogApply(), 'Set 5 school days to No school');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  for (const date of ['2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19']) assert.equal((await ownChange(date))?.day, 'closed', date + ' is closed');
  for (const date of ['2027-03-13', '2027-03-14', '2027-03-20', '2027-03-21']) assert.equal(await ownChange(date), null, date + ' says nothing of its own');
  // the same run by keyboard: Shift+Arrows from a Saturday, then Enter
  await closeToast();
  await page.focus(cell('2027-04-03'));
  await page.keyboard.down('Shift');
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Enter');
  await dialogOpen();
  assert.equal(await dialogApply(), 'Set 5 school days to No school');
  await closeDialog();
});

test('Shift-click selects a run from the date last focused; Shift+Page Down and Page Up extend and shorten it', async () => {
  await fresh(YEAR);
  await settled();
  await page.focus(cell('2026-11-02'));
  await page.keyboard.down('Shift');
  await page.click(cell('2026-11-06'));
  await page.keyboard.up('Shift');
  await dialogOpen();
  assert.equal(await text('#calendar-date-dialog .dialog__title'), '2 to 6 November');
  assert.equal(await text('.cal-status'), '5 dates selected, 2 to 6 November');
  assert.deepEqual(await page.$$eval('.cal-day[aria-selected="true"]', (all) => all.map((el) => el.dataset.date)), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  await closeDialog();
  assert.equal(await text('.cal-status'), '', 'Escape puts the focus back on the date and the run is one date again');
  await page.focus(cell('2026-10-05'));
  await page.keyboard.down('Shift');
  await page.keyboard.press('PageDown');
  await page.keyboard.up('Shift');
  assert.equal(await text('.cal-status'), '32 dates selected, 5 October to 5 November');
  assert.equal(await page.$$eval('.cal-day[aria-selected="true"]', (all) => all.length), 32);
  assert.equal(await activeDate(), '2026-11-05');
  await page.keyboard.down('Shift');
  await page.keyboard.press('PageUp');
  await page.keyboard.up('Shift');
  assert.equal(await text('.cal-status'), '');
  assert.equal(await activeDate(), '2026-10-05');
});

test('a run of bells alone is written on school days only, moves nothing later, and Apply names it', async () => {
  await fresh(YEAR);
  const early = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  const before = await walk();
  await openDate('2026-10-19');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-10-25');
  await page.$eval('#calendar-date-dialog [data-part="bells"] input[value="' + early + '"]', (input) => input.click());
  assert.equal(await dialogApply(), 'Set 5 school days to Early Release bells');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  for (const date of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) assert.deepEqual(await ownChange(date), { date, day: null, bells: early, label: '' }, date);
  for (const date of ['2026-10-24', '2026-10-25']) assert.equal(await ownChange(date), null, date + ' is not a school day: nothing written');
  assert.equal(await walk(), before, 'no date’s day type moved');
  await toastSays('19 to 23 October have Early Release bells.');
});

test('Through’s aria-invalid and its sentence go when the date is right again', async () => {
  await fresh(YEAR);
  await openDate('2026-09-08');
  await setValue('#calendar-date-dialog input[name="through"]', '2028-01-01');
  await page.$eval('#calendar-date-dialog input[value="closed"]', (input) => input.click());
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await shows(() => document.querySelector('#calendar-date-dialog .field__refusal').hidden === false);
  assert.equal(await page.$eval('#calendar-date-dialog input[name="through"]', (el) => el.getAttribute('aria-invalid')), 'true');
  assert.equal(await text('#calendar-date-dialog .field__refusal'), 'Through is a date from 8 September 2026 to 11 June 2027.');
  await setValue('#calendar-date-dialog input[name="through"]', '2026-09-10');
  assert.equal(await page.$eval('#calendar-date-dialog input[name="through"]', (el) => el.getAttribute('aria-invalid')), null);
  assert.equal(await page.$eval('#calendar-date-dialog .field__refusal', (el) => el.hidden), true);
  await closeDialog();
});

test('Undo of Remove puts the focus on the year’s roving date, by the toast and by Ctrl+Z', async () => {
  await fresh(YEAR);
  await page.focus(cell('2026-11-04'));
  for (const how of ['toast', 'keys']) {
    await settled();
    await closeToast();
    await page.click('[data-action="remove-calendar"]');
    await toastSays('Removed the calendar.');
    await page.waitForSelector('[data-empty="calendar"]');
    if (how === 'toast') {
      await page.evaluate(() => Array.from(document.querySelectorAll('.toast button')).find((button) => button.textContent === 'Undo').click());
    } else {
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');
    }
    await shows(() => document.activeElement?.classList.contains('cal-day'));
    await settled();
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement.tagName, stop: document.activeElement.getAttribute('tabindex'), stops: document.querySelectorAll('.cal-day[tabindex="0"]').length })), { tag: 'TD', stop: '0', stops: 1 }, how);
  }
});

test('the panel’s Breaks list joins side-by-side dates and a weekend inside a run, and keeps single snow days apart', async () => {
  await fresh({ ...YEAR, breaks: [{ from: '2026-12-21', to: '2027-01-01', label: 'Winter break' }] });
  await page.evaluate(() => {
    const store = globalThis.sv2.store;
    const A = globalThis.sv2modules.actions;
    for (const dates of [['2026-10-14'], ['2026-10-16'], ['2026-10-19'], ['2026-11-03', '2026-11-04']]) store.apply(A.setCalendarDates, { dates, day: 'closed', label: 'Snow day' });
  });
  await settled();
  assert.deepEqual(await page.$$eval('#inspector [data-part="breaks"] li > span', (all) => all.map((el) => el.textContent)), [
    'Snow day: 14 October, 1 school day',
    'Snow day: 16 October, 1 school day',
    'Snow day: 19 October, 1 school day',
    'Snow day: 3 to 4 November, 2 school days',
    'Winter break: 21 December 2026 to 1 January 2027, 10 school days',
  ]);
});

test('an arrow touches only the squares that change: the one it leaves and the one it reaches', async () => {
  await fresh(YEAR);
  await page.focus(cell('2026-09-09'));
  const count = (keys, shift) => page.evaluate((pressed, stretch) => new Promise((resolve) => {
    const touched = new Set();
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        const owner = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const square = owner && owner.closest ? owner.closest('.cal-day') : null;
        touched.add(square ? square.dataset.date : 'outside');
      }
    });
    watch.observe(document.querySelector('.cal-year'), { subtree: true, childList: true, attributes: true, characterData: true });
    for (const key of pressed) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: stretch, bubbles: true, cancelable: true }));
    // the records are delivered when this task ends
    setTimeout(() => {
      watch.disconnect();
      resolve(Array.from(touched).sort());
    }, 0);
  }), keys, shift);
  assert.deepEqual(await count(['ArrowRight'], false), ['2026-09-09', '2026-09-10'], 'one step: the old stop and the new');
  assert.deepEqual(await count(['ArrowDown'], false), ['2026-09-10', '2026-09-17']);
  assert.deepEqual(await count(['ArrowRight'], true), ['2026-09-17', '2026-09-18'], 'a stretched run: the new end, and the old stop');
  assert.equal((await count(['PageDown'], false)).length <= 4, true, 'a month on: the squares of the run and the two stops, never the year');
});

test('a 731-day calendar: 24 months; an arrow answers in under 50 ms and Apply settles in under 300 ms', async () => {
  await fresh({ start: '2026-08-01', end: '2028-07-31', breaks: [{ from: '2026-12-21', to: '2027-01-01', label: 'Winter break' }] });
  assert.equal(await page.$$eval('.cal-month', (all) => all.length), 24);
  await page.focus(cell('2026-09-01'));
  // each key handled and the page laid out again, as a person waits for it
  const arrows = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 15; i += 1) {
      const t0 = performance.now();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      document.body.getBoundingClientRect();
      out.push(performance.now() - t0);
    }
    return out.sort((a, b) => a - b);
  });
  const middle = arrows[Math.floor(arrows.length / 2)];
  assert.ok(middle < 50 * SLOW, 'an arrow takes ' + middle.toFixed(1) + ' ms (the middle of 15; the slowest ' + arrows[arrows.length - 1].toFixed(1) + ')');
  // Apply: from the click to the section drawn again, the best of three
  const times = [];
  for (const date of ['2026-10-14', '2027-02-10', '2027-05-12']) {
    await settled();
    await closeToast();
    await openDate(date);
    await page.$eval('#calendar-date-dialog input[value="closed"]', (input) => input.click());
    times.push(await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      document.querySelector('#calendar-date-dialog [data-action="apply-date"]').click();
      const wait = () => requestAnimationFrame(() => {
        const section = document.querySelector('.sch');
        if (section.dataset.pending === 'true' || document.getElementById('calendar-date-dialog')) wait();
        else resolve(performance.now() - t0);
      });
      wait();
    })));
  }
  assert.ok(Math.min(...times) < 300 * SLOW, 'Apply settles in ' + times.map((each) => each.toFixed(0)).join(', ') + ' ms');
});

test('the print: a year is one sheet in Letter and A4 both ways up, a 731-day calendar two, a one-day calendar one', async () => {
  await fresh(YEAR);
  for (const size of ['letter', 'a4']) {
    for (const orientation of ['landscape', 'portrait']) assert.deepEqual(await sheets(size, orientation), { pages: 1, overflow: 0 }, 'a year on ' + size + ' ' + orientation);
  }
  await fresh({ start: '2026-08-01', end: '2028-07-31' });
  for (const size of ['letter', 'a4']) {
    for (const orientation of ['landscape', 'portrait']) assert.deepEqual(await sheets(size, orientation), { pages: 2, overflow: 0 }, '731 days on ' + size + ' ' + orientation);
  }
  await fresh({ start: '2026-09-01', end: '2026-09-01' });
  assert.deepEqual(await sheets('letter', 'landscape'), { pages: 1, overflow: 0 });
});

test('Print the calendar opens on a landscape sheet and leaves the project’s orientation alone until it is changed', async () => {
  await fresh(YEAR);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.paper.orientation), 'portrait');
  await page.click('#print-calendar');
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 15000 });
  assert.match(await text('#print-preview .preview__status'), /^US Letter, landscape\. About 1 sheet\./);
  assert.equal(await page.evaluate(() => document.querySelector('#print-preview iframe').contentDocument.documentElement.dataset.orientation), 'landscape');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.paper.orientation), 'portrait', 'the project’s setting is untouched');
  await page.keyboard.press('Escape');
  await shows(() => document.getElementById('print-preview') === null);
});

test('a one-day calendar: one square, the arrows stay on it, the panel and the list say so', async () => {
  await fresh({ start: '2026-09-01', end: '2026-09-01' });
  assert.deepEqual(await page.$$eval('.cal-day:not(.is-out)', (all) => all.map((el) => el.dataset.date)), ['2026-09-01']);
  assert.deepEqual(await page.$$eval('.cal-day[tabindex="0"]', (all) => all.map((el) => el.dataset.date)), ['2026-09-01']);
  await page.focus(cell('2026-09-01'));
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
    await page.keyboard.press(key);
    assert.equal(await activeDate(), '2026-09-01', key);
  }
  assert.equal(await text('[data-says="summary"]'), '1 school day from 1 September 2026 to 1 September 2026. Today is an A Day.');
  await page.click('.cal-list__summary');
  await shows(() => document.querySelectorAll('.cal-list__table tbody tr').length === 1);
  await page.click('.cal-list__summary');
  await shows(() => document.querySelector('.cal-list__table') === null);
  await openDate('2026-09-01');
  await page.$eval('#calendar-date-dialog input[value="closed"]', (input) => input.click());
  assert.equal(await dialogApply(), 'Set 1 September to No school');
  await closeDialog();
});

test('hostile names are shown as typed on every calendar surface: squares, dialog, panel, list, toast, print, CSV', async () => {
  await fresh({ ...YEAR, breaks: [{ from: '2026-12-21', to: '2027-01-01', label: HOSTILE }] });
  await page.evaluate((names) => {
    const store = globalThis.sv2.store;
    const A = globalThis.sv2modules.actions;
    store.apply(A.renameDayType, { dayTypeId: store.project.dayTypes[0].id, name: names.day });
    store.apply(A.setBellSchedule, { bellScheduleId: store.project.bellSchedules[0].id, name: names.bells });
  }, { day: HOSTILE, bells: HOSTILE_BELLS });
  await settled();
  const noImages = async (where) => assert.equal(await page.evaluate(() => document.querySelectorAll('img').length), 0, where + ': a name became an image');
  // the squares: the whole sentence and the word printed in a no-school square
  assert.equal(await page.$eval(cell('2026-12-21') + ' .cal-day__name', (el) => el.textContent), 'Monday 21 December 2026: no school, ' + HOSTILE + '. Changed by hand.');
  assert.equal(await page.$eval(cell('2026-12-21') + ' .cal-day__t', (el) => el.textContent), '<img');
  assert.ok((await page.$eval(cell('2026-09-02') + ' .cal-day__name', (el) => el.textContent)).startsWith('Wednesday 2 September 2026: '));
  await noImages('squares');
  // the panel: counts, weekday choices, the breaks, the sentence
  assert.ok((await text('[data-part="counts-days"]')).includes(HOSTILE), 'the counts name the day type as typed');
  assert.ok((await text('[data-part="breaks"]')).includes(HOSTILE + ': 21 December 2026 to 1 January 2027'));
  assert.ok((await page.$$eval('[data-part="weekdays"] option', (all) => all.map((el) => el.textContent))).includes('Always ' + HOSTILE));
  assert.ok(!(await exists('.cal-panel img')), 'the panel holds no image');
  await noImages('panel');
  // the dialog: the day types and the bells as radios, the note as a value, the title
  await openDate('2026-12-21');
  assert.equal(await page.$eval('#calendar-date-dialog input[name="note"]', (el) => el.value), HOSTILE);
  const labels = await page.$$eval('#calendar-date-dialog label.cal-dialog__radio span', (all) => all.map((el) => el.textContent));
  assert.ok(labels.includes(HOSTILE) && labels.includes(HOSTILE_BELLS), 'a day type and a bell schedule are labelled as typed');
  await page.$eval('#calendar-date-dialog [data-part="day"] input[value="' + (await page.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id)) + '"]', (input) => input.click());
  assert.equal(await dialogApply(), 'Set 21 December to ' + HOSTILE);
  await noImages('dialog');
  await page.click('#calendar-date-dialog [data-action="apply-date"]');
  await dialogGone();
  await settled();
  // the toast, and the list
  assert.ok((await page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || '')).includes(HOSTILE), 'the toast names the day type as typed');
  await page.click('.cal-list__summary');
  await page.waitForSelector('.cal-list__table');
  assert.ok((await page.$eval('.cal-list__table tr[data-date="2026-12-22"]', (row) => row.innerText)).includes(HOSTILE));
  await noImages('list');
  await page.click('.cal-list__summary');
  // the print: escaped in the markup, shown as text in the preview
  const markup = await page.evaluate(() => globalThis.sv2modules.cprint.render(globalThis.sv2.store.project, null, { paper: { size: 'letter', orientation: 'landscape' }, firstDay: 6, now: new Date() }).html);
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped on paper');
  assert.ok(!markup.includes('<img'), 'no tag of the name on paper');
  await page.click('#print-calendar');
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.querySelector('#print-preview iframe').contentDocument.querySelectorAll('img').length), 0);
  await page.keyboard.press('Escape');
  await shows(() => document.getElementById('print-preview') === null);
  // the CSV
  const csv = await page.evaluate(async () => (await import('./engine/import-calendar.js')).calendarCsv(globalThis.sv2.store.project));
  assert.ok(csv.includes(HOSTILE), 'the file holds the name as typed');
  // put the names back for the tests after this one
  await page.evaluate(() => {
    const store = globalThis.sv2.store;
    store.apply(globalThis.sv2modules.actions.renameDayType, { dayTypeId: store.project.dayTypes[0].id, name: 'A Day' });
    store.apply(globalThis.sv2modules.actions.setBellSchedule, { bellScheduleId: store.project.bellSchedules[0].id, name: 'Early Release' });
  });
  await settled();
});

test('the publish form ticks the calendar view only with a calendar, and says what staff copies hold', async () => {
  await fresh(YEAR);
  await go(page, '#staff');
  await page.waitForSelector('.pub');
  assert.equal(await text('[data-says="views"]'), 'All 12 views');
  assert.equal(await text('input[data-view="calendar"] + span'), 'Calendar');
  assert.equal(await page.$eval('input[data-view="calendar"]', (el) => el.checked), true);
  // the tick is inside the folded "What is in it": pressed as a script would
  await page.$eval('input[data-view="calendar"]', (box) => box.click());
  await shows(() => document.querySelector('[data-says="views"]').textContent === '11 of 12 views');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.publish.views.calendar), false);
  await page.$eval('input[data-view="calendar"]', (box) => box.click());
  await shows(() => document.querySelector('[data-says="views"]').textContent === 'All 12 views');
  // a publish noted by this device, then the calendar removed
  const at = '2026-09-02T12:00:00.000Z';
  await page.evaluate(async (when) => {
    const form = await import('./ui/staff/form.js');
    const project = globalThis.sv2.store.project;
    form.notePublishedCalendar(project, when, true);
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.setPublishSetting, { key: 'lastPublishedAt', value: when });
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.removeCalendar);
  }, at);
  await shows(() => !document.querySelector('[data-says="calendar-changed"]').hidden);
  assert.equal(await text('[data-says="calendar-changed"]'), 'The calendar was removed after your last publish. Staff copies still have it.');
  assert.equal(await exists('input[data-view="calendar"]'), false, 'no calendar: no tick');
  assert.equal(await text('[data-says="views"]'), 'All 11 views');
  // a file made with no calendar, then a first calendar
  await page.evaluate(async (when) => {
    const form = await import('./ui/staff/form.js');
    form.notePublishedCalendar(globalThis.sv2.store.project, when, false);
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.makeCalendar, { start: '2026-08-31', end: '2027-06-11' });
  }, at);
  await shows(() => document.querySelector('[data-says="calendar-changed"]').textContent === 'Staff copies have no calendar yet.');
  // and the line goes when a file is made with the calendar
  await page.evaluate(async (when) => {
    const form = await import('./ui/staff/form.js');
    form.notePublishedCalendar(globalThis.sv2.store.project, when, true);
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.setPublishSetting, { key: 'lastPublishedAt', value: '2026-09-03T12:00:00.000Z' });
  }, at);
  await shows(() => document.querySelector('[data-says="calendar-changed"]').hidden === true);
  await go(page, '#schedule/calendar');
  await settled();
});

test('at 390 px with touch and the keyboard up: Note and Apply are both reachable, Apply and Close stay at the sheet’s foot', async () => {
  await page.close();
  phone = await openPlanner({ server, browser, hash: '#schedule/calendar', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  try {
    await assertTouch(p, 'calendar sheet on a phone');
    await loadModule(p, 'actions', 'engine/actions.js');
    await p.evaluate(() => {
      const store = globalThis.sv2.store;
      const A = globalThis.sv2modules.actions;
      store.apply(A.addBellSchedule, { name: 'Early Release' });
      store.apply(A.addBellSchedule, { name: 'Assembly' });
      store.apply(A.makeCalendar, { start: '2026-08-31', end: '2027-06-11' });
    });
    await p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.cal-list'));
    await p.click('[data-key="cal-show-months"]');
    await p.waitForFunction(() => document.querySelector('.cal-year').hidden === false && document.querySelector('.sch').dataset.pending !== 'true');
    await p.$eval('.cal-day[data-date="2026-09-03"]', (el) => el.scrollIntoView({ block: 'center' }));
    const square = await (await p.$('.cal-day[data-date="2026-09-03"]')).boundingBox();
    await p.touchscreen.tap(square.x + square.width / 2, square.y + square.height / 2);
    await p.waitForFunction(() => document.getElementById('calendar-date-dialog')?.open === true);
    const reach = () => p.evaluate(() => {
      const dialog = document.getElementById('calendar-date-dialog');
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      const body = dialog.querySelector('.cal-dialog__body');
      return {
        visible: Math.round(window.visualViewport.height),
        dialog: box(dialog),
        apply: box(dialog.querySelector('[data-action="apply-date"]')),
        close: box(dialog.querySelector('[data-action="close-date"]')),
        note: box(dialog.querySelector('input[name="note"]')),
        body: box(body),
        scrolls: body.scrollHeight > body.clientHeight,
        pinned: body.getBoundingClientRect().bottom <= dialog.querySelector('.dialog__buttons').getBoundingClientRect().top + 1,
      };
    });
    // the page at rest: the sheet is on the screen and Apply is in view
    let seen = await reach();
    assert.ok(seen.dialog.top >= 0 && seen.apply.bottom <= seen.visible && seen.close.bottom <= seen.visible, 'at rest: ' + JSON.stringify(seen));
    // the keyboard up: the visible page is 330 px tall; the Note field takes the focus
    for (const height of [500, 330]) {
      // the field has the focus, then the keyboard comes up and the page is shorter
      await p.focus('#calendar-date-dialog input[name="note"]');
      await p.setViewport({ width: 390, height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await p.waitForFunction((wanted) => Math.round(window.visualViewport.height) === wanted, {}, height);
      await p.waitForFunction(() => {
        const dialog = document.getElementById('calendar-date-dialog');
        return dialog.getBoundingClientRect().height <= window.visualViewport.height;
      });
      // the sheet keeps the field being typed in on the visible page by itself
      await p.waitForFunction(() => {
        const note = document.querySelector('#calendar-date-dialog input[name="note"]').getBoundingClientRect();
        const body = document.querySelector('#calendar-date-dialog .cal-dialog__body').getBoundingClientRect();
        return note.top >= body.top - 1 && note.bottom <= body.bottom + 1;
      });
      seen = await reach();
      assert.ok(seen.dialog.top >= 0 && seen.dialog.bottom <= seen.visible + 1, height + ': the sheet is on the visible page ' + JSON.stringify(seen));
      assert.ok(seen.apply.bottom <= seen.visible && seen.apply.top >= 0, height + ': Apply is on the visible page ' + JSON.stringify(seen));
      assert.ok(seen.close.bottom <= seen.visible, height + ': Close is on the visible page');
      assert.ok(seen.note.top >= seen.body.top - 1 && seen.note.bottom <= seen.body.bottom + 1, height + ': Note is in view in the scrolling body ' + JSON.stringify(seen));
      assert.equal(seen.pinned, true, height + ': the body ends where the buttons begin');
      if (height === 330) assert.equal(seen.scrolls, true, 'a short page scrolls the body, not the buttons away');
    }
  } finally {
    await p.evaluate(() => document.getElementById('calendar-date-dialog')?.querySelector('[data-action="close-date"]')?.click());
  }
});

test('at 320 px the panel’s Bells select shows "Early Release" whole', async () => {
  assert.ok(phone, 'the phone page from the test before');
  const p = phone.page;
  await p.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.waitForFunction(() => window.innerWidth === 320 && document.querySelector('.sch')?.dataset.pending !== 'true');
  const early = await p.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  await p.select('[data-key="cal-weekday-bells:2"]', early);
  await p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('[data-key="cal-weekday-bells:2"]').selectedOptions[0].textContent === 'Early Release');
  const fit = await p.evaluate(() => {
    const select = document.querySelector('[data-key="cal-weekday-bells:2"]');
    select.scrollIntoView({ block: 'center' });
    const style = getComputedStyle(select);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    const wanted = canvas.measureText(select.selectedOptions[0].textContent).width;
    // the room inside the select for text: its width less padding, border and the arrow (about 28 px)
    const room = select.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - 28;
    return { wanted: Math.ceil(wanted), room: Math.floor(room), inside: select.getBoundingClientRect().right <= window.innerWidth };
  });
  assert.ok(fit.room >= fit.wanted, '"Early Release" needs ' + fit.wanted + ' px and the select has ' + fit.room);
  assert.equal(fit.inside, true, 'the select is on the screen');
});
