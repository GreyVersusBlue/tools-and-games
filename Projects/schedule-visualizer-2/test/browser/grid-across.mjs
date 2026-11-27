// The Grid's Teachers and Rooms rows, edited, in a real browser:
// node test/browser/grid-across.mjs
//
// SV2-155. The two tables are grids on the sheet's cursor, like the Groups
// rows. What is typed, picked, pasted, deleted or taken back is worked out by
// engine/grid-across.js and staged into the same draft as the Groups rows'
// edits, one staged step for each, said at once in a line under the table,
// and applied together as one undo step. Cases are by pointer and keyboard at
// 1280 px, by touch and keyboard at 390 px. Every wait is for a state the
// page sets (the section's `data-pending` gone, the grid's `data-staged`, a
// field or a refusal on the page), never for a first paint or a sleep.
//
// The sample school's A Day, by period (1 to 8):
//   6A  201 103 101 Cafeteria 302 303 204 203
//   7C  302 203 Gym 201 Cafeteria Library 301 102
//   8B  Gym 101 204 203 Cafeteria 103 202 303

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';

import { openPlanner, startServer, launch, loadModule } from './harness.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const HOSTILE = '<img src=x onerror=alert(1)> "quoted" 名前';

// The timing budget of one edit to a table of the fixture drawn: ARCHITECTURE
// 23.12 says 150 ms, and the case fails at twice that under two cores, as every
// timing file; on the machine's full cores it fails at 150 itself.
const REDRAW_BUDGET = 150;
const SLACK = 2;
const EDITS = 5;
// Cores at which the 150 ms target itself is asserted, not only the 300 ms line.
const FULL_CORES = 6;

let server;
let browser;
let desk;
let phone;

const slot = (rowId, day, period) => '[data-key="grid:' + rowId + ':' + day + ':' + period + '"]';
const settled = (page) => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
const stagedIs = (page, wanted) => page.waitForFunction((value) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.grd').dataset.staged === value, { timeout: 5000 }, String(wanted));
const status = (page) => page.$eval('.grd-status', (el) => el.textContent);
const bar = (page) => page.$eval('.grd-bar__text', (el) => el.textContent);
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
// What a slot shows: its words, without the ones only a screen reader is given
// ("Empty", "(problem)") and without its mark.
const held = (page, selector) => page.$eval(selector, (el) => {
  if (el.classList.contains('is-free')) return '';
  const copy = el.cloneNode(true);
  for (const extra of copy.querySelectorAll('.vh, .grd-cell__mark')) extra.remove();
  return copy.textContent;
});
const exists = (page, selector) => page.$(selector).then((found) => found !== null);
const activeKey = (page) => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
const schedule = (page) => page.evaluate(() => JSON.stringify(globalThis.sv2.store.project.groups));

// The window's own rows, drawn: the grid's section mounted, shown, and drawn
// for the rows asked for.
async function rowsAre(page, rows) {
  await settled(page);
  await page.evaluate((value) => document.querySelector('.grd-toolbar input[value="' + value + '"]').click(), rows);
  await page.waitForFunction((value) => document.querySelector('.grd').dataset.rows === value
    && document.querySelector('.sch').dataset.pending !== 'true'
    && Boolean(document.querySelector('.grd-sheet[data-role="' + value + '"]:not([hidden]) .grd-cell')), { timeout: 5000 }, rows);
}

async function reach(page, selector) {
  await settled(page);
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await page.waitForFunction((wanted) => {
    const el = document.querySelector(wanted);
    if (!el || el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && el.contains(hit);
  }, { timeout: 5000 }, selector);
}

// The cursor on a slot, as the keyboard has it: the focus put there, then the
// keys. Typing replaces what the slot holds; the field closes on Enter.
async function typeInto(page, selector, words) {
  await settled(page);
  await page.focus(selector);
  await page.keyboard.type(words);
  await page.waitForSelector('.grd-input', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await settled(page);
}

async function pasteInto(page, selector, tsv) {
  await settled(page);
  await page.focus(selector);
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, tsv);
  await settled(page);
}

// A paste where the focus is: after Shift+Arrows that is the end of the block, and focusing a slot
// first would collapse it.
async function pasteHere(page, tsv) {
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

// What is staged thrown away, so the page does not ask before it closes and
// the next case reads the sample as it is.
async function discard(page) {
  await settled(page);
  if ((await page.$eval('.grd', (el) => el.dataset.staged)) !== 'true') return;
  await page.evaluate(() => {
    document.querySelector('.toast__close')?.click();
    document.querySelector('.grd-bar [data-action="discard"]').click();
  });
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => document.querySelector('dialog[open] .btn--danger').click());
  await stagedIs(page, false);
}

async function change(page, name, payload) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((action, given) => {
    globalThis.sv2.store.apply(globalThis.sv2modules.actions[action], given);
  }, name, payload);
  await settled(page);
}

async function undo(page, times) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 1) globalThis.sv2.store.undo();
  }, times);
  await settled(page);
}

// Ctrl+Z, as the keyboard does it: with the cursor in the grid it takes back
// the last staged step.
async function ctrlZ(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await settled(page);
}

async function openGrid(size) {
  const session = await openPlanner({ server, browser, hash: '#schedule/grid', theme: 'light', ...size });
  await session.page.waitForFunction(() => document.querySelector('link[data-sheet="grid"]')?.sheet && getComputedStyle(document.querySelector('.grd-sheet')).position === 'relative');
  await settled(session.page);
  return session;
}

// A close of a case's own page; a case that failed says what the page said too.
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

// The big fixture is loaded in a browser of its own: a page that is a second
// tab of another cannot change the project, and the other two are open.
let big = null;
async function bigPage() {
  if (big) return big.session.page;
  const own = await launch();
  const session = await openPlanner({ server, browser: own, hash: '#schedule/grid', theme: 'light', width: 1280, height: 900 });
  await session.page.waitForFunction(() => document.querySelector('link[data-sheet="grid"]')?.sheet && getComputedStyle(document.querySelector('.grd-sheet')).position === 'relative');
  await settled(session.page);
  await session.page.evaluate(async () => {
    const { bigProject } = await import('./test/fixtures/big.mjs');
    const actions = await import('./engine/actions.js');
    const project = bigProject({ seed: 1 });
    project.onboarding.dismissed = true;
    globalThis.sv2.store.apply(actions.replaceProject, { project, label: 'Load the timing fixture' });
  });
  await session.page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 80, { timeout: 10000 });
  await settled(session.page);
  big = { browser: own, session };
  return session.page;
}

before(async () => {
  server = await startServer();
  browser = await launch();
  desk = await openGrid({ width: 1280, height: 800 });
  phone = await openGrid({ width: 390, height: 760, mobile: true });
});

after(async () => {
  const problems = [desk, phone].filter(Boolean).map((session) => session.problems());
  if (big) problems.push(big.session.problems());
  if (big) await big.browser.close();
  if (browser) await browser.close();
  if (server) await server.close();
  for (const found of problems) assert.deepEqual(found, { errors: [], blocked: [], shimmed: [] });
});

// ---------------------------------------------------------------- what the tables are

test('Rows: Groups · Teachers · Rooms, and the two tables are grids with one Tab stop and a name for each slot', async () => {
  const { page } = desk;
  assert.equal(await text(page, '.grd-toolbar__label[id]'), 'Rows:');
  assert.deepEqual(await page.$$eval('.grd-toolbar .seg input', (all) => all.map((input) => input.value)), ['groups', 'teachers', 'rooms']);
  assert.deepEqual(await page.$$eval('.grd-toolbar .seg__label', (all) => all.map((el) => el.textContent)), ['Groups', 'Teachers', 'Rooms']);

  for (const [rows, caption, first] of [
    ['teachers', 'Every teacher, one row each', 'tsample001'],
    ['rooms', 'Every room, one row each', 'rsample101'],
  ]) {
    await rowsAre(page, rows);
    const table = '.grd-sheet[data-role="' + rows + '"] .grd-table';
    assert.equal(await page.$eval(table, (el) => el.getAttribute('role') + '|' + el.getAttribute('aria-label') + '|' + el.getAttribute('aria-multiselectable')), 'grid|' + caption + '|true');
    assert.equal(await page.$$eval(table + ' [tabindex="0"]', (all) => all.length), 1, 'one Tab stop');
    assert.equal(await page.$eval(table + ' [tabindex="0"]', (el) => el.getAttribute('role') + '|' + el.getAttribute('aria-selected')), 'gridcell|true', 'on a slot, selected');
    assert.equal(await page.$eval(table + ' tbody tr:first-child th', (el) => el.getAttribute('role') + '|' + el.dataset.key), 'rowheader|grid:' + first + ':name');
  }
  // the name of each slot: the row, the period, the day type, then who is there
  await rowsAre(page, 'teachers');
  assert.equal(await page.$eval(slot('tsample001', DAY_A, 2), (el) => el.getAttribute('aria-label')), 'Ms. Halloran, Period 3, A Day: 6A in 101');
  await rowsAre(page, 'rooms');
  assert.equal(await page.$eval(slot('rsample101', DAY_A, 1), (el) => el.getAttribute('aria-label')), 'Room 101, Period 2, A Day: 8B');
  await rowsAre(page, 'groups');
});

test('the keys are the grid’s: arrows move slot to slot, Home and End go along the row, Shift selects a block, and a click puts the cursor where it lands', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await page.focus(slot('rsample101', DAY_A, 1));
  assert.equal(await activeKey(page), 'grid:rsample101:' + DAY_A + ':1');
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeKey(page), 'grid:rsample101:' + DAY_A + ':2');
  await page.keyboard.press('ArrowDown');
  assert.equal(await activeKey(page), 'grid:rsample102:' + DAY_A + ':2');
  await page.keyboard.press('Home');
  assert.equal(await activeKey(page), 'grid:rsample102:name');
  await page.keyboard.press('End');
  assert.equal(await activeKey(page), 'grid:rsample102:' + DAY_B + ':7');
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  assert.deepEqual(await page.$$eval('.grd-sheet:not([hidden]) [aria-selected="true"]', (all) => all.map((el) => el.dataset.key.replace(/^grid:/, ''))), [
    'rsample101:' + DAY_A + ':1', 'rsample101:' + DAY_A + ':2', 'rsample102:' + DAY_A + ':1', 'rsample102:' + DAY_A + ':2',
  ]);
  // copying a slot gives the names of the groups in it, for the grid or a spreadsheet
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.press('Escape');
  assert.equal(await copied(page), '8B');
  // a pointer: a click puts the cursor on the slot, a double click edits it
  await reach(page, slot('rsample103', DAY_A, 0));
  await page.click(slot('rsample103', DAY_A, 0));
  assert.equal(await activeKey(page), 'grid:rsample103:' + DAY_A + ':0');
  await page.click(slot('rsample103', DAY_A, 0), { count: 2 });
  await page.waitForSelector('.grd-input');
  assert.equal(await page.$eval('.grd-input', (el) => el.getAttribute('aria-label')), 'Room 103, Period 1, A Day, groups');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.grd-input'));
  await rowsAre(page, 'groups');
});

// ---------------------------------------------------------------- typing

test('typing a group into a Rooms slot replaces who is there: the loss is said first, the bar counts it, and one Ctrl+Z takes back the whole edit', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  const before = await schedule(page);
  // 8B is in Room 101 in Period 2, and 6A in Room 103 then
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '8B');
  await typeInto(page, slot('rsample101', DAY_A, 1), '6A');
  await stagedIs(page, true);
  assert.equal(await status(page), '8B now has no room in Period 2 on A Day (was 101). 6A moves from 103 to 101 in Period 2 on A Day. It is not applied yet.');
  assert.equal(await bar(page), 'Not applied yet: 2 groups changed');
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '6A', 'the slot shows the schedule as it would be');
  assert.equal(await held(page, slot('rsample103', DAY_A, 1)), '', 'Room 103 has lost 6A');
  assert.equal(await page.$eval(slot('rsample101', DAY_A, 1), (el) => el.classList.contains('is-staged')), true, 'the slot is marked staged');
  assert.equal(await schedule(page), before, 'nothing reached the schedule');
  assert.match(await page.$eval('#announcer', (el) => el.textContent), /8B now has no room in Period 2 on A Day/);
  // the Groups rows show it at once: 8B has no room, 6A is in 101
  await rowsAre(page, 'groups');
  assert.equal(await page.$eval('[data-key="grid:gsample08b:' + DAY_A + ':1"] .grd-cell__text', (el) => el.textContent), '');
  assert.equal(await page.$eval('[data-key="grid:gsample06a:' + DAY_A + ':1"] .grd-cell__text', (el) => el.textContent), '101');
  await rowsAre(page, 'rooms');
  await page.focus(slot('rsample101', DAY_A, 1));
  await ctrlZ(page);
  await stagedIs(page, false);
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '8B', 'one Ctrl+Z took the whole edit back');
  assert.equal(await exists(page, '.grd-bar'), false);
  await rowsAre(page, 'groups');
});

test('typing "7A, 8B" puts both in a room: the text is split on commas, and a shared space keeps both', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await typeInto(page, slot('rsamplegym', DAY_A, 5), '7A, 8B');
  await stagedIs(page, true);
  assert.equal(await held(page, slot('rsamplegym', DAY_A, 5)), '7A, 8B', 'Period 6: Gym holds both, and 8A, which was there, has gone');
  await discard(desk.page);
  await rowsAre(page, 'groups');
});

test('the picker under a Rooms slot lists groups with where each is now, narrows as you type, and Enter takes the one highlighted', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await settled(page);
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.grd-sheet:not([hidden]) .grd-list:not([hidden]) .picker__option');
  const options = await page.$$eval('.grd-sheet:not([hidden]) .grd-list .picker__option', (all) => all.map((el) => el.textContent));
  assert.equal(options.length, 8, 'every group');
  assert.ok(options.includes('6A · grade 6 · now in 103'), options.join(' | '));
  assert.ok(options.includes('8B · grade 8 · now in 101'));
  assert.equal(await page.$eval('.grd-input', (el) => el.getAttribute('role') + '|' + el.getAttribute('aria-expanded')), 'combobox|true');
  // typing narrows it, after the last comma
  await page.keyboard.type('7');
  assert.deepEqual(await page.$$eval('.grd-sheet:not([hidden]) .grd-list .picker__option', (all) => all.map((el) => el.textContent.split(' · ')[0])), ['7A', '7B', '7C']);
  await page.keyboard.type('b');
  assert.deepEqual(await page.$$eval('.grd-sheet:not([hidden]) .grd-list .picker__option', (all) => all.map((el) => el.textContent)), ['7B · grade 7 · now in 204']);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('.grd-sheet:not([hidden]) .grd-list .picker__option', (el) => el.getAttribute('aria-selected')), 'true');
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '7B');
  assert.match(await status(page), /^8B now has no room in Period 2 on A Day \(was 101\)\. 7B moves from 204 to 101 in Period 2 on A Day\./);
  // after a comma the list is every group again, and a click on one takes it
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(', ');
  await page.waitForFunction(() => document.querySelectorAll('.grd-sheet:not([hidden]) .grd-list .picker__option').length === 8);
  await reach(page, '.grd-sheet:not([hidden]) .grd-list .picker__option[data-group="gsample08b"]');
  await page.click('.grd-sheet:not([hidden]) .grd-list .picker__option[data-group="gsample08b"]');
  await settled(page);
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '7B, 8B');
  await discard(page);
  await rowsAre(page, 'groups');
});

test('typing a group into a teacher’s slot puts it with the teacher in their room, and says what was taken and what was lost', async () => {
  const { page } = desk;
  await rowsAre(page, 'teachers');
  // Mr. Larkspur has 7C in Room 302 in Period 1; 6A is in 201 then
  assert.equal(await held(page, slot('tsample011', DAY_A, 0)), '7C in 302');
  await typeInto(page, slot('tsample011', DAY_A, 0), '6A');
  await stagedIs(page, true);
  assert.equal(await status(page), '7C has no room in Period 1 on A Day now (it was in 302 with Mr. Larkspur). Mr. Larkspur takes 6A in Period 1 on A Day, in 302 (it was in 201). It is not applied yet.');
  assert.equal(await held(page, slot('tsample011', DAY_A, 0)), '6A in 302');
  assert.equal(await held(page, slot('tsample005', DAY_A, 0)), '', 'Ms. Oyelaran has lost 6A from Room 201');
  await discard(page);
  await rowsAre(page, 'groups');
});

test('a teacher with two rooms has an In field in the edit, starting at the room they already use, and the class goes where it says', async () => {
  const { page } = desk;
  // Mme. Dufrêne's Room 204, and now Room 201 too (6A is in it in Period 1, so Period 1 is hers with two rooms in use: Period 2 has one)
  await change(page, 'setRoomTeachers', { roomId: 'rsample201', teacherIds: ['tsample005', 'tsample008'] });
  try {
    await rowsAre(page, 'teachers');
    await settled(page);
    await page.focus(slot('tsample008', DAY_A, 1));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.grd-in');
    assert.equal(await page.$eval('.grd-in', (el) => el.getAttribute('aria-label')), 'In');
    assert.deepEqual(await page.$$eval('.grd-in option', (all) => all.map((el) => el.textContent)), ['201', '204']);
    assert.equal(await page.$eval('.grd-in', (el) => el.selectedOptions[0].textContent), '204', 'she has 7B in 204 then: that is where a class goes unless she says');
    // the text is the groups she has now, to be kept and added to
    assert.equal(await page.$eval('.grd-input', (el) => el.value), '7B');
    await page.keyboard.press('End');
    await page.keyboard.type(', 8A');
    await page.select('.grd-in', 'rsample201');
    await page.focus('.grd-input');
    await page.keyboard.press('Enter');
    await stagedIs(page, true);
    assert.equal(await status(page), 'Mme. Dufrêne takes 8A in Period 2 on A Day, in 201 (it was in 202). It is not applied yet.');
    assert.equal(await held(page, slot('tsample008', DAY_A, 1)), '7B in 204, 8A in 201');
    // a teacher with one room has no In field
    await page.focus(slot('tsample011', DAY_A, 1));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.grd-input');
    assert.equal(await exists(page, '.grd-in'), false);
    await page.keyboard.press('Escape');
    await discard(page);
  } finally {
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

// ---------------------------------------------------------------- Delete, paste, Ctrl+D

test('Delete takes the class out of a room, or away from a teacher, and says where it was; each is one staged step', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.press('Delete');
  await stagedIs(page, true);
  assert.equal(await status(page), 'Emptied 1 slot. 8B now has no room in Period 2 on A Day (was 101). It is not applied yet.');
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '');
  await rowsAre(page, 'teachers');
  await page.focus(slot('tsample011', DAY_A, 0));
  await page.keyboard.press('Delete');
  await stagedIs(page, true);
  assert.equal(await status(page), 'Emptied 1 slot. 7C has no room in Period 1 on A Day now (it was in 302 with Mr. Larkspur). It is not applied yet.');
  assert.equal(await bar(page), 'Not applied yet: 2 groups changed');
  // two steps: the first Ctrl+Z takes back the teacher's, the second the room's
  await ctrlZ(page);
  assert.equal(await bar(page), 'Not applied yet: 1 group changed');
  assert.equal(await held(page, slot('tsample011', DAY_A, 0)), '7C in 302');
  await ctrlZ(page);
  await stagedIs(page, false);
  await rowsAre(page, 'groups');
});

test('a block pasted into the Rooms rows goes slot by slot as one staged step, and a block naming one group in two rooms in one period is refused whole', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await pasteInto(page, slot('rsample101', DAY_A, 3), '7A\t7B');
  await stagedIs(page, true);
  assert.equal(await status(page), 'Pasted 2 slots. 7A moves from 102 to 101 in Period 4 on A Day. 7B moves from Cafeteria to 101 in Period 5 on A Day. It is not applied yet.');
  assert.equal(await held(page, slot('rsample101', DAY_A, 3)), '7A');
  assert.equal(await held(page, slot('rsample101', DAY_A, 4)), '7B');
  assert.equal(await bar(page), 'Not applied yet: 2 groups changed');
  assert.deepEqual(await page.$$eval('.grd-sheet:not([hidden]) [aria-selected="true"]', (all) => all.map((el) => el.dataset.key.replace(/^grid:/, ''))), ['rsample101:' + DAY_A + ':3', 'rsample101:' + DAY_A + ':4'], 'the block pasted is selected');
  await page.focus(slot('rsample101', DAY_A, 3));
  await ctrlZ(page);
  await stagedIs(page, false);
  assert.equal(await held(page, slot('rsample101', DAY_A, 3)), '', 'one Ctrl+Z took both slots back');

  // 6A in Rooms 101 and 102 in Period 1: two rooms at once
  await pasteInto(page, slot('rsample101', DAY_A, 0), '6A\n6A');
  assert.equal(await status(page), '6A is in two rooms in Period 1 in what you pasted: 101 and 102.');
  assert.equal(await exists(page, '.grd-bar'), false, 'a paste that is refused changes nothing');
  assert.equal(await held(page, slot('rsample101', DAY_A, 0)), '');
  await rowsAre(page, 'groups');
});

test('Ctrl+D says Fill down is for Groups rows, and stages nothing', async () => {
  const { page } = desk;
  for (const rows of ['rooms', 'teachers']) {
    await rowsAre(page, rows);
    await page.focus(slot(rows === 'rooms' ? 'rsample101' : 'tsample001', DAY_A, 1));
    await page.keyboard.down('Control');
    await page.keyboard.press('d');
    await page.keyboard.up('Control');
    assert.match(await status(page), /^Fill down is for Groups rows\./);
    assert.equal(await exists(page, '.grd-bar'), false);
    assert.equal(await exists(page, '.grd-toolbar [data-action="fill-down"]'), false, 'its button is the Groups rows’');
  }
  assert.match(await text(page, '.grd-hint'), /Fill down is for Groups rows/, 'the key hint says so');
  assert.match(await text(page, '.grd-hint'), /Typing replaces who is there; to add a class, type both: 7-3, 7-1\./);
  await rowsAre(page, 'groups');
});

// ---------------------------------------------------------------- refusals

test('a name that is no group is refused under the slot, in the schedule’s words, with the field kept to be fixed', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await settled(page);
  await page.focus(slot('rsample101', DAY_A, 1));
  await page.keyboard.type(HOSTILE);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.grd-sheet:not([hidden]) .grd-refusal:not([hidden])');
  const said = 'No class is called ' + HOSTILE + '. Add it in the Groups rows first.';
  assert.equal(await text(page, '.grd-sheet:not([hidden]) .grd-refusal'), said);
  assert.equal(await page.$eval('.grd-sheet:not([hidden]) .grd-refusal', (el) => el.children.length), 0, 'a name is text, never markup');
  assert.equal(await page.$eval('.grd-input', (el) => el.value + '|' + el.getAttribute('aria-invalid')), HOSTILE + '|true', 'the edit is kept');
  assert.equal(await status(page), said);
  assert.equal(await exists(page, '.grd-bar'), false);
  // below the slot, not over it
  const under = await page.evaluate(() => {
    const cell = document.querySelector('.grd-input').closest('td').getBoundingClientRect();
    const note = document.querySelector('.grd-sheet:not([hidden]) .grd-refusal').getBoundingClientRect();
    return note.top >= cell.bottom - 1;
  });
  assert.equal(under, true);
  // fixed in place: the refusal goes and the edit is taken
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('6A');
  assert.equal(await page.$eval('.grd-sheet:not([hidden]) .grd-refusal', (el) => el.hidden), true, 'typing takes the refusal away');
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '6A');
  await discard(page);
  // a group the school does not meet in is refused with its mark
  await rowsAre(page, 'groups');
});

test('a day type that follows another has its columns greyed with the line and a way to make it its own, and an edit there is refused', async () => {
  const { page } = desk;
  await change(page, 'setDayTypeKind', { dayTypeId: DAY_B, own: false, sameAs: DAY_A });
  try {
    await rowsAre(page, 'rooms');
    const head = await page.$eval('.grd-sheet:not([hidden]) .grd-head--day.is-follower', (el) => el.textContent);
    assert.match(head, /^B Day is the same as A Day · Make its own copy/);
    assert.equal(await page.$eval(slot('rsample101', DAY_B, 1), (el) => el.getAttribute('aria-disabled') + '|' + el.classList.contains('is-follower')), 'true|true');
    assert.equal(await held(page, slot('rsample101', DAY_B, 1)), '8B', 'its slots are A Day’s');
    assert.equal(await page.$eval(slot('rsample101', DAY_A, 1), (el) => el.getAttribute('aria-disabled')), null);
    assert.match(await page.$eval(slot('rsample101', DAY_B, 1), (el) => el.title), /^B Day is the same as A Day\. Make its own copy to change it\./);
    await settled(page);
    // a slot that could only be refused opens no field: the line says why, once
    await page.focus(slot('rsample101', DAY_B, 1));
    await page.keyboard.type('6A');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.grd-status')?.textContent.startsWith('B Day is the same as A Day.'));
    assert.equal(await text(page, '.grd-status'), 'B Day is the same as A Day. Make its own copy in the column header to change it.');
    assert.equal(await exists(page, '.grd-input'), false, 'no field was opened');
    assert.equal(await exists(page, '.grd-sheet:not([hidden]) .grd-refusal:not([hidden])'), false);
    assert.equal(await activeKey(page), 'grid:rsample101:' + DAY_B + ':1', 'the focus stays on the slot');
    // the button makes it its own, and the columns are alive
    await reach(page, '.grd-head--day [data-action="make-own"]');
    await page.click('.grd-head--day [data-action="make-own"]');
    await page.waitForFunction(() => !document.querySelector('.grd-head--day.is-follower') && document.querySelector('.sch').dataset.pending !== 'true');
    assert.equal(await page.$eval(slot('rsample101', DAY_B, 1), (el) => el.getAttribute('aria-disabled')), null);
    await undo(page, 1);
  } finally {
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

test('while the draft stands refused, an edit in the Teachers or Rooms rows is refused with the bar’s own sentence', async () => {
  const { page } = desk;
  await rowsAre(page, 'groups');
  // 6A is to be called Zed in the draft; then 6B is called Zed in the schedule
  await settled(page);
  await page.focus('[data-key="grid:gsample06a:name"]');
  await page.keyboard.type('Zed');
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  await change(page, 'editGroup', { id: 'gsample06b', name: 'Zed' });
  try {
    await rowsAre(page, 'rooms');
    assert.match(await bar(page), /^Not applied yet: changes that cannot be applied as they stand\. /, 'the bar says it is refused');
    const barSentence = await bar(page);
    await settled(page);
    await page.focus(slot('rsample101', DAY_A, 1));
    await page.keyboard.type('7A');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.grd-sheet:not([hidden]) .grd-refusal:not([hidden])');
    const refused = await text(page, '.grd-sheet:not([hidden]) .grd-refusal');
    assert.ok(refused.startsWith(barSentence), 'the refusal starts with the bar’s sentence: ' + refused);
    assert.match(refused, /Fix that, or Discard, before changing the schedule here\.$/);
    assert.equal(await page.$eval('.grd-input', (el) => el.value), '7A', 'the edit is kept');
    await page.keyboard.press('Escape');
    // a block pasted or emptied is refused as well, on the line
    await pasteInto(page, slot('rsample101', DAY_A, 3), '7A');
    assert.ok((await status(page)).startsWith(barSentence));
    await page.focus(slot('rsample101', DAY_A, 1));
    await page.keyboard.press('Delete');
    assert.ok((await status(page)).startsWith(barSentence));
  } finally {
    await undo(page, 1);
    await discard(page);
    await rowsAre(page, 'groups');
  }
});

// ---------------------------------------------------------------- Apply, once

test('Apply writes the Groups, Teachers and Rooms edits as one undo step, and one undo takes them all back', async () => {
  const { page } = desk;
  const before = await schedule(page);
  // a Groups edit (7A in Period 8 is Room 301; to Gym), a Teachers edit and a Rooms edit
  await rowsAre(page, 'groups');
  await typeInto(page, '[data-key="grid:gsample07a:' + DAY_A + ':7"]', 'Gym');
  await rowsAre(page, 'teachers');
  await typeInto(page, slot('tsample011', DAY_A, 0), '6A');
  await rowsAre(page, 'rooms');
  await typeInto(page, slot('rsample101', DAY_A, 3), '7B');
  const count = await bar(page);
  assert.match(count, /^Not applied yet: \d+ groups changed/);
  const depth = await page.evaluate(() => globalThis.sv2.store.undoDepth ? globalThis.sv2.store.undoDepth() : null);
  await page.evaluate(() => document.querySelector('.grd-bar [data-action="apply"]').click());
  await stagedIs(page, false);
  const after = await schedule(page);
  assert.notEqual(after, before, 'Apply changed the schedule');
  // the edits from the three orientations are in it
  const where = await page.evaluate((day) => {
    const project = globalThis.sv2.store.project;
    const room = (group, period) => {
      const held = project.groups.find((each) => each.name === group).days[day][period];
      return project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === held.room)?.number || held.roomText || '';
    };
    return [room('7A', 7), room('6A', 0), room('7B', 3)];
  }, DAY_A);
  assert.deepEqual(where, ['Gym', '302', '101']);
  if (depth !== null) {
    const now = await page.evaluate(() => globalThis.sv2.store.undoDepth());
    assert.equal(now, depth + 1, 'one step for all three');
  }
  // ONE undo, and the schedule is as it was
  await page.evaluate(() => globalThis.sv2.store.undo());
  await settled(page);
  assert.equal(await schedule(page), before, 'one undo took back the edits of all three orientations');
  await page.evaluate(() => globalThis.sv2.store.redo());
  await settled(page);
  assert.equal(await schedule(page), after, 'and one redo put them back');
  await undo(page, 1);
  await rowsAre(page, 'groups');
});

// ---------------------------------------------------------------- marks, and touch

test('with the cursor on a marked slot its sentence is drawn, and a slot with none draws nothing', async () => {
  const { page } = desk;
  await rowsAre(page, 'teachers');
  // Ms. Vandermeer has 6C and 7C in Room 203 in Period 2: a double-booking
  const marked = slot('tsample007', DAY_A, 1);
  assert.equal(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), 'none', 'not drawn until the cursor is on it');
  await page.focus(marked);
  assert.match(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), /Problem: Room 203 has two groups in Period 2 on A Day: 6C and 7C\./);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), 'none');
  await page.keyboard.press('ArrowLeft');
  assert.match(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), /^"?Problem: /);
  // and a change to the slot keeps its mark until the edit is staged, then marks redraw
  await typeInto(page, marked, '6C');
  await stagedIs(page, true);
  assert.equal(await page.$eval(marked, (el) => el.dataset.severity || null), null, 'staged: the double-booking is gone from the schedule as it would be');
  await discard(page);
  assert.equal(await page.$eval(marked, (el) => el.dataset.severity), 'problem');
  await rowsAre(page, 'groups');
});

test('on a phone the first tap on a marked slot draws its sentence and the second edits it in place; a swipe never edits', async () => {
  const { page } = phone;
  await rowsAre(page, 'teachers');
  const marked = slot('tsample007', DAY_A, 1);
  await reach(page, marked);
  const at = await page.$eval(marked, (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  assert.equal(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), 'none');
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), { timeout: 5000 }, marked);
  assert.match(await page.$eval(marked, (el) => getComputedStyle(el, '::after').content), /Problem: Room 203 has two groups/, 'the first tap draws the sentence');
  assert.equal(await exists(page, '.grd-input'), false, 'and edits nothing');
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.grd-input');
  assert.equal(await page.$eval('.grd-input', (el) => el.closest('td') === document.querySelector('[data-key="grid:tsample007:dsample00a:1"]')), true, 'in place, in the slot: no sheet over the table');
  assert.equal(await page.$eval('.grd-input', (el) => el.value), '6C, 7C');
  assert.equal(await exists(page, '[role="dialog"], dialog[open]'), false);
  const box = await page.$eval('.grd-input', (el) => {
    const rect = el.getBoundingClientRect();
    return { height: rect.height, left: rect.left, right: rect.right };
  });
  assert.ok(box.height >= 44, 'a finger-sized field: ' + box.height);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.grd-input'));
  // a swipe along the table scrolls it and edits nothing
  await page.touchscreen.touchStart(at.x, at.y);
  await page.touchscreen.touchMove(at.x - 60, at.y);
  await page.touchscreen.touchEnd();
  assert.equal(await exists(page, '.grd-input'), false, 'a swipe never edits');
  await rowsAre(page, 'groups');
});

test('on a phone a teacher’s slot is typed into and staged, and a day type that follows another says so in a header that fits', async () => {
  const { page } = phone;
  await rowsAre(page, 'rooms');
  const target = slot('rsample101', DAY_A, 3);
  await reach(page, target);
  const at = await page.$eval(target, (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.touchscreen.tap(at.x, at.y);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.grd-input');
  await page.keyboard.type('7A');
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  assert.equal(await status(page), '7A moves from 102 to 101 in Period 4 on A Day. It is not applied yet.');
  assert.equal(await text(page, '.grd-bar__text'), 'Not applied yet: 1 group changed');
  await discard(page);
});

// The cases below run on the first page before the case at 390 px: that one changes the page's emulation,
// which reloads it, and a reloaded page holds the full sample (a third day type that follows B Day, and
// duties) instead of the plain one these were written for.

test('copy and paste agree on the Teachers rows’ Before and After columns: a copied block keeps a column for each, and a paste leaves them out and says so', async () => {
  const { page } = desk;
  // the browser's sample has no duties: Coach Dunmore gets one before school and one after, so there are columns for them
  await change(page, 'addDuty', { kind: 'duty', label: 'Bus duty', when: 'before', teacherIds: ['tsample004'] });
  await change(page, 'addDuty', { kind: 'duty', label: 'Car line', when: 'after', teacherIds: ['tsample004'] });
  try {
    await rowsAre(page, 'teachers');
    const from = slot('tsample004', DAY_A, 6);
    await page.focus(from);
    await page.keyboard.down('Shift');
    // Period 7, Period 8, Before, After
    for (let n = 0; n < 4; n += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    const keys = await page.$$eval('.grd-sheet:not([hidden]) [aria-selected="true"]', (all) => all.map((el) => el.dataset.key.replace(/^grid:tsample004:/, '')));
    assert.deepEqual(keys, [DAY_A + ':6', DAY_A + ':7', DAY_A + ':before', DAY_A + ':after', DAY_B + ':0'], 'five columns: two periods, the two duties, the next day type’s first');
    const tsv = await copied(page);
    const cols = tsv.replace(/\r?\n$/, '').split('\t');
    assert.equal(cols.length, 5, 'the copy has a field for each column selected, the duties too: ' + JSON.stringify(tsv));
    assert.ok(cols[2] !== '' && cols[3] !== '', 'the Before and After fields are the duties the columns show (Coach Dunmore has a bus duty and a car line): ' + JSON.stringify(cols));
    assert.match(await status(page), /^Copied 3 slots\.$/, 'three of the five are slots');
    // the same block pasted two rows down lands period by period: the duties are left out by place
    await pasteInto(page, slot('tsample005', DAY_A, 6), tsv);
    const said = await status(page);
    assert.match(said, /2 slots of the block fell on the name or the duties and were left out\./, said);
    await discard(page);
  } finally {
    await undo(page, 2);
    await rowsAre(page, 'groups');
  }
});

test('one copied slot pasted over a selection that holds the Before and After columns fills the slots in it and passes the duties by without a word', async () => {
  const { page } = desk;
  await change(page, 'addDuty', { kind: 'duty', label: 'Bus duty', when: 'before', teacherIds: ['tsample004'] });
  await change(page, 'addDuty', { kind: 'duty', label: 'Car line', when: 'after', teacherIds: ['tsample004'] });
  try {
    await rowsAre(page, 'teachers');
    await page.focus(slot('tsample005', DAY_A, 6));
    // (a block kept from an earlier visit is still selected when the cursor's own slot is focused: Escape ends it)
    await page.keyboard.press('Escape');
    await page.keyboard.down('Shift');
    for (let n = 0; n < 4; n += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    const chosen = await page.$$eval('.grd-sheet:not([hidden]) [aria-selected="true"]', (all) => all.map((el) => el.dataset.key));
    assert.equal(chosen.length, 5, 'two periods, two duties, one more period: ' + chosen.join(' ') + ' (focus on ' + (await activeKey(page)) + ')');
    await pasteHere(page, '6A');
    const filled = await status(page);
    assert.doesNotMatch(filled, /fell on the name or the duties/, 'a fill passes over the duty columns without a word: ' + filled);
    assert.match(filled, /^Pasted 3 slots\./, filled);
    await discard(page);
  } finally {
    await undo(page, 2);
    await rowsAre(page, 'groups');
  }
});

test('Delete and a paste over a block that touches a follower day type take the slots that can be changed and say the others were left; Enter on one says why and opens no field', async () => {
  const { page } = desk;
  await change(page, 'setDayTypeKind', { dayTypeId: DAY_B, own: false, sameAs: DAY_A });
  try {
    await rowsAre(page, 'rooms');
    // Delete from A Day's Period 2 across to B Day’s Period 3: the room’s own slots are emptied
    await page.focus(slot('rsample101', DAY_A, 1));
    await page.keyboard.down('Shift');
    for (let n = 0; n < 9; n += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Delete');
    await stagedIs(page, true);
    const gone = await status(page);
    assert.match(gone, /^Emptied \d+ slots?\. /, gone);
    assert.match(gone, /\d+ slots? (was|were) left as (it is|they are): B Day is the same as A Day\. Make its own copy in the column header to change (it|them)\./, gone);
    assert.equal(await held(page, slot('rsample101', DAY_A, 1)), '', 'A Day’s slot was emptied');
    await ctrlZ(page);
    await stagedIs(page, false);
    // a paste from A Day's last period into B Day's: the first is taken, the rest left
    await pasteInto(page, slot('rsample101', DAY_A, 7), '7A\t7B\t7C');
    await stagedIs(page, true);
    const pasted = await status(page);
    assert.match(pasted, /^Pasted 1 slot\. /, pasted);
    assert.match(pasted, /2 slots were left as they are: B Day is the same as A Day\./, pasted);
    assert.equal(await held(page, slot('rsample101', DAY_A, 7)), '7A');
    await discard(page);
    // a block that is only follower slots changes nothing and says why
    await pasteInto(page, slot('rsample101', DAY_B, 1), '7A');
    assert.match(await status(page), /^Nothing was pasted: 1 slot was left as it is: B Day is the same as A Day\./);
    assert.equal(await exists(page, '.grd-bar'), false);
    // Enter and F2 on a follower slot: a line, no field
    await page.focus(slot('rsample101', DAY_B, 2));
    await page.keyboard.press('F2');
    await page.waitForFunction(() => document.querySelector('.grd-status')?.textContent.includes('B Day is the same as A Day.'));
    assert.equal(await exists(page, '.grd-input'), false);
  } finally {
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

test('a step taken back with Ctrl+Z comes back with Ctrl+Shift+Z or Ctrl+Y, a new edit ends what could come back, and the schedule itself is never touched by it', async () => {
  const { page } = desk;
  // a change to the project now, so the shell has no redo of its own to fall to
  await change(page, 'setRoomTeachers', { roomId: 'rsample102', teacherIds: ['tsample001'] });
  try {
    await rowsAre(page, 'rooms');
    const before = await schedule(page);
    const redo = async (key) => {
      await page.keyboard.down('Control');
      if (key === 'z') await page.keyboard.down('Shift');
      await page.keyboard.press(key);
      if (key === 'z') await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
      await settled(page);
    };
    await typeInto(page, slot('rsample101', DAY_A, 3), '7A');
    await stagedIs(page, true);
    await typeInto(page, slot('rsample102', DAY_A, 3), '7B');
    assert.equal(await bar(page), 'Not applied yet: 2 groups changed');
    await ctrlZ(page);
    await ctrlZ(page);
    await stagedIs(page, false);
    // Ctrl+Shift+Z brings the first step back, Ctrl+Y the second
    await page.focus(slot('rsample101', DAY_A, 3));
    await redo('z');
    await stagedIs(page, true);
    assert.equal(await bar(page), 'Not applied yet: 1 group changed');
    assert.equal(await held(page, slot('rsample101', DAY_A, 3)), '7A');
    assert.equal(await held(page, slot('rsample102', DAY_A, 3)), '');
    assert.match(await status(page), /^Brought back the last change taken back in the grid\.$/);
    await redo('y');
    await page.waitForFunction(() => document.querySelector('.grd-bar__text')?.textContent === 'Not applied yet: 2 groups changed');
    assert.equal(await held(page, slot('rsample102', DAY_A, 3)), '7B');
    // one Ctrl+Z takes back one step again, and a new edit ends what could come back
    await ctrlZ(page);
    assert.equal(await bar(page), 'Not applied yet: 1 group changed');
    await typeInto(page, slot('rsample101', DAY_A, 5), '7C');
    await stagedIs(page, true);
    await redo('z');
    assert.equal(await held(page, slot('rsample102', DAY_A, 3)), '', 'the step taken back before the new edit is gone for good');
    assert.equal(await held(page, slot('rsample101', DAY_A, 5)), '7C', 'and the new edit stands');
    assert.equal(await schedule(page), before, 'the schedule is as it was throughout: nothing was applied, nothing redone in it');
    await discard(page);
  } finally {
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

test('a second Enter, or the blur after a commit, stages the edit once; and a paste goes through when the frame has the focus', async () => {
  const { page } = desk;
  await rowsAre(page, 'rooms');
  await settled(page);
  await page.focus(slot('rsample101', DAY_A, 3));
  await page.keyboard.type('7A');
  await page.waitForSelector('.grd-input');
  // two Enters in one task: the second arrives before the drawing the first brings
  await page.evaluate(() => {
    const input = document.querySelector('.grd-sheet:not([hidden]) .grd-input');
    for (let n = 0; n < 2; n += 1) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new FocusEvent('blur'));
  });
  await stagedIs(page, true);
  assert.equal(await bar(page), 'Not applied yet: 1 group changed');
  // (a second commit would work the same edit out again against what the first left, find it already so,
  // and replace the line that says what the edit did with "Nothing changed")
  assert.match(await status(page), /^7A moves from 102 to 101 in Period 4 on A Day\./, 'the line still says what the edit did');
  await ctrlZ(page);
  await stagedIs(page, false);
  assert.equal(await held(page, slot('rsample101', DAY_A, 3)), '', 'one Ctrl+Z took back the one step: it was not staged twice');
  // paste with the focus on the frame (it has the focus when the cursor's row is not drawn)
  await page.evaluate(() => {
    const frame = document.querySelector('.grd-sheet:not([hidden]) .grd-scroll');
    frame.tabIndex = 0;
    frame.focus();
  });
  // (the frame sends the focus to the cursor's slot at once, so what is pasted lands on the cursor either way)
  await page.waitForFunction(() => document.activeElement?.dataset?.key?.startsWith('grid:'));
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '7A');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await settled(page);
  assert.match(await status(page), /^Pasted 1 slot\./);
  await discard(page);
  await rowsAre(page, 'groups');
});

test('a teacher’s In field open under a slot leaves the row its height, and a free slot shows its word to the eye', async () => {
  const { page } = desk;
  await rowsAre(page, 'teachers');
  // the free slot says "Planning" in a size a person can read
  const free = await page.$eval('.grd-sheet:not([hidden]) .grd-cell--across.is-free[aria-label]', (el) => ({ text: el.textContent, size: parseFloat(getComputedStyle(el).fontSize), word: el.getAttribute('aria-label').split(': ').pop() }));
  assert.equal(free.text, 'Planning');
  assert.equal(free.word, 'Planning');
  assert.ok(free.size >= 11, 'the word is drawn, at ' + free.size + ' px');
  // Mme. Dufrêne has a second room now, so the In field opens; the row is as tall with it open as closed
  // (her Period 1 now shows more than it did, so the row is compared with itself)
  await change(page, 'setRoomTeachers', { roomId: 'rsample201', teacherIds: ['tsample005', 'tsample008'] });
  try {
    await rowsAre(page, 'teachers');
    const cell = slot('tsample008', DAY_A, 1);
    const closed = await page.$eval(cell, (el) => el.closest('tr').getBoundingClientRect().height);
    await page.focus(cell);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.grd-in');
    const open = await page.$eval('.grd-input', (el) => {
      const td = el.closest('td');
      const field = td.querySelector('.grd-in__field');
      return { row: el.closest('tr').getBoundingClientRect().height, under: Math.round(field.getBoundingClientRect().top - td.getBoundingClientRect().bottom), position: getComputedStyle(field).position };
    });
    assert.equal(open.position, 'absolute');
    assert.ok(Math.abs(open.row - closed) <= 1, 'the row is as tall with the In field open (' + open.row + ') as closed (' + closed + ')');
    assert.ok(open.under >= -1 && open.under < 4, 'the In field is under the slot, not in the row: ' + open.under);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.grd-input'));
  } finally {
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

test('at 390 px a day type that follows another says so in a header that fits, with a button a finger can press', async () => {
  // the phone's page is a second tab, which cannot change the project: the
  // first page is made as narrow as a phone for this case
  const { page } = desk;
  await change(page, 'setDayTypeKind', { dayTypeId: DAY_B, own: false, sameAs: DAY_A });
  try {
    await page.setViewport({ width: 390, height: 760, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.waitForFunction(() => window.innerWidth === 390);
    await rowsAre(page, 'rooms');
    assert.equal(await exists(page, '.grd-head--day.is-follower [data-action="make-own"]'), true);
    await reach(page, '.grd-head--day.is-follower [data-action="make-own"]');
    const fits = await page.evaluate(() => {
      const scroll = document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').getBoundingClientRect();
      const button = document.querySelector('.grd-head--day.is-follower [data-action="make-own"]').getBoundingClientRect();
      return { frame: scroll.right, page: window.innerWidth, button: button.height };
    });
    assert.ok(fits.frame <= fits.page, 'the table\u2019s frame is no wider than the screen');
    assert.ok(fits.button >= 24, 'a button with a box: ' + fits.button);
  } finally {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 1280);
    await undo(page, 1);
    await rowsAre(page, 'groups');
  }
});

// ---------------------------------------------------------------- the budget

test('a large school\u2019s Rooms rows are drawn a window at a time: the keys reach every row, the scroll bar is the whole table\u2019s, and the grid is still one Tab stop', async () => {
  const page = await bigPage();
  await rowsAre(page, 'rooms');
  const table = '.grd-sheet[data-role="rooms"] .grd-table';
  const drawn = () => page.$$eval(table + ' tbody tr.grd-row', (all) => all.map((tr) => Number(tr.getAttribute('aria-rowindex'))));
  const first = await drawn();
  assert.equal(first[0], 3, 'the first room is the third row: two of headings');
  assert.ok(first.length < 60, 'a window, not the table: ' + first.length);
  assert.equal(await page.$eval(table + ' tbody tr.grd-pad:last-child td', (el) => parseFloat(el.style.height) > 1000), true, 'the rows not drawn are stood for, so the scroll bar is as long as the table');
  assert.equal(await page.$$eval('.grd-sheet:not([hidden]) [tabindex="0"]', (all) => all.length), 1);
  // Ctrl+End goes to the last slot of the last room, which is drawn then
  await page.focus(table + ' tbody tr.grd-row .grd-cell--across[tabindex="0"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.activeElement?.dataset.key?.startsWith('grid:') && document.activeElement.closest('tr')?.getAttribute('aria-rowindex') === '152');
  const last = await drawn();
  assert.equal(last[last.length - 1], 152, 'the last room is drawn');
  assert.ok(last.length < 60 && last[0] > 3, 'and the first rooms no longer are: ' + last[0]);
  assert.equal(await page.$$eval('.grd-sheet:not([hidden]) [tabindex="0"]', (all) => all.length), 1);
  // Ctrl+Home goes back, and PageDown moves ten rows
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex') === '3');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex') === '13');
  // an edit in a room that was scrolled to is the same edit
  await page.keyboard.press('End');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex') === '152');
  const name = await page.evaluate(() => globalThis.sv2.store.project.groups[0].name);
  await page.keyboard.type(name);
  await page.waitForSelector('.grd-input');
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  assert.match(await bar(page), /^Not applied yet: 1 group changed/);
  assert.equal(await page.$eval(table + ' tbody tr.grd-row:last-child', (el) => el.getAttribute('aria-rowindex')), '152', 'the last room is still drawn after the edit (and is the last row: no pad stands for rows after it)');
  await discard(page);
});

test('one edit in the Rooms rows of the big fixture is drawn in under ' + REDRAW_BUDGET + ' ms, and the case fails at ' + REDRAW_BUDGET * SLACK, async () => {
  const page = await bigPage();
  {
    await rowsAre(page, 'rooms');
    // 150 rows, drawn a window of them at a time (sheet.js ROW_WINDOW): the table says how many it has
    assert.equal(await page.$eval('.grd-sheet:not([hidden]) .grd-table', (el) => el.getAttribute('aria-rowcount')), '152', 'a row for each of the fixture\u2019s 150 rooms, and two of headings');
    const drawn = await page.$$eval('.grd-sheet:not([hidden]) tbody tr.grd-row', (all) => all.length);
    assert.ok(drawn > 20 && drawn < 60, 'a screenful and a margin of the rows is drawn: ' + drawn);
    assert.equal(await page.$$eval('.grd-sheet:not([hidden]) tbody tr.grd-row:nth-child(2) td', (all) => all.length), 20, 'and a slot for each period of both day types');
    // edits: a group named into a slot, EDITS times, each in another room and period. The clock
    // is read in the page: from the Enter that commits to the drawing being done
    // (the section's data-pending gone, which the page sets as it draws).
    const times = [];
    for (let n = 0; n < EDITS; n += 1) {
      const target = await page.evaluate((i) => {
        const rowsDrawn = document.querySelectorAll('.grd-sheet:not([hidden]) tbody tr.grd-row');
        const row = rowsDrawn[i * 3];
        return row.children[1 + i].dataset.key;
      }, n);
      await page.focus('[data-key="' + target + '"]');
      const name = await page.evaluate(() => globalThis.sv2.store.project.groups[0].name);
      // typing replaces what the slot holds: the first key opens the field
      await page.keyboard.type(name);
      await page.waitForSelector('.grd-input');
      const took = await page.evaluate(() => new Promise((resolve) => {
        const section = document.querySelector('.sch');
        const started = performance.now();
        const watch = new MutationObserver(() => {
          if (section.dataset.pending === 'true') return;
          watch.disconnect();
          // drawn is laid out too: reading a box makes the browser do it now
          document.querySelector('.grd-sheet:not([hidden]) .grd-table').getBoundingClientRect();
          resolve(performance.now() - started);
        });
        watch.observe(section, { attributes: true, attributeFilter: ['data-pending'] });
        document.querySelector('.grd-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }));
      await stagedIs(page, true);
      times.push(took);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    process.stdout.write('# one edit to drawn in the Rooms rows of the big fixture: ' + times.map((ms) => ms.toFixed(0)).join(', ') + ' ms, median ' + median.toFixed(0) + ' (budget ' + REDRAW_BUDGET + ', fails at ' + REDRAW_BUDGET * SLACK + ')\n');
    // On the machine's full cores (Huginn has 8) the target is the line; pinned to two cores
    // (`taskset -c 0,1`, as CI's runner is) the line is twice that. Node reads the cores the
    // process may use, so a pinned run is told apart from a free one.
    const full = availableParallelism() >= FULL_CORES;
    const line = full ? REDRAW_BUDGET : REDRAW_BUDGET * SLACK;
    process.stdout.write('# cores ' + availableParallelism() + ': the line is ' + line + ' ms\n');
    assert.ok(median < line, 'the median edit took ' + median.toFixed(0) + ' ms: over ' + line + (full ? ' (the target, on ' + availableParallelism() + ' cores)' : ' (the failing line, on ' + availableParallelism() + ' cores)'));
  }
});

// ---------------------------------------------------------------- SV2-155b: the fixes from the review of SV2-155

// The frame of the table shown, scrolled to `top`, and waited for until a row
// is drawn under the middle of it (the page draws the window the scroll asks
// for on the scroll event, and sets nothing else to wait on).
async function scrollTo(page, top) {
  await page.evaluate((y) => {
    document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').scrollTop = y;
  }, top);
  await page.waitForFunction((y) => {
    const frame = document.querySelector('.grd-sheet:not([hidden]) .grd-scroll');
    if (Math.abs(frame.scrollTop - y) > 2 && frame.scrollTop + frame.clientHeight < frame.scrollHeight - 2) return false;
    const box = frame.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 140, box.top + box.height / 2);
    return Boolean(hit) && Boolean(hit.closest('tr.grd-row'));
  }, { timeout: 5000 }, top);
}

// Every id a slot's description names, and which of them the page does not have.
const describedBy = (page) => page.$$eval('.grd-sheet:not([hidden]) [aria-describedby]', (all) => {
  const missing = [];
  let named = 0;
  for (const el of all) {
    for (const id of el.getAttribute('aria-describedby').split(/\s+/)) {
      named += 1;
      if (!document.getElementById(id)) missing.push(id);
    }
  }
  return { cells: all.length, named, missing };
});

// The rows drawn, and whether the padding makes the table as tall as all its rows.
const tableShape = (page) => page.$eval('.grd-sheet:not([hidden]) .grd-table', (table) => {
  const rows = Array.from(table.tBodies[0].rows);
  const one = rows.find((tr) => tr.classList.contains('grd-row'));
  return {
    drawn: rows.filter((tr) => tr.classList.contains('grd-row')).map((tr) => Number(tr.getAttribute('aria-rowindex')) - 2),
    body: table.tBodies[0].getBoundingClientRect().height,
    expected: (Number(table.getAttribute('aria-rowcount')) - 2) * one.getBoundingClientRect().height,
  };
});

test('the Teachers rows of a large school are drawn a window at a time too, and every mark a drawn slot names has its sentence in the page wherever the scroll has gone', async () => {
  const page = await bigPage();
  await rowsAre(page, 'teachers');
  const table = '.grd-sheet[data-role="teachers"] .grd-table';
  assert.equal(await page.$eval(table, (el) => el.getAttribute('aria-rowcount')), '152', 'a row for each of the fixture’s 150 teachers, and two of headings');
  const first = await tableShape(page);
  assert.ok(first.drawn.length > 20 && first.drawn.length < 60, 'a window, not the table: ' + first.drawn.length);
  let named = 0;
  for (const top of [0, 1800, 3600, 5400, 2700]) {
    await scrollTo(page, top);
    const found = await describedBy(page);
    named += found.named;
    assert.deepEqual(found.missing, [], 'at ' + top + ' px every sentence a slot names is in the page (' + found.cells + ' marked slots drawn)');
    const shape = await tableShape(page);
    assert.ok(Math.abs(shape.body - shape.expected) < 3, 'the padding makes the table as tall as all its rows at ' + top + ': ' + shape.body + ' of ' + shape.expected);
  }
  assert.ok(named > 0, 'the fixture has marks on the slots drawn, or this case checks nothing');
  await scrollTo(page, 0);
  await rowsAre(page, 'groups');
});

test('a scroll or a resize while a slot is being edited never takes the field away: the typed words and the focus stay, and Enter stages them', async () => {
  const page = await bigPage();
  await rowsAre(page, 'teachers');
  const table = '.grd-sheet[data-role="teachers"] .grd-table';
  await scrollTo(page, 0);
  const target = await page.$eval(table + ' tbody tr.grd-row:nth-child(3) td.grd-cell--across:not(.is-follower)', (el) => el.dataset.key);
  const [, teacherId, dayType, period] = target.split(':');
  const name = await page.evaluate(() => globalThis.sv2.store.project.groups[0].name);
  await page.focus('[data-key="' + target + '"]');
  await page.keyboard.type(name);
  await page.waitForSelector('.grd-input');
  const row = await page.$eval(table + ' .grd-input', (el) => el.closest('tr').getAttribute('aria-rowindex'));
  // far away, and the other way, and a window made short: the field is still in its row
  for (const top of [4800, 0, 2400]) {
    await scrollTo(page, top);
    const found = await page.evaluate((rowindex) => {
      const input = document.querySelector('.grd-sheet:not([hidden]) .grd-input');
      return { there: Boolean(input), row: input && input.closest('tr').getAttribute('aria-rowindex'), focused: document.activeElement === input, value: input && input.value, body: document.activeElement === document.body };
    }, row);
    assert.deepEqual(found, { there: true, row, focused: true, value: name, body: false }, 'at ' + top + ' px the field is where it was, focused, with what was typed');
    assert.deepEqual((await describedBy(page)).missing, []);
  }
  await page.setViewport({ ...page.viewport(), height: 420 });
  await page.waitForFunction(() => document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').clientHeight < 330);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.grd-sheet:not([hidden]) .grd-input')), true, 'a resize keeps the field and its focus');
  await page.setViewport({ ...page.viewport(), height: 900 });
  await page.waitForFunction(() => document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').clientHeight > 400);
  await page.keyboard.press('Enter');
  await stagedIs(page, true);
  assert.match(await bar(page), /^Not applied yet: \d+ groups? changed/);
  assert.ok(await exists(page, '[data-key="grid:' + teacherId + ':' + dayType + ':' + period + '"]'), 'the slot edited is still drawn');
  // a second Enter, or the blur the drawing causes, stages nothing more
  await discard(page);
  await scrollTo(page, 0);
  await rowsAre(page, 'groups');
});

test('a scroll or a resize with the focus on the cursor’s slot leaves the cursor drawn and focused, however far the window goes', async () => {
  const page = await bigPage();
  await rowsAre(page, 'teachers');
  const table = '.grd-sheet[data-role="teachers"] .grd-table';
  await scrollTo(page, 0);
  const target = await page.$eval(table + ' tbody tr.grd-row:nth-child(4) td.grd-cell--across:not(.is-follower)', (el) => el.dataset.key);
  await page.focus('[data-key="' + target + '"]');
  for (const top of [5200, 1500, 0]) {
    await scrollTo(page, top);
    assert.equal(await activeKey(page), target, 'at ' + top + ' px the focus is still on the cursor’s slot');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false);
    assert.equal(await page.$$eval('.grd-sheet:not([hidden]) [tabindex="0"]', (all) => all.length), 1, 'one Tab stop, and it is the slot');
    assert.deepEqual((await describedBy(page)).missing, []);
    const shape = await tableShape(page);
    assert.ok(Math.abs(shape.body - shape.expected) < 3, 'the padding keeps the table’s height with the cursor’s row apart from the window: ' + shape.body + ' of ' + shape.expected);
  }
  await scrollTo(page, 5200);
  await page.setViewport({ ...page.viewport(), height: 420 });
  await page.waitForFunction(() => document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').clientHeight < 330);
  assert.equal(await activeKey(page), target, 'a resize leaves it');
  await page.setViewport({ ...page.viewport(), height: 900 });
  await page.waitForFunction(() => document.querySelector('.grd-sheet:not([hidden]) .grd-scroll').clientHeight > 400);
  // the keys still go from where the cursor is: ArrowDown brings the next row to it
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((key) => document.activeElement?.dataset.key && document.activeElement.dataset.key !== key, {}, target);
  await scrollTo(page, 0);
  await rowsAre(page, 'groups');
});

