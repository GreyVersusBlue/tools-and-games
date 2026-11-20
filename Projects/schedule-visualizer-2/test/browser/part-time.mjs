// Part-time teachers in the planner, in a real browser:
// node test/browser/part-time.mjs
//
// Schedule > Teachers: the Part-time column and its disclosure editor
// (DESIGN 16.6, 16.12 item 4). The button reads "Full-time" or the entry's
// words and carries aria-expanded; opening puts focus on the first radio and
// Escape closes and gives it back to the button. "Only in school on…" writes
// the complement of the weekdays ticked as one entry, one undo step per tick,
// and refuses a school with nobody in it inline. "Not in school…" is the full
// form, one entry at a time: day types, weekdays, periods, Done; saved
// entries collapse to their words with Edit and a named Remove; Add another
// time focuses the new entry's first control. The sentence under the editor
// and the staff-browser line, the one-time offer from Notes that name
// weekdays, a class put in an away period shown in Checks, a name as typed,
// by pointer and by keyboard at 1280 by 900, and by tap at 390 by 844. Every
// wait is on a state the page sets (`data-pending` gone from the section, an
// attribute or a store value), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go as goHash, assertTouch, loadModule } from './harness.mjs';

const HOSTILE = '<b>Lin</b> "Q" 名前';
const T = 'tsample001'; // teaches 8B in period 2 of A Day (the sample school)
const A = 'dsample00a';

let session;
let page;
let touching = false;

// A press on a keyed control. The tab draws again after every change, and the
// control pressed is replaced by a new one: the old one is marked first, and
// the press is done when a new one holds its key (and so the focus the page
// puts back is on the drawing that is there). A press that met the old
// drawing as it went is made again.
async function press(selector) {
  for (let tries = 0; ; tries += 1) {
    await settled();
    try {
      const marked = await page.$eval(selector, (el) => { el.__old = true; return true; });
      assert.ok(marked);
      if (touching) await page.tap(selector);
      else await page.click(selector);
      if (selector.startsWith('[data-key=')) await shows((wanted) => { const now = document.querySelector(wanted); return now === null || now.__old !== true; }, selector);
      return;
    } catch (error) {
      if (tries >= 5 || !/detached|not clickable|Waiting failed|failed to find/.test(String(error && error.message))) throw error;
    }
  }
}

// Move the focus to a keyed control and press a key; done when the page has drawn again.
async function keyOn(selector, name) {
  await settled();
  await page.$eval(selector, (el) => { el.__old = true; el.focus(); });
  await page.keyboard.press(name);
  await shows((wanted) => { const now = document.querySelector(wanted); return now === null || now.__old !== true; }, selector);
}
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
const key = (name) => '[data-key="teacher:' + T + ':part:' + name + '"]';
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);
const away = () => page.evaluate((id) => JSON.parse(JSON.stringify(globalThis.sv2.store.project.teachers.find((teacher) => teacher.id === id).away || [])), T);
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const expanded = () => page.$eval(key('button'), (el) => el.getAttribute('aria-expanded'));
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());
const refusal = () => page.evaluate(() => document.querySelector('[data-refusal="part"]')?.textContent || null);
const editor = '[data-part-editor="' + T + '"]';

async function go(hash) {
  await goHash(page, hash);
  const tab = hash.match(/^#schedule\/([a-z]+)/);
  if (tab) await page.waitForFunction((wanted) => document.querySelector('.sch [data-tab="' + wanted + '"]:not([role="tab"])') !== null, { timeout: 8000 }, tab[1]);
  await settled();
}

// Wait for the stored list to be the one wanted.
async function awayIs(wanted) {
  await shows((id, list) => JSON.stringify(globalThis.sv2.store.project.teachers.find((teacher) => teacher.id === id).away || []) === list, T, JSON.stringify(wanted));
  assert.deepEqual(await away(), wanted);
}

async function undo() {
  await settled();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await settled();
}

// The state a case starts from: every edit undone, the editor closed, the page on the tab.
async function fresh() {
  await closeToast();
  await page.evaluate(() => { while (globalThis.sv2.store.canUndo) globalThis.sv2.store.undo(); });
  await settled();
  if ((await page.$(key('button'))) === null) await go('#schedule/teachers');
  if ((await expanded()) === 'true') {
    await press(key('button'));
    await shows((selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', key('button'));
  }
  await settled();
}

async function open() {
  await press(key('button'));
  await page.waitForSelector(editor);
  await settled();
}

before(async () => {
  session = await openPlanner({ hash: '#schedule/teachers', theme: 'light' });
  page = session.page;
  await page.waitForSelector('.sch-teachers table');
  await settled();
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'w7', 'engine/w7-actions.js');
});

// Store a list of entries for the teacher, as one step of its own.
async function setAway(list) {
  await loadModule(page, 'w7', 'engine/w7-actions.js');
  await page.evaluate((id, wanted) => globalThis.sv2.store.apply(globalThis.sv2modules.w7.setTeacherAway, { teacherId: id, away: wanted }), T, list);
  await awayIs(list);
  await settled();
}
const P = (period) => ({ dayTypeIds: [], weekdays: [], periods: [period] });
const formAt = () => page.evaluate((selector) => [...document.querySelectorAll(selector + ' .sch-part__entry')].map((el) => el.dataset.entry), editor);

after(async () => {
  if (session) await session.close();
});

test('1. the column is headed Part-time after Notes, its button reads Full-time and carries aria-expanded; opening focuses the first radio, Escape closes and gives the focus back', async () => {
  const heads = await page.$$eval('.sch-teachers thead th', (all) => all.map((el) => el.textContent));
  assert.deepEqual(heads.slice(0, 6), ['Name', 'Subject', 'Rooms', 'Notes', 'Part-time', 'Duties']);
  assert.match(await text(key('button')), /^Full-time/);
  assert.equal(await expanded(), 'false');
  await open();
  assert.equal(await expanded(), 'true');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:radio:only', 'focus is on the first radio');
  assert.equal(await page.$eval(key('radio:only'), (el) => el.checked), true, 'a full-time teacher starts on Only in school on…');
  assert.match(await text('[data-says="part"]'), /is in school at every time the schedule has/);
  assert.match(await text(editor), /Shown in the staff browser\./);
  await page.keyboard.press('Escape');
  await shows((selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', key('button'));
  assert.equal(await exists(editor), false);
  assert.equal(await activeKey(), 'teacher:' + T + ':part:button', 'Escape gives the focus back to the button');
  await fresh();
});

test('2. Only in school on… writes the other weekdays as one entry, one undo step per tick, and says what it does', async () => {
  await fresh();
  await open();
  await press(key('day:4'));
  await awayIs([{ dayTypeIds: [], weekdays: [4], periods: [] }]);
  await settled();
  await press(key('day:3'));
  await awayIs([{ dayTypeIds: [], weekdays: [3, 4], periods: [] }]);
  await settled();
  assert.match(await text(key('button')), /^Not in Thu, Fri/);
  const says = await text('[data-says="part"]');
  assert.match(says, /Day-type views list this as a note; the staff browser leaves .+ out on Thursdays and Fridays by the calendar\./);
  assert.doesNotMatch(says, /\b(her|his|their)\b/, 'no pronoun is guessed');
  assert.equal(await page.$eval(key('day:3'), (el) => el.getAttribute('aria-pressed')), 'false');
  assert.equal(await page.$eval(key('day:0'), (el) => el.getAttribute('aria-pressed')), 'true');
  await undo();
  await awayIs([{ dayTypeIds: [], weekdays: [4], periods: [] }]);
  await undo();
  await awayIs([]);
  // Saturday and Sunday are under More
  assert.equal(await exists(key('day:5')), false);
  await press(key('more'));
  await page.waitForSelector(key('day:5'));
  assert.equal(await activeKey(), 'teacher:' + T + ':part:day:5');
  await fresh();
});

test('3. a school with nobody in it is refused inline, in the engine\'s words, and nothing is stored', async () => {
  await fresh();
  await open();
  for (const day of [0, 1, 2, 3]) {
    await press(key('day:' + day));
    await settled();
  }
  await awayIs([{ dayTypeIds: [], weekdays: [0, 1, 2, 3], periods: [] }]);
  await press(key('day:4'));
  await shows(() => document.querySelector('[data-refusal="part"]') !== null);
  assert.match(await refusal(), /never in school is not a teacher of this school; remove them instead\./);
  assert.deepEqual(await away(), [{ dayTypeIds: [], weekdays: [0, 1, 2, 3], periods: [] }]);
  assert.equal(await page.$eval(key('day:4'), (el) => el.getAttribute('aria-pressed')), 'true', 'the day stays ticked');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:day:4', 'focus stays on the chip');
  await fresh();
});

test('4. Not in school… takes entries one at a time: Done saves, saved entries collapse with Edit and a named Remove, Add another time focuses the new entry', async () => {
  await fresh();
  await open();
  await press(key('radio:not'));
  await page.waitForSelector('[data-entry="0"] fieldset');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:radio:not');
  await press(key('e0:types:some'));
  await page.waitForSelector(key('e0:type:' + A));
  await press(key('e0:type:' + A));
  await press(key('e0:period:1'));
  await press(key('e0:done'));
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }]);
  await settled();
  const words = await text('[data-entry="0"]');
  assert.match(words, /Not in school in Period 2 when it is A Day/);
  assert.equal(await activeKey(), 'teacher:' + T + ':part:edit:0');
  const name = await page.evaluate((id) => globalThis.sv2.store.project.teachers.find((teacher) => teacher.id === id).name, T);
  assert.equal(await page.$eval(key('remove:0'), (el) => el.textContent), 'Remove entry 1 for ' + name);
  // Add another time: the new entry's first control has the focus; Done with nothing chosen is refused inline
  await press(key('add'));
  await page.waitForSelector('[data-entry="1"] fieldset');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:e1:types:all');
  await press(key('e1:done'));
  await shows(() => document.querySelector('[data-refusal="part"]') !== null);
  assert.match(await refusal(), /never in school/);
  assert.equal((await away()).length, 1);
  await press(key('e1:day:4'));
  await press(key('e1:done'));
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }, { dayTypeIds: [], weekdays: [4], periods: [] }]);
  await settled();
  const says = await text('[data-says="part"]');
  assert.match(says, /will not be counted as free in these periods, and a class with .+ then is flagged\./);
  assert.match(says, /Day-type views list this as a note/);
  assert.match(await text(key('button')), /^Not in school in Period 2 when it is A Day; Not in Fri/);
  // Edit changes the entry in place, one step; Remove is one step
  await press(key('edit:1'));
  await page.waitForSelector('[data-entry="1"] fieldset');
  await press(key('e1:day:3'));
  await press(key('e1:done'));
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }, { dayTypeIds: [], weekdays: [3, 4], periods: [] }]);
  await settled();
  await press(key('remove:1'));
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }]);
  await settled();
  await undo();
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }, { dayTypeIds: [], weekdays: [3, 4], periods: [] }]);
  await fresh();
});

test('5. a class put in an away period is a finding in Checks', async () => {
  await fresh();
  await open();
  await press(key('radio:not'));
  await page.waitForSelector('[data-entry="0"] fieldset');
  await press(key('e0:types:some'));
  await page.waitForSelector(key('e0:type:' + A));
  await press(key('e0:type:' + A));
  await press(key('e0:period:1'));
  await press(key('e0:done'));
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }]);
  await go('#schedule/checks');
  await shows((id) => [...document.querySelectorAll('.sch-findings tr[data-finding], .sch-finding')].some((row) => /is not in school in Period 2 on A Day/.test(row.textContent)), T);
  const sentence = await page.evaluate(() => [...document.querySelectorAll('.sch-findings tr[data-finding], .sch-finding')].map((row) => row.textContent).find((words) => /is not in school in Period 2/.test(words)));
  assert.match(sentence, /8B is in Room/);
  await go('#schedule/teachers');
  await fresh();
  await go('#schedule/checks');
  await shows(() => ![...document.querySelectorAll('.sch-findings tr[data-finding], .sch-finding')].some((row) => /is not in school in Period 2/.test(row.textContent)));
  await go('#schedule/teachers');
});

test('6. Notes that name weekdays are offered once as part-time days', async () => {
  await fresh();
  const notes = 'input[aria-label^="Notes on"]';
  const field = '[data-teacher="' + T + '"] ' + notes;
  await page.click(field, { clickCount: 3 });
  await page.keyboard.type('Mon/Wed only');
  await page.keyboard.press('Enter');
  await shows(() => /Notes say ‘Mon\/Wed only’\. Set it as part-time\?/.test(document.querySelector('.toast .toast__text')?.textContent || ''));
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__action')?.textContent), 'Set as part-time');
  // the same words again do not offer again
  await closeToast();
  await settled();
  await page.click(field, { clickCount: 3 });
  await page.keyboard.type('Mon/Wed only');
  await page.keyboard.press('Enter');
  await settled();
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__action')?.textContent || null), null, 'offered once');
  // other words are another offer; take it
  await page.click(field, { clickCount: 3 });
  await page.keyboard.type('Tues and Thurs');
  await page.keyboard.press('Enter');
  await shows(() => /Notes say ‘Tues and Thurs’/.test(document.querySelector('.toast .toast__text')?.textContent || ''));
  await page.click('.toast .toast__action');
  await awayIs([{ dayTypeIds: [], weekdays: [0, 2, 4], periods: [] }]);
  await page.waitForSelector(editor);
  assert.equal(await expanded(), 'true', 'the editor is open on what was set');
  await fresh();
});

test('7. by keyboard: Enter opens, the arrow keys change the radio, Space ticks, Escape closes', async () => {
  await fresh();
  await closeToast();
  await page.focus(key('button'));
  await page.keyboard.press('Enter');
  await page.waitForSelector(editor);
  await shows(() => document.activeElement?.dataset.key?.endsWith(':part:radio:only'));
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('[data-entry="0"] fieldset');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:radio:not', 'the arrow key moved the radio and kept the focus on it');
  assert.equal(await page.$eval(key('radio:not'), (el) => el.checked), true);
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:e0:types:all');
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector(key('e0:type:' + A));
  await keyOn(key('e0:type:' + A), 'Space');
  await keyOn(key('e0:period:6'), 'Space');
  await keyOn(key('e0:done'), 'Enter');
  await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [6] }]);
  await settled();
  assert.equal(await activeKey(), 'teacher:' + T + ':part:edit:0');
  await page.keyboard.press('Escape');
  await shows((selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', key('button'));
  assert.equal(await activeKey(), 'teacher:' + T + ':part:button');
  await fresh();
});

test('8. a name and a day type name are shown as typed, never as markup', async () => {
  await fresh();
  await page.evaluate((name) => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.editTeacher, { id: 'tsample001', name });
  }, HOSTILE);
  await settled();
  await open();
  await press(key('day:4'));
  await awayIs([{ dayTypeIds: [], weekdays: [4], periods: [] }]);
  await settled();
  assert.ok((await text('[data-says="part"]')).includes(HOSTILE));
  assert.equal(await exists(editor + ' b'), false, 'no markup was made');
  assert.equal(await page.$eval(editor + ' .sch-part', (el) => el.getAttribute('aria-label')), 'Part-time times for ' + HOSTILE);
  await fresh();
});

test('11. Remove above an open entry moves the entry up with its row: Done writes it in its own place, and nothing is lost', async () => {
  await fresh();
  await setAway([P(0), P(1), P(2)]);
  await open();
  assert.equal(await page.$eval(key('radio:not'), (el) => el.checked), true);
  // edit the second, remove the first, then finish the edit
  await press(key('edit:1'));
  await page.waitForSelector('[data-entry="1"] fieldset');
  await press(key('e1:period:4'));
  await press(key('remove:0'));
  await awayIs([P(1), P(2)]);
  await settled();
  assert.deepEqual(await formAt(), ['0'], 'the open entry is now the first');
  await press(key('e0:done'));
  await awayIs([{ dayTypeIds: [], weekdays: [], periods: [1, 4] }, P(2)]);
  assert.equal(await refusal(), null);
  // adding: remove one of the saved entries while the new one is open
  await press(key('add'));
  await page.waitForSelector('[data-entry="2"] fieldset');
  await press(key('e2:day:4'));
  await press(key('remove:0'));
  await awayIs([P(2)]);
  await settled();
  assert.deepEqual(await formAt(), ['1'], 'the new entry follows the list');
  await press(key('e1:done'));
  await awayIs([P(2), { dayTypeIds: [], weekdays: [4], periods: [] }]);
  assert.equal(await refusal(), null, 'no hole was written');
  await fresh();
});

test('12. Undo with an entry open closes it without saving: the draft was for the list as it was', async () => {
  await fresh();
  await setAway([P(0)]);
  await setAway([P(0), P(1)]);
  await setAway([P(0), P(1), P(2)]);
  await open();
  await press(key('edit:2'));
  await page.waitForSelector('[data-entry="2"] fieldset');
  await press(key('e2:period:5'));
  await undo();
  await awayIs([P(0), P(1)]);
  await settled();
  assert.deepEqual(await formAt(), [], 'the entry that was open is closed');
  assert.equal(await exists(key('e2:done')), false);
  assert.equal(await exists(key('add')), true);
  // the same while adding
  await press(key('add'));
  await page.waitForSelector('[data-entry="2"] fieldset');
  await undo();
  await awayIs([P(0)]);
  await settled();
  assert.deepEqual(await formAt(), []);
  assert.deepEqual(await away(), [P(0)]);
  await fresh();
});

test('13. a refusal is said once: a later drawing shows it without role="alert", and a change to the draft takes it away', async () => {
  await fresh();
  await open();
  for (const day of [0, 1, 2, 3]) await press(key('day:' + day));
  await awayIs([{ dayTypeIds: [], weekdays: [0, 1, 2, 3], periods: [] }]);
  await press(key('day:4'));
  await shows(() => document.querySelector('[data-refusal="part"]') !== null);
  assert.equal(await page.$eval('[data-refusal="part"]', (el) => el.getAttribute('role')), 'alert', 'said when it first appears');
  // a drawing for something else: the words stay, the alert is not made again
  await page.$eval('[data-refusal="part"]', (el) => { el.__old = true; });
  await page.evaluate((id) => {
    const other = globalThis.sv2.store.project.teachers.find((teacher) => teacher.id !== id);
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.editTeacher, { id: other.id, notes: 'Coaches the chess club' });
  }, T);
  await shows(() => document.querySelector('[data-refusal="part"]')?.__old !== true);
  await settled();
  assert.match(await refusal(), /never in school/);
  assert.equal(await page.$eval('[data-refusal="part"]', (el) => el.getAttribute('role')), null, 'not announced again');
  await press(key('day:3'));
  await awayIs([{ dayTypeIds: [], weekdays: [0, 1, 2], periods: [] }]);
  assert.equal(await refusal(), null);
  // under Not in school: a change to the draft clears it before Done
  await fresh();
  await open();
  await press(key('radio:not'));
  await page.waitForSelector('[data-entry="0"] fieldset');
  await press(key('e0:done'));
  await shows(() => document.querySelector('[data-refusal="part"]') !== null);
  assert.equal(await page.$eval('[data-refusal="part"]', (el) => el.getAttribute('role')), 'alert');
  await press(key('e0:period:2'));
  assert.equal(await refusal(), null, 'the change answered it');
  await fresh();
});

test('14. a Remove refused with no entry open is shown in the editor', async () => {
  await fresh();
  const before = await page.evaluate(() => JSON.stringify(globalThis.sv2.store.project));
  try {
    // a stored entry naming a day type that has gone (as a file from elsewhere might)
    await page.evaluate((id) => {
      const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
      project.teachers.find((teacher) => teacher.id === id).away = [{ dayTypeIds: ['dgone0001'], weekdays: [], periods: [0] }, { dayTypeIds: [], weekdays: [], periods: [1] }];
      globalThis.sv2.store.replace(project);
    }, T);
    await settled();
    await open();
    assert.equal(await page.$eval(key('radio:not'), (el) => el.checked), true);
    assert.deepEqual(await formAt(), []);
    await press(key('remove:1'));
    await shows(() => document.querySelector('[data-refusal="part"]') !== null);
    assert.match(await refusal(), /no longer in the project/);
    assert.equal(await page.$eval('[data-refusal="part"]', (el) => el.closest('.sch-part') !== null), true, 'inside the editor');
    assert.equal((await away()).length, 2, 'nothing was stored');
  } finally {
    await page.evaluate((json) => globalThis.sv2.store.replace(JSON.parse(json)), before);
    await settled();
  }
  await fresh();
});

test('15. the days a note names: only real day words, and a negation counts only where it governs the days', async () => {
  await loadModule(page, 'teachers', 'ui/schedule/teachers.js');
  const cases = [
    ['Mon/Wed only', [0, 2]],
    ['Tues and Thurs', [1, 3]],
    ['Mondays, Tuesdays and Weds.', [0, 1, 2]],
    ['Thurs. and Fri.', [3, 4]],
    ['Tuesday to Thursday', [1, 2, 3]],
    ['Mon-Fri', null],
    // words that only start like a day
    ['Monitors the lunch line', null],
    ['Friendly with the bus drivers', null],
    ['Away for a wedding in June', null],
    ['thunder drills; frisbee club', null],
    // a negation that governs the days: the days away
    ['Not in on Fri', [0, 1, 2, 3]],
    ['Off Thu', [0, 1, 2, 4]],
    ['out Mon/Wed', [1, 3, 4]],
    ['Except Fridays', [0, 1, 2, 3]],
    ['Fridays off', [0, 1, 2, 3]],
    // a negation elsewhere changes nothing
    ['Mon/Wed only, not on duties', [0, 2]],
    ['Tue/Thu; does not coach', [1, 3]],
    ['In Mon and Tue, not in Fri', [0, 1]],
  ];
  const got = await page.evaluate((all) => all.map(([words]) => globalThis.sv2modules.teachers.noteDays(words)), cases);
  assert.deepEqual(got.map((days, at) => [cases[at][0], days]), cases);
});

test('16. an entry\'s days and periods offer "Every day" and "The whole day" as choices of their own', async () => {
  await fresh();
  await open();
  await press(key('radio:not'));
  await page.waitForSelector('[data-entry="0"] fieldset');
  const pressed = (part) => page.$eval(key(part), (el) => el.getAttribute('aria-pressed'));
  assert.equal(await text(key('e0:days:every')), 'Every day');
  assert.equal(await text(key('e0:periods:whole')), 'The whole day');
  assert.equal(await pressed('e0:days:every'), 'true', 'nothing ticked is every day');
  assert.equal(await pressed('e0:periods:whole'), 'true');
  await press(key('e0:day:1'));
  await press(key('e0:day:3'));
  assert.equal(await pressed('e0:days:every'), 'false');
  await press(key('e0:period:2'));
  assert.equal(await pressed('e0:periods:whole'), 'false');
  // choosing Every day takes the ticks away
  await press(key('e0:days:every'));
  assert.equal(await pressed('e0:days:every'), 'true');
  assert.equal(await pressed('e0:day:1'), 'false');
  assert.equal(await pressed('e0:day:3'), 'false');
  assert.equal(await activeKey(), 'teacher:' + T + ':part:e0:days:every');
  await press(key('e0:day:4'));
  await press(key('e0:periods:whole'));
  assert.equal(await pressed('e0:period:2'), 'false');
  await press(key('e0:done'));
  await awayIs([{ dayTypeIds: [], weekdays: [4], periods: [] }]);
  await fresh();
});

test('9. at 390 px with touch the editor stacks, fits with no sideways scroll, and every control is 44 px', async () => {
  await fresh();
  await page.evaluate(() => globalThis.sv2.storage.flush());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await page.waitForFunction(() => globalThis.sv2 && document.documentElement.dataset.ready === 'true', { timeout: 15000 });
  await go('#schedule/teachers');
  await assertTouch(page, 'the phone, before driving the part-time editor');
  touching = true;
  try {
    await page.$eval(key('button'), (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await open();
    await press(key('radio:not'));
    await page.waitForSelector('[data-entry="0"] fieldset');
    await press(key('e0:types:some'));
    await page.waitForSelector(key('e0:type:' + A));
    await press(key('e0:type:' + A));
    await press(key('e0:period:1'));
    const fits = await page.evaluate((selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, left: box.left, right: box.right };
    }, editor + ' .sch-part');
    assert.ok(fits.scroll <= fits.width, 'the page does not scroll sideways: ' + JSON.stringify(fits));
    assert.ok(fits.left >= 0 && fits.right <= fits.width, 'the editor is inside the window: ' + JSON.stringify(fits));
    const fieldsets = await page.$$eval('[data-entry="0"] > fieldset, [data-entry="0"] > div', (all) => all.map((el) => Math.round(el.getBoundingClientRect().top)));
    assert.equal(new Set(fieldsets).size, fieldsets.length, 'the three questions stack, one under another');
    for (const selector of [editor + ' .sch-show__chip', editor + ' .sch-radio', editor + ' .sch-btn--small', key('button')]) {
      const heights = await page.$$eval(selector, (all) => all.map((el) => el.getBoundingClientRect().height));
      assert.ok(heights.length > 0 && heights.every((height) => height >= 43.5), selector + ' is 44 px tall: ' + heights.join(', '));
    }
    await press(key('e0:done'));
    await awayIs([{ dayTypeIds: [A], weekdays: [], periods: [1] }]);
    await assertTouch(page, 'the phone, driving the part-time editor');
  } finally {
    touching = false;
  }
  await fresh();
});

test('10. no page errors, and nothing asked for outside the tool', async () => {
  assert.deepEqual(session.problems().errors, []);
  assert.deepEqual(session.offsite, []);
});
