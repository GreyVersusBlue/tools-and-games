// The Schedule section, in a real browser: node test/browser/schedule.mjs
//
// A group is entered from scratch by keyboard, a double-booking appears and is
// accepted with a reason, a period is moved by the row's menu and by drag,
// teachers are added and merged, subjects reordered, bells typed, a day type
// made the same as A Day and its own copy again, and the period count changed
// through the dialog that says what would be lost. Assertions are on what the
// page shows. The store is read only to choose what to type (which rooms are
// free in which period).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch } from './harness.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const HOSTILE = '<img src=x onerror=alert(1)> "quoted" 名前';

let server;
let browser;
let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const count = (selector) => page.$$eval(selector, (all) => all.length);
const activeKey = () => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
const activeValue = () => page.evaluate(() => document.activeElement.value);
const keyIs = (key) => page.waitForFunction((wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.activeElement && document.activeElement.dataset.key === wanted, { timeout: 5000 }, key);
const toastText = () => text('.toast .toast__text');
const counts = () => page.$eval('#inspector .sch-counts', (el) => [Number(el.dataset.problem), Number(el.dataset.warning), Number(el.dataset.note)]);
const slot = (day, period, part) => '.sch-day[data-day="' + day + '"] tr[data-period="' + period + '"] [data-key="slot:' + day + ':' + period + ':' + part + '"]';
const roomShown = (day, period) => page.$eval(slot(day, period, 'room'), (el) => el.value);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
// The tab draws again a moment after a change (data-pending says one is due).
// A person cannot act inside that moment; a test can, so it waits it out.
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
// A toast sits over the bottom-left of the section for six seconds; a person
// sees it and clicks beside it or closes it. The test closes it.
const click = async (selector) => {
  await settled();
  if (!selector.startsWith('.toast')) await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.click(selector);
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function selectAllAndType(value) {
  await settled();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  if (value === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(value);
}

async function selectGroup(name) {
  await page.evaluate((wanted) => {
    const button = Array.from(document.querySelectorAll('.sch-group')).find((el) => el.querySelector('.sch-group__name').textContent === wanted);
    button.click();
  }, name);
  await shows((wanted) => document.querySelector('.sch-editor__title')?.textContent === wanted, name);
}

// Rooms for a new group on A Day: in every period a numbered room nobody is
// in, except `clash`, where it is the room group 6A is in.
async function planRooms(clash) {
  return page.evaluate((dayId, clashAt) => {
    const project = globalThis.sv2.store.project;
    const rooms = project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room' && !space.shared && /^\d+$/.test(space.number));
    const plan = [];
    for (let period = 0; period < project.settings.periods; period += 1) {
      const used = new Set(project.groups.map((group) => group.days[dayId][period].room));
      if (period === clashAt) {
        const other = project.groups.find((group) => group.name === '6A').days[dayId][period].room;
        plan.push(rooms.find((room) => room.id === other).number);
      } else {
        plan.push(rooms.find((room) => !used.has(room.id) && !plan.includes(room.number)).number);
      }
    }
    return plan;
  }, DAY_A, clash);
}

// The server and the browser are started here, not by openPlanner, so that a
// page that fails to open still leaves something to close and the run ends.
before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/groups', theme: 'light', width: 1500, height: 1000 });
  page = session.page;
  await shows(() => getComputedStyle(document.querySelector('.sch')).containerType === 'inline-size');
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('the tabs are Groups, Grid, Teachers, Subjects, Day, Checks and Import, and the one that is coming says so', async () => {
  assert.deepEqual(await page.$$eval('#surface [role="tab"]', (all) => all.map((tab) => tab.textContent)), ['Groups', 'Grid', 'Teachers', 'Subjects', 'Day', 'Checks', 'Import']);
  await go(page, '#schedule/import');
  assert.equal(await text('#surface [role="tab"][aria-selected="true"]'), 'Import');
  await go(page, '#schedule/groups');
});

test('the sample school shows its groups with completeness, marks and the findings panel', async () => {
  assert.equal(await count('.sch-group'), 8);
  assert.equal(await page.$eval('.sch-group[data-group="gsample06c"] .sch-bar[data-day="' + DAY_A + '"]', (el) => el.dataset.done), '8');
  assert.equal(await page.$eval('.sch-group[data-group="gsample06c"] .sch-mark--problem', (el) => el.title), '1 problem');
  // the button's name is its content: the short figures are hidden from a screen reader, the words are not
  assert.equal(await page.$eval('.sch-group[data-group="gsample06c"]', (el) => el.hasAttribute('aria-label')), false);
  assert.equal(await page.$eval('.sch-group[data-group="gsample06c"]', (el) => Array.from(el.querySelectorAll('.sch-group__name, .vh')).map((part) => part.textContent).join('')),
    '6C, grade . 1 problem1 noteA Day: 8 of 8 periods have a room. B Day: 8 of 8 periods have a room. ');
  assert.deepEqual((await counts()).slice(0, 2), [1, 0]);
  assert.equal(await page.$eval('#inspector', (el) => el.hidden), false);
  assert.equal(await text('#inspector .sch-panel__scope'), 'About 6A');
  // a button that is not built yet says why, and can be reached to hear it
  assert.equal(await page.$eval('#inspector [data-action="fix"]', (el) => el.getAttribute('aria-disabled') + '|' + el.title + '|' + el.disabled), 'true|Suggestions are not built yet|false');
});

test('the room picker lists rooms as "204 — Mme. Dufrêne" and narrows as you type', async () => {
  await click(slot(DAY_A, 0, 'room'));
  await page.waitForSelector('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .picker__option');
  const options = await page.$$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .picker__option', (all) => all.map((el) => el.firstChild.textContent));
  assert.equal(options[0], 'No room');
  assert.ok(options.includes('204 — Mme. Dufrêne'), options.join(' | '));
  assert.ok(options.includes('Cafeteria'), 'a room with no teacher is its number alone');
  await page.keyboard.type('dufr');
  assert.deepEqual(await page.$$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .picker__option', (all) => all.map((el) => el.firstChild.textContent)), ['204 — Mme. Dufrêne']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await roomShown(DAY_A, 0), '201 — Ms. Oyelaran', 'Escape puts the room back');
  // text that is no room is refused in a sentence and stays to be fixed
  await selectAllAndType('zzz');
  await page.keyboard.press('Enter');
  assert.match(await text('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .sch-room .field__refusal'), /No room matches "zzz"/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await roomShown(DAY_A, 0), '201 — Ms. Oyelaran');
});

test('a group is entered from scratch by keyboard, and focus is never lost on the way', async () => {
  const plan = await planRooms(2);
  await settled();
  await page.focus('[data-action="add-group"]');
  await page.keyboard.press('Enter');
  await keyIs('group-name');
  assert.equal(await activeValue(), 'New group');
  await page.keyboard.type('8Z');
  await page.keyboard.press('Tab');
  await keyIs('group-grade');
  await shows(() => document.querySelector('.sch-editor__title').textContent === '8Z');
  await page.keyboard.type('8');
  await page.keyboard.press('Tab');
  await keyIs('group-head');
  await page.keyboard.type('22');
  await page.keyboard.press('Tab');
  // the colour presets are one stop, the custom colour another
  assert.match(await activeKey(), /^swatch:/);
  await page.keyboard.press('Tab');
  await keyIs('group-colour');
  await page.keyboard.press('Tab');
  for (let period = 0; period < plan.length; period += 1) {
    await keyIs('slot:' + DAY_A + ':' + period + ':room');
    if (period === 1) {
      // by the list: type part of it, arrow to it, Enter
      await page.keyboard.type(plan[period].slice(0, 2));
      await page.waitForSelector('.sch-day[data-day="' + DAY_A + '"] tr[data-period="1"] .picker__option');
      const labels = await page.$$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="1"] .picker__option', (all) => all.map((el) => el.firstChild.textContent));
      const at = labels.findIndex((label) => label.split(' — ')[0] === plan[period]);
      assert.notEqual(at, -1, 'the list has ' + plan[period] + ': ' + labels.join(' | '));
      for (let i = 0; i < at; i += 1) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await shows((selector, number) => document.querySelector(selector).value.split(' — ')[0] === number && document.activeElement === document.querySelector(selector), slot(DAY_A, period, 'room'), plan[period]);
      await page.keyboard.press('Tab');
    } else {
      // by its number: type it and leave the field
      await page.keyboard.type(plan[period]);
      await page.keyboard.press('Tab');
    }
    await keyIs('slot:' + DAY_A + ':' + period + ':label');
    await shows((selector, number) => document.querySelector(selector).value.split(' — ')[0] === number, slot(DAY_A, period, 'room'), plan[period]);
    if (period === 0) await page.keyboard.type('Homeroom');
    await page.keyboard.press('Tab');
    await keyIs('slot:' + DAY_A + ':' + period + ':teacher');
    await page.keyboard.press('Tab');
    await keyIs('slot:' + DAY_A + ':' + period + ':menu');
    await page.keyboard.press('Tab');
  }
  assert.equal(await page.$eval(slot(DAY_A, 0, 'label'), (el) => el.value), 'Homeroom');
  assert.equal(await page.$eval('.sch-group[aria-current="true"] .sch-bar[data-day="' + DAY_A + '"]', (el) => el.dataset.done), '8');
  assert.equal(await text('.sch-group[aria-current="true"] .sch-group__name'), '8Z');
  assert.equal(await page.$eval('.sch-group[aria-current="true"] .sch-group__grade', (el) => Array.from(el.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent).join('')), '8');
  assert.equal(await page.$eval('[data-key="group-head"]', (el) => el.value), '22');
});

test('the double-booking appears on the slot, on the group and in the panel as it is entered', async () => {
  const line = await text('.sch-day[data-day="' + DAY_A + '"] tr[data-period="2"] .sch-finding-line--problem');
  assert.match(line, /^● Problem: Room \d+ has two groups in Period 3 on A Day: 6A and 8Z\./);
  assert.equal(await page.$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="2"] .picker__input', (el) => document.getElementById(el.getAttribute('aria-describedby')).textContent.includes('has two groups')), true, 'the finding describes the room field');
  assert.equal(await exists('.sch-group[aria-current="true"] .sch-mark--problem'), true);
  assert.equal((await counts())[0], 2);
  assert.equal(await text('#inspector .sch-panel__scope'), 'About 8Z');
  assert.match(await text('#inspector .sch-finding--problem .sch-finding__text'), /6A and 8Z/);
});

test('a button clicked while a field still holds an uncommitted change gets its click', async () => {
  await click('[data-key="group-name"]');
  await selectAllAndType('8Y');
  // Pressing the button takes focus from the field, which commits, which
  // would draw the tab again and replace the button under the pointer. The
  // drawing has to wait until the pointer is up.
  const box = await (await page.$('[data-action="duplicate"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await pause(150);
    assert.equal(await page.$eval('.sch', (el) => el.dataset.pending), 'true', 'the drawing waits while the pointer is down');
    assert.equal(await text('.sch-editor__title'), '8Z', 'nothing has been drawn again yet');
  } finally {
    await page.mouse.up();
  }
  await shows(() => document.querySelector('.sch-editor__title')?.textContent === '8Y (Copy)');
  assert.equal(await count('.sch-group'), 10);
  await click('[data-action="delete"]');
  await shows(() => document.querySelectorAll('.sch-group').length === 9);
  assert.equal(await toastText(), 'Deleted group 8Y (Copy).');
  await selectGroup('8Y');
  await click('[data-key="group-name"]');
  await selectAllAndType('8Z');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('.sch-editor__title').textContent === '8Z');
});

test('a name already in use is refused under the field, and what was typed stays', async () => {
  await click('[data-key="group-name"]');
  await selectAllAndType('6a');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-editor__fields .field__refusal:not([hidden])');
  assert.match(await text('.sch-editor__fields .field__refusal:not([hidden])'), /6A/);
  assert.equal(await activeValue(), '6a');
  await page.keyboard.press('Escape');
  assert.equal(await activeValue(), '8Z');
});

test('a redraw does not take the text out from under someone typing', async () => {
  // a name that will be refused, so nothing but the field holds it
  await click('[data-key="group-name"]');
  await selectAllAndType('6a');
  // a change from somewhere else draws the tab again, which replaces the field
  await page.evaluate(() => import('./engine/actions.js').then((actions) => {
    const { store } = globalThis.sv2;
    store.apply(actions.editGroup, { id: store.project.groups.find((group) => group.name === '8Z').id, headCount: 23 });
  }));
  await shows(() => document.querySelector('[data-key="group-head"]').value === '23');
  await keyIs('group-name');
  assert.equal(await activeValue(), '6a');
  assert.equal(await text('.sch-editor__title'), '8Z', 'the taken name was not kept');
  // and the new field knows what was there before the typing
  await page.keyboard.press('Escape');
  assert.equal(await activeValue(), '8Z');
  await click('#undo');
  await shows(() => document.querySelector('[data-key="group-head"]').value === '22');
});

test('Accept needs a reason, moves the finding to the Accepted list and out of the counts', async () => {
  await go(page, '#schedule/checks');
  const row = '.sch-findings tr[data-severity="problem"]';
  const mine = await page.$$eval(row, (all) => all.findIndex((tr) => tr.textContent.includes('6A and 8Z')));
  assert.notEqual(mine, -1);
  const id = await page.$$eval(row, (all, at) => all[at].dataset.finding, mine);
  assert.match(id, /^room-double:/);
  await click('.sch-findings tr[data-finding="' + id + '"] [data-action="accept"]');
  await page.waitForSelector('#accept-dialog[open]');
  assert.equal(await text('#accept-dialog .dialog__title'), 'Accept this problem?');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'acceptReason');
  await page.keyboard.press('Enter');
  assert.equal(await exists('#accept-dialog[open]'), true, 'no reason, no accepting');
  assert.equal(await page.$eval('#accept-dialog .field__refusal', (el) => el.hidden), false);
  await click('#accept-dialog .btn--primary');
  assert.equal(await exists('#accept-dialog[open]'), true, 'the button asks for the reason too');
  await page.keyboard.type('Two half-classes share it');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('#accept-dialog') === null);
  await shows((wanted) => document.querySelector('.sch-findings--accepted tr[data-finding="' + wanted + '"]') !== null, id);
  assert.equal(await exists('.sch-findings:not(.sch-findings--accepted) tr[data-finding="' + id + '"]'), false);
  assert.match(await text('.sch-findings--accepted tr[data-finding="' + id + '"]'), /6A and 8Z.*Two half-classes share it/);
  assert.equal((await counts())[0], 1);
  assert.equal(await page.$eval('.sch-checks .sch-counts', (el) => el.dataset.problem), '1');
  // and back
  await click('.sch-findings--accepted tr[data-finding="' + id + '"] [data-action="unaccept"]');
  await shows(() => document.querySelector('#inspector .sch-counts').dataset.problem === '2');
  await click('#undo');
  await shows(() => document.querySelector('#inspector .sch-counts').dataset.problem === '1');
  assert.equal(await exists('.sch-findings--accepted tr[data-finding="' + id + '"]'), true);
});

test('the Accepted list says which records no longer stand: changed since accepted, check switched off, no longer found', async () => {
  await go(page, '#schedule/checks');
  const id = await page.$eval('.sch-findings--accepted tr[data-finding^="room-double:' + DAY_A + ':2:"]', (tr) => tr.dataset.finding);
  const open = '.sch-findings:not(.sch-findings--accepted) tr[data-finding="' + id + '"]';
  const kept = (state) => '.sch-findings--accepted tr[data-finding="' + id + '"]' + (state ? '[data-state="' + state + '"]' : '');
  const act = (fn, ...args) => page.evaluate(fn, ...args);
  assert.equal(await exists(open), false, 'accepted, so not in the findings');

  // a third group in the room: the finding names somebody else now
  await act((dayId, findingId) => {
    const { store } = globalThis.sv2;
    const roomId = findingId.split(':')[3];
    const third = store.project.groups.find((group) => group.name === '6B');
    return import('./engine/actions.js').then((actions) => store.apply(actions.setSlot, { groupId: third.id, dayTypeId: dayId, period: 2, slot: { room: roomId } }));
  }, DAY_A, id);
  await shows((selector) => document.querySelector(selector) !== null, open);
  await settled();
  assert.match(await text(open), /6A, 6B and 8Z/, 'it counts again, as it is now');
  assert.equal(await exists(kept('changed')), true, 'the record is listed as changed since accepted');
  assert.match(await text(kept('changed')), /^Changed since accepted\..*6A, 6B and 8Z.*Two half-classes share it/);
  assert.match(await text(kept('changed') + ' [data-action="unaccept"]'), /^Count it again/);
  await click(kept('changed') + ' [data-action="unaccept"]');
  await shows((selector) => document.querySelector(selector) === null, kept());
  assert.equal(await exists(open), true);
  assert.equal(await page.evaluate((findingId) => globalThis.sv2.store.project.accepted.some((record) => record.findingId === findingId), id), false, 'Count it again takes the record away');
  await click('#undo');
  await shows((selector) => document.querySelector(selector) !== null, kept('changed'));
  await click('#undo');
  await shows((selector) => document.querySelector(selector) === null, open);
  assert.equal(await exists(kept('changed')), false);

  // its check switched off: kept, and not called put right
  await act(() => {
    const { store } = globalThis.sv2;
    return import('./engine/actions.js').then((actions) => store.apply(actions.setSetting, { key: 'checks.off', value: ['room-double'] }));
  });
  await shows(() => document.querySelector('.sch-findings tr[data-finding^="room-double:"]:not([data-state])') === null);
  await settled();
  assert.equal(await exists(kept('off')), true, 'the record is listed with its check switched off');
  assert.match(await text(kept('off')), /^Its check is switched off: Two groups in one room\..*Two half-classes share it/);
  assert.doesNotMatch(await text(kept('off')), /put right/);
  assert.match(await text(kept('off') + ' [data-action="unaccept"]'), /^Remove/);
  await click('#undo');
  await shows((selector) => document.querySelector(selector) !== null, kept() + ':not([data-state])');

  // put right: gone, and the sentence does not speak of a check switched off
  await act((dayId) => {
    const { store } = globalThis.sv2;
    const group = store.project.groups.find((each) => each.name === '8Z');
    return import('./engine/actions.js').then((actions) => store.apply(actions.setSlot, { groupId: group.id, dayTypeId: dayId, period: 2, slot: { room: null, roomText: '' } }));
  }, DAY_A);
  await shows((selector) => document.querySelector(selector) !== null, kept('gone'));
  assert.equal(await page.$eval(kept('gone') + ' td', (td) => td.textContent), 'No longer found. What this was about has been put right.');
  await click('#undo');
  await shows((selector) => document.querySelector(selector) !== null, kept() + ':not([data-state])');
});

test('Accept hands the engine who the finding names, so a walk finding (which the engine cannot look up) keeps its list', async () => {
  // No walk figures reach this section yet, so no walk finding can be clicked.
  // The dialog is the real one; the store is a stand-in that keeps the payload.
  const payload = await page.evaluate(async () => {
    const { ctx } = globalThis.sv2;
    const { acceptWithReason } = await import('./ui/schedule/checks.js');
    let given = null;
    const env = { ctx: { ...ctx, openDialog: ctx.openDialog, toast() {}, undo() {}, store: { apply: (action, sent) => { given = sent; } } } };
    const finding = { id: 'group-walk:dsample00a:3:gsample06a', kind: 'group-walk', severity: 'warning', text: 'An invented walk that does not fit.', about: ['gsample06a'], where: { dayTypeId: 'dsample00a', period: 3, groupIds: ['gsample06a'], roomId: null, teacherId: null } };
    const done = acceptWithReason(env, finding, document.body);
    const input = document.querySelector('#accept-dialog [name="acceptReason"]');
    input.value = 'The corridor is short';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await done;
    return given;
  });
  assert.deepEqual(payload, { findingId: 'group-walk:dsample00a:3:gsample06a', reason: 'The corridor is short', about: ['gsample06a'] });
  await shows(() => document.querySelector('#accept-dialog') === null);
});

test('Show jumps to the slot, marks it and puts focus in it', async () => {
  await go(page, '#schedule/checks');
  await click('.sch-findings tr[data-finding^="room-double:' + DAY_A + ':1:"] [data-action="show"]');
  await shows(() => location.hash === '#schedule/groups' && document.querySelector('.sch-slot[data-shown="true"]') !== null);
  assert.equal(await text('.sch-editor__title'), '6C');
  assert.equal(await page.$eval('.sch-slot[data-shown="true"]', (el) => el.closest('.sch-day').dataset.day + ':' + el.dataset.period), DAY_A + ':1');
  await keyIs('slot:' + DAY_A + ':1:room');
  assert.equal(await count('.sch-slot[data-shown="true"]'), 1);
  // a finding about a teacher goes to the teacher's row
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const teacher = store.project.teachers[0];
    globalThis.sv2Kept = teacher.roomIds.slice();
    const other = store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'room' && !teacher.roomIds.includes(space.id));
    return import('./engine/actions.js').then((actions) => store.apply(actions.editTeacher, { id: teacher.id, roomIds: teacher.roomIds.concat([other.id]) }));
  });
  await go(page, '#schedule/checks');
  await page.waitForSelector('.sch-findings tr[data-finding^="teacher-multi-room:"]');
  await click('.sch-findings tr[data-finding^="teacher-multi-room:"] [data-action="show"]');
  await shows(() => location.hash === '#schedule/teachers' && document.querySelector('.sch-edit-table tr[data-shown="true"]') !== null);
  assert.equal(await page.$eval('.sch-edit-table tr[data-shown="true"]', (el) => el.dataset.teacher), 'tsample001');
  await click('#undo');
});

test('Move up and Move down are in each row’s menu, and a row drags onto another', async () => {
  await go(page, '#schedule/groups');
  await selectGroup('8Z');
  const before = [await roomShown(DAY_A, 0), await roomShown(DAY_A, 1), await roomShown(DAY_A, 3)];
  await settled();
  await page.focus(slot(DAY_A, 0, 'menu'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await page.$$eval('.menu [role="menuitem"]', (all) => all.map((el) => el.textContent.trim() + (el.getAttribute('aria-disabled') === 'true' ? ' (off)' : ''))), ['Move up (off)', 'Move down', 'Clear this period']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await keyIs('slot:' + DAY_A + ':1:menu');
  assert.deepEqual([await roomShown(DAY_A, 0), await roomShown(DAY_A, 1)], [before[1], before[0]]);
  assert.match(await text('#announcer'), /Moved Period 1’s assignment to Period 2/);
  // drag period 2's row (now holding what period 1 had) onto period 4
  await settled();
  const grip = await page.$('.sch-day[data-day="' + DAY_A + '"] tr[data-period="1"] .sch-grip');
  const target = await page.$('.sch-day[data-day="' + DAY_A + '"] tr[data-period="3"] .sch-slot__period');
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 10, { steps: 6 });
  assert.equal(await page.$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="3"]', (el) => el.classList.contains('is-drop')), true);
  await page.mouse.up();
  await shows((selector, wanted) => document.querySelector(selector).value === wanted, slot(DAY_A, 3, 'room'), before[0]);
  assert.equal(await roomShown(DAY_A, 1), before[2]);
  await click('#undo');
  await click('#undo');
  await shows((selector, wanted) => document.querySelector(selector).value === wanted, slot(DAY_A, 0, 'room'), before[0]);
});

test('Copy A Day to B Day fills the group’s B Day, and a teacher named on a slot shows as a chip', async () => {
  assert.equal(await page.$eval('.sch-group[aria-current="true"] .sch-bar[data-day="' + DAY_B + '"]', (el) => el.dataset.done), '0');
  await click('.sch-day[data-day="' + DAY_B + '"] [data-action="copy-day"]');
  await shows((day) => document.querySelector('.sch-group[aria-current="true"] .sch-bar[data-day="' + day + '"]').dataset.done === '8', DAY_B);
  assert.equal(await toastText(), 'Copied 8Z’s A Day to B Day.');
  assert.equal(await exists('.sch-day[data-day="' + DAY_A + '"] [data-action="copy-day"]'), false, 'the first day type has nothing to copy from');
  await click(slot(DAY_A, 4, 'teacher'));
  await page.keyboard.type('Dunmore');
  await page.keyboard.press('Enter');
  await shows((day) => document.querySelector('.sch-day[data-day="' + day + '"] tr[data-period="4"] .chip')?.textContent === 'Coach Dunmore', DAY_A);
  await keyIs('slot:' + DAY_A + ':4:teacher');
  await click('.sch-day[data-day="' + DAY_A + '"] tr[data-period="4"] .chip__remove');
  await shows((day) => document.querySelector('.sch-day[data-day="' + day + '"] tr[data-period="4"] .chip') === null, DAY_A);
});

test('the filter narrows the list by name or grade and keeps the caret', async () => {
  await click('[data-key="group-filter"]');
  await page.keyboard.type('7');
  await shows(() => document.querySelectorAll('.sch-group').length === 3);
  await page.keyboard.type('c');
  await shows(() => document.querySelectorAll('.sch-group').length === 1);
  assert.equal(await activeValue(), '7c', 'the second letter went after the first');
  assert.equal(await text('.sch-groups__tally'), '1 of 9 groups.');
  await page.keyboard.type('q');
  await shows(() => document.querySelectorAll('.sch-group').length === 0);
  assert.equal(await text('.sch-groups__tally'), 'No group matches “7cq”.');
  await selectAllAndType('');
  await shows(() => document.querySelectorAll('.sch-group').length === 9);
});

test('a name with markup in it is shown exactly as typed, everywhere it appears', async () => {
  await click('[data-key="group-name"]');
  await selectAllAndType(HOSTILE);
  await page.keyboard.press('Enter');
  await shows((wanted) => document.querySelector('.sch-editor__title').textContent === wanted, HOSTILE);
  assert.equal(await text('.sch-group[aria-current="true"] .sch-group__name'), HOSTILE);
  assert.equal(await text('#inspector .sch-panel__scope'), 'About ' + HOSTILE);
  assert.equal(await count('#surface img, #inspector img'), 0);
  await click('#undo');
  await shows(() => document.querySelector('.sch-editor__title').textContent === '8Z');
});

test('teachers: added by keyboard, a near-duplicate is flagged and merged, a taken name is refused', async () => {
  await go(page, '#schedule/teachers');
  assert.equal(await count('.sch-edit-table tbody tr'), 12);
  await settled();
  await page.focus('[data-action="add-teacher"]');
  await page.keyboard.press('Enter');
  await shows(() => /^teacher:.*:name$/.test(document.activeElement.dataset.key || '') && document.activeElement.value === 'New teacher');
  await page.keyboard.type('Ms Oyelaran');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-flag');
  assert.match(await text('.sch-flag p'), /^“Ms\. Oyelaran” and “Ms Oyelaran” look like the same teacher\./);
  assert.equal(await count('.sch-edit-table .sch-teachers__name .sch-finding-line--warning'), 2, 'both rows carry the flag');
  assert.equal(await text('.sch-flag [data-action="merge"]'), 'Merge into “Ms. Oyelaran”, and drop “Ms Oyelaran”');
  await click('.sch-flag [data-action="merge"]');
  await shows(() => document.querySelector('.sch-flag') === null && document.querySelectorAll('.sch-edit-table tbody tr').length === 12);
  assert.equal(await toastText(), 'Merged Ms Oyelaran into Ms. Oyelaran.');
  assert.match(await activeKey(), /^teacher:tsample\d+:name$/);
  // a name another teacher has
  await selectAllAndType('Ms. Halloran');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-edit-table .field__refusal:not([hidden])');
  assert.match(await text('.sch-edit-table .field__refusal:not([hidden])'), /Ms\. Halloran/);
  await page.keyboard.press('Escape');
});

test('teachers: subject, rooms and notes are edited in place, and the list exports as CSV', async () => {
  const row = '.sch-edit-table tr[data-teacher="tsample001"]';
  await settled();
  await page.select(row + ' select', 'ssample003');
  await shows((selector) => document.querySelector(selector + ' select').value === 'ssample003' && globalThis.sv2.store.undoLabel === 'Edit teacher Ms. Halloran', row);
  await click(row + ' .picker__input');
  await page.keyboard.type('302');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelectorAll(selector + ' .chip').length === 2, row);
  assert.deepEqual(await page.$$eval(row + ' .chip', (all) => all.map((chip) => chip.textContent)), ['101', '302']);
  await click(row + ' .chip:last-child .chip__remove');
  await shows((selector) => document.querySelectorAll(selector + ' .chip').length === 1, row);
  await click(row + ' input[name="teacherNotes"]');
  await page.keyboard.type('Part time, mornings');
  await page.keyboard.press('Tab');
  await shows((selector) => document.querySelector(selector + ' input[name="teacherNotes"]').value === 'Part time, mornings' && globalThis.sv2.store.project.teachers[0].notes === 'Part time, mornings', row);
  // the export: catch the file as it is handed to the browser
  await page.evaluate(() => {
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((body) => {
        globalThis.sv2Exported = body;
      });
      return make(blob);
    };
  });
  await click('[data-action="export"]');
  await shows(() => typeof globalThis.sv2Exported === 'string');
  const csv = await page.evaluate(() => globalThis.sv2Exported);
  assert.match(csv, /Ms\. Halloran,SCI,Science,101,"Part time, mornings"\r\n/);
  assert.match(await toastText(), /^Saved Marrowby Middle School \(sample\) - teachers - \d{4}-\d\d-\d\d\.csv to your downloads\.$/);
  assert.equal(await page.$eval('[data-action="import"]', (el) => el.getAttribute('href')), '#schedule/import');
});

test('subjects: reordered by keyboard and by drag, edited in place, and deleting one in use says who is left without', async () => {
  await go(page, '#schedule/subjects');
  const order = () => page.$$eval('.sch-edit-table tbody tr input[name="subjectCode"]', (all) => all.map((input) => input.value));
  const start = await order();
  assert.deepEqual(start.slice(0, 3), ['MATH', 'ENG', 'SCI']);
  await settled();
  await page.focus('[data-key="subject:ssample001:move"]');
  await page.keyboard.press('ArrowDown');
  await shows(() => document.querySelector('.sch-edit-table tbody tr input[name="subjectCode"]').value === 'ENG');
  await keyIs('subject:ssample001:move');
  assert.equal(await text('#announcer'), 'Mathematics is now 2 of 9.');
  await page.keyboard.press('ArrowDown');
  await shows(() => document.querySelectorAll('.sch-edit-table tbody tr')[2].dataset.subject === 'ssample001');
  assert.deepEqual((await order()).slice(0, 3), ['ENG', 'SCI', 'MATH']);
  // drag it back to the top
  await settled();
  const grip = await (await page.$('[data-key="subject:ssample001:move"]')).boundingBox();
  const top = await (await page.$('.sch-edit-table tbody tr')).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, top.y + top.height / 2, { steps: 6 });
  await page.mouse.up();
  await shows(() => document.querySelector('.sch-edit-table tbody tr').dataset.subject === 'ssample001');
  assert.deepEqual(await order(), start);
  // in place
  await click('.sch-edit-table tr[data-subject="ssample002"] input[name="subjectName"]');
  await selectAllAndType('English & Drama');
  await page.keyboard.press('Enter');
  await shows(() => globalThis.sv2.store.undoLabel === 'Rename subject to English & Drama');
  assert.match(await text('.sch-edit-table tr[data-subject="ssample001"] .sch-subjects__use'), /^2 rooms and 1 teacher$/);
  await click('.sch-edit-table tr[data-subject="ssample001"] [data-action="delete"]');
  await shows(() => document.querySelector('.sch-edit-table tr[data-subject="ssample001"]') === null);
  assert.equal(await toastText(), 'Deleted Mathematics. 2 rooms and 1 teacher now have no subject.');
  await click('.toast__action');
  await shows(() => document.querySelector('.sch-edit-table tr[data-subject="ssample001"]') !== null);
  await settled();
  await page.focus('[data-action="add-subject"]');
  await page.keyboard.press('Enter');
  await shows(() => /^subject:.*:code$/.test(document.activeElement.dataset.key || ''));
  assert.equal(await count('.sch-edit-table tbody tr'), 10);
  await click('#undo');
});

test('day: bell times are typed the way people write them, and a bad or half time is refused', async () => {
  await go(page, '#schedule/day');
  const end = '[data-key="bell:' + DAY_A + ':7:end"]';
  const start = '[data-key="bell:' + DAY_A + ':7:start"]';
  assert.equal(await page.$eval(end, (el) => el.value), '2:52 PM');
  await click(end);
  await selectAllAndType('3');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector).value === '3:00 PM' && globalThis.sv2.store.project.dayTypes[0].bells[7].end === '15:00', end);
  await selectAllAndType('1455');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector).value === '2:55 PM', end);
  await selectAllAndType('half past');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-bells .field__refusal:not([hidden])');
  assert.equal(await text('.sch-bells .field__refusal:not([hidden])'), '"half past" is not a time. Type it like 8:05 or 2:10 pm.');
  await selectAllAndType('');
  await page.keyboard.press('Enter');
  await shows(() => /needs both times/.test(document.querySelector('.sch-bells .field__refusal:not([hidden])')?.textContent || ''));
  await page.keyboard.press('Escape');
  // an end before its start warns and does not block
  await click(start);
  await selectAllAndType('3:30 pm');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-bells [data-bell="end-before-start"]');
  assert.match(await text('.sch-bells [data-bell="end-before-start"]'), /Period 8 ends at 2:55 PM, which is not after its start at 3:30 PM/);
  await click('#undo');
  await shows(() => document.querySelector('.sch-bells [data-bell="end-before-start"]') === null);
});

test('day: B Day made the same as A Day is greyed everywhere, and "Make its own copy" brings it back', async () => {
  const card = '.sch-daytype[data-day="' + DAY_B + '"]';
  await click(card + ' [data-action="revert"]');
  await shows((selector) => document.querySelector(selector).classList.contains('sch-daytype--same'), card);
  assert.match(await toastText(), /^B Day is the same as A Day again\. Its own \d+ room entries in 9 groups and 8 bell times went with that\.$/);
  assert.equal(await page.$eval(card + ' .sch-day__line', (el) => el.firstChild.textContent), 'B Day: same as A Day · ');
  assert.equal(await text(card + ' [data-action="make-own"]'), 'Make its own copy: B Day');
  assert.equal(await count(card + ' .sch-bells input'), 0, 'its bells are A Day’s, shown and not editable');
  assert.equal(await page.$eval(card + ' .sch-bells tbody tr td', (el) => el.textContent), '8:00 AM');
  await go(page, '#schedule/groups');
  const column = '.sch-day[data-day="' + DAY_B + '"]';
  assert.equal(await page.$eval(column, (el) => el.classList.contains('sch-day--same')), true);
  assert.equal(await text(column + ' .sch-day__title'), 'B Day: same as A Day');
  assert.equal(await count(column + ' input'), 0);
  assert.equal(await exists('[data-action="copy-day"]'), false, 'Copy A Day to B Day waits until B Day is its own copy');
  assert.equal(await text('.sch-group[aria-current="true"] .sch-bar--same [aria-hidden]'), 'B Day = A Day');
  await click(column + ' [data-action="make-own"]');
  await shows((selector) => !document.querySelector(selector).classList.contains('sch-day--same') && document.querySelector('[data-action="copy-day"]') !== null, column);
  assert.equal(await text('[data-action="copy-day"]'), 'Copy A Day to B Day');
  await click('#undo');
  await click('#undo');
  await shows((selector) => !document.querySelector(selector).classList.contains('sch-day--same'), column);
});

test('day: fewer periods asks first and says what would be lost; the period word changes every name', async () => {
  await go(page, '#schedule/day');
  await click('[data-key="day-periods"]');
  await selectAllAndType('6');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog .dialog__title'), 'Remove Period 7 and Period 8 from every day?');
  assert.match(await text('dialog.dialog .dialog__body'), /^That takes away \d+ room entries in 9 groups and 4 bell times\. Undo brings them back\.$/);
  assert.deepEqual(await page.$$eval('dialog.dialog .dialog__buttons button', (all) => all.map((button) => button.textContent)), ['Remove Period 7 and Period 8', 'Keep 8 periods']);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep 8 periods');
  await page.keyboard.press('Escape');
  await shows(() => document.querySelector('dialog.dialog') === null);
  assert.equal(await page.$eval('[data-key="day-periods"]', (el) => el.value), '8');
  assert.equal(await count('.sch-daytype[data-day="' + DAY_A + '"] .sch-bells tbody tr'), 8);
  await click('[data-key="day-periods"]');
  await selectAllAndType('6');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.dialog[open]');
  await click('dialog.dialog .btn--danger');
  await shows((day) => document.querySelectorAll('.sch-daytype[data-day="' + day + '"] .sch-bells tbody tr').length === 6, DAY_A);
  assert.match(await text('.sch-daytab .sch-lead'), /^The day is 6 periods long\./);
  await click('#undo');
  await shows((day) => document.querySelectorAll('.sch-daytype[data-day="' + day + '"] .sch-bells tbody tr').length === 8, DAY_A);
  // more periods loses nothing and does not ask
  await click('[data-key="day-periods"]');
  await selectAllAndType('9');
  await page.keyboard.press('Enter');
  await shows((day) => document.querySelectorAll('.sch-daytype[data-day="' + day + '"] .sch-bells tbody tr').length === 9, DAY_A);
  assert.equal(await exists('dialog.dialog'), false);
  await click('#undo');
  await click('[data-key="day-word:Block"]');
  await shows((day) => document.querySelector('.sch-daytype[data-day="' + day + '"] .sch-bells tbody th').textContent === 'Block A', DAY_A);
  assert.match(await text('.sch-daytab .sch-lead'), /^The day is 8 blocks long\./);
  assert.equal(await text('.sch-daytab__basics .field__label'), 'Blocks per day');
  await click('#undo');
});

test('an empty project: each tab says what the thing is and has one button', async () => {
  await page.evaluate(() => globalThis.sv2.ctx.removeSample());
  await go(page, '#schedule/groups');
  await shows(() => document.querySelector('.sch-groups .sch-empty') !== null);
  assert.equal(await text('.sch-groups .sch-empty__text'), 'No groups yet. A group is a set of students who travel together all day.');
  assert.deepEqual(await page.$$eval('.sch-groups button, .sch-groups a', (all) => all.map((el) => el.textContent)), ['Add a group']);
  assert.equal(await text('#inspector .sch-panel__none'), 'Nothing to check yet. Add a group and the checks start.');
  await go(page, '#schedule/teachers');
  assert.equal(await text('.sch-teachers .sch-empty__text'), 'No teachers yet. A teacher is a named member of staff, with a subject and one or more rooms.');
  assert.deepEqual(await page.$$eval('.sch-teachers button, .sch-teachers a', (all) => all.map((el) => el.textContent)), ['Add a teacher']);
  await go(page, '#schedule/checks');
  assert.match(await text('.sch-checks .sch-empty__text'), /^Nothing to check yet\. Checks look through the schedule/);
  assert.deepEqual(await page.$$eval('.sch-checks button, .sch-checks a', (all) => all.map((el) => el.textContent)), ['Add a group']);
  await click('.sch-checks [data-action="go-groups"]');
  await shows(() => location.hash === '#schedule/groups' && document.querySelector('.sch-groups [data-action="add-group"]') !== null);
  // the first group of a new project, and a room that is then missing from the building
  await click('[data-action="add-group"]');
  await keyIs('group-name');
  assert.equal(await count('.sch-group'), 1);
  assert.equal(await count('.sch-day'), 2);
  assert.equal(await text('.sch-day:last-child .sch-day__title'), 'B Day: same as A Day');
  await click('#undo');
  await shows(() => document.querySelector('.sch-groups .sch-empty') !== null);
  await click('#undo');
  await shows(() => document.querySelectorAll('.sch-group').length === 9);
});

test('a room that is no longer in the building stays on the slot, and says so', async () => {
  await page.evaluate((dayId) => {
    const { store } = globalThis.sv2;
    const group = store.project.groups.find((each) => each.name === '8Z');
    return import('./engine/actions.js').then((actions) => store.apply(actions.setSlot, { groupId: group.id, dayTypeId: dayId, period: 5, slot: { room: null, roomText: 'B12' } }));
  }, DAY_A);
  await selectGroup('8Z');
  await shows((selector) => document.querySelector(selector).value === 'B12 · not in the building', slot(DAY_A, 5, 'room'));
  assert.match(await text('.sch-day[data-day="' + DAY_A + '"] tr[data-period="5"] .sch-finding-line--warning'), /not in the building/);
  assert.equal(await page.$eval('.sch-group[aria-current="true"] .sch-bar[data-day="' + DAY_A + '"]', (el) => el.dataset.done), '8', 'it still counts as entered');
});
