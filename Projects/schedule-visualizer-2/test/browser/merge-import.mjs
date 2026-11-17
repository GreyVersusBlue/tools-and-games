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
// SV2-120b adds the guards of a dialog that may change a person's work: a read-only
// tab or a switch refuses before and during the run, a modal Working... holds the page,
// a project that changed under step 2 brings step 2 back, the line's Undo and the toast's
// name their own history entry (never a label), a traced image is never written over a
// different one, a refusal says what was kept, one run at a time, and the dialog's
// focus, live regions and wrapping.
//
// Every wait is on a state the page sets: the dialog's data-step, the card's
// data-result, the snapshots written, the store's undo entry; never a first
// paint or a sleep.

import test, { after, afterEach, before } from 'node:test';
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

// a case that failed must not leave its dialog for the next one to trip over
afterEach(async () => {
  if (!page || page.isClosed()) return;
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog#merge-import[open]')) dialog.querySelector('.dialog__buttons button:last-child').click();
  }).catch(() => {});
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
  await says(page, 'Brought in the building');
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
  // the toast's Undo told the line too: it says so, and offers nothing more
  await says(page, 'Undid ');
  assert.equal((await result(page)).undo, false);
  assert.equal(await signature(page), before);
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
  await says(page, 'Brought in the schedule');
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
  assert.deepEqual(await summary(page), ['Periods: 8 → 9', 'The period word and names: Period → Mod', 'Default passing time: 4 minutes → 5 minutes', 'Time format: 12-hour → 24-hour']);
  assert.deepEqual(await lines(page, 'taken'), ['Taken from the file: School name (only while this project\'s is blank), Periods (raised if the file has more, never lowered), The period word and names, Default passing time, Default head count, Colour scale, Checks and Time format.']);
  assert.deepEqual(await lines(page, 'not-taken'), ['Not taken: the theme and paper (this device\'s), and the cell size, walking and stair times and elevator times (they belong to the building).']);
  assert.match((await lines(page, 'snapshot'))[0], /“Before bringing in the settings”/);
  assert.equal(await signature(page), before);
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in the settings');
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
  assert.match((await result(page)).text, /^Nothing changed: the settings in “same\.json” match.* A snapshot and a recovery point were kept, though nothing changed\.$/);
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
  await says(page, 'Brought in the settings');
  await saved(page);
  assert.notEqual(await signature(page), before);
  await dismissToasts(page);
  await page.focus('#project-file [data-action="undo-part"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#project-file [data-line="result"] p').textContent.startsWith('Undid '), { timeout: 10000 });
  assert.equal(await signature(page), before);
});

// ---------------------------------------------------------------- SV2-120b: guards

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const TRACE = { width: 1, height: 1, opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, missing: false };

// a file of the sample whose building has traced images: { floor index: [id, data, type] }
function imageFixture(traced, change) {
  const project = sampleSchool();
  room(project, '101').number = '901';
  const images = {};
  for (const [index, [imageId, data, type]] of Object.entries(traced)) {
    project.building.floors[Number(index)].image = { imageId, ...TRACE };
    images[imageId] = { data, type };
  }
  if (change) change(project);
  return writeProjectFile(project, { images });
}

const count = (p, database, store) => p.evaluate((dbName, storeName) => new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    try {
      const all = db.transaction(storeName, 'readonly').objectStore(storeName).count();
      all.onsuccess = () => {
        db.close();
        resolve(all.result);
      };
      all.onerror = () => reject(all.error);
    } catch (error) {
      db.close();
      reject(error);
    }
  };
}), database, store);
const snapshotCount = (p) => count(p, 'sv2', 'snapshots');
const pointCount = (p) => count(p, 'sv2-recovery', 'recovery');
const storedImage = (p, id) => p.evaluate(async (wanted) => {
  const held = await globalThis.sv2.storage.getImage(wanted);
  return held && held.blob ? { type: held.blob.type, bytes: held.blob.size } : null;
}, id);

function rawWrite(p, fn, arg) {
  return p.evaluate(({ source, value }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('sv2');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['snapshots'], 'readwrite');
      // eslint-disable-next-line no-new-func
      new Function('tx', 'value', source)(tx, value);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  }), { source: '(' + fn.toString() + ')(tx, value)', value: arg });
}
const fillSnapshots = async (p) => {
  const have = await snapshotCount(p);
  await rawWrite(p, (tx, value) => {
    for (let i = value.from; i < value.to; i += 1) tx.objectStore('snapshots').put({ id: 'nfill' + String(i).padStart(5, '0'), name: 'Filler ' + i, takenAt: '2026-01-01T00:00:00.000Z', bytes: 2, project: {} });
  }, { from: have, to: 30 });
};
const unfill = (p) => rawWrite(p, (tx) => {
  const store = tx.objectStore('snapshots');
  const keys = store.getAllKeys();
  keys.onsuccess = () => keys.result.filter((id) => id.startsWith('nfill')).forEach((id) => store.delete(id));
});

// Up to step 2 of one part with a file.
async function through(p, name, body, part) {
  await choose(p, name, body);
  await stepIs(p, '1');
  await p.click('dialog#merge-import[open] input[data-part="' + part + '"]');
  if (part === 'schedule') await p.waitForSelector('dialog#merge-import[open] .imp-clash');
  await press(p, 'Next');
  await stepIs(p, '2');
}
// the page has settled: two frames
const settled = (p) => p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const flag = (p, name, on) => p.evaluate((key, value) => {
  globalThis.sv2.storage.state[key] = value;
}, name, on);
const apply = (p, action, payload) => p.evaluate(async (name, given) => {
  const actions = await import(new URL('engine/actions.js', document.baseURI).href);
  globalThis.sv2.store.apply(actions[name], given);
}, action, payload);
const lineText = (p) => p.$eval('#project-file [data-line="result"] p', (el) => el.textContent);
const lineRole = (p) => p.$eval('#project-file [data-line="result"] p', (el) => el.getAttribute('role'));
const undoAll = (p, n) => p.evaluate((times) => {
  for (let i = 0; i < times; i += 1) globalThis.sv2.store.undo();
}, n);
const KEPT_BOTH = 'A snapshot and a recovery point were kept, though nothing changed.';

test('a read-only tab refuses before step 1 opens, and nothing is kept', async () => {
  const other = await openPlanner({ hash: '#project', server, browser, keep: true });
  try {
    const p = other.page;
    // waits poll on animation frames, which a tab behind another never gets
    await p.bringToFront();
    await p.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
    const start = await signature(p);
    const snaps = await snapshotCount(p);
    const points = await pointCount(p);
    await choose(p, FILE, fixture);
    await resulted(p, 'refused');
    assert.match(await lineText(p), new RegExp('^“' + FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '” was not brought in, and nothing has changed\\. This tab is read-only while the project is open in another tab'));
    assert.equal(await lineRole(p), 'alert');
    assert.equal(await open(p), null, 'step 1 never opened');
    assert.equal(await p.$('dialog[open]'), null);
    assert.equal(await signature(p), start);
    assert.equal(await snapshotCount(p), snaps);
    assert.equal(await pointCount(p), points);
  } finally {
    await other.close();
    await page.bringToFront();
  }
});

test('a switch in progress refuses before step 1 opens', async () => {
  const start = await signature(page);
  await flag(page, 'switching', true);
  try {
    await choose(page, 'switching.json', fixture);
    await says(page, '“switching.json” was not brought in');
    assert.match(await lineText(page), /A project is being opened, so nothing can be brought in now\.$/);
    assert.equal(await open(page), null);
  } finally {
    await flag(page, 'switching', false);
  }
  assert.equal(await signature(page), start);
});

test('a tab that turns read-only or starts a switch while step 2 is open refuses before any snapshot, recovery point or image', async () => {
  const start = await signature(page);
  const undos = await undoLabel(page);
  const snaps = await snapshotCount(page);
  const points = await pointCount(page);
  for (const [name, sentence] of [['readOnly', /This tab is read-only/], ['switching', /A project is being opened/]]) {
    await through(page, FILE, fixture, 'building');
    await flag(page, name, true);
    try {
      await press(page, 'Bring it in');
      await closed(page);
      await says(page, '“' + FILE + '” was not brought in');
      assert.match(await lineText(page), sentence);
      assert.doesNotMatch(await lineText(page), /were kept|was kept/, 'nothing had been kept to say so');
    } finally {
      await flag(page, name, false);
    }
    assert.equal(await signature(page), start);
    assert.equal(await undoLabel(page), undos);
    assert.equal(await snapshotCount(page), snaps, name + ': no snapshot');
    assert.equal(await pointCount(page), points, name + ': no recovery point');
  }
});

test('Ctrl+Z at step 2 changes nothing and leaves step 2 open', async () => {
  await apply(page, 'setSetting', { key: 'schoolName', value: 'Ctrl Z School' });
  const start = await signature(page);
  const undos = await undoLabel(page);
  await through(page, FILE, fixture, 'building');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await settled(page);
  assert.equal(await open(page), '2');
  assert.equal(await signature(page), start);
  assert.equal(await undoLabel(page), undos);
  await press(page, 'Cancel');
  await closed(page);
  await page.evaluate(() => globalThis.sv2.store.undo());
  await dismissToasts(page);
});

test('a project that changed while step 2 was open brings step 2 back with the new summary, and keeps nothing', async () => {
  await apply(page, 'setSetting', { key: 'periods', value: 8 });
  const snaps = await snapshotCount(page);
  const points = await pointCount(page);
  await through(page, FILE, fixture, 'settings');
  assert.ok((await summary(page)).includes('Periods: 8 → 9'));
  await apply(page, 'setSetting', { key: 'periods', value: 10 });
  await press(page, 'Bring it in');
  await page.waitForSelector('dialog#merge-import[open] [data-line="changed"]');
  assert.equal(await open(page), '2');
  assert.deepEqual(await lines(page, 'changed'), ['The project changed while this was open; here is what would change now.']);
  assert.ok((await summary(page)).includes('Periods stay at 10: the file has 9.'), 'the summary is of the project as it is now');
  assert.deepEqual((await focused(page)).text, 'Bring in the settings?');
  assert.equal(await snapshotCount(page), snaps, 'nothing was kept for a step that did not happen');
  assert.equal(await pointCount(page), points);
  assert.equal(await page.$('dialog#merge-working'), null, 'Working… is gone');
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in the settings');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periods), 10);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periodWord), 'Mod');
  await dismissToasts(page);
  await undoAll(page, 2);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periods), 8);
  await page.evaluate(() => globalThis.sv2.store.undo());
});

test('Working… holds the page between step 2 and the end: modal, aria-busy, nothing can be pressed, and one run at a time', async () => {
  await through(page, FILE, fixture, 'building');
  const start = await signature(page);
  const undos = await undoLabel(page);
  await page.evaluate(() => {
    const storage = globalThis.sv2.storage;
    globalThis.__point = storage.takeRecoveryPoint;
    storage.takeRecoveryPoint = (reason) => new Promise((resolve) => {
      globalThis.__release = () => resolve(globalThis.__point.call(storage, reason));
    });
  });
  try {
    await press(page, 'Bring it in');
    await page.waitForFunction(() => typeof globalThis.__release === 'function');
    assert.deepEqual(await page.evaluate(() => ({
      busy: document.querySelector('dialog#merge-working[open]')?.getAttribute('aria-busy'),
      modal: document.querySelector('dialog#merge-working').matches(':modal'),
      others: document.querySelectorAll('dialog[open]').length,
      opener: document.querySelector('[data-action="import-part"]').getAttribute('aria-disabled'),
      reason: document.getElementById(document.querySelector('[data-action="import-part"]').getAttribute('aria-describedby'))?.textContent,
    })), { busy: 'true', modal: true, others: 1, opener: 'true', reason: 'An import of part of a project file is in progress.' });
    assert.equal(await page.$eval('#merge-working .dialog__title', (el) => el.textContent), 'Working…');
    // presses are ignored: Escape, Ctrl+Z, a click on the undo button, the opener, another file
    await page.keyboard.press('Escape');
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await page.click('#undo').catch(() => {});
    await page.evaluate(() => {
      const input = document.querySelector('#project-file input[data-file="part"]');
      globalThis.__clicks = 0;
      input.click = () => { globalThis.__clicks += 1; };
      document.querySelector('[data-action="import-part"]').click();
    });
    await choose(page, 'second.json', fixture);
    await settled(page);
    assert.equal(await page.evaluate(() => globalThis.__clicks), 0, 'the opener asks for no file while a run is on');
    assert.equal(await page.evaluate(() => document.querySelector('dialog#merge-working[open]') !== null), true, 'Escape did not close it');
    assert.equal(await signature(page), start);
    assert.equal(await undoLabel(page), undos);
    assert.equal(await page.$$eval('dialog[open]', (all) => all.length), 1, 'no second dialog');
  } finally {
    await page.evaluate(() => {
      delete document.querySelector('#project-file input[data-file="part"]').click;
      if (globalThis.__release) globalThis.__release();
      delete globalThis.__release;
      globalThis.sv2.storage.takeRecoveryPoint = globalThis.__point;
      delete globalThis.__point;
    });
  }
  await says(page, 'Brought in the building');
  assert.equal(await page.evaluate(() => document.querySelector('dialog[open]')), null);
  assert.equal(await page.$eval('[data-action="import-part"]', (el) => [el.getAttribute('aria-disabled'), el.getAttribute('aria-describedby')].join('|')), '|', 'the opener is free again');
  assert.equal(await lineText(page).then((text) => text.includes('second.json')), false, 'the second file was ignored');
  await dismissToasts(page);
  await page.click('#project-file [data-action="undo-part"]');
  await says(page, 'Undid ');
  assert.equal(await signature(page), start);
});

test('a second file chosen while step 1 is open is ignored, and the run ends as the first said', async () => {
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  assert.equal(await page.$eval('[data-action="import-part"]', (el) => el.getAttribute('aria-disabled')), 'true');
  await choose(page, 'second.json', fixture);
  await settled(page);
  assert.equal(await page.$$eval('dialog[open]', (all) => all.length), 1);
  assert.deepEqual(await lines(page, 'file'), [FILE + ': Harbourview <i>Annex</i> & "East" 学校, 3 floors, 13 rooms, 8 groups.']);
  await press(page, 'Cancel');
  await closed(page);
  assert.equal((await result(page)).text, FILE + ' was read and nothing was brought in. Nothing has changed.');
  assert.equal(await page.$eval('[data-action="import-part"]', (el) => el.getAttribute('aria-disabled')), null);
  assert.deepEqual((await focused(page)).text, 'Import part of a project file…', 'focus is back on the opener');
});

test('a refusal at Next keeps step 1 open and updates its one alert in place', async () => {
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog#merge-import[open]');
    globalThis.__alert = dialog.querySelector('[data-line="refused"]');
    globalThis.__fieldset = dialog.querySelector('fieldset');
  });
  assert.equal(await page.evaluate(() => globalThis.__alert.hidden), true, 'no alert until there is something to say');
  await flag(page, 'readOnly', true);
  await press(page, 'Next');
  await page.waitForFunction(() => !globalThis.__alert.hidden);
  assert.equal(await open(page), '1', 'step 1 stays open');
  assert.match(await page.evaluate(() => globalThis.__alert.textContent), /This tab is read-only/);
  await flag(page, 'readOnly', false);
  await flag(page, 'switching', true);
  await press(page, 'Next');
  await page.waitForFunction(() => /A project is being opened/.test(globalThis.__alert.textContent));
  assert.deepEqual(await page.evaluate(() => ({
    same: document.querySelector('dialog#merge-import[open] [data-line="refused"]') === globalThis.__alert,
    role: globalThis.__alert.getAttribute('role'),
    fieldset: document.querySelector('dialog#merge-import[open] fieldset') === globalThis.__fieldset,
    count: document.querySelectorAll('dialog#merge-import[open] [data-line="refused"]').length,
  })), { same: true, role: 'alert', fieldset: true, count: 1 });
  await flag(page, 'switching', false);
  await page.click('dialog#merge-import[open] input[data-part="settings"]');
  assert.equal(await page.evaluate(() => globalThis.__alert.hidden), true, 'choosing a part clears the alert');
  await press(page, 'Next');
  await stepIs(page, '2');
  await press(page, 'Cancel');
  await closed(page);
});

test('a radio change redraws only what changes: the fieldset and the radios stay, and so do the focus and the chosen answer', async () => {
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog#merge-import[open]');
    globalThis.__fieldset = dialog.querySelector('fieldset');
    globalThis.__radios = Array.from(dialog.querySelectorAll('input[data-part]'));
  });
  const same = () => page.evaluate(() => {
    const dialog = document.querySelector('dialog#merge-import[open]');
    return dialog.querySelector('fieldset') === globalThis.__fieldset && Array.from(dialog.querySelectorAll('input[data-part]')).every((radio, i) => radio === globalThis.__radios[i]);
  });
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  await page.waitForSelector('dialog#merge-import[open] .imp-clash');
  assert.equal(await same(), true);
  assert.equal((await focused(page)).part, 'schedule');
  await page.click('dialog#merge-import[open] input[value="overwrite"]');
  assert.equal(await same(), true, 'a clash answer redraws the question, not the parts');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.value, document.activeElement.checked]), ['overwrite', true], 'focus stays on the answer chosen');
  await page.click('dialog#merge-import[open] input[data-part="building"]');
  assert.equal(await page.$('dialog#merge-import[open] .imp-clash'), null);
  assert.equal(await same(), true);
  assert.equal((await focused(page)).part, 'building');
  await press(page, 'Cancel');
  await closed(page);
});

test('Back after changing the clash answer keeps it, focuses the chosen part, and the answer is used; the groups here are asked again', async () => {
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  await page.waitForSelector('dialog#merge-import[open] .imp-clash');
  await page.click('dialog#merge-import[open] input[value="overwrite"]');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.match((await summary(page))[0], /^Groups: 1 group replaced, 7 groups left as they were/);
  await press(page, 'Back');
  await stepIs(page, '1');
  assert.equal((await focused(page)).part, 'schedule');
  assert.equal(await page.$eval('dialog#merge-import[open] input[value="overwrite"]', (el) => el.checked), true);
  assert.match(await page.$eval('dialog#merge-import[open] .imp-clash legend', (el) => el.textContent), /^8 groups in the file/);
  // the groups here change while step 2 is away; the question is made again from them
  await press(page, 'Next');
  await stepIs(page, '2');
  await press(page, 'Back');
  await stepIs(page, '1');
  const groups = await page.evaluate(() => globalThis.sv2.store.project.groups.map((group) => group.id));
  for (const id of groups) await apply(page, 'deleteGroup', { id });
  await press(page, 'Cancel');
  await closed(page);
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  assert.equal(await page.$('dialog#merge-import[open] .imp-clash'), null, 'no group here has a name of the file');
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.match((await summary(page))[0], /^Groups: 8 groups added/);
  await press(page, 'Cancel');
  await closed(page);
  await undoAll(page, groups.length);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups.length), groups.length);
});

test('the clash question is asked again when the groups here change while step 1 is away', async () => {
  // step 1 open with the question; the groups here go; Back from step 2 asks it from what is now here
  await choose(page, FILE, fixture);
  await stepIs(page, '1');
  await page.click('dialog#merge-import[open] input[data-part="schedule"]');
  await page.waitForSelector('dialog#merge-import[open] .imp-clash');
  await press(page, 'Next');
  await stepIs(page, '2');
  const groups = await page.evaluate(() => globalThis.sv2.store.project.groups.map((group) => group.id));
  for (const id of groups) await apply(page, 'deleteGroup', { id });
  await press(page, 'Back');
  await stepIs(page, '1');
  assert.equal(await page.$('dialog#merge-import[open] .imp-clash'), null, 'the question is gone with the clashing groups');
  assert.equal((await focused(page)).part, 'schedule');
  await press(page, 'Cancel');
  await closed(page);
  await undoAll(page, groups.length);
});

test('Escape and Cancel at step 2 bring nothing in, keep nothing and return focus to the opener', async () => {
  const start = await signature(page);
  const snaps = await snapshotCount(page);
  const points = await pointCount(page);
  for (const how of ['Escape', 'Cancel']) {
    await through(page, FILE, fixture, 'settings');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else await press(page, 'Cancel');
    await closed(page);
    assert.equal((await result(page)).text, FILE + ' was read and nothing was brought in. Nothing has changed.');
    assert.equal(await signature(page), start);
    assert.equal(await snapshotCount(page), snaps);
    assert.equal(await pointCount(page), points);
    assert.equal((await focused(page)).text, 'Import part of a project file…', how + ': focus is on the opener');
  }
});

test('the line\'s Undo puts focus on the line, and the line is one live region updated in place', async () => {
  await through(page, FILE, fixture, 'settings');
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in the settings');
  await dismissToasts(page);
  await page.evaluate(() => {
    globalThis.__live = document.querySelector('#project-file [data-line="result"] p');
  });
  assert.equal(await lineRole(page), 'status');
  await page.click('#project-file [data-action="undo-part"]');
  await says(page, 'Undid ');
  assert.deepEqual(await page.evaluate(() => {
    const line = document.querySelector('#project-file [data-line="result"]');
    return { live: line.querySelector('p') === globalThis.__live, focus: document.activeElement === line, tabindex: line.getAttribute('tabindex'), count: line.querySelectorAll('p').length };
  }), { live: true, focus: true, tabindex: '-1', count: 1 });
});

test('two imports with the same label: each Undo takes back its own step and no other, and Redo then Undo works', async () => {
  const start = await signature(page);
  await page.evaluate(() => {
    globalThis.__toasts = [];
    globalThis.__toast = globalThis.sv2.ctx.toast;
    globalThis.sv2.ctx.toast = (options) => {
      globalThis.__toasts.push(options);
      return globalThis.__toast(options);
    };
  });
  const second = fixtureText((project) => {
    room(project, '901').number = '902';
  });
  const label = 'Bring in the building from ' + FILE;
  const bring = async (body) => {
    await through(page, FILE, body, 'building');
    await press(page, 'Bring it in');
    await closed(page);
    await page.waitForFunction((was) => globalThis.__toasts.filter((t) => t.action && t.action.label === 'Undo').length > was, { timeout: 15000 }, await page.evaluate(() => globalThis.__toasts.filter((t) => t.action && t.action.label === 'Undo').length));
  };
  const toastUndo = (n) => page.evaluate((i) => globalThis.__toasts.filter((t) => t.action && t.action.label === 'Undo')[i].action.run(), n);
  try {
    await bring(fixture);
    const afterA = await signature(page);
    await bring(second);
    const afterB = await signature(page);
    assert.notEqual(afterA, afterB);
    assert.equal(await undoLabel(page), label);
    const lineAfterB = await lineText(page);
    // the first import's toast, pressed now: B is on top, so nothing is undone
    await toastUndo(0);
    await settled(page);
    assert.equal(await signature(page), afterB, 'the first import\'s Undo did not take back the second');
    assert.equal(await undoLabel(page), label);
    assert.match(await toastText(page), /Later changes sit on top of it, so Undo cannot take it back by itself/);
    assert.equal(await lineText(page), lineAfterB, 'the card\'s line still speaks of the newest');
    assert.equal((await result(page)).undo, true);
    // the line's Undo is the second import's
    await page.click('#project-file [data-action="undo-part"]');
    await says(page, 'Undid ');
    assert.equal(await signature(page), afterA);
    assert.equal((await result(page)).undo, false);
    // Redo brings the same entry back; its toast Undo works again
    await page.click('#redo');
    await page.waitForFunction((was) => globalThis.sv2.store.undoLabel === was, {}, label);
    assert.equal(await signature(page), afterB);
    await toastUndo(1);
    await settled(page);
    assert.equal(await signature(page), afterA);
    // pressed again, it is already undone, and the line says so
    await toastUndo(1);
    await says(page, 'Bringing in the building');
    assert.match(await lineText(page), /was already undone\.$/);
    assert.equal(await signature(page), afterA);
    // the first one is now the newest: its toast takes it back
    await toastUndo(0);
    await settled(page);
    assert.equal(await signature(page), start);
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.ctx.toast = globalThis.__toast;
    });
    await dismissToasts(page);
  }
});

test('Undo that the project does not take is said, not claimed; a step with no history left says so', async () => {
  await through(page, FILE, fixture, 'settings');
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in the settings');
  await dismissToasts(page);
  const after = await signature(page);
  await flag(page, 'readOnly', true);
  try {
    await page.click('#project-file [data-action="undo-part"]');
    await says(page, 'Nothing was undone');
    assert.equal(await signature(page), after);
    assert.equal((await result(page)).undo, true, 'Undo stays offered: nothing was undone');
  } finally {
    await flag(page, 'readOnly', false);
  }
  // a project loaded over it clears the history: the entry is gone
  await page.evaluate(() => globalThis.sv2.store.replace(globalThis.sv2.store.project));
  await page.click('#project-file [data-action="undo-part"]');
  await page.waitForFunction(() => /no longer in the list of changes Undo keeps/.test(document.querySelector('#project-file [data-line="result"] p').textContent));
  assert.equal((await result(page)).undo, false);
  await page.evaluate(async () => {
    const actions = await import(new URL('engine/actions.js', document.baseURI).href);
    globalThis.sv2.store.apply(actions.setSetting, { key: 'periods', value: 8 });
    globalThis.sv2.store.apply(actions.setSetting, { key: 'periodWord', value: 'Period' });
    globalThis.sv2.store.apply(actions.setSetting, { key: 'defaultPassingSeconds', value: 240 });
    globalThis.sv2.store.apply(actions.setSetting, { key: 'timeFormat', value: '12h' });
  });
  await dismissToasts(page);
});

test('a traced image: written just before the change, skipped when already kept with the same bytes, refused when the bytes differ, and a refusal leaves none of the file\'s images behind', async () => {
  await saved(page);
  const start = await signature(page);
  await page.evaluate(() => {
    globalThis.__written = [];
    globalThis.__keep = globalThis.sv2.storage.keepFileImages;
    globalThis.sv2.storage.keepFileImages = (project, images) => {
      globalThis.__written.push(Object.keys(images));
      return globalThis.__keep(project, images);
    };
  });
  const bytesOf = (data) => Buffer.from(data, 'base64').length;
  try {
    const A = imageFixture({ 0: ['itrace0001', PNG, 'image/png'] });
    await through(page, 'trace.json', A, 'building');
    assert.deepEqual(await summary(page), ['The building becomes 3 floors and 13 rooms, with 1 traced image.', '128 schedule slots keep their rooms.']);
    assert.equal(await storedImage(page, 'itrace0001'), null, 'nothing is written at step 2');
    assert.deepEqual(await page.evaluate(() => globalThis.__written), []);
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, 'Brought in the building');
    assert.deepEqual(await storedImage(page, 'itrace0001'), { type: 'image/png', bytes: bytesOf(PNG) });
    assert.deepEqual(await page.evaluate(() => globalThis.__written), [['itrace0001']]);
    assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].image.imageId), 'itrace0001');
    await dismissToasts(page);
    await saved(page);
    // the same id with the same bytes: not written again
    await through(page, 'trace.json', A, 'building');
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, 'Brought in the building');
    assert.deepEqual(await page.evaluate(() => globalThis.__written), [['itrace0001']], 'the second import wrote nothing');
    assert.deepEqual(await storedImage(page, 'itrace0001'), { type: 'image/png', bytes: bytesOf(PNG) });
    await dismissToasts(page);
    // the same id with other bytes: refused, and nothing is kept or changed
    const now = await signature(page);
    const snaps = await snapshotCount(page);
    const points = await pointCount(page);
    const undos = await undoLabel(page);
    const different = imageFixture({ 0: ['itrace0001', GIF, 'image/gif'] });
    await through(page, 'other-trace.json', different, 'building');
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, '“other-trace.json” was not brought in');
    assert.match(await lineText(page), /^“other-trace\.json” was not brought in, and nothing has changed\. A traced image in this file has the same name as a different picture this device already keeps/);
    assert.doesNotMatch(await lineText(page), /were kept|was kept/);
    assert.equal(await lineRole(page), 'alert');
    assert.equal(await signature(page), now);
    assert.equal(await undoLabel(page), undos);
    assert.equal(await snapshotCount(page), snaps);
    assert.equal(await pointCount(page), points);
    assert.deepEqual(await storedImage(page, 'itrace0001'), { type: 'image/png', bytes: bytesOf(PNG) }, 'the picture is still the first');
    // a file with a new image and a conflicting one: refused, and the new one was never written
    const mixed = imageFixture({ 0: ['itrace0002', PNG, 'image/png'], 1: ['itrace0001', GIF, 'image/gif'] });
    await through(page, 'mixed.json', mixed, 'building');
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, '“mixed.json” was not brought in');
    assert.equal(await storedImage(page, 'itrace0002'), null, 'a refusal leaves none of the file\'s images in the store');
    assert.deepEqual(await page.evaluate(() => globalThis.__written), [['itrace0001']]);
    assert.equal(await signature(page), now);
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.storage.keepFileImages = globalThis.__keep;
    });
  }
  await undoAll(page, 2);
  assert.equal(await signature(page), start);
});

test('a refusal after the snapshot and the recovery point says they were kept', async () => {
  const start = await signature(page);
  await through(page, FILE, fixture, 'building');
  await page.evaluate(() => {
    const storage = globalThis.sv2.storage;
    globalThis.__point = storage.takeRecoveryPoint;
    storage.takeRecoveryPoint = async (reason) => {
      const key = await globalThis.__point.call(storage, reason);
      storage.state.readOnly = true;
      return key;
    };
  });
  const snaps = await snapshotCount(page);
  try {
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, '“' + FILE + '” was not brought in');
    assert.match(await lineText(page), new RegExp('This tab is read-only while the project is open in another tab, so nothing can be brought in here\\. ' + KEPT_BOTH + '$'));
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.storage.takeRecoveryPoint = globalThis.__point;
      globalThis.sv2.storage.state.readOnly = false;
    });
  }
  assert.equal(await snapshotCount(page), snaps + 1, 'the snapshot was kept, as said');
  assert.equal(await signature(page), start);
});

test('a project that does not take the change is a refusal, not "nothing changed", and says what was kept', async () => {
  const start = await signature(page);
  await through(page, FILE, fixture, 'building');
  await page.evaluate(() => {
    globalThis.__apply = globalThis.sv2.store.apply;
    globalThis.sv2.store.apply = () => globalThis.sv2.store.project;
  });
  try {
    await press(page, 'Bring it in');
    await closed(page);
    await page.waitForFunction(() => /The project did not take it/.test(document.querySelector('#project-file [data-line="result"] p').textContent), { timeout: 15000 });
    assert.match(await lineText(page), new RegExp('and nothing has changed\\. The project did not take it\\. ' + KEPT_BOTH + '$'));
    assert.equal(await lineRole(page), 'alert');
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.store.apply = globalThis.__apply;
    });
  }
  assert.equal(await signature(page), start);
});

test('with the device at its snapshot limit the change comes in with a recovery point and no snapshot, and step 2 said so', async () => {
  await fillSnapshots(page);
  try {
    await through(page, FILE, fixture, 'settings');
    assert.match((await lines(page, 'snapshot'))[0], /No snapshot can be taken: this device already keeps 30 snapshots, the most it keeps/);
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, 'Brought in the settings');
    assert.equal(await snapshotCount(page), 30, 'none replaced to make room');
    await dismissToasts(page);
    await page.click('#project-file [data-action="undo-part"]');
    await says(page, 'Undid ');
  } finally {
    await unfill(page);
  }
});

test('with saves failing the snapshot cannot be taken first: refused at Bring it in, nothing kept, nothing changed', async () => {
  await saved(page);
  await apply(page, 'setSetting', { key: 'periodWord', value: 'Block' });
  await page.evaluate(() => {
    globalThis.sv2.storage.hooks.failWrite = 'QuotaExceededError: the device is full';
  });
  const snaps = await snapshotCount(page);
  const points = await pointCount(page);
  let start;
  try {
    await page.waitForFunction(() => globalThis.sv2.storage.state.save === 'failed', { timeout: 15000 });
    start = await signature(page);
    await through(page, FILE, fixture, 'building');
    await press(page, 'Bring it in');
    await closed(page);
    await says(page, '“' + FILE + '” was not brought in');
    assert.match(await lineText(page), /^“.+” was not brought in, and nothing has changed, because the snapshot could not be taken first\. /);
    assert.doesNotMatch(await lineText(page), /were kept|was kept/);
    assert.equal(await signature(page), start);
    assert.equal(await snapshotCount(page), snaps);
    assert.equal(await pointCount(page), points);
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.storage.hooks.failWrite = null;
    });
  }
  await page.evaluate(() => globalThis.sv2.store.undo());
  await saved(page);
  await dismissToasts(page);
});

test('names typed in the file are shown as typed, never as markup, in both steps, the line and the toast', async () => {
  const markup = fixtureText((project) => {
    project.settings.schoolName = '<img src=x onerror="window.__hit=1"> & <b>Bold</b>';
  });
  const name = '<script>window.__hit=2</script>.json';
  await choose(page, name, markup);
  await stepIs(page, '1');
  assert.equal(await page.$('dialog#merge-import[open] [data-line="file"] *'), null);
  assert.match((await lines(page, 'file'))[0], /^<script>window\.__hit=2<\/script>\.json: <img src=x onerror="window\.__hit=1"> & <b>Bold<\/b>, 3 floors/);
  await press(page, 'Next');
  await stepIs(page, '2');
  assert.equal(await page.$('dialog#merge-import[open] [data-line="file"] *'), null);
  await press(page, 'Bring it in');
  await closed(page);
  await says(page, 'Brought in the building');
  assert.equal(await page.$('#project-file [data-line="result"] p > :not(button), .toast__text > *, #project-file [data-line="result"] img, #project-file [data-line="result"] script'), null);
  assert.equal(await page.evaluate(() => globalThis.__hit), undefined);
  assert.match(await toastText(page), /^Brought in the building from <script>window\.__hit=2<\/script>\.json\.Undo$/);
  await dismissToasts(page);
  await page.click('#project-file [data-action="undo-part"]');
  await says(page, 'Undid ');
});

for (const [width, height] of [[390, 844], [844, 390]]) {
  test('at ' + width + ' by ' + height + ': a long file name, a long school name and a long list of lost rooms wrap, and the question and buttons stay in view', async () => {
    const other = sampleSchool();
    other.settings.schoolName = 'Harbourview'.repeat(12);
    const long = writeProjectFile(other, { images: {} });
    const name = 'a-very-long-file-name-'.repeat(8) + '.json';
    const context = await browser.createBrowserContext();
    context.__engine = browser.__engine;
    const phone = await openPlanner({ server, browser: context, hash: '#project', theme: 'light', width, height, mobile: true });
    try {
      const p = phone.page;
      await p.waitForFunction(() => globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
      // the rooms here get other ids and other numbers: each one the schedule uses is "not in the new building"
      await p.evaluate(async () => {
        const actions = await import(new URL('engine/actions.js', document.baseURI).href);
        const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
        let text = '';
        const rooms = [];
        for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.push(space);
        const renamed = new Map(rooms.map((space, i) => [space.id, 'lost' + String(i).padStart(4, '0')]));
        for (const space of rooms) space.number = 'Room-L' + space.number;
        text = JSON.stringify(project);
        for (const [from, to] of renamed) text = text.split('"' + from + '"').join('"' + to + '"');
        globalThis.sv2.store.apply(actions.replaceProject, { project: JSON.parse(text), label: 'Rename the rooms' });
      });
      await choose(p, name, long);
      await stepIs(p, '1');
      await fits(p, 'step 1');
      await press(p, 'Next');
      await stepIs(p, '2');
      await fits(p, 'step 2');
      const lost = (await summary(p)).find((line) => /not in the new building/.test(line));
      assert.ok(lost && lost.length > 60, 'the list of lost rooms is long: ' + JSON.stringify(await summary(p)));
      const box = await p.evaluate(() => {
        const dialog = document.querySelector('dialog#merge-import[open]');
        const body = dialog.querySelector('.dialog__body');
        const title = dialog.querySelector('.dialog__title').getBoundingClientRect();
        return { titleInView: title.top >= 0 && title.bottom <= window.innerHeight, scrolls: body.scrollHeight > body.clientHeight, bodyOverflowY: getComputedStyle(body).overflowY, wide: Array.from(dialog.querySelectorAll('.merge p, .merge li')).some((el) => el.scrollWidth > el.clientWidth + 1) };
      });
      assert.equal(box.titleInView, true, 'the question is in view');
      assert.equal(box.wide, false, 'nothing is wider than its line');
      assert.equal(box.bodyOverflowY, 'auto');
      if (height < 500) assert.equal(box.scrolls, true, 'on a short window the summary scrolls between the question and the buttons');
      await press(p, 'Cancel');
      await closed(p);
      assert.deepEqual(phone.problems(), { errors: [], blocked: [], shimmed: [] });
    } finally {
      await phone.page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
}

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
        await says(p, 'Brought in the ' + part);
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
