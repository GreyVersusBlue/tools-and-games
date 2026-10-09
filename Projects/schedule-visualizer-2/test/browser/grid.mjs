// The Grid tab, in a real browser: node test/browser/grid.mjs
//
// Rooms are typed and picked in cells, a block is pasted from tab-separated
// text as a spreadsheet would hand it over, the bar says what is waiting,
// Apply makes it one step and one undo takes all of it back. Assertions are on
// what the page shows. The store is read only to be sure nothing reached the
// schedule before Apply.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch } from './harness.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const A6 = 'gsample06a';
const B6 = 'gsample06b';
const C6 = 'gsample06c';
const HOSTILE = '<img src=x onerror=alert(1)> "quoted" 名前';

let server;
let browser;
let session;
let page;

const key = (group, column) => '[data-key="grid:' + group + ':' + column + '"]';
const slot = (group, day, period) => key(group, day + ':' + period);
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const shown = (selector) => page.$eval(selector + ' .grd-cell__text', (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const count = (selector) => page.$$eval(selector, (all) => all.length);
const has = (selector, name) => page.$eval(selector, (el, wanted) => el.classList.contains(wanted), name);
const activeKey = () => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
const barText = () => text('.grd-bar__text');
const statusText = () => text('.grd-status');
const selected = () => page.$$eval('.grd-table [aria-selected="true"]', (all) => all.map((cell) => cell.dataset.key));
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
// The tab draws again a moment after a change (data-pending says one is due).
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
const stagedIs = (wanted) => shows((value) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.staged === value, String(wanted));
const inSchedule = (group, day, period) => page.evaluate((g, d, p) => {
  const project = globalThis.sv2.store.project;
  const held = project.groups.find((each) => each.id === g).days[d][p];
  const room = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === held.room);
  return room ? room.number : held.roomText;
}, group, day, period);

async function focusCell(selector) {
  await settled();
  await page.focus(selector);
}

async function click(selector) {
  await settled();
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.click(selector);
}

// What a spreadsheet does on Ctrl+V: a paste event carrying text/plain.
async function paste(tsv) {
  await settled();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, tsv);
  await settled();
}

// What Ctrl+C puts on the clipboard.
async function copied() {
  return page.evaluate(() => {
    const data = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
}

async function discard() {
  await click('.grd-bar [data-action="discard"]');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await stagedIs(false);
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/grid', theme: 'light', width: 1500, height: 1000 });
  page = session.page;
  await shows(() => document.querySelector('link[data-sheet="grid"]')?.sheet && getComputedStyle(document.querySelector('.grd-sheet')).position === 'relative');
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('every group is a row under its grade, with a column for each period of each day type, and the grid is one Tab stop', async () => {
  assert.equal(await page.$eval('.grd-table', (el) => el.getAttribute('role')), 'grid');
  assert.deepEqual(await page.$$eval('.grd-grade th', (all) => all.map((th) => th.textContent)), ['Grade 6 · 3 groups', 'Grade 7 · 3 groups', 'Grade 8 · 2 groups']);
  assert.deepEqual(await page.$$eval('.grd-row .grd-cell--name .grd-cell__text', (all) => all.map((cell) => cell.textContent)), ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B']);
  assert.deepEqual(await page.$$eval('.grd-head--day', (all) => all.map((th) => th.textContent + ':' + th.colSpan)), ['A Day:8', 'B Day:8']);
  assert.equal(await count('.grd-head--period'), 16);
  assert.equal(await text('.grd-head--period'), 'Period 1');
  assert.equal(await shown(slot(A6, DAY_A, 0)), '201');
  assert.equal(await shown(key(A6, 'headCount')), '24');
  assert.equal(await count('.grd-table [tabindex="0"]'), 1);
  assert.equal(await exists('.grd-bar'), false, 'nothing is waiting');
  // the first column stays put when the sheet is scrolled sideways
  assert.equal(await page.$eval(key(A6, 'name'), (el) => getComputedStyle(el).position), 'sticky');
  // the double-booking of the sample school is on both of its cells, with its words
  assert.equal(await page.$eval(slot(C6, DAY_A, 1), (el) => el.dataset.severity), 'problem');
  assert.match(await text(slot(C6, DAY_A, 1) + ' .vh'), /Problem: Room 203 has two groups in Period 2 on A Day/);
});

test('arrow keys move the cursor, Shift with them selects a block, and Escape lets the block go', async () => {
  await focusCell(key(A6, 'name'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeKey(), 'grid:' + A6 + ':grade');
  await page.keyboard.press('ArrowDown');
  assert.equal(await activeKey(), 'grid:' + B6 + ':grade');
  await page.keyboard.press('End');
  assert.equal(await activeKey(), 'grid:' + B6 + ':do');
  await page.keyboard.press('Home');
  assert.equal(await activeKey(), 'grid:' + B6 + ':name');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await activeKey(), 'grid:' + A6 + ':name', 'the cursor stops at the first row');
  await focusCell(slot(A6, DAY_A, 0));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  assert.deepEqual(await selected(), [A6 + ':' + DAY_A + ':0', A6 + ':' + DAY_A + ':1', B6 + ':' + DAY_A + ':0', B6 + ':' + DAY_A + ':1'].map((each) => 'grid:' + each));
  assert.equal(await count('.grd-table [tabindex="0"]'), 1);
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), ['grid:' + B6 + ':' + DAY_A + ':1']);
});

test('copying a block gives tab-separated text a spreadsheet takes', async () => {
  await focusCell(slot(A6, DAY_A, 0));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  assert.equal(await copied(), '201\t103\t101\r\n203\tGym\t103');
  assert.equal(await statusText(), 'Copied 6 cells.');
});

test('typing a room number into a cell stages it: the cell is marked, the bar says so, and the schedule has not changed', async () => {
  await focusCell(slot(A6, DAY_A, 0));
  // "2" is the Schedule section's own key, and a digit of a room number here
  await page.keyboard.type('202');
  // The shell's single keys are kept off a cell twice over: the grid takes
  // the key for itself, and the cell says it is being edited. Either alone
  // is enough, so this line fails only when both are gone.
  assert.equal(await page.evaluate(() => location.hash), '#schedule/grid', 'the digit did not change the section');
  assert.equal(await page.$eval(slot(A6, DAY_A, 0), (el) => el.dataset.editing), 'true');
  await page.keyboard.press('Enter');
  await stagedIs(true);
  assert.equal(await shown(slot(A6, DAY_A, 0)), '202');
  assert.equal(await has(slot(A6, DAY_A, 0), 'is-staged'), true);
  assert.equal(await has(slot(A6, DAY_A, 1), 'is-staged'), false);
  assert.equal(await barText(), 'Not applied yet: 1 group changed');
  assert.equal(await activeKey(), 'grid:' + B6 + ':' + DAY_A + ':0', 'Enter moves down, as in a spreadsheet');
  assert.equal(await inSchedule(A6, DAY_A, 0), '201', 'nothing reached the schedule');
});

test('the list under the cell offers the building\'s rooms as "204 — Mme. Dufrêne" and narrows as you type', async () => {
  await focusCell(slot(A6, DAY_A, 1));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.grd-list:not([hidden]) .picker__option');
  const all = await page.$$eval('.grd-list .picker__option', (options) => options.map((option) => option.textContent));
  assert.equal(all.length, 13);
  assert.ok(all.includes('204 — Mme. Dufrêne'), all.join(' | '));
  assert.equal(await page.$eval('.grd-input', (el) => el.value + '|' + el.getAttribute('role') + '|' + el.getAttribute('aria-expanded')), '103|combobox|true');
  await page.keyboard.type('dufr');
  assert.deepEqual(await page.$$eval('.grd-list .picker__option', (options) => options.map((option) => option.textContent)), ['204 — Mme. Dufrêne']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await stagedIs(true);
  assert.equal(await shown(slot(A6, DAY_A, 1)), '204');
  assert.equal(await exists('.grd-list:not([hidden])'), false);
});

test('an unknown room is marked as it is typed, kept as typed, and marked in the cell', async () => {
  await focusCell(slot(A6, DAY_A, 2));
  await page.keyboard.type('10');
  assert.equal(await has('.grd-input', 'is-unknown'), true, '"10" is no room yet');
  await page.keyboard.type('1');
  assert.equal(await has('.grd-input', 'is-unknown'), false, '"101" is one');
  await page.keyboard.type('-Annex');
  assert.equal(await has('.grd-input', 'is-unknown'), true);
  assert.match(await text('.grd-list .picker__empty'), /No room matches\. It is kept as typed/);
  await page.keyboard.press('Tab');
  await stagedIs(true);
  assert.equal(await shown(slot(A6, DAY_A, 2)), '101-Annex');
  assert.equal(await has(slot(A6, DAY_A, 2), 'is-unknown'), true);
  assert.equal(await page.$eval(slot(A6, DAY_A, 2) + ' .grd-cell__text', (el) => getComputedStyle(el).textDecorationStyle), 'dotted');
  assert.equal(await page.$eval(slot(A6, DAY_A, 2), (el) => el.title), '101-Annex is not in the building');
  assert.equal(await activeKey(), 'grid:' + A6 + ':' + DAY_A + ':3', 'Tab moves right');
});

test('a finding appears on the cell as the room is staged, before anything is applied', async () => {
  // 6B is in 203 in Period 1 on A Day; put 6A's Period 1 there too
  assert.equal(await page.$eval(slot(B6, DAY_A, 0), (el) => el.dataset.severity || ''), '');
  await focusCell(slot(A6, DAY_A, 0));
  await page.keyboard.type('203');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector).dataset.severity === 'problem', slot(B6, DAY_A, 0));
  assert.match(await text(slot(A6, DAY_A, 0) + ' .vh'), /Problem: Room 203 has two groups in Period 1 on A Day: 6A and 6B\./);
  assert.equal(await page.$eval('#inspector .sch-counts', (el) => el.dataset.problem), '1', 'the panel counts the schedule as it is, which still has one');
});

test('Escape leaves a cell as it was; a name that is taken is refused in a sentence and stays to be fixed', async () => {
  await focusCell(key(B6, 'name'));
  await page.keyboard.press('F2');
  assert.equal(await page.$eval('.grd-input', (el) => el.value), '6B', 'F2 keeps what the cell holds');
  await page.keyboard.type('7a');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('.grd-input', (el) => el.getAttribute('aria-invalid')), 'true');
  assert.match(await statusText(), /There is already a group called "7A"/);
  assert.match(await text('#announcer'), /There is already a group called "7A"/);
  await page.keyboard.press('Escape');
  assert.equal(await shown(key(B6, 'name')), '6B');
  assert.equal(await activeKey(), 'grid:' + B6 + ':name');
});

test('a name, a grade, a head count and a colour are edited in place, and a name is text whatever is in it', async () => {
  await focusCell(key(B6, 'name'));
  await page.keyboard.press('Enter');
  await page.keyboard.type(HOSTILE);
  await page.keyboard.press('Tab');
  await settled();
  assert.equal(await shown(key(B6, 'name')), HOSTILE);
  assert.equal(await count('.grd img'), 0);
  assert.equal(await activeKey(), 'grid:' + B6 + ':grade');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('many');
  await page.keyboard.press('Enter');
  assert.match(await statusText(), /A head count is a whole number from 1 to 999/);
  await page.keyboard.press('Escape');
  await page.keyboard.type('31');
  await page.keyboard.press('Tab');
  await settled();
  assert.equal(await shown(key(B6, 'headCount')), '31');
  await page.keyboard.type('#0A0B0C');
  await page.keyboard.press('Enter');
  await settled();
  assert.equal(await shown(key(B6, 'colour')), '#0a0b0c');
  assert.equal(await page.$eval(key(B6, 'colour') + ' .sch-dot', (el) => getComputedStyle(el).backgroundColor), 'rgb(10, 11, 12)');
  assert.equal(await barText(), 'Not applied yet: 2 groups changed');
});

test('Ctrl+Z in the grid takes back the last staged change, not the last change to the schedule', async () => {
  await focusCell(key(B6, 'colour'));
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await settled();
  assert.equal(await shown(key(B6, 'colour')), '#0072b2');
  assert.equal(await statusText(), 'Took back the last change in the grid.');
  assert.equal(await exists('.toast'), false, 'the shell did not undo anything');
});

test('unapplied edits survive leaving the tab and the section: the bar is there on return and is announced, and the shell can ask', async () => {
  const before = await barText();
  await go(page, '#schedule/groups');
  assert.equal(await exists('.grd-bar'), false);
  await go(page, '#building');
  await go(page, '#schedule/grid');
  await settled();
  assert.equal(await barText(), before);
  assert.equal(await shown(slot(A6, DAY_A, 2)), '101-Annex');
  await shows(() => /^Not applied yet: 2 groups changed\. Apply and Discard are above the grid\.$/.test(document.getElementById('announcer').textContent));
  // the hook for the dot on the rail's Schedule item
  const hook = () => page.evaluate(async () => {
    const grid = await import(new URL('ui/schedule/grid/index.js', location.href).href);
    return grid.gridEditsPending(globalThis.sv2.store.project.id);
  });
  assert.equal(await hook(), true);
  // closing the page asks first
  const asks = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(await asks(), true);

  // Discard asks first, with buttons that name the action, the safe one focused
  await click('.grd-bar [data-action="discard"]');
  await page.waitForSelector('dialog[open]');
  assert.equal(await text('dialog[open] .dialog__title'), 'Discard the changes in the grid?');
  assert.deepEqual(await page.$$eval('dialog[open] .dialog__buttons button', (all) => all.map((button) => button.textContent)), ['Discard the changes', 'Keep them']);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep them');
  await page.keyboard.press('Enter');
  await settled();
  assert.equal(await barText(), before, 'kept');
  await discard();
  assert.equal(await exists('.grd-bar'), false);
  assert.equal(await shown(slot(A6, DAY_A, 2)), '101');
  assert.equal(await shown(key(B6, 'name')), '6B');
  assert.equal(await count('.grd-table .is-staged'), 0);
  assert.equal(await hook(), false);
  assert.equal(await asks(), false);
});

test('a three-by-four block pasted from a spreadsheet is summarised, applied as one step, and one undo takes all of it back', async () => {
  const cellsOf = () => page.$$eval('.grd-row', (rows, day) => rows.slice(0, 3).map((row) => [0, 1, 2, 3].map((period) => row.querySelector('[data-col="' + day + ':' + period + '"] .grd-cell__text').textContent)), DAY_A);
  const was = await cellsOf();
  assert.deepEqual(was, [['201', '103', '101', 'Cafeteria'], ['203', 'Gym', '103', 'Cafeteria'], ['301', '203', '302', 'Cafeteria']]);
  const block = [['301', '302', '303', 'Library'], ['101', '102', 'Library', 'Gym'], ['201', '202', 'Portable 4', 'gym']];
  await focusCell(slot(A6, DAY_A, 0));
  await paste(block.map((row) => row.join('\t')).join('\r\n') + '\r\n');
  await stagedIs(true);
  const pasted = [block[0], block[1], ['201', '202', 'Portable 4', 'Gym']];
  assert.deepEqual(await cellsOf(), pasted, 'a room is shown by its own number, an unknown one as typed');
  assert.equal(await statusText(), 'Pasted 12 cells.');
  assert.equal(await barText(), 'Not applied yet: 3 groups changed');
  assert.equal(await count('.grd-table .is-staged'), 12);
  assert.equal(await has(slot(C6, DAY_A, 2), 'is-unknown'), true);
  assert.equal((await selected()).length, 12, 'the pasted block is selected');
  assert.equal(await inSchedule(A6, DAY_A, 0), '201', 'nothing reached the schedule yet');

  await click('.grd-bar [data-action="apply"]');
  await stagedIs(false);
  assert.equal(await exists('.grd-bar'), false);
  assert.equal(await text('.toast .toast__text'), 'Applied to the schedule: 3 groups changed.');
  assert.deepEqual(await cellsOf(), pasted);
  assert.equal(await count('.grd-table .is-staged'), 0);
  assert.equal(await inSchedule(C6, DAY_A, 2), 'Portable 4');
  assert.equal(await inSchedule(B6, DAY_A, 3), 'Gym');
  // the Groups tab shows it too: it is the schedule now
  await go(page, '#schedule/groups');
  await settled();
  assert.equal(await page.$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] [data-key="slot:' + DAY_A + ':0:room"]', (el) => el.value.split(' — ')[0]), '301');
  await go(page, '#schedule/grid');
  await settled();

  // one undo, from the top bar
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await click('#undo');
  await shows(() => /^Undid: Apply grid edits: 3 groups changed/.test(document.querySelector('.toast .toast__text')?.textContent || ''));
  await settled();
  assert.deepEqual(await cellsOf(), was, 'all twelve cells are as they were');
  assert.equal(await inSchedule(A6, DAY_A, 0), '201');
  assert.equal(await exists('.grd-bar'), false);
  assert.equal(await page.$eval('#undo', (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'), true, 'and that was the only step');
});

test('one copied cell pasted over a selection fills it, Delete empties a selection, and fill down copies the top row', async () => {
  await focusCell(slot(A6, DAY_B, 0));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await paste('Library');
  assert.deepEqual(await Promise.all([A6, B6, C6].map((group) => shown(slot(group, DAY_B, 0)))), ['Library', 'Library', 'Library']);
  assert.equal(await statusText(), 'Pasted 3 cells.');
  await page.keyboard.press('Delete');
  await settled();
  assert.deepEqual(await Promise.all([A6, B6, C6].map((group) => shown(slot(group, DAY_B, 0)))), ['', '', '']);
  assert.equal(await statusText(), 'Cleared 3 cells.');
  // fill down from 6A's Periods 2 and 3 into 6B and 6C
  await focusCell(slot(A6, DAY_B, 1));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await page.keyboard.down('Control');
  await page.keyboard.press('d');
  await page.keyboard.up('Control');
  await settled();
  for (const group of [B6, C6]) assert.deepEqual([await shown(slot(group, DAY_B, 1)), await shown(slot(group, DAY_B, 2))], ['204', 'Gym']);
  assert.equal(await statusText(), 'Filled down 4 cells from 6A.');
  assert.equal(await barText(), 'Not applied yet: 3 groups changed');
  await discard();
});

test('a group is added and named where it is, moved to another grade, and another is removed; Apply and one undo', async () => {
  await focusCell(key(C6, 'name'));
  await click('.grd-toolbar [data-action="add-group"]');
  await shows(() => document.querySelector('.sch')?.dataset.pending !== 'true' && document.activeElement?.classList.contains('grd-input'));
  assert.equal(await page.$eval('.grd-input', (el) => el.value + '|' + el.selectionStart + '|' + el.selectionEnd), 'New group|0|9', 'its name is ready to be typed over');
  await page.keyboard.type('6D');
  await page.keyboard.press('Tab');
  await stagedIs(true);
  assert.deepEqual(await page.$$eval('.grd-grade th', (all) => all.map((th) => th.textContent)), ['Grade 6 · 4 groups', 'Grade 7 · 3 groups', 'Grade 8 · 2 groups'], 'it starts in the grade the cursor was in');
  assert.equal(await barText(), 'Not applied yet: 1 group added');
  const added = await page.$eval('.grd-row:has(.grd-tag)', (row) => row.dataset.group);
  assert.equal(await text(key(added, 'name') + ' .grd-tag'), 'new');
  // moving it to another grade is typing the grade
  assert.equal(await activeKey(), 'grid:' + added + ':grade');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await settled();
  assert.deepEqual(await page.$$eval('.grd-grade th', (all) => all.map((th) => th.textContent)), ['Grade 6 · 3 groups', 'Grade 7 · 3 groups', 'Grade 8 · 2 groups', 'Grade 9 · 1 group']);
  // an existing group moves the same way
  await focusCell(key('gsample08b', 'grade'));
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await settled();
  assert.deepEqual(await page.$$eval('.grd-grade th', (all) => all.map((th) => th.textContent)).then((all) => all.slice(2)), ['Grade 8 · 1 group', 'Grade 9 · 2 groups']);
  // remove one; it stays in sight, struck through, until Apply
  await click(key('gsample07c', 'do') + ' [data-action="remove"]');
  await shows((selector) => document.querySelector(selector)?.classList.contains('is-removed'), '.grd-row[data-group="gsample07c"]');
  assert.equal(await text(key('gsample07c', 'name') + ' .grd-tag'), 'will be removed');
  assert.equal(await text(key('gsample07c', 'do') + ' button'), 'Put back 7C');
  assert.equal(await barText(), 'Not applied yet: 1 group changed, 1 added, 1 removed');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups.length), 8);

  await click('.grd-bar [data-action="apply"]');
  await stagedIs(false);
  assert.equal(await count('.grd-row'), 8);
  assert.equal(await exists('.grd-row[data-group="gsample07c"]'), false);
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.groups.map((group) => group.name + '/' + group.grade)), ['6A/6', '6B/6', '6C/6', '7A/7', '7B/7', '8A/8', '8B/9', '6D/9']);
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await click('#undo');
  await shows(() => globalThis.sv2.store.project.groups.length === 8 && globalThis.sv2.store.project.groups.every((group) => group.name !== '6D'));
  await settled();
  assert.deepEqual(await page.$$eval('.grd-row .grd-cell--name .grd-cell__text', (all) => all.map((cell) => cell.textContent)), ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B']);
});

test('the bulk actions are staged too: clear a day, copy A Day to B Day for every group, clear all', async () => {
  const pick = async (label) => {
    await click('.grd-toolbar [data-action="bulk"]');
    await page.waitForSelector('.menu[role="menu"]');
    await page.evaluate((wanted) => Array.from(document.querySelectorAll('.menu__item')).find((item) => item.textContent === wanted).click(), label);
    await settled();
  };
  await click('.grd-toolbar [data-action="bulk"]');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await page.$$eval('.menu__item', (all) => all.map((item) => item.textContent)), ['Copy A Day to B Day for every group', 'Clear A Day', 'Clear B Day', 'Clear all']);
  await page.keyboard.press('Escape');
  await pick('Clear B Day');
  assert.equal(await barText(), 'Not applied yet: 8 groups changed');
  assert.equal(await page.$$eval('[data-col^="' + DAY_B + ':"] .grd-cell__text', (all) => all.filter((cell) => cell.textContent !== '').length), 0);
  assert.equal(await shown(slot(A6, DAY_A, 0)), '201', 'A Day is as it was');
  await pick('Copy A Day to B Day for every group');
  assert.deepEqual(await page.$$eval('.grd-row[data-group="gsample08b"] [data-col^="' + DAY_B + ':"] .grd-cell__text', (all) => all.map((cell) => cell.textContent)), ['Gym', '101', '204', '203', 'Cafeteria', '103', '202', '303']);
  await pick('Clear all');
  assert.equal(await page.$$eval('.grd-cell--slot .grd-cell__text', (all) => all.filter((cell) => cell.textContent !== '').length), 0);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups[0].days.dsample00a[0].room !== null), true, 'none of it has reached the schedule');
  await discard();
  assert.equal(await shown(slot(A6, DAY_B, 7)), '303');
});

test('the same schedule is read by teacher and by room, and those tables are not for editing', async () => {
  await click('.grd-toolbar input[value="teachers"]');
  await shows(() => document.querySelector('.grd').dataset.rows === 'teachers' && document.querySelector('.sch').dataset.pending !== 'true');
  assert.equal(await exists('.grd-table[role="grid"]:not([hidden])') && await page.$eval('.grd-sheet', (el) => el.hidden), true, 'the sheet is put away');
  assert.equal(await count('.grd-table--read tbody tr'), 12);
  assert.equal(await count('.grd-table--read input, .grd-table--read [tabindex], .grd-table--read button'), 0);
  const row = await page.$$eval('.grd-table--read tbody tr', (rows) => rows.map((tr) => Array.from(tr.children, (cell) => cell.textContent)).find((cells) => cells[0] === 'Mme. Dufrêne'));
  assert.equal(row.length, 17);
  assert.equal(row[7], '6A in 204', 'Period 7 on A Day');
  assert.ok(row.includes('Planning'), 'a free period says so to a screen reader');
  assert.equal(await page.$eval('.grd-below .grd-scroll', (el) => el.tabIndex + '|' + el.getAttribute('role')), '0|region');
  assert.equal(await exists('.grd-toolbar [data-action="add-group"]'), false);

  await page.keyboard.press('ArrowRight');
  await shows(() => document.querySelector('.grd').dataset.rows === 'rooms' && document.querySelector('.sch').dataset.pending !== 'true');
  assert.equal(await activeKey(), 'grid-rows:rooms', 'the choice keeps the focus');
  const rooms = await page.$$eval('.grd-table--read tbody tr', (rows) => rows.map((tr) => Array.from(tr.children, (cell) => cell.textContent)));
  assert.equal(rooms.length, 13);
  assert.deepEqual(rooms.map((cells) => cells[0]).slice(0, 4), ['101', '102', '103', '201'], 'rooms in order of their numbers');
  const cafeteria = rooms.find((cells) => cells[0] === 'Cafeteria');
  assert.equal(cafeteria[4], '6A, 6B, 6C', 'Period 4 on A Day');
  assert.equal(rooms.find((cells) => cells[0] === '203')[2], '6C, 7C', 'the double-booking, read from the room');
  await click('.grd-toolbar input[value="groups"]');
  await shows(() => document.querySelector('.grd').dataset.rows === 'groups' && !document.querySelector('.grd-sheet').hidden);
});

test('a click puts the cursor on a cell, Shift and a click selects to it, and a double click edits', async () => {
  await click(slot(A6, DAY_A, 0));
  assert.equal(await activeKey(), 'grid:' + A6 + ':' + DAY_A + ':0');
  await page.keyboard.down('Shift');
  await page.click(slot(B6, DAY_A, 2));
  await page.keyboard.up('Shift');
  assert.equal((await selected()).length, 6);
  await page.click(slot(C6, DAY_A, 0), { count: 2 });
  await page.waitForSelector(slot(C6, DAY_A, 0) + ' .grd-input');
  assert.equal(await page.$eval('.grd-input', (el) => el.value), '301');
  // clicking away commits what was typed
  await page.keyboard.type('102');
  await page.click(slot(A6, DAY_A, 5));
  await stagedIs(true);
  assert.equal(await shown(slot(C6, DAY_A, 0)), '102');
  assert.equal(await activeKey(), 'grid:' + A6 + ':' + DAY_A + ':5');
  await discard();
});

test('an empty project says what the grid is for, and a block pasted there becomes groups', async () => {
  await go(page, '#project');
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForFunction(() => document.getElementById('sample-chip').hidden);
  await go(page, '#schedule/grid');
  await settled();
  assert.equal(await text('.grd .sch-empty__text'), 'Add the first group here, or paste a block from a spreadsheet.');
  assert.equal(await count('.grd .sch-empty .btn--primary'), 1);
  assert.equal(await page.$eval('.grd-sheet', (el) => el.hidden), true);
  await page.focus('#surface [role="tabpanel"]');
  await paste('7-1\t7\t24\r\n7-2\t7\t\r\n' + HOSTILE + '\t8\t30\r\n');
  await stagedIs(true);
  assert.equal(await barText(), 'Not applied yet: 3 groups added');
  assert.equal(await statusText(), 'Pasted 9 cells. Added 3 groups.');
  assert.deepEqual(await page.$$eval('.grd-row .grd-cell--name .grd-cell__text', (all) => all.map((cell) => cell.textContent)), ['7-1', '7-2', HOSTILE]);
  assert.deepEqual(await page.$$eval('.grd-grade th', (all) => all.map((th) => th.textContent)), ['Grade 7 · 2 groups', 'Grade 8 · 1 group']);
  await click('.grd-bar [data-action="apply"]');
  await stagedIs(false);
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.groups.map((group) => [group.name, group.grade, group.headCount])), [['7-1', '7', 24], ['7-2', '7', null], [HOSTILE, '8', 30]]);
  assert.equal(await count('.grd img'), 0);
});
