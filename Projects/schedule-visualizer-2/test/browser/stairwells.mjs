// Stairwells in the planner, in a real browser: node test/browser/stairwells.mjs
//
// A stairwell is stairs joined through three or more floors under one letter
// (SPEC 4.5's wish, ARCHITECTURE 22.4 and 22.17, DESIGN 16.7 and 16.12). This
// file walks every control of it by pointer and by keys alone, and at 390 px
// by keys and with a finger (Stairwell through floors…, Connect another floor…
// and a tap on the stairs, the menu's Remove, Split and Disconnect, the
// properties' Make one stairwell and Disconnect): the stair's properties for a chain ("Make one stairwell" and its
// sentence naming every letter that changes, with the Letter field), for a
// stairwell (Which way for the whole well, the Letter field, a row a stop with
// Show and Remove from stairwell, Disconnect on two stops, Connect another
// floor…, Split into separate stairs), "Stairwell through floors…" (a row a
// floor saying what is there, a footer pinned at 844 by 390), the Floor tab's
// one row for a stairwell, one letter on every badge (the plan's words, the
// printed plan, the one-way rule) and the elevator's pill and the stairs' pill
// the same height and place at three zooms. Every wait is on a state the page
// sets (the plan at rest, the dialog's own words, the banner), never on a first
// paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, still } from './harness.mjs';
import { startEmpty, planReady, point, click, state, wholeFloor, floorIs, clearToast } from './draw-pointer.mjs';

let session;
let page;
let cdp = null;

const CELL = 14 + 10 * 40; // the stairs' row and column on every floor
const cellOf = (x, y) => y * 40 + x;
const building = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.building)));
const entries = async () => (await state(page)).entries;
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const toastText = () => page.evaluate(() => {
  const toast = document.querySelector('.toast .toast__text');
  return toast ? toast.textContent : null;
});
const said = () => page.$eval('#announcer', (el) => el.textContent);
const wells = async () => (await building()).connections.map((connection) => [connection.label, connection.well || null]);

// A project of `count` floors, each with a corridor along row 10 (columns 5 to
// 12), built through the actions. `stairs` is the list of floor numbers that
// have a stairs cell at CELL. Floor 1 is on screen.
async function floors(count, stairs, extra) {
  await startEmpty(page);
  await page.evaluate(async ({ count, stairs, extra }) => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    for (let n = 1; n < count; n += 1) store.apply(actions.addFloor, {});
    const all = () => store.project.building.floors;
    for (const floor of all()) store.apply(actions.paintCorridor, { floorId: floor.id, from: 5 + 10 * 40, to: 12 + 10 * 40 });
    for (const n of stairs) store.apply(actions.placeStairs, { floorId: all()[n - 1].id, cells: [14 + 10 * 40] });
    // a corridor on the stairs' own place, on the floors asked for
    for (const n of extra.corridor || []) store.apply(actions.paintCorridor, { floorId: all()[n - 1].id, from: 13 + 10 * 40, to: 15 + 10 * 40 });
    // a plain chain of flights from Floor 1 up, as Connect… makes them
    for (const [from, to] of extra.flights || []) store.apply(actions.connectStairs, { a: { floorId: all()[from - 1].id, cell: 14 + 10 * 40 }, b: { floorId: all()[to - 1].id, cell: 14 + 10 * 40 } });
  }, { count, stairs, extra: extra || {} });
  await showFloor('Floor 1');
}

async function showFloor(name) {
  await page.evaluate((wanted) => {
    const tab = Array.from(document.querySelectorAll('.bld-floors__tab')).find((each) => each.textContent.includes(wanted));
    tab.click();
  }, name);
  await floorIs(page, name);
  await still(page);
  await wholeFloor(page);
}

async function hover(x, y) {
  const at = await point(page, x, y);
  await page.mouse.move(at.x, at.y);
}

async function clickAt(x, y, options) {
  const at = await point(page, x, y);
  await page.mouse.click(at.x, at.y, options);
}

// The menu of the stairs, by the right button; its entries.
async function menuOn(x, y) {
  await clickAt(x, y, { button: 'right' });
  await page.waitForSelector('.menu[role="menu"]');
  return page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
}

async function choose(label) {
  const done = await page.evaluate((wanted) => {
    const item = Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((each) => each.textContent.trim() === wanted);
    if (!item) return false;
    item.click();
    return true;
  }, label);
  assert.equal(done, true, 'the menu has no "' + label + '"');
}

// The stairs' Properties, by the cell's menu: the Select tool opens Properties
// for corridor cells and elevator stops only, so for stairs it is the menu.
async function propertiesOf(floorName) {
  await showFloor(floorName);
  await menuOn(14, 10);
  await choose('Properties of this cell');
  await page.waitForFunction(() => { const t = document.querySelector('#inspector-properties #inspector-title'); return Boolean(t) && t.textContent !== ''; });
}

const title = () => text('#inspector-properties #inspector-title');
const key = (name) => '#inspector-properties [data-key="' + name + '"]';
const dialogOpen = (id) => page.waitForFunction((wanted) => Boolean(document.getElementById(wanted)) && document.getElementById(wanted).open, {}, id);
const dialogGone = (id) => page.waitForFunction((wanted) => !document.getElementById(wanted), {}, id);
// A dialog's primary button set aside the app's way (app.css's .btn[aria-disabled="true"]):
// aria-disabled, not disabled, so it keeps its place in the Tab order, drawn dashed,
// and described by the note that says why.
const SET_ASIDE = { aria: 'true', disabled: false, focusable: true, dashed: true, described: true };
const setAside = (dialog) => page.$eval(dialog + ' .dialog__buttons .btn--primary', (el) => {
  const had = document.activeElement;
  el.focus();
  const focusable = document.activeElement === el;
  if (had && had.focus) had.focus();
  const note = el.getAttribute('aria-describedby');
  return { aria: el.getAttribute('aria-disabled'), disabled: el.disabled, focusable, dashed: getComputedStyle(el).borderTopStyle === 'dashed', described: Boolean(note && document.getElementById(note) && document.getElementById(note).textContent !== '') };
});
// The next change the plan's editor is asked to make is refused, as the engine's
// refusal is (the editor's commit answers null); the one after goes through.
const refuseNext = () => page.evaluate(() => {
  const editor = document.querySelector('.bld').editor;
  const real = editor.commit;
  editor.commit = function () {
    editor.commit = real;
    return null;
  };
});
const ticked = (selector) => page.$$eval(selector + ' .bi-way__input', (all) => all.filter((input) => input.checked).map((input) => input.value));
const waitFor = (selector, wanted) => page.waitForFunction((s, w) => { const el = document.querySelector(s); return Boolean(el) && el.textContent === w; }, {}, selector, wanted);

async function undo() {
  await page.evaluate(() => globalThis.sv2.store.undo());
}

async function retype(selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value !== '') await page.keyboard.type(value);
}

before(async () => {
  session = await openPlanner({ theme: 'light', hash: '#building' });
  page = session.page;
  await startEmpty(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- make one stairwell

test('a chain of three floors offers Make one stairwell in the stair\'s properties; its sentence names every letter that changes and the Letter field renames the well', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await propertiesOf('Floor 2');
  assert.equal(await title(), 'Stairs A and B');
  assert.equal(await text('#well-offer'), 'Stairs A and B join Floor 1 to Floor 3. As one stairwell they show one letter, A, on every floor.');
  const before = await entries();
  await page.click(key('well-make'));
  await dialogOpen('stairwell-make-dialog');
  assert.equal(await text('#stairwell-sentence'), 'Stairs B will be called A on every floor, map, poster and set of directions. Stairs A and B become Stairwell A, on Floors 1 to 3.');
  assert.equal(await page.$eval('#stairwell-letter', (el) => el.value), 'A');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'stairwell-letter', 'the Letter field has the focus');
  // typing a letter says every letter that changes, as it is typed
  await retype('#stairwell-letter', 'North');
  await waitFor('#stairwell-sentence', 'Stairs A and B will all be called North on every floor, map, poster and set of directions. Stairs A and B become Stairwell North, on Floors 1 to 3.');
  assert.equal(await page.$eval('.dialog__buttons .btn--primary', (el) => el.textContent), 'Make Stairwell North');
  // too long: said in words, and the button is off
  await retype('#stairwell-letter', 'x'.repeat(9));
  await waitFor('#stairwell-note', 'A stairwell\'s letter or name is at most 8 characters, and this one has 9. Shorten it.');
  assert.deepEqual(await setAside('#stairwell-make-dialog'), SET_ASIDE, 'the button is set aside the app\'s way');
  // pressed while set aside, by the pointer and by Enter on it: nothing happens, the dialog stays
  await page.click('#stairwell-make-dialog .btn--primary');
  assert.equal(await page.evaluate(() => Boolean(document.getElementById('stairwell-make-dialog') && document.getElementById('stairwell-make-dialog').open)), true, 'a click on the set-aside button closed the dialog');
  await page.focus('#stairwell-make-dialog .btn--primary');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => Boolean(document.getElementById('stairwell-make-dialog') && document.getElementById('stairwell-make-dialog').open)), true, 'a set-aside button closed the dialog');
  assert.equal(await entries(), before);
  await page.focus('#stairwell-letter');
  // Escape calls it off, nothing changes
  await page.keyboard.press('Escape');
  await dialogGone('stairwell-make-dialog');
  assert.equal(await entries(), before);
  assert.deepEqual(await wells(), [['A', null], ['B', null]]);
  assert.equal(await said(), 'No stairwell was made.');
  // again, and made
  await page.click(key('well-make'));
  await dialogOpen('stairwell-make-dialog');
  await retype('#stairwell-letter', 'North');
  await waitFor('#stairwell-note', '');
  await page.keyboard.press('Enter');
  await dialogGone('stairwell-make-dialog');
  assert.deepEqual(await wells(), [['A', 'North'], ['B', 'North']]);
  assert.equal(await entries(), before + 1, 'one undo step');
  assert.equal((await state(page)).label, 'Make one stairwell, Stairwell North');
  // the toast's floors in the dialog's words, "Floors 1 to 3", as its sentence said them
  assert.match(await toastText(), /^Stairs A and B are now Stairwell North, on Floors 1 to 3\./);
  // the stair's properties say Stairwell North
  await waitFor('#inspector-properties #inspector-title', 'Stairwell North');
  assert.equal(await text('#well-floors'), 'Floor 1 to Floor 3: stops on Floor 1, Floor 2 and Floor 3.');
  await undo();
  assert.deepEqual(await wells(), [['A', null], ['B', null]]);
});

// ---------------------------------------------------------------- a stairwell's properties

test('a stairwell\'s properties: one way for every flight, the Letter field, a row a stop, Remove from stairwell, Disconnect on two stops, and Split', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
  });
  await propertiesOf('Floor 2');
  assert.equal(await title(), 'Stairwell A');
  assert.equal(await text('#well-floors'), 'Floor 1 to Floor 3: stops on Floor 1, Floor 2 and Floor 3.');
  // Which way, for the whole stairwell
  const way = await page.$$eval('#inspector-properties [data-way="well"] .bi-way__input', (all) => all.map((input) => [input.value, input.checked]));
  assert.deepEqual(way, [['both', true], ['up', false], ['down', false]]);
  let before = await entries();
  // a change that is refused ticks the way there was again
  await refuseNext();
  await page.click(key('well-way:up'));
  assert.deepEqual(await ticked('#inspector-properties [data-way="well"]'), ['both'], 'a refused way left the wrong chip ticked');
  assert.equal(await entries(), before);
  await page.click(key('well-way:up'));
  await waitFor('#well-way-says', 'Stairwell A runs up only. Applied to 2 flights.');
  assert.deepEqual((await building()).connections.map((connection) => connection.direction), ['ab', 'ab']);
  assert.equal(await entries(), before + 1, 'one undo step for both flights');
  await hover(14, 10);
  await page.waitForFunction(() => / · Stairs A \(up only\)$/.test(document.getElementById('plan-cell').textContent));
  await page.click(key('well-way:down'));
  await waitFor('#well-way-says', 'Stairwell A runs down only. Applied to 2 flights.');
  assert.deepEqual((await building()).connections.map((connection) => connection.direction), ['ba', 'ba'], 'down only is down on every flight');
  await page.click(key('well-way:both'));
  await waitFor('#well-way-says', 'Stairwell A runs both ways. Applied to 2 flights.');
  // the Letter field edits the well; a refusal is under it, in words
  await retype(key('well-letter'), 'x'.repeat(9));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const r = document.getElementById('stairwell-letter-field-refusal'); return r && !r.hidden && /at most 8/.test(r.textContent); });
  await page.keyboard.press('Escape');
  await retype(key('well-letter'), 'West');
  await page.keyboard.press('Enter');
  await waitFor('#inspector-properties #inspector-title', 'Stairwell West');
  assert.deepEqual(await wells(), [['A', 'West'], ['B', 'West']]);
  assert.equal(await said(), 'Stairwell A is now Stairwell West on every floor.');
  // a row for each of the three stops, each with Show; Remove from stairwell on all
  const rows = await page.$$eval('#well-stops li', (all) => all.map((li) => [li.querySelector('.bi-row__text').textContent, Array.from(li.querySelectorAll('button')).map((b) => b.textContent)]));
  assert.deepEqual(rows, [['Floor 1', ['Show', 'Remove from stairwell']], ['Floor 2 (this stop)', ['Show', 'Remove from stairwell']], ['Floor 3', ['Show', 'Remove from stairwell']]]);
  // Show goes to that floor's stop
  await page.click(key('show-stop:' + (await building()).floors[0].id));
  await floorIs(page, 'Floor 1');
  await propertiesOf('Floor 2');
  // Remove from stairwell: the middle stop out, the stops either side rejoined
  before = await entries();
  await page.click(key('remove-stop:' + (await building()).floors[1].id));
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 1);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Remove Floor 2 from Stairwell West');
  const joined = (await building()).connections[0];
  assert.equal(joined.well, 'West');
  assert.match(await toastText(), /^Floor 2 is out of Stairwell West/);
  await undo();
  assert.equal((await building()).connections.length, 2);
  // two stops: Disconnect, and no Remove from stairwell
  await propertiesOf('Floor 2');
  await page.click(key('remove-stop:' + (await building()).floors[1].id));
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 1);
  await propertiesOf('Floor 1');
  assert.equal(await exists('#inspector-properties [data-action="remove-stop"]'), false, 'a stairwell of two stops cannot lose a stop');
  assert.equal(await exists(key('disconnect-well')), true);
  await undo();
  // Split into separate stairs: each flight shows its own letter again
  await propertiesOf('Floor 2');
  before = await entries();
  await page.click(key('well-split'));
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.every((connection) => !connection.well));
  assert.equal(await entries(), before + 1);
  assert.equal(await toastText(), 'Stairs A and B are separate again.');
  assert.deepEqual(await wells(), [['A', null], ['B', null]]);
});

test('a plain flight that lands on a stop of a stairwell is shown in the stop\'s properties, with Disconnect as the menu has it', async () => {
  await floors(4, [1, 2, 3, 4], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell } = await import('./engine/stairwells.js');
    const actions = await import('./engine/actions.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
    // a plain flight from the stairwell's top stop on up, as an older file may hold
    const all = store.project.building.floors;
    store.apply(actions.connectStairs, { a: { floorId: all[2].id, cell: 14 + 10 * 40 }, b: { floorId: all[3].id, cell: 14 + 10 * 40 } });
  });
  const plain = (await building()).connections.find((connection) => !connection.well);
  assert.ok(plain, 'no plain flight was made: ' + JSON.stringify(await wells()));
  await propertiesOf('Floor 3');
  assert.equal(await title(), 'Stairwell A');
  const menu = await menuOn(14, 10);
  await page.keyboard.press('Escape');
  assert.ok(menu.includes('Disconnect stairs ' + plain.label), menu.join(' | '));
  assert.equal(await text('#well-others-heading'), 'Other stairs at this stop');
  const rows = await page.$$eval('#well-others li', (all) => all.map((li) => [li.querySelector('.bi-row__text').textContent, Array.from(li.querySelectorAll('button')).map((b) => b.textContent)]));
  assert.deepEqual(rows, [['Stairs ' + plain.label + ': joins Floor 3 and Floor 4', ['Disconnect']]]);
  const before = await entries();
  await page.click(key('disconnect-other:' + plain.id));
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.every((connection) => connection.well));
  assert.equal(await entries(), before + 1);
  assert.equal(await exists('#well-others'), false, 'the row went with the flight');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.key), 'panel-title', 'the focus fell out of the panel');
});

// ---------------------------------------------------------------- connect another floor

test('Connect another floor… adds a stop from a stop: the banner names the stairwell, a floor it already stops on is refused, Escape cancels', async () => {
  await floors(4, [1, 2, 3, 4], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
  });
  await propertiesOf('Floor 1');
  await page.click(key('well-connect'));
  await page.waitForFunction(() => !document.getElementById('connect-banner').hidden);
  const banner = 'Adding a floor to Stairwell A from Floor 1: click its stairs on another floor. Esc cancels.';
  assert.equal(await text('#connect-text'), banner);
  // a floor it stops on already: refused in words, the mode goes on
  await showFloor('Floor 2');
  const before = await entries();
  await clearToast(page);
  await clickAt(14, 10);
  await page.waitForFunction(() => /already stops on Floor 2/.test((document.querySelector('.toast .toast__text') || {}).textContent || ''));
  assert.equal(await entries(), before);
  assert.equal(await page.$eval('#connect-banner', (el) => el.hidden), false);
  // Escape cancels
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  assert.equal(await said(), 'Cancelled. No stairs were connected.');
  assert.equal(await entries(), before);
  // by keys alone: the banner from the menu, the cursor to the stairs on Floor 4, Enter
  await showFloor('Floor 1');
  await page.focus('#plan');
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(14, 10, true));
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]');
  const items = await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
  assert.equal(items[0], 'Connect another floor to Stairwell A…');
  assert.equal(items.includes('Stairwell through floors…'), false, 'a stop of a stairwell is not made a stairwell again');
  assert.ok(items.includes('Remove Floor 1 from Stairwell A') && items.includes('Split Stairwell A into separate stairs'), items.join(' | '));
  await choose('Connect another floor to Stairwell A…');
  assert.equal(await text('#connect-text'), banner);
  await page.evaluate(() => { const tab = Array.from(document.querySelectorAll('.bld-floors__tab')).find((each) => each.textContent.includes('Floor 4')); tab.click(); });
  await floorIs(page, 'Floor 4');
  await still(page);
  await page.focus('#plan');
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(14, 10, true));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 3);
  assert.equal(await entries(), before + 1);
  assert.match((await state(page)).label, /^Add Floor 4 to Stairwell A$/);
  assert.deepEqual((await wells()).map((each) => each[1]), ['A', 'A', 'A']);
  const flight = (await building()).connections[2];
  assert.deepEqual([flight.a.floorId, flight.b.floorId], [(await building()).floors[2].id, (await building()).floors[3].id], 'from the nearest stop, Floor 3');
  assert.equal(await page.$eval('#connect-banner', (el) => el.hidden), true);
});

// ---------------------------------------------------------------- stairwell through floors

const FLOOR_ROWS = [
  'Floor 4: corridor, cannot join here',
  'Floor 3: empty, will become stairs',
  'Floor 2: this floor, stairs',
  'Floor 1: empty, will become stairs',
];

test('Stairwell through floors…, by the pointer: a row a floor saying what is there, the button names what it does, one undo step', async () => {
  await floors(4, [2], { corridor: [4] });
  await showFloor('Floor 2');
  await page.keyboard.press('v');
  const items = await menuOn(14, 10);
  assert.equal(items[0], 'Connect these stairs…');
  assert.ok(items.includes('Stairwell through floors…'), items.join(' | '));
  await choose('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
  assert.match(await text('#stairwell-through-dialog p'), /same row and column on every floor\. These stairs are at row 11, column 15 on Floor 2\./);
  const rows = await page.$$eval('#stairwell-floors label', (all) => all.map((label) => ({ text: label.textContent, checked: label.querySelector('input').checked, disabled: label.querySelector('input').disabled })));
  assert.deepEqual(rows.map((row) => row.text), FLOOR_ROWS);
  assert.deepEqual(rows.map((row) => [row.checked, row.disabled]), [[false, true], [false, false], [true, true], [false, false]]);
  const join = () => page.$eval('#stairwell-through-dialog .btn--primary', (el) => ({ text: el.textContent, disabled: el.getAttribute('aria-disabled') === 'true' }));
  assert.deepEqual(await join(), { text: 'Join floors as a stairwell', disabled: true });
  assert.equal(await text('#stairwell-through-note'), 'Tick at least one more floor: a stairwell is for three or more.');
  assert.deepEqual(await setAside('#stairwell-through-dialog'), SET_ASIDE, 'the button is set aside the app\'s way');
  // a click on it while set aside does nothing
  const unchanged = await entries();
  await page.click('#stairwell-through-dialog .btn--primary');
  assert.equal(await page.evaluate(() => Boolean(document.getElementById('stairwell-through-dialog') && document.getElementById('stairwell-through-dialog').open)), true, 'a set-aside button closed the dialog');
  assert.equal(await entries(), unchanged);
  const ticks = await page.$$('#stairwell-floors input');
  await ticks[1].click();
  assert.equal((await join()).disabled, true, 'two floors are not a stairwell');
  await ticks[3].click();
  assert.deepEqual(await join(), { text: 'Join Floors 1 to 3 as Stairwell A', disabled: false });
  assert.equal(await page.$eval('#stairwell-through-dialog .btn--primary', (el) => el.hasAttribute('aria-describedby')), false, 'the reason went with it');
  const before = await entries();
  await page.click('#stairwell-through-dialog .btn--primary');
  await dialogGone('stairwell-through-dialog');
  assert.equal(await entries(), before + 1, 'one undo step');
  const now = await building();
  assert.deepEqual(now.connections.map((connection) => connection.well), ['A', 'A']);
  assert.equal(now.floors[0].cells[CELL], 'S', 'Floor 1 had stairs drawn');
  assert.equal(now.floors[2].cells[CELL], 'S', 'Floor 3 had stairs drawn');
  assert.equal(now.floors[3].cells[CELL], '#', 'Floor 4 was left as it was');
  // the floors as the button named them, "Floors 1 to 3"
  assert.match(await toastText(), /^Stairwell A now runs through Floors 1 to 3 at row 11, column 15 \(2 flights made\)\. Stairs were drawn on Floor 1 and Floor 3\.$/);
  await undo();
  assert.equal((await building()).connections.length, 0);
  assert.equal((await building()).floors[0].cells[CELL], '.', 'the stairs drawn are taken back with it');
});

test('Stairwell through floors…, by keys alone: Shift+F10, Space on each tick, Tab to the button, Enter; Escape calls it off and the focus goes back to the plan', async () => {
  await floors(4, [2], { corridor: [4] });
  await showFloor('Floor 2');
  await page.focus('#plan');
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(14, 10, true));
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]');
  await choose('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
  assert.equal(await page.evaluate(() => document.activeElement.closest('li') && document.activeElement.closest('label').textContent), 'Floor 3: empty, will become stairs', 'the first floor that can be ticked has the focus');
  // Escape: nothing changes, the plan has the focus
  const before = await entries();
  await page.keyboard.press('Escape');
  await dialogGone('stairwell-through-dialog');
  assert.equal(await entries(), before);
  assert.equal((await state(page)).focus, 'plan');
  // again, by keys
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]');
  await choose('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
  await page.keyboard.press('Space'); // Floor 3
  await page.keyboard.press('Tab'); // Floor 1 (Floor 2 is fixed, Floor 4 cannot join)
  assert.equal(await page.evaluate(() => document.activeElement.closest('label').textContent), 'Floor 1: empty, will become stairs');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Join Floors 1 to 3 as Stairwell A');
  await page.keyboard.press('Enter');
  await dialogGone('stairwell-through-dialog');
  assert.deepEqual((await building()).connections.map((connection) => connection.well), ['A', 'A']);
  assert.equal(await entries(), before + 1);
});

// Stairs A and B elsewhere (columns 21 and 23 of row 11, Floor 1 to Floor 2),
// then Stairs C at the stairs' place from Floor 1 to Floor 2; with `d`, Stairs D
// on from Floor 2 to Floor 3 at the same place. (The W7 walk-through: the well
// became F, Floor 2's row said only "stairs" and started unticked.)
async function stairsC(d) {
  await floors(4, d ? [1, 2, 3] : [1, 2]);
  await page.evaluate(async (d) => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const all = () => store.project.building.floors;
    for (const x of [20, 22]) {
      for (const n of [1, 2]) store.apply(actions.placeStairs, { floorId: all()[n - 1].id, cells: [x + 10 * 40] });
      store.apply(actions.connectStairs, { a: { floorId: all()[0].id, cell: x + 10 * 40 }, b: { floorId: all()[1].id, cell: x + 10 * 40 } });
    }
    store.apply(actions.connectStairs, { a: { floorId: all()[0].id, cell: 14 + 10 * 40 }, b: { floorId: all()[1].id, cell: 14 + 10 * 40 } });
    if (d) store.apply(actions.connectStairs, { a: { floorId: all()[1].id, cell: 14 + 10 * 40 }, b: { floorId: all()[2].id, cell: 14 + 10 * 40 } });
  }, Boolean(d));
  assert.deepEqual((await building()).connections.map((connection) => connection.label), d ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C']);
  await showFloor('Floor 1');
  await page.keyboard.press('v');
  await menuOn(14, 10);
  await choose('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
}

const throughRows = () => page.$$eval('#stairwell-floors label', (all) => all.map((label) => [label.textContent, label.querySelector('input').checked, label.querySelector('input').disabled]));
const throughJoin = () => page.$eval('#stairwell-through-dialog .btn--primary', (el) => ({ text: el.textContent, disabled: el.getAttribute('aria-disabled') === 'true' }));

test('Stairwell through floors… from Stairs C: Floor 2 is "Stairs C, joined", ticked and fixed; one more floor is enough; the well is Stairwell C; the ticks are the app\'s teal', async () => {
  await stairsC(false);
  assert.deepEqual(await throughRows(), [
    ['Floor 4: empty, will become stairs', false, false],
    ['Floor 3: empty, will become stairs', false, false],
    ['Floor 2: Stairs C, joined', true, true],
    ['Floor 1: this floor, stairs', true, true],
  ]);
  assert.deepEqual(await throughJoin(), { text: 'Join floors as a stairwell', disabled: true });
  // the ticks in the app's accent, not the browser's blue
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.getElementById('stairwell-through-dialog').append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { accent, ticks: Array.from(document.querySelectorAll('#stairwell-floors input'), (box) => getComputedStyle(box).accentColor) };
  });
  assert.notEqual(colours.accent, '');
  assert.deepEqual(colours.ticks, colours.ticks.map(() => colours.accent), 'every tick is drawn in --accent');
  const ticks = await page.$$('#stairwell-floors input');
  await ticks[1].click(); // Floor 3
  assert.deepEqual(await throughJoin(), { text: 'Join Floors 1 to 3 as Stairwell C', disabled: false });
  assert.equal(await text('#stairwell-through-letters'), 'Stairs C keeps its letter on every floor, map, poster and set of directions.');
  const before = await entries();
  await page.click('#stairwell-through-dialog .btn--primary');
  await dialogGone('stairwell-through-dialog');
  assert.equal(await entries(), before + 1, 'one undo step');
  const now = await building();
  assert.deepEqual(now.connections.map((connection) => [connection.label, connection.well || null]), [['A', null], ['B', null], ['C', 'C'], ['D', 'C']]);
  assert.match(await toastText(), /^Stairwell C now runs through Floors 1 to 3 at row 11, column 15 \(1 flight made, 1 kept\)\. Stairs were drawn on Floor 3\.$/);
});

test('Stairwell through floors… from Stairs C with Stairs D above it: both floors joined and fixed, and the dialog says D will be called C', async () => {
  await stairsC(true);
  assert.deepEqual(await throughRows(), [
    ['Floor 4: empty, will become stairs', false, false],
    ['Floor 3: Stairs D, joined', true, true],
    ['Floor 2: Stairs C, joined', true, true],
    ['Floor 1: this floor, stairs', true, true],
  ]);
  assert.deepEqual(await throughJoin(), { text: 'Join Floors 1 to 3 as Stairwell C', disabled: false });
  assert.equal(await text('#stairwell-through-letters'), 'Stairs D will be called C on every floor, map, poster and set of directions.');
  await page.click('#stairwell-through-dialog .btn--primary');
  await dialogGone('stairwell-through-dialog');
  assert.deepEqual((await building()).connections.map((connection) => connection.well || null), [null, null, 'C', 'C']);
  assert.match(await toastText(), / It reads C on every floor; D is not shown any more\.$/);
});

// ---------------------------------------------------------------- the Floor tab

test('the Floor tab lists a stairwell as one row with its letter, floors and way; its Letter field and chips change the whole well', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
    document.querySelector('.bld').editor.inspector.showTab('floor');
  });
  await showFloor('Floor 2');
  await page.waitForSelector('#inspector-floor [data-well]');
  assert.equal(await page.$$eval('#inspector-floor [data-well]', (all) => all.length), 1, 'two flights meet on Floor 2 and are one row');
  assert.equal(await exists('#inspector-floor [data-connection]'), false);
  const summary = () => text('#inspector-floor [data-part="well-summary"]');
  assert.equal(await summary(), 'Stairwell A · Floor 1 to Floor 3 · both ways');
  const before = await entries();
  // refused: the way there was is ticked again
  await refuseNext();
  await page.click('#inspector-floor [data-well] .bi-way__input[value="up"]');
  assert.deepEqual(await ticked('#inspector-floor [data-well]'), ['both'], 'a refused way left the wrong chip ticked');
  assert.equal(await entries(), before);
  await page.click('#inspector-floor [data-well] .bi-way__input[value="up"]');
  await waitFor('#inspector-floor [data-part="well-summary"]', 'Stairwell A · Floor 1 to Floor 3 · up only');
  assert.equal(await entries(), before + 1);
  assert.deepEqual((await building()).connections.map((connection) => connection.direction), ['ab', 'ab']);
  await retype('#inspector-floor [data-well] .field__input', 'East');
  await page.keyboard.press('Enter');
  await waitFor('#inspector-floor [data-part="well-summary"]', 'Stairwell East · Floor 1 to Floor 3 · up only');
  assert.deepEqual(await wells(), [['A', 'East'], ['B', 'East']]);
  // the row is the same row after the rename: the focus stays in its Letter field
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    return { key: el && el.dataset ? el.dataset.key || null : null, row: el && el.closest('li') ? el.closest('li').dataset.well || el.closest('li').dataset.connection || null : null, body: el === document.body };
  });
  const firstFlight = (await building()).connections[0].id;
  assert.deepEqual(await focused(), { key: 'well:well:' + firstFlight, row: 'well:' + firstFlight, body: false }, 'the rename lost the focus');
  // and a second rename from the same row is of the well as it is named now
  await retype('#inspector-floor [data-well] .field__input', 'Ea');
  await page.keyboard.press('Enter');
  await waitFor('#inspector-floor [data-part="well-summary"]', 'Stairwell Ea · Floor 1 to Floor 3 · up only');
  assert.equal((await focused()).key, 'well:well:' + firstFlight);
  await retype('#inspector-floor [data-well] .field__input', 'East');
  await page.keyboard.press('Enter');
  await waitFor('#inspector-floor [data-part="well-summary"]', 'Stairwell East · Floor 1 to Floor 3 · up only');
  // a floor with only one stop of it: the same row
  await showFloor('Floor 1');
  await page.waitForSelector('#inspector-floor [data-well]');
  assert.equal(await summary(), 'Stairwell East · Floor 1 to Floor 3 · up only');
  await page.click('#inspector-floor [data-well] button[data-action="split"]');
  await page.waitForFunction(() => !document.querySelector('#inspector-floor [data-well]'));
  assert.equal(await page.$$eval('#inspector-floor [data-connection]', (all) => all.length), 1, 'on Floor 1 the flight is its own row again');
  assert.equal(await toastText(), 'Stairs A and B are separate again.');
  // the row that was pressed is gone: its flight's own row has the focus
  assert.deepEqual(await focused(), { key: 'show-connection:' + firstFlight, row: firstFlight, body: false }, 'Split dropped the focus');
  // on Floor 2, two flights' rows: the focus to the first of them
  await undo();
  await showFloor('Floor 2');
  await page.waitForSelector('#inspector-floor [data-well]');
  await page.click('#inspector-floor [data-well] button[data-action="split"]');
  await page.waitForFunction(() => !document.querySelector('#inspector-floor [data-well]'));
  assert.deepEqual(await focused(), { key: 'show-connection:' + firstFlight, row: firstFlight, body: false }, 'Split dropped the focus on Floor 2');
});

// ---------------------------------------------------------------- one letter on every badge

test('one letter on every badge: the cell\'s words, the printed plan, and a one-way mark only where every flight at the stop agrees', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell, setStairwellDirection } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
    store.apply(setStairwellDirection, { well: 'A', direction: 'up' });
  });
  const printed = () => page.evaluate(async () => {
    const { planSvg } = await import('./ui/prints/plan-svg.js');
    const { store } = globalThis.sv2;
    const project = store.project;
    const floor = project.building.floors[1];
    const picture = planSvg(project, floor, {});
    const letters = Array.from(picture.svg.matchAll(/<text[^>]*class="plan__letter"[^>]*>([^<]*)<\/text>/g), (match) => match[1]);
    return { letters, ways: (picture.svg.match(/plan__oneway/g) || []).length, caption: picture.letters };
  });
  let shown = await printed();
  assert.deepEqual(shown.letters, ['A'], 'one letter at the middle stop, not "A B" or "A, A"');
  assert.deepEqual(shown.caption, ['A']);
  assert.equal(shown.ways, 1, 'both flights go up: one mark');
  // the canvas: the pill at the middle stop holds one letter and one mark
  await showFloor('Floor 2');
  let screen = await drawnAt(14, 10);
  assert.deepEqual(screen.texts.map((each) => each.text), ['A'], 'the canvas wrote the middle stop\'s letter twice: ' + JSON.stringify(screen));
  assert.equal(screen.marks.length, 1, 'both flights go up: one mark on the canvas');
  // one flight both ways: no mark at the middle stop
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.setConnection, { connectionId: store.project.building.connections[1].id, direction: 'both' });
  });
  shown = await printed();
  assert.equal(shown.ways, 0, 'the flights differ at the middle stop: no mark');
  screen = await drawnAt(14, 10);
  assert.deepEqual(screen.texts.map((each) => each.text), ['A']);
  assert.equal(screen.marks.length, 0, 'the flights differ at the middle stop: no mark on the canvas');
  // the cell's words
  await showFloor('Floor 2');
  await hover(14, 10);
  // the badge has no mark, so the words name each flight's way (ARCHITECTURE 22.17)
  const flightWords = 'Stairs A (Floor 1 to Floor 2 up only; Floor 2 to Floor 3 both ways)';
  await page.waitForFunction((wanted) => document.getElementById('plan-cell').textContent.endsWith(' · ' + wanted), {}, flightWords);
  assert.doesNotMatch((await state(page)).cell, /Stairs A, A/);
  const words = await page.evaluate(async () => {
    const { stairwellFacts } = await import('./ui/building/stairwell.js');
    const { stairsWords } = await import('./ui/building/index.js');
    const { store } = globalThis.sv2;
    const at = store.project.building.connections;
    return { facts: stairwellFacts(store.project, 'A').wayWords, words: stairsWords(store.project, at) };
  });
  assert.equal(words.facts, 'the flights differ');
  assert.equal(words.words, flightWords, 'one letter, and each flight\'s way where the flights differ');
});

// What the canvas was told for one cell, read from the calls the renderer
// makes on it while it draws: the texts written in the cell (each with its x)
// and the one-way marks (a stroke of three points with round joins, which only
// a pill's mark has; the stairs glyph's chevron is mitred), each by the x of
// its point. The plan is drawn at twice the zoom, where a pill holds a mark.
function drawnAt(x, y) {
  return page.evaluate((cx, cy) => {
    const editor = document.querySelector('.bld').editor;
    editor.view.zoom = 2;
    editor.view.x = 120 - (cx - 2) * editor.view.size;
    editor.view.y = 80 - (cy - 2) * editor.view.size;
    const g = editor.canvas.getContext('2d');
    const texts = [];
    const marks = [];
    let path = [];
    const spy = {
      fillText: (text, tx, ty) => texts.push({ text: String(text), x: tx, y: ty }),
      beginPath: () => { path = []; },
      moveTo: (px, py) => path.push([px, py]),
      lineTo: (px, py) => path.push([px, py]),
      stroke: () => { if (path.length === 3 && g.lineJoin === 'round') marks.push({ x: path[1][0], y: path[1][1] }); },
    };
    for (const [name, record] of Object.entries(spy)) {
      const real = Object.getPrototypeOf(g)[name];
      g[name] = function (...args) { record(...args); return real.apply(g, args); };
    }
    try {
      editor.drawNow();
    } finally {
      for (const name of Object.keys(spy)) delete g[name];
    }
    const at = editor.view.toScreen(cx, cy);
    const size = editor.view.size;
    const inCell = (each) => each.x >= at.x && each.x <= at.x + size && each.y >= at.y && each.y <= at.y + size;
    return { texts: texts.filter(inCell).map((each) => ({ text: each.text, x: Math.round(each.x) })), marks: marks.filter(inCell).map((each) => Math.round(each.x)), size };
  }, x, y);
}

test('the one-way rule is a letter\'s, on the screen and on paper: plain A up only and plain B both ways at one stop mark A alone', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    // A runs from Floor 1 (its a end) to Floor 2: up only. B stays both ways.
    store.apply(actions.setConnection, { connectionId: store.project.building.connections[0].id, direction: 'ab' });
  });
  await showFloor('Floor 2');
  // the screen: one pill, A with its mark straight after it, B with none
  const screen = await drawnAt(14, 10);
  assert.deepEqual(screen.texts.map((each) => each.text), ['A', 'B'], 'the pill\'s letters: ' + JSON.stringify(screen));
  assert.equal(screen.marks.length, 1, 'one mark at the stop: ' + JSON.stringify(screen));
  const [a, b] = screen.texts;
  assert.ok(screen.marks[0] > a.x && screen.marks[0] < b.x, 'the mark is not A\'s: ' + JSON.stringify(screen));
  // paper: the same, a mark after A and none by B
  const paper = await page.evaluate(async () => {
    const { planSvg } = await import('./ui/prints/plan-svg.js');
    const project = globalThis.sv2.store.project;
    const svg = planSvg(project, project.building.floors[1], {}).svg;
    return { a: svg.indexOf('>A</text>'), b: svg.indexOf('>B</text>'), marks: Array.from(svg.matchAll(/plan__oneway/g), (match) => match.index) };
  });
  assert.equal(paper.marks.length, 1, 'one mark on the printed plan: ' + JSON.stringify(paper));
  assert.ok(paper.a < paper.marks[0] && paper.marks[0] < paper.b, 'the printed mark is not A\'s: ' + JSON.stringify(paper));
  // and the words, letter by letter
  const words = await page.evaluate(async () => {
    const { stairsWords } = await import('./ui/building/index.js');
    const { store } = globalThis.sv2;
    return stairsWords(store.project, store.project.building.connections);
  });
  assert.equal(words, 'Stairs A (up only), B');
  // both one way, the same way: a mark after each letter, on both
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.setConnection, { connectionId: store.project.building.connections[1].id, direction: 'ab' });
  });
  const both = await drawnAt(14, 10);
  assert.equal(both.marks.length, 2, 'a mark after each letter: ' + JSON.stringify(both));
});

// ---------------------------------------------------------------- the pills

// The pill under a stop's glyph, measured from the pixels of the canvas: the
// bottom edge's distance from the cell's bottom and the pill's height, found
// by walking up the cell's middle columns from the cell's foot while a row has
// any ink in it, then stopping at the first clear row (the gap above the pill).
function pillOf(x, y) {
  return page.evaluate((cx, cy) => {
    const editor = document.querySelector('.bld').editor;
    editor.drawNow();
    const ratio = editor.canvas.width / editor.view.width;
    const size = editor.view.size;
    const left = editor.view.toScreen(cx, cy);
    const w = Math.round(size);
    const context = editor.canvas.getContext('2d');
    const read = (px, py) => context.getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data;
    const dark = (px, py) => {
      const d = read(px, py);
      return (0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2]) < 150;
    };
    // the pill's outline is one unbroken curve, so every row from its foot to its
    // top has ink at an edge of it; the glyph above is parted from it by a clear row
    const rowHasInk = (py) => {
      for (let px = left.x + 1; px < left.x + w - 1; px += 1 / ratio) if (dark(px, py)) return true;
      return false;
    };
    let bottom = null;
    let top = null;
    for (let py = left.y + w - 0.5; py >= left.y; py -= 1 / ratio) {
      const ink = rowHasInk(py);
      if (bottom === null && ink) bottom = py;
      if (bottom !== null) {
        if (!ink) break;
        top = py;
      }
    }
    return bottom === null ? null : { size: w, foot: Math.round((left.y + w - bottom) * 10) / 10, height: Math.round((bottom - top) * 10) / 10 };
  }, x, y);
}

test('the elevator\'s pill and the stairs\' pill are the same height and stand at the same place at three zooms (the W5 leftover)', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const floorsNow = () => store.project.building.floors;
    for (const floor of floorsNow()) store.apply(actions.placeLift, { floorId: floor.id, cells: [8 + 10 * 40] });
    store.apply(actions.connectStairs, { a: { floorId: floorsNow()[0].id, cell: 8 + 10 * 40 }, b: { floorId: floorsNow()[1].id, cell: 8 + 10 * 40 } });
    // one letter at the middle stop, so the stairs' pill holds a single letter as the elevator's does
    const { makeStairwell } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
  });
  await showFloor('Floor 2');
  for (const zoom of [0.83, 1, 2]) {
    await page.evaluate((z) => {
      const editor = document.querySelector('.bld').editor;
      editor.view.zoom = z;
      editor.view.x = 120 - 8 * editor.view.size;
      editor.view.y = 80 - 10 * editor.view.size;
      editor.drawNow();
    }, zoom);
    const stairs = await pillOf(14, 10);
    const lift = await pillOf(8, 10);
    assert.ok(stairs && lift, 'both stops drew a pill at ' + zoom + ': ' + JSON.stringify([stairs, lift]));
    assert.ok(Math.abs(stairs.height - lift.height) <= 1, 'the pills differ in height at ' + zoom + ': ' + JSON.stringify([stairs, lift]));
    assert.ok(Math.abs(stairs.foot - lift.foot) <= 1, 'the pills stand at different places at ' + zoom + ': ' + JSON.stringify([stairs, lift]));
  }
});

// ---------------------------------------------------------------- 844 by 390, the footer is pinned

test('at 844 by 390 the footers of both dialogs are pinned: the buttons are on screen and the body scrolls', async () => {
  await session.close();
  session = await openPlanner({ theme: 'light', width: 844, height: 390, mobile: true });
  page = session.page;
  await planReady(page);
  await floors(9, [2], {});
  await showFloor('Floor 2');
  await page.evaluate(async () => {
    const editor = document.querySelector('.bld').editor;
    const { openStairwellThrough } = await import('./ui/building/stairwell.js');
    openStairwellThrough(editor, { floorId: editor.floor.id, cell: 14 + 10 * 40 }, null);
  });
  await dialogOpen('stairwell-through-dialog');
  const shown = await page.evaluate(() => {
    const dialog = document.getElementById('stairwell-through-dialog');
    const buttons = dialog.querySelector('.dialog__buttons').getBoundingClientRect();
    const body = dialog.querySelector('.dialog__body');
    return { bottom: buttons.bottom, height: window.innerHeight, scrolls: body.scrollHeight > body.clientHeight + 1, sideways: document.documentElement.scrollWidth > window.innerWidth, box: dialog.getBoundingClientRect().bottom };
  });
  assert.ok(shown.bottom <= shown.height, 'the buttons are below the screen: ' + JSON.stringify(shown));
  assert.equal(shown.scrolls, true, 'nine floors fit without scrolling, so this proves nothing');
  assert.equal(shown.sideways, false);
  await page.keyboard.press('Escape');
  await dialogGone('stairwell-through-dialog');
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const editor = document.querySelector('.bld').editor;
    const { openMakeStairwell } = await import('./ui/building/stairwell.js');
    openMakeStairwell(editor, globalThis.sv2.store.project.building.connections[0].id, null);
  });
  await dialogOpen('stairwell-make-dialog');
  const make = await page.evaluate(() => {
    const buttons = document.querySelector('#stairwell-make-dialog .dialog__buttons').getBoundingClientRect();
    return { bottom: buttons.bottom, height: window.innerHeight };
  });
  assert.ok(make.bottom <= make.height, 'the Make one stairwell buttons are below the screen: ' + JSON.stringify(make));
  await page.keyboard.press('Escape');
  await dialogGone('stairwell-make-dialog');
});

// ---------------------------------------------------------------- 390 px, with a finger

// A finger at 390 px: touches sent to the page as a phone's are (CDP touch
// events), on an element's middle once it is scrolled into view, or on a cell.
async function tapOn(box) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(box.x), y: Math.round(box.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const tap = async (x, y) => tapOn(await point(page, x, y));
async function tapElement(selector) {
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.getBoundingClientRect().height > 0; }, {}, selector);
  await tapOn(await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }));
}
// The cell's menu, as a long press opens it, and one of its items by a tap: the item's height too.
async function tapMenu(label) {
  await page.evaluate(async () => {
    const editor = document.querySelector('.bld').editor;
    const { openCellMenu } = await import('./ui/building/menu.js');
    openCellMenu(editor, 14 + 10 * 40, editor.canvas);
  });
  await page.waitForSelector('.menu[role="menu"]');
  const item = await page.evaluate((wanted) => {
    const found = Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((each) => each.textContent.trim() === wanted);
    if (!found) return { missing: Array.from(document.querySelectorAll('.menu [role="menuitem"]'), (each) => each.textContent.trim()) };
    const box = found.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, height: box.height };
  }, label);
  assert.ok(!item.missing, 'the menu has no "' + label + '": ' + (item.missing || []).join(' | '));
  // a finger's size, to the pixel the layout rounds to
  assert.ok(Math.round(item.height) >= 44, 'the menu item "' + label + '" is ' + item.height + ' px tall');
  await tapOn(item);
  await page.waitForFunction(() => !document.querySelector('.menu[role="menu"]'));
}
// The cell's menu by keys: Shift+F10 on the plan, ArrowDown to the item, Enter.
async function keyMenu(label) {
  await page.focus('#plan');
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(14, 10, true));
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]', { timeout: 5000 }).catch(async () => {
    const where = await page.evaluate(() => ({ active: document.activeElement && (document.activeElement.id || document.activeElement.className), dialogs: Array.from(document.querySelectorAll('dialog[open]'), (d) => d.id) }));
    throw new Error('no menu: ' + JSON.stringify(where));
  });
  for (let tries = 0; tries < 20; tries += 1) {
    if (await page.evaluate((wanted) => document.activeElement && document.activeElement.textContent.trim() === wanted, label)) break;
    await page.keyboard.press('ArrowDown');
  }
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), label, 'the keys did not reach "' + label + '"');
  await page.keyboard.press('Enter');
}
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// the stair's Properties at 390 px, by a tap on the menu's item
async function phoneProperties(floorName) {
  await showFloor(floorName);
  await tapMenu('Properties of this cell');
  await page.waitForFunction(() => { const t = document.querySelector('#inspector-properties #inspector-title'); return Boolean(t) && t.textContent !== '' && t.getBoundingClientRect().height > 0; });
}

test('at 390 px by keys alone: Stairwell through floors… and Make one stairwell, each from the menu, Space, Tab and Enter', async () => {
  // first of the 390 px cases: the keys before any touch, since the plan takes a
  // menu key as a finger's long press once a touch was the last pointer (input.js)
  await session.close();
  session = await openPlanner({ theme: 'light', width: 390, height: 844, mobile: true });
  page = session.page;
  cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
  if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  }
  await planReady(page);
  await floors(4, [2], { corridor: [4] });
  await showFloor('Floor 2');
  await keyMenu('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
  assert.equal(await page.evaluate(() => document.activeElement.closest('label').textContent), 'Floor 3: empty, will become stairs');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Join Floors 1 to 3 as Stairwell A');
  // the button is on screen, at the foot of the dialog
  assert.equal(await page.evaluate(() => { const box = document.activeElement.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }), true);
  await page.keyboard.press('Enter');
  await dialogGone('stairwell-through-dialog');
  assert.deepEqual((await wells()).map((each) => each[1]), ['A', 'A']);
  assert.equal((await state(page)).focus, 'plan', 'the focus went back to the plan');
  // Make one stairwell, by keys: Properties from the menu, Tab to the button, Enter, a letter, Enter
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await showFloor('Floor 2');
  await keyMenu('Properties of this cell');
  await page.waitForFunction(() => { const t = document.querySelector('#inspector-properties #inspector-title'); return Boolean(t) && t.textContent === 'Stairs A and B'; });
  await page.focus(key('stairs-connect'));
  for (let tries = 0; tries < 10; tries += 1) {
    if (await page.evaluate(() => document.activeElement.dataset.key === 'well-make')) break;
    await page.keyboard.press('Tab');
  }
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'well-make', 'Tab did not reach Make one stairwell');
  await page.keyboard.press('Enter');
  await dialogOpen('stairwell-make-dialog');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'stairwell-letter');
  await page.keyboard.type('North');
  await waitFor('#stairwell-note', '');
  await page.keyboard.press('Enter');
  await dialogGone('stairwell-make-dialog');
  assert.deepEqual(await wells(), [['A', 'North'], ['B', 'North']]);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement) && document.activeElement !== document.body), true, 'the focus fell to the page');
});

test('at 390 px: Stairwell through floors… by a finger, rows and buttons 44 px, no sideways scroll', async () => {
  await floors(4, [2, 4], { corridor: [] });
  await showFloor('Floor 2');
  await tapMenu('Stairwell through floors…');
  await dialogOpen('stairwell-through-dialog');
  const sizes = await page.$$eval('#stairwell-through-dialog label, #stairwell-through-dialog .dialog__buttons button', (all) => all.map((each) => Math.round(each.getBoundingClientRect().height)));
  assert.deepEqual(sizes.filter((height) => height < 44), [], 'a row or button under 44 px: ' + sizes);
  assert.equal(await noSideways(), true, 'the dialog scrolls sideways');
  // tick Floor 1 and Floor 3 with a finger; Floor 4's row is a stairs cell and may be ticked too
  const ticks = await page.$$eval('#stairwell-floors input', (all) => all.map((input) => ({ floor: input.dataset.floor, disabled: input.disabled })));
  assert.equal(ticks.filter((tick) => !tick.disabled).length, 3);
  for (const tick of ticks.filter((each) => !each.disabled)) await tapElement('#stairwell-floors input[data-floor="' + tick.floor + '"]');
  await page.waitForFunction(() => /^Join Floors 1 to 4 as Stairwell A$/.test(document.querySelector('#stairwell-through-dialog .btn--primary').textContent));
  await tapElement('#stairwell-through-dialog .btn--primary');
  await dialogGone('stairwell-through-dialog');
  assert.deepEqual((await wells()).map((each) => each[1]), ['A', 'A', 'A']);
  assert.equal((await building()).floors.map((floor) => floor.cells[CELL]).join(''), 'SSSS');
});

test('at 390 px by a finger: Connect another floor… and a tap on the stairs, the menu\'s Remove, Split and Disconnect', async () => {
  await floors(4, [1, 2, 3, 4], { flights: [[1, 2], [2, 3]] });
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { makeStairwell } = await import('./engine/stairwells.js');
    store.apply(makeStairwell, { connectionId: store.project.building.connections[0].id });
  });
  // Connect another floor…: from the menu on Floor 3, then the tab and the stairs on Floor 4, each by a tap
  await showFloor('Floor 3');
  let before = await entries();
  await tapMenu('Connect another floor to Stairwell A…');
  await page.waitForFunction(() => !document.getElementById('connect-banner').hidden);
  assert.equal(await text('#connect-text'), 'Adding a floor to Stairwell A from Floor 3: click its stairs on another floor. Esc cancels.');
  assert.equal(await noSideways(), true, 'the banner scrolls sideways');
  const tab = await page.evaluate(() => {
    const found = Array.from(document.querySelectorAll('.bld-floors__tab')).find((each) => each.textContent.includes('Floor 4'));
    found.scrollIntoView({ block: 'nearest', inline: 'center' });
    const box = found.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await tapOn(tab);
  await floorIs(page, 'Floor 4');
  await still(page);
  await wholeFloor(page);
  await tap(14, 10);
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 3);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Add Floor 4 to Stairwell A');
  assert.deepEqual((await wells()).map((each) => each[1]), ['A', 'A', 'A']);
  assert.equal(await page.$eval('#connect-banner', (el) => el.hidden), true);
  // the menu's Remove Floor 2 from Stairwell A, by a tap
  await showFloor('Floor 2');
  before = await entries();
  await tapMenu('Remove Floor 2 from Stairwell A');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 2);
  assert.equal((await state(page)).label, 'Remove Floor 2 from Stairwell A');
  assert.equal(await entries(), before + 1);
  await undo();
  // Split, by a tap
  await tapMenu('Split Stairwell A into separate stairs');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.every((connection) => !connection.well));
  assert.equal(await toastText(), 'Stairs A, B and C are separate again.');
  await undo();
  // a stairwell of two stops: the menu's Disconnect Stairwell A, by a tap
  await showFloor('Floor 3');
  await tapMenu('Remove Floor 3 from Stairwell A');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 2);
  await showFloor('Floor 4');
  await tapMenu('Remove Floor 4 from Stairwell A');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 1);
  await showFloor('Floor 2');
  before = await entries();
  await tapMenu('Disconnect Stairwell A');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 0);
  assert.equal(await entries(), before + 1);
  assert.equal(await noSideways(), true);
});

test('at 390 px by a finger: the stair\'s properties, Make one stairwell and its dialog, the stairwell\'s Disconnect', async () => {
  await floors(3, [1, 2, 3], { flights: [[1, 2], [2, 3]] });
  await phoneProperties('Floor 2');
  assert.equal(await title(), 'Stairs A and B');
  assert.ok(Math.round(await page.$eval(key('well-make'), (el) => el.getBoundingClientRect().height)) >= 44, 'Make one stairwell is under 44 px');
  await tapElement(key('well-make'));
  await dialogOpen('stairwell-make-dialog');
  const sizes = await page.$$eval('#stairwell-make-dialog .dialog__buttons button, #stairwell-letter', (all) => all.map((each) => Math.round(each.getBoundingClientRect().height)));
  assert.deepEqual(sizes.filter((height) => height < 44), [], 'a field or button under 44 px: ' + sizes);
  assert.equal(await noSideways(), true, 'the dialog scrolls sideways');
  const before = await entries();
  await tapElement('#stairwell-make-dialog .btn--primary');
  await dialogGone('stairwell-make-dialog');
  assert.deepEqual(await wells(), [['A', 'A'], ['B', 'A']]);
  assert.equal(await entries(), before + 1);
  await waitFor('#inspector-properties #inspector-title', 'Stairwell A');
  // two stops: the stairwell's own Disconnect, by a tap
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const { removeStairwellStop } = await import('./engine/stairwells.js');
    store.apply(removeStairwellStop, { well: 'A', floorId: store.project.building.floors[2].id });
  });
  await phoneProperties('Floor 2');
  assert.equal(await title(), 'Stairwell A');
  await tapElement(key('disconnect-well'));
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 0);
  assert.equal(await entries(), before + 3);
});
