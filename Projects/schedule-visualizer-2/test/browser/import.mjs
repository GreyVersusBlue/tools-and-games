// The Import tab, in a real browser: node test/browser/import.mjs
//
// A groups CSV with one column the tool cannot place is chosen, the column is
// corrected, a mapping that cannot be used is refused and put right, the
// group that is already here is answered for, the file is imported as one
// step and undone. Then teachers and subjects from CSV, files that cannot be
// used, the schedule file out and back in, every export as a download named
// with the school and the date, and the checks report's print button.
// Assertions are on what the page shows; a download is read by standing in
// for the click that would save it.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openPlanner, go, startServer, launch, TOOL_DIR } from './harness.mjs';

const DAY_A = 'dsample00a';
const SCHOOL = 'Marrowby Middle School (sample)';
const HOSTILE = '<img src=x onerror=alert(1)> "Dr." O\'Brien-Ñandú, 王老师';

// SV2-10's fixture, with the header of its Period 3 column changed to one
const FIXTURE = readFileSync(path.join(TOOL_DIR, 'test', 'fixtures', 'formats', 'groups-import.csv'), 'utf8');
// the tool cannot place, and one more group whose name is markup.
const MARKUP = '<img src=x onerror=alert(1)> <b>9B</b>';
const GROUPS_CSV = FIXTURE.replace(',Period 3,', ',Third,') + '"' + MARKUP + '",9,,,,,,,,,,,,\n';

let server;
let browser;
let session;
let page;
// Every dialog the browser itself put up. A name that is markup must never
// run; if one did, its alert would stop the page for good, so it is answered
// here and the test fails on the record of it instead of hanging.
const dialogs = [];

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const count = (selector) => page.$$eval(selector, (all) => all.length);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
const toastText = () => text('.toast .toast__text');
const undoOff = () => page.$eval('#undo', (el) => el.getAttribute('aria-disabled'));
const figure = (name) => go(page, '#project').then(() => text('.figures__item[data-figure="' + name + '"] dd'));

async function click(selector) {
  await settled();
  if (!selector.startsWith('.toast')) await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.click(selector);
}

// Choose a file, as the file picker would hand it over.
async function choose(kind, name, body) {
  await settled();
  await page.evaluate((which, fileName, contents) => {
    const input = document.querySelector('input[type="file"][data-file="' + which + '"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], fileName));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, kind, name, body);
}

// Every download from here on is kept instead of saved: its name, its first
// bytes and its text.
async function catchDownloads() {
  await page.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      const name = this.download;
      return fetch(this.href).then((response) => response.arrayBuffer()).then((buffer) => {
        const bytes = new Uint8Array(buffer);
        globalThis.sv2test.downloads.push({ name, head: Array.from(bytes.slice(0, 3)), text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) });
      });
    };
  });
}

async function download(selector) {
  const had = await page.evaluate(() => globalThis.sv2test.downloads.length);
  await click(selector);
  await shows((n) => globalThis.sv2test.downloads.length > n, had);
  return page.evaluate(() => globalThis.sv2test.downloads[globalThis.sv2test.downloads.length - 1]);
}

const mappingRoles = () => page.$$eval('.imp-mapping tbody tr', (rows) => rows.map((row) => row.dataset.role));
const groupCounts = () => page.$eval('[data-panel="groups"] .imp-counts', (el) => [el.dataset.create, el.dataset.match, el.dataset.skip, el.dataset.unknown].map(Number));
const previewRow = (panel, row) => page.$eval('[data-panel="' + panel + '"] .imp-preview tr[data-row="' + row + '"]', (el) => Array.from(el.cells).map((cell) => cell.textContent));

async function pick(key, value) {
  await settled();
  await page.select('[data-key="' + key + '"]', value);
  await settled();
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/import', theme: 'light', width: 1500, height: 1000 });
  page = session.page;
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type() + ': ' + dialog.message());
    dialog.dismiss().catch(() => {});
  });
  await shows(() => document.querySelector('link[data-sheet="import"]')?.sheet);
  await catchDownloads();
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(dialogs, []);
});

test('the Import tab has a panel for groups, teachers, subjects, the schedule file and the exports', async () => {
  assert.deepEqual(await page.$$eval('.imp .imp-panel__title', (all) => all.map((el) => el.textContent)),
    ['Groups from a spreadsheet', 'Teachers from a spreadsheet', 'Subjects from a spreadsheet', 'The schedule from a schedule file', 'Export']);
  assert.equal(await exists('[data-coming]'), false, 'nothing here is still coming');
  // every file input is behind a button a keyboard reaches
  assert.deepEqual(await page.$$eval('.imp input[type="file"]', (all) => all.map((el) => [el.dataset.file, el.hidden, el.previousElementSibling.tagName, el.previousElementSibling.dataset.key])), [
    ['groups', true, 'BUTTON', 'imp-groups-choose'],
    ['teachers', true, 'BUTTON', 'imp-teachers-choose'],
    ['subjects', true, 'BUTTON', 'imp-subjects-choose'],
    ['schedule', true, 'BUTTON', 'imp-schedule-choose'],
  ]);
});

test('the template is a download named with the school and the date, with a column for every period of every day type', async () => {
  const file = await download('[data-action="template"]');
  assert.match(file.name, new RegExp('^' + SCHOOL.replace(/[()]/g, '\\$&') + ' - groups template - \\d{4}-\\d{2}-\\d{2}\\.csv$'));
  assert.deepEqual(file.head, [0xef, 0xbb, 0xbf], 'a byte-order mark, so a spreadsheet reads the names in any script');
  const periods = (day) => Array.from({ length: 8 }, (unused, i) => day + ' Period ' + (i + 1));
  assert.equal(file.text, '﻿' + ['Group', 'Grade', 'Head count', 'Colour'].concat(periods('A Day'), periods('B Day')).join(',') + '\r\n');
  assert.match(await toastText(), /^Saved .* - groups template - .*\.csv to your downloads\.$/);
});

test('a groups CSV is read and shown: the tool guesses each column and ignores the one it cannot place', async () => {
  await choose('groups', 'groups <fall>.csv', GROUPS_CSV);
  await page.waitForSelector('.imp-mapping');
  await settled();
  assert.equal(await text('[data-panel="groups"] [data-file="groups"]'), '“groups <fall>.csv” has 7 rows under its header. Nothing changes until you import.');
  assert.deepEqual(await mappingRoles(), ['name', 'grade', 'headCount', 'ignore', 'colour', 'period', 'period', 'ignore', 'period', 'period', 'period', 'period', 'period', 'ignore']);
  // the column it could not place is shown with its header and its first value
  assert.deepEqual(await page.$eval('.imp-mapping tr[data-column="7"]', (row) => [row.cells[0].textContent, row.cells[1].textContent]), ['Third', '101']);
  // without that column: four new groups, 6A already here, two rows left out, and no unknown room yet
  assert.deepEqual(await groupCounts(), [4, 1, 2, 0]);
  assert.equal(await undoOff(), 'true', 'reading a file changes nothing');
});

test('correcting the column changes the preview: its rooms are read, and the two that are not in the building are listed row by row', async () => {
  await pick('imp-col:7:role', 'period');
  // it takes the one period no other column has
  assert.equal(await page.$eval('[data-key="imp-col:7:period"]', (el) => el.selectedOptions[0].textContent), 'Period 3');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'imp-col:7:role', 'focus stays on the control that was changed');
  assert.deepEqual(await groupCounts(), [4, 1, 2, 2]);
  assert.deepEqual(await previewRow('groups', 3), ['3', 'The "Owls", <9A>', 'A Day', 'A new group.', 'Not in the building: 999.']);
  assert.deepEqual(await previewRow('groups', 4), ['4', '七年级一班', 'A Day', 'A new group.',
    'Not in the building: Annex 4.The head count "twenty" is not a whole number from 1 to 999, so it was left out.The colour "teal" is not written #rrggbb, so it was left out.']);
  assert.deepEqual((await previewRow('groups', 5)).slice(3, 4), ['Left out. This row has no group name.']);
  assert.match((await previewRow('groups', 7))[3], /^Left out\. Row 6 already gave 8C its A Day\./);
  // a name with markup in it is text
  assert.deepEqual((await previewRow('groups', 8)).slice(1, 4), [MARKUP, 'A Day', 'A new group.']);
  assert.equal(await count('.imp-preview img, .imp-preview b, .imp-mapping img'), 0);
  assert.deepEqual(dialogs, [], 'and nothing in it ran');
});

test('a mapping that cannot be used says why and offers no import; putting it right brings the preview back', async () => {
  await pick('imp-col:7:period', '0');
  assert.equal(await text('[data-problems="mapping"]'), 'Column "Third" is set as Period 1, and so is an earlier column. Give one of them its day type.');
  assert.equal(await exists('[data-action="import-groups"]'), false);
  assert.equal(await exists('[data-panel="groups"] .imp-preview'), false);
  await pick('imp-col:7:period', '2');
  assert.equal(await exists('[data-problems="mapping"]'), false);
  assert.deepEqual(await groupCounts(), [4, 1, 2, 2]);
});

test('the group that is already here is answered for, and the button names what the import will do', async () => {
  assert.match(await text('[data-clash="imp-groups"] legend'), /^One group in the file has the name of a group already here: “6A”\./);
  assert.equal(await page.$eval('[data-key="imp-groups:all:skip"]', (el) => el.checked), true, 'skip is the answer until another is chosen');
  assert.equal(await text('[data-action="import-groups"]'), 'Add 4 groups');
  assert.equal((await previewRow('groups', 2))[3], 'Already here: skipped.');

  await click('[data-key="imp-groups:all:rename"]');
  await settled();
  assert.equal(await text('[data-action="import-groups"]'), 'Add 5 groups');
  assert.equal((await previewRow('groups', 2))[3], 'Already here, so it is added as “6A (2)”.');
  // a new name that is taken is refused before anything is imported
  await click('[data-key="imp-groups:name:6a"]');
  await page.keyboard.type('6b');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-refused="names"]');
  assert.equal(await text('[data-refused="names"]'), 'There is already a group called "6b". Type a different name for the imported "6A".');
  assert.equal(await exists('[data-action="import-groups"]'), false);

  await click('[data-key="imp-groups:all:overwrite"]');
  await settled();
  assert.equal(await exists('[data-refused="names"]'), false);
  assert.equal(await text('[data-action="import-groups"]'), 'Add 4 groups and replace 1');
  assert.equal((await previewRow('groups', 2))[3], 'Already here: the group here takes these rooms.');
  assert.equal(await undoOff(), 'true', 'still nothing has changed');
});

test('the import is one step: a recovery point, four groups added and one replaced, said in a toast and on the tab', async () => {
  await click('[data-action="import-groups"]');
  await page.waitForSelector('[data-done="groups"]');
  assert.equal(await toastText(), 'Imported groups: 4 groups added, 1 group replaced.');
  assert.match(await text('[data-done="groups"]'), /^Imported “groups <fall>\.csv”: 4 groups added, 1 group replaced\. Undo takes the whole import back in one step\./);
  assert.equal(await exists('.imp-mapping'), false, 'the file is put away');
  assert.deepEqual(await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints()).map((point) => point.reason)), ['import'], 'the project as it was is kept before the import');

  await click('[data-done="groups"] a');
  await page.waitForSelector('.sch-group');
  await settled();
  assert.deepEqual(await page.$$eval('.sch-group .sch-group__name', (all) => all.map((el) => el.textContent).slice(8)), ['The "Owls", <9A>', '七年级一班', '8C', MARKUP]);
  assert.equal(await count('.sch-group img, .sch-group b'), 0);
  // 6A kept its place in the list and took the file's rooms
  await page.evaluate(() => Array.from(document.querySelectorAll('.sch-group')).find((el) => el.querySelector('.sch-group__name').textContent === '6A').click());
  await shows(() => document.querySelector('.sch-editor__title')?.textContent === '6A');
  await settled();
  const room = (period) => page.$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="' + period + '"] [data-key="slot:' + DAY_A + ':' + period + ':room"]', (el) => el.value);
  assert.match(await room(4), /^202/, 'Period 5 was Room 302 and is the file\'s 202 now');
  // the corrected column was imported as Period 3: the Owls' 999 is there, and not in the building
  await page.evaluate(() => Array.from(document.querySelectorAll('.sch-group')).find((el) => el.querySelector('.sch-group__name').textContent.includes('Owls')).click());
  await shows(() => document.querySelector('.sch-editor__title')?.textContent === 'The "Owls", <9A>');
  await settled();
  assert.match(await text('.sch-day[data-day="' + DAY_A + '"] tr[data-period="2"] .sch-finding-line--warning'), /not in the building/);
});

test('one undo takes the whole import back', async () => {
  await click('#undo');
  await shows(() => document.querySelectorAll('.sch-group').length === 8);
  assert.equal(await toastText(), 'Undid: Import groups: 4 groups added, 1 group replaced');
  assert.equal(await undoOff(), 'true', 'and that was the only step');
  await page.evaluate(() => Array.from(document.querySelectorAll('.sch-group')).find((el) => el.querySelector('.sch-group__name').textContent === '6A').click());
  await shows(() => document.querySelector('.sch-editor__title')?.textContent === '6A');
  await settled();
  const room = await page.$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="4"] [data-key="slot:' + DAY_A + ':4:room"]', (el) => el.value);
  assert.match(room, /^302/, '6A is back in the room it had');
});

test('teachers from a CSV: each row says what it would do, the import is one step, and undo takes it back', async () => {
  await go(page, '#schedule/import');
  const csv = ['Teacher,Subject code,Subject,Rooms,Notes', '"' + HOSTILE.replace(/"/g, '""') + '",SCI,,102; 999,', 'ms. halloran,,,,Mornings only', 'Mr. Brightwater,,,,', ',MATH,,,'].join('\r\n');
  await choose('teachers', 'staff.csv', csv);
  await page.waitForSelector('[data-panel="teachers"] .imp-preview');
  await settled();
  assert.equal(await text('[data-panel="teachers"] [data-file="teachers"]'),
    '“staff.csv”: 1 teacher is new, 1 teacher already here would change, 1 teacher already here is the same and 1 row will be left out. Nothing changes until you import.');
  assert.deepEqual(await previewRow('teachers', 2), ['2', HOSTILE, 'A new teacher.', 'Room "999" is not in the building, so it was left out.']);
  assert.equal(await count('[data-panel="teachers"] .imp-preview img'), 0, 'a name with markup in it is text');
  assert.deepEqual(dialogs, [], 'and nothing in it ran');
  assert.deepEqual(await previewRow('teachers', 3), ['3', 'Ms. Halloran', 'Already here: the notes change.', '']);
  assert.deepEqual(await previewRow('teachers', 4), ['4', 'Mr. Brightwater', 'Already here, and the same: nothing to change.', '']);
  assert.deepEqual((await previewRow('teachers', 5)).slice(2, 3), ['Left out. This row has no teacher name.']);
  assert.equal(await text('[data-action="import-teachers"]'), 'Add 1 teacher and update 1');

  await click('[data-action="import-teachers"]');
  await page.waitForSelector('[data-done="teachers"]');
  assert.equal(await toastText(), 'Imported teachers: 1 teacher added, 1 teacher updated, 1 teacher left unchanged.');
  await click('[data-done="teachers"] a');
  await page.waitForSelector('.sch-teachers tbody tr');
  await settled();
  assert.equal(await count('.sch-teachers tbody tr'), 13);
  assert.equal(await page.$eval('.sch-teachers tbody tr:last-child input[name="teacherName"]', (el) => el.value), HOSTILE);
  assert.equal(await count('.sch-teachers img'), 0);

  await click('#undo');
  await shows(() => document.querySelectorAll('.sch-teachers tbody tr').length === 12);
  assert.equal(await undoOff(), 'true');
});

test('subjects go out as a CSV and come back in: a changed name is an update, a new code a new subject', async () => {
  await go(page, '#schedule/import');
  const file = await download('[data-action="export-subjects"]');
  assert.match(file.name, / - subjects - \d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(file.text.split('\r\n')[0], '﻿Code,Subject,Colour');
  assert.equal(file.text.split('\r\n')[1], 'MATH,Mathematics,#2a6f97');

  // the file as it is changes nothing, and the tab says so instead of offering a button
  await choose('subjects', file.name, file.text);
  await page.waitForSelector('[data-panel="subjects"] .imp-preview');
  await settled();
  assert.equal(await exists('[data-action="import-subjects"]'), false);
  assert.equal(await text('[data-panel="subjects"] [data-note="nothing"]'), 'Importing this file would change nothing.');

  await choose('subjects', 'subjects.csv', file.text.replace('MATH,Mathematics,#2a6f97', 'math,Maths,#2a6f97') + 'DRAMA,"Drama & <Stage>",teal\r\n');
  await shows(() => document.querySelector('[data-action="import-subjects"]')?.textContent === 'Add 1 subject and update 1');
  assert.deepEqual(await previewRow('subjects', 2), ['2', 'MATH · Maths', 'Already here: the name changes.', '']);
  assert.deepEqual(await previewRow('subjects', 11), ['11', 'DRAMA · Drama & <Stage>', 'A new subject.', 'The colour "teal" is not written #rrggbb, so it was left out.']);
  await click('[data-action="import-subjects"]');
  await page.waitForSelector('[data-done="subjects"]');
  assert.equal(await toastText(), 'Imported subjects: 1 subject added, 1 subject updated, 8 subjects left unchanged.');

  await click('[data-done="subjects"] a');
  await page.waitForSelector('.sch-subjects tbody tr');
  await settled();
  assert.deepEqual(await page.$$eval('.sch-subjects tbody tr', (rows) => [rows.length, rows[0].querySelector('input[name="subjectName"]').value, rows[rows.length - 1].querySelector('input[name="subjectName"]').value]), [10, 'Maths', 'Drama & <Stage>']);
  await click('#undo');
  await shows(() => document.querySelectorAll('.sch-subjects tbody tr').length === 9);
  assert.equal(await undoOff(), 'true');
});

test('a file that cannot be used changes nothing and says what to do', async () => {
  await go(page, '#schedule/import');
  await choose('teachers', 'rooms.csv', 'Staff,Rooms\r\nMs. Halloran,101\r\n');
  await page.waitForSelector('[data-problems="teachers"]');
  assert.equal(await text('[data-panel="teachers"] [data-file="teachers"]'), '“rooms.csv” cannot be used as it is, and nothing has changed.');
  assert.match(await text('[data-problems="teachers"]'), /^No column is headed "Teacher"/);
  assert.equal(await exists('[data-action="import-teachers"]'), false);
  await click('[data-panel="teachers"] [data-action="put-away"]');
  await settled();
  assert.equal(await exists('[data-problems="teachers"]'), false);

  await choose('groups', 'empty.csv', '\r\n\r\n');
  await page.waitForSelector('[data-refused="groups"]');
  assert.equal(await text('[data-refused="groups"]'), '“empty.csv” has no rows. Choose a CSV file with a header row and one row for each group.');
  assert.equal(await exists('.imp-mapping'), false);
  assert.equal(await undoOff(), 'true');
});

test('the schedule file goes out and comes back: a group that is gone is added, the ones still here are answered for', async () => {
  await go(page, '#schedule/import');
  const file = await download('[data-action="export-schedule"]');
  assert.match(file.name, / - schedule - \d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(JSON.parse(file.text).format, 'sv2-schedule');

  // a project file is not a schedule file, and says which it is
  const project = await page.evaluate(async () => (await import(new URL('engine/exports.js', location.href).href)).buildExport(globalThis.sv2.store.project, 'project', {}).text);
  await choose('schedule', 'whole.json', project);
  await page.waitForSelector('[data-refused="schedule"]');
  assert.equal(await text('[data-refused="schedule"]'),
    '“whole.json” was not imported, and nothing has changed. This is a project file, not a schedule file. It holds a whole project: import it as a project.');
  await choose('schedule', 'cut.json', file.text.slice(0, 400));
  await shows(() => /cut\.json/.test(document.querySelector('[data-refused="schedule"]')?.textContent));
  assert.match(await text('[data-refused="schedule"]'), /This file could not be read\. It is not a Schedule Visualizer 2 file, or it was cut short/);

  // 7B leaves the project; the file brings it back
  await page.evaluate(async () => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(actions.deleteGroup, { id: 'gsample07b' });
  });
  await choose('schedule', file.name, file.text);
  await page.waitForSelector('[data-action="import-schedule"]');
  await settled();
  assert.match(await text('[data-panel="schedule"] [data-file="schedule"]'), /holds 8 groups, 12 teachers, 9 subjects and 2 day types, for a day of 8 periods\. Nothing changes until you import\.$/);
  assert.match(await text('[data-clash="imp-schedule"] legend'), /^7 groups in the file have the names of groups already here\./);
  assert.deepEqual(await page.$$eval('[data-clash="imp-schedule"] tbody th', (all) => all.map((el) => el.textContent)), ['6A', '6B', '6C', '7A', '7C', '8A', '8B']);
  await click('[data-action="import-schedule"]');
  await page.waitForSelector('[data-done="schedule"]');
  assert.equal(await toastText(), 'Imported the schedule file: 1 group added, 7 groups left as they were.');
  assert.equal(await figure('groups'), '8');
  await click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '7');
  await click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '8');
  assert.equal(await undoOff(), 'true', 'the import was one step, the delete before it another');
});

test('every export is a download named with the school and the date, and the CSV ones open in a spreadsheet', async () => {
  await go(page, '#schedule/import');
  const seen = [];
  for (const kind of ['groups', 'teachers', 'subjects', 'rooms', 'teacher-grid', 'room-grid', 'schedule']) {
    const file = await download('[data-action="export-' + kind + '"]');
    seen.push(file.name.replace(/\d{4}-\d{2}-\d{2}/, 'DATE'));
    if (file.name.endsWith('.csv')) {
      assert.deepEqual(file.head, [0xef, 0xbb, 0xbf], kind);
      assert.ok(file.text.endsWith('\r\n'), kind);
    }
  }
  assert.deepEqual(seen, ['groups', 'teachers', 'subjects', 'rooms', 'teachers by period', 'rooms by period'].map((what) => SCHOOL + ' - ' + what + ' - DATE.csv').concat([SCHOOL + ' - schedule - DATE.json']));
  const today = await page.evaluate(() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  });
  assert.equal((await download('[data-action="export-groups"]')).name, SCHOOL + ' - groups - ' + today + '.csv');
  // the teachers export is the file the teachers import reads
  const teachers = await download('[data-action="export-teachers"]');
  await choose('teachers', teachers.name, teachers.text);
  await page.waitForSelector('[data-panel="teachers"] [data-note="nothing"]');
  assert.match(await text('[data-panel="teachers"] [data-file="teachers"]'), /12 teachers already here are the same\./);
  await click('[data-panel="teachers"] [data-action="put-away"]');
  assert.equal(await undoOff(), 'true', 'an export changes nothing');
});

test('the two walk checks reach the Checks tab: the sample school\'s one late walk is a warning, and it goes when the walk does', async () => {
  await go(page, '#schedule/checks');
  await settled();
  const walk = '.sch-checks .sch-findings tr[data-finding="group-walk:' + DAY_A + ':5:gsample08a"]';
  assert.equal(await text(walk + ' td:nth-child(2)'), '8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day, and the passing time is 4 min.');
  assert.equal(await page.$eval(walk, (row) => row.dataset.severity), 'warning');
  assert.equal(await page.$eval('#inspector .sch-counts', (el) => el.dataset.warning), '1');
  assert.equal(await exists('.sch-checks [data-note="walks"]'), false, 'the tab no longer says walking times are not worked out');
  assert.equal(await page.evaluate(async () => (await globalThis.sv2.store.derived.results()).where), 'worker', 'and the figures came from the worker');

  // 8A stays in the Gym for Period 7: no walk, no warning; undo brings both back
  await page.evaluate(async (day) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    const group = store.project.groups.find((each) => each.id === 'gsample08a');
    store.apply(actions.setSlot, { groupId: group.id, dayTypeId: day, period: 6, slot: { ...group.days[day][5] } });
  }, DAY_A);
  await shows((selector) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector(selector) === null, walk);
  assert.equal(await page.$eval('#inspector .sch-counts', (el) => el.dataset.warning), '0');
  await click('#undo');
  await page.waitForSelector(walk);
  assert.equal(await page.$eval('#inspector .sch-counts', (el) => el.dataset.warning), '1');
});

test('the Checks tab prints the checks report from its own button', async () => {
  await go(page, '#schedule/checks');
  await settled();
  assert.equal(await text('#print-checks'), 'Print the checks report');
  assert.equal(await page.$eval('#print-checks', (el) => el.getAttribute('aria-disabled')), null, 'it is a real button now');
  await click('#print-checks');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  assert.match(await page.$eval('#print-preview iframe', (frame) => frame.contentDocument.title), /^Checks report/);
  await page.keyboard.press('Escape');
  await shows(() => document.getElementById('print-preview') === null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'print-checks', 'focus goes back to the button');
});
