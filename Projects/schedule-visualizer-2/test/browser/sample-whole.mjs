// The whole sample school in a real browser: node test/browser/sample-whole.mjs
//
// Most journeys are written on the plain sample (plainSchool(): its day types
// and nothing else). This file opens the school as the planner builds it for a
// first-time user (`fullSample: true`): Early Release and Assembly bells, a
// calendar, three marks and four duties, and asserts what each screen says of
// them, not only that nothing threw (SV2-87b). At 1280 by 800 and at 390 by
// 844 with touch:
//
//   Day tab        Early Release with Periods 5 to 8 ticked No class and its four
//                  times, the Assembly bells with eight, the three marks
//   Calendar tab   the counts of days by day type and by bells, and the dates of
//                  the two assemblies, the snow day and the days set after them
//   Duties tab     the four rows: Bus duty, Lunch duty, Science department and
//                  Car line, with Lunch duty and Car line off Wednesdays
//   Group editor   Assembly Day is the same as B Day, with B Day's classes
//   Grid           a marked period is named in the cell, Lunch in the Cafeteria
//   Movement       the Bells choice offers Regular, Early Release and Assembly,
//                  and choosing one changes the first line and the strip
//   Staff page     a published file at 11:40 on Wednesday 2 September 2026 in New
//                  York: A Day with Early Release bells, Periods 5 to 8 No class,
//                  the Science meeting, the Bus duty, and no Car line; on the
//                  Thursday, the Car line and no Early Release
//
// And plainSample() (test/browser/harness.mjs): the swap of the sample for the
// plain one is saved when it returns, so a reload lands on it.
//
// Every wait is on a state the page sets (`data-pending` gone from the
// section, the section's data-section, a list drawn), never on a first paint
// or a fixed sleep. The staff page's clock is pinned through `sv2StaffClock`.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, startServer, launch, plainSample } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';

const SIZES = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
];
const WED = '2026-09-02T15:40:00Z'; // Wednesday 11:40 in New York: A Day, Early Release
const THU = '2026-09-03T15:40:00Z'; // Thursday 11:40: B Day

let server;
let browser;
const sessions = new Map();
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-sample-whole-'));
let staffUrl = '';

before(async () => {
  server = await startServer();
  browser = await launch();
  for (const size of SIZES) {
    sessions.set(size.name, await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: size.width, height: size.height, mobile: size.mobile, fullSample: true }));
  }
  const project = sampleSchool();
  project.publish.passcode = '';
  const made = await publishDocument(diskReader(), project, { clock: () => new Date('2026-08-25T12:00:00Z'), random: seededRandom('sample-whole') });
  const file = path.join(scratch, 'sample.html');
  writeFileSync(file, made.html);
  staffUrl = pathToFileURL(file).href;
});

after(async () => {
  try {
    for (const [name, session] of sessions) {
      assert.deepEqual(session.problems().errors, [], name + ': the page reported errors');
    }
  } finally {
    for (const session of sessions.values()) await session.close().catch(() => {});
    if (browser) await browser.close();
    if (server) await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});

const settled = (page) => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 15000 });
const squash = (value) => value.replace(/\s+/g, ' ').trim();

async function openTab(page, tab) {
  await go(page, '#schedule/' + tab);
  await page.waitForFunction((wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && location.hash === '#schedule/' + wanted, { timeout: 15000 }, tab);
}

for (const size of SIZES) {
  const where = size.name + ' (' + size.width + ' by ' + size.height + ')';
  const page = () => sessions.get(size.name).page;

  test(where + ': the Day tab shows Early Release with Periods 5 to 8 ticked No class, the Assembly bells and the three marks', async () => {
    await openTab(page(), 'day');
    const early = await page().$$eval('table[data-bells="bsample0er"] tbody tr', (rows) => rows.map((row) => [
      row.querySelector('th').textContent,
      row.querySelector('input[type="checkbox"]').checked,
      Array.from(row.querySelectorAll('input[type="text"]'), (input) => input.value),
    ]));
    assert.deepEqual(early, [
      ['Period 1', false, ['8:00 AM', '8:40 AM']],
      ['Period 2', false, ['8:44 AM', '9:24 AM']],
      ['Period 3', false, ['9:28 AM', '10:08 AM']],
      ['Period 4', false, ['10:12 AM', '10:52 AM']],
      ['Period 5', true, []],
      ['Period 6', true, []],
      ['Period 7', true, []],
      ['Period 8', true, []],
    ]);
    const assembly = await page().$$eval('table[data-bells="bsample0as"] tbody tr', (rows) => rows.map((row) => [row.querySelector('input[type="checkbox"]').checked, Array.from(row.querySelectorAll('input[type="text"]'), (input) => input.value)]));
    assert.equal(assembly.length, 8);
    assert.ok(assembly.every((row) => row[0] === false && row[1].length === 2 && row[1][0] !== '' && row[1][1] !== ''), 'every period of the Assembly bells meets and has times');
    assert.deepEqual(assembly[7][1], ['1:36 PM', '2:30 PM']);
    assert.deepEqual(await page().$$eval('.sch-marks__line', (all) => all.map((el) => el.textContent)), [
      'Lunch for grade 6 in Period 4, every day type (3 groups)',
      'Lunch for grades 7 and 8 in Period 5, every day type (5 groups)',
      'Assembly (Activity) for the whole school in Period 8 on Assembly Day',
    ]);
  });

  test(where + ': the Calendar tab counts the days and names the assemblies, the snow day and the days after them', async () => {
    await openTab(page(), 'calendar');
    await page().waitForSelector('.cal-panel [data-part="counts-days"]');
    const lines = (part) => page().$$eval('.cal-panel [data-part="' + part + '"] li', (all) => all.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(await lines('counts-days'), ['A Day 95 school days', 'B Day 93 school days', 'Assembly Day 2 school days']);
    assert.deepEqual(await lines('counts-bells'), ['Regular bells 150 school days', 'Early Release bells 38 school days', 'Assembly bells 2 school days']);
    const summary = await page().$eval('.cal-panel [data-says="summary"]', (el) => el.textContent);
    assert.ok(summary.startsWith('190 school days from 31 August 2026 to 11 June 2027.'), summary);
    // the list is folded on a wide screen and open on a phone
    const wasOpen = await page().$eval('.cal-list', (el) => el.open);
    if (!wasOpen) await page().click('.cal-list__summary');
    await page().waitForSelector('.cal-list__table');
    const row = (date) => page().$eval('.cal-list__table tr[data-date="' + date + '"]', (el) => Array.from(el.children, (each) => each.textContent.replace(/\s+/g, ' ').trim()));
    const first = await row('2026-11-13');
    assert.deepEqual([first[0], first[1], first[2], first[3], first[5]], ['13 November 2026', 'Friday', 'Assembly Day', 'Assembly', 'Assembly']);
    const second = await row('2027-03-11');
    assert.deepEqual([second[0], second[1], second[2], second[3], second[5]], ['11 March 2027', 'Thursday', 'Assembly Day', 'Assembly', 'Assembly']);
    const snow = await row('2027-01-12');
    assert.deepEqual([snow[0], snow[2], snow[5]], ['12 January 2027', 'No school', 'Snow day']);
    const after = await row('2027-01-13');
    assert.deepEqual([after[2], after[5]], ['A Day', 'Back in step after the snow day']);
    assert.deepEqual([(await row('2026-11-16'))[2], (await row('2026-11-16'))[5]], ['A Day', 'Back in step after the assembly']);
    assert.deepEqual([(await row('2027-03-12'))[2], (await row('2027-03-12'))[5]], ['A Day', 'Back in step after the assembly']);
    if (!wasOpen) await page().click('.cal-list__summary');
  });

  test(where + ': the Duties tab has four rows, and Lunch duty and Car line are off Wednesdays', async () => {
    await openTab(page(), 'duties');
    await page().waitForSelector('.sch-duties__table tbody tr[data-duty]');
    const rows = await page().$$eval('.sch-duties__table tbody tr[data-duty]', (all) => all.map((row) => ({
      label: row.querySelector('input[data-key$=":label"]').value,
      text: row.textContent.replace(/\s+/g, ' '),
    })));
    assert.deepEqual(rows.map((each) => each.label), ['Bus duty', 'Lunch duty', 'Science department', 'Car line']);
    const days = (label) => rows.find((each) => each.label === label).text;
    assert.match(days('Bus duty'), /Every day/);
    assert.match(days('Lunch duty'), /Mondays, Tuesdays, Thursdays and Fridays/);
    assert.match(days('Car line'), /Mondays, Tuesdays, Thursdays and Fridays/);
    assert.match(days('Science department'), /Wednesdays/);
    assert.doesNotMatch(days('Lunch duty'), /Wednesdays/);
    assert.doesNotMatch(days('Car line'), /Wednesdays/);
  });

  test(where + ': the group editor shows Assembly Day as the same as B Day, with B Day\'s classes', async () => {
    await openTab(page(), 'groups');
    await page().waitForSelector('.sch-days > .sch-day');
    const columns = await page().$$eval('.sch-days > .sch-day', (all) => all.map((el) => ({ day: el.dataset.day, same: el.classList.contains('sch-day--same'), title: el.querySelector('.sch-day__title').textContent })));
    assert.deepEqual(columns.map((each) => [each.day, each.same]), [['dsample00a', false], ['dsample00b', false], ['dsample0as', true]]);
    assert.equal(columns[2].title, 'Assembly Day: same as B Day');
    const group = await page().evaluate(() => {
      const { store } = globalThis.sv2;
      const id = document.querySelector('.sch-editor').dataset.group;
      const found = store.project.groups.find((each) => each.id === id);
      const rooms = new Map();
      for (const floor of store.project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.set(space.id, space.number);
      return { name: found.name, b: found.days.dsample00b.map((slot) => rooms.get(slot.room)) };
    });
    const same = await page().$$eval('.sch-day--same tbody tr', (rows) => rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(same.length, 8);
    same.forEach((line, period) => {
      assert.ok(line.startsWith('Period ' + (period + 1) + group.b[period]), group.name + ' Period ' + (period + 1) + ' on Assembly Day reads ' + line + ', B Day has ' + group.b[period]);
    });
  });

  test(where + ': the grid names a marked period in the cell', async () => {
    await openTab(page(), 'grid');
    await page().waitForSelector('.grd-cell--slot');
    const cell = (group, dayType, period) => page().$eval('.grd-cell--slot[data-key="grid:' + group + ':' + dayType + ':' + period + '"]', (el) => el.textContent);
    // the cell may go on with the note on the Cafeteria; what leads it is the room and the mark
    assert.ok((await cell('gsample06a', 'dsample00a', 3)).startsWith('Cafeteria (Lunch)'), 'grade 6 eats in Period 4');
    assert.ok((await cell('gsample07a', 'dsample00b', 4)).startsWith('Cafeteria (Lunch)'), 'grade 7 eats in Period 5');
    assert.equal(await cell('gsample06a', 'dsample00a', 0), '201', 'a period with no mark is only its room');
  });

  test(where + ': Movement offers Regular, Early Release and Assembly bells, and the choice changes the first line and the strip', async () => {
    await go(page(), '#movement');
    await page().waitForFunction(() => document.querySelector('.mov')?.dataset.pending !== 'true' && document.querySelector('.mov-line__words'), { timeout: 15000 });
    const folded = await page().$eval('.mov-top', (el) => el.dataset.folded === 'true');
    if (folded) await page().click('[data-action="change"]');
    await page().waitForFunction(() => document.querySelector('.mov-top').dataset.folded === 'false');
    assert.deepEqual(await page().$$eval('[data-control="bells"] option', (all) => all.map((each) => each.textContent)), ['Regular', 'Early Release', 'Assembly']);
    const line = () => page().$eval('.mov-line__words', (el) => el.textContent);
    const strip = () => page().$$eval('.mov-strip__item', (all) => all.map((el) => el.dataset.transition));
    const settledMovement = () => page().waitForFunction(() => document.querySelector('.mov')?.dataset.pending !== 'true', { timeout: 15000 });
    const regular = { line: await line(), strip: await strip() };
    assert.match(regular.line, /^Showing 8 groups on A Day, all transitions\./);
    assert.equal(regular.strip.length, 8, 'All and seven transitions');
    await page().select('[data-control="bells"]', 'bsample0er');
    await page().waitForFunction(() => /with Early Release bells/.test(document.querySelector('.mov-line__words')?.textContent || ''), { timeout: 15000 });
    await settledMovement();
    assert.match(await line(), /^Showing 8 groups on A Day with Early Release bells, all transitions\./);
    assert.deepEqual(await strip(), ['all', '0', '1', '2'], 'the three transitions between the periods that meet');
    await page().select('[data-control="bells"]', 'bsample0as');
    await page().waitForFunction(() => /with Assembly bells/.test(document.querySelector('.mov-line__words')?.textContent || ''), { timeout: 15000 });
    await settledMovement();
    assert.match(await line(), /^Showing 8 groups on A Day with Assembly bells, all transitions\./);
    assert.equal((await strip()).length, 8, 'every period meets under the Assembly bells');
    await page().select('[data-control="bells"]', '');
    await page().waitForFunction(() => !/ bells, /.test(document.querySelector('.mov-line__words')?.textContent || ''), { timeout: 15000 });
    await settledMovement();
    assert.equal(await line(), regular.line, 'back to regular bells, the picture is as it was');
  });

  test(where + ': the staff page on a Wednesday shows the Early Release day, the Science meeting and the Bus duty, and not the Car line', async () => {
    const view = async (teacher, at) => {
      const context = await browser.createBrowserContext();
      const staff = await context.newPage();
      const errors = [];
      staff.on('pageerror', (error) => errors.push('page error: ' + error.message));
      staff.on('console', (message) => {
        if (message.type() === 'error') errors.push('console: ' + message.text());
      });
      try {
        await staff.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: size.mobile, isMobile: size.mobile });
        await staff.emulateTimezone('America/New_York');
        await staff.evaluateOnNewDocument((moment) => {
          globalThis.sv2StaffClock = { now: () => moment, every: 3600000 };
          globalThis.print = () => {};
        }, at);
        await staff.goto(staffUrl + '#/teacher/' + teacher, { waitUntil: 'load' });
        await staff.waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.getElementById('app').dataset.state === 'open' && document.querySelector('main.page')?.dataset.view === 'teacher' && document.querySelector('.day[data-today="true"]'), { timeout: 30000 });
        const today = await staff.$eval('.day[data-today="true"]', (el) => el.textContent.replace(/\s+/g, ' '));
        const rows = await staff.$$eval('.day[data-today="true"] .row[data-period]', (all) => all.map((el) => [el.dataset.period, el.textContent.replace(/\s+/g, ' ').trim()]));
        const lede = await staff.$eval('main', (el) => el.textContent.replace(/\s+/g, ' '));
        return { today, rows, lede, errors };
      } finally {
        await context.close();
      }
    };
    const science = await view('tsample003', WED);
    assert.match(science.lede, /Today is an A Day with Early Release bells\./);
    for (const period of ['4', '5', '6', '7']) assert.match(science.rows.find((row) => row[0] === period)[1], /No class/, 'Period ' + (Number(period) + 1) + ' does not meet on Early Release');
    assert.match(science.rows.find((row) => row[0] === '0')[1], /8:00 AM to 8:40 AM/, 'Period 1 rings on the Early Release bells');
    assert.match(science.today, /Science department/);
    assert.deepEqual(science.errors, []);
    const wednesday = await view('tsample004', WED);
    assert.match(wednesday.today, /Early Release bells/);
    assert.doesNotMatch(wednesday.today, /Car line/, 'the Car line does not stand on a Wednesday');
    assert.doesNotMatch(wednesday.today, /Lunch duty/);
    assert.deepEqual(wednesday.errors, []);
    const thursday = await view('tsample004', THU);
    assert.match(thursday.lede, /Today is a B Day\./);
    assert.doesNotMatch(thursday.today, /Early Release|No class/);
    assert.match(thursday.today, /Car line/, 'the Car line stands on a Thursday');
    assert.deepEqual(thursday.errors, []);
    const evening = await view('tsample001', THU);
    assert.match(evening.today, /Lunch duty/, 'the Lunch duty stands on a Thursday');
  });
}

test('the group editor with three day types keeps every room field 120 px wide or more at every window from 1100 to 1920 px, the inspector open and shut', async () => {
  const { page } = sessions.get('desktop');
  await openTab(page, 'groups');
  await page.waitForSelector('.sch-days[data-shown="3"] .picker__input');
  const inspectorOpen = () => page.$eval('#inspector', (el) => el.dataset.open === 'true');
  const wasOpen = await inspectorOpen();
  const narrowest = [];
  try {
    for (const open of [true, false]) {
      if ((await inspectorOpen()) !== open) {
        await page.click('#inspector .inspector__toggle');
        await page.waitForFunction((want) => document.getElementById('inspector').dataset.open === String(want), { timeout: 5000 }, open);
      }
      for (let width = 1100; width <= 1920; width += 20) {
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await page.waitForFunction((w) => window.innerWidth === w, { timeout: 5000 }, width);
        await settled(page);
        // the fields are laid out (a field with no box yet is not a narrow one)
        await page.waitForFunction(() => {
          const all = document.querySelectorAll('.sch-days .picker__input[data-key$=":room"]');
          return all.length >= 16 && Array.from(all).every((el) => el.getBoundingClientRect().width > 0);
        }, { timeout: 8000 });
        const rooms = await page.$$eval('.sch-days .picker__input[data-key$=":room"]', (all) => all.map((el) => el.getBoundingClientRect().width));
        const flow = await page.$eval('.sch-days', (el) => [el.dataset.shown, getComputedStyle(el).gridAutoFlow]);
        assert.ok(rooms.length >= 16, 'the room fields of two day types are there at ' + width + ' px: ' + rooms.length);
        const least = Math.min(...rooms);
        narrowest.push([open, width, flow[1], Math.round(least)]);
        assert.ok(least >= 120, 'a room field is ' + least + ' px wide at ' + width + ' px with the inspector ' + (open ? 'open' : 'shut') + ', ' + flow.join(' '));
      }
    }
  } finally {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    if ((await inspectorOpen()) !== wasOpen) await page.click('#inspector .inspector__toggle');
  }
  // the walk takes in both arrangements: the three side by side, and stacked
  assert.ok(narrowest.some((each) => each[2] === 'column') && narrowest.some((each) => each[2] === 'row'), JSON.stringify(narrowest));
});

// ---------------------------------------------------------------- a toast's Undo

const toastNow = (page) => page.evaluate(() => {
  const toast = document.querySelector('.toast');
  return toast ? { text: toast.querySelector('.toast__text').textContent, undo: Boolean(toast.querySelector('.toast__action')) } : null;
});
const dutyLabels = (page) => page.evaluate(() => globalThis.sv2.store.project.duties.map((duty) => duty.label));
const dutyId = (page, label) => page.evaluate((wanted) => globalThis.sv2.store.project.duties.find((duty) => duty.label === wanted)?.id || null, label);

test('a toast\'s Undo stands for its own change: a newer change closes the toast, and the store keeps both changes', async () => {
  const { page } = sessions.get('desktop');
  await openTab(page, 'duties');
  await page.waitForSelector('.sch-duties__table tbody tr[data-duty]');
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  const car = await dutyId(page, 'Car line');
  const bus = await dutyId(page, 'Bus duty');
  assert.ok(car && bus);
  // delete the Car line: the toast offers Undo
  await page.click('[data-key="duty:' + car + ':delete"]');
  await page.waitForFunction(() => /^Deleted /.test(document.querySelector('.toast .toast__text')?.textContent || ''), { timeout: 8000 });
  await settled(page);
  assert.equal((await toastNow(page)).undo, true);
  assert.equal(await dutyId(page, 'Car line'), null);
  // edit another duty's label: the newer change closes the toast
  await page.click('[data-key="duty:' + bus + ':label"]', { clickCount: 3 });
  await page.keyboard.type('Bus loop duty');
  await page.keyboard.press('Enter');
  // the edit is in the store: the toast, which stays six seconds, is already gone
  await page.waitForFunction(() => globalThis.sv2.store.project.duties.some((duty) => duty.label === 'Bus loop duty'), { timeout: 8000 });
  assert.equal(await toastNow(page), null, 'the Undo of the deletion went with the edit that came after it');
  assert.deepEqual((await dutyLabels(page)).sort(), ['Bus loop duty', 'Lunch duty', 'Science department'], 'both changes stand');
  assert.equal(await dutyId(page, 'Car line'), null, 'the Car line stays deleted');
  assert.ok(await dutyId(page, 'Bus loop duty'), 'the label edit stands');
});

test('a toast\'s Undo still undoes its own change when it is the latest, and the keyboard\'s undo closes the toast it has answered', async () => {
  const { page } = sessions.get('desktop');
  await openTab(page, 'duties');
  const lunch = await dutyId(page, 'Lunch duty');
  await page.click('[data-key="duty:' + lunch + ':delete"]');
  await page.waitForFunction(() => /^Deleted /.test(document.querySelector('.toast .toast__text')?.textContent || ''), { timeout: 8000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('.toast button')).find((button) => button.textContent === 'Undo').click());
  await page.waitForFunction(() => document.querySelector('.toast') === null, { timeout: 8000 });
  assert.ok(await dutyId(page, 'Lunch duty'), 'the toast\'s Undo brought the Lunch duty back');
  // again, and the keyboard takes it back instead
  await page.click('[data-key="duty:' + lunch + ':delete"]');
  await page.waitForFunction(() => /^Deleted /.test(document.querySelector('.toast .toast__text')?.textContent || ''), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('#surface').focus());
  const gone = await page.evaluate(() => {
    globalThis.sv2.store.undo();
    return document.querySelector('.toast') === null;
  });
  assert.equal(gone, true, 'the toast is gone the moment the store\'s undo is made, not six seconds later');
  assert.ok(await dutyId(page, 'Lunch duty'), 'the store\'s undo brought it back, and the toast that offered the same went');
});

test('plainSample swaps the whole sample for the plain one, has it saved when it returns, and a reload lands on it', async () => {
  // a browser of its own: a second tab of one profile would turn this one
  // read-only or failed, and Movement's first visit is itself a change
  const own = await launch();
  const session = await openPlanner({ server, browser: own, hash: '#schedule/day', theme: 'light', width: 1280, height: 800, fullSample: true });
  try {
    const { page } = session;
    await settled(page);
    const read = () => page.evaluate(() => {
      const { store, storage } = globalThis.sv2;
      return {
        bellSchedules: (store.project.bellSchedules || []).length,
        calendar: Boolean(store.project.calendar),
        marks: (store.project.marks || []).length,
        duties: (store.project.duties || []).length,
        pending: storage.pending,
        save: storage.state.save,
        savedAt: storage.state.savedAt,
        readOnly: storage.state.readOnly,
      };
    });
    const before = await read();
    assert.deepEqual([before.bellSchedules, before.calendar, before.marks, before.duties], [2, true, 3, 4], 'the page opened on the whole sample');
    assert.deepEqual([before.pending, before.save, before.savedAt], [false, 'off', null], 'and has saved nothing of it');
    await plainSample(page);
    const right = await read();
    assert.deepEqual([right.bellSchedules, right.calendar, right.marks, right.duties], [0, false, 0, 0], 'it is the plain sample when plainSample returns');
    assert.equal(right.pending, false, 'nothing is waiting to be saved: the swap is written, not left to a timer');
    assert.equal(right.save, 'saved');
    assert.notEqual(right.savedAt, null);
    assert.equal(right.readOnly, false);
    // the sections have answered from the swapped project: the Day tab has none of the new cards
    assert.equal(await page.$$eval('table[data-bells]', (all) => all.length), 0);
    assert.equal(await page.$$eval('.sch-marks__line', (all) => all.length), 0);
    // and a reload at once, as the tests that pin a clock do, opens on it
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && document.documentElement.dataset.ready === 'true', { timeout: 15000 });
    const reloaded = await read();
    assert.deepEqual([reloaded.bellSchedules, reloaded.calendar, reloaded.marks, reloaded.duties], [0, false, 0, 0], 'the reload opened on the plain sample');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close().catch(() => {});
    await own.close();
  }
});
