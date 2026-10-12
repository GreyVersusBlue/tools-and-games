// The Grid tab after the walk-through of the schedule, in a real browser:
// node test/browser/grid-pass.mjs
//
// What the walk-through found: the four field columns took 425 px before the
// first period on a 1280 px screen, a phone showed no period at all, and the
// Teachers and Rooms tables said nothing about a double-booking the Groups
// grid marked. Each case here is one of those, measured on the page as drawn.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch } from './harness.mjs';

const DAY_A = 'dsample00a';
const A6 = 'gsample06a';
const LONG_NAME = 'Portable Classroom 14, East Annex';

let server;
let browser;
let desk;
let phone;

const key = (group, column) => '[data-key="grid:' + group + ':' + column + '"]';
const slot = (group, day, period) => key(group, day + ':' + period);
const settled = (page) => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
const activeKey = (page) => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
// left, right and width of what a selector finds, or null when it has no box
const box = (page, selector) => page.$eval(selector, (el) => {
  if (el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
});

async function openGrid(size) {
  const session = await openPlanner({ server, browser, hash: '#schedule/grid', theme: 'light', ...size });
  await session.page.waitForFunction(() => document.querySelector('link[data-sheet="grid"]')?.sheet && getComputedStyle(document.querySelector('.grd-sheet')).position === 'relative');
  await settled(session.page);
  return session;
}

async function rowsAre(page, rows) {
  await settled(page);
  await page.evaluate((value) => document.querySelector('.grd-toolbar input[value="' + value + '"]').click(), rows);
  await page.waitForFunction((value) => document.querySelector('.grd').dataset.rows === value && document.querySelector('.sch').dataset.pending !== 'true', { timeout: 5000 }, rows);
}

// The marked cells of the table for reading: [row's name, column, severity],
// the column counted from the first period of the first day type as 1.
const marked = (page) => page.$$eval('.grd-table--read tbody tr', (rows) => rows.flatMap((tr) => Array.from(tr.children)
  .map((cell, column) => (cell.dataset.severity ? [tr.children[0].textContent, column, cell.dataset.severity] : null))
  .filter(Boolean)));

before(async () => {
  server = await startServer();
  browser = await launch();
  desk = await openGrid({ width: 1280, height: 800 });
  phone = await openGrid({ width: 390, height: 760, mobile: true });
});

after(async () => {
  const problems = [desk, phone].filter(Boolean).map((session) => session.problems());
  if (browser) await browser.close();
  if (server) await server.close();
  for (const found of problems) assert.deepEqual(found, { errors: [], blocked: [], shimmed: [] });
});

test('a colour cell is its swatch alone, with the hex in its title and in the field it is edited in', async () => {
  const { page } = desk;
  const hex = await page.evaluate((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).colour, A6);
  const cell = key(A6, 'colour');
  assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.equal(await page.$eval(cell, (el) => el.title), hex, 'the hex is the title');
  assert.equal(await page.$eval(cell + ' .grd-colour', (el) => el.type + ' ' + el.value), 'color ' + hex, 'the swatch is still the control that picks a colour');
  assert.equal(await page.$(cell + ' .sch-dot'), null, 'no dot beside the swatch');
  // the hex is still in the cell for a screen reader, and takes no room
  assert.equal(await page.$eval(cell + ' .grd-cell__text', (el) => el.textContent), hex);
  assert.ok((await box(page, cell + ' .grd-cell__text')).width <= 1, 'the hex is not drawn in the cell');
  const swatch = await box(page, cell + ' .grd-colour');
  const colour = await box(page, cell);
  assert.ok(colour.width <= swatch.width + 40, 'the Colour column is a swatch wide, not ' + colour.width + ' px');

  // Grade and Head count are as narrow as their headings
  for (const field of ['grade', 'headCount']) {
    const width = await page.$eval('.grd-sheet .grd-head--' + field, (th) => {
      const range = document.createRange();
      range.selectNodeContents(th);
      return { column: th.getBoundingClientRect().width, heading: range.getBoundingClientRect().width };
    });
    assert.ok(width.column <= width.heading + 18, field + ' is ' + width.column + ' px wide under a heading of ' + width.heading + ' px');
  }
  // together: the first period starts well inside the 425 px the four took
  const group = await box(page, '.grd-sheet .grd-head--name');
  const first = await box(page, '.grd-sheet .grd-head--period');
  assert.ok(first.left - group.left <= 340, 'the field columns take ' + (first.left - group.left) + ' px before the first period');

  // typing on the cell edits the hex
  await page.focus(cell);
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval(cell + ' .grd-input', (el) => el.value), hex, 'the hex is what the cell is edited as');
  // the field is wide enough to read a hex in, though its column is not
  assert.ok((await box(page, cell + ' .grd-input')).width >= 90);
  await page.keyboard.press('Escape');
  assert.equal(await page.$(cell + ' .grd-input'), null);
});

test('a period column is as wide as the longest room name in it, so no name is cut', async () => {
  const { page } = desk;
  // what a cell holds against the room it has: the text as a canvas measures
  // it in the cell's own font, the text as drawn, and the cell
  const measure = (selector) => page.$eval(selector, (cell) => {
    const span = cell.querySelector('.grd-cell__text');
    const style = getComputedStyle(span);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    const drawn = span.getBoundingClientRect();
    const last = cell.querySelector('.grd-cell__mark') || span;
    const inner = cell.getBoundingClientRect();
    return {
      text: span.textContent,
      asked: canvas.measureText(span.textContent).width,
      drawn: drawn.width,
      lines: Math.round(drawn.height / parseFloat(style.lineHeight)),
      right: last.getBoundingClientRect().right,
      cellRight: inner.right - parseFloat(getComputedStyle(cell).paddingRight),
      cut: cell.scrollWidth > cell.clientWidth,
    };
  });
  const fits = (found) => {
    assert.equal(found.lines, 1, found.text + ' is on one line');
    assert.ok(found.drawn >= found.asked - 1, found.text + ' is drawn ' + found.drawn + ' px wide and needs ' + found.asked);
    assert.ok(found.right <= found.cellRight + 0.5, found.text + ' ends at ' + found.right + ', past the cell’s ' + found.cellRight);
    assert.equal(found.cut, false, found.text + ' is cut by its cell');
  };

  // the sample's widest: the Cafeteria, with a note's mark after it
  const cafeteria = await measure(slot(A6, DAY_A, 3));
  assert.equal(cafeteria.text, 'Cafeteria');
  assert.equal(await page.$eval(slot(A6, DAY_A, 3) + ' .grd-cell__mark', (el) => el.textContent), '◆');
  fits(cafeteria);

  // a name wider than any column was allowed to be before (14rem)
  await page.focus(slot(A6, DAY_A, 0));
  await page.keyboard.type(LONG_NAME);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.staged === 'true', { timeout: 5000 });
  try {
    const long = await measure(slot(A6, DAY_A, 0));
    assert.equal(long.text, LONG_NAME);
    assert.ok(long.asked > 224, 'the case needs a name wider than 14rem; this one is ' + long.asked + ' px');
    fits(long);
    const head = await box(page, '.grd-sheet .grd-head--period');
    assert.ok(head.width > long.asked, 'the column is ' + head.width + ' px for a name of ' + long.asked);
  } finally {
    // the edit is not left waiting, whatever was found: the page would ask
    // before it closed, and the cases after this one read the sample as it is
    await page.evaluate(() => document.querySelector('.toast__close')?.click());
    await page.click('.grd-bar [data-action="discard"]');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] .btn--danger');
    await page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.staged === 'false', { timeout: 5000 });
  }
});

test('on a wide screen every field column shows, there is no Fields button, and the key hint is above the table', async () => {
  const { page } = desk;
  assert.notEqual(await box(page, key(A6, 'grade')), null);
  assert.equal(await box(page, '.grd-toolbar [data-action="fields"]'), null, 'Fields is for a narrow screen');
  const hint = await box(page, '.grd-hint');
  const sheet = await box(page, '.grd-sheet');
  assert.ok(hint.bottom <= sheet.top, 'the hint ends at ' + hint.bottom + ' and the table starts at ' + sheet.top);
  assert.match(await page.$eval('.grd-hint', (el) => el.innerText), /^Arrow keys move\..* is not in the building\.$/);
  assert.equal(await page.$('.grd-below .grd-hint'), null, 'nothing is left under the table, where toasts land');
});

test('on a phone the first period is on screen beside Group, which stays put, and Fields brings Grade back', async () => {
  const { page } = phone;
  const scroller = '.grd-sheet .grd-scroll';
  assert.deepEqual(await page.evaluate((selector) => [window.innerWidth, window.scrollX, document.querySelector(selector).scrollLeft], scroller), [390, 0, 0], 'nothing has been scrolled');
  const first = await box(page, slot(A6, DAY_A, 0));
  assert.ok(first.left >= 0 && first.right <= 390, 'Period 1 of 6A is at ' + first.left + ' to ' + first.right + ' of 390');
  const frame = await box(page, scroller);
  assert.ok(first.right <= frame.right, 'and inside the table’s own frame, which ends at ' + frame.right);
  for (const field of ['grade', 'headCount', 'colour']) {
    assert.equal(await box(page, key(A6, field)), null, field + ' is hidden');
    assert.equal(await box(page, '.grd-sheet .grd-head--' + field), null, field + '’s heading is hidden');
  }
  assert.equal(await page.$eval('.grd-toolbar [data-action="fields"]', (el) => el.textContent + ' ' + el.getAttribute('aria-pressed')), 'Fields false');

  // the periods scroll under Group
  const name = await box(page, key(A6, 'name'));
  await page.$eval(scroller, (el) => {
    el.scrollLeft = 150;
  });
  assert.equal((await box(page, key(A6, 'name'))).left, name.left, 'Group has not moved');
  assert.equal((await box(page, slot(A6, DAY_A, 0))).left, first.left - 150, 'Period 1 has');
  await page.$eval(scroller, (el) => {
    el.scrollLeft = 0;
  });

  // the cursor steps over what is hidden
  await page.focus(key(A6, 'name'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeKey(page), 'grid:' + A6 + ':' + DAY_A + ':0');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await activeKey(page), 'grid:' + A6 + ':name');

  // on a screen this narrow the keys are not listed over the table; the legend is
  assert.equal(await box(page, '.grd-hint__keys'), null);
  assert.equal(await page.$eval('.grd-hint', (el) => el.innerText), 'A room number with a dotted line under it is not in the building.');

  await page.tap('.grd-toolbar [data-action="fields"]');
  await page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.fields === 'shown', { timeout: 5000 });
  assert.notEqual(await box(page, key(A6, 'grade')), null, 'Grade is back');
  assert.equal(await page.$eval(key(A6, 'grade') + ' .grd-cell__text', (el) => el.textContent), '6');
  assert.equal(await page.$eval('.grd-toolbar [data-action="fields"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await activeKey(page), 'grid-fields', 'the button keeps the focus');
  assert.equal(await page.$eval('.grd-status', (el) => el.textContent), 'Showing Grade, Head count and Colour.');

  // remembered while the page is open: through the Teachers table and back
  await rowsAre(page, 'teachers');
  await rowsAre(page, 'groups');
  assert.notEqual(await box(page, key(A6, 'grade')), null, 'Grade is still shown');

  // hidden again with the cursor in Grade: the cursor goes to the group's
  // name, so the grid keeps its one Tab stop
  await page.focus(key(A6, 'grade'));
  await page.tap('.grd-toolbar [data-action="fields"]');
  await page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.fields === 'hidden', { timeout: 5000 });
  assert.equal(await box(page, key(A6, 'grade')), null);
  assert.deepEqual(await page.$$eval('.grd-sheet [tabindex="0"]', (all) => all.map((cell) => cell.dataset.key)), ['grid:' + A6 + ':name']);
});

test('the Teachers and Rooms tables mark the double-booking the Groups grid marks, with its sentence on hover and in focus', async () => {
  const { page } = desk;
  // what the Groups grid marks, to hold the other two against
  const inGroups = await page.$$eval('.grd-sheet .grd-cell--slot[data-severity]', (cells) => cells.map((cell) => cell.dataset.key.replace(/^grid:/, '') + ' ' + cell.dataset.severity).sort());
  assert.deepEqual(inGroups, [
    'gsample06a:dsample00a:3 note',
    'gsample06b:dsample00a:3 note',
    'gsample06c:dsample00a:1 problem',
    'gsample06c:dsample00a:3 note',
    'gsample07c:dsample00a:1 problem',
  ]);

  await rowsAre(page, 'teachers');
  // 6C and 7C are both in Room 203 in Period 2 on A Day, and Ms. Vandermeer has both
  assert.deepEqual(await marked(page), [['Ms. Vandermeer', 2, 'problem']]);
  const cell = '.grd-table--read .grd-cell--read[data-severity="problem"]';
  const sentence = /^Problem: Room 203 has two groups in Period 2 on A Day: 6C and 7C\./;
  assert.match(await page.$eval(cell, (el) => el.title), sentence, 'on hover');
  assert.equal(await page.$eval(cell, (el) => el.textContent), '6C in 203, 7C in 203● (problem)');
  assert.equal(await page.$eval(cell + ' .grd-cell__mark', (el) => el.textContent + ' ' + el.getAttribute('aria-hidden')), '● true');
  // the sentence is the cell's description, from a line that is in the page
  const described = await page.$eval(cell, (el) => el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent).join(' '));
  assert.match(described, sentence);
  assert.equal(described, await page.$eval(cell, (el) => el.title));
  // and it can be reached and read without a pointer
  assert.equal(await page.$eval(cell, (el) => el.tabIndex), 0);
  assert.equal(await page.$eval(cell, (el) => getComputedStyle(el, '::after').content), 'none');
  await page.focus(cell);
  assert.match(await page.$eval(cell, (el) => getComputedStyle(el, '::after').content), /Problem: Room 203 has two groups in Period 2 on A Day/, 'in focus the sentence is drawn under the cell');
  // an unmarked cell is not a Tab stop
  assert.equal(await page.$$eval('.grd-table--read .grd-cell--read:not([data-severity])', (all) => all.filter((el) => el.hasAttribute('tabindex') || el.title !== '').length), 0);

  await rowsAre(page, 'rooms');
  assert.deepEqual(await marked(page), [['203', 2, 'problem'], ['Cafeteria', 4, 'note']]);
  assert.match(await page.$eval(cell, (el) => el.title), sentence);
  assert.equal(await page.$eval(cell, (el) => el.textContent), '6C, 7C● (problem)');
  // one line for a finding, whichever cells it is on
  assert.equal(await page.$$eval('.grd-below .grd-why p', (all) => all.length), 2);
  await rowsAre(page, 'groups');
});
