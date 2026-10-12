// The Grid tab after the walk-through of the schedule, in a real browser:
// node test/browser/grid-pass.mjs
//
// What the walk-through found: the four field columns took 425 px before the
// first period on a 1280 px screen, a phone showed no period at all, and the
// Teachers and Rooms tables said nothing about a double-booking the Groups
// grid marked. Each case here is one of those, measured on the page as drawn.
//
// And what a review of that work found (the cases from "a cursor left in
// Grade" on): columns that are hidden are hidden by a rule, not by what has a
// box; a block is what is on screen, for copy, paste, Delete and Fill down
// alike; the marks of a table for reading are one Tab stop; the sentence of a
// mark stays inside the table's frame; a colour typed in shows at once.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch } from './harness.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const A6 = 'gsample06a';
const B6 = 'gsample06b';
const C6 = 'gsample06c';
const C7 = 'gsample07c';
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

// The box of the sentence a marked cell draws while it has the keyboard's
// focus, or null when none is drawn. It is a ::after, which has no box to ask
// for: this is its used left, top, width and height, from the padding edge of
// the cell it is placed against.
const popup = (page, selector) => page.$eval(selector, (cell) => {
  const drawn = getComputedStyle(cell, '::after');
  if (drawn.content === 'none') return null;
  const at = cell.getBoundingClientRect();
  const edge = getComputedStyle(cell);
  const left = at.left + parseFloat(edge.borderLeftWidth) + parseFloat(drawn.left);
  const top = at.top + parseFloat(edge.borderTopWidth) + parseFloat(drawn.top);
  return { left, top, right: left + parseFloat(drawn.width), bottom: top + parseFloat(drawn.height), width: parseFloat(drawn.width), height: parseFloat(drawn.height) };
});
// The inside of the frame a table for reading scrolls in.
const frameOf = (page) => page.$eval('.grd-below .grd-scroll', (el) => {
  const rect = el.getBoundingClientRect();
  return { left: rect.left + el.clientLeft, top: rect.top + el.clientTop, right: rect.left + el.clientLeft + el.clientWidth, bottom: rect.top + el.clientTop + el.clientHeight };
});
// Into a table for reading as the keyboard goes: its frame, then one Tab.
async function tabInto(page) {
  await page.focus('.grd-below .grd-scroll');
  await page.keyboard.press('Tab');
}
const why = (page) => page.evaluate(() => getComputedStyle(document.activeElement, '::after').content);
const status = (page) => page.$eval('.grd-status', (el) => el.textContent);
const cellText = (page, selector) => page.$eval(selector + ' .grd-cell__text', (el) => el.textContent);
const isStaged = (page, selector) => page.$eval(selector, (el) => el.classList.contains('is-staged'));
const selectedKeys = (page) => page.$$eval('.grd-sheet [aria-selected="true"]', (all) => all.map((cell) => cell.dataset.key.replace(/^grid:/, '')));
const stagedIs = (page, wanted) => page.waitForFunction((value) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.staged === value, { timeout: 5000 }, String(wanted));
// The grid's Tab stops and whether each has a box, read in one turn of the
// page. ($$eval is two: it finds the cells, then asks them, and a grid drawn
// again in between hands back a cell that has left the page, which has no box.)
const tabStops = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.grd-sheet [tabindex="0"]'), (cell) => ({ key: cell.dataset.key, boxed: cell.getClientRects().length > 0 })));
// The grid's section mounted and shown, and done with what a change of width
// brings: the page tells the grid a width was crossed in its next frame, which
// on a busy machine comes after the grid is on screen, and the grid is then
// drawn again. Two frames, so that has been said; then the drawing it asked for.
async function gridShown(page) {
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.sch .grd-sheet');
    return Boolean(sheet) && sheet.isConnected && sheet.getClientRects().length > 0;
  }, { timeout: 5000 });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await settled(page);
}

// The cursor on one cell, with no block left over from the case before:
// focus on the cell the cursor is already on keeps the block's other corner.
async function cursorOn(page, selector) {
  await settled(page);
  await page.focus(selector);
  await page.keyboard.press('Escape');
}

// What Ctrl+V and Ctrl+C do on the cell the cursor is on.
async function paste(page, tsv) {
  await settled(page);
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, tsv);
  await settled(page);
}
const copied = (page) => page.evaluate(() => {
  const data = new DataTransfer();
  document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData('text/plain');
});

// Throw away what is staged, so the page does not ask before it closes and
// the next case reads the sample as it is.
async function discard(page) {
  await settled(page);
  if (await page.$eval('.grd', (el) => el.dataset.staged) !== 'true') return;
  await page.evaluate(() => {
    document.querySelector('.toast__close')?.click();
    document.querySelector('.grd-bar [data-action="discard"]').click();
  });
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => document.querySelector('dialog[open] .btn--danger').click());
  await stagedIs(page, false);
}

// Change the project behind the page, and take the changes back.
const change = (page, name, payload) => page.evaluate(async (action, given) => {
  const actions = await import('./engine/actions.js');
  globalThis.sv2.store.apply(actions[action], given);
}, name, payload);
async function undo(page, times) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 1) globalThis.sv2.store.undo();
  }, times);
  await settled(page);
}

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
  await tabInto(page);
  assert.equal(await page.$eval(cell, (el) => el === document.activeElement), true, 'one Tab from the frame is on the marked cell');
  assert.match(await page.$eval(cell, (el) => getComputedStyle(el, '::after').content), /Problem: Room 203 has two groups in Period 2 on A Day/, 'in the keyboard’s focus the sentence is drawn under the cell');
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

// ---------------------------------------------------------------- after the review

test('a cursor left in Grade, the grid left, the screen narrowed, the grid come back to: its one Tab stop has a box', async () => {
  const turn = await openGrid({ width: 1280, height: 800 });
  const { page } = turn;
  try {
    await page.focus(key(A6, 'grade'));
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':grade', boxed: true }]);
    await go(page, '#building');
    await page.setViewport({ width: 390, height: 760, deviceScaleFactor: 1 });
    await go(page, '#schedule/grid');
    await gridShown(page);
    assert.equal(await box(page, key(A6, 'grade')), null, 'Grade is hidden at 390');
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':name', boxed: true }], 'the Tab stop went to the group’s name');

    // the same with the grid open while the width is crossed
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length > 0, { timeout: 5000 }, key(A6, 'grade'));
    await page.focus(key(A6, 'headCount'));
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':headCount', boxed: true }]);
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length === 0, { timeout: 5000 }, key(A6, 'headCount'));
    await gridShown(page);
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':name', boxed: true }], 'crossing 640 px moved the Tab stop to Group');
  } finally {
    const found = turn.problems();
    await turn.page.close();
    assert.deepEqual(found, { errors: [], blocked: [], shimmed: [] });
  }
});

test('an arrow key asks the page for no box: which columns are hidden is a rule', async () => {
  const { page } = phone;
  await settled(page);
  await page.focus(key(A6, 'name'));
  await page.evaluate(() => {
    const asked = Element.prototype.getClientRects;
    globalThis.__boxes = 0;
    Element.prototype.getClientRects = function counted() {
      globalThis.__boxes += 1;
      return asked.call(this);
    };
    globalThis.__putBack = () => {
      Element.prototype.getClientRects = asked;
    };
  });
  try {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await activeKey(page), 'grid:' + B6 + ':name', 'the cursor still steps over what is hidden');
    assert.equal(await page.evaluate(() => globalThis.__boxes), 0);
  } finally {
    await page.evaluate(() => globalThis.__putBack());
  }
});

test('on a phone a block is what is on screen: hidden columns are not selected and not copied', async () => {
  const { page } = phone;
  await settled(page);
  assert.equal(await page.$eval('.grd', (el) => el.dataset.fields), 'hidden');
  await cursorOn(page, key(A6, 'name'));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  assert.deepEqual(await selectedKeys(page), [
    A6 + ':name', A6 + ':' + DAY_A + ':0', A6 + ':' + DAY_A + ':1',
    B6 + ':name', B6 + ':' + DAY_A + ':0', B6 + ':' + DAY_A + ':1',
  ], 'Group and two periods of two groups, and nothing that is out of sight');
  assert.equal(await copied(page), '6A\t201\t103\r\n6B\t203\tGym');
  assert.equal(await status(page), 'Copied 6 cells.');
});

test('on a phone a pasted row wider than Group goes into the periods, not into the columns out of sight', async () => {
  const { page } = phone;
  await settled(page);
  await cursorOn(page, key(A6, 'name'));
  await paste(page, '6A\t202\t204\r\n');
  try {
    await stagedIs(page, true);
    assert.equal(await status(page), 'Pasted 3 cells.');
    assert.deepEqual([await cellText(page, slot(A6, DAY_A, 0)), await cellText(page, slot(A6, DAY_A, 1))], ['202', '204']);
    assert.deepEqual([await cellText(page, key(A6, 'grade')), await cellText(page, key(A6, 'headCount'))], ['6', '24'], 'Grade and Head count are as they were');
    assert.deepEqual([await isStaged(page, key(A6, 'grade')), await isStaged(page, key(A6, 'headCount')), await isStaged(page, key(A6, 'colour'))], [false, false, false]);
    assert.deepEqual(await selectedKeys(page), [A6 + ':name', A6 + ':' + DAY_A + ':0', A6 + ':' + DAY_A + ':1'], 'what was pasted is selected');

    // one copied cell over a block fills what is on screen of it
    await paste(page, 'Gym');
    assert.equal(await status(page), 'Pasted 3 cells.', 'the name and two periods');
    assert.deepEqual([await cellText(page, key(A6, 'name')), await cellText(page, slot(A6, DAY_A, 0)), await cellText(page, slot(A6, DAY_A, 1))], ['Gym', 'Gym', 'Gym']);
    assert.deepEqual([await cellText(page, key(A6, 'grade')), await cellText(page, key(A6, 'headCount'))], ['6', '24']);
  } finally {
    await discard(page);
  }
});

test('on a phone Delete empties only what is on screen of a block', async () => {
  const { page } = phone;
  await settled(page);
  await cursorOn(page, key(A6, 'name'));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Delete');
  try {
    await stagedIs(page, true);
    assert.equal(await status(page), 'Cleared 1 cell.');
    assert.equal(await cellText(page, slot(A6, DAY_A, 0)), '');
    assert.deepEqual([await cellText(page, key(A6, 'grade')), await cellText(page, key(A6, 'headCount'))], ['6', '24']);
    assert.deepEqual([await isStaged(page, key(A6, 'grade')), await isStaged(page, key(A6, 'headCount'))], [false, false]);
  } finally {
    await discard(page);
  }
});

test('on a phone Fill down fills only what is on screen of a block', async () => {
  const { page } = phone;
  await settled(page);
  // from Period 1 back to Group, then down a row: the block crosses the
  // hidden columns and its top row is 6A
  await cursorOn(page, slot(A6, DAY_A, 0));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await page.evaluate(() => document.querySelector('.grd-toolbar [data-action="fill-down"]').click());
  try {
    await stagedIs(page, true);
    // the name is refused (6A is taken); the room is the one cell filled
    assert.match(await status(page), /^Filled down 1 cell from 6A\. 1 cell was not taken: There is already a group called "6A"\./);
    assert.equal(await cellText(page, slot(B6, DAY_A, 0)), '201');
    assert.deepEqual([await cellText(page, key(B6, 'headCount')), await isStaged(page, key(B6, 'headCount')), await isStaged(page, key(B6, 'colour'))], ['26', false, false], '6B keeps its own head count and colour');
  } finally {
    await discard(page);
  }
});

test('the marks of a table for reading are one Tab stop, the arrow keys go from mark to mark, and only the keyboard draws the sentence', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  const stops = () => page.$$eval('.grd-table--read .is-marked', (all) => all.map((cell) => cell.tabIndex));
  const on = () => page.evaluate(() => {
    const cell = document.activeElement;
    return cell.classList.contains('is-marked') ? cell.parentElement.children[0].textContent + ' ' + cell.dataset.severity : null;
  });
  // Room 203's double-booking, then the Cafeteria's note
  assert.deepEqual(await stops(), [0, -1]);
  await tabInto(page);
  assert.equal(await on(), '203 problem');
  assert.match(await why(page), /Problem: Room 203 has two groups/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await on(), 'Cafeteria note');
  assert.deepEqual(await stops(), [-1, 0], 'the Tab stop goes with the focus');
  assert.match(await why(page), /Note: /);
  await page.keyboard.press('ArrowDown');
  assert.equal(await on(), 'Cafeteria note', 'no mark below: it stays');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await on(), '203 problem');
  await page.keyboard.press('ArrowRight');
  assert.equal(await on(), 'Cafeteria note');
  await page.keyboard.press('Home');
  assert.equal(await on(), '203 problem');
  await page.keyboard.press('End');
  assert.equal(await on(), 'Cafeteria note');
  await page.keyboard.press('ArrowUp');
  assert.equal(await on(), '203 problem');
  // one stop: the next Tab is out of the table
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.grd-table--read'))), false);

  // a click puts the focus on a mark and draws nothing: a pointer has the title
  const note = '.grd-table--read .grd-cell--read[data-severity="note"]';
  await page.$eval(note, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  const at = await box(page, note);
  await page.mouse.click(at.left + at.width / 2, at.top + at.height / 2);
  assert.equal(await on(), 'Cafeteria note');
  assert.equal(await why(page), 'none', 'a click draws no sentence');
  assert.deepEqual(await stops(), [-1, 0]);
  await rowsAre(page, 'groups');
});

test('the sentence of a mark stays inside the frame: at the right edge, and in the last row of a table of two or three rows', async () => {
  const { page } = desk;
  const inside = async (selector, what) => {
    const drawn = await popup(page, selector);
    const frame = await frameOf(page);
    assert.notEqual(drawn, null, what + ': the sentence is drawn');
    assert.ok(drawn.left >= frame.left - 0.5 && drawn.right <= frame.right + 0.5, what + ': the sentence is at ' + drawn.left + ' to ' + drawn.right + ' in a frame of ' + frame.left + ' to ' + frame.right);
    assert.ok(drawn.top >= frame.top - 0.5 && drawn.bottom <= frame.bottom + 0.5, what + ': the sentence is at ' + drawn.top + ' to ' + drawn.bottom + ' down a frame of ' + frame.top + ' to ' + frame.bottom);
  };
  // browsers that do not read `content: … / ""` need the plain form before it
  const sheet = await page.evaluate(() => fetch(document.querySelector('link[data-sheet="grid"]').href).then((answer) => answer.text()));
  assert.match(sheet, /content: attr\(data-why\);\s+content: attr\(data-why\) \/ "";/);

  // the last period of the last day in the last room: three groups in the
  // Library, which seats 60
  for (const group of [A6, B6, C6]) await change(page, 'setSlot', { groupId: group, dayTypeId: DAY_B, period: 7, slot: { room: 'rsamplelib' } });
  try {
    await rowsAre(page, 'rooms');
    const corner = '.grd-table--read tbody tr:last-child td:last-child';
    assert.equal(await page.$eval(corner, (el) => el.parentElement.children[0].textContent + ' ' + el.dataset.severity), 'Library warning');
    await tabInto(page);
    await page.keyboard.press('End');
    assert.equal(await page.$eval(corner, (el) => el === document.activeElement), true);
    await inside(corner, 'the corner cell of the Rooms table');
  } finally {
    // back to the sample and to the Groups rows, whatever was found, so the
    // cases after this one start where they expect to
    await undo(page, 3);
    await rowsAre(page, 'groups');
  }

  // Ms. Vandermeer in the last row of three teachers, then of two
  const others = ['tsample003', 'tsample004', 'tsample005', 'tsample006', 'tsample008', 'tsample009', 'tsample010', 'tsample011', 'tsample012'];
  for (const id of others) await change(page, 'deleteTeacher', { id });
  let changes = others.length;
  try {
    const cell = '.grd-table--read tbody tr:last-child .is-marked';
    const names = () => page.$$eval('.grd-table--read tbody tr', (rows) => rows.map((tr) => tr.children[0].textContent));
    await rowsAre(page, 'teachers');
    assert.deepEqual(await names(), ['Ms. Halloran', 'Mr. Brightwater', 'Ms. Vandermeer']);
    await tabInto(page);
    await inside(cell, 'the last of three rows');

    await change(page, 'deleteTeacher', { id: 'tsample002' });
    changes += 1;
    await settled(page);
    assert.deepEqual(await names(), ['Ms. Halloran', 'Ms. Vandermeer']);
    await tabInto(page);
    await inside(cell, 'the last of two rows');
  } finally {
    await undo(page, changes);
    await rowsAre(page, 'groups');
  }
});

test('a colour typed into its cell shows in the swatch at once', async () => {
  const { page } = desk;
  await settled(page);
  // in one turn of the page, so nothing has been drawn again in between
  const found = await page.evaluate((selector) => {
    const cell = document.querySelector(selector);
    const press = (on) => on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    cell.focus();
    press(cell);
    const field = cell.querySelector('.grd-input');
    field.value = ' #1A2B3C ';
    press(field);
    const swatch = cell.querySelector('.grd-colour');
    return { field: Boolean(cell.querySelector('.grd-input')), swatch: swatch && swatch.type + ' ' + swatch.value, title: cell.title, text: cell.querySelector('.grd-cell__text').textContent, hidden: cell.querySelector('.grd-cell__text').classList.contains('vh') };
  }, key(A6, 'colour'));
  try {
    assert.deepEqual(found, { field: false, swatch: 'color #1a2b3c', title: '#1a2b3c', text: '#1a2b3c', hidden: true });
    await stagedIs(page, true);
    assert.equal(await page.$eval(key(A6, 'colour') + ' .grd-colour', (el) => el.value), '#1a2b3c', 'and it is the same once the tab is drawn again');
  } finally {
    await discard(page);
  }
});

// 60 characters, none of them a room in the building
const SIXTY = 'Portable Classroom 14 in the East Annex, beside the Bus Loop';

// What a slot cell holding a long name looks like: the name, how many lines
// it is on, and its mark against it.
const longCell = (page, selector) => page.$eval(selector, (cell) => {
  const span = cell.querySelector('.grd-cell__text');
  const mark = cell.querySelector('.grd-cell__mark');
  const text = span.getBoundingClientRect();
  const sign = mark.getBoundingClientRect();
  const all = cell.getBoundingClientRect();
  return {
    text: span.textContent,
    lines: Math.round(text.height / parseFloat(getComputedStyle(span).lineHeight)),
    width: text.width,
    mark: mark.textContent,
    markAfter: sign.left >= text.right - 0.5,
    markBeside: sign.top >= text.top - 0.5 && sign.bottom <= text.bottom + 0.5,
    markInside: sign.right <= all.right && sign.bottom <= all.bottom,
    cell: all.width,
    cut: cell.scrollWidth > cell.clientWidth || cell.scrollHeight > cell.clientHeight,
  };
});

async function typeLong(page, selector) {
  await settled(page);
  await page.focus(selector);
  await page.keyboard.type(SIXTY);
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
}

test('a room name of 60 characters wraps in its cell, with the mark beside the two lines', async () => {
  const { page } = desk;
  assert.equal(SIXTY.length, 60);
  await typeLong(page, slot(A6, DAY_A, 0));
  try {
    const found = await longCell(page, slot(A6, DAY_A, 0));
    assert.deepEqual({ text: found.text, lines: found.lines, mark: found.mark, markAfter: found.markAfter, markBeside: found.markBeside, markInside: found.markInside, cut: found.cut },
      { text: SIXTY, lines: 2, mark: '▲', markAfter: true, markBeside: true, markInside: true, cut: false });
    assert.ok(found.width <= 288.5, 'the name is ' + found.width + ' px wide, past 18rem');
  } finally {
    await discard(page);
  }
});

test('on a phone a long room name is no wider than the screen leaves beside Group', async () => {
  const { page } = phone;
  await typeLong(page, slot(A6, DAY_A, 0));
  try {
    const found = await longCell(page, slot(A6, DAY_A, 0));
    assert.equal(found.text, SIXTY);
    assert.equal(found.cut, false);
    assert.equal(found.markInside, true);
    assert.ok(found.width < 288, 'the name is ' + found.width + ' px wide on a 390 px screen, the 18rem of a wide one');
    const name = await box(page, key(A6, 'name'));
    const frame = await box(page, '.grd-sheet .grd-scroll');
    assert.ok(name.width + found.cell <= frame.width, 'Group (' + name.width + ') and the cell (' + found.cell + ') fit the frame (' + frame.width + ') together');
  } finally {
    await discard(page);
  }
});

test('a cell with two findings says both, the worst first, in all three tables', async () => {
  const { page } = desk;
  // 6C (23 students) and 7C (22) are both in Room 203 in Period 2; now it seats 22
  await change(page, 'setRoomFields', { roomId: 'rsample203', capacity: 22 });
  try {
    await settled(page);
    const both = /^Problem: Room 203 has two groups in Period 2 on A Day: 6C and 7C\. .* Warning: 6C has 23 students and Room 203 seats 22, in Period 2 on A Day\. The group needs a larger room\.$/;
    const one = /^Problem: Room 203 has two groups in Period 2 on A Day: 6C and 7C\. \S[^:]*$/;
    assert.match(await page.$eval(slot(C6, DAY_A, 1), (el) => el.title), both);
    assert.equal(await page.$eval(slot(C6, DAY_A, 1), (el) => el.dataset.severity + ' ' + el.querySelector('.grd-cell__mark').textContent), 'problem ●');
    assert.match(await page.$eval(slot(C6, DAY_A, 1) + ' .vh:last-child', (el) => el.textContent.trim()), both, 'and in words for a screen reader');
    assert.match(await page.$eval(slot(C7, DAY_A, 1), (el) => el.title), one, '7C fits the room: its cell has the one');
    for (const rows of ['teachers', 'rooms']) {
      await rowsAre(page, rows);
      const cell = '.grd-table--read .grd-cell--read[data-severity="problem"]';
      assert.match(await page.$eval(cell, (el) => el.title), both, rows);
      assert.match(await page.$eval(cell, (el) => el.dataset.why), both, rows);
      assert.deepEqual(await page.$eval(cell, (el) => el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent.split(':')[0])), ['Problem', 'Warning'], rows);
    }
  } finally {
    await rowsAre(page, 'groups');
    await undo(page, 1);
  }
});
