// Auto-number in the planner, in a real browser: node test/browser/auto-number.mjs
//
// With the Room tool in hand the options row shows an Auto-number switch and,
// once it is on, a Next number field (SPEC 4.3's wish, ARCHITECTURE 22.5,
// DESIGN 16.3 and 16.12 item 5). This file draws three rooms by pointer and
// three by the keyboard alone and watches the numbers, the status line, the
// live region and the toasts; checks that a number is part of the drawing's one
// undo step and that Undo steps the next number back; that typing into the room
// just drawn re-seats the sequence and typing into another room never does;
// that a taken number is skipped and said; that a Next number with no digits is
// refused in words while rooms are drawn without numbers; that the device
// remembers the switch; and, on a 390 px page with a finger, that the number
// appears with no keyboard-raising focus and the toast carries it. Every wait is
// on a state the page sets (the entry count, the plan at rest), never on a
// first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, still } from './harness.mjs';
import { startEmpty, planReady, point, click, state, clearToast } from './draw-pointer.mjs';

let session;
let page;
let phone = null;

const text = (target, selector) => target.$eval(selector, (el) => el.textContent);
const value = (target, selector) => target.$eval(selector, (el) => el.value);
const numbers = (target) => target.evaluate(() => globalThis.sv2.store.project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((room) => room.number)));
const hint = (target) => text(target, '#plan-hint');
const said = (target) => text(target, '#announcer');

// the store has taken one more entry than `before`
async function entriesAre(target, wanted) {
  await target.waitForFunction((n) => globalThis.sv2.store.history.past.length === n, { timeout: 5000 }, wanted);
}

// Puppeteer has no fill(): the field's text replaced by typing over a selection
async function setField(target, selector, wanted) {
  await target.focus(selector);
  await target.$eval(selector, (el) => el.select());
  await target.keyboard.type(wanted);
}

async function pressRoomTool(target) {
  await target.click('[data-tool="room"]');
  await target.waitForFunction(() => document.querySelector('.bld').editor.tool.id === 'room');
}

async function clickCell(x, y) {
  const before = (await state(page)).entries;
  await click(page, x, y);
  await entriesAre(page, before + 1);
}

before(async () => {
  session = await openPlanner({ theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await startEmpty(page);
  await page.evaluate(() => localStorage.removeItem('sv2:device'));
});

after(async () => {
  if (phone) await phone.close();
  if (session) await session.close();
});

test('the options row is there with the Room tool only, and Auto-number is off to begin with', async () => {
  assert.equal(await page.$eval('#plan-options', (el) => el.hidden), true, 'Corridor is the tool on an empty floor: no options row');
  await pressRoomTool(page);
  assert.equal(await page.$eval('#plan-options', (el) => el.hidden), false);
  assert.equal(await page.$eval('#auto-number', (el) => el.checked), false);
  assert.equal(await page.$eval('#auto-number', (el) => el.getAttribute('role')), 'switch');
  assert.equal(await page.$eval('#next-number-field', (el) => el.hidden), true, 'the Next number field waits for the switch');
  assert.equal(await text(page, '.bld-options__toggle'), 'Auto-number');
  await page.click('[data-tool="select"]');
  assert.equal(await page.$eval('#plan-options', (el) => el.hidden), true, 'another tool, no row');
});

test('picking and leaving the Room tool, the switch on or off, never resizes the plan or moves the view: the row lies over the plan', async () => {
  const look = () => page.evaluate(() => {
    const box = document.querySelector('.bld-stage').getBoundingClientRect();
    const view = document.querySelector('.bld').editor.view;
    return { size: box.width + ' by ' + box.height, top: box.top, view: [view.zoom, view.x, view.y].join(' ') };
  });
  const first = await look();
  await pressRoomTool(page);
  assert.deepEqual(await look(), first, 'the Room tool picked');
  const row = await page.$eval('#plan-options', (el) => { const r = el.getBoundingClientRect(); const stage = document.querySelector('.bld-stage').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, stageTop: stage.top, stageBottom: stage.bottom }; });
  assert.ok(row.top >= row.stageTop && row.bottom <= row.stageBottom, 'the row is inside the plan\'s box: ' + JSON.stringify(row));
  await page.click('#auto-number');
  assert.deepEqual(await look(), first, 'the switch on, Next number shown');
  await page.click('#auto-number');
  await page.click('[data-tool="select"]');
  assert.deepEqual(await look(), first, 'the Room tool left');
  await page.keyboard.press('r');
  await page.keyboard.press('c');
  assert.deepEqual(await look(), first, 'by its keys too');
});

test('turning it on shows Next number, 7 characters wide and 44 px tall, with its hint, and the device remembers it', async () => {
  await pressRoomTool(page);
  await page.click('#auto-number');
  assert.equal(await page.$eval('#next-number-field', (el) => el.hidden), false);
  assert.equal(await value(page, '#next-number'), '101', 'an empty Floor 1 starts at 101');
  assert.equal(await text(page, 'label[for="next-number"]'), 'Next number');
  assert.equal(await page.$eval('#next-number', (el) => el.getAttribute('inputmode')), 'text');
  assert.equal(await page.$eval('#next-number', (el) => el.size), 7);
  const box = await page.$eval('#next-number', (el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  assert.ok(box.height >= 44, 'at least 44 px tall: ' + box.height);
  assert.equal(await text(page, '#next-number-hint'), 'Starts after the highest number on this floor.');
  assert.match(await said(page), /^Auto-number is on\. Next: 101\.$/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).autoNumber), true);
});

test('drawing three rooms by pointer: each has the next number, one undo step, the number field focused, the status line and the live region say it', async () => {
  await still(page);
  const expected = ['101', '102', '103'];
  for (const [n, number] of expected.entries()) {
    const before = (await state(page)).entries;
    await click(page, 4 + n * 4, 3);
    await entriesAre(page, before + 1);
    const now = await state(page);
    assert.equal(now.entries, before + 1, 'drawing and numbering are one undo step');
    assert.deepEqual((await numbers(page)).slice(-1), [number]);
    assert.equal(now.hint, 'Room ' + number + ' drawn. Next: ' + String(Number(number) + 1) + '.');
    assert.equal(now.said, 'Room ' + number + ' drawn. Next: ' + String(Number(number) + 1) + '.');
    assert.equal(now.focus, 'room-number', 'the number field takes the focus');
    assert.equal(await page.evaluate(() => { const input = document.activeElement; return input.value.slice(input.selectionStart, input.selectionEnd); }), number, 'with its text selected, so typing replaces it');
    assert.equal(await value(page, '#next-number'), String(Number(number) + 1));
    // back to the plan for the next one
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).focus, 'plan');
    await clearToast(page);
  }
  assert.deepEqual(await numbers(page), expected);
});

test('Undo of a drawn room takes its number out and steps Next back; Redo puts it back and steps Next on again', async () => {
  await page.evaluate(() => globalThis.sv2.store.undo());
  await entriesAre(page, (await state(page)).entries);
  assert.deepEqual(await numbers(page), ['101', '102']);
  assert.equal(await value(page, '#next-number'), '103', 'Next is back at 103');
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.equal(await value(page, '#next-number'), '102');
  assert.deepEqual(await numbers(page), ['101']);
  await page.evaluate(() => globalThis.sv2.store.redo());
  assert.deepEqual(await numbers(page), ['101', '102']);
  assert.equal(await value(page, '#next-number'), '103', 'Redo of 102 steps Next on to 103');
  await page.evaluate(() => globalThis.sv2.store.redo());
  assert.deepEqual(await numbers(page), ['101', '102', '103']);
  assert.equal(await value(page, '#next-number'), '104', 'and of 103, to 104');
  // the next room drawn is 104, with no word of a number taken
  await clickCell(16, 3);
  assert.deepEqual((await numbers(page)).slice(-1), ['104']);
  assert.match(await state(page).then((s) => s.said), /^Room 104 drawn\. Next: 105\.$/, 'its own number is not "taken"');
  assert.equal(await value(page, '#next-number'), '105');
  await page.keyboard.press('Enter');
  await clearToast(page);
  // Undo and Redo of 104 again: back to 104, then on to 105
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.equal(await value(page, '#next-number'), '104');
  await page.evaluate(() => globalThis.sv2.store.redo());
  assert.equal(await value(page, '#next-number'), '105');
});

test('a Next number that is taken is skipped, and said in the status line and the toast', async () => {
  await setField(page, '#next-number', '102');
  await page.focus('#plan');
  await clickCell(16, 6);
  assert.deepEqual((await numbers(page)).slice(-1), ['105']);
  assert.match(await state(page).then((s) => s.said), /^102 is taken; this is 105\. Room 105 drawn\. Next: 106\.$/);
  assert.equal(await state(page).then((s) => s.toast), '102 is taken; this is 105', 'a skip is in the toast as well');
  assert.equal(await value(page, '#next-number'), '106');
  await page.keyboard.press('Enter');
  await clearToast(page);
  // the room is undone, so the next test's numbers are as they were
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.equal(await value(page, '#next-number'), '102', 'Undo puts back the Next that was typed');
  await setField(page, '#next-number', '105');
  await page.focus('#plan');
});

test('under another tool, the cell menu\'s "Place a room here" places a room with no number, the switch on or not, and Next stays', async () => {
  assert.equal(await page.$eval('#auto-number', (el) => el.checked), true);
  await page.click('[data-tool="select"]');
  await page.waitForFunction(() => document.querySelector('.bld').editor.tool.id === 'select');
  const at = await point(page, 36, 12);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.menu[role="menu"]');
  const before = (await state(page)).entries;
  await page.evaluate(() => Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((each) => each.textContent.trim() === 'Place a room here').click());
  await entriesAre(page, before + 1);
  assert.deepEqual((await numbers(page)).slice(-1), [''], 'no number: the switch is not on screen');
  assert.match(await state(page).then((s) => s.said), /^Placed a room, 1 by 1\. Type its number\.$/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await pressRoomTool(page);
  assert.equal(await value(page, '#next-number'), '105', 'Next has not moved');
  await page.focus('#plan');
});

test('typing a number into the room just drawn re-seats the sequence; typing into another room never does', async () => {
  // the room just drawn is 104: it is renumbered 110, and Next follows
  await clickCell(20, 3);
  assert.deepEqual((await numbers(page)).slice(-1), ['105']);
  await page.evaluate(() => {
    globalThis.spoken = [];
    new MutationObserver((records) => { for (const record of records) for (const node of record.addedNodes) globalThis.spoken.push(node.textContent); }).observe(document.getElementById('announcer'), { childList: true, characterData: true, subtree: true });
  });
  await page.keyboard.type('110');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('next-number').value === '111');
  assert.equal(await hint(page), 'Next: 111.');
  assert.ok((await page.evaluate(() => globalThis.spoken)).includes('Next: 111.'), 'the live region said it too');
  // another room: 101 becomes 500 and Next stays
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const room = store.project.building.floors[0].spaces.find((space) => space.number === '101');
    store.apply(actions.setRoomFields, { roomId: room.id, number: '500' });
  });
  assert.equal(await value(page, '#next-number'), '111', 'typing into another room never moves the sequence');
  await clickCell(24, 3);
  assert.deepEqual((await numbers(page)).slice(-1), ['111']);
  await page.keyboard.press('Enter');
  await clearToast(page);
});

test('the Next number field is the user\'s: typed, it is the next room\'s number; one with no digits is refused in words and rooms come without numbers', async () => {
  await setField(page, '#next-number', '300');
  await clickCell(28, 3);
  assert.deepEqual((await numbers(page)).slice(-1), ['300']);
  await page.keyboard.press('Enter');
  await setField(page, '#next-number', 'Gym');
  assert.equal(await text(page, '#next-number-note'), 'Auto-number needs digits, such as 101');
  assert.equal(await page.$eval('#next-number', (el) => el.getAttribute('aria-invalid')), 'true');
  assert.equal(await page.$eval('#auto-number', (el) => el.checked), true, 'the switch stays on');
  await clickCell(32, 3);
  assert.deepEqual((await numbers(page)).slice(-1), [''], 'drawn without a number');
  await page.keyboard.press('Escape');
  await setField(page, '#next-number', '400');
  assert.equal(await page.$eval('#next-number-note', (el) => el.hidden), true, 'put right, the refusal goes');
});

test('drawing three rooms by the keyboard alone: Enter on a cell numbers the room, Enter in the number field returns to the plan', async () => {
  await setField(page, '#next-number', '700');
  await page.focus('#plan');
  const before = (await state(page)).entries;
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(4, 8));
  const got = [];
  for (let n = 0; n < 3; n += 1) {
    await page.keyboard.press('Enter');
    await entriesAre(page, before + n + 1);
    assert.equal((await state(page)).focus, 'room-number');
    got.push((await numbers(page)).slice(-1)[0]);
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).focus, 'plan');
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual(got, ['700', '701', '702']);
  assert.equal(await value(page, '#next-number'), '703');
  assert.match(await hint(page), /^Room 702 drawn\. Next: 703\.$/);
});

test('Auto-number off: a room comes without a number; the switch is the device\'s and is back after a reload', async () => {
  await page.click('#auto-number');
  assert.equal(await page.$eval('#next-number-field', (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).autoNumber), false);
  assert.equal(await said(page), 'Auto-number is off.');
  await page.click('#auto-number');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).autoNumber), true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await planReady(page);
  await pressRoomTool(page);
  assert.equal(await page.$eval('#auto-number', (el) => el.checked), true, 'on after a reload');
});

test('on a phone, with a finger: the row fits, the number appears without the keyboard-raising focus, and the toast carries it', async () => {
  phone = await openPlanner({ theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  await startEmpty(p);
  await p.evaluate(() => localStorage.removeItem('sv2:device'));
  await pressRoomTool(p);
  await p.click('#auto-number');
  await still(p);
  const fit = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, options: document.getElementById('plan-options').getBoundingClientRect().right }));
  assert.ok(fit.scroll <= fit.width, 'no sideways scroll at 390: ' + fit.scroll + ' > ' + fit.width);
  assert.ok(fit.options <= fit.width + 0.5, 'the options row is inside the window');
  const heights = await p.evaluate(() => ['.bld-options__toggle', '#next-number'].map((selector) => document.querySelector(selector).getBoundingClientRect().height));
  assert.ok(heights.every((height) => height >= 44), 'every control of the row is at least 44 px: ' + heights.join(', '));
  const entriesBefore = (await state(p)).entries;
  const at = await point(p, 6, 4);
  await p.touchscreen.tap(at.x, at.y);
  await entriesAre(p, entriesBefore + 1);
  assert.deepEqual(await numbers(p), ['101']);
  const now = await state(p);
  assert.notEqual(now.focus, 'room-number', 'a finger drew it: the keyboard would cover the plan');
  assert.equal(now.toast, 'Room 101', 'the toast always carries the number on touch');
  assert.equal(now.said, 'Room 101 drawn. Next: 102.');
  assert.equal(await value(p, '#next-number'), '102');
});
