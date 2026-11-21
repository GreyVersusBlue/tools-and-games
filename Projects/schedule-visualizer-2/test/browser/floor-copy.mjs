// Duplicate a floor in the planner, in a real browser: node test/browser/floor-copy.mjs
//
// The floor menu (the ⋯ button beside the selected tab, right-click on a tab,
// the Menu key and Shift+F10) and Duplicate floor…'s dialog (SPEC 4.1's wish,
// ARCHITECTURE 22.8 and 22.17, DESIGN 16.2, 16.11 and 16.12 items 1 and 10):
// the sentences before anything changes, the Name field, the room-number rows,
// the join sentence naming no letter change, what is not copied, the copy on top
// with its toast and its one undo step, a name refused in words, Escape and the
// focus coming back, the keyboard path, and a phone at 390 px and 844 by 390.
// Every wait is on a state the page sets (the dialog open, the entry count, the
// plan at rest), never on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, still } from './harness.mjs';
import { startEmpty, planReady, state, floorIs, clearToast } from './draw-pointer.mjs';

let session;
let page;
let phone = null;

const CELL = 14 + 10 * 40;
const text = (target, selector) => target.$eval(selector, (el) => el.textContent);
const exists = (target, selector) => target.$(selector).then((found) => found !== null);
const building = (target) => target.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.building)));

// Floors 1 to 3, a corridor on row 10, rooms 201, 202 and 214B on Floor 2, and
// one flight, Stairs A, between Floors 2 and 3 at CELL. Floor 2 is on screen.
async function build(target, options) {
  const opts = options || {};
  await startEmpty(target);
  await target.evaluate(async ({ numbers, flight }) => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.addFloor, {});
    store.apply(actions.addFloor, {});
    const floors = () => store.project.building.floors;
    for (const floor of floors()) store.apply(actions.paintCorridor, { floorId: floor.id, from: 5 + 10 * 40, to: 12 + 10 * 40 });
    const second = floors()[1];
    numbers.forEach((number, n) => store.apply(actions.placeRoom, { floorId: second.id, rect: { x: 5 + n * 3, y: 8, w: 2, h: 1 }, number }));
    for (const n of flight ? [2, 3] : []) store.apply(actions.placeStairs, { floorId: floors()[n - 1].id, cells: [14 + 10 * 40] });
    if (flight) store.apply(actions.connectStairs, { a: { floorId: floors()[1].id, cell: 14 + 10 * 40 }, b: { floorId: floors()[2].id, cell: 14 + 10 * 40 } });
  }, { numbers: opts.numbers || ['201', '202', '214B'], flight: opts.flight !== false });
  await showFloor(target, 'Floor 2');
}

async function showFloor(target, name) {
  await target.evaluate((wanted) => {
    Array.from(document.querySelectorAll('.bld-floors__tab')).find((each) => each.textContent.includes(wanted)).click();
  }, name);
  await floorIs(target, name);
  await still(target);
}

const dialogOpen = (target) => target.waitForFunction(() => document.querySelector('dialog#duplicate-floor-dialog[open]') !== null);
const dialogGone = (target) => target.waitForFunction(() => document.querySelector('dialog#duplicate-floor-dialog') === null);
const menuOpen = (target) => target.waitForFunction(() => document.querySelector('.menu[role="menu"]') !== null);
const menuItems = (target) => target.$$eval('.menu [role^="menuitem"]', (items) => items.map((item) => item.textContent.replace('●', '').trim()));
const focusLabel = (target) => target.evaluate(() => { const el = document.activeElement; return el ? (el.id || el.textContent.trim()) : ''; });

async function openDialogByButton(target) {
  await target.click('#floor-actions');
  await menuOpen(target);
  await target.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Duplicate floor')).click());
  await dialogOpen(target);
}

async function setName(target, wanted) {
  await target.focus('#duplicate-name');
  await target.$eval('#duplicate-name', (el) => el.select());
  if (wanted === '') await target.keyboard.press('Backspace');
  else await target.keyboard.type(wanted);
}

before(async () => {
  session = await openPlanner({ theme: 'light', width: 1280, height: 900 });
  page = session.page;
});

after(async () => {
  if (phone) await phone.close();
  if (session) await session.close();
});

test('the ⋯ button sits beside the selected tab, names its floor, and opens the menu: Rename, Duplicate floor, Move left, Move right, Delete; Escape gives the focus back', async () => {
  await build(page);
  assert.equal(await page.$eval('#floor-actions', (el) => el.getAttribute('aria-label')), 'Floor 2 actions');
  assert.equal(await page.$eval('#floor-actions', (el) => el.getAttribute('aria-haspopup')), 'menu');
  await page.click('#floor-actions');
  await menuOpen(page);
  assert.deepEqual(await menuItems(page), ['Rename…', 'Duplicate floor…', 'Move left', 'Move right', 'Delete…']);
  assert.equal(await page.$eval('#floor-actions', (el) => el.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await exists(page, '.menu'), false);
  assert.equal(await focusLabel(page), 'floor-actions', 'the focus is back on the button');
});

test('right-click on a tab opens the menu of that tab\'s floor, whichever is selected', async () => {
  const box = await page.$eval('#floor-tab-' + (await building(page)).floors[2].id, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await menuOpen(page);
  assert.equal(await page.$eval('.menu', (el) => el.getAttribute('aria-label')), 'Floor 3 actions');
  assert.equal((await menuItems(page)).includes('Move right'), true);
  assert.equal(await page.$eval('.menu [role="menuitem"][aria-disabled="true"]', (el) => el.textContent.trim().replace('●', '')), 'Move right', 'the top floor cannot move right');
  await page.keyboard.press('Escape');
});

test('the Menu key and Shift+F10 on a focused tab open its menu, and the keyboard alone reaches the dialog and duplicates', async () => {
  await page.focus('#floor-tab-' + (await building(page)).floors[1].id);
  await page.keyboard.press('ContextMenu');
  await menuOpen(page);
  assert.equal(await page.$eval('.menu', (el) => el.getAttribute('aria-label')), 'Floor 2 actions');
  await page.keyboard.press('Escape');
  assert.equal(await focusLabel(page), 'floor-tab-' + (await building(page)).floors[1].id);
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await menuOpen(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusLabel(page), 'Duplicate floor…');
  await page.keyboard.press('Enter');
  await dialogOpen(page);
  assert.equal(await focusLabel(page), 'duplicate-name', 'the focus goes to the first field');
  const before = (await state(page)).entries;
  await page.keyboard.press('Enter');
  await dialogGone(page);
  await page.waitForFunction((n) => globalThis.sv2.store.history.past.length === n, {}, before + 1);
  assert.equal((await building(page)).floors.length, 4);
  await page.evaluate(() => globalThis.sv2.store.undo());
  await showFloor(page, 'Floor 2');
});

test('the Menu key opens the menu once: the contextmenu Windows raises as the key comes up is the same press', async () => {
  const tabId = 'floor-tab-' + (await building(page)).floors[1].id;
  await page.focus('#' + tabId);
  const seen = await page.evaluate((id) => {
    const tab = document.getElementById(id);
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', code: 'ContextMenu', bubbles: true, cancelable: true }));
    const first = document.querySelector('.menu[role="menu"]');
    if (first) first.dataset.first = 'yes';
    tab.dispatchEvent(new KeyboardEvent('keyup', { key: 'ContextMenu', code: 'ContextMenu', bubbles: true, cancelable: true }));
    const raised = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 });
    tab.dispatchEvent(raised);
    const menus = Array.from(document.querySelectorAll('.menu[role="menu"]'));
    return { opened: first !== null, menus: menus.length, same: menus.length === 1 && menus[0].dataset.first === 'yes', stopped: raised.defaultPrevented, focus: document.activeElement.textContent.trim() };
  }, tabId);
  assert.deepEqual(seen, { opened: true, menus: 1, same: true, stopped: true, focus: 'Rename…' }, 'one menu, the first, with the focus on its first item');
  await page.keyboard.press('Escape');
  // a right-click after that is a menu of its own again
  const box = await page.$eval('#' + tabId, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await menuOpen(page);
  await page.keyboard.press('Escape');
});

test('the dialog says where the copy goes, what it has, how the numbers come out, what joining does and what is left behind', async () => {
  await openDialogByButton(page);
  assert.equal(await text(page, '#duplicate-floor-dialog .dialog__title'), 'Duplicate Floor 2');
  assert.equal(await text(page, '#duplicate-sentence'), 'The copy goes on top of the building, as Floor 4.');
  assert.equal(await page.$eval('#duplicate-name', (el) => el.value), 'Floor 4');
  assert.equal(await text(page, '#duplicate-copied'), 'It has Floor 2\'s corridors, stairs, rooms and other spaces: 3 rooms.');
  assert.equal(await page.$eval('#duplicate-numbers-level', (el) => el.checked), true);
  assert.equal(await text(page, 'label[for="duplicate-numbers-level"]'), 'Renumber them for Floor 4: 201 becomes 401, 202 becomes 402');
  assert.equal(await text(page, 'label[for="duplicate-numbers-blank"]'), 'Leave them without numbers (3 rooms to number)');
  assert.equal(await page.$eval('#duplicate-join', (el) => el.checked), true);
  assert.equal(await text(page, '#duplicate-join-words'), 'Stairs A will run from Floor 2 to Floor 4 as one stairwell.', 'it names no letter change');
  assert.equal(await text(page, '#duplicate-left'), 'Not copied: teachers in rooms, exits, the traced image.');
  assert.equal(await text(page, '#duplicate-notes'), 'The 3 numbered copies will add 6 notes to the Checks tab: 3 for a room no group uses and 3 for a room with no subject.', 'counted by the checks: one day type, and no subject');
  const buttons = await page.$$eval('#duplicate-floor-dialog .dialog__buttons button', (all) => all.map((button) => button.textContent));
  assert.deepEqual(buttons, ['Duplicate Floor 2', 'Cancel'], 'Cancel last');
  await page.keyboard.press('Escape');
  await dialogGone(page);
  assert.equal(await focusLabel(page), 'floor-actions', 'Escape cancels and the focus comes back to the opener');
  assert.match((await state(page)).said, /^No floor was duplicated\.$/);
});

test('typing a name changes the sentences; a blank name is refused in words and the button says so', async () => {
  await openDialogByButton(page);
  await setName(page, '<i>Annex</i> "B"');
  assert.equal(await text(page, '#duplicate-sentence'), 'The copy goes on top of the building, as <i>Annex</i> "B".', 'a name is data, never markup');
  assert.match(await text(page, '#duplicate-join-words'), /to <i>Annex<\/i> "B" as one stairwell/);
  await setName(page, '');
  assert.equal(await page.$eval('#duplicate-name-note', (el) => el.hidden), false);
  assert.match(await text(page, '#duplicate-name-note'), /^A floor needs a name\./);
  assert.equal(await page.$eval('#duplicate-floor-dialog .dialog__buttons button', (el) => el.getAttribute('aria-disabled')), 'true');
  const before = (await state(page)).entries;
  await page.keyboard.press('Enter');
  assert.equal(await exists(page, 'dialog#duplicate-floor-dialog[open]'), true, 'Enter does not close it on a refused name');
  assert.equal((await state(page)).entries, before);
  await page.keyboard.press('Escape');
  await dialogGone(page);
});

test('Duplicate: the copy is the last tab and selected, the toast names it, the rooms are renumbered, the stairs make one stairwell, and one Undo takes it all back', async () => {
  const start = await building(page);
  const before = (await state(page)).entries;
  await openDialogByButton(page);
  await page.evaluate(() => document.querySelector('#duplicate-floor-dialog .dialog__buttons button').click());
  await dialogGone(page);
  await floorIs(page, 'Floor 4');
  const now = await state(page);
  assert.equal(now.entries, before + 1, 'one undo step');
  assert.equal(now.toast, 'Duplicated Floor 2 as Floor 4');
  const tabs = await page.$$eval('.bld-floors__tab', (all) => all.map((tab) => [tab.querySelector('.bld-floors__name').textContent, tab.getAttribute('aria-selected')]));
  assert.deepEqual(tabs, [['Floor 1', 'false'], ['Floor 2', 'false'], ['Floor 3', 'false'], ['Floor 4', 'true']]);
  const after = await building(page);
  const copy = after.floors[3];
  assert.equal(copy.level, 4);
  assert.deepEqual(copy.spaces.map((space) => space.number), ['401', '402', '414B']);
  const well = after.connections.filter((connection) => connection.well);
  assert.equal(well.length, 2);
  assert.ok(well.every((connection) => connection.well === 'A'), 'the one letter is the one it had');
  assert.deepEqual(after.connections.find((connection) => connection.id === start.connections[0].id).label, 'A', 'no flight already there changed its label');
  assert.equal(await page.evaluate(() => document.querySelector('.bld').editor.floor.name), 'Floor 4');
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.deepEqual(await building(page), start, 'one Undo gives back the building as it was');
});

test('Leave without numbers and Join off: the copy has blank numbers and no new flight', async () => {
  await showFloor(page, 'Floor 2');
  await openDialogByButton(page);
  await page.click('#duplicate-numbers-blank');
  await page.click('#duplicate-join');
  await page.evaluate(() => document.querySelector('#duplicate-floor-dialog .dialog__buttons button').click());
  await dialogGone(page);
  await floorIs(page, 'Floor 4');
  const after = await building(page);
  assert.deepEqual(after.floors[3].spaces.map((space) => space.number), ['', '', '']);
  assert.equal(after.connections.length, 1);
  await page.evaluate(() => globalThis.sv2.store.undo());
  await showFloor(page, 'Floor 2');
});

test('numbers that cannot carry over are one line, not two rows; a floor with nothing joined has no join checkbox', async () => {
  await build(page, { numbers: ['A-1', 'B-2'], flight: false });
  await openDialogByButton(page);
  assert.equal(await page.$eval('#duplicate-numbers', (el) => el.hidden), true);
  assert.equal(await text(page, '#duplicate-numbers-note'), 'The copies will have no numbers ("A-1" does not begin with a digit), so 2 rooms will need one.');
  assert.equal(await page.$eval('#duplicate-join-block', (el) => el.hidden), true, 'nothing is connected, so nothing to join');
  await page.keyboard.press('Escape');
  await dialogGone(page);
});

test('a floor below the copy of another size: nothing is joined, and the dialog says why in its Not copied line', async () => {
  await build(page);
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.resizeFloor, { floorId: store.project.building.floors[2].id, right: 2 });
  });
  await openDialogByButton(page);
  assert.equal(await page.$eval('#duplicate-join-block', (el) => el.hidden), true, 'no join to make');
  assert.equal(await text(page, '#duplicate-left'), 'Not copied: teachers in rooms, exits, the traced image. Nothing is joined: Floor 3 is 42 × 30 cells and Floor 2 is 40 × 30, so the copy\'s stairs and elevator stops do not line up with Floor 3\'s.');
  await page.keyboard.press('Escape');
  await dialogGone(page);
});

test('Rename, Move and Delete from the menu', async () => {
  await build(page);
  await page.click('#floor-actions');
  await menuOpen(page);
  await page.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Rename')).click());
  await page.waitForSelector('#floor-rename-dialog[open]');
  await page.keyboard.type('Annex');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[1].name === 'Annex');
  await page.click('#floor-actions');
  await menuOpen(page);
  await page.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Move left')).click());
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].name === 'Annex');
  assert.match((await state(page)).said, /^Annex is now floor 1 of 3 in the tabs\.$/);
  await page.click('#floor-actions');
  await menuOpen(page);
  await page.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Delete')).click());
  await page.waitForSelector('dialog[open]');
  assert.match(await page.$eval('dialog[open] .dialog__title', (el) => el.textContent), /^Delete Annex\?$/);
  await page.keyboard.press('Escape');
});

test('on a phone at 390 px: the ⋯ button is 44 px, the dialog fits with no sideways scroll, and Cancel is last; at 844 by 390 the footer is on screen', async () => {
  phone = await openPlanner({ theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  await build(p);
  const more = await p.$eval('#floor-actions', (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
  assert.ok(more[0] >= 44 && more[1] >= 44, 'a finger-sized button: ' + more.join(' x '));
  await p.click('#floor-actions');
  await menuOpen(p);
  await p.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Duplicate floor')).click());
  await dialogOpen(p);
  const fit = await p.evaluate(() => {
    const dialog = document.querySelector('#duplicate-floor-dialog').getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll('#duplicate-floor-dialog .dialog__buttons button'), (button) => button.getBoundingClientRect());
    return { scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, right: dialog.right, bottom: dialog.bottom, height: window.innerHeight, buttons: buttons.map((r) => [r.height, r.bottom]) };
  });
  assert.ok(fit.scroll <= fit.width, 'no sideways scroll: ' + fit.scroll + ' > ' + fit.width);
  assert.ok(fit.right <= fit.width, 'the dialog is inside the window');
  assert.ok(fit.buttons.every(([height, bottom]) => height >= 44 && bottom <= fit.height), 'both buttons 44 px tall and on screen');
  await p.keyboard.press('Escape');
  await dialogGone(p);
  // the short landscape phone: the body scrolls and the footer stays
  await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await still(p);
  await p.click('#floor-actions');
  await menuOpen(p);
  await p.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((item) => item.textContent.includes('Duplicate floor')).click());
  await dialogOpen(p);
  const short = await p.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#duplicate-floor-dialog .dialog__buttons button'), (button) => button.getBoundingClientRect());
    return { buttons: buttons.map((r) => [r.top, r.bottom]), height: window.innerHeight };
  });
  assert.ok(short.buttons.every(([top, bottom]) => top >= 0 && bottom <= short.height), 'at 844 by 390 both buttons are on screen: ' + JSON.stringify(short));
  await p.keyboard.press('Escape');
  await dialogGone(p);
});
