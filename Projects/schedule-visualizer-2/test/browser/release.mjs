// Staggered dismissal in a real browser: node test/browser/release.mjs
//
// DESIGN 12.2 and 12.3 by pointer, keyboard and touch, on the sample school.
// The journey, in order: the Day tab's sixth card and its empty state; a grade
// added (its sentence, its toast, one Undo); the editor in place, minutes and
// seconds committed by Enter and by leaving the field, a refusal said under
// the field, one undo step an edit; "after Period 4" and "only on B Day"; a
// groups entry on the bell and the "has its own" note on the grade it beats; a
// wing entry from the wings the rooms have, and the words when none has; a
// remove with its Undo; the entry added by keyboard; Movement's Travel time tab
// and its CSV files with and without a delay, the held group's Late cell naming
// the cause; the card at 390 by 844 with touch, every target 44 px; axe on the
// three editors, light and dark. Every wait is on a state the page sets
// (`data-pending` gone from the section, a toast's words, a status line),
// never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, go as goHash, startServer, launch, loadModule, assertTouch, atRest, TOOL_DIR } from './harness.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

let server;
let browser;
let session;
let page;
let phone = null;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const texts = (selector) => page.$$eval(selector, (all) => all.map((el) => el.textContent));
const exists = (selector) => page.$(selector).then((found) => found !== null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);
const key = (name) => '[data-key="' + name + '"]';
const release = async () => (await project()).release || [];

async function go(p, hash) {
  await goHash(p, hash);
  const tab = hash.match(/^#schedule\/([a-z]+)/);
  if (tab) await p.waitForFunction((wanted) => document.querySelector('.sch [data-tab="' + wanted + '"]:not([role="tab"])') !== null, { timeout: 8000 }, tab[1]);
}
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());

async function toastSays(words) {
  try {
    await shows((wanted) => document.querySelector('.toast .toast__text')?.textContent === wanted, words);
  } catch (error) {
    assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null), words);
  }
}

async function click(selector) {
  await settled();
  await closeToast();
  await page.click(selector);
  await settled();
}

async function type(selector, words) {
  await settled();
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
  await settled();
}

// Type into a field of the editor once it has come to rest after a redraw,
// then press `finish` (Enter commits; Tab leaves the field, which commits).
async function typeInto(selector, words, finish) {
  await settled();
  await atRest(page, selector);
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(words);
  await page.keyboard.press(finish);
}

// The release list has this many entries once the project says so.
const entries = (n) => shows((wanted) => (globalThis.sv2.store.project.release || []).length === wanted, n);

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await page.waitForSelector('.sch');
  await settled();
  await loadModule(page, 'actions', 'engine/actions.js');
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (phone) await phone.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

// ------------------------------------------------------------------ the card

test('the Day tab has a sixth card, Staggered dismissal, that says what it is for until there is one', async () => {
  assert.deepEqual(await texts('.sch-daytab .sch-card__title'), ['The school day', 'Day types', 'Regular bells', 'Other bell schedules', 'Marked periods', 'Staggered dismissal']);
  assert.equal(await text('[data-card="release"] .sch-hint'), 'The wing is the wing of the room the group leaves. A rule for named groups beats a wing’s or a grade’s; between a grade and a wing, the grade’s wins.');
  assert.equal(await text('[data-card="release"] .sch-marks__empty'), 'Hold some groups back a minute or two so the corridors clear. A group held back has less time to walk, and Movement and the checks count that.');
  assert.equal(await page.$eval(key('release-new'), (el) => el.classList.contains('btn--primary')), true, 'with none, Add is the main button');
  assert.equal(await text(key('release-new')), 'Add a staggered dismissal');
});

test('a grade, 2 min after the bell: the editor opens on Who, Add waits for a grade, the sentence reads back, one toast and one Undo', async () => {
  await click(key('release-new'));
  await page.waitForSelector('.sch-releaseedit');
  assert.equal(await activeKey(), 'release:new:who:groups', 'the focus is on the first field');
  assert.equal(await page.$eval(key('release-new'), (el) => el.disabled), true, 'a second new one waits for the first');
  assert.deepEqual(await page.$eval('.sch-releaseedit fieldset', (set) => Array.from(set.querySelectorAll('.sch-radio'), (el) => el.textContent)), ['Groups…', 'A grade', 'A wing']);
  await click(key('release:new:who:grade'));
  assert.equal(await page.$eval(key('release:new:add'), (el) => el.disabled), true, 'Add waits for a grade');
  assert.equal(await text('.sch-markedit__missing'), 'Choose a grade to finish.');
  assert.deepEqual(await texts('.sch-markedit__chips[aria-label="Grades"] button'), ['Grade 6', 'Grade 7', 'Grade 8'], 'the grades the groups are in');
  await click('.sch-markedit__chips [data-grade="7"]');
  assert.equal(await page.$eval('.sch-markedit__chips [data-grade="7"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await text('.sch-markedit__says'), 'grade 7 leaves 2 min after the bell, after every period, every day type (3 groups)');
  assert.equal(await page.$eval(key('release:new:add'), (el) => el.disabled), false);
  await click(key('release:new:add'));
  await page.waitForSelector('.sch-marks__line');
  await entries(1);
  assert.equal(await text('[data-card="release"] .sch-marks__line'), 'grade 7 leaves 2 min after the bell, after every period, every day type (3 groups)');
  const [entry] = await release();
  assert.deepEqual([entry.who, entry.seconds, entry.after, entry.dayTypeIds], [{ grade: '7' }, 120, null, null]);
  assert.equal(await activeKey(), 'release:' + entry.id + ':open', 'the focus is on the line that was added');
  await toastSays('Added: grade 7 leaves 2 min after the bell, after every period, every day type (3 groups).');
  // one undo step takes it back
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await entries(0);
  await shows(() => document.querySelector('[data-card="release"] .sch-marks__empty') !== null);
  await page.evaluate(() => globalThis.sv2.ctx.redo());
  await entries(1);
  await page.waitForSelector('[data-card="release"] .sch-marks__line');
});

test('the editor in place: minutes and seconds commit on Enter and on leaving the field, a refusal is said under the field, and each edit is one undo step with a toast', async () => {
  const [entry] = await release();
  const id = entry.id;
  await click('[data-card="release"] .sch-marks__line');
  await page.waitForSelector('.sch-releaseedit');
  assert.equal(await activeKey(), 'release:' + id + ':who:grade', 'the focus is in the editor, on the first field');
  assert.equal(await page.$eval(key('release:' + id + ':minutes'), (el) => el.value), '2');
  assert.equal(await page.$eval(key('release:' + id + ':seconds'), (el) => el.value), '0');
  // Enter commits
  await typeInto(key('release:' + id + ':seconds'), '30', 'Enter');
  await shows((wanted) => globalThis.sv2.store.project.release[0].seconds === wanted, 150);
  await toastSays('Changed to: grade 7 leaves 2 min 30 s after the bell, after every period, every day type (3 groups).');
  assert.equal(await text('.sch-markedit__says'), 'grade 7 leaves 2 min 30 s after the bell, after every period, every day type (3 groups)');
  // leaving the field commits too
  await typeInto(key('release:' + id + ':minutes'), '1', 'Tab');
  await shows((wanted) => globalThis.sv2.store.project.release[0].seconds === wanted, 90);
  // 20 s is not a step of 15: the field says so and nothing changes
  await typeInto(key('release:' + id + ':seconds'), '20', 'Enter');
  await shows(() => document.querySelector('.sch-releaseedit .field__refusal:not([hidden])') !== null);
  assert.equal(await text('.sch-releaseedit .field__refusal:not([hidden])'), 'Seconds go in steps of 15: 0, 15, 30 or 45.');
  assert.equal(await page.$eval(key('release:' + id + ':seconds'), (el) => el.getAttribute('aria-invalid')), 'true');
  assert.equal((await release())[0].seconds, 90, 'nothing changed');
  await page.keyboard.press('Escape');
  // 9 minutes is past the longest: refused by the engine, said under the field
  await typeInto(key('release:' + id + ':minutes'), '9', 'Enter');
  await shows(() => document.querySelector('.sch-releaseedit .field__refusal:not([hidden])') !== null);
  assert.match(await text('.sch-releaseedit .field__refusal:not([hidden])'), /Minutes goes from 0 to 5\.|whole number of seconds from 15 to 300/);
  assert.equal((await release())[0].seconds, 90);
  await page.keyboard.press('Escape');
  // each edit was one step: two undos return to 2 min, a third to the start of the card's life
  await settled();
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await shows((wanted) => globalThis.sv2.store.project.release[0].seconds === wanted, 150);
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await shows((wanted) => globalThis.sv2.store.project.release[0].seconds === wanted, 120);
  // the editor, open through the undo, says it is as it is now
  await shows(() => document.querySelector('.sch-releaseedit') === null || document.querySelector('.sch-markedit__says')?.textContent.includes('leaves 2 min after the bell'));
  assert.equal((await release())[0].seconds, 120);
});

test('after Period 4 and only on B Day: ticks commit as they are ticked, the sentence follows, and an empty set waits', async () => {
  const [entry] = await release();
  const id = entry.id;
  if (!(await exists('.sch-releaseedit'))) await click('[data-card="release"] .sch-marks__line');
  await page.waitForSelector('.sch-releaseedit');
  await click(key('release:' + id + ':after:some'));
  assert.match(await text('.sch-markedit__missing'), /^Tick a period to finish\. Nothing changes until then\.$/);
  assert.equal((await release())[0].after, null, 'nothing changed until a period is ticked');
  await click(key('release:' + id + ':period:3'));
  await shows(() => JSON.stringify(globalThis.sv2.store.project.release[0].after) === '[3]');
  await click(key('release:' + id + ':days:some'));
  assert.match(await text('.sch-markedit__missing'), /^Tick a day type to finish\./);
  await click(key('release:' + id + ':day:dsample00b'));
  await shows(() => JSON.stringify(globalThis.sv2.store.project.release[0].dayTypeIds) === '["dsample00b"]');
  assert.equal(await text('.sch-markedit__says'), 'grade 7 leaves 2 min after the bell, after Period 4, on B Day (3 groups)');
  assert.deepEqual(await texts('.sch-markedit__ticks[aria-label="Day types this staggered dismissal is on"] .sch-radio'), ['A Day', 'B Day'], 'own day types');
  await click(key('release:' + id + ':done'));
  assert.equal(await exists('.sch-releaseedit'), false);
  assert.equal(await activeKey(), 'release:' + id + ':open', 'the focus is back on the line that opened it');
  assert.equal(await text('[data-card="release"] .sch-marks__line'), 'grade 7 leaves 2 min after the bell, after Period 4, on B Day (3 groups)');
});

test('a groups entry on the bell beats the grade, and the grade\'s line says so', async () => {
  await click(key('release-new'));
  await page.waitForSelector('.sch-releaseedit');
  await page.focus(key('release:new:group-add'));
  await page.keyboard.type('7A');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settled();
  assert.equal(await page.$$eval('.sch-markedit__chips .chip', (all) => all.length), 1);
  await click(key('release:new:on-bell'));
  assert.equal(await page.$eval(key('release:new:minutes'), (el) => el.disabled), true, 'on the bell leaves nothing to type');
  assert.equal(await text('.sch-markedit__says'), '7A leaves on the bell, after every period, every day type');
  await click(key('release:new:add'));
  await entries(2);
  const lines = await texts('[data-card="release"] .sch-marks__line');
  assert.deepEqual(lines, ['grade 7 leaves 2 min after the bell, after Period 4, on B Day (3 groups)', '7A leaves on the bell, after every period, every day type']);
  assert.deepEqual(await texts('[data-card="release"] .sch-marks__beaten'), ['(7A has its own)'], 'the grade\'s line says who beats it, in the note colour');
  assert.equal((await release())[1].seconds, 0);
  assert.deepEqual((await release())[1].who, { groups: ['gsample07a'] });
});

test('a wing from the wings the rooms have: the chips are the rooms\' wings, and the wing reads "North wing"', async () => {
  await click(key('release-new'));
  await page.waitForSelector('.sch-releaseedit');
  await click(key('release:new:who:wing'));
  assert.equal(await text('.sch-markedit__missing'), 'Choose a wing to finish.');
  const wings = await texts('.sch-markedit__chips[aria-label="Wings"] button');
  assert.deepEqual(wings, ['East wing', 'Music Wing', 'West wing'], 'every wing a room has, once');
  await click('.sch-markedit__chips [data-wing="West"]');
  assert.equal(await text('.sch-markedit__says'), 'West wing leaves 2 min after the bell, after every period, every day type');
  await click(key('release:new:add'));
  await entries(3);
  assert.deepEqual((await release())[2].who, { wing: 'West' });
  assert.deepEqual(await texts('[data-card="release"] .sch-marks__beaten'), ['(7A has its own)', '(grade 7 and 7A have their own)'], 'a rule for named groups beats the grade, and both beat the wing');
});

test('with no wings on any room the wing choice says so and links to the Building section', async () => {
  const before = await project();
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const next = JSON.parse(JSON.stringify(store.project));
    for (const floor of next.building.floors) for (const space of floor.spaces) if (space.kind === 'room') space.wing = '';
    next.release = [];
    store.replace(next);
  });
  await settled();
  await shows(() => document.querySelector('[data-card="release"] .sch-marks__empty') !== null);
  await click(key('release-new'));
  await page.waitForSelector('.sch-releaseedit');
  await click(key('release:new:who:wing'));
  assert.equal(await text('.sch-markedit__nowings'), 'No rooms have a wing yet. Give rooms a wing in the Building section and a rule can follow them.');
  assert.equal(await page.$eval('.sch-markedit__nowings a', (el) => el.getAttribute('href')), '#building');
  await click(key('release:new:cancel'));
  assert.equal(await exists('.sch-releaseedit'), false);
  assert.equal(await activeKey(), 'release-new', 'Cancel returns the focus to the button that opened it');
  // put the school back as it was, with its wings
  await page.evaluate((saved) => globalThis.sv2.store.replace(saved), before);
  await settled();
});

test('removing an entry says what went and Undo brings it back with the focus on its line; with none the empty words return', async () => {
  // the school is back to the wings; make one entry through the editor
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addRelease, { who: { grade: '8' }, seconds: 60, after: [1], dayTypeIds: null }));
  await settled();
  const [entry] = (await release()).slice(-1);
  await page.waitForSelector('[data-release="' + entry.id + '"]');
  await click('[data-release="' + entry.id + '"] .sch-marks__line');
  await click(key('release:' + entry.id + ':remove'));
  await toastSays('Removed: grade 8 leaves 1 min after the bell, after Period 2, every day type (2 groups).');
  await shows((id) => !(globalThis.sv2.store.project.release || []).some((each) => each.id === id), entry.id);
  await page.click('.toast .toast__action');
  await shows((id) => (globalThis.sv2.store.project.release || []).some((each) => each.id === id), entry.id);
  await shows((id) => document.activeElement?.dataset.key === 'release:' + id + ':open', entry.id);
  // take every one away: the empty words return and the Add button is the main one again
  for (const each of await release()) await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.removeRelease, { id }), each.id);
  await settled();
  await shows(() => document.querySelector('[data-card="release"] .sch-marks__empty') !== null);
  assert.equal(await page.$eval(key('release-new'), (el) => el.classList.contains('btn--primary')), true);
});

test('by keyboard: Tab to Add, Enter opens the editor, arrows choose the kind, Space ticks, Enter adds', async () => {
  await settled();
  await page.focus(key('release-new'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-releaseedit');
  assert.equal(await activeKey(), 'release:new:who:groups');
  await page.keyboard.press('ArrowDown');
  await settled();
  assert.equal(await activeKey(), 'release:new:who:grade', 'an arrow chooses the radio');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.grade || null), '6', 'Tab goes on to the first grade');
  await page.keyboard.press('Space');
  await settled();
  assert.equal(await page.$eval('.sch-markedit__chips [data-grade="6"]', (el) => el.getAttribute('aria-pressed')), 'true');
  // the add button is reached by Tab and pressed by Enter
  await page.focus(key('release:new:add'));
  await page.keyboard.press('Enter');
  await entries(1);
  assert.deepEqual((await release())[0].who, { grade: '6' });
  assert.equal((await release())[0].seconds, 120);
});

// ------------------------------------------------------------------ Movement

// Take what the Export tab would have downloaded.
async function delivered(action) {
  await page.evaluate(() => {
    globalThis.sv2test = { files: [] };
    document.querySelector('#inspector [data-panel="export"]').exports.hooks.deliver = (file) => globalThis.sv2test.files.push(file);
  });
  await page.click('#inspector [data-action="' + action + '"]');
  await page.waitForFunction(() => globalThis.sv2test.files.length > 0);
  return page.evaluate(() => {
    const file = globalThis.sv2test.files[0];
    document.querySelector('#inspector [data-panel="export"]').exports.hooks.deliver = null;
    return { fileName: file.fileName, text: file.text || null };
  });
}

const movementSettled = () => page.waitForFunction(() => {
  const section = document.querySelector('.mov');
  if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
  const movement = section.movement;
  return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project;
}, { timeout: 15000 });

test('Movement: with grade 7 held back 2 min the Travel time tab and both CSV files gain Left after the bell, and a late held group says why; with none they are as they were', async () => {
  // grade 6 is on the card from the keyboard test; make it grade 7 for two minutes
  const [entry] = await release();
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setRelease, { id, who: { grade: '7' }, seconds: 120 }), entry.id);
  await settled();
  await goHash(page, '#movement');
  await movementSettled();
  await page.click('#inspector [role="tab"][data-tab="tables"]');
  await page.waitForSelector('#inspector [data-panel="tables"] .mov-travel__group');
  assert.deepEqual(await texts('#inspector [data-travel="transition"] thead th'), ['Walking', 'Waiting', 'Left after the bell', 'Total']);
  assert.match(await text('[data-travel="lead"]'), /Left after the bell is the time a group was held back by a staggered dismissal/);
  const cells = await page.$$eval('#inspector [data-travel="transition"] .mov-travel__group', (all) => all.map((group) => [group.querySelector('.mov-travel__name').textContent, Array.from(group.querySelectorAll('td'), (td) => td.textContent), group.querySelector('.mov-groups__late, .mov-travel__fits')?.textContent || '']));
  assert.ok(cells.length > 0);
  for (const [name, tds] of cells) assert.equal(tds[2], name.startsWith('7') ? '2 min' : 'none', name + ': Left after the bell');
  const lateWhole = await page.$$eval('#inspector [data-travel="day"] .mov-groups__late', (all) => all.map((el) => el.textContent));
  assert.ok(lateWhole.length >= 1, 'a group held back is late at least once in the day');
  // the files
  await page.click('#inspector [role="tab"][data-tab="export"]');
  await page.waitForSelector('#inspector [data-panel="export"] [data-action="csv-transitions"]');
  const byTransition = await delivered('csv-transitions');
  const header = byTransition.text.split('\r\n')[0].split('\n')[0];
  assert.ok(header.includes('"Waiting (seconds)"') || header.includes('Waiting (seconds)'), header);
  assert.match(header, /Waiting \(seconds\),"?Left after the bell \(seconds\)"?,"?Total \(seconds\)/);
  const byGroup = await delivered('csv-day');
  assert.match(byGroup.text.split('\n')[0], /Waiting \(seconds\),"?Left after the bell \(seconds\)"?,"?Total \(seconds\)/);
  const lateRow = byTransition.text.split('\n').find((row) => row.includes(',late,'));
  assert.ok(lateRow, 'a late walk in the file');
  // with none: back to today's screens
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await movementSettled();
  const gone = await page.evaluate(() => globalThis.sv2.store.project.release[0].who.grade);
  assert.equal(gone, '6', 'Undo of the edit put the keyboard test\'s grade back');
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.removeRelease, { id: globalThis.sv2.store.project.release[0].id }));
  await movementSettled();
  await page.click('#inspector [role="tab"][data-tab="tables"]');
  await page.waitForSelector('#inspector [data-panel="tables"] .mov-travel__group');
  assert.deepEqual(await texts('#inspector [data-travel="transition"] thead th'), ['Walking', 'Waiting', 'Total']);
  assert.equal((await text('[data-travel="lead"]')).includes('Left after'), false);
  await page.click('#inspector [role="tab"][data-tab="export"]');
  const plain = await delivered('csv-transitions');
  assert.equal(plain.text.includes('Left after the bell'), false, 'no delay, no column in the file');
  await goHash(page, '#schedule/day');
  await settled();
});

// ------------------------------------------------------------------ axe

for (const theme of ['light', 'dark']) {
  test('axe finds nothing in the card with each editor open, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await go(page, '#schedule/day');
    await settled();
    if (!(await exists('.sch-releaseedit'))) await click(key('release-new'));
    await page.waitForSelector('.sch-releaseedit');
    await page.addScriptTag({ path: AXE });
    for (const kind of ['groups', 'grade', 'wing']) {
      await click(key('release:new:who:' + kind));
      if (kind === 'groups') {
        await page.focus(key('release:new:group-add'));
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await settled();
      }
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      const found = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('[data-card="release"]'), { runOnly: { type: 'tag', values: tags } }), TAGS);
      assert.ok(found.passes.length > 5, 'axe ran very few rules');
      assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], kind + ' editor, ' + theme);
    }
    await click(key('release:new:cancel'));
  });
}

// ------------------------------------------------------------------ phone

test('at 390 by 844 with touch: an entry is added by tap, every control is 44 px, and the card does not scroll sideways', async () => {
  await page.close();
  phone = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  const wait = () => p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
  const tap = async (selector) => {
    await wait();
    await p.waitForSelector(selector);
    await p.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
    await p.tap(selector);
    await wait();
  };
  await assertTouch(p, 'release at 390');
  await wait();
  await tap(key('release-new'));
  await p.waitForSelector('.sch-releaseedit');
  await tap(key('release:new:who:grade'));
  await p.waitForSelector('.sch-markedit__chips button');
  await tap(key('release:new:days:some'));
  await p.waitForSelector('.sch-markedit__ticks input');
  await tap(key('release:new:after:some'));
  await p.waitForSelector('.sch-markedit__ticks input');
  const small = () => p.evaluate((selector) => Array.from(document.querySelectorAll(selector))
    .map((el) => [el.className || el.tagName, el.textContent.slice(0, 20), Math.round(el.getBoundingClientRect().height)]).filter(([, , height]) => height < 44),
  '.sch-releaseedit .btn, .sch-releaseedit .seg__label, .sch-releaseedit .sch-radio, .sch-releaseedit .sch-show__chip, .sch-releaseedit .field__input, .sch-releaseedit .chip__remove');
  assert.deepEqual(await small(), [], 'every control of the editor is 44 px tall');
  await tap('.sch-markedit__chips [data-grade="8"]');
  await tap(key('release:new:period:1'));
  await tap('.sch-markedit__ticks[aria-label="Day types this staggered dismissal is on"] input');
  await tap(key('release:new:add'));
  await p.waitForSelector('[data-card="release"] .sch-marks__line');
  assert.equal(await p.$eval('[data-card="release"] .sch-marks__line', (el) => el.textContent), 'grade 8 leaves 2 min after the bell, after Period 2, on A Day (2 groups)');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the Day tab does not scroll sideways');
  // the line is a target of 44 px too
  await p.$eval('[data-card="release"] .sch-marks__line', (el) => el.scrollIntoView({ block: 'center' }));
  assert.ok(await p.$eval('[data-card="release"] .sch-marks__line', (el) => el.getBoundingClientRect().height >= 44), 'the sentence is a 44 px button');
});
