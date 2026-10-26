// Day types and bell schedules, in a real browser: node test/browser/day-types.mjs
//
// DESIGN 11.3 and 11.6 by pointer, keyboard and touch. On the sample school a
// C Day is added from the Day tab, a name another day type has is refused, a
// short name is typed and a duplicate refused, C Day is made the same as B
// Day through Change… and back, classes are copied onto it, day types move by
// the row's menu and by drag, one is deleted and brought back, and an Early
// Release bell schedule is made with periods 5 to 8 not meeting. Then twelve
// day types: the reason Add is off, the group editor's Show chips and the
// grid's Day type choice, both kept on this device, at 1280 and at 390 px
// with touch. Last, the Day tab by keyboard alone. Every wait is on a state
// the page sets (`data-pending` gone from the section, a dialog open or
// gone), never on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch, loadModule } from './harness.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const GROUP = 'gsample06a';

let server;
let browser;
let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const count = (selector) => page.$$eval(selector, (all) => all.length);
const activeKey = () => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
const keyIs = (key) => page.waitForFunction((wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.activeElement && document.activeElement.dataset.key === wanted, { timeout: 5000 }, key);
const toastText = () => text('.toast .toast__text');
const rowOrder = () => page.$$eval('.sch-dtrow', (all) => all.map((row) => row.querySelector('input[name="dayTypeName"]').value));
const radios = (selector) => page.$$eval(selector + ' input[type="radio"]', (all) => all.map((radio) => radio.parentNode.textContent + (radio.checked ? ' (checked)' : '')));
const menuItems = () => page.$$eval('.menu__item', (all) => all.map((item) => item.textContent + (item.getAttribute('aria-disabled') === 'true' ? ' (off)' : '')));
const dayIds = () => page.evaluate(() => globalThis.sv2.store.project.dayTypes.map((dayType) => dayType.id));
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());

// A toast sits over the bottom-left of the section for six seconds; a person
// sees it and clicks beside it. The test closes it first.
async function click(selector) {
  await settled();
  if (!selector.startsWith('.toast')) await closeToast();
  await page.click(selector);
}

async function selectAllAndType(value) {
  await settled();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  if (value === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(value);
}

async function pickFromMenu(opener, label) {
  await click(opener);
  await page.waitForSelector('.menu[role="menu"]');
  await page.evaluate((wanted) => Array.from(document.querySelectorAll('.menu__item')).find((item) => item.textContent === wanted).click(), label);
}

// Day types put in by the store, for the screens that need many: `names`
// with their own classes (copies of A Day), then any `same` as B Day.
async function addByStore(own, same) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((ownNames, sameNames) => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    for (const name of ownNames) store.apply(actions.addDayType, { name, own: true });
    for (const name of sameNames) store.apply(actions.addDayType, { name, own: false, sameAs: store.project.dayTypes[1].id });
  }, own, same || []);
  await settled();
}

// Back to the sample school as it loads.
async function freshSample() {
  await page.evaluate(() => globalThis.sv2.ctx.loadSample());
  await page.evaluate(() => document.querySelector('dialog[open] .btn--danger, dialog[open] .btn--primary')?.click());
  await shows(() => globalThis.sv2.store.project.dayTypes.length === 2 && globalThis.sv2.store.project.groups.length === 8);
  await settled();
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await settled();
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('the Day tab is four cards: the school day, day types, regular bells, other bell schedules', async () => {
  assert.deepEqual(await page.$$eval('.sch-daytab .sch-card__title', (all) => all.map((el) => el.textContent)), ['The school day', 'Day types', 'Regular bells', 'Other bell schedules']);
  assert.deepEqual(await rowOrder(), ['A Day', 'B Day']);
  assert.equal(await text('.sch-dtrow[data-day="' + DAY_A + '"] .sch-dtrow__kind'), 'A Day comes first');
  assert.equal(await exists('.sch-dtrow[data-day="' + DAY_A + '"] .sch-grip'), false, 'the first day type does not move');
  assert.equal(await page.$eval('[data-key="daytype:' + DAY_A + ':short"]', (el) => el.placeholder), 'A', 'the short name worked out from the name is the placeholder');
  // other bell schedules, none yet: the sentence and the Add button only
  assert.equal(await count('.sch-card[data-card="other-bells"] .sch-bsched'), 0);
  assert.deepEqual(await page.$$eval('.sch-card[data-card="other-bells"] button', (all) => all.map((el) => el.textContent)), ['Add a bell schedule']);
});

test('adding a C Day: the form suggests the name, Add copies A Day, the toast says so and the count goes up', async () => {
  assert.equal(await text('.sch-dtadd__count'), '2 of 12');
  assert.equal(await page.$eval('[data-key="daytype-add-name"]', (el) => el.value), 'C Day');
  assert.deepEqual(await radios('.sch-dtadd'), ['Its own classes, starting as a copy of A Day (checked)', 'Same as A Day', 'Same as B Day']);
  await click('.sch-dtadd [data-action="add-day-type"]');
  await shows(() => document.querySelectorAll('.sch-dtrow').length === 3);
  assert.equal(await toastText(), 'Added C Day, a copy of A Day.');
  assert.deepEqual(await rowOrder(), ['A Day', 'B Day', 'C Day']);
  assert.equal(await text('.sch-dtadd__count'), '3 of 12');
  assert.equal(await page.$eval('[data-key="daytype-add-name"]', (el) => el.value), 'D Day', 'the next free name is suggested');
  await keyIs('daytype-add-name');
  const dayC = (await dayIds())[2];
  // its bells are a copy of A Day's, in a table of its own
  assert.equal(await page.$eval('[data-key="bell:' + dayC + ':0:start"]', (el) => el.value), '8:00 AM');
  // a name another day type has, typed in the form, is refused under it
  await click('[data-key="daytype-add-name"]');
  await selectAllAndType('b  DAY');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('.sch-dtadd .field__refusal') !== null);
  assert.equal(await text('.sch-dtadd .field__refusal'), 'There is already a day type called "B Day". Day type names are unique, whatever the capitals and spaces; type a different name.');
  assert.equal(await page.$eval('[data-key="daytype-add-name"]', (el) => el.value), 'b  DAY', 'what was typed stays to be fixed');
  assert.equal(await count('.sch-dtrow'), 3);
});

test('a rename to another day type’s name is refused whatever the capitals and spaces, and short names are each their own', async () => {
  const dayC = (await dayIds())[2];
  const name = '[data-key="daytype:' + dayC + ':name"]';
  await click(name);
  await selectAllAndType('a day');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector)?.closest('.field').querySelector('.field__refusal:not([hidden])') !== null, name);
  assert.equal(await page.$eval(name, (el) => el.closest('.field').querySelector('.field__refusal').textContent), 'There is already a day type called "A Day". Day type names are unique, whatever the capitals and spaces; type a different name.');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval(name, (el) => el.value), 'C Day');
  // a short name typed, then the same typed for another: refused
  const shortC = '[data-key="daytype:' + dayC + ':short"]';
  const shortB = '[data-key="daytype:' + DAY_B + ':short"]';
  await click(shortC);
  await page.keyboard.type('Cee');
  await page.keyboard.press('Enter');
  await shows(() => globalThis.sv2.store.undoLabel === 'Change the short name of C Day');
  await click(shortB);
  await page.keyboard.type('CEE');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector)?.closest('.field').querySelector('.field__refusal:not([hidden])') !== null, shortB);
  assert.equal(await page.$eval(shortB, (el) => el.closest('.field').querySelector('.field__refusal').textContent), '"Cee" is already the short name of C Day. Each day type has its own; type another, or leave it empty to have one worked out.');
  await page.keyboard.press('Escape');
  // five characters is one too many for a date in the calendar
  await click(shortB);
  await selectAllAndType('BBBBB');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector)?.closest('.field').querySelector('.field__refusal:not([hidden])') !== null, shortB);
  assert.match(await page.$eval(shortB, (el) => el.closest('.field').querySelector('.field__refusal').textContent), /^A short name is at most 4 characters/);
  await page.keyboard.press('Escape');
  // emptied, the worked-out one is back as the placeholder
  await click(shortC);
  await selectAllAndType('');
  await page.keyboard.press('Enter');
  await shows((selector) => document.querySelector(selector)?.value === '' && document.querySelector(selector).placeholder === 'C', shortC);
});

test('Change… makes C Day the same as B Day: the button says what goes, the toast what went, and Undo brings it back', async () => {
  const dayC = (await dayIds())[2];
  const row = '.sch-dtrow[data-day="' + dayC + '"]';
  await click(row + ' [data-action="change-kind"]');
  await page.waitForSelector('#day-kind-dialog[open]');
  assert.equal(await text('#day-kind-dialog .dialog__title'), 'Change what C Day is');
  assert.deepEqual(await radios('#day-kind-dialog'), ['Its own classes (checked)', 'Same as A Day', 'Same as B Day']);
  await page.click('#day-kind-dialog input[value="' + DAY_B + '"]');
  assert.equal(await text('#day-kind-dialog .btn--primary'), 'Make C Day the same as B Day (8 groups’ days on C Day and its 8 bell times go; Undo brings them back)');
  await page.click('#day-kind-dialog .btn--primary');
  await shows((selector) => document.querySelector(selector)?.classList.contains('sch-dtrow--same'), row);
  assert.equal(await toastText(), 'C Day is the same as B Day now. Its own classes for 8 groups went with that.');
  assert.equal(await text(row + ' .sch-dtrow__kind'), 'Same as B Day');
  assert.equal(await text('.sch-followers__line[data-day="' + dayC + '"]'), 'C Day: B Day’s bells');
  // the add form offers only day types with their own classes to follow
  assert.deepEqual(await radios('.sch-dtadd'), ['Its own classes, starting as a copy of A Day (checked)', 'Same as A Day', 'Same as B Day']);
  // back by the toast's Undo
  await click('.toast__action');
  await shows((selector) => !document.querySelector(selector).classList.contains('sch-dtrow--same'), row);
  assert.equal(await text(row + ' .sch-dtrow__kind'), 'Its own classes');
  // and Cancel changes nothing
  await click(row + ' [data-action="change-kind"]');
  await page.waitForSelector('#day-kind-dialog[open]');
  await page.click('#day-kind-dialog input[value="' + DAY_A + '"]');
  await page.keyboard.press('Escape');
  await shows(() => document.querySelector('#day-kind-dialog') === null);
  assert.equal(await activeKey(), 'daytype:' + dayC + ':change', 'the focus goes back to Change…');
  assert.equal(await text(row + ' .sch-dtrow__kind'), 'Its own classes');
});

test('Copy classes from… in a row’s menu copies another day type onto it for every group, as one step', async () => {
  const dayC = (await dayIds())[2];
  await pickFromMenu('[data-key="daytype:' + dayC + ':menu"]', 'Copy classes from…');
  await page.waitForSelector('#day-copy-dialog[open]');
  assert.deepEqual(await radios('#day-copy-dialog'), ['A Day (checked)', 'B Day']);
  await page.click('#day-copy-dialog input[value="' + DAY_B + '"]');
  assert.equal(await text('#day-copy-dialog .btn--primary'), 'Copy B Day’s classes onto C Day for every group');
  await page.click('#day-copy-dialog .btn--primary');
  await shows(() => document.querySelector('#day-copy-dialog') === null && document.querySelector('.toast .toast__text') !== null);
  assert.equal(await toastText(), 'Copied B Day’s classes onto C Day for every group.');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Copy B Day to C Day for every group');
  // the group editor shows B Day's rooms on C Day (C Day's slot address
  // shows its column beside one of the others)
  await go(page, '#schedule/groups/' + GROUP + '/' + DAY_B + '/2');
  await keyIs('slot:' + DAY_B + ':2:room');
  const onB = await page.$eval('[data-key="slot:' + DAY_B + ':2:room"]', (el) => el.value);
  await go(page, '#schedule/groups/' + GROUP + '/' + dayC + '/2');
  await keyIs('slot:' + dayC + ':2:room');
  assert.equal(await page.$eval('[data-key="slot:' + dayC + ':2:room"]', (el) => el.value), onB);
  await go(page, '#schedule/day');
  await settled();
});

test('day types move by the row’s menu and by a drag; the first stays first; Delete says what went and Undo brings it back', async () => {
  // the name refused before is still in the form, with its sentence, to be fixed
  assert.equal(await page.$eval('[data-key="daytype-add-name"]', (el) => el.value), 'b  DAY');
  await click('[data-key="daytype-add-name"]');
  await selectAllAndType('D Day');
  await click('.sch-dtadd [data-action="add-day-type"]');
  await shows(() => document.querySelectorAll('.sch-dtrow').length === 4);
  const [, , dayC, dayD] = await dayIds();
  await click('[data-key="daytype:' + DAY_A + ':menu"]');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await menuItems(), ['Copy classes from…'], 'the first day type has no moves and no Delete');
  await page.keyboard.press('Escape');
  await click('[data-key="daytype:' + dayD + ':menu"]');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await menuItems(), ['Move up', 'Move down (off)', 'Copy classes from…', 'Delete']);
  await page.evaluate(() => Array.from(document.querySelectorAll('.menu__item')).find((item) => item.textContent === 'Move up').click());
  await shows(() => Array.from(document.querySelectorAll('.sch-dtrow input[name="dayTypeName"]')).map((input) => input.value).join() === 'A Day,B Day,D Day,C Day');
  assert.equal(await text('#announcer'), 'D Day is now 3 of 4.');
  await keyIs('daytype:' + dayD + ':menu');
  await click('[data-key="daytype:' + DAY_B + ':menu"]');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual((await menuItems()).slice(0, 2), ['Move up (off)', 'Move down'], 'nothing goes above the first day type');
  await page.keyboard.press('Escape');
  // a drag by the grip, with the mouse: C Day onto B Day's row
  await settled();
  await closeToast();
  await page.$eval('.sch-dtlist', (el) => el.scrollIntoView({ block: 'center' }));
  const grip = await (await page.$('.sch-dtrow[data-day="' + dayC + '"] .sch-grip')).boundingBox();
  const onto = await (await page.$('.sch-dtrow[data-day="' + DAY_B + '"]')).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, onto.y + onto.height / 2, { steps: 6 });
  assert.equal(await page.$eval('.sch-dtrow[data-day="' + DAY_B + '"]', (el) => el.classList.contains('is-drop')), true);
  await page.mouse.up();
  await shows(() => Array.from(document.querySelectorAll('.sch-dtrow input[name="dayTypeName"]')).map((input) => input.value).join() === 'A Day,C Day,B Day,D Day');
  // a drag onto the first row puts it second
  await settled();
  await closeToast();
  await page.$eval('.sch-dtlist', (el) => el.scrollIntoView({ block: 'center' }));
  const grip2 = await (await page.$('.sch-dtrow[data-day="' + dayD + '"] .sch-grip')).boundingBox();
  const top = await (await page.$('.sch-dtrow[data-day="' + DAY_A + '"]')).boundingBox();
  await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip2.x + grip2.width / 2, top.y + top.height / 2, { steps: 6 });
  await page.mouse.up();
  await shows(() => Array.from(document.querySelectorAll('.sch-dtrow input[name="dayTypeName"]')).map((input) => input.value).join() === 'A Day,D Day,C Day,B Day');
  await click('#undo');
  await click('#undo');
  await shows(() => Array.from(document.querySelectorAll('.sch-dtrow input[name="dayTypeName"]')).map((input) => input.value).join() === 'A Day,B Day,D Day,C Day');
  // Delete, with the toast saying what went
  await pickFromMenu('[data-key="daytype:' + dayD + ':menu"]', 'Delete');
  await shows(() => document.querySelectorAll('.sch-dtrow').length === 3);
  assert.equal(await toastText(), 'Deleted D Day, its classes for 8 groups and its bells.');
  await keyIs('daytype:' + dayC + ':menu');
  await click('.toast__action');
  await shows(() => document.querySelectorAll('.sch-dtrow').length === 4);
  assert.deepEqual(await rowOrder(), ['A Day', 'B Day', 'D Day', 'C Day']);
});

test('an Early Release bell schedule: added as a copy of A Day’s bells, named, periods 5 to 8 ticked No class, deleted and back', async () => {
  await click('[data-action="add-bells"]');
  await shows(() => document.querySelectorAll('.sch-bsched').length === 1);
  const id = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  await keyIs('bsched:' + id + ':name');
  assert.equal(await toastText(), 'Added New bell schedule, a copy of A Day’s regular bells. Give it a name of its own.');
  await page.keyboard.type('Early Release');
  await page.keyboard.press('Enter');
  await shows((key) => document.querySelector('.sch-bsched h3')?.textContent === 'Early Release' && document.querySelector('[data-key="' + key + '"]')?.placeholder === 'ER', 'bsched:' + id + ':short');
  const table = '.sch-bells[data-bells="' + id + '"]';
  assert.equal(await page.$eval('[data-key="bsched:' + id + ':0:start"]', (el) => el.value), '8:00 AM');
  assert.equal(await text('.sch-bsched__off'), 'Every period meets.');
  // ticks by pointer for periods 5 to 7, by keyboard for period 8
  for (const period of [4, 5, 6]) {
    await click('[data-key="bsched:' + id + ':' + period + ':off"]');
    await shows((selector, p) => document.querySelector(selector + ' tr[data-period="' + p + '"]')?.dataset.off === 'true', table, period);
  }
  await settled();
  await page.focus('[data-key="bsched:' + id + ':7:off"]');
  await page.keyboard.press('Space');
  await shows((selector) => document.querySelector(selector + ' tr[data-period="7"]')?.dataset.off === 'true', table);
  assert.equal(await text('.sch-bsched__off'), 'Period 5, Period 6, Period 7 and Period 8 do not meet.');
  assert.deepEqual(await page.$$eval(table + ' tbody tr', (rows) => rows.map((row) => row.cells[2].textContent)), ['', '', '', '', 'No class', 'No class', 'No class', 'No class'], 'a period that does not meet reads No class');
  assert.equal(await count(table + ' tr[data-off="true"] input[name^="bell"]'), 0, 'its times are not asked for');
  assert.equal(await page.$eval(table + ' tr[data-period="3"]', (row) => row.cells[4].textContent), '', 'no passing time into a period that does not meet');
  assert.equal(await count(table + ' [data-bell]'), 0, 'the gap check passes the ticked periods by');
  // the ticked times can be put back by unticking
  await click('[data-key="bsched:' + id + ':7:off"]');
  await shows((selector) => document.querySelector(selector + ' tr[data-period="7"]')?.dataset.off !== 'true', table);
  await click('#undo');
  await shows((selector) => document.querySelector(selector + ' tr[data-period="7"]')?.dataset.off === 'true', table);
  // the settings say so
  await go(page, '#project');
  await shows(() => /1 other bell schedule: Early Release/.test(document.querySelector('#settings')?.textContent || ''));
  await go(page, '#schedule/day');
  await settled();
  // Delete, said in the toast, and Undo
  await click('[data-key="bsched:' + id + ':delete"]');
  await shows(() => document.querySelectorAll('.sch-bsched').length === 0);
  assert.equal(await toastText(), 'Deleted Early Release.');
  await keyIs('bsched-add');
  await click('.toast__action');
  await shows(() => document.querySelectorAll('.sch-bsched').length === 1 && document.querySelectorAll('.sch-bells tr[data-off="true"]').length === 4);
});

test('twelve day types: Add is off and says why, and the Day tab keeps inside its width', async () => {
  await addByStore(['E Day', 'F Day', 'G Day', 'H Day', 'I Day', 'J Day'], ['K Day', 'L Day']);
  assert.equal(await count('.sch-dtrow'), 12);
  assert.equal(await page.$eval('.sch-dtadd [data-action="add-day-type"]', (el) => el.getAttribute('aria-disabled')), 'true');
  assert.equal(await text('.sch-dtadd__count'), '12 of 12. A project has at most 12 day types; delete one to add another.');
  assert.equal(await exists('[data-key="daytype-add-name"]'), false);
  await click('.sch-dtadd [data-action="add-day-type"]');
  await settled();
  assert.equal(await count('.sch-dtrow'), 12, 'pressing it adds nothing');
  assert.equal(await page.$eval('.sch-daytab', (el) => el.scrollWidth <= el.clientWidth + 1), true, 'nothing sticks out sideways at 1280 px');
  assert.deepEqual(await page.$$eval('.sch-followers__line', (all) => all.map((el) => el.textContent)), ['K Day: B Day’s bells', 'L Day: B Day’s bells']);
});

test('the group editor with more than two day types of their own: Show chips, the choice kept on this device, followers as lines, one bar', async () => {
  await go(page, '#schedule/groups/' + GROUP);
  await settled();
  const ids = await dayIds();
  assert.equal(await count('.sch-show__chip'), 10, 'a chip for each day type with its own classes');
  const pressed = () => page.$$eval('.sch-show__chip[aria-pressed="true"]', (all) => all.map((el) => el.textContent));
  const columns = () => page.$$eval('.sch-days > .sch-day .sch-day__title', (all) => all.map((el) => el.textContent));
  // C Day's slot address, opened earlier, chose C Day on this device; the
  // other column is made up from the first day types
  assert.deepEqual(await pressed(), ['A Day', 'C Day']);
  assert.deepEqual(await columns(), ['A Day', 'C Day'], 'two side by side under 1800 px');
  // choosing another replaces the one chosen longest ago, and the chosen chip keeps the focus
  await click('.sch-show__chip[data-day="' + ids[2] + '"]');
  await keyIs('show:' + ids[2]);
  assert.deepEqual(await pressed(), ['D Day', 'C Day'], 'A Day, never chosen, goes first');
  assert.deepEqual(await columns(), ['D Day', 'C Day']);
  await click('.sch-show__chip[data-day="' + ids[4] + '"]');
  await shows((id) => document.querySelector('.sch-show__chip[data-day="' + id + '"]')?.getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.sch-days > .sch-day').length === 2, ids[4]);
  assert.deepEqual(await pressed(), ['D Day', 'E Day'], 'then C Day, chosen longest ago');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).schedule.shownDays), [ids[4], ids[2], ids[3]]);
  // the followers: a line each
  assert.deepEqual(await page.$$eval('.sch-same-lines li', (all) => all.map((el) => el.firstChild.textContent)), ['K Day: same as B Day · ', 'L Day: same as B Day · ']);
  assert.equal(await page.$eval('.sch-same-lines li [data-action="make-own"]', (el) => el.firstChild.textContent), 'Make it its own');
  assert.match(await text('.sch-complete'), /^Complete on \d+ of 10 day types: A Day 8 of 8, B Day 8 of 8, /);
  // the list: one bar for them all, the day by day in its title
  assert.equal(await count('.sch-group[data-group="' + GROUP + '"] .sch-bar'), 1);
  assert.match(await page.$eval('.sch-group[data-group="' + GROUP + '"] .sch-bar--all', (el) => el.title), /^A Day 8 of 8, B Day 8 of 8, D Day 8 of 8, C Day 8 of 8, /);
  assert.match(await page.$eval('.sch-group[data-group="' + GROUP + '"] .sch-bar--all .vh', (el) => el.textContent), /^Complete on \d+ of 10 day types\. $/);
  // a slot's address on a day type not shown shows it
  await go(page, '#schedule/groups/' + GROUP + '/' + ids[5] + '/2');
  await keyIs('slot:' + ids[5] + ':2:room');
  assert.equal((await pressed()).includes('F Day'), true);
  // kept through a reload
  const before = await pressed();
  await page.evaluate(() => globalThis.sv2.storage.flush());
  await page.reload({ waitUntil: 'load' });
  await shows(() => document.querySelector('.sch-show__chip') !== null);
  await settled();
  assert.deepEqual(await pressed(), before);
});

test('the grid’s Day type: the first day type with more than two of their own, All or one, kept on this device', async () => {
  await go(page, '#schedule/grid');
  await shows(() => document.querySelector('[data-key="grid-day"]') !== null);
  await settled();
  const heads = () => page.$$eval('.grd-sheet .grd-head--day, .grd-table:not([hidden]) .grd-head--day', (all) => all.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent));
  assert.equal(await page.$eval('[data-key="grid-day"]', (el) => el.closest('.grd-toolbar').firstElementChild.contains(el)), true, 'at the toolbar’s left');
  assert.equal(await page.$eval('[data-key="grid-day"]', (el) => el.value), DAY_A);
  assert.deepEqual(await page.$$eval('[data-key="grid-day"] option', (all) => all.map((el) => el.textContent)), ['All', 'A Day', 'B Day', 'D Day', 'C Day', 'E Day', 'F Day', 'G Day', 'H Day', 'I Day', 'J Day']);
  assert.deepEqual(await heads(), ['A Day']);
  await settled();
  await page.select('[data-key="grid-day"]', 'all');
  await shows(() => document.querySelectorAll('.grd-head--day').length === 10);
  assert.match(await text('.grd-same'), /^K Day is the same as B Day and L Day is the same as B Day, so they have no columns of their own here\./);
  await page.select('[data-key="grid-day"]', DAY_B);
  await shows((name) => Array.from(document.querySelectorAll('.grd-head--day')).map((el) => el.textContent).join() === name, 'B Day');
  // the reading tables follow it
  await click('.grd-toolbar input[value="teachers"]');
  await shows(() => document.querySelector('.grd').dataset.rows === 'teachers');
  await settled();
  assert.deepEqual(await page.$$eval('.grd-table--read .grd-head--day', (all) => all.map((el) => el.textContent)), ['B Day']);
  await click('.grd-toolbar input[value="groups"]');
  await settled();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).grid.day), DAY_B);
  await page.evaluate(() => globalThis.sv2.storage.flush());
  await page.reload({ waitUntil: 'load' });
  await shows(() => document.querySelector('[data-key="grid-day"]') !== null);
  await settled();
  assert.equal(await page.$eval('[data-key="grid-day"]', (el) => el.value), DAY_B);
  // a value that is not one reads as nothing chosen
  await page.evaluate(() => {
    const device = JSON.parse(localStorage.getItem('sv2:device'));
    localStorage.setItem('sv2:device', JSON.stringify({ ...device, grid: 'B', schedule: { shownDays: 'all of them' } }));
    globalThis.sv2.storage.flush();
  });
  await page.reload({ waitUntil: 'load' });
  await shows(() => document.querySelector('[data-key="grid-day"]') !== null);
  await settled();
  assert.equal(await page.$eval('[data-key="grid-day"]', (el) => el.value), DAY_A);
  await go(page, '#schedule/groups/' + GROUP);
  await settled();
  assert.deepEqual(await page.$$eval('.sch-show__chip[aria-pressed="true"]', (all) => all.map((el) => el.textContent)), ['A Day', 'B Day']);
});

test('at 390 px with touch: rows stack, every target is 44 px, Move down by a tap, no drag, one day type shown at a time', async () => {
  await page.evaluate(() => globalThis.sv2.storage.flush());
  await session.close();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'dark', width: 390, height: 844, mobile: true, keep: true });
  page = session.page;
  await settled();
  assert.equal(await count('.sch-dtrow'), 12, 'the twelve day types were kept');
  const ids = await dayIds();
  const box = (selector) => page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
  const name = await box('.sch-dtrow[data-day="' + ids[2] + '"] .sch-dtrow__name');
  const short = await box('.sch-dtrow[data-day="' + ids[2] + '"] .sch-dtrow__more');
  assert.ok(short.top >= name.bottom - 1, 'the short name and the kind are under the name');
  assert.equal(await page.$eval('.sch-daytab', (el) => el.scrollWidth <= el.clientWidth + 1), true, 'nothing sticks out sideways at 390 px');
  assert.equal(await page.$$eval('.sch-dtrow .sch-grip', (all) => all.every((el) => getComputedStyle(el).display === 'none' || el.getClientRects().length === 0)), true, 'no grip for a finger');
  const small = await page.$$eval('.sch-dtrow button, .sch-dtrow input, .sch-radio, .sch-tick, .sch-bsched button', (all) => all.filter((el) => el.getClientRects().length > 0).map((el) => { const r = el.getBoundingClientRect(); return { what: el.dataset.key || el.textContent.trim().slice(0, 30), w: r.width, h: r.height }; }).filter((r) => Math.min(r.w, r.h) < 44 - 0.5 && !(r.h >= 44 - 0.5 && r.what && /:name$|:short$/.test(r.what))));
  assert.deepEqual(small.filter((r) => !/:name$|:short$/.test(r.what) || r.h < 44 - 0.5), [], 'targets under 44 px');
  // Move down by taps on the row's menu
  const tap = async (selector) => {
    await settled();
    await closeToast();
    const at = await box(selector);
    await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
  };
  await page.$eval('[data-key="daytype:' + ids[2] + ':menu"]', (el) => el.scrollIntoView({ block: 'center' }));
  await tap('[data-key="daytype:' + ids[2] + ':menu"]');
  await page.waitForSelector('.menu[role="menu"]');
  const item = await page.evaluateHandle(() => Array.from(document.querySelectorAll('.menu__item')).find((el) => el.textContent === 'Move down'));
  const r = await item.boundingBox();
  await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  await shows((id) => document.querySelectorAll('.sch-dtrow')[3]?.dataset.day === id, ids[2]);
  // a finger on the row does not drag it
  const before = await rowOrder();
  const row = await box('.sch-dtrow[data-day="' + ids[4] + '"]');
  const client = await page.target().createCDPSession();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: row.left + 10, y: row.top + 10 }] });
  for (let step = 1; step <= 6; step += 1) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: row.left + 10, y: row.top + 10 - step * 15 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled();
  assert.deepEqual(await rowOrder(), before);
  // the group editor: one day type shown, the chips a single choice
  await go(page, '#schedule/groups/' + GROUP);
  await settled();
  assert.equal(await count('.sch-days > .sch-day'), 1);
  assert.equal(await count('.sch-show__chip[aria-pressed="true"]'), 1);
  assert.equal(await page.$$eval('.sch-show__chip, .sch-same-lines button', (all) => all.every((el) => { const b = el.getBoundingClientRect(); return b.height >= 43.5 && b.width >= 43.5; })), true, 'chips and their buttons are 44 px');
  await page.$eval('.sch-show__chip[data-day="' + ids[6] + '"]', (el) => el.scrollIntoView({ block: 'center' }));
  await tap('.sch-show__chip[data-day="' + ids[6] + '"]');
  await shows((id) => document.querySelectorAll('.sch-show__chip[aria-pressed="true"]').length === 1 && document.querySelector('.sch-show__chip[aria-pressed="true"]').dataset.day === id && document.querySelector('.sch-days > .sch-day').dataset.day === id, ids[6]);
  await page.evaluate(() => globalThis.sv2.storage.flush());
  await session.close();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await settled();
});

test('the Day tab by keyboard alone: add a day type, change what it is, move it, with no pointer and no focus lost', async () => {
  await freshSample();
  await go(page, '#schedule/day');
  await settled();
  await page.evaluate(() => {
    window.sv2Pointers = 0;
    window.sv2Lost = 0;
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) document.addEventListener(type, () => { window.sv2Pointers += 1; }, true);
    document.addEventListener('focusout', (event) => {
      if (!event.relatedTarget) setTimeout(() => { if (document.activeElement === document.body) window.sv2Lost += 1; }, 0);
    }, true);
  });
  await page.focus('#surface [role="tab"][aria-selected="true"]');
  const tabTo = async (key, back) => {
    for (let i = 0; i < 120; i += 1) {
      if ((await activeKey()) === key) return;
      await page.keyboard.down('Shift');
      if (!back) await page.keyboard.up('Shift');
      await page.keyboard.press('Tab');
      if (back) await page.keyboard.up('Shift');
      await settled();
    }
    assert.fail('Tab never reached ' + key);
  };
  await tabTo('daytype-add-name');
  await selectAllAndType('Half Day');
  // the kind: Same as A Day, by the arrow keys
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'daytype-add-kind:own');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'daytype-add');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelectorAll('.sch-dtrow').length === 3);
  assert.equal(await toastText(), 'Added Half Day, the same as A Day.');
  const half = (await dayIds())[2];
  assert.equal(await text('.sch-dtrow[data-day="' + half + '"] .sch-dtrow__kind'), 'Same as A Day');
  // Change…: Enter, the focus on the choice that stands, arrow, Tab, Enter
  await tabTo('daytype:' + half + ':change', true);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#day-kind-dialog[open]');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'dsample00a');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'own');
  assert.equal(await text('#day-kind-dialog .btn--primary'), 'Give Half Day its own classes, starting as a copy of A Day');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await shows((id) => document.querySelector('#day-kind-dialog') === null && document.querySelector('.sch-dtrow[data-day="' + id + '"] .sch-dtrow__kind')?.textContent === 'Its own classes', half);
  assert.equal(await toastText(), 'Half Day has its own classes now, starting as a copy of A Day’s.');
  await keyIs('daytype:' + half + ':change');
  // the row's menu: Move up by Enter on the menu, Enter on the item
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'daytype:' + half + ':menu');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.menu[role="menu"]');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Move up');
  await page.keyboard.press('Enter');
  await shows(() => Array.from(document.querySelectorAll('.sch-dtrow input[name="dayTypeName"]')).map((input) => input.value).join() === 'A Day,Half Day,B Day');
  await keyIs('daytype:' + half + ':menu');
  // and an Early Release schedule's No class ticks, by Space
  await tabTo('bsched-add');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelectorAll('.sch-bsched').length === 1);
  const id = await page.evaluate(() => globalThis.sv2.store.project.bellSchedules[0].id);
  await keyIs('bsched:' + id + ':name');
  await page.keyboard.type('Early Release');
  await page.keyboard.press('Enter');
  for (const period of [4, 5, 6, 7]) {
    await tabTo('bsched:' + id + ':' + period + ':off');
    await page.keyboard.press('Space');
    await shows((key) => document.querySelector('[data-key="' + key + '"]')?.checked === true, 'bsched:' + id + ':' + period + ':off');
  }
  await shows(() => document.querySelectorAll('.sch-bells tr[data-off="true"]').length === 4);
  assert.equal(await text('.sch-bsched__off'), 'Period 5, Period 6, Period 7 and Period 8 do not meet.');
  assert.deepEqual(await page.evaluate(() => [window.sv2Pointers, window.sv2Lost]), [0, 0], 'no pointer event, and the focus never fell to the page');
});
