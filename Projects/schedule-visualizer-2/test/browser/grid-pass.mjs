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
//
// And what the review of that found in its turn (the cases from "a tap on a
// marked cell" on): a finger reads a mark's sentence by tapping it; a field
// open in a column that goes out of sight closes; the sentence is placed
// again when its frame moves and is never taller than what holds it; the
// worst finding is said first whatever order they were gathered in; a long
// group name does not take a phone's width from the periods; an arrow goes
// the way it points where the page reads right to left.

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
// The grid's section mounted and shown, and drawn for the width the window
// has now. The section leaves the width each drawing was made for on itself
// (`data-narrow`), and that is what is waited for: the browser says a width
// was crossed some time after the window has it, on a busy machine long
// after, and a count of frames returned before the grid had been drawn for
// it (the cursor still in a column out of sight, the focus on nothing).
async function gridShown(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.sch');
    const sheet = section && section.querySelector('.grd-sheet');
    return Boolean(sheet) && sheet.isConnected && sheet.getClientRects().length > 0
      && section.dataset.narrow === String(window.matchMedia('(max-width: 640px)').matches)
      && section.dataset.pending !== 'true';
  }, { timeout: 5000 });
}

// A control put where a pointer can reach it, before it is pressed. These
// pages are second tabs of the first, with a line stuck across the top of
// the section saying so, and a press goes to a point: a button the page has
// scrolled up under that line is pressed on the line instead (Puppeteer
// brings a control into view by the least scroll, which leaves it exactly
// there). So the control goes to the middle of the window, and the wait is
// for it to be what is at its own middle.
async function reach(page, selector) {
  await settled(page);
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.waitForFunction((wanted) => {
    const el = document.querySelector(wanted);
    if (!el || el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && el.contains(hit);
  }, { timeout: 5000 }, selector);
}
async function click(page, selector) {
  await reach(page, selector);
  await page.click(selector);
}
async function tap(page, selector) {
  await reach(page, selector);
  await page.tap(selector);
}

// The window at a size, with a table for reading on the page, and the table's
// frame told: the frame leaves the window its sentence was last placed for
// on itself (`data-placed`), and that is waited for, not a count of frames.
async function readSized(page, width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.waitForFunction((w, h) => window.innerWidth === w && window.innerHeight === h
    && document.querySelector('.grd-below .grd-scroll')?.dataset.placed === w + 'x' + h, { timeout: 5000 }, width, height);
}

// Close a case's own page, and hold the page to having had no error. A case
// that failed is reported as it failed, with what the page said added to its
// message: an assertion in a `finally` would be reported in its place.
async function shut(turn, failed) {
  const found = turn.problems();
  await turn.page.close().catch(() => {});
  if (failed) {
    const said = found.errors.concat(found.blocked, found.shimmed);
    if (said.length > 0 && failed instanceof Error) failed.message += '\n(and the page said: ' + said.join(' | ') + ')';
    throw failed;
  }
  assert.deepEqual(found, { errors: [], blocked: [], shimmed: [] });
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

// A module of the tool put on the page as `globalThis.sv2modules[key]`, by a
// module script the page loads itself, and waited for: the page sets the
// key. An import() awaited inside page.evaluate can come back "Protocol
// error (Runtime.callFunctionOn): Promise was collected" (SV2-72a: once here,
// in a full run; SV2-72e: in m2-pass.mjs, 2 runs in 10 with the CPU throttled 4), so a module is loaded
// first and used in a synchronous evaluate after. A load of the page empties
// the globals, and the module is loaded again.
// The script imports the module itself and keeps `{ error }` under the key
// when that fails: a static import that fails fires no error the test can
// see, and a wrong path came back as this wait's timeout (SV2-72e2).
async function loadModule(page, key, file) {
  // null while it loads, then `{ error }`: null when the module is there
  const held = (wanted) => {
    const value = globalThis.sv2modules && globalThis.sv2modules[wanted];
    if (!value) return null;
    return { error: value[Symbol.toStringTag] === 'Module' ? null : String(value.error) };
  };
  let state = await page.evaluate(held, key);
  if (state === null) {
    const name = JSON.stringify(key);
    await page.addScriptTag({ type: 'module', content: 'const modules = (globalThis.sv2modules ||= {}); import(' + JSON.stringify('./' + file) + ').then((module) => { modules[' + name + '] = module; }, (error) => { modules[' + name + '] = { error: String((error && error.message) || error) }; });' });
    state = await (await page.waitForFunction(held, { timeout: 5000 }, key)).jsonValue();
  }
  if (state.error !== null) {
    // forgotten, so a later call tries again rather than repeat this one
    await page.evaluate((wanted) => delete globalThis.sv2modules[wanted], key);
    throw new Error('loadModule: ' + file + ' did not load: ' + state.error);
  }
}

// Change the project behind the page, and take the changes back.
async function change(page, name, payload) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((action, given) => {
    globalThis.sv2.store.apply(globalThis.sv2modules.actions[action], given);
  }, name, payload);
}
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
    await click(page, '.grd-bar [data-action="discard"]');
    await page.waitForSelector('dialog[open]');
    await click(page, 'dialog[open] .btn--danger');
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

  await tap(page, '.grd-toolbar [data-action="fields"]');
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
  await tap(page, '.grd-toolbar [data-action="fields"]');
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
  let failed = null;
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
    // drawn for this width before the cursor is moved: a width crossed and
    // crossed back before the grid was drawn for the first is no crossing
    await gridShown(page);
    await page.focus(key(A6, 'headCount'));
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':headCount', boxed: true }]);
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length === 0, { timeout: 5000 }, key(A6, 'headCount'));
    await gridShown(page);
    assert.deepEqual(await tabStops(page), [{ key: 'grid:' + A6 + ':name', boxed: true }], 'crossing 640 px moved the Tab stop to Group');
    // the focus was on the cell that went out of sight: it is on Group, not on nothing
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false, 'the focus fell to the page');
    assert.equal(await activeKey(page), 'grid:' + A6 + ':name', 'the focus did not go with the cursor');
    await page.keyboard.press('ArrowDown');
    assert.equal(await activeKey(page), 'grid:' + B6 + ':name', 'the grid\'s keys are dead after the crossing');

    // a width crossed while the focus is somewhere else leaves it there
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await gridShown(page);
    await page.focus(key(A6, 'grade'));
    await page.focus('[data-key="grid-add"]');
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await gridShown(page);
    assert.equal(await activeKey(page), 'grid-add', 'the grid took the focus from the toolbar');
  } catch (error) {
    failed = error;
  }
  await shut(turn, failed);
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

test('the marks of a table for reading are one Tab stop, the arrow keys go from mark to mark, and a click on a mark draws its sentence as the keyboard does', async () => {
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

  // a click puts the focus on a mark and draws its sentence too: the title
  // needs a pointer that rests, and a finger has none (DECISIONS 2026-10-12 10:58)
  const note = '.grd-table--read .grd-cell--read[data-severity="note"]';
  await page.$eval(note, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  const at = await box(page, note);
  await page.mouse.click(at.left + at.width / 2, at.top + at.height / 2);
  assert.equal(await on(), 'Cafeteria note');
  assert.match(await why(page), /^"Note: /, 'a click draws no sentence');
  assert.notEqual(await popup(page, note), null);
  assert.deepEqual(await stops(), [-1, 0]);
  // and a click away from it takes the sentence off again
  const name = await box(page, '.grd-table--read tbody tr:first-child th');
  await page.mouse.click(name.left + 10, name.top + name.height / 2);
  assert.equal(await popup(page, note), null, 'the sentence stays after a click elsewhere');
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

// ---------------------------------------------------------------- from the review of the fixes

test('on a phone a tap on a marked cell of the Teachers table draws its sentence inside the frame, and a tap elsewhere takes it away', async () => {
  const { page } = phone;
  await rowsAre(page, 'teachers');
  try {
    const cell = '.grd-table--read .is-marked[data-severity="problem"]';
    await page.$eval(cell, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    assert.equal(await popup(page, cell), null, 'the sentence is drawn before anything was tapped');
    const at = await box(page, cell);
    await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
    await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), { timeout: 5000 }, cell);
    assert.match(await why(page), /^"Problem: Room 203 has two groups/, 'a tap draws no sentence');
    const drawn = await popup(page, cell);
    const frame = await frameOf(page);
    assert.ok(drawn.left >= frame.left - 0.5 && drawn.right <= frame.right + 0.5, 'the sentence is at ' + drawn.left + ' to ' + drawn.right + ' in a frame of ' + frame.left + ' to ' + frame.right);
    assert.ok(drawn.top >= frame.top - 0.5 && drawn.bottom <= frame.bottom + 0.5, 'the sentence is at ' + drawn.top + ' to ' + drawn.bottom + ' down a frame of ' + frame.top + ' to ' + frame.bottom);
    assert.equal(await page.$eval(cell, (el) => getComputedStyle(el).cursor), 'pointer');
    // a tap on a cell with no mark
    const free = await box(page, '.grd-table--read tbody tr:first-child td:not(.is-marked)');
    await page.touchscreen.tap(free.left + free.width / 2, free.top + free.height / 2);
    await page.waitForFunction((selector) => document.activeElement !== document.querySelector(selector), { timeout: 5000 }, cell);
    assert.equal(await popup(page, cell), null, 'the sentence stays after a tap elsewhere');
  } finally {
    await rowsAre(page, 'groups');
  }
});

test('a cell being edited in a column that goes out of sight at 640 px: its field closes with what was typed staged, the focus is on Group and the keys work', async () => {
  const turn = await openGrid({ width: 1280, height: 800 });
  const { page } = turn;
  let failed = null;
  try {
    const count = await cellText(page, key(A6, 'headCount'));
    assert.notEqual(count, '31');
    await page.focus(key(A6, 'headCount'));
    await page.keyboard.press('Enter');
    await page.waitForSelector(key(A6, 'headCount') + ' .grd-input');
    await page.keyboard.type('31');
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length === 0, { timeout: 5000 }, key(A6, 'headCount'));
    await gridShown(page);
    await stagedIs(page, true);
    assert.equal(await page.$$eval('.grd-input', (all) => all.length), 0, 'a field is open in a cell that is out of sight');
    assert.equal(await page.$$eval('.grd-sheet [data-editing]', (all) => all.length), 0);
    assert.equal(await activeKey(page), 'grid:' + A6 + ':name', 'the focus is not on the Group cell');
    await page.keyboard.press('ArrowDown');
    assert.equal(await activeKey(page), 'grid:' + B6 + ':name', 'the table\'s keys are dead');
    // what was typed is staged, and there to see when the column is back
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length > 0, { timeout: 5000 }, key(A6, 'headCount'));
    await gridShown(page);
    assert.equal(await cellText(page, key(A6, 'headCount')), '31');
    assert.equal(await isStaged(page, key(A6, 'headCount')), true);

    // text that cannot be kept (a head count that is no number) is let go: the cell is as it was
    await page.focus(key(B6, 'headCount'));
    const was = await cellText(page, key(B6, 'headCount'));
    await page.keyboard.press('Enter');
    await page.waitForSelector(key(B6, 'headCount') + ' .grd-input');
    await page.keyboard.type('many');
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length === 0, { timeout: 5000 }, key(B6, 'headCount'));
    await gridShown(page);
    assert.equal(await page.$$eval('.grd-input', (all) => all.length), 0);
    assert.equal(await activeKey(page), 'grid:' + B6 + ':name');
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await gridShown(page);
    assert.equal(await cellText(page, key(B6, 'headCount')), was);
    assert.equal(await isStaged(page, key(B6, 'headCount')), false);

    // The same with nothing to close the field first. (Above, the browser
    // takes the focus from a field that has gone out of sight, and leaving
    // a field reads it into its cell. When the tab is drawn again before
    // that, the field is still open, in a column the rule now hides.) On a
    // narrow screen with the fields shown, Fields is pressed from a script,
    // which moves no focus, while Head count is being edited.
    await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await gridShown(page);
    await click(page, '[data-key="grid-fields"]');
    await page.waitForFunction((selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).getClientRects().length > 0, { timeout: 5000 }, key(C6, 'headCount'));
    await page.focus(key(C6, 'headCount'));
    await page.keyboard.press('Enter');
    await page.waitForSelector(key(C6, 'headCount') + ' .grd-input');
    await page.keyboard.type('27');
    await page.evaluate(() => document.querySelector('[data-key="grid-fields"]').click());
    await page.waitForFunction(() => document.querySelector('.grd').dataset.fields === 'hidden', { timeout: 5000 });
    await gridShown(page);
    assert.equal(await page.$$eval('.grd-input', (all) => all.length), 0, 'the field was opened again in a cell that is out of sight');
    assert.equal(await page.$$eval('.grd-sheet [data-editing]', (all) => all.length), 0);
    assert.equal(await activeKey(page), 'grid:' + C6 + ':name', 'the focus is not on the Group cell');
    await page.keyboard.press('ArrowUp');
    assert.equal(await activeKey(page), 'grid:' + B6 + ':name', 'the table\'s keys are dead');
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction((selector) => document.querySelector(selector).getClientRects().length > 0, { timeout: 5000 }, key(C6, 'headCount'));
    await gridShown(page);
    assert.equal(await cellText(page, key(C6, 'headCount')), '27', 'what was typed was not staged');
    assert.equal(await isStaged(page, key(C6, 'headCount')), true);
  } catch (error) {
    failed = error;
  }
  await discard(page).catch(() => {});
  await shut(turn, failed);
});

test('a sentence taller than the frame is not cut at its bottom, and it is placed again when the window changes width and when the frame scrolls', async () => {
  // on the first page: the others are second tabs of it, and a second tab
  // does not change the project
  const { page } = desk;
  const inside = async (selector, what) => {
    const drawn = await popup(page, selector);
    const frame = await frameOf(page);
    assert.notEqual(drawn, null, what + ': the sentence is drawn');
    assert.ok(drawn.left >= frame.left - 0.5 && drawn.right <= frame.right + 0.5, what + ': the sentence is at ' + drawn.left + ' to ' + drawn.right + ' in a frame of ' + frame.left + ' to ' + frame.right);
    assert.ok(drawn.top >= frame.top - 0.5 && drawn.bottom <= frame.bottom + 0.5, what + ': the sentence is at ' + drawn.top + ' to ' + drawn.bottom + ' down a frame of ' + frame.top + ' to ' + frame.bottom);
    return { drawn, frame };
  };
  const sized = (width, height) => readSized(page, width, height);
  const refocus = async (selector) => {
    await page.focus('.grd-toolbar input[value="teachers"]');
    await page.focus(selector);
  };
  const others = ['tsample001', 'tsample002', 'tsample003', 'tsample004', 'tsample005', 'tsample006', 'tsample008', 'tsample009', 'tsample010', 'tsample011', 'tsample012'];
  // a table of one row: Ms. Vandermeer, whose Room 203 has a name of 60
  // characters, two groups in Period 2 and seats too few for one of them
  for (const id of others) await change(page, 'deleteTeacher', { id });
  await change(page, 'setRoomFields', { roomId: 'rsample203', number: SIXTY, capacity: 22 });
  try {
    await rowsAre(page, 'teachers');
    assert.deepEqual(await page.$$eval('.grd-table--read tbody tr', (rows) => rows.map((tr) => tr.children[0].textContent)), ['Ms. Vandermeer']);
    const cell = '.grd-table--read .is-marked[data-severity="problem"]';
    assert.match(await page.$eval(cell, (el) => el.dataset.why), /^Problem: .*Bus Loop has two groups.* Warning: 6C has 23 students/);

    // a window 240 px high: the frame is 70 % of that at most, and the
    // sentence at its usual 18rem is taller. It is made as wide as the frame
    // lets it be, and so short enough.
    await sized(1280, 240);
    await refocus(cell);
    const usual = await page.$eval(cell, (el) => {
      el.style.setProperty('--why-w', '18rem');
      const height = parseFloat(getComputedStyle(el, '::after').height);
      el.style.removeProperty('--why-w');
      return height;
    });
    await refocus(cell);
    const wide = await inside(cell, 'in a window 240 px high');
    assert.ok(wide.drawn.width > 18 * 16 + 1, 'the sentence was not made wider than 18rem: ' + wide.drawn.width);
    assert.ok(usual > wide.frame.bottom - wide.frame.top, 'at 18rem the sentence (' + usual + ') is not taller than the frame (' + (wide.frame.bottom - wide.frame.top) + '): the case shows nothing');

    // a window 90 px high: no width makes the sentence that short, and the
    // frame is given the height to hold it while the mark has the focus
    await sized(1280, 90);
    await refocus(cell);
    await inside(cell, 'in a window 90 px high');
    assert.match(await page.$eval('.grd-below .grd-scroll', (frame) => frame.style.minHeight), /^\d+px$/, 'the frame was not given the height');
    await page.focus('.grd-toolbar input[value="teachers"]');
    assert.equal(await page.$eval('.grd-below .grd-scroll', (frame) => frame.style.minHeight), '', 'the frame keeps the height after the focus has gone');

    // the window narrowed with the focus on the last mark of the row, at the
    // frame's right edge: the frame's right edge moves, and the sentence with it
    await sized(1280, 800);
    const last = await page.$$eval('.grd-table--read .is-marked', (all) => all[all.length - 1].dataset.key);
    const far = '[data-key="' + last + '"]';
    await refocus(far);
    const before = await inside(far, 'on the last mark of the row');
    await sized(700, 800);
    const after = await inside(far, 'after the window narrowed to 700 px');
    assert.ok(after.frame.right < before.drawn.right, 'the frame did not narrow past where the sentence was: the case shows nothing');

    // the frame scrolled sideways until the cell is 100 px past its left edge
    await refocus(cell);
    const start = await inside(cell, 'at 700 px');
    const at = await box(page, cell);
    const placings = await page.$eval('.grd-below .grd-scroll', (frame) => Number(frame.dataset.placings));
    const moved = await page.$eval('.grd-below .grd-scroll', (frame, by) => {
      const from = frame.scrollLeft;
      frame.scrollLeft = from + by;
      return frame.scrollLeft - from;
    }, at.left - start.frame.left + 100);
    assert.ok(moved > start.drawn.left - start.frame.left, 'the table does not scroll far enough sideways at 700 px: ' + moved);
    // the frame says each time it places the sentence again: one more than before it was scrolled
    await page.waitForFunction((was) => Number(document.querySelector('.grd-below .grd-scroll').dataset.placings) > was, { timeout: 5000 }, placings);
    await inside(cell, 'after the frame scrolled sideways');
  } finally {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 1280);
    await undo(page, others.length + 1);
    await rowsAre(page, 'groups');
  }
});

test('"10" and Enter in a grid cell stays "10", as it does in the group editor: a number is never turned into Room 101', async () => {
  const { page } = desk;
  const cell = slot(A6, DAY_A, 3);
  try {
    await cursorOn(page, cell);
    await page.keyboard.type('10');
    await page.waitForSelector(cell + ' .grd-input');
    assert.ok(await page.$$eval('.grd-list .picker__option', (all) => all.length) >= 3, 'the case needs rooms 101, 102 and 103 offered');
    await page.keyboard.press('Enter');
    await stagedIs(page, true);
    assert.equal(await cellText(page, cell), '10');
    assert.equal(await isStaged(page, cell), true);
    assert.equal(await page.$eval(cell, (el) => el.classList.contains('is-unknown') || el.querySelector('.is-unknown') !== null), true, 'the cell is not marked as not in the building');
  } finally {
    await discard(page);
  }
});

test('the sentence of a mark is placed again when the window changes height alone', async () => {
  const { page } = desk;
  await rowsAre(page, 'teachers');
  try {
    // a window 420 px high: the frame is 70 % of that at its tallest, the
    // table of twelve teachers is taller, and the frame scrolls
    await readSized(page, 1280, 420);
    const last = await page.$$eval('.grd-table--read .is-marked', (all) => all[all.length - 1].dataset.key);
    const far = '[data-key="' + last + '"]';
    await page.focus('.grd-toolbar input[value="teachers"]');
    await page.focus(far);
    const read = async (what) => {
      const drawn = await popup(page, far);
      const frame = await frameOf(page);
      assert.notEqual(drawn, null, what + ': the sentence is drawn');
      return { drawn, frame };
    };
    const before = await read('at 420 px high');
    assert.ok(before.drawn.top >= before.frame.top - 0.5 && before.drawn.bottom <= before.frame.bottom + 0.5, 'at 420 px high the sentence is at ' + before.drawn.top + ' to ' + before.drawn.bottom + ' down a frame of ' + before.frame.top + ' to ' + before.frame.bottom);
    // 120 px shorter, the width as it was, the focus where it was
    await readSized(page, 1280, 300);
    const after = await read('at 300 px high');
    assert.ok(before.drawn.bottom - before.frame.top > after.frame.bottom - after.frame.top + 1, 'the frame\'s foot did not rise past where the sentence was: the case shows nothing');
    assert.ok(after.drawn.top >= after.frame.top - 0.5 && after.drawn.bottom <= after.frame.bottom + 0.5, 'after the window lost height alone the sentence is at ' + after.drawn.top + ' to ' + after.drawn.bottom + ' down a frame of ' + after.frame.top + ' to ' + after.frame.bottom);
  } finally {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 1280 && window.innerHeight === 800);
    await rowsAre(page, 'groups');
  }
});

test('the worst finding of a cell is said first, whatever order its groups\' findings were gathered in', async () => {
  const { page } = desk;
  // Ms. Vandermeer has 6C and 7C in Room 203 in Period 2 (a problem). Now she
  // has 6B too, in the Gym, which seats 5 of its 24 (a warning): 6B comes
  // first in her cell, and its warning is gathered before the others' problem.
  await change(page, 'setRoomFields', { roomId: 'rsamplegym', capacity: 5 });
  await change(page, 'setSlot', { groupId: B6, dayTypeId: DAY_A, period: 1, slot: { teacherIds: ['tsample007'] } });
  try {
    await settled(page);
    // 6B's own findings have the warning in them, and 6B is the first group of her cell
    assert.match(await page.$eval(slot(B6, DAY_A, 1), (el) => el.title), /Warning: 6B has \d+ students and Gym seats 5/);
    await rowsAre(page, 'teachers');
    const cell = '.grd-table--read tbody tr:nth-child(7) td:nth-child(3)';
    assert.equal(await page.$eval(cell, (el) => el.parentElement.children[0].textContent), 'Ms. Vandermeer');
    assert.match(await page.$eval(cell, (el) => el.firstChild.textContent), /^6B in Gym, 6C in 203, 7C in 203$/);
    const said = await page.$eval(cell, (el) => el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent.split(':')[0]));
    assert.ok(said.includes('Problem') && said.includes('Warning'), 'the cell has both: ' + said.join(', '));
    assert.deepEqual(said, said.slice().sort((a, b) => ['Problem', 'Warning', 'Note'].indexOf(a) - ['Problem', 'Warning', 'Note'].indexOf(b)), 'a warning is said before a problem');
    assert.match(await page.$eval(cell, (el) => el.dataset.why), /^Problem: /);
    assert.equal(await page.$eval(cell, (el) => el.dataset.severity + ' ' + el.querySelector('.grd-cell__mark').textContent), 'problem ●', 'the mark is not the worst finding\'s');
    // the rule itself, handed a warning ahead of a problem and a note ahead of both
    await loadModule(page, 'words', 'ui/schedule/grid/words.js');
    const order = await page.evaluate(() => {
      const { worstFirst, findingWords } = globalThis.sv2modules.words;
      const given = [{ id: 'n', severity: 'note', text: 'n.' }, { id: 'w1', severity: 'warning', text: 'w1.' }, { id: 'p', severity: 'problem', text: 'p.' }, { id: 'w2', severity: 'warning', text: 'w2.' }];
      return [worstFirst(given).map((each) => each.id).join(' '), findingWords(given), given.map((each) => each.id).join(' ')];
    });
    assert.deepEqual(order, ['p w1 w2 n', 'Problem: p. Warning: w1. Warning: w2. Note: n.', 'n w1 p w2']);
  } finally {
    await rowsAre(page, 'groups');
    await undo(page, 2);
  }
});

test('with two dozen marks in five rows of the Rooms table, Down and Up go to the nearest mark in the nearest row that has one', async () => {
  const { page } = desk;
  // three rooms that seat one: every group in them is a warning
  for (const roomId of ['rsample101', 'rsample202', 'rsample303']) await change(page, 'setRoomFields', { roomId, capacity: 1 });
  try {
    await rowsAre(page, 'rooms');
    // the marks: a room, and the columns of its marked cells (1 is the first period of A Day)
    const marks = await page.$$eval('.grd-table--read tbody tr', (rows) => rows.map((tr) => [tr.children[0].textContent, Array.from(tr.children).map((cell, i) => (cell.classList.contains('is-marked') ? i : null)).filter((i) => i !== null)]).filter((row) => row[1].length > 0));
    assert.deepEqual(marks, [['101', [2, 3, 10, 15, 16]], ['202', [2, 6, 7, 8, 11, 16]], ['203', [2]], ['303', [1, 6, 7, 8, 9, 10, 11, 14, 15, 16]], ['Cafeteria', [4]]]);
    const on = () => page.evaluate(() => {
      const cell = document.activeElement;
      return cell.classList.contains('is-marked') ? cell.parentElement.children[0].textContent + ' ' + Array.from(cell.parentElement.children).indexOf(cell) : null;
    });
    const walk = async (keys) => {
      const seen = [];
      for (const each of keys) {
        await page.keyboard.press(each);
        seen.push(await on());
      }
      return seen;
    };
    await tabInto(page);
    await page.keyboard.press('Home');
    assert.equal(await on(), '101 2');
    // straight down the second period, then to the nearest column where a row has no mark there
    assert.deepEqual(await walk(['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']), ['202 2', '203 2', '303 1', 'Cafeteria 4', 'Cafeteria 4']);
    // and back up: from column 4, Room 303's nearest mark is column 6, not column 1
    assert.deepEqual(await walk(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp']), ['303 6', '203 2', '202 2', '101 2', '101 2']);
    // from further along a row: the nearest column, and rows without a mark are passed over
    assert.deepEqual(await walk(['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowUp']), ['101 3', '101 10', '202 11', '101 10']);
    assert.deepEqual(await walk(['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown']), ['101 15', '202 16', '203 2', '303 1']);
    assert.deepEqual(await walk(['End', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp']), ['Cafeteria 4', '303 6', '303 7', '303 8', '303 9', '203 2', '202 2']);
    // one Tab stop still, on the mark last visited
    assert.equal(await page.$$eval('.grd-table--read .is-marked', (all) => all.filter((cell) => cell.tabIndex === 0).length), 1);
  } finally {
    await rowsAre(page, 'groups');
    await undo(page, 3);
  }
});

test('on a phone a long group name wraps in the frozen column and leaves the periods their room: Group and a long room name fit the frame together', async () => {
  const { page } = phone;
  const LONG_GROUP = 'Grade 6 Advanced Orchestra and Chamber Strings';
  // typed into the grid, where it is staged (this page is a second tab, and
  // a second tab does not change the project)
  await settled(page);
  await page.focus(key(A6, 'name'));
  await page.keyboard.type(LONG_GROUP);
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  try {
    await typeLong(page, slot(A6, DAY_A, 0));
    const name = await box(page, key(A6, 'name'));
    const cell = await box(page, slot(A6, DAY_A, 0));
    const frame = await box(page, '.grd-sheet .grd-scroll');
    assert.equal(await cellText(page, key(A6, 'name')), LONG_GROUP);
    assert.ok(name.width <= 8 * 16 + 1, 'the Group column is ' + name.width + ' px wide on a 390 px phone');
    assert.equal(await page.$eval(key(A6, 'name'), (el) => el.scrollWidth > el.clientWidth), false, 'the group\'s name is cut');
    assert.ok(name.height > 40, 'the name did not wrap');
    assert.ok(name.width + cell.width <= frame.width, 'Group (' + name.width + ') and the cell (' + cell.width + ') do not fit the frame (' + frame.width + ') together');
    assert.equal((await longCell(page, slot(A6, DAY_A, 0))).cut, false);
  } finally {
    await discard(page);
  }
});

test('where the page reads right to left, the arrow keys go the way they point: in the grid, and from mark to mark', async () => {
  const { page } = desk;
  await settled(page);
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  try {
    await cursorOn(page, key(A6, 'name'));
    const grade = await box(page, key(A6, 'grade'));
    const name = await box(page, key(A6, 'name'));
    assert.ok(grade.right <= name.left + 1, 'Grade is not to the left of Group in a right-to-left page');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await activeKey(page), 'grid:' + A6 + ':grade', 'Left did not go to the column on the left');
    await page.keyboard.press('ArrowRight');
    assert.equal(await activeKey(page), 'grid:' + A6 + ':name');
    await page.keyboard.press('ArrowRight');
    assert.equal(await activeKey(page), 'grid:' + A6 + ':name', 'Right from the first column went somewhere');
    // Home and End are the row's first and last column, whichever side they are on
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Home');
    assert.equal(await activeKey(page), 'grid:' + A6 + ':name');

    await rowsAre(page, 'rooms');
    const on = () => page.evaluate(() => (document.activeElement.classList.contains('is-marked') ? document.activeElement.parentElement.children[0].textContent : null));
    await tabInto(page);
    await page.keyboard.press('Home');
    assert.equal(await on(), '203');
    await page.keyboard.press('ArrowRight');
    assert.equal(await on(), '203', 'Right went on to the next mark, which is to the left');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await on(), 'Cafeteria');
    await page.keyboard.press('ArrowRight');
    assert.equal(await on(), '203');
  } finally {
    await page.evaluate(() => {
      document.documentElement.removeAttribute('dir');
    });
    await rowsAre(page, 'groups');
  }
});

// ---------------------------------------------------------------- SV2-50

test('SV2-50 item 8: the Teachers and Rooms tables add one window resize listener in all, not one at each drawing, and still place a sentence on a resize', async () => {
  const turn = await openGrid({ width: 1280, height: 800 });
  let failed = null;
  try {
    const { page } = turn;
    // counted from before either table is first drawn
    await page.evaluate(() => {
      const add = window.addEventListener;
      globalThis.resizeAdds = 0;
      window.addEventListener = function counted(type, fn, options) {
        if (type === 'resize' && /readonly\.js/.test(new Error().stack)) globalThis.resizeAdds += 1;
        return add.call(this, type, fn, options);
      };
    });
    await loadModule(page, 'actions', 'engine/actions.js');
    const redraw = (n) => page.evaluate((times) => {
      for (let i = 0; i < times; i += 1) globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 0, slot: { label: 'Homeroom ' + i } });
    }, n);
    for (const rows of ['teachers', 'rooms', 'teachers']) {
      await rowsAre(page, rows);
      for (let i = 0; i < 4; i += 1) {
        await redraw(1);
        await settled(page);
      }
    }
    const drawings = await page.evaluate(() => document.querySelectorAll('.grd-below .grd-scroll').length);
    assert.equal(drawings, 1, 'the case needs one table on the page');
    assert.equal(await page.evaluate(() => globalThis.resizeAdds), 1, 'a resize listener for each drawing of a table');
    // and the one listener places the sentence of the table on the page
    await tabInto(page);
    await readSized(page, 1100, 760);
    await readSized(page, 1280, 800);
  } catch (error) {
    failed = error;
  }
  await shut(turn, failed);
});
