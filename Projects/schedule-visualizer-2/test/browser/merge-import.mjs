// Import part of a project file, in a real browser: node test/browser/merge-import.mjs
//
// The Project file card's fourth import (spec 13.2, DESIGN 15.5 and 15.9): a
// project file is chosen, and only its building, only its schedule or only its
// settings are brought in, in a two-step dialog. Step 1 says what the file
// holds and asks which part (and what to do with groups whose names are here);
// step 2 says what would change, names the snapshot and the Duplicate-first
// way, and Bring it in is the only thing that changes the project: a snapshot,
// then one undo step, a toast and a line on the card that both carry Undo.
//
// The open project is the plain sample school; the fixture file is the full
// sample school with a different school name, settings, calendar, marks and
// duties and a longer day. Each part is brought in and undone, with the pointer
// at 1280 by 900, by the keyboard alone, and at 390 by 844 and 844 by 390 (the
// dialog inside the window, its buttons in view, no sideways scroll).
//
// Every wait is on a state the page sets: the dialog's data-step, the card's
// data-result, the snapshots written, the store's undo entry; never a first
// paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, launch, startServer } from './harness.mjs';
import { plainSchool, room } from '../engine/helpers.mjs';
import { sampleSchool } from '../../data/sample-school.js';
import { writeProjectFile, raisePeriods } from '../../engine/project-file.js';

const FILE = 'harbourview <b>annex</b>.json';
const ISOLATES = /[⁨⁩]/g;

let server;
let browser;
let session;
let page;
let fixture;

// The fixture: the full sample school, its own name, its own settings, a
// longer day; the building is the sample's with room 101 renumbered.
function fixtureText(change) {
  let project = sampleSchool();
  room(project, '101').number = '901';
  project.groups[0].headCount = 31;
  project.settings.schoolName = 'Harbourview <i>Annex</i> & "East" 学校';
  project.settings.periodWord = 'Mod';
  project.settings.defaultPassingSeconds = 300;
  project.settings.timeFormat = '24h';
  project = raisePeriods(project, 9);
  if (change) change(project);
  return writeProjectFile(project, { images: {} });
}

// What the project is, without the moment of its last change, as a short digest
// (a failed comparison prints the digests, not two whole projects).
const signature = (p) => p.evaluate(() => {
  const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
  delete project.modified;
  const text = JSON.stringify(project);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return text.length + ':' + hash.toString(16);
});
const undoLabel = (p) => p.evaluate(() => globalThis.sv2.store.undoLabel);
const open = (p) => p.$eval('dialog#merge-import[open]', (el) => el.dataset.step).catch(() => null);
const lines = (p, name) => p.$$eval('dialog#merge-import[open] [data-line="' + name + '"]', (all) => all.map((el) => el.textContent));
const summary = (p) => p.$$eval('dialog#merge-import[open] [data-line="summary"] li', (all) => all.map((el) => el.textContent));
const result = (p) => p.$eval('#project-file [data-line="result"]', (el) => (el.hidden ? null : { kind: el.dataset.result, text: el.querySelector('p').firstChild.textContent, notes: Array.from(el.querySelectorAll('li')).map((li) => li.textContent), undo: el.querySelector('[data-action="undo-part"]') !== null }));
const toastText = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((el) => el.textContent).pop() || null);
const focused = (p) => p.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, text: el.textContent.slice(0, 60), part: el.dataset.part || null, type: el.type || null } : null;
});

const stepIs = (p, step) => p.waitForFunction((wanted) => document.querySelector('dialog#merge-import[open]')?.dataset.step === wanted, { timeout: 10000 }, step);
const closed = (p) => p.waitForFunction(() => document.querySelector('dialog#merge-import[open]') === null, { timeout: 10000 });
const resulted = (p, kind) => p.waitForFunction((wanted) => document.querySelector('#project-file [data-line="result"]')?.dataset.result === wanted && !document.querySelector('#project-file [data-line="result"]').hidden, { timeout: 15000 }, kind);
// The card's line begins with these words: a wait that a line left by an earlier step cannot satisfy.
const says = (p, start) => p.waitForFunction((wanted) => {
  const el = document.querySelector('#project-file [data-line="result"]');
  return el !== null && !el.hidden && el.querySelector('p').firstChild.textContent.startsWith(wanted);
}, { timeout: 15000 }, start);
const saved = (p) => p.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });

// The snapshots of the device, oldest first, by name.
const snapshotNames = (p) => p.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('sv2');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const all = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
    all.onsuccess = () => {
      db.close();
      resolve(all.result.sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1)).map((record) => record.name));
    };
    all.onerror = () => reject(all.error);
  };
}));

// Choose a file, as the file picker would hand it over.
async function choose(p, name, body) {
  await p.evaluate((fileName, contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="part"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], fileName));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, name, body);
}

async function press(p, label) {
  await p.evaluate((wanted) => Array.from(document.querySelectorAll('dialog#merge-import[open] .dialog__buttons button')).find((button) => button.textContent === wanted).click(), label);
}

const dismissToasts = (p) => p.evaluate(() => document.querySelectorAll('.toast__close').forEach((button) => button.click()));

// No sideways scroll, the dialog inside the window, its buttons in view.
async function fits(p, what) {
  const box = await p.evaluate(() => {
    const dialog = document.querySelector('dialog#merge-import[open]');
    const d = dialog.getBoundingClientRect();
    const buttons = Array.from(dialog.querySelectorAll('.dialog__buttons button')).map((button) => button.getBoundingClientRect());
    return {
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      inside: d.left >= 0 && d.top >= 0 && d.right <= window.innerWidth + 0.5 && d.bottom <= window.innerHeight + 0.5,
      buttons: buttons.every((b) => b.bottom <= window.innerHeight + 0.5 && b.top >= 0 && b.right <= window.innerWidth + 0.5),
    };
  });
  assert.deepEqual(box, { sideways: false, inside: true, buttons: true }, what + ': no sideways scroll, the dialog inside the window, the buttons in view');
}

before(async () => {
  fixture = fixtureText();
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#project', theme: 'light', width: 1280, height: 900 });
  page = session.page;
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('the Project file card has Import part of a project file… and its line', async () => {
  assert.deepEqual(await page.$$eval('#project-file .card__buttons > .btn', (all) => all.map((el) => el.textContent)),
    ['Export the project', 'Import a project file…', 'Export the building', 'Import a building file…', 'Export the schedule', 'Import a schedule file…', 'Import part of a project file…']);
  const line = await page.$eval('#project-file [data-action="import-part"]', (el) => el.closest('.card__buttons').previousElementSibling.textContent);
  assert.equal(line, 'Bring in only the building, only the schedule or only the settings from another project file. The rest of this project stays as it is.');
  assert.equal(await result(page), null);
});

test('a file that is not a project file is refused in the reader\'s words and changes nothing', async () => {
  const before = await signature(page);
  const building = JSON.stringify({ format: 'sv2-building', version: 1 });
  await choose(page, 'building.json', building);
  await resulted(page, 'refused');
  const said = await result(page);
  assert.match(said.text, /^“building\.json” was not brought in, and nothing has changed\. /);
  assert.equal(await open(page), null);
  assert.equal(await signature(page), before);
});

test('step 1 says what the file holds, offers the three parts with their sentences, and changes nothing', async () => {
  const before = await signature(page);
  const undos = await undoLabel(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  assert.deepEqual(await lines(page, 'file'), [FILE + ': Harbourview <i>Annex</i> & "East" 学校, 3 floors, 13 rooms, 8 groups.']);
  assert.deepEqual(await page.$$eval('dialog#merge-import[open] legend', (all) => all.map((el) => el.textContent)), ['What to bring in']);
  assert.deepEqual(await page.$$eval('dialog#merge-import[open] .merge__part', (all) => all.map((el) => el.querySelector('strong').textContent + ' | ' + el.querySelector('.card__small').textContent)), [
    'Only the building | Floors, rooms, doors, stairs, exits and traced images. Your schedule stays; each class keeps its room where the new building has the same room number.',
    'Only the schedule | Subjects, teachers, groups, day types, bell schedules, the calendar, marked periods and duties. Your building stays; rooms are matched by number.',
    'Only the settings | The school\'s name, periods, the period word, times and the checks. Not the theme or paper, which belong to this device, and not publishing.',
  ]);
  assert.deepEqual(await page.$$eval('dialog#merge-import[open] .dialog__buttons button', (all) => all.map((el) => el.textContent)), ['Next', 'Cancel']);
  assert.equal(await page.$eval('dialog#merge-import[open] input[data-part="building"]', (el) => el.checked), true, 'the first part is chosen');
  // the name is data: shown as typed, never as markup
  assert.equal(await page.$eval('dialog#merge-import[open] [data-line="file"]', (el) => el.children.length), 0);
  // the schedule's question appears under it when it is chosen: the file's groups are the groups here
  assert.equal(await page.$('dialog#merge-import[open] .imp-clash'), null);
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  await page.waitForSelector('dialog#merge-import[open] .imp-clash');
  assert.match(await page.$eval('dialog#merge-import[open] .imp-clash legend', (el) => el.textContent), /^8 groups in the file have the names of groups already here\. What should happen to them\?$/);
  assert.deepEqual(await focused(page).then((f) => f.part), 'schedule', 'the chosen part keeps the focus');
  await page.click('dialog#merge-import[open] input[data-part="building"]');
  assert.equal(await page.$('dialog#merge-import[open] .imp-clash'), null);
  // Cancel: nothing changed, and the card says so
  await press(page, 'Cancel');
  await closed(page);
  assert.equal(await signature(page), before);
  assert.equal(await undoLabel(page), undos);
  assert.equal((await result(page)).text, FILE + ' was read and nothing was brought in. Nothing has changed.');
});

test('the building: step 2, Back, Bring it in is one snapshot and one undo step, Undo on the toast', async () => {
  const before = await signature(page);
  const had = (await snapshotNames(page)).length;
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.deepEqual(await focused(page), { tag: 'H2', text: 'Bring in the building?', part: null, type: null }, 'Next moves the focus to step 2\'s heading');
  assert.deepEqual(await summary(page), ['The building becomes 3 floors and 13 rooms.', '128 schedule slots keep their rooms.']);
  const [snap] = await lines(page, 'snapshot');
  assert.match(snap, /A recovery point of this project is taken first, with a snapshot of it, “Before bringing in the building”, that you can restore from Snapshots at any time\. Undo brings it all back/);
  assert.equal((await lines(page, 'duplicate'))[0].replace(ISOLATES, ''), 'To keep Marrowby Middle School (sample) as it is, close this and use Duplicate this project first.');
  assert.deepEqual(await page.$$eval('dialog#merge-import[open] .dialog__buttons button', (all) => all.map((el) => el.textContent)), ['Bring it in', 'Back', 'Cancel']);
  // nothing has changed yet
  assert.equal(await signature(page), before);
  assert.equal((await snapshotNames(page)).length, had);
  // Back to step 1, with the chosen part focused
  await press(page, 'Back');
  await stepIs(page, '1');
  assert.deepEqual((await focused(page)).part, 'building');
  await press(page, 'Next');
  await stepIs(page, '2');
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in');
  const after = await signature(page);
  assert.notEqual(after, before, 'the building came in');
  assert.equal(await undoLabel(page), 'Bring in the building from ' + FILE);
  assert.equal((await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].spaces.find((space) => space.kind === 'room' && space.number === '901') !== undefined)), true);
  assert.deepEqual((await snapshotNames(page)).slice(had), ['Before bringing in the building']);
  assert.equal(await toastText(page), 'Brought in the building from ' + FILE + '.Undo');
  const said = await result(page);
  assert.deepEqual([said.kind, said.text, said.undo], ['done', 'Brought in the building from ' + FILE + '. Undo brings it all back.', true]);
  assert.deepEqual(said.notes, ['The building becomes 3 floors and 13 rooms.', '128 schedule slots keep their rooms.']);
  // the school's name, the settings and the schedule were not touched
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.schoolName), 'Marrowby Middle School (sample)');
  // one Undo (the toast's) brings it all back
  await page.click('.toast__action');
  await page.waitForFunction((was) => globalThis.sv2.store.undoLabel !== was, { timeout: 10000 }, 'Bring in the building from ' + FILE);
  assert.equal(await signature(page), before);
  await dismissToasts(page);
});

test('the schedule: the question for groups already here, step 2, Bring it in, Undo on the card\'s line', async () => {
  const before = await signature(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  await page.waitForSelector('dialog#merge-import[open] .imp-clash');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.deepEqual(await summary(page), [
    'Groups: 8 groups left as they were, the calendar replaced.',
    'Also: 1 day type added, the day made 9 periods long, 3 marked periods added, 4 duties and meetings added and 1 staggered dismissal added.',
  ]);
  assert.equal(await signature(page), before);
  // Back keeps the question, and the answer is used
  await press(page, 'Back');
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[value="overwrite"]');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.match((await summary(page))[0], /^Groups: 1 group replaced, 7 groups left as they were/);
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in');
  assert.equal(await undoLabel(page), 'Bring in the schedule from ' + FILE);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.dayTypes.some((dayType) => dayType.name === 'Assembly Day')), true);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periods), 9, 'the day was made as long as the file\'s');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.schoolName), 'Marrowby Middle School (sample)');
  assert.ok((await snapshotNames(page)).includes('Before bringing in the schedule'));
  // the card's line carries Undo
  assert.equal((await result(page)).undo, true);
  await dismissToasts(page);
  await page.click('#project-file [data-action="undo-part"]');
  await page.waitForFunction(() => document.querySelector('#project-file [data-line="result"] p').textContent.startsWith('Undid '), { timeout: 10000 });
  assert.equal(await signature(page), before);
  assert.equal((await result(page)).text, 'Undid bringing in the schedule from “' + FILE + '”. This project is as it was.');
});

test('the settings: the taken and not-taken lists, the periods that stay, one undo step', async () => {
  const before = await signature(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="settings"]');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.deepEqual(await summary(page), ['Periods: 8 → 9', 'Period word: Period → Mod', 'Default passing time: 4 minutes → 5 minutes', 'Time format: 12-hour → 24-hour']);
  assert.deepEqual(await lines(page, 'taken'), ['Taken from the file: School name (only while this project\'s is blank), Periods (raised if the file has more, never lowered), Period word, Default passing time, Default head count, Colour scale, Checks and Time format.']);
  assert.deepEqual(await lines(page, 'not-taken'), ['Not taken: the theme and paper (this device\'s), and the cell size, walking and stair times and elevator times (they belong to the building).']);
  assert.match((await lines(page, 'snapshot'))[0], /“Before bringing in the settings”/);
  assert.equal(await signature(page), before);
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in');
  assert.equal(await undoLabel(page), 'Bring in the settings from ' + FILE);
  assert.deepEqual(await page.evaluate(() => {
    const { settings } = globalThis.sv2.store.project;
    return [settings.periods, settings.periodWord, settings.defaultPassingSeconds, settings.timeFormat, settings.theme, settings.schoolName, settings.secondsPerCell];
  }), [9, 'Mod', 300, '24h', 'auto', 'Marrowby Middle School (sample)', 3]);
  await dismissToasts(page);
  await page.click('#project-file [data-action="undo-part"]');
  await page.waitForFunction(() => document.querySelector('#project-file [data-line="result"] p').textContent.startsWith('Undid '), { timeout: 10000 });
  assert.equal(await signature(page), before);

  // a file with fewer periods than the project keeps the project's: the visible line
  await page.evaluate(async () => {
    const actions = await import(new URL('engine/actions.js', document.baseURI).href);
    globalThis.sv2.store.apply(actions.setSetting, { key: 'periods', value: 10 });
  });
  const raised = await signature(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="settings"]');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.ok((await summary(page)).includes('Periods stay at 10: the file has 9.'));
  assert.ok(!(await summary(page)).some((line) => line.startsWith('Periods: ')));
  await press(page, 'Cancel');
  await closed(page);
  assert.equal(await signature(page), raised);
});

test('a settings file that changes nothing says so and makes no undo step', async () => {
  // the open project's own settings, from a file of the plain school
  const same = writeProjectFile(plainSchool(), { images: {} });
  const before = await signature(page);
  const undos = await undoLabel(page);
  await choose(page, 'same.json', same);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="settings"]');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.deepEqual((await summary(page)).slice(0, 1), ['No setting changes: the file\'s settings match this project\'s, or are ones this project keeps.']);
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Nothing changed');
  assert.equal(await signature(page), before);
  assert.equal(await undoLabel(page), undos);
  assert.match((await result(page)).text, /^Nothing changed: the settings in “same\.json” match/);
});

test('the lines say moved, lost and the scenario figures in words', async () => {
  const said = await page.evaluate(async () => {
    const { summaryLines } = await import(new URL('ui/project/merge.js', document.baseURI).href);
    const base = { floors: 2, rooms: 9, images: 1, subjectsAdded: ['Art', 'Music'], slotsKept: 12, slotsMoved: 3, slotsLost: 2, lostRooms: ['118'], leversDropped: 1, changesUnmatched: 2 };
    return summaryLines('building', base, globalThis.sv2.store.project);
  });
  assert.deepEqual(said, [
    'The building becomes 2 floors and 9 rooms, with 1 traced image.',
    '12 schedule slots keep their rooms.',
    '3 schedule slots go to the room with the same number.',
    '1 room, 118, is not in the new building, so 2 schedule slots keep the number as text and read "not in the building".',
    '2 subjects the rooms use are added: Art and Music.',
    '1 scenario lever left out, because the new building has no such corridor, stairs or room.',
    '2 scenario changes name rooms the new building does not have; they stay and show as no longer applying.',
  ]);
});

test('by the keyboard alone: the part chosen with the arrows, Next, Escape, and Undo on the line', async () => {
  const before = await signature(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  assert.deepEqual((await focused(page)).part, 'building', 'the dialog opens on the chosen part');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('dialog#merge-import[open] input[data-part="settings"]', (el) => el.checked), true);
  // Tab reaches Next and Cancel and stays in the dialog
  const reached = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    reached.push((await focused(page)).text || (await focused(page)).part);
  }
  assert.deepEqual(reached.slice(0, 2), ['Next', 'Cancel']);
  assert.ok(reached.slice(2).every((stop) => stop !== null), 'focus stays inside the dialog');
  assert.equal(await page.evaluate(() => document.querySelector('dialog#merge-import').contains(document.activeElement)), true);
  // Escape is Cancel
  await page.keyboard.press('Escape');
  await closed(page);
  assert.equal(await signature(page), before);
  assert.equal((await result(page)).text, FILE + ' was read and nothing was brought in. Nothing has changed.');
  // and again: Next with Enter, Bring it in with Enter, Undo with Enter
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.focus('dialog#merge-import[open] .dialog__buttons button');
  assert.equal((await focused(page)).text, 'Next');
  await page.keyboard.press('Enter');
  await stepIs(page, '2');
  assert.equal((await focused(page)).text, 'Bring in the settings?');
  await page.focus('dialog#merge-import[open] .dialog__buttons button');
  assert.equal((await focused(page)).text, 'Bring it in');
  await page.keyboard.press('Enter');
  await closed(page);
  await says(page, 'Brought in');
  await saved(page);
  assert.notEqual(await signature(page), before);
  await dismissToasts(page);
  await page.focus('#project-file [data-action="undo-part"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#project-file [data-line="result"] p').textContent.startsWith('Undid '), { timeout: 10000 });
  assert.equal(await signature(page), before);
});

for (const [width, height] of [[390, 844], [844, 390]]) {
  test('at ' + width + ' by ' + height + ': both steps fit the window, each part comes in and Undo takes it back', async () => {
    // a context of its own: the main page holds this device's project lock
    const context = await browser.createBrowserContext();
    context.__engine = browser.__engine;
    const phone = await openPlanner({ server, browser: context, hash: '#project', theme: 'light', width, height, mobile: true });
    try {
      await phone.page.waitForFunction(() => globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
      const p = phone.page;
      for (const part of ['building', 'schedule', 'settings']) {
        const before = await signature(p);
        await choose(p, FILE, fixture);
        await stepIs(p, '1');
        await p.click('dialog#merge-import[open] input[data-part="' + part + '"]');
        if (part === 'schedule') await p.waitForSelector('dialog#merge-import[open] .imp-clash');
        await fits(p, part + ' step 1');
        await press(p, 'Next');
        await stepIs(p, '2');
        await fits(p, part + ' step 2');
        await press(p, 'Bring it in');
        await closed(p);
        await says(p, 'Brought in');
        assert.notEqual(await signature(p), before, part + ' came in');
        await dismissToasts(p);
        await p.evaluate(() => document.querySelector('#project-file [data-action="undo-part"]').click());
        await p.waitForFunction(() => document.querySelector('#project-file [data-line="result"] p').textContent.startsWith('Undid '), { timeout: 10000 });
        assert.equal(await signature(p), before, part + ' was taken back');
      }
      assert.deepEqual(phone.problems(), { errors: [], blocked: [], shimmed: [] });
    } finally {
      await phone.page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
}
