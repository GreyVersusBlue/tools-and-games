// Projects on this device, the card and what follows a switch: node test/browser/projects.mjs
//
// The Project section's first card (ui/project/projects.js, DESIGN 15.2 with
// 15.9) in a real browser with a real IndexedDB. One journey, run four ways
// (by pointer at 1280 x 900, with the keyboard alone, at 390 x 844 and at
// 844 x 390): start another project, open it, go back, duplicate, rename,
// delete and restore as a project. Then, on the desktop page: the one-project
// form and the Label field (one undo step, the count from 50, a name shown as
// typed), the top bar's chip and the tab title only with more than one
// project, the limit, a read-only tab, a row that cannot be read, Start
// another project's one-per-id choices (the sample, a file that is the open
// project, a file that is kept) and the sample school's Load asking the same.
//
// Every wait is on a state the page sets: a card without data-pending, the
// reloaded page's marker gone, a dialog open or closed, a row count. Never a
// first paint and never a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection, clearSaved, plainSample } from './harness.mjs';

let session;
let page;
const extra = [];

const HOSTILE = '<img src=x onerror=alert(1)> “Next” & 学年';

// ---------------------------------------------------------------- helpers

const idbRead = (p, how, key) => p.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open('sv2');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const store = db.transaction('project', 'readonly').objectStore('project');
    const request = args.how === 'get' ? store.get(args.key) : store.getAllKeys();
    request.onsuccess = () => {
      db.close();
      resolve(JSON.parse(JSON.stringify(request.result === undefined ? null : request.result)));
    };
    request.onerror = () => reject(request.error);
  };
}), { how, key });

const idbPut = (p, key, value) => p.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open('sv2');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('project', 'readwrite');
    tx.objectStore('project').put(args.value, args.key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  };
}), { key, value });

const waitSaved = (p) => p.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });

// A page loaded again: the marker the old page set is gone, the planner is
// drawn on the Project section, and the Projects card has its list.
async function loaded(p) {
  await p.waitForFunction(() => globalThis.__before === undefined && globalThis.sv2 !== undefined
    && document.documentElement.dataset.ready === 'true' && document.querySelector('[data-pending="true"]') === null
    && document.querySelector('#projects') !== null, { timeout: 40000 });
  await waitForSection(p, 'project');
}

// The card has drawn its list (data-pending gone) with this many projects.
const listed = (p, n) => p.waitForFunction((wanted) => {
  const el = document.getElementById('projects');
  return el && !el.hasAttribute('data-pending') && el.dataset.projects === String(wanted);
}, { timeout: 15000 }, n);

const marker = (p) => p.evaluate(() => {
  globalThis.__before = true;
});

const dialogOpen = (p) => p.waitForFunction(() => document.querySelector('dialog.dialog[open]') !== null, { timeout: 15000 });
const dialogShut = (p) => p.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null, { timeout: 15000 });

// Tag the first element inside `scope` whose text is exactly `text`, and give a selector for it.
async function byText(p, scope, text) {
  const found = await p.evaluate((where, wanted) => {
    for (const old of document.querySelectorAll('[data-hit]')) old.removeAttribute('data-hit');
    const hit = Array.from(document.querySelectorAll(where + ' button, ' + where + ' a')).find((el) => el.textContent.trim() === wanted);
    if (hit) hit.setAttribute('data-hit', '1');
    return Boolean(hit);
  }, scope, text);
  assert.ok(found, 'a control "' + text + '" inside ' + scope);
  return '[data-hit="1"]';
}

// Press a control by the way this run presses: a click, or focus and Enter.
async function press(p, how, scope, text) {
  const selector = await byText(p, scope, text);
  if (how === 'keyboard') {
    await p.focus(selector);
    await p.keyboard.press('Enter');
  } else {
    await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector);
    await p.click(selector);
  }
}

// A row's button by the way this run presses: a click (scrolled into view), or focus and Enter.
async function pressRow(p, how, id, action) {
  await p.evaluate((rowId, which) => {
    for (const old of document.querySelectorAll('[data-hit]')) old.removeAttribute('data-hit');
    document.querySelector('#projects .proj__row[data-project-id="' + rowId + '"] [data-action="' + which + '"]').setAttribute('data-hit', '1');
  }, id, action);
  if (how === 'keyboard') {
    await p.focus('[data-hit="1"]');
    await p.keyboard.press('Enter');
  } else {
    await p.evaluate(() => document.querySelector('[data-hit="1"]').scrollIntoView({ block: 'center' }));
    await p.click('[data-hit="1"]');
  }
}

const rowsOf = (p) => p.$$eval('#projects .proj__row', (all) => all.map((li) => ({
  id: li.dataset.projectId,
  open: li.dataset.open === 'true',
  name: li.querySelector('.proj__label').textContent.replace(/[\u2066-\u2069]/g, ''),
  buttons: Array.from(li.querySelectorAll('button')).map((b) => b.textContent),
})));

const stateOf = (p) => p.evaluate(() => ({
  id: globalThis.sv2.store.project.id,
  label: globalThis.sv2.store.project.label ?? null,
  school: globalThis.sv2.store.project.settings.schoolName,
  opened: globalThis.sv2.storage.state.opened,
  readOnly: globalThis.sv2.storage.state.readOnly,
}));

const focusedIs = (p) => p.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, id: el.id, text: el.textContent.trim().slice(0, 40), inHeading: el.classList.contains('card__title') };
});

// a name in a sentence is isolated (U+2068 to U+2069); the words are read without the marks
const bare = (text) => (text === null ? null : text.replace(/[\u2066-\u2069]/g, ''));
const toastText = async (p) => bare(await p.evaluate(() => document.querySelector('.toast__text')?.textContent ?? null));

async function freshDevice(p) {
  await p.goto('about:blank');
  await clearSaved(p, session.base);
  await p.goto(session.url('#project'), { waitUntil: 'load' });
  await waitForSection(p, 'project');
  await plainSample(p);
  await waitSaved(p);
  await p.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
  await listed(p, 1);
}

async function withActions(p) {
  await p.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

// Type into the Label field and leave it (Enter), as a person does.
async function typeLabel(p, text) {
  await p.focus('#projects input.field__input');
  await p.evaluate(() => document.querySelector('#projects input.field__input').select());
  if (text === '') await p.keyboard.press('Backspace');
  else await p.keyboard.type(text);
  await p.keyboard.press('Enter');
  await p.waitForFunction((wanted) => (globalThis.sv2.store.project.label ?? '') === wanted, { timeout: 15000 }, text);
}

const noSideways = (p) => p.evaluate(() => {
  const scroller = document.getElementById('surface');
  return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, surface: scroller.scrollWidth - scroller.clientWidth };
});

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await withActions(page);
});

after(async () => {
  for (const other of extra) await other.close().catch(() => {});
  if (session) await session.close();
});

// ---------------------------------------------------------------- the journey, four ways

// start another, open it, back, duplicate, rename, delete, restore as a project
async function journey(p, how) {
  await freshDevice(p);
  const first = (await stateOf(p)).id;
  assert.equal((await stateOf(p)).opened, null, 'a page that was not reached by a switch has no sentence');
  assert.equal(await p.$eval('#projects [data-line="lead"]', (el) => el.textContent.startsWith('This device keeps one project: ')), true);

  // ---- start another project: Cancel is focused; Escape and Cancel keep everything
  await press(p, how, '#projects .card__buttons', 'Start another project…');
  await dialogOpen(p);
  assert.equal((await focusedIs(p)).text, 'Cancel', 'Cancel has the focus');
  const choices = await p.$$eval('dialog.dialog[open] .proj__choice-label', (all) => all.map((el) => el.textContent));
  assert.deepEqual(choices, ['Empty', 'The sample school', 'A project file…']);
  await p.keyboard.press('Escape');
  await dialogShut(p);
  assert.equal((await focusedIs(p)).text, 'Start another project…', 'the focus goes back to the button that opened it');
  assert.equal((await stateOf(p)).id, first, 'nothing moved');

  await press(p, how, '#projects .card__buttons', 'Start another project…');
  await dialogOpen(p);
  if (how === 'keyboard') {
    // the radios by arrow keys: sample, then file, then back to empty
    await p.focus('dialog.dialog[open] input[type="radio"]');
    await p.keyboard.press('ArrowDown');
    assert.equal(await p.$eval('dialog.dialog[open] input[type="radio"]:checked', (el) => el.value), 'sample');
    await p.keyboard.press('ArrowDown');
    assert.equal(await p.$eval('dialog.dialog[open] input[type="radio"]:checked', (el) => el.value), 'file');
    assert.equal(await p.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.textContent), 'Start', 'choosing the file only selects the radio');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowUp');
  }
  await marker(p);
  await press(p, how, 'dialog.dialog[open] .dialog__buttons', 'Start');
  await loaded(p);
  await listed(p, 2);
  const second = (await stateOf(p)).id;
  assert.notEqual(second, first, 'the page shows the new project');
  assert.equal((await rowsOf(p)).length, 2);
  assert.equal((await rowsOf(p))[0].open, true, 'the open project is first');
  assert.deepEqual((await rowsOf(p))[0].buttons, ['Delete…'], 'the open row has Delete… only, and it says why it cannot be used');
  assert.deepEqual((await rowsOf(p))[1].buttons, ['Open', 'Rename…', 'Delete…']);

  // ---- after the reload: the card's line, the status region, the focus
  assert.match(await p.$eval('#projects [data-line="opened"]', (el) => el.textContent), /^Opened .+ at \d/, 'the card says it');
  assert.match(await p.$eval('#shell-status', (el) => el.textContent), /^Opened /, 'the page\'s status region says it');
  assert.equal((await focusedIs(p)).inHeading, true, 'focus is on the card\'s heading');
  assert.equal(await p.$eval('#projects .card__title', (el) => el.getAttribute('tabindex')), '-1');
  assert.match(await toastText(p), /^Opened .+ is kept on this device\./, 'and a toast: ' + await toastText(p));

  // ---- the label: one undo step
  await typeLabel(p, 'Next year');
  assert.equal((await stateOf(p)).label, 'Next year');
  await p.waitForFunction(() => document.querySelector('#projects [data-line="lead"]').textContent.includes('Next year'));
  assert.equal(await p.$eval('#school-name', (el) => el.textContent.includes('· Next year')), true, 'the chip carries the label with two projects');
  assert.equal(await p.evaluate(() => document.title.startsWith('Next year · Project')), true, 'so does the title: ' + await p.title());
  await p.evaluate(() => globalThis.sv2.ctx.undo());
  assert.equal((await stateOf(p)).label, null, 'one undo takes the label away');
  assert.equal(await p.$eval('#projects input.field__input', (el) => el.value), '', 'and the field follows');
  await p.evaluate(() => globalThis.sv2.ctx.redo());
  assert.equal((await stateOf(p)).label, 'Next year');
  await waitSaved(p);

  // ---- back to the first project: Open on its row
  await marker(p);
  await press(p, how, '#projects .proj__row[data-open="false"]', 'Open');
  await loaded(p);
  await listed(p, 2);
  assert.equal((await stateOf(p)).id, first, 'back on the first project');
  assert.equal(await p.evaluate(() => document.title.startsWith('Project')), true, 'the first project has no label, so the title has none: ' + await p.title());
  assert.equal((await rowsOf(p)).find((row) => !row.open).name, 'Next year', 'the other row goes by its label');
  assert.equal((await focusedIs(p)).inHeading, true);
  assert.match(await toastText(p), /Next year is kept on this device|Your other projects are kept on this device\. Undo starts afresh for each project you open\./);

  // ---- open the second again, then duplicate it
  await marker(p);
  await press(p, how, '#projects .proj__row[data-open="false"]', 'Open');
  await loaded(p);
  await listed(p, 2);
  assert.equal((await stateOf(p)).id, second);
  await press(p, how, '#projects .card__buttons', 'Duplicate this project');
  await dialogOpen(p);
  const copyField = await p.$eval('dialog.dialog[open] input', (el) => ({ value: el.value, selected: el.selectionStart === 0 && el.selectionEnd === el.value.length, focused: el === document.activeElement }));
  assert.deepEqual(copyField, { value: 'Next year (copy)', selected: true, focused: true }, 'the copy is labelled "(copy)" and the label is selected');
  await marker(p);
  await press(p, how, 'dialog.dialog[open] .dialog__buttons', 'Duplicate and open it');
  await loaded(p);
  await listed(p, 3);
  const third = (await stateOf(p));
  assert.notEqual(third.id, second);
  assert.equal(third.label, 'Next year (copy)');
  assert.equal(await toastText(p), 'Opened Next year (copy). Next year is kept on this device.');
  assert.match(bare(await p.$eval('#projects [data-line="opened"]', (el) => el.textContent)), /^Opened Next year \(copy\) at /);

  // ---- rename the first project from its row
  const rows = await rowsOf(p);
  const firstRow = rows.find((row) => row.id === first);
  assert.deepEqual(firstRow.buttons, ['Open', 'Rename…', 'Delete…']);
  // every row button is named by its label
  const described = await p.$$eval('#projects .proj__row[data-open="false"] button', (all) => all.map((b) => document.getElementById(b.getAttribute('aria-describedby')).querySelector('.proj__label').textContent));
  assert.equal(described.length, 6);
  await pressRow(p, how, first, 'rename');
  await dialogOpen(p);
  assert.match(await p.$eval('dialog.dialog[open] .dialog__title', (el) => el.textContent), /^Rename /);
  await p.evaluate(() => document.querySelector('dialog.dialog[open] input').select());
  await p.keyboard.type('This year');
  if (how === 'keyboard') await p.keyboard.press('Enter');
  else await press(p, how, 'dialog.dialog[open] .dialog__buttons', 'Rename');
  await dialogShut(p);
  await listed(p, 3);
  await p.waitForFunction((id) => document.querySelector('#projects .proj__row[data-project-id="' + id + '"] .proj__label')?.textContent.replace(/[\u2066-\u2069]/g, '') === 'This year', { timeout: 15000 }, first);
  assert.equal(await p.evaluate(() => document.activeElement.dataset.action), 'rename', 'the focus is on the renamed row\'s Rename');

  // ---- delete the second project: asked first, Cancel is focused; then a toast with Restore as a project
  await pressRow(p, how, second, 'delete');
  await dialogOpen(p);
  assert.equal((await focusedIs(p)).text, 'Cancel');
  const asked = bare(await p.$eval('dialog.dialog[open]', (el) => el.textContent));
  assert.match(asked, /Delete Next year from this device\?/);
  assert.match(asked, /recovery point of it is kept first/);
  assert.match(asked, /newest 3 recovery points of each project you are not working on/);
  const buttonsAsked = await p.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((b) => b.textContent));
  assert.ok(buttonsAsked.includes('Delete') && buttonsAsked.at(-1) === 'Cancel', 'Delete and Cancel: ' + buttonsAsked);
  await press(p, how, 'dialog.dialog[open] .dialog__buttons', 'Cancel');
  await dialogShut(p);
  assert.equal((await rowsOf(p)).length, 3, 'Cancel deleted nothing');
  await pressRow(p, how, second, 'delete');
  await dialogOpen(p);
  await press(p, how, 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(p);
  await listed(p, 2);
  assert.equal((await rowsOf(p)).some((row) => row.id === second), false, 'the second project is gone from the list');
  assert.match(await toastText(p), /^Deleted Next year from this device\./);
  const afterDelete = await focusedIs(p);
  assert.ok(afterDelete.tag === 'BUTTON' || afterDelete.inHeading, 'the focus went to a row\'s button or the heading, not to the page: ' + JSON.stringify(afterDelete));

  // ---- Restore as a project, from the toast
  await marker(p);
  await press(p, how, '.toast', 'Restore as a project');
  await loaded(p);
  await listed(p, 3);
  const restored = await stateOf(p);
  assert.equal(restored.label, 'Next year', 'the deleted project is back, as a project, and open');
  assert.equal(restored.id, second);
  assert.equal(restored.opened.id, second);
}

test('the journey by pointer: start another, open it, back, duplicate, rename, delete, restore as a project', async () => {
  await journey(page, 'pointer');
});

test('the journey with the keyboard alone', async () => {
  await journey(page, 'keyboard');
});

for (const [name, width, height] of [['390 x 844', 390, 844], ['844 x 390', 844, 390]]) {
  test('the journey at ' + name + ': the rows stack, buttons are 44 px tall, nothing scrolls sideways', async () => {
    const phone = await openPlanner({ hash: '#project', width, height, mobile: true });
    extra.push(phone);
    const p = phone.page;
    const real = session;
    session = phone; // freshDevice and the helpers read the session's base and url
    try {
      await withActions(p);
      await journey(p, 'pointer');
      // this card's own boxes, not the page's: the Recovery points card's table (another unit's) is wider than a phone once points exist
      const over = await p.evaluate(() => Array.from(document.querySelectorAll('#projects, #projects *')).filter((el) => !el.classList.contains('vh') && el.getClientRects().length > 0 && (el.getBoundingClientRect().right > document.getElementById('surface').getBoundingClientRect().right + 0.5 || el.getBoundingClientRect().left < document.getElementById('surface').getBoundingClientRect().left - 0.5)).map((el) => el.tagName + '.' + String(el.className).slice(0, 30)));
      assert.deepEqual(over, [], 'nothing of the Projects card is past the edge with three projects listed');
      assert.equal((await noSideways(p)).page, 0, 'the page itself does not scroll sideways');
      const small = await p.$$eval('#projects .proj__row button, #projects .card__buttons .btn', (all) => all.filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent));
      assert.deepEqual(small, [], 'every button of the card is at least 44 px tall');
      if (width === 390) {
        const stacked = await p.$$eval('#projects .proj__row', (all) => all.every((li) => {
          const about = li.querySelector('.proj__about').getBoundingClientRect();
          const buttons = li.querySelector('.proj__buttons').getBoundingClientRect();
          return buttons.top >= about.bottom - 1;
        }));
        assert.equal(stacked, true, 'on a phone the buttons go under the two lines');
        // ... in one wrapping row, not three stacked full-width buttons
        const rowsOfButtons = await p.$$eval('#projects .proj__row[data-open="false"]', (all) => all.map((li) => {
          const wide = li.getBoundingClientRect().width;
          return Array.from(li.querySelectorAll('button')).map((b) => ({ top: Math.round(b.getBoundingClientRect().top), share: b.getBoundingClientRect().width / wide }));
        }));
        for (const each of rowsOfButtons) {
          assert.equal(each.length, 3);
          assert.ok(each.every((b) => Math.abs(b.top - each[0].top) <= 1), 'Open, Rename… and Delete… share one line: ' + JSON.stringify(each));
          assert.ok(each.every((b) => b.share < 0.5), 'none is full width: ' + JSON.stringify(each));
        }
      }
    } finally {
      session = real;
    }
  });
}

// ---------------------------------------------------------------- the one-project form and the label

test('the one-project form: a line, the Label field and two buttons; no chip, no label in the title', async () => {
  await freshDevice(page);
  assert.equal(await page.$eval('#projects [data-line="lead"]', (el) => el.textContent), 'This device keeps one project: ' + await page.evaluate(() => {
    const el = document.querySelector('#projects [data-line="lead"]');
    return el.textContent.replace('This device keeps one project: ', '').replace(/\.$/, '');
  }) + '.');
  assert.equal(await page.$eval('#projects .proj__list', (el) => el.hidden), true, 'no list with one project');
  const buttons = await page.$$eval('#projects .card__buttons button', (all) => all.map((b) => b.textContent));
  assert.deepEqual(buttons, ['Start another project…', 'Duplicate this project']);
  assert.equal(await page.$eval('#projects', (el) => el.querySelector('.card__small:last-of-type').textContent), 'Clear… replaces the open project; these keep it.');
  assert.equal(await page.$eval('#projects label', (el) => el.textContent), 'Label (optional)');
  assert.equal(await page.$eval('#projects .card__title', (el) => el.textContent), 'Projects on this device');
  assert.equal(await page.evaluate(() => document.querySelector('#projects').nextElementSibling.querySelector('.card__title').textContent), 'Saved on this device', 'the card is first, above Saved on this device');
  await typeLabel(page, 'This year');
  assert.equal(await page.$eval('#school-name', (el) => el.textContent.includes('This year')), false, 'with one project the chip stays the school name');
  assert.equal(await page.evaluate(() => document.title.startsWith('This year')), false, 'and the title has no label');
  await typeLabel(page, '');
  assert.equal((await stateOf(page)).label, null, 'a blank label takes it away');
});

test('the label: at most 60 characters, the count from 50 and announced at 50, 55 and 60 only; a name is shown as typed', async () => {
  await freshDevice(page);
  const field = '#projects input.field__input';
  const live = () => page.$eval('#projects [data-line="label-count-live"]', (el) => el.textContent);
  const shown = () => page.$eval('#projects [data-line="label-count"]', (el) => (el.hidden ? '' : el.textContent));
  await page.focus(field);
  await page.keyboard.type('a'.repeat(49));
  assert.equal(await shown(), '', 'no count under 50');
  await page.keyboard.type('a');
  assert.equal(await shown(), '50 of 60 characters');
  assert.equal(await live(), '50 of 60 characters', 'announced at 50');
  await page.keyboard.type('a');
  assert.equal(await live(), '50 of 60 characters', 'not announced at 51');
  assert.equal(await shown(), '51 of 60 characters', 'but shown');
  await page.keyboard.type('aaaa');
  assert.equal(await live(), '55 of 60 characters');
  await page.keyboard.type('aaaaa');
  assert.equal(await live(), '60 of 60 characters');
  await page.keyboard.type('a');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#projects .field__refusal').hidden, { timeout: 15000 });
  assert.match(await page.$eval('#projects .field__refusal', (el) => el.textContent), /at most 60 characters/);
  assert.equal((await stateOf(page)).label, null, 'a label over 60 is refused and nothing changes');
  await typeLabel(page, HOSTILE);
  assert.equal((await stateOf(page)).label, HOSTILE, 'kept as typed');
  assert.equal(await page.$eval('#projects input.field__input', (el) => el.value), HOSTILE);
  assert.equal(await page.$$eval('#projects img, #school-name img', (all) => all.length), 0, 'never interpreted as markup');
  await typeLabel(page, '');
});

// ---------------------------------------------------------------- the limit

test('the limit: said from 15 projects, and at 20 the two buttons are aria-disabled with the reason, still focusable', async () => {
  await freshDevice(page);
  const base = await idbRead(page, 'get', 'current');
  const shelve = async (n) => {
    for (let i = 0; i < n; i += 1) {
      const id = 'pextra' + String(i).padStart(3, '0');
      await idbPut(page, 'shelf:' + id, { ...base, project: { ...base.project, id, label: 'Kept ' + i }, shelvedAt: new Date(2026, 0, 1, 12, i).toISOString(), bytes: 1000 });
    }
  };
  await shelve(13); // 14 in all
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 14);
  assert.equal(await page.$eval('#projects [data-line="limit"]', (el) => el.hidden), true, 'not said at 14');
  await shelve(14); // 15 in all
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 15);
  assert.equal(await page.$eval('#projects [data-line="limit"]', (el) => el.textContent), 'Up to 20 projects can be kept on this device; you have 15.');
  assert.equal(await page.$eval('#projects [data-action="start-another"]', (el) => el.getAttribute('aria-disabled')), null, 'still usable at 15');
  await shelve(19); // 20 in all
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 20);
  assert.equal(await page.$eval('#projects [data-line="limit"]', (el) => el.textContent), 'Up to 20 projects can be kept on this device; you have 20.');
  for (const action of ['start-another', 'duplicate']) {
    const seen = await page.$eval('#projects [data-action="' + action + '"]', (el) => ({ disabled: el.getAttribute('aria-disabled'), why: document.getElementById(el.getAttribute('aria-describedby')).textContent, native: el.disabled }));
    assert.deepEqual(seen, { disabled: 'true', why: 'Up to 20 projects can be kept on this device; you have 20.', native: false }, action + ' says why and stays focusable');
  }
  await page.focus('#projects [data-action="start-another"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'start-another', 'it can be focused');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('dialog[open]') === null), true, 'and pressing it opens nothing');
  // a long list of labels shown as typed, and the open row's reason
  assert.equal(await page.$eval('#projects .proj__row[data-open="true"] .proj__reason', (el) => el.textContent), 'To delete this one, open another first.');
  assert.equal(await page.$eval('#projects .proj__row[data-open="true"] [data-action="delete"]', (el) => el.getAttribute('aria-disabled')), 'true');
});

// ---------------------------------------------------------------- a read-only tab

test('a read-only tab: the buttons are aria-disabled with the one sentence, focusable, and the label field is read-only', async () => {
  await freshDevice(page);
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await loaded(page);
  await listed(page, 2);
  await waitSaved(page);
  const other = await openPlanner({ server: session.server, browser: session.browser, hash: '#project', keep: true });
  extra.push(other);
  const p = other.page;
  assert.equal((await stateOf(p)).readOnly, true);
  await listed(p, 2);
  const sentence = 'This tab is read-only while the project is open in another tab, so it cannot open, start, duplicate or delete projects.';
  assert.equal(await p.$eval('#projects [data-line="read-only"]', (el) => el.hidden ? null : el.textContent), sentence);
  const all = await p.$$eval('#projects [data-action]', (els) => els.map((el) => [el.dataset.action, el.getAttribute('aria-disabled'), document.getElementById(el.getAttribute('aria-describedby').split(' ').at(-1))?.textContent.slice(0, 20) ?? null, el.disabled]));
  assert.ok(all.length >= 5, 'start, duplicate and the row buttons: ' + JSON.stringify(all));
  for (const [action, disabled, why, native] of all) {
    assert.equal(disabled, 'true', action + ' is aria-disabled');
    assert.ok(why, action + ' names its reason: ' + JSON.stringify(all));
    assert.equal(native, false, action + ' stays focusable');
  }
  assert.equal(await p.$eval('#projects input.field__input', (el) => el.readOnly), true);
  await p.focus('#projects [data-action="open"]');
  await p.keyboard.press('Enter');
  assert.equal((await stateOf(p)).readOnly, true, 'pressing Open did nothing');
  assert.equal(await p.evaluate(() => document.querySelector('#projects').getAttribute('aria-busy')), null);
  await other.close();
  extra.pop();
});

// ---------------------------------------------------------------- a row that cannot be read

test('a row that cannot be read offers Export it as it is and Delete…, never Open; Delete asks, and exports first', async () => {
  await freshDevice(page);
  const base = await idbRead(page, 'get', 'current');
  await idbPut(page, 'shelf:pbroken001', { savedAt: base.savedAt, shelvedAt: new Date(2026, 0, 1).toISOString(), bytes: 10, project: 'not a project', images: {} });
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 2);
  const broken = (await rowsOf(page)).find((row) => row.id === 'pbroken001');
  assert.deepEqual(broken.buttons, ['Export it as it is', 'Delete…']);
  assert.match(await page.$eval('.proj__row[data-project-id="pbroken001"] .proj__about', (el) => el.textContent), /cannot be read/);
  await page.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      globalThis.sv2test.downloads.push(this.download);
      return undefined;
    };
  });
  await press(page, 'pointer', '.proj__row[data-project-id="pbroken001"]', 'Delete…');
  await dialogOpen(page);
  const labels = await page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((b) => b.textContent));
  assert.deepEqual(labels, ['Export it as it is', 'Delete', 'Cancel']);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Export it as it is');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [role="status"]:not([hidden])') !== null, { timeout: 15000 });
  assert.equal((await page.evaluate(() => globalThis.sv2test.downloads)).length, 1, 'the record was written to a file: ' + await page.$eval('dialog.dialog[open] [role="status"]', (el) => el.textContent));
  assert.equal(await page.evaluate(() => document.querySelector('dialog.dialog[open]') !== null), true, 'the question stays open after Export');
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(page);
  await listed(page, 1);
  assert.deepEqual((await idbRead(page, 'keys')).filter((key) => key.startsWith('shelf:')), []);
});

// ---------------------------------------------------------------- Export it first (when storage offers it)

test('Delete… of a project that reads fine offers Export it first when storage can export it', async () => {
  await freshDevice(page);
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await loaded(page);
  await listed(page, 2);
  const offered = await page.evaluate(() => typeof globalThis.sv2.storage.projects.exportShelved === 'function');
  await press(page, 'pointer', '#projects .proj__row[data-open="false"]', 'Delete…');
  await dialogOpen(page);
  const labels = await page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((b) => b.textContent));
  assert.equal(offered, true, 'storage exports a kept project (projects.exportShelved)');
  assert.deepEqual(labels, ['Export it first', 'Delete', 'Cancel']);
  await page.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      globalThis.sv2test.downloads.push(this.download);
      return undefined;
    };
  });
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Export it first');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [role="status"]:not([hidden])') !== null, { timeout: 15000 });
  assert.equal((await page.evaluate(() => globalThis.sv2test.downloads)).length, 1, 'the project was written to a file');
  assert.match(await page.$eval('dialog.dialog[open] [role="status"]', (el) => el.textContent), /^Exported\./);
  assert.equal(await page.evaluate(() => document.querySelector('dialog.dialog[open]') !== null), true, 'the question stays open after Export');
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Cancel');
  await dialogShut(page);
});

// ---------------------------------------------------------------- Start another: the one-per-id choices

// A project file as readProjectFile reads it, handed to the dialog's file input.
async function chooseFile(p, projectIdWanted, school) {
  await p.evaluate(async (wanted, name) => {
    const { writeProjectFile } = await import(new URL('engine/project-file.js', document.baseURI).href);
    const { store } = globalThis.sv2;
    const project = { ...JSON.parse(JSON.stringify(store.project)), id: wanted };
    project.settings.schoolName = name;
    delete project.label;
    const text = writeProjectFile(project, { images: {} });
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'next-year.json', { type: 'application/json' }));
    const input = document.querySelector('dialog.dialog[open] input[type="file"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, projectIdWanted, school);
}

test('Start another project, the sample: kept already, it says so with Open and Keep it as another project', async () => {
  await freshDevice(page);
  const sampleId = (await stateOf(page)).id;
  assert.equal(sampleId, 'psample001');
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await loaded(page);
  await listed(page, 2);
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="sample"]');
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Start');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  const said = await page.$eval('dialog.dialog[open] [data-line="held"]', (el) => el.textContent);
  assert.match(said, /^The sample school is already kept on this device as /);
  const ways = await page.$$eval('dialog.dialog[open] [data-line="held"] button', (all) => all.map((b) => b.textContent.replace(/^Open .*/, 'Open <label>')));
  assert.deepEqual(ways, ['Open <label>', 'Keep it as another project']);
  assert.equal((await stateOf(page)).id === sampleId, false, 'nothing moved');
  await marker(page);
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Keep it as another project');
  await loaded(page);
  await listed(page, 3);
  const state = await stateOf(page);
  assert.notEqual(state.id, sampleId, 'a separate copy with its own identity, opened');
  assert.match(state.label, / \(another copy\)$/);
});

test('Start another project, a project file: the file\'s name and summary show first; one that is the open project offers Replace the open project and Keep it as another project', async () => {
  await freshDevice(page);
  const open = (await stateOf(page)).id;
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="file"]');
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.textContent), 'Start', 'choosing the file only selects the radio');
  await chooseFile(page, open, 'Replaced School');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="file-summary"]:not([hidden])') !== null, { timeout: 15000 });
  const summary = await page.$eval('dialog.dialog[open] [data-line="file-summary"]', (el) => el.textContent);
  assert.match(summary, /next-year\.json” is Replaced School\. It holds /);
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.textContent), 'Open it as another project');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  assert.match(await page.$eval('dialog.dialog[open] [data-line="held"]', (el) => el.textContent), /^This file is a copy of .+, the project that is open now\./);
  const ways = await page.$$eval('dialog.dialog[open] [data-line="held"] button', (all) => all.map((b) => b.textContent));
  assert.deepEqual(ways, ['Replace the open project', 'Keep it as another project']);
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.getAttribute('aria-disabled')), 'true', 'Start waits for a choice');
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  await dialogShut(page);
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.schoolName === 'Replaced School', { timeout: 15000 });
  assert.equal((await stateOf(page)).id, open, 'the open project took its place');
  assert.match(await toastText(page), /Imported the project file next-year\.json\. Undo brings back/);
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.notEqual((await stateOf(page)).school, 'Replaced School', 'one undo step brings the project back');
});

test('Start another project, a project file that is kept: Open <label> forgets the file, Keep it as another project opens a copy', async () => {
  await freshDevice(page);
  const first = (await stateOf(page)).id;
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty', undefined, { label: 'Elsewhere' }));
  await loaded(page);
  await listed(page, 2);
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="file"]');
  await chooseFile(page, first, 'Kept School');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  const held = await page.$eval('dialog.dialog[open] [data-line="held"]', (el) => el.textContent);
  assert.match(held, /^This file is a copy of .+, which is also kept on this device\./);
  assert.match(held, /forgets this file: after it opens, choose the file again\./);
  const ways = await page.$$eval('dialog.dialog[open] [data-line="held"] button', (all) => all.map((b) => b.textContent.replace(/^Open .*/, 'Open <label>')));
  assert.deepEqual(ways, ['Open <label>', 'Keep it as another project']);
  await marker(page);
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Keep it as another project');
  await loaded(page);
  await listed(page, 3);
  const state = await stateOf(page);
  assert.notEqual(state.id, first);
  assert.match(state.label, / \(another copy\)$/);
  assert.equal(state.school, 'Kept School');
});

test('the sample school\'s Load, with the sample already kept: it asks, Open <label> or Keep it as another project, and Cancel changes nothing', async () => {
  await freshDevice(page);
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await loaded(page);
  await listed(page, 2);
  const here = (await stateOf(page)).id;
  await page.click('#sample-school [data-action="sample"]');
  await dialogOpen(page);
  const title = await page.$eval('dialog.dialog[open] .dialog__title', (el) => el.textContent);
  assert.equal(title, 'The sample school is already kept on this device');
  const labels = await page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((b) => b.textContent.replace(/^Open .*/, 'Open <label>')));
  assert.deepEqual(labels, ['Open <label>', 'Keep it as another project', 'Cancel']);
  assert.equal((await focusedIs(page)).text, 'Cancel');
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Cancel');
  await dialogShut(page);
  assert.equal((await stateOf(page)).id, here, 'nothing changed');
  await page.click('#sample-school [data-action="sample"]');
  await dialogOpen(page);
  await marker(page);
  await page.evaluate(() => Array.from(document.querySelectorAll('dialog.dialog[open] .dialog__buttons button')).find((b) => b.textContent.startsWith('Open ')).setAttribute('data-hit', '1'));
  await page.click('[data-hit="1"]');
  await loaded(page);
  assert.equal((await stateOf(page)).id, 'psample001', 'the kept sample school is opened');
});

// ================================================================ SV2-117b: the review's faults, one case each

const twoProjects = async (p) => {
  await freshDevice(p);
  await p.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await loaded(p);
  await withActions(p);
  await listed(p, 2);
  await waitSaved(p);
};
// a paste: the text goes in at the caret in one input event
const insertText = (p, text) => p.evaluate((typed) => {
  const el = document.activeElement;
  el.setRangeText(typed, el.selectionStart, el.selectionEnd, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const otherRow = async (p) => (await rowsOf(p)).find((row) => !row.open);

// Replace a storage call with one that waits for `release(value)`; the page counts the calls.
const hang = (p, owner, name) => p.evaluate((who, what) => {
  const target = who === 'storage' ? globalThis.sv2.storage : globalThis.sv2.storage.projects;
  globalThis.__calls = 0;
  target[what] = () => {
    globalThis.__calls += 1;
    return new Promise((resolve) => {
      globalThis.__release = resolve;
    });
  };
}, owner, name);
const release = (p, value) => p.evaluate((answer) => globalThis.__release(answer), value);
const noteKept = (p) => p.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('sv2:opening-note')));
const dialogState = (p) => p.evaluate(() => {
  const d = document.querySelector('dialog.dialog[open]');
  return d ? { busy: d.getAttribute('aria-busy'), refusal: d.querySelector('.proj__dialog-refusal:not([hidden])')?.textContent ?? null } : null;
});
const installDownloads = (p) => p.evaluate(() => {
  globalThis.sv2test = { downloads: [] };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function clicked() {
    if (!this.hasAttribute('download')) return click.call(this);
    globalThis.sv2test.downloads.push(this.download);
    return undefined;
  };
});

test('item 1: Open says Opening…, aria-disabled and aria-busy and keeps the focus through a redraw; a refusal restores the button and the focus', async () => {
  await twoProjects(page);
  const id = (await otherRow(page)).id;
  await hang(page, 'projects', 'open');
  await pressRow(page, 'pointer', id, 'open');
  await page.waitForFunction(() => globalThis.__calls === 1);
  // the list is drawn again while it works (as the 'switching' event does): a label change in the open project redraws it
  await page.evaluate(() => {
    document.querySelector('#projects .proj__row[data-open="false"] .proj__label').textContent = 'stale';
  });
  await page.evaluate(() => globalThis.sv2.ctx.store.apply(globalThis.sv2Actions.setProjectLabel, { label: 'Redrawn' }));
  await page.waitForFunction(() => !document.querySelector('#projects').hasAttribute('data-pending')
    && document.querySelector('#projects .proj__row[data-open="false"] .proj__label').textContent !== 'stale', { timeout: 15000 });
  const seen = await page.evaluate((rowId) => {
    const b = document.querySelector('#projects .proj__row[data-project-id="' + rowId + '"] [data-action="open"]');
    return { text: b.textContent, disabled: b.getAttribute('aria-disabled'), busy: b.getAttribute('aria-busy'), card: document.getElementById('projects').getAttribute('aria-busy'), focused: document.activeElement === b };
  }, id);
  assert.deepEqual(seen, { text: 'Opening…', disabled: 'true', busy: 'true', card: 'true', focused: true }, 'the redraw kept the busy button and its focus');
  await release(page, { ok: false, code: 'failed', text: 'It was not opened.' });
  await page.waitForFunction((rowId) => document.querySelector('#projects .proj__row[data-project-id="' + rowId + '"] [data-action="open"]').textContent === 'Open', { timeout: 15000 }, id);
  const after = await page.evaluate((rowId) => {
    const b = document.querySelector('#projects .proj__row[data-project-id="' + rowId + '"] [data-action="open"]');
    return { disabled: b.getAttribute('aria-disabled'), busy: b.getAttribute('aria-busy'), card: document.getElementById('projects').getAttribute('aria-busy'), focused: document.activeElement === b, said: document.querySelector('#projects [data-line="result"]').textContent };
  }, id);
  assert.deepEqual(after, { disabled: null, busy: null, card: null, focused: true, said: 'It was not opened.' }, 'restored, focused and said');
  assert.equal(await noteKept(page), null, 'the sentence for the next page is forgotten');
});

test('item 11: every redraw keeps a focus that was inside the list, by row and button', async () => {
  await twoProjects(page);
  const id = (await otherRow(page)).id;
  await page.focus('#projects .proj__row[data-project-id="' + id + '"] [data-action="rename"]');
  await page.evaluate(() => {
    globalThis.__old = document.activeElement;
  });
  await page.evaluate(() => globalThis.sv2.ctx.store.apply(globalThis.sv2Actions.setProjectLabel, { label: 'Another label' }));
  await page.waitForFunction(() => document.querySelector('#projects [data-line="lead"]').textContent.includes('Another label'));
  await listed(page, 2);
  const kept = await page.evaluate(() => ({
    same: document.activeElement === globalThis.__old,
    id: document.activeElement.closest('[data-project-id]')?.dataset.projectId,
    action: document.activeElement.dataset.action,
  }));
  assert.equal(kept.same, false, 'the row was drawn again');
  assert.deepEqual({ id: kept.id, action: kept.action }, { id, action: 'rename' }, 'and the focus is on the same row\'s Rename…');
});

test('item 2, 7: a gated row button keeps its label line and adds the reason; a read-only tab still exports a row that cannot be read; the names return when it is cleared', async () => {
  await twoProjects(page);
  const base = await idbRead(page, 'get', 'current');
  await idbPut(page, 'shelf:pbroken002', { savedAt: base.savedAt, shelvedAt: new Date(2026, 0, 1).toISOString(), bytes: 10, project: 'not a project', images: {} });
  const other = await openPlanner({ server: session.server, browser: session.browser, hash: '#project', keep: true });
  extra.push(other);
  try {
    const p = other.page;
    assert.equal((await stateOf(p)).readOnly, true);
    await listed(p, 3);
    await installDownloads(p);
    const described = () => p.$$eval('#projects .proj__row button', (all) => all.map((b) => {
      const ids = b.getAttribute('aria-describedby').split(' ');
      return {
        action: b.dataset.action,
        disabled: b.getAttribute('aria-disabled'),
        ids: ids.length,
        nameOk: document.getElementById(ids[0]).classList.contains('proj__name'),
        reason: ids[1] ? document.getElementById(ids[1]).textContent.slice(0, 18) : null,
      };
    }));
    const locked = await described();
    for (const b of locked) {
      assert.equal(b.nameOk, true, b.action + ' still names its row first');
      if (b.action === 'export-raw') {
        assert.deepEqual({ disabled: b.disabled, ids: b.ids }, { disabled: null, ids: 1 }, 'Export it as it is stays available, with its label line only');
      } else {
        assert.equal(b.disabled, 'true', b.action + ' is gated');
        assert.ok(b.reason && (b.reason.startsWith('This tab is read-') || b.reason.startsWith('To delete this')), b.action + ' adds its reason after the label line: ' + b.reason);
      }
    }
    assert.ok(locked.some((b) => b.action === 'export-raw'), 'the unreadable row has Export it as it is');
    await press(p, 'pointer', '.proj__row[data-project-id="pbroken002"]', 'Export it as it is');
    await p.waitForFunction(() => globalThis.sv2test.downloads.length === 1, { timeout: 15000 });
    // the reason goes when it no longer holds: this tab becomes the editor when the other lets go of the lock
    await page.goto('about:blank');
    await p.waitForFunction(() => globalThis.sv2.storage.state.readOnly === false, { timeout: 30000 });
    await p.waitForFunction(() => document.querySelector('#projects .proj__row[data-open="false"] [aria-disabled]') === null, { timeout: 15000 });
    const freed = await described();
    for (const b of freed.filter((each) => each.reason === null)) {
      assert.deepEqual({ disabled: b.disabled, ids: b.ids, nameOk: b.nameOk }, { disabled: null, ids: 1, nameOk: true }, b.action + ' is back to its label line only');
    }
    assert.ok(freed.filter((b) => b.reason === null).length >= 5, 'the shelved rows\' buttons are all back: ' + JSON.stringify(freed));
  } finally {
    await other.close().catch(() => {});
    extra.pop();
  }
});

test('item 3: the sample school\'s Load with the sample kept says what its buttons do, tells a refusal, writes the opening sentence first and shows it is working', async () => {
  await twoProjects(page);
  await hang(page, 'projects', 'startAnother');
  await page.click('#sample-school [data-action="sample"]');
  await dialogOpen(page);
  const said = await page.$eval('dialog.dialog[open] [role="alert"]', (el) => el.textContent);
  assert.match(said, /You can open that one, or make another copy of the sample school and open the copy\.$/);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Keep it as another project');
  await page.waitForFunction(() => globalThis.__calls === 1);
  const working = await page.$eval('#sample-school [data-action="sample"]', (el) => ({ disabled: el.getAttribute('aria-disabled'), busy: el.getAttribute('aria-busy') }));
  assert.deepEqual(working, { disabled: 'true', busy: 'true' }, 'the button says it is working');
  assert.equal((await noteKept(page)).kind, 'start', 'the page that follows is told first');
  await release(page, { ok: false, code: 'limit', text: 'Up to 20 projects can be kept on this device.' });
  await page.waitForFunction(() => document.querySelector('.toast__text')?.textContent.includes('Up to 20 projects'), { timeout: 15000 });
  assert.equal(await toastText(page), 'Up to 20 projects can be kept on this device.', 'the refusal is said');
  assert.deepEqual(await page.$eval('#sample-school [data-action="sample"]', (el) => ({ disabled: el.getAttribute('aria-disabled'), busy: el.getAttribute('aria-busy') })), { disabled: null, busy: null }, 'and the button is back');
  assert.equal(await noteKept(page), null, 'the sentence is forgotten');
  // the way "Open" goes
  await hang(page, 'projects', 'open');
  await page.click('#sample-school [data-action="sample"]');
  await dialogOpen(page);
  await page.evaluate(() => Array.from(document.querySelectorAll('dialog.dialog[open] .dialog__buttons button')).find((b) => b.textContent.startsWith('Open ')).setAttribute('data-hit', '1'));
  await page.click('[data-hit="1"]');
  await page.waitForFunction(() => globalThis.__calls === 1);
  assert.equal((await noteKept(page)).kind, 'open');
  await release(page, { ok: false, code: 'failed', text: 'It was not opened.' });
  await page.waitForFunction(() => document.querySelector('.toast__text')?.textContent === 'It was not opened.', { timeout: 15000 });
});

test('item 4: Start another, Duplicate and Replace cannot be cancelled while they work; a late refusal is written into the dialog that is still there', async () => {
  await twoProjects(page);
  const inert = async () => {
    await page.keyboard.press('Escape');
    await page.click('dialog.dialog[open] .dialog__buttons button:last-child');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.dialog[open]') !== null), true, 'Escape and Cancel did nothing');
    assert.equal((await dialogState(page)).busy, 'true', 'the dialog says it is busy');
  };
  // Duplicate
  await hang(page, 'projects', 'duplicate');
  await press(page, 'pointer', '#projects .card__buttons', 'Duplicate this project');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Duplicate and open it');
  await page.waitForFunction(() => globalThis.__calls === 1);
  await inert();
  await release(page, { ok: false, code: 'failed', text: 'The copy was not made.' });
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] .proj__dialog-refusal:not([hidden])')?.textContent === 'The copy was not made.', { timeout: 15000 });
  assert.equal((await dialogState(page)).busy, null);
  await page.keyboard.press('Escape');
  await dialogShut(page);
  // Start another
  await hang(page, 'projects', 'startAnother');
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Start');
  await page.waitForFunction(() => globalThis.__calls === 1);
  await inert();
  await release(page, { ok: false, code: 'failed', text: 'Nothing was started.' });
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] .proj__dialog-refusal:not([hidden])')?.textContent === 'Nothing was started.', { timeout: 15000 });
  assert.equal((await dialogState(page)).busy, null);
  await page.keyboard.press('Escape');
  await dialogShut(page);
  // Replace the open project (a file that is the open one)
  const open = (await stateOf(page)).id;
  await hang(page, 'storage', 'takeRecoveryPoint');
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="file"]');
  await chooseFile(page, open, 'Late School');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  await page.waitForFunction(() => globalThis.__calls === 1, { timeout: 15000 });
  await inert();
  await release(page, null);
  await dialogShut(page);
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.schoolName === 'Late School', { timeout: 15000 });
});

test('item 5: Replace the open project is refused up front in a read-only tab and while a switch is under way, and says so before it goes ahead without a snapshot', async () => {
  await freshDevice(page);
  const open = (await stateOf(page)).id;
  const before = (await stateOf(page)).school;
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="file"]');
  await chooseFile(page, open, 'Refused School');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  await page.evaluate(() => {
    globalThis.__kept = globalThis.sv2.store.project;
    globalThis.sv2.storage.state.readOnly = true;
  });
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  assert.match((await dialogState(page)).refusal, /^This tab is read-only while the project is open in another tab, so it cannot replace the open project\.$/);
  await page.evaluate(() => {
    globalThis.sv2.storage.state.readOnly = false;
    globalThis.sv2.storage.state.switching = true;
  });
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  assert.match((await dialogState(page)).refusal, /already being opened/);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project === globalThis.__kept), true, 'nothing was replaced');
  await page.evaluate(() => {
    globalThis.sv2.storage.state.switching = false;
  });
  // no snapshot can be taken: the question says so, Cancel changes nothing, Replace anyway goes on with a recovery point first
  await page.evaluate(async () => {
    const { pageSnapshots } = await import(new URL('storage/snapshots.js', document.baseURI).href);
    pageSnapshots().room = async () => ({ full: true, limit: 30 });
  });
  const pointsBefore = (await page.evaluate(() => globalThis.sv2.storage.listRecoveryPoints())).length;
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  await page.waitForFunction(() => document.querySelectorAll('dialog.dialog[open]').length === 2, { timeout: 15000 });
  const asked = await page.evaluate(() => Array.from(document.querySelectorAll('dialog.dialog[open]')).at(-1).textContent);
  assert.match(asked, /No snapshot can be taken: this device already keeps 30 snapshots/);
  assert.match(asked, /A recovery point of this project is taken first/);
  await page.evaluate(() => Array.from(document.querySelectorAll('dialog.dialog[open]')).at(-1).querySelector('.dialog__buttons button:last-child').click());
  await page.waitForFunction(() => document.querySelectorAll('dialog.dialog[open]').length === 1);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project === globalThis.__kept), true, 'Cancel replaced nothing');
  await press(page, 'pointer', 'dialog.dialog[open] [data-line="held"]', 'Replace the open project');
  await page.waitForFunction(() => document.querySelectorAll('dialog.dialog[open]').length === 2, { timeout: 15000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('dialog.dialog[open]')).at(-1).querySelector('.dialog__buttons button:first-child').click());
  await dialogShut(page);
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.schoolName === 'Refused School', { timeout: 15000 });
  const said = await toastText(page);
  assert.match(said, /^Imported the project file next-year\.json\. Undo brings back the project that was here\. No snapshot was taken: this device keeps the most snapshots it can; a recovery point of it was\.$/);
  const points = await page.evaluate(() => globalThis.sv2.storage.listRecoveryPoints());
  assert.ok(points.length > pointsBefore && points.some((point) => point.reason === 'import'), 'the recovery point the toast names was taken');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.equal((await stateOf(page)).school, before, 'Undo brings the project back');
});

test('Start another refused with limit at 20: the sentence is in the dialog, nothing moves, the dialog can be closed', async () => {
  await freshDevice(page);
  const base = await idbRead(page, 'get', 'current');
  const shelve = async (i) => {
    const id = 'pextra' + String(i).padStart(3, '0');
    await idbPut(page, 'shelf:' + id, { ...base, project: { ...base.project, id, label: 'Kept ' + i }, shelvedAt: new Date(2026, 0, 1, 12, i).toISOString(), bytes: 1000 });
  };
  for (let i = 0; i < 18; i += 1) await shelve(i); // 19 in all
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 19);
  const here = (await stateOf(page)).id;
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await shelve(18); // another tab's: 20 now
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Start');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] .proj__dialog-refusal:not([hidden])') !== null, { timeout: 15000 });
  const state = await dialogState(page);
  assert.match(state.refusal, /20/, 'the refusal names the limit: ' + state.refusal);
  assert.equal(state.busy, null);
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.getAttribute('aria-disabled')), null, 'Start is usable again');
  assert.equal((await stateOf(page)).id, here, 'nothing moved');
  await page.keyboard.press('Escape');
  await dialogShut(page);
});

test('Rename refused as too long: the sentence is in the dialog, the focus is in the field, the label is unchanged', async () => {
  await twoProjects(page);
  const row = await otherRow(page);
  await pressRow(page, 'pointer', row.id, 'rename');
  await dialogOpen(page);
  await page.evaluate(() => document.querySelector('dialog.dialog[open] input').select());
  await page.keyboard.type('b'.repeat(61));
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Rename');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] .proj__dialog-refusal:not([hidden])') !== null, { timeout: 15000 });
  assert.equal((await dialogState(page)).refusal, 'A label is at most 60 characters.');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('dialog.dialog[open] input')), true, 'the focus is in the field');
  assert.equal((await dialogState(page)).busy, null);
  await page.keyboard.press('Escape');
  await dialogShut(page);
  assert.equal((await otherRow(page)).name, row.name, 'the label did not change');
});

test('Delete refused with needs exported: the card says so, the row stays; Export it as it is, then Delete goes through; the last kept row gone, the focus is the heading', async () => {
  await freshDevice(page);
  const base = await idbRead(page, 'get', 'current');
  await idbPut(page, 'shelf:pbroken003', { savedAt: base.savedAt, shelvedAt: new Date(2026, 0, 1).toISOString(), bytes: 10, project: null, images: {} });
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 2);
  await installDownloads(page);
  await press(page, 'pointer', '.proj__row[data-project-id="pbroken003"]', 'Delete…');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(page);
  await page.waitForFunction(() => document.querySelector('#projects [data-line="result"]:not([hidden])') !== null, { timeout: 15000 });
  assert.match(await page.$eval('#projects [data-line="result"]', (el) => el.dataset.result + ': ' + el.textContent), /^refused: That project is too damaged to keep a recovery point of, so it was not deleted\./, 'the card says it was refused');
  assert.equal((await rowsOf(page)).length, 2, 'the row stays');
  assert.equal(await page.evaluate(() => document.querySelector('#projects').getAttribute('aria-busy')), null, 'and the card is not left busy');
  await press(page, 'pointer', '.proj__row[data-project-id="pbroken003"]', 'Delete…');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Export it as it is');
  await page.waitForFunction(() => globalThis.sv2test.downloads.length === 1, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [role="status"]:not([hidden])') !== null);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(page);
  await listed(page, 1);
  assert.deepEqual((await idbRead(page, 'keys')).filter((key) => key.startsWith('shelf:')), [], 'deleted with exported: true');
  assert.match(await toastText(page), /^Deleted .+ from this device\. No recovery point could be kept of it\.$/);
  assert.equal((await focusedIs(page)).inHeading, true, 'with no kept row left, the focus is the card\'s heading: ' + JSON.stringify(await focusedIs(page)));
});

test('the chip and the title go from two projects back to one, and the focus goes to the heading when the last kept row is deleted', async () => {
  await twoProjects(page);
  await typeLabel(page, 'Second');
  assert.equal(await page.$eval('#school-name', (el) => el.textContent.includes('· Second')), true, 'two projects: the chip carries the label');
  assert.equal(await page.evaluate(() => document.title.startsWith('Second · Project')), true);
  await pressRow(page, 'pointer', (await otherRow(page)).id, 'delete');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(page);
  await listed(page, 1);
  await page.waitForFunction(() => !document.getElementById('school-name').textContent.includes('Second') && !document.title.startsWith('Second'), { timeout: 15000 });
  assert.equal(await page.$eval('#projects .proj__list', (el) => el.hidden), true, 'one project, no list');
  assert.equal((await focusedIs(page)).inHeading, true, 'the focus is the card\'s heading: ' + JSON.stringify(await focusedIs(page)));
});

test('item 6: a copy of a copy is "(copy 2)", then "(copy 3)", never "(copy) (copy)"', async () => {
  await freshDevice(page);
  const field = async () => {
    await press(page, 'pointer', '#projects .card__buttons', 'Duplicate this project');
    await dialogOpen(page);
    const value = await page.$eval('dialog.dialog[open] input', (el) => el.value);
    await page.keyboard.press('Escape');
    await dialogShut(page);
    return value;
  };
  await typeLabel(page, 'Next year');
  assert.equal(await field(), 'Next year (copy)');
  await typeLabel(page, 'Next year (copy)');
  assert.equal(await field(), 'Next year (copy 2)');
  await typeLabel(page, 'Next year (copy 2)');
  assert.equal(await field(), 'Next year (copy 3)');
  await typeLabel(page, 'Next year (copy 9)');
  assert.equal(await field(), 'Next year (copy 10)');
  await typeLabel(page, 'Plan (copy) B');
  assert.equal(await field(), 'Plan (copy) B (copy)', 'only an ending is a copy mark');
  const long = await page.evaluate(async () => {
    const { suffixedLabel } = await import(new URL('ui/project/projects.js', document.baseURI).href);
    return [suffixedLabel('x'.repeat(50) + ' (copy 12)', ' (copy)'), suffixedLabel('x'.repeat(70), ' (copy)')];
  });
  for (const each of long) assert.ok(Array.from(each).length <= 60 && /\(copy( \d+)?\)$/.test(each), each);
  assert.match(long[0], /\(copy 13\)$/);
  await typeLabel(page, '');
});

test('item 8: the label count only primes on load, announces the largest threshold crossed upward once, and says over the limit', async () => {
  await freshDevice(page);
  const live = () => page.$eval('#projects [data-line="label-count-live"]', (el) => el.textContent);
  await typeLabel(page, 'a'.repeat(55));
  await waitSaved(page); // the label is on the device before the reload, not racing its autosave
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  await listed(page, 1);
  assert.equal(await live(), '', 'a label of 55 on load is not announced');
  assert.equal(await page.$eval('#projects [data-line="label-count"]', (el) => el.hidden ? '' : el.textContent), '55 of 60 characters', 'but the count shows');
  await page.focus('#projects input.field__input');
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace'); // 49
  assert.equal(await live(), '', 'going down says nothing');
  await insertText(page, 'a'.repeat(11)); // 49 to 60 at once: 50, 55 and 60 crossed; the largest is said
  assert.equal(await live(), '60 of 60 characters', 'the largest threshold crossed, once');
  await insertText(page, 'a');
  assert.equal(await live(), '61 of 60 characters: over the limit');
  await insertText(page, 'a');
  assert.equal(await live(), '61 of 60 characters: over the limit', 'once, not again at 62');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  assert.equal(await live(), '', 'back at 60, nothing is said');
});

test('item 9: after a reload with the route not #project, nothing in the Projects card takes the focus; a reader who moved it keeps it', async () => {
  await freshDevice(page);
  await page.evaluate(() => {
    location.hash = '#building';
  });
  await waitForSection(page, 'building');
  await marker(page);
  await page.evaluate(() => globalThis.sv2.storage.projects.startAnother('empty'));
  await page.waitForFunction(() => globalThis.__before === undefined && globalThis.sv2 !== undefined && document.documentElement.dataset.ready === 'true', { timeout: 40000 });
  await waitForSection(page, 'building');
  assert.equal(await page.evaluate(() => location.hash), '#building');
  assert.match(await page.$eval('#shell-status', (el) => el.textContent), /^Opened /, 'the page still says so');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#projects') === null), true, 'no focus in the card');
  // the reader has put the focus on a control; then comes to the Project section: the heading does not take it
  await page.focus('#school-name');
  await page.evaluate(() => {
    location.hash = '#project';
  });
  await waitForSection(page, 'project');
  await page.waitForFunction(() => document.querySelector('#projects') !== null && !document.querySelector('#projects').hasAttribute('data-pending'), { timeout: 15000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  assert.equal((await focusedIs(page)).inHeading, false, 'the heading did not take the focus: ' + JSON.stringify(await focusedIs(page)));
});

test('item 12: Restore as a project from the toast takes one press only', async () => {
  await twoProjects(page);
  const row = await otherRow(page);
  await pressRow(page, 'pointer', row.id, 'delete');
  await dialogOpen(page);
  await press(page, 'pointer', 'dialog.dialog[open] .dialog__buttons', 'Delete');
  await dialogShut(page);
  await listed(page, 1);
  await hang(page, 'projects', 'restoreAsProject');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.toast button')).find((each) => each.textContent === 'Restore as a project');
    b.click();
    b.click();
  });
  await page.waitForFunction(() => globalThis.__calls >= 1);
  assert.equal(await page.evaluate(() => globalThis.__calls), 1, 'one call for two presses');
  assert.equal(await page.$eval('#projects', (el) => el.getAttribute('aria-busy')), 'true');
  await release(page, { ok: false, code: 'failed', text: 'It was not restored.' });
  await page.waitForFunction(() => document.querySelector('.toast__text')?.textContent === 'It was not restored.', { timeout: 15000 });
  assert.equal(await page.$eval('#projects', (el) => el.getAttribute('aria-busy')), null, 'a refusal frees the card');
  assert.equal(await noteKept(page), null);
});

test('item 13 and 14: with a file picked and a held choice shown, the first held button has the focus; choosing the file again asks again', async () => {
  await twoProjects(page); // the sample school (id psample001) is kept on the shelf
  await press(page, 'pointer', '#projects .card__buttons', 'Start another project…');
  await dialogOpen(page);
  await page.click('dialog.dialog[open] input[value="file"]');
  await chooseFile(page, 'psample001', 'Kept School');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'held-open', 'the first held button has the focus, not the Start that waits');
  await page.click('dialog.dialog[open] input[value="empty"]');
  assert.equal(await page.$eval('dialog.dialog[open] [data-line="held"]', (el) => el.hidden), true, 'another choice puts the question away');
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.getAttribute('aria-disabled')), null);
  await page.click('dialog.dialog[open] input[value="file"]');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open] [data-line="held"]:not([hidden])') !== null, { timeout: 15000 });
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__buttons button', (el) => el.getAttribute('aria-disabled')), 'true', 'the holds check ran again: Start waits for a choice');
  assert.deepEqual(await page.$$eval('dialog.dialog[open] [data-line="held"] button', (all) => all.map((b) => b.dataset.action)), ['held-open', 'held-keep']);
  await page.keyboard.press('Escape');
  await dialogShut(page);
});
