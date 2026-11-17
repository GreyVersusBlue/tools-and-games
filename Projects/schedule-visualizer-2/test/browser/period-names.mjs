// The period word and period names, in a real browser:
// node test/browser/period-names.mjs
//
// Day card 1 and Settings: the period word as a radio group with Other word…
// (a word, its plural, how the periods are counted, and the sample line it
// reads); leaving Other word says so in a toast and Undo brings it back; the
// Name periods disclosure with "n named", each name field one undo step, the
// refusals inline in words; the Lunch nudge under a name that reads as a kind
// of mark, its button making a school mark (one step) and the toast said once;
// a named period reading "Lunch" in the grid editor's header and "Period 5
// (Lunch)" in the group editor's row head; every printed and typed word as
// typed. Driven by pointer and by keyboard at 1280 by 900 and at 390 by 844
// with touch. Every wait is on a state the page sets (`data-pending` gone
// from the section, a toast's words, a field's refusal), never on a first
// paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go as goHash, assertTouch } from './harness.mjs';

const HOSTILE = '<b>Lab</b> "Q" 名前';

let session;
let page;
let phone = null;

const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
const settings = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.settings)));
const marks = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.marks || [])));
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const key = (name) => '[data-key="' + name + '"]';
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());
const toastNow = () => page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null);

async function toastSays(words) {
  await shows((wanted) => document.querySelector('.toast .toast__text')?.textContent === wanted, words).catch(() => {});
  assert.equal(await toastNow(), words);
}

async function go(p, hash) {
  await goHash(p, hash);
  const tab = hash.match(/^#schedule\/([a-z]+)/);
  if (tab) await p.waitForFunction((wanted) => document.querySelector('.sch [data-tab="' + wanted + '"]:not([role="tab"])') !== null, { timeout: 8000 }, tab[1]);
}

// Undo as the shortcut does, then wait for the page to draw what it undid.
async function undo() {
  await settled();
  // a person leaves the field first: in a field, Ctrl+Z is the field's own
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await settled();
}

// Click a field and type into it. A redraw that is still due (the engine's
// answer for the project just changed) replaces the field under the pointer,
// so the click is repeated until the focus is on the field that is on the page.
async function typeInto(selector, words) {
  await settled();
  // a toast sits over the bottom-left of the section and takes the press
  await closeToast();
  for (let tries = 0; ; tries += 1) {
    await page.click(selector, { clickCount: 3 });
    const there = await page.evaluate((wanted) => document.activeElement === document.querySelector(wanted), selector);
    if (there) break;
    assert.ok(tries < 5, 'the focus never reached ' + selector);
    await settled();
  }
  if (words === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(words);
  await page.keyboard.press('Enter');
}

// The period word's radio, by its visible label.
const radio = (value) => key('day-word:' + value);

before(async () => {
  session = await openPlanner({ hash: '#schedule/day', theme: 'light' });
  page = session.page;
  await page.waitForSelector('[data-card="school-day"]');
  await settled();
});

after(async () => {
  if (phone) await phone.close();
  if (session) await session.close();
});

test('1. the period word is a radio group of the four words and Other word…, and a word picked by pointer is set', async () => {
  const labels = await page.$$eval('[data-card="school-day"] .sch-periodword > .seg .seg__label', (all) => all.map((el) => el.textContent));
  assert.deepEqual(labels, ['Period', 'Mod', 'Block', 'Hour', 'Other word…']);
  assert.equal(await page.$eval('[data-card="school-day"] .sch-periodword .seg', (el) => el.getAttribute('role')), 'radiogroup');
  assert.equal(await page.$eval('[data-card="school-day"] .sch-wordother', (el) => el.hidden), true, 'Other word’s fields wait until Other word is picked');
  await page.click(radio('Mod'));
  await settled();
  assert.equal((await settings()).periodWord, 'Mod');
  assert.match(await text('[data-card="school-day"] .field__label'), /Mods per day/);
});

test('2. an arrow key moves the word, and the keys reach Other word… the same way', async () => {
  await page.focus(radio('Mod'));
  await page.keyboard.press('ArrowRight');
  await settled();
  assert.equal((await settings()).periodWord, 'Block');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await shows(() => !document.querySelector('[data-card="school-day"] .sch-wordother').hidden);
  assert.equal(await activeKey(), 'day-word:other', 'the focus stays on the radio that was reached');
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'day-word:custom-word', 'Tab goes into the Word field');
  assert.equal((await settings()).periodCustom, undefined, 'nothing is written until a word is typed');
});

test('3. Other word: a word, its plural and how the periods count, with the sample line they read', async () => {
  const sample = () => text('[data-card="school-day"] [data-part="word-sample"]');
  assert.equal(await sample(), 'Type a word to see how it reads.');
  await page.focus(key('day-word:custom-word'));
  await page.keyboard.type('Lesson');
  await page.keyboard.press('Enter');
  await settled();
  assert.deepEqual((await settings()).periodCustom, { word: 'Lesson', plural: 'Lessons', count: 'number' });
  assert.equal(await sample(), 'Lesson 1, Lesson 2, … Lesson 8');
  assert.equal(await activeKey(), 'day-word:custom-word', 'the focus is kept in the field after the save');
  assert.match(await text('[data-card="school-day"] .field__label'), /Lessons per day/);
  assert.equal(await page.$eval('[data-card="school-day"] [data-part="word-sample"]', (el) => el.getAttribute('aria-live')), null, 'the sample is not a live region');
  await page.click(key('day-word:count:letter'));
  await settled();
  assert.equal((await settings()).periodCustom.count, 'letter');
  assert.equal(await sample(), 'Lesson A, Lesson B, … Lesson H');
  await page.click(key('day-word:count:ordinal'));
  await settled();
  assert.equal(await sample(), '1st Lesson, 2nd Lesson, … 8th Lesson');
  await typeInto(key('day-word:custom-plural'), 'Lessoni');
  await settled();
  assert.equal((await settings()).periodCustom.plural, 'Lessoni');
  assert.match(await text('[data-card="school-day"] .field__label'), /Lessoni per day/);
});

test('4. a word that is too long or empty is refused inline, in words, and nothing changes', async () => {
  const before = (await settings()).periodCustom;
  await typeInto(key('day-word:custom-word'), 'A very long word indeed');
  await shows(() => !document.querySelector('[data-card="school-day"] .sch-wordother .field__refusal')?.hidden);
  assert.match(await text('[data-card="school-day"] .sch-wordother .field__refusal'), /at most 16 characters/);
  assert.deepEqual((await settings()).periodCustom, before);
  await typeInto(key('day-word:custom-word'), 'Class');
  await settled();
  assert.equal((await settings()).periodCustom.word, 'Class');
  assert.equal((await settings()).periodCustom.plural, 'Classs', 'a new word has its own plural (the word and s, until one is typed); the old word’s Lessoni is not carried');
  assert.equal(await page.$eval(key('day-word:custom-word'), (el) => el.getAttribute('aria-invalid')), null, 'the refusal goes when a word is taken');
});

test('5. leaving Other word says so in the toast, and Undo brings the word back', async () => {
  await closeToast();
  await page.click(radio('Hour'));
  await settled();
  assert.equal((await settings()).periodCustom, undefined);
  assert.equal((await settings()).periodWord, 'Hour');
  await toastSays('The word Class is gone.');
  await page.click('.toast__action');
  await settled();
  assert.equal((await settings()).periodCustom.word, 'Class', 'Undo took the word back');
  assert.equal((await settings()).periodWord, 'Hour', 'and the word that was under it is the one it was');
  // a different word than the one under it is two steps, and Undo takes both
  await closeToast();
  await page.click(radio('Block'));
  await settled();
  assert.deepEqual([(await settings()).periodWord, (await settings()).periodCustom], ['Block', undefined]);
  await page.click('.toast__action');
  await settled();
  assert.deepEqual([(await settings()).periodWord, (await settings()).periodCustom.word], ['Hour', 'Class'], 'Undo from the toast takes back both steps');
  // leaving again, and choosing Other word again, brings the word it left
  await closeToast();
  await page.click(radio('Hour'));
  await settled();
  assert.equal((await settings()).periodCustom, undefined);
  await closeToast();
  await page.click(radio('other'));
  await settled();
  assert.equal((await settings()).periodCustom.word, 'Class', 'Other word again takes the word it left');
  await page.click(radio('Period'));
  await settled();
  await closeToast();
});

test('6. Name periods is a disclosure with "n named", each name one undo step, the refusals inline', async () => {
  const toggle = key('names:toggle');
  assert.equal(await text('[data-part="named-count"]'), '0 named');
  assert.equal(await page.$eval(toggle, (el) => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await exists('.sch-names__row'), false, 'the table is not drawn while the disclosure is shut');
  await page.focus(toggle);
  await page.keyboard.press('Enter');
  await shows(() => document.querySelectorAll('.sch-names__row').length === 8);
  assert.equal(await page.$eval(toggle, (el) => el.getAttribute('aria-expanded')), 'true');
  assert.equal(await activeKey(), 'names:toggle');
  assert.equal(await page.$eval('.sch-names__row[data-period="4"] .field__label', (el) => el.textContent), 'Period 5');
  assert.equal(await page.$eval('.sch-names__row[data-period="4"] input', (el) => el.placeholder), 'No name');
  assert.match(await text('.sch-names__panel .sch-hint'), /^A name replaces the number on screens and in the staff browser \(Lunch, Advisory\)\. The number stays in files and imports\.$/);

  // a name by keyboard: Tab to the field, type, Enter
  await typeInto('.sch-names__row[data-period="2"] input', 'Study hall');
  await settled();
  assert.deepEqual((await settings()).periodNames, ['', '', 'Study hall']);
  assert.equal(await text('[data-part="named-count"]'), '1 named');
  await undo();
  assert.equal((await settings()).periodNames, undefined, 'one undo takes the one name away');
  assert.equal(await text('[data-part="named-count"]'), '0 named');

  // the refusals, each inline and in words
  const refusal = async (period, words, pattern) => {
    await typeInto('.sch-names__row[data-period="' + period + '"] input', words);
    await shows((p) => !document.querySelector('.sch-names__row[data-period="' + p + '"] .field__refusal')?.hidden, period);
    assert.match(await text('.sch-names__row[data-period="' + period + '"] .field__refusal'), pattern, words);
    assert.equal(await page.$eval('.sch-names__row[data-period="' + period + '"] input', (el) => el.getAttribute('aria-invalid')), 'true');
    assert.equal((await settings()).periodNames, undefined, words + ' is refused and nothing is saved');
  };
  await refusal(4, '7', /cannot be just a number/);
  await refusal(4, 'Period 3', /number name of another period/);
  await refusal(4, 'P3', /would be read as Period 3/);
  await refusal(4, 'x'.repeat(30), /at most 24 characters/);
  await refusal(0, 'Group', /column heading an import reads/);
});

test('7. the same name on two periods is allowed and said under both', async () => {
  await typeInto('.sch-names__row[data-period="1"] input', 'Study');
  await settled();
  await typeInto('.sch-names__row[data-period="6"] input', 'study');
  await settled();
  for (const period of [1, 6]) assert.equal(await text('.sch-names__row[data-period="' + period + '"] .sch-names__twin'), 'Two periods are named ' + (period === 1 ? 'Study' : 'study') + '; imports match them by number.');
  await typeInto('.sch-names__row[data-period="1"] input', '');
  await typeInto('.sch-names__row[data-period="6"] input', '');
  await settled();
  assert.equal((await settings()).periodNames, undefined);
});

test('8. a name as typed is kept as typed, never read as markup', async () => {
  await typeInto('.sch-names__row[data-period="3"] input', HOSTILE);
  await settled();
  assert.equal((await settings()).periodNames[3], HOSTILE);
  assert.equal(await page.$eval('.sch-names__row[data-period="3"] input', (el) => el.value), HOSTILE);
  assert.equal(await exists('.sch-names b'), false);
  await typeInto('.sch-names__row[data-period="3"] input', '');
  await settled();
});

test('9. a name that reads as a kind of mark offers the school mark under its field; the button makes it in one step and the toast is said once', async () => {
  await closeToast();
  await typeInto('.sch-names__row[data-period="4"] input', 'Lunch');
  await settled();
  const nudge = '.sch-names__row[data-period="4"] .sch-names__nudge';
  assert.match(await text(nudge), /^Named Lunch, but still counted as a teaching or free period\. Mark it as lunch for the whole school$/);
  assert.equal(await toastNow(), 'Period 5 is named Lunch, but it is still counted as a teaching or free period. Mark it as lunch under its name.');
  await closeToast();
  // the name changed and changed back says nothing a second time
  await typeInto('.sch-names__row[data-period="4"] input', 'Study');
  await settled();
  await closeToast();
  await typeInto('.sch-names__row[data-period="4"] input', 'Lunch');
  await settled();
  assert.equal(await toastNow(), null, 'the toast was said once');
  const before = (await marks()).length;
  await page.click(nudge + ' button');
  await settled();
  const after = await marks();
  assert.equal(after.length, before + 1);
  assert.deepEqual(
    { kind: after[after.length - 1].kind, scope: after[after.length - 1].scope, period: after[after.length - 1].period, dayTypeIds: after[after.length - 1].dayTypeIds },
    { kind: 'lunch', scope: 'school', period: 4, dayTypeIds: [] });
  assert.equal(await exists(nudge), false, 'the offer goes once the mark covers the period');
  assert.equal(await toastNow(), 'Period 5 (Lunch) is marked as lunch for the whole school.');
  await undo();
  assert.equal((await marks()).length, before, 'one undo takes the mark and only the mark');
  assert.equal((await settings()).periodNames[4], 'Lunch');
  assert.equal(await exists(nudge), true, 'and the offer is back');
  // an Advisory name offers the advisory mark
  await typeInto('.sch-names__row[data-period="5"] input', 'advisory');
  await settled();
  assert.match(await text('.sch-names__row[data-period="5"] .sch-names__nudge'), /Mark it as advisory for the whole school$/);
  await typeInto('.sch-names__row[data-period="5"] input', 'Lab');
  await settled();
  assert.equal(await exists('.sch-names__row[data-period="5"] .sch-names__nudge'), false, 'a name that is not one of the four offers nothing');
});

test('10. the named period reads "Lunch" in the grid editor and "Period 5 (Lunch)" in the group editor’s row head', async () => {
  await go(page, '#schedule/grid');
  await page.waitForSelector('.grd-head--period');
  const heads = await page.$$eval('.grd-head--period', (all) => all.map((el) => el.textContent));
  assert.ok(heads.includes('Lunch'), 'the grid editor’s header says Lunch: ' + heads.join(' | '));
  await go(page, '#schedule/groups');
  await page.waitForSelector('.sch-slot__period');
  const rows = await page.$$eval('.sch-slot__period', (all) => all.map((el) => el.textContent));
  assert.ok(rows.some((row) => row.includes('Period 5 (Lunch)')), 'the row head names the number and the name: ' + rows.join(' | '));
  await go(page, '#schedule/day');
});

test('11. Settings has the same radio group and Other word fields, by keyboard', async () => {
  await go(page, '#project');
  await page.waitForSelector('[data-setting="day.2"]');
  const labels = await page.$$eval('[data-setting="day.2"] .sch-periodword > .seg .seg__label', (all) => all.map((el) => el.textContent));
  assert.deepEqual(labels, ['Period', 'Mod', 'Block', 'Hour', 'Other word…']);
  await page.focus('[data-setting="day.2"] .seg__input:checked');
  await page.keyboard.press('ArrowRight');
  await shows(() => globalThis.sv2.store.project.settings.periodWord === 'Mod');
  await page.focus(key('setting-word:Mod'));
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await shows(() => !document.querySelector('[data-setting="day.2"] .sch-wordother').hidden);
  assert.equal(await activeKey(), 'setting-word:other', 'Other word opens its fields and the focus stays on the radio');
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'setting-word:custom-word');
  await page.keyboard.type('Session');
  await page.keyboard.press('Enter');
  await shows(() => globalThis.sv2.store.project.settings.periodCustom?.word === 'Session');
  assert.equal(await text('[data-setting="day.2"] [data-part="word-sample"]'), '1st Session, 2nd Session, … 8th Session', 'the count chosen before is the one kept within the page');
  await page.click(key('setting-word:count:number'));
  await shows(() => globalThis.sv2.store.project.settings.periodCustom?.count === 'number');
  assert.equal(await text('[data-setting="day.2"] [data-part="word-sample"]'), 'Session 1, Session 2, … Session 8');
  assert.match(await text('[data-setting="day.1"] .setting__label'), /Sessions per day/);
  await page.click(key('setting-word:Block'));
  await shows(() => globalThis.sv2.store.project.settings.periodCustom === undefined);
  await toastSays('The word Session is gone.');
  await closeToast();
  assert.equal((await settings()).periodWord, 'Block');
});

test('12. at 390 px the card and Settings fit with no sideways scroll, and every new control is 44 px', async () => {
  phone = await openPlanner({ hash: '#schedule/day', width: 390, height: 844, mobile: true, browser: session.browser, server: session.server, theme: 'light' });
  const p = phone.page;
  await p.waitForSelector('[data-card="school-day"]');
  await p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
  await p.click('[data-card="school-day"] ' + key('day-word:other'));
  await p.waitForFunction(() => !document.querySelector('[data-card="school-day"] .sch-wordother').hidden, { timeout: 8000 });
  await p.click('[data-card="school-day"] ' + key('names:toggle'));
  await p.waitForSelector('.sch-names__row');
  const fits = () => p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, card: (document.querySelector('[data-card="school-day"]')?.scrollWidth || 0) - (document.querySelector('[data-card="school-day"]')?.clientWidth || 0) }));
  const day = await fits();
  assert.ok(day.scroll <= day.width && day.card <= 0, 'Day card 1 fits at 390: ' + JSON.stringify(day));
  const rows = await p.$$eval('.sch-names__row', (all) => all.map((el) => el.getBoundingClientRect().left));
  assert.equal(new Set(rows).size, 1, 'the names are one column of rows');
  for (const selector of ['.sch-periodword > .seg .seg__label', '.sch-names__toggle', '.sch-names__row input', '.sch-wordother input[type="text"]']) {
    const heights = await p.$$eval(selector, (all) => all.map((el) => el.getBoundingClientRect().height));
    assert.ok(heights.length > 0 && heights.every((height) => height >= 44), selector + ' is 44 px tall: ' + heights.join(', '));
  }
  await goHash(p, '#project');
  await p.waitForSelector('[data-setting="day.2"]');
  const project = await fits();
  assert.ok(project.scroll <= project.width, 'Settings fits at 390: ' + JSON.stringify(project));
  await assertTouch(p, 'the phone');
});

test('13. no page errors, and nothing asked for outside the tool', async () => {
  assert.deepEqual(session.problems().errors, []);
  assert.deepEqual(session.offsite, []);
});
