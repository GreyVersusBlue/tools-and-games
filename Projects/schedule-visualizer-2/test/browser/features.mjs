// Room features in the planner, in a real browser: node test/browser/features.mjs
//
// A room's Features chips and the combobox that adds one (near matches, "Add"
// as the last option, what Enter takes, the live region, where the focus goes
// after an add and a removal, "Removed Lab" with its Undo); the Edit the
// features list… dialog (rows, moves, rename, delete with its confirm and
// toast heard once, Add common ones on an empty list with the focus on the
// first new name, a rename keeping the focus and the next click, the count
// from 30, the most of 40, the footer pinned at 844 by 390, the rows wrapped
// at 390); the Rooms tab's Features column sorted by count and its popover
// named for its room, the dialog from it returning the focus to the cell; the
// room list print and the batch pages listing features after Shared space,
// the batch headers reading a custom period word, a part-time teacher's days
// out on the batch sheet; axe on the dialog, the open combobox and the
// popover in both themes; the phone's add and remove by tap and by keyboard
// with 44 px chips, and its popover. Driven by pointer and by
// keyboard at 1280 by 900 and at 390 by 844 with touch. Every wait is on a
// state the page sets (the store's features, an announcement, a toast's words,
// the dialog's rows, the plan at rest with `still`), never on a first paint or
// a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, assertTouch, still, TOOL_DIR } from './harness.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const HOSTILE = '<b>Lab</b> "Q" 名前';

let session;
let page;
let phone = null;
let roomId = null;

const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const names = () => page.evaluate(() => (globalThis.sv2.store.project.building.features || []).map((feature) => feature.name));
const idOf = (name) => page.evaluate((wanted) => (globalThis.sv2.store.project.building.features || []).find((feature) => feature.name === wanted)?.id, name);
const roomHas = () => page.evaluate((id) => {
  const project = globalThis.sv2.store.project;
  const room = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === id);
  const list = project.building.features || [];
  return (room.featureIds || []).map((held) => list.find((feature) => feature.id === held)?.name);
}, roomId);
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);
const activeId = () => page.evaluate(() => document.activeElement?.id || null);
const announced = (words) => shows((wanted) => document.querySelector('#announcer')?.textContent === wanted, words);
const toastWords = () => page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null);
const key = (name) => '[data-key="' + name + '"]';
const optionLabels = () => page.$$eval('#room-features-list [role="option"]', (all) => all.map((el) => el.textContent));
const chips = () => page.$$eval('#room-features-chips button', (all) => all.map((el) => el.querySelector('.bi-chip__name').textContent));

async function apply(name, payload) {
  await page.evaluate(async (action, data) => {
    const w7 = await import('./engine/w7-actions.js');
    globalThis.sv2.store.apply(w7[action], data);
  }, name, payload);
}

async function undoKey() {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
}

async function selectRoom(id) {
  await page.evaluate((wanted) => document.querySelector('.bld').editor.select([wanted]), id);
  await page.waitForSelector('#room-features-add');
}

async function typeInField(selector, words) {
  await page.click(selector);
  await page.keyboard.type(words);
}

async function openDialog() {
  await page.click(key('feature-edit'));
  await page.waitForSelector('#features-dialog[open]');
}

async function closeDialog() {
  await page.keyboard.press('Escape');
  await shows(() => document.querySelector('#features-dialog') === null);
}

before(async () => {
  session = await openPlanner({ hash: '#building', theme: 'light' });
  page = session.page;
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setOnboarding, { dismissed: true });
  });
  await still(page);
  roomId = await page.evaluate(() => document.querySelector('.bld').editor.floor.spaces.find((space) => space.kind === 'room').id);
  await selectRoom(roomId);
});

after(async () => {
  if (phone) await phone.close();
  if (session) await session.close();
});

test('1. a feature typed in the combobox is added to the list and the room in one step, and the field keeps the focus', async () => {
  assert.equal(await page.$eval('#room-features-chips', (el) => el.hidden), true, 'no chips for a room with no features');
  assert.match(await text('#room-features-none'), /no features yet/);
  assert.equal(await page.$eval('#room-features-add', (el) => el.getAttribute('role')), 'combobox');
  await typeInField('#room-features-add', 'Lab');
  assert.deepEqual(await optionLabels(), ['Add ‘Lab’ to the list']);
  await page.click('#room-features-list [role="option"]');
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 1);
  await announced('Lab added');
  assert.deepEqual(await names(), ['Lab']);
  assert.deepEqual(await roomHas(), ['Lab']);
  assert.equal(await activeId(), 'room-features-add', 'the field keeps the focus');
  assert.equal(await page.$eval('#room-features-add', (el) => el.value), '', 'and is empty again');
  assert.equal(await page.$eval('#room-features-add', (el) => el.getAttribute('aria-expanded')), 'false');
  assert.deepEqual(await chips(), ['Lab']);
  const label = await page.$eval('#room-features-chips button', (el) => el.getAttribute('aria-label'));
  assert.match(label, /^Remove Lab from \S/);
  // one step: a single Undo takes the feature off the list and off the room
  await undoKey();
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 0);
  assert.deepEqual(await roomHas(), []);
});

test('2. Enter takes the only option, "Add"; Backspace in an empty field reaches the last chip; a chip removes with Enter, says so, and Undo brings it back', async () => {
  await page.focus('#room-features-add');
  await page.keyboard.type('Lab');
  await page.keyboard.press('Enter');
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 1);
  await page.keyboard.type('Sink');
  await page.keyboard.press('Enter');
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 2);
  assert.deepEqual(await chips(), ['Lab', 'Sink']);
  await page.keyboard.press('Backspace');
  const sink = await idOf('Sink');
  const lab = await idOf('Lab');
  assert.equal(await activeKey(), 'feature:' + sink, 'Backspace in the empty field focuses the last chip');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('.toast .toast__text')?.textContent === 'Removed Sink');
  assert.equal(await page.$eval('.toast .toast__action', (el) => el.textContent), 'Undo');
  assert.deepEqual(await roomHas(), ['Lab']);
  assert.equal(await activeKey(), 'feature:' + lab, 'the focus goes to the next chip');
  await page.click('.toast .toast__action');
  await shows(() => document.querySelectorAll('#room-features-chips button').length === 2);
  assert.deepEqual(await roomHas(), ['Lab', 'Sink']);
  // the last chips: the focus ends in the field
  await page.click('#room-features-chips button');
  await shows(() => document.querySelectorAll('#room-features-chips button').length === 1);
  assert.equal(await activeKey(), 'feature:' + sink);
  await page.keyboard.press('Space');
  await shows(() => document.querySelectorAll('#room-features-chips button').length === 0);
  assert.equal(await activeId(), 'room-features-add', 'no chip left: the focus goes to the field');
});

test('3. near matches come first and Add is last; Enter takes Add only when an arrow chose it or nothing is near', async () => {
  await page.focus('#room-features-add');
  await page.keyboard.type('Lap');
  assert.deepEqual(await optionLabels(), ['Lab', 'Add ‘Lap’ to the list']);
  await page.keyboard.press('Enter');
  await shows(() => /^Use the arrow keys to choose Lab/.test(document.querySelector('#announcer')?.textContent || ''));
  assert.deepEqual(await roomHas(), [], 'Enter chose nothing when an arrow had not');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('#room-features-add', (el) => el.getAttribute('aria-activedescendant') === document.querySelector('#room-features-list [role="option"]').id), true);
  await page.keyboard.press('Enter');
  await announced('Lab added');
  assert.deepEqual(await roomHas(), ['Lab']);
  assert.deepEqual(await names(), ['Lab', 'Sink'], 'the list did not grow: Lab was taken, not Lap');
  // Lab is on the room now, so nothing is near and Add is the one option
  await page.keyboard.type('Lap');
  assert.deepEqual(await optionLabels(), ['Add ‘Lap’ to the list']);
  await page.keyboard.press('Enter');
  await announced('Lap added');
  assert.deepEqual(await names(), ['Lab', 'Sink', 'Lap']);
  // an arrow moved onto Add, with a near match above it
  await page.keyboard.type('Sin');
  assert.deepEqual(await optionLabels(), ['Sink', 'Add ‘Sin’ to the list']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await announced('Sin added');
  assert.deepEqual(await roomHas(), ['Lab', 'Lap', 'Sin']);
  // a name the room has already: nothing to add, said once with one full stop
  await page.keyboard.type('Lab');
  await page.keyboard.press('Enter');
  await announced('Nothing to add: Lab is on this room already.');
  await page.$eval('#room-features-add', (el) => { el.value = ''; });
  // Escape shuts the list and keeps what was typed
  await page.keyboard.type('Ki');
  assert.equal(await page.$eval('#room-features-list', (el) => el.hidden), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#room-features-list', (el) => el.hidden), true);
  assert.equal(await page.$eval('#room-features-add', (el) => el.value), 'Ki');
  await page.$eval('#room-features-add', (el) => { el.value = ''; });
});

test('4. a name is shown as typed, never as markup', async () => {
  await page.focus('#room-features-add');
  await page.keyboard.type(HOSTILE);
  await page.keyboard.press('Enter');
  await announced(HOSTILE + ' added');
  assert.ok((await chips()).includes(HOSTILE));
  assert.equal(await page.$eval('#room-features-chips', (el) => el.querySelectorAll('b').length), 0, 'no <b> element came out of the name');
});

test('5. the list dialog: rows, moves, rename and its refusal, delete with and without a confirm, and the way back', async () => {
  await openDialog();
  const first = await page.evaluate(() => globalThis.sv2.store.project.building.features[0].id);
  assert.equal(await activeKey(), 'name:' + first, 'the focus goes to the first name');
  assert.equal(await text('#features-note'), 'Renaming changes it in every room.');
  assert.equal(await page.$$eval('#features-rows .features-row', (all) => all.length), 5);
  assert.equal(await page.$eval(key('up:' + first), (el) => el.disabled), true, 'the top row cannot move up');
  assert.match(await text(key('down:' + first)), /^Move Lab down$/);
  // the row buttons read as words: "Move Lab up", "Delete Lab…", one space apart, no gap
  // before the ellipsis, and each accessible name starts with the visible words
  const words = await page.$$eval('#features-rows .features-row:first-child .features-row__buttons .btn', (all) => all.map((button) => {
    const size = parseFloat(getComputedStyle(button).fontSize);
    const boxes = [];
    const walk = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0) boxes.push(rect);
    }
    boxes.sort((a, b) => a.left - b.left);
    let widest = 0;
    for (let at = 1; at < boxes.length; at += 1) widest = Math.max(widest, boxes[at].left - boxes[at - 1].right);
    return { seen: button.innerText, name: button.getAttribute('aria-label') || button.textContent, gap: widest / size, line: new Set(boxes.map((rect) => Math.round(rect.top))).size };
  }));
  assert.deepEqual(words.map((each) => each.seen), ['Move Lab up', 'Move Lab down', 'Delete Lab…'], 'the words on the buttons');
  for (const each of words) {
    assert.ok(each.gap < 0.4, '"' + each.seen + '" has a gap of ' + each.gap.toFixed(2) + ' em between its words');
    assert.equal(each.line, 1, '"' + each.seen + '" is on one line');
    assert.ok(each.name.startsWith(each.seen.replace(/…$/, '')), 'the name "' + each.name + '" starts with the visible words');
  }
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), false, 'a fine pointer, where the first name keeps the focus');
  // move Lab down: the list and the focus
  await page.click(key('down:' + first));
  await shows(() => globalThis.sv2.store.project.building.features[0].name === 'Sink');
  assert.deepEqual(await names(), ['Sink', 'Lab', 'Lap', 'Sin', HOSTILE]);
  assert.equal(await activeKey(), 'down:' + first, 'the focus stays on the button used');
  await page.keyboard.press('Enter');
  await shows(() => globalThis.sv2.store.project.building.features[2].name === 'Lab');
  assert.deepEqual(await roomHas(), ['Lap', 'Lab', 'Sin', HOSTILE], 'a room keeps its features in the list\u2019s order');
  // rename Sin: kept on Enter; a name already on the list is refused inline and Escape puts it back
  const sin = await idOf('Sin');
  await page.click(key('name:' + sin), { clickCount: 3 });
  await page.keyboard.type('Sinks');
  await page.keyboard.press('Enter');
  await shows(() => (globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Sinks'));
  await page.click(key('name:' + sin), { clickCount: 3 });
  await page.keyboard.type('lab ');
  await page.keyboard.press('Enter');
  await shows((id) => document.querySelector('[data-key="name:' + id + '"]').getAttribute('aria-invalid') === 'true', sin);
  assert.match(await page.$eval(key('name:' + sin) + ' + .field__refusal', (el) => el.textContent), /already a feature called "Lab"/);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval(key('name:' + sin), (el) => el.value), 'Sinks');
  assert.equal(await page.$eval('#features-dialog', (el) => el.open), true, 'Escape in a field puts the name back and keeps the dialog');
  // delete: Sink is on no room, so no question; the way back is in the dialog
  const sink = await idOf('Sink');
  await page.click(key('delete:' + sink));
  await shows(() => !(globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Sink'));
  assert.equal(await toastWords(), 'Deleted Sink');
  assert.equal(await text('#features-undo'), 'Deleted Sink · Undo');
  // heard once: the toast is the live one; neither the announcer nor the dialog's line says it again
  assert.equal(await page.$eval('#toasts', (el) => el.getAttribute('role')), 'status');
  assert.doesNotMatch(await text('#announcer'), /Deleted/, 'the announcer does not repeat the toast');
  assert.equal(await page.$eval('#features-undo', (el) => el.closest('[role="status"], [role="alert"], [aria-live]')), null, 'the way back in the dialog is not a live region');
  assert.match(await activeKey(), /^name:/, 'the focus goes to a name');
  await page.click('#features-undo button');
  await shows(() => (globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Sink'));
  assert.equal(await page.$eval('#features-undo', (el) => el.hidden), true, 'the way back goes when it was used');
  // delete a feature that is on a room: a question first
  await page.click(key('delete:' + sin));
  await page.waitForSelector('dialog[open]:not(#features-dialog)');
  assert.equal(await text('dialog[open]:not(#features-dialog) .dialog__title'), 'Delete Sinks? It is on 1 room.');
  const answers = await page.$$eval('dialog[open]:not(#features-dialog) .dialog__buttons button', (all) => all.map((el) => el.textContent));
  assert.deepEqual(answers, ['Delete Sinks', 'Keep it']);
  await page.keyboard.press('Escape');
  await shows(() => document.querySelectorAll('dialog[open]').length === 1);
  assert.ok((await names()).includes('Sinks'), 'Keep it keeps it');
  await page.click(key('delete:' + sin));
  await page.waitForSelector('dialog[open]:not(#features-dialog)');
  await page.click('dialog[open]:not(#features-dialog) .dialog__buttons button');
  await shows(() => !(globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Sinks'));
  assert.equal(await toastWords(), 'Deleted Sinks from 1 room');
  assert.equal(await text('#features-undo'), 'Deleted Sinks from 1 room · Undo');
  assert.ok(!(await roomHas()).includes('Sinks'));
  await page.click('#features-undo button');
  await shows(() => (globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Sinks'));
  assert.ok((await roomHas()).includes('Sinks'), 'Undo gave the feature back to the room');
  // a rename kept on leaving the field does not take the focus or the click with it
  const lap = await idOf('Lap');
  const lapAt = (await names()).indexOf('Lap');
  assert.ok(lapAt > 0 && lapAt < (await names()).length - 1, 'Lap has a row above and below it');
  await page.click(key('name:' + lap), { clickCount: 3 });
  await page.keyboard.type('Laps');
  await page.keyboard.press('Tab');
  await shows(() => (globalThis.sv2.store.project.building.features || []).some((feature) => feature.name === 'Laps'));
  assert.equal(await activeKey(), 'up:' + lap, 'Tab after a rename goes on to Move up');
  assert.match(await text(key('down:' + lap)), /^Move Laps down$/, 'the row says the new name');
  assert.equal(await page.$eval(key('name:' + lap), (el) => el.getAttribute('aria-label')), 'Name of Laps');
  await page.click(key('name:' + lap), { clickCount: 3 });
  await page.keyboard.type('Lapse');
  await page.click(key('down:' + lap));
  await shows((at) => (globalThis.sv2.store.project.building.features || [])[at + 1]?.name === 'Lapse', lapAt);
  assert.ok(!(await names()).includes('Laps'), 'the click both renamed and moved');
  assert.equal(await activeKey(), 'down:' + lap);
  // Escape closes, and the focus returns to the button that opened it
  await closeDialog();
  assert.equal(await activeKey(), 'feature-edit');
});

test('6. an empty list offers the common ones; the count shows from 30; 40 is the most', async () => {
  for (const name of await names()) await apply('deleteFeature', { id: await idOf(name) });
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 0);
  await openDialog();
  assert.equal(await page.$eval('#features-empty', (el) => el.hidden), false);
  assert.match(await text('#features-empty'), /Add 8 common features; delete any you do not need\./);
  assert.equal(await activeKey(), 'common', 'the focus goes to Add common ones');
  await page.keyboard.press('Enter');
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 8);
  assert.deepEqual(await names(), ['Lab', 'Sink', 'Projector', 'Computers', 'Stage', 'Kiln', 'Ovens', 'Studio sound']);
  assert.equal(await page.$eval('#features-empty', (el) => el.hidden), true);
  // the button hid with the empty list: the focus is on the first new name, not lost to the page
  assert.equal(await activeKey(), 'name:' + await idOf('Lab'), 'after Add common ones the focus goes to the first name');
  for (let n = 9; n <= 29; n += 1) await apply('addFeature', { name: 'Extra ' + n });
  await shows(() => document.querySelectorAll('#features-rows .features-row').length === 29);
  assert.equal(await page.$eval('#features-count', (el) => el.hidden), true, 'no count below 30');
  await page.click('#features-add');
  await page.keyboard.type('Extra 30');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelectorAll('#features-rows .features-row').length === 30);
  assert.equal(await text('#features-count'), '30 of 40 features.');
  assert.equal(await activeId(), 'features-add', 'the Add field keeps the focus');
  for (let n = 31; n <= 40; n += 1) await apply('addFeature', { name: 'Extra ' + n });
  await shows(() => document.querySelectorAll('#features-rows .features-row').length === 40);
  await page.keyboard.type('One more');
  await page.click('#features-dialog .features-dialog__addrow button');
  await shows(() => !document.querySelector('#features-add-refusal').hidden);
  assert.match(await text('#features-add-refusal'), /at most 40/);
  assert.equal(await page.$eval('#features-add', (el) => el.getAttribute('aria-invalid')), 'true');
  await closeDialog();
  for (let n = 9; n <= 40; n += 1) await apply('deleteFeature', { id: await idOf('Extra ' + n) });
  await shows(() => (globalThis.sv2.store.project.building.features || []).length === 8);
});

test('7. the Rooms tab: a Features column that sorts by count, and a popover with the same picker', async () => {
  const rooms = await page.evaluate(() => document.querySelector('.bld').editor.floor.spaces.filter((space) => space.kind === 'room').map((space) => space.id));
  assert.ok(rooms.length >= 3, 'the plain sample has rooms on its first floor');
  const lab = await idOf('Lab');
  const sink = await idOf('Sink');
  const kiln = await idOf('Kiln');
  await apply('setRoomFeatures', { roomId: rooms[0], featureIds: [lab] });
  await apply('setRoomFeatures', { roomId: rooms[1], featureIds: [lab, sink, kiln] });
  await apply('setRoomFeatures', { roomId: rooms[2], featureIds: [sink, kiln] });
  await page.click('#inspector [data-tab="rooms"]');
  await page.waitForSelector('#rooms-table table');
  const counts = () => page.$$eval('#rooms-table tbody tr', (all) => all.map((row) => {
    const words = row.querySelector('.bi-features-cell').textContent;
    return words === 'None' ? 0 : words.split(', ').length;
  }));
  const sortButton = async () => {
    const buttons = await page.$$('#rooms-table th button.table__sort');
    for (const button of buttons) if ((await button.evaluate((el) => el.textContent)).startsWith('Features')) return button;
    throw new Error('no Features column heading');
  };
  await (await sortButton()).click();
  await shows(() => document.querySelector('#rooms-table th[aria-sort="ascending"]')?.textContent.startsWith('Features'));
  const up = await counts();
  assert.deepEqual(up, up.slice().sort((a, b) => a - b), 'ascending by count: ' + up.join(','));
  assert.equal(up[up.length - 1], 3);
  await (await sortButton()).click();
  await shows(() => document.querySelector('#rooms-table th[aria-sort="descending"]')?.textContent.startsWith('Features'));
  const down = await counts();
  assert.deepEqual(down, down.slice().sort((a, b) => b - a), 'descending by count: ' + down.join(','));
  assert.equal(down[0], 3);
  // the popover: the picker adds a feature to that row's room
  const cell = key(rooms[0] + ':features');
  assert.match(await page.$eval(cell, (el) => el.getAttribute('aria-label')), /^Features of \S.*: Lab\. Change$/);
  await page.click(cell);
  await shows(() => document.querySelector('#rooms-features-pop')?.matches(':popover-open'));
  assert.equal(await activeId(), 'rooms-features-add', 'the focus goes to the field');
  await page.keyboard.type('Stag');
  assert.deepEqual(await page.$$eval('#rooms-features-list [role="option"]', (all) => all.map((el) => el.textContent)), ['Stage', 'Add ‘Stag’ to the list']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await announced('Stage added');
  await shows((id) => document.querySelector('[data-key="' + id + ':features"]').textContent === 'Lab, Stage', rooms[0]);
  assert.equal(await page.$eval(cell, (el) => el.textContent), 'Lab, Stage');
  await page.keyboard.press('Escape');
  await shows(() => !document.querySelector('#rooms-features-pop').matches(':popover-open'));
  assert.equal(await activeKey(), rooms[0] + ':features', 'the focus returns to the cell');
  // the popover names its room
  const roomWords = await page.evaluate((id) => {
    return document.querySelector('[data-key="' + id + ':features"]').getAttribute('aria-label').replace(/^Features of (.*?): .*$/, '$1');
  }, rooms[1]);
  await page.click(key(rooms[1] + ':features'));
  await shows(() => document.querySelector('#rooms-features-pop')?.matches(':popover-open'));
  assert.equal(await page.$eval('#rooms-features-pop', (el) => el.getAttribute('aria-label')), 'Features of ' + roomWords);
  // the list dialog from the popover hides it; on close the focus goes back to that room's cell
  await page.click('#rooms-features ' + key('feature-edit'));
  await page.waitForSelector('#features-dialog[open]');
  assert.equal(await page.$eval('#rooms-features-pop', (el) => el.matches(':popover-open')), false, 'the modal closed the popover');
  await closeDialog();
  assert.equal(await activeKey(), rooms[1] + ':features', 'the focus returns to the cell that opened the popover');
  await page.click('#inspector [data-tab="properties"]');
});

test('8. the room list print and the batch pages list features after Shared space, the batch heads read a custom period word, and a part-time teacher\u2019s sheet shows the days out', async () => {
  const made = await page.evaluate(async () => {
    const roomList = await import('./ui/prints/room-list.js');
    const batch = await import('./ui/prints/batch.js');
    const now = new Date('2026-01-01T12:00:00Z');
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    const hostile = project.building.features.find((feature) => feature.name === 'Stage');
    hostile.name = '<i>Stage</i> & "Q"';
    const list = roomList.render(project, null, { floorId: 'all', now }).html;
    const sorted = roomList.render(project, null, { floorId: 'all', now, sort: { column: 'features', direction: 'descending' } }).html;
    const rooms = batch.render(project, null, { batch: 'rooms', now }).html;
    const bare = JSON.parse(JSON.stringify(project));
    delete bare.building.features;
    for (const floor of bare.building.floors) for (const space of floor.spaces) delete space.featureIds;
    const plain = roomList.render(bare, null, { floorId: 'all', now }).html;
    const word = JSON.parse(JSON.stringify(project));
    word.settings.periodCustom = { word: 'Lesson', plural: 'Lessons', count: 'number' };
    const teachers = batch.render(word, null, { batch: 'teachers', now }).html;
    const roomsWord = batch.render(word, null, { batch: 'rooms', now }).html;
    // a shared room with features: Shared space first, then Features (DESIGN 16.4)
    const shared = JSON.parse(JSON.stringify(project));
    const sharedRoom = shared.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'room' && (space.featureIds || []).length > 0);
    sharedRoom.shared = true;
    const sharedFacts = batch.render(shared, null, { batch: 'rooms', now }).html.split('data-id="' + sharedRoom.id + '"')[1].split('batch-sheet__facts">')[1].split('</p>')[0];
    // a part-time teacher: the first of the full sample school's (invented) teachers, whose
    // Assembly Day runs as B Day; one sheet, its day tables and its period rows
    const sample = (await import('./data/sample-school.js')).sampleSchool();
    const teacherSheet = (copy, teacherId) => {
      const html = batch.render(copy, null, { batch: 'teachers', now }).html.split('data-id="' + teacherId + '"')[1].split('<section class="batch-sheet')[0];
      const tables = {};
      for (const part of html.split('<section class="batch-day">').slice(1)) {
        const title = part.split('batch-day__name">')[1].split('<')[0];
        tables[title] = {};
        for (const row of part.split('<tr>').slice(1)) {
          const head = row.match(/<th scope="row">([^<]*)/);
          if (head) tables[title][head[1]] = row.split('</th><td>')[1].split('</td>')[0];
        }
      }
      return tables;
    };
    const away = (entries) => {
      const copy = JSON.parse(JSON.stringify(sample));
      const teacher = copy.teachers[0];
      teacher.away = entries;
      return teacherSheet(copy, teacher.id);
    };
    const [dayA, , assembly] = sample.dayTypes.map((dayType) => dayType.id);
    const partTime = {
      none: away([]),
      // sometimes out (Fridays) in one period of Assembly Day only: no period is taken, but the
      // note is Assembly Day's alone, so it is a kind of day of its own now
      assemblyOnly: away([{ dayTypeIds: [assembly], weekdays: [4], periods: [3] }]),
      // out every A Day (the classes still taught stay); out in Period 4 on Fridays, whatever the day type
      sometimes: away([{ dayTypeIds: [dayA], weekdays: [], periods: [] }, { dayTypeIds: [], weekdays: [4], periods: [3] }]),
    };
    return { list, sorted, rooms, plain, teachers, roomsWord, sharedFacts, partTime, names: sample.dayTypes.map((dayType) => dayType.name) };
  });
  assert.match(made.list, /<th scope="col">Features<\/th>/);
  assert.match(made.list, /<td>Lab, &lt;i&gt;Stage&lt;\/i&gt;/);
  assert.doesNotMatch(made.list, /<i>Stage/, 'a feature name is never markup on paper');
  const firstRow = made.sorted.split('<tbody>')[1].split('</tr>')[0];
  assert.match(firstRow, /Lab, Sink, Kiln/, 'sorted by count, the room with three features is first: ' + firstRow);
  assert.doesNotMatch(made.plain, /<th scope="col">Features<\/th>/, 'a school with no features prints no column');
  assert.match(made.rooms, /Features: [^<]*Lab/);
  assert.match(made.rooms, /Features: [^<]*&lt;i&gt;Stage&lt;\/i&gt;/);
  // Features comes straight after Shared space on a room's sheet
  assert.match(made.sharedFacts, /Shared space · Features: [^·]+/, 'Shared space, then Features: ' + made.sharedFacts);
  assert.ok(made.sharedFacts.indexOf('Shared space') < made.sharedFacts.indexOf('Features:'));
  // a part-time teacher's sheet: the day kinds split on its away entries
  assert.deepEqual(made.names, ['A Day', 'B Day', 'Assembly Day'], 'the sample\u2019s day types');
  assert.deepEqual(Object.keys(made.partTime.none), ['A Day', 'B Day and Assembly Day'], 'with no away entry, B Day and Assembly Day are one table');
  assert.deepEqual(Object.keys(made.partTime.assemblyOnly), ['A Day', 'B Day', 'Assembly Day'], 'a sometimes entry on Assembly Day alone makes it a table of its own');
  assert.match(made.partTime.assemblyOnly['Assembly Day']['Period 4'], /Not in school in Period 4 on Fridays when it is Assembly Day/);
  assert.doesNotMatch(made.partTime.assemblyOnly['B Day']['Period 4'], /Not in school/);
  // out all A Day: a free period reads Not in school, and a period already out has no "sometimes" note on top
  const aDay = made.partTime.sometimes['A Day'];
  assert.equal(aDay['Period 1'], 'Not in school', 'A Day: ' + JSON.stringify(aDay));
  assert.equal(aDay['Period 4'], 'Not in school', 'a period already out has no Fridays note: ' + JSON.stringify(aDay));
  // the sometimes entry: a quiet note on Period 4 of the other days, and on no other period
  const other = made.partTime.sometimes['B Day and Assembly Day'];
  assert.match(other['Period 4'], /<span class="batch-day__quiet">Not in school in Period 4 on Fridays<\/span>/);
  assert.ok(Object.entries(other).filter(([period]) => period !== 'Period 4').every(([, cell]) => !cell.includes('on Fridays')), 'only Period 4 has the note: ' + JSON.stringify(other));
  assert.match(made.teachers, /<th scope="col">Lesson<\/th>/, 'the batch teacher heads read the custom word');
  assert.match(made.roomsWord, /<th scope="col">Lesson<\/th>/);
  assert.doesNotMatch(made.teachers, /<th scope="col">Period<\/th>/);
});

for (const theme of ['light', 'dark']) {
  test('9. axe finds nothing on the features dialog, the open combobox or the Rooms popover, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await selectRoom(roomId);
    await openDialog();
    await page.addScriptTag({ path: AXE });
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    const found = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#features-dialog'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(found.passes.length > 5, 'axe ran very few rules');
    assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], 'the features dialog, ' + theme);
    await closeDialog();
    const inspector = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#room-features'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.deepEqual(inspector.violations.map((violation) => violation.id), [], 'the Features part of Properties, ' + theme);
    const violations = (found) => found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
    // the combobox with its list open and an option highlighted
    await page.focus('#room-features-add');
    await page.keyboard.type('a');
    await page.keyboard.press('ArrowDown');
    const highlighted = await page.$eval('#room-features-add', (el) => ({ expanded: el.getAttribute('aria-expanded'), active: el.getAttribute('aria-activedescendant'), options: document.querySelectorAll('#room-features-list [role="option"]').length }));
    assert.equal(highlighted.expanded, 'true');
    assert.ok(highlighted.active && highlighted.options >= 1, 'an option is highlighted: ' + JSON.stringify(highlighted));
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    const open = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#room-features'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(open.passes.length > 5, 'axe ran very few rules');
    assert.deepEqual(violations(open), [], 'the combobox with its list open, ' + theme);
    await page.keyboard.press('Escape');
    await page.$eval('#room-features-add', (el) => { el.value = ''; });
    // the Rooms tab's popover, open over the table
    await page.click('#inspector [data-tab="rooms"]');
    await page.waitForSelector('#rooms-table .bi-features-cell');
    await page.click('#rooms-table .bi-features-cell');
    await shows(() => document.querySelector('#rooms-features-pop')?.matches(':popover-open'));
    const pop = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#rooms-features-pop'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(pop.passes.length > 5, 'axe ran very few rules');
    assert.deepEqual(violations(pop), [], 'the Rooms tab popover, ' + theme);
    await page.keyboard.press('Escape');
    await shows(() => !document.querySelector('#rooms-features-pop').matches(':popover-open'));
    await page.click('#inspector [data-tab="properties"]');
  });
}

test('10. at 390 by 844 with touch the rows wrap, every target is 44 px and nothing scrolls sideways; at 844 by 390 the footer stays on screen', async () => {
  // one page at a time: a second page of the same browser hears the first one's saves
  await page.goto('about:blank');
  phone = await openPlanner({ hash: '#building', theme: 'light', width: 390, height: 844, mobile: true, browser: session.browser, server: session.server });
  const p = phone.page;
  await p.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const w7 = await import('./engine/w7-actions.js');
    globalThis.sv2.store.apply(actions.setOnboarding, { dismissed: true });
    globalThis.sv2.store.apply(w7.addCommonFeatures, undefined);
    for (let n = 9; n <= 14; n += 1) globalThis.sv2.store.apply(w7.addFeature, { name: 'A long feature name number ' + n });
    const editor = document.querySelector('.bld').editor;
    editor.select([editor.floor.spaces.find((space) => space.kind === 'room').id]);
  });
  await p.waitForSelector('#room-features-add');
  // the inspector is folded away on a phone until its handle is tapped
  if ((await p.$eval('#inspector', (el) => el.dataset.open)) !== 'true') await p.tap('#inspector-toggle');
  await p.waitForFunction(() => document.querySelector('#room-features-add').getBoundingClientRect().height > 0, { timeout: 8000 });
  await p.evaluate(() => document.querySelector('#room-features-add').scrollIntoView({ block: 'center' }));
  const fits = () => p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  const small = await fits();
  assert.ok(small.scroll <= small.width, 'the page fits at 390: ' + JSON.stringify(small));
  const fieldBox = await p.$eval('#room-features-add', (el) => ({ height: el.getBoundingClientRect().height, display: getComputedStyle(el).display, coarse: matchMedia('(pointer: coarse)').matches }));
  assert.ok(fieldBox.height >= 44, 'the combobox field is 44 px: ' + JSON.stringify(fieldBox));
  await p.focus('#room-features-add');
  await p.keyboard.type('s');
  const heights = await p.$$eval('#room-features-list [role="option"]', (all) => all.map((el) => el.getBoundingClientRect().height));
  assert.ok(heights.length > 0 && heights.every((height) => height >= 43.9), 'options are 44 px: ' + heights.join(', '));
  await p.keyboard.press('Escape');
  await p.$eval('#room-features-add', (el) => { el.value = ''; });
  const phoneChips = () => p.$$eval('#room-features-chips button', (all) => all.map((el) => el.querySelector('.bi-chip__name').textContent));
  const phoneSays = (words) => p.waitForFunction((wanted) => document.querySelector('#announcer')?.textContent === wanted, { timeout: 8000 }, words);
  // add by tap: type, then tap the option
  await p.tap('#room-features-add');
  await p.keyboard.type('Lab');
  await p.waitForSelector('#room-features-list [role="option"]');
  assert.equal(await p.$eval('#room-features-list [role="option"]', (el) => el.textContent), 'Lab');
  await p.tap('#room-features-list [role="option"]');
  await phoneSays('Lab added');
  assert.deepEqual(await phoneChips(), ['Lab']);
  // add by keyboard: an arrow, then Enter
  await p.keyboard.type('Sink');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await phoneSays('Sink added');
  assert.deepEqual(await phoneChips(), ['Lab', 'Sink']);
  const chipBoxes = await p.$$eval('#room-features-chips button', (all) => all.map((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height, right: box.right };
  }));
  assert.ok(chipBoxes.every((box) => box.height >= 43.9 && box.width >= 43.9 && box.right <= 390), 'the chips are 44 px and fit at 390: ' + JSON.stringify(chipBoxes));
  // remove by tap, then by keyboard
  await p.tap('#room-features-chips button');
  await p.waitForFunction(() => document.querySelectorAll('#room-features-chips button').length === 1, { timeout: 8000 });
  assert.deepEqual(await phoneChips(), ['Sink']);
  assert.equal(await p.evaluate(() => document.activeElement?.querySelector?.('.bi-chip__name')?.textContent || null), 'Sink', 'the focus goes to the next chip');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('#room-features-chips button').length === 0, { timeout: 8000 });
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'room-features-add', 'no chip left: the focus goes to the field');
  // the Rooms tab's popover at 390: on screen, with the field focused
  await p.tap('#inspector [data-tab="rooms"]');
  await p.waitForSelector('#rooms-table .bi-features-cell');
  await p.evaluate(() => document.querySelector('#rooms-table .bi-features-cell').scrollIntoView({ block: 'center' }));
  await p.tap('#rooms-table .bi-features-cell');
  await p.waitForFunction(() => document.querySelector('#rooms-features-pop')?.matches(':popover-open'), { timeout: 8000 });
  const popBox = await p.$eval('#rooms-features-pop', (el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, focus: document.activeElement?.id, field: document.querySelector('#rooms-features-add').getBoundingClientRect().height };
  });
  assert.ok(popBox.left >= 0 && popBox.right <= 390 && popBox.top >= 0 && popBox.bottom <= 844, 'the popover is on screen at 390: ' + JSON.stringify(popBox));
  assert.equal(popBox.focus, 'rooms-features-add');
  assert.ok(popBox.field >= 43.9, 'its field is 44 px');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('#rooms-features-pop').matches(':popover-open'), { timeout: 8000 });
  await p.tap('#inspector [data-tab="properties"]');
  await p.waitForSelector('#room-features-add');
  await p.evaluate(() => document.querySelector('#room-features-add').scrollIntoView({ block: 'center' }));
  await p.tap(key('feature-edit'));
  await p.waitForSelector('#features-dialog[open]');
  const seen = await p.evaluate(() => ({ features: (globalThis.sv2.store.project.building.features || []).length, rows: document.querySelectorAll('#features-rows li').length, empty: document.querySelector('#features-empty')?.hidden, dialogs: document.querySelectorAll('dialog[open]').length }));
  assert.ok(seen.rows > 0, 'the dialog lists the features: ' + JSON.stringify(seen));
  // a coarse pointer: no text field takes the focus, so the phone's keyboard does not rise over the list
  const focused = await p.evaluate(() => {
    const el = document.activeElement;
    return { coarse: matchMedia('(pointer: coarse)').matches, tag: el?.tagName, type: el?.type || null, key: el?.dataset?.key || null, inDialog: !!el?.closest('#features-dialog') };
  });
  const firstFeature = await p.evaluate(() => globalThis.sv2.store.project.building.features[0].id);
  assert.equal(focused.coarse, true, 'the phone has a coarse pointer');
  assert.ok(focused.inDialog && focused.tag !== 'INPUT' && focused.tag !== 'TEXTAREA', 'the focus is in the dialog, not in a text field: ' + JSON.stringify(focused));
  assert.equal(focused.key, 'down:' + firstFeature, 'the first control that is not a text field: the first row\u2019s Move down');
  const row = await p.$eval('#features-rows .features-row', (el) => {
    const name = el.querySelector('.features-row__name').getBoundingClientRect();
    const buttons = Array.from(el.querySelectorAll('.features-row__buttons .btn')).map((b) => b.getBoundingClientRect());
    return { nameBottom: name.bottom, buttonsTop: Math.min(...buttons.map((b) => b.top)), buttonHeights: buttons.map((b) => b.height), nameWidth: name.width, right: Math.max(...buttons.map((b) => b.right)) };
  });
  assert.ok(row.nameBottom <= row.buttonsTop + 1, 'the name is on top and the buttons wrap under it: ' + JSON.stringify(row));
  assert.ok(row.buttonHeights.every((height) => height >= 43.9), 'the row buttons are 44 px: ' + row.buttonHeights.join(', '));
  assert.ok(row.right <= 390, 'the row fits in the window');
  const wide = await fits();
  assert.ok(wide.scroll <= wide.width, 'the dialog does not scroll the page sideways: ' + JSON.stringify(wide));
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.querySelector('#features-dialog') === null);
  // landscape: the body scrolls and the Done button is on screen
  await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await p.waitForFunction(() => document.querySelector('#room-features-add').getBoundingClientRect().height > 0, { timeout: 8000 });
  await p.evaluate(() => document.querySelector('#room-features-add').scrollIntoView({ block: 'center' }));
  await p.tap(key('feature-edit'));
  await p.waitForSelector('#features-dialog[open]');
  const pinned = await p.evaluate(() => {
    const body = document.querySelector('#features-dialog .dialog__body');
    const buttons = document.querySelector('#features-dialog .dialog__buttons').getBoundingClientRect();
    return { scrolls: body.scrollHeight > body.clientHeight, bottom: buttons.bottom, top: buttons.top, window: window.innerHeight };
  });
  assert.ok(pinned.scrolls, 'the rows scroll inside the dialog');
  assert.ok(pinned.top >= 0 && pinned.bottom <= pinned.window, 'the Done button is on screen at 844 by 390: ' + JSON.stringify(pinned));
  await p.keyboard.press('Escape');
  await assertTouch(p, 'the phone');
});

test('11. no page errors, and nothing asked for outside the tool', async () => {
  assert.deepEqual(session.problems().errors, []);
  assert.deepEqual(phone.problems().errors, []);
  assert.deepEqual(session.offsite, []);
  assert.deepEqual(phone.offsite, []);
});
