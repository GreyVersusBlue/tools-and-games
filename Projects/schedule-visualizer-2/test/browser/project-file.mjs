// The Project file card, in a real browser: node test/browser/project-file.mjs
//
// A project that has been worked on is exported to a file, the project is
// cleared, and the file is imported: the tool asks first, takes a recovery
// point, says what it read, and a second export is the same project. Then
// the files that must be refused whole, and the building alone out and back
// in. Assertions are on what the page shows; a download is read by standing
// in for the click that would save it.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch } from './harness.mjs';

const SCHOOL = 'Tidewater <b>Academy</b> & "Annex" 学校';

let server;
let browser;
let session;
let page;
let exported;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const figure = (name) => text('.figures__item[data-figure="' + name + '"] dd');
const result = () => page.$eval('#project-file [data-line="result"]', (el) => (el.hidden ? null : [el.dataset.result, el.querySelector('p').textContent, Array.from(el.querySelectorAll('li')).map((li) => li.textContent)]));
const undoOff = () => page.$eval('#undo', (el) => el.getAttribute('aria-disabled'));
const dialogTitle = () => text('dialog.dialog[open] .dialog__title');

async function click(selector) {
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.click(selector);
}

// Choose a file, as the file picker would hand it over.
async function choose(kind, name, body) {
  await page.evaluate((which, fileName, contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="' + which + '"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], fileName));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, kind, name, body);
}

async function catchDownloads() {
  await page.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      const name = this.download;
      return fetch(this.href).then((response) => response.text()).then((body) => {
        globalThis.sv2test.downloads.push({ name, text: body });
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

// The buttons of the dialog on show, and which one has focus.
const dialogButtons = () => page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((button) => button.textContent + (button === document.activeElement ? ' (focused)' : '')));

async function answer(label) {
  await page.evaluate((wanted) => Array.from(document.querySelectorAll('dialog.dialog[open] .dialog__buttons button')).find((button) => button.textContent === wanted).click(), label);
  await shows(() => document.querySelector('dialog.dialog[open]') === null);
}

// Everything but the moment of the last change, which an import is.
function comparable(fileText) {
  const project = JSON.parse(fileText);
  delete project.modified;
  return project;
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#project', theme: 'light', width: 1400, height: 1000 });
  page = session.page;
  await catchDownloads();
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

test('the Project file card is on the Project page, after Saved on this device', async () => {
  assert.deepEqual(await page.$$eval('.page > .card .card__title', (all) => all.map((el) => el.textContent).slice(0, 3)), ['Saved on this device', 'Project file', 'Recovery points']);
  assert.deepEqual(await page.$$eval('#project-file .card__buttons > .btn', (all) => all.map((el) => el.textContent)),
    ['Export the project', 'Import a project file…', 'Export the building', 'Import a building file…', 'Export the schedule', 'Import a schedule file…']);
  assert.equal(await page.$eval('#project-file [data-action="import-schedule"]', (el) => el.getAttribute('href')), '#schedule/import');
  assert.equal(await result(), null);
});

test('a project that has been worked on is exported as one file named with the school and the date', async () => {
  // the work: a school name with markup in it, a group gone, an accepted finding
  await page.evaluate(async (name) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    store.apply(actions.setSetting, { key: 'schoolName', value: name });
    store.apply(actions.deleteGroup, { id: 'gsample08b' });
    store.apply(actions.editTeacher, { id: store.project.teachers[0].id, notes: 'Mornings only' });
  }, SCHOOL);
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '7');
  assert.equal(await page.$eval('#saved [data-line="exported"]', (el) => el.dataset.exported), 'false');

  exported = await download('#project-file [data-action="export-project"]');
  assert.match(exported.name, /^Tidewater b Academy b & Annex 学校 - project - \d{4}-\d{2}-\d{2}\.json$/, 'the characters a file system refuses are left out of the file\'s name');
  const project = JSON.parse(exported.text);
  assert.deepEqual([project.format, project.version, project.settings.schoolName, project.groups.length, project.teachers[0].notes], ['sv2-project', 1, SCHOOL, 7, 'Mornings only']);
  assert.deepEqual(await result(), ['done', 'Saved “' + exported.name + '” to your downloads.', []]);
  // the Saved card knows a file has been written
  await shows(() => document.querySelector('#saved [data-line="exported"]').dataset.exported === 'true');
});

test('importing over a project asks first, with buttons that name the action and the safe one focused; Keep changes nothing', async () => {
  // clear: the sample is removed, which leaves an empty project
  await click('#sample-school [data-action="sample"]');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '0');
  assert.equal(await figure('rooms'), '0');

  await choose('project', 'tidewater.json', exported.text);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await dialogTitle(), 'Replace this project with the one in “tidewater.json”?');
  assert.deepEqual(await page.$$eval('dialog.dialog[open] .dialog__body p', (all) => all.map((el) => el.textContent)), [
    'The file is ' + SCHOOL + '. It holds 3 floors, 13 rooms, 12 teachers, 7 groups, 9 subjects and 2 day types.',
    'It takes the place of everything in this project: 1 floor, no rooms, no teachers, no groups, 10 subjects and 2 day types.',
    'A recovery point of this project is taken first, and Undo brings it back while this tab stays open.',
  ]);
  assert.deepEqual(await dialogButtons(), ['Replace this project', 'Keep this project (focused)']);
  assert.equal(await page.$$eval('dialog.dialog[open] img, dialog.dialog[open] b', (all) => all.length), 0, 'the school\'s name is text');
  await answer('Keep this project');
  assert.deepEqual(await result(), ['done', '“tidewater.json” was read and not imported. Nothing has changed.', []]);
  assert.equal(await figure('groups'), '0');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'import-project', 'focus is back on the button');
});

test('Replace takes a recovery point, puts the file in place as one step, and says what was read', async () => {
  const before = await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints()).length);
  await choose('project', 'tidewater.json', exported.text);
  await page.waitForSelector('dialog.dialog[open]');
  await answer('Replace this project');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '7');
  assert.deepEqual(await result(), ['done', 'Imported “tidewater.json”: 3 floors, 13 rooms, 12 teachers, 7 groups, 9 subjects and 2 day types. Undo brings back the project that was here.', []]);
  assert.equal(await text('.toast .toast__text'), 'Imported the project file tidewater.json.');
  assert.equal(await page.$eval('#school-name', (el) => el.firstChild.textContent), SCHOOL);
  assert.equal(await page.$$eval('#school-name b, .intro b', (all) => all.length), 0);
  assert.deepEqual([await figure('floors'), await figure('rooms'), await figure('teachers'), await figure('subjects')], ['3', '13', '12', '9']);
  // the project that was replaced is the newest recovery point
  const points = await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints()).map((point) => [point.reason, point.summary.rooms, point.summary.groups]));
  assert.equal(points.length, before + 1);
  assert.deepEqual(points[0], ['import', 0, 0]);
});

test('exported again, it is the same project', async () => {
  const again = await download('#project-file [data-action="export-project"]');
  assert.equal(again.name, exported.name);
  assert.deepEqual(comparable(again.text), comparable(exported.text));
});

test('one undo brings back the project that was there', async () => {
  await click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '0');
  assert.equal(await text('.toast .toast__text'), 'Undid: Import the project file tidewater.json');
  await click('#redo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '7');
});

test('a file from a newer version, a file cut short and a file of another kind are refused whole, with no question asked', async () => {
  const newer = JSON.stringify({ ...JSON.parse(exported.text), version: 99 });
  await choose('project', 'newer.json', newer);
  await shows(() => document.querySelector('#project-file [data-line="result"]').dataset.result === 'refused');
  assert.deepEqual(await result(), ['refused', '“newer.json” was not imported, and nothing has changed. This file was made by a newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file saved in format 1.', []]);
  assert.equal(await page.$eval('#project-file [data-line="result"] p', (el) => el.getAttribute('role')), 'alert');
  assert.equal(await exists('dialog.dialog[open]'), false);

  await choose('project', 'cut.json', exported.text.slice(0, 2000));
  await shows(() => /cut\.json/.test(document.querySelector('#project-file [data-line="result"]').textContent));
  assert.match((await result())[1], /nothing has changed\. This file could not be read\. It is not a Schedule Visualizer 2 file, or it was cut short/);

  const building = await download('#project-file [data-action="export-building"]');
  assert.match(building.name, / - building - \d{4}-\d{2}-\d{2}\.json$/);
  await choose('project', building.name, building.text);
  await shows(() => /This is a building file/.test(document.querySelector('#project-file [data-line="result"]').textContent));
  assert.match((await result())[1], /This is a building file, not a project file\. It holds a building and no schedule: import it as a building\.$/);
  assert.equal(await exists('dialog.dialog[open]'), false);
  assert.equal(await figure('groups'), '7', 'none of them changed anything');
});

test('the building alone: exported, a room deleted, and imported again; the schedule goes back to the room by its number', async () => {
  const building = await download('#project-file [data-action="export-building"]');
  assert.equal(JSON.parse(building.text).format, 'sv2-building');
  // Room 203 leaves the building; the slots that named it keep its number
  await page.evaluate(async () => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    const floor = store.project.building.floors.find((each) => each.spaces.some((space) => space.number === '203'));
    store.apply(actions.deleteSpaces, { spaceIds: [floor.spaces.find((space) => space.number === '203').id] });
  });
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '12');

  await choose('building', 'old wing.json', building.text);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await dialogTitle(), 'Replace the building with the one in “old wing.json”?');
  assert.equal(await page.$eval('dialog.dialog[open] .dialog__body p', (el) => el.textContent), 'The file holds 3 floors and 13 rooms. It takes the place of the building here: 3 floors and 12 rooms.');
  assert.deepEqual(await dialogButtons(), ['Replace the building', 'Keep this building (focused)']);
  await answer('Replace the building');
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '13');
  const said = await result();
  assert.deepEqual(said.slice(0, 2), ['done', 'Imported “old wing.json”: 3 floors and 13 rooms. Undo brings back the building that was here.']);
  assert.equal(said[2].length, 1);
  assert.match(said[2][0], /^\d+ schedule slots went to the room with the same number\.$/);
  assert.equal(await figure('groups'), '7', 'the schedule stayed');
  assert.equal(await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints()).map((point) => point.reason)[0]), 'import', 'the building as it was is kept before the import');
  // one step
  await click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '12');
});

test('the schedule alone is exported from the card too, and its import is on the Schedule section\'s Import tab', async () => {
  const schedule = await download('#project-file [data-action="export-schedule"]');
  assert.match(schedule.name, / - schedule - \d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(JSON.parse(schedule.text).format, 'sv2-schedule');
  await click('#project-file [data-action="import-schedule"]');
  await page.waitForSelector('.imp [data-panel="schedule"]');
  assert.equal(await text('#surface [role="tab"][aria-selected="true"]'), 'Import');
  await go(page, '#project');
});
