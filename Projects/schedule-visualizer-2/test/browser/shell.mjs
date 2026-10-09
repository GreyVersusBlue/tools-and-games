// The shell, in a real browser: node test/browser/shell.mjs
//
// Opens the planner and uses it the way a person would: the rail by click and
// by shortcut, the school name, undo and redo, the toast, the theme, Help, the
// Getting started card, the settings and the sample school. Assertions are on
// what the page shows; the store is read only where the page has nothing to
// show (a number of seconds behind a field that displays minutes).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, waitForSection } from './harness.mjs';

const SECTIONS = [
  ['building', 'Building', '1', 'This is the building.'],
  ['schedule', 'Schedule', '2', 'This is the schedule.'],
  ['movement', 'Movement', '3', 'This is the movement view.'],
  ['scenarios', 'Scenarios', '4', 'This is the scenario lab.'],
  ['safety', 'Safety', '5', 'This is the safety section.'],
  ['staff', 'Staff browser', '6', 'This is the staff browser.'],
  ['project', 'Project', '7', 'This is the project.'],
];
const SAMPLE_NAME = 'Marrowby Middle School (sample)';
const PAPER = 'rgb(246, 243, 236)';
const DARK_PAPER = 'rgb(21, 24, 28)';

let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = (selector) => page.$(selector).then((found) => found !== null);
const sectionShown = () => page.$eval('.surface__layout', (el) => el.dataset.section);
const schoolShown = () => text('#school-name .school__text');
const toastText = () => text('.toast .toast__text');
const storeSettings = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.settings)));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function chord(modifiers, key) {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  for (const modifier of modifiers.slice().reverse()) await page.keyboard.up(modifier);
}

// Put the cursor in a settings field with everything in it selected.
async function intoField(name) {
  await page.click('#settings input[name="' + name + '"]', { clickCount: 3 });
}

async function blurAll() {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
}

before(async () => {
  session = await openPlanner({ theme: 'light' });
  page = session.page;
});

after(async () => {
  if (session) await session.close();
});

test('the page loads with no error, on Building, with the sample school', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.equal(await sectionShown(), 'building');
  assert.equal(await text('#surface h1'), 'This is the building.');
  assert.equal(await schoolShown(), SAMPLE_NAME);
  assert.equal(await page.$eval('#sample-chip', (el) => el.hidden), false, 'the sample is labelled as a sample');
  assert.equal(await page.$eval('#save-indicator', (el) => el.dataset.state), 'off');
  assert.equal(await page.$$eval('h1', (all) => all.length), 1, 'one headline a screen');
});

test('the rail has the seven sections in order, each with its shortcut', async () => {
  const links = await page.$$eval('#rail .rail__item', (all) => all.map((a) => [a.dataset.section, a.getAttribute('href'), a.getAttribute('aria-keyshortcuts'), a.querySelector('.rail__key').textContent]));
  assert.deepEqual(links, SECTIONS.map(([id, , key]) => [id, '#' + id, key, key]));
});

test('every section opens by a click on the rail and shows its sentence', async () => {
  for (const [id, name, , headline] of SECTIONS.slice().reverse()) {
    await page.click('#rail .rail__item[data-section="' + id + '"]');
    await waitForSection(page, id);
    assert.equal(await text('#surface h1'), headline);
    assert.equal(await page.evaluate(() => location.hash), '#' + id);
    assert.equal(await page.$eval('#surface', (el) => el.getAttribute('aria-label')), name);
    assert.equal(await page.title(), name + ' · ' + SAMPLE_NAME + ' · Schedule Visualizer 2');
    assert.ok((await text('#surface .intro__first')).length > 40, id + ' says what to do first');
    assert.equal(await page.$$eval('#rail [aria-current="page"]', (all) => all.length), 1);
  }
});

test('every section opens by its digit, 1 to 7', async () => {
  await blurAll();
  for (const [id, , key, headline] of SECTIONS.slice().reverse()) {
    await page.keyboard.press(key);
    await waitForSection(page, id);
    assert.equal(await text('#surface h1'), headline);
  }
});

test('Back and Forward move between sections', async () => {
  await go(page, '#safety');
  await go(page, '#staff');
  await page.goBack();
  await waitForSection(page, 'safety');
  await page.goForward();
  await waitForSection(page, 'staff');
});

test('an address that names no section opens Building', async () => {
  await page.evaluate(() => {
    location.hash = '#nowhere/at/all';
  });
  await waitForSection(page, 'building');
  assert.equal(await page.evaluate(() => location.hash), '#building');
});

test('the schedule sub-tabs have addresses, and the arrow keys move between them', async () => {
  await go(page, '#schedule/teachers');
  assert.equal(await text('#surface [role="tab"][aria-selected="true"]'), 'Teachers');
  assert.match(await text('#surface [role="tabpanel"]'), /A teacher is a named member of staff/);
  await page.click('#surface [role="tab"][data-tab="day"]');
  assert.equal(await page.evaluate(() => location.hash), '#schedule/day');
  assert.match(await text('#surface [role="tabpanel"]'), /The day is 8 periods long/);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => location.hash), '#schedule/checks');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'checks');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => location.hash), '#schedule/groups');
  assert.equal(await page.$$eval('#surface [role="tab"][tabindex="0"]', (all) => all.length), 1, 'one Tab stop in the tab list');
});

test('the school name is edited in place, and a digit typed into it does not switch sections', async () => {
  await go(page, '#building');
  await page.click('#school-name');
  await page.waitForSelector('#school-name-field');
  assert.equal(await page.$eval('#school-name-field', (el) => el.value), SAMPLE_NAME);
  // 7 is Project's shortcut and 2 is Schedule's; `/` and `?` are shortcuts too
  const typed = '7 Oaks <b>Academy</b> 2 / "Ünïon"?';
  await page.keyboard.type(typed);
  await pause(200);
  assert.equal(await sectionShown(), 'building', 'a digit typed into the school-name field switched sections');
  assert.equal(await exists('dialog[open]'), false, '? typed into a field opened Help');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'school-name-field', '/ typed into a field moved focus to search');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#school-name-field', { hidden: true });
  assert.equal(await schoolShown(), typed, 'the name is not shown exactly as typed: it is text, never markup');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'school-name', 'focus is back on the name');
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Undo: Change the school name');
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-disabled')), 'false');
  assert.equal(await page.title(), 'Building · ' + typed + ' · Schedule Visualizer 2');
});

test('Undo from the button puts the name back and says so in a toast with Show', async () => {
  await page.click('#undo');
  assert.equal(await schoolShown(), SAMPLE_NAME);
  assert.equal(await toastText(), 'Undid: Change the school name');
  assert.equal(await page.$eval('.toast', (el) => el.parentElement.getAttribute('role')), 'status');
  assert.equal(await text('.toast .toast__action'), 'Show');
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Nothing to undo');
  assert.equal(await page.$eval('#redo', (el) => el.getAttribute('aria-label')), 'Redo: Change the school name');
  assert.equal(await sectionShown(), 'building', 'undo does not jump to another section');
});

test('F6 walks the regions and reaches the toast; Show goes to where the change was', async () => {
  await blurAll();
  const seen = [];
  // Building has an inspector (SV2-06), which comes before the toast
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('F6');
    seen.push(await page.evaluate(() => (document.activeElement.closest('#toasts') ? 'toast:' + document.activeElement.textContent : document.activeElement.id)));
  }
  assert.deepEqual(seen, ['rail', 'topbar', 'surface', 'inspector', 'toast:Show']);
  await chord(['Shift'], 'F6');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inspector', 'Shift+F6 goes back');
  await page.keyboard.press('F6');
  await page.keyboard.press('Enter');
  await waitForSection(page, 'project');
  assert.equal(await exists('.toast'), false, 'using the action closes the toast');
});

test('Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo from the keyboard', async () => {
  await go(page, '#building');
  await blurAll();
  await chord(['Control', 'Shift'], 'z');
  assert.match(await schoolShown(), /^7 Oaks/);
  assert.equal(await toastText(), 'Redid: Change the school name');
  await chord(['Control'], 'z');
  assert.equal(await schoolShown(), SAMPLE_NAME);
  assert.equal(await toastText(), 'Undid: Change the school name');
  await chord(['Control'], 'y');
  assert.match(await schoolShown(), /^7 Oaks/);
  await chord(['Control'], 'z');
  assert.equal(await schoolShown(), SAMPLE_NAME);
  await chord(['Control'], 'z');
  assert.equal(await toastText(), 'There is nothing to undo.');
});

test('inside a text field Ctrl+Z belongs to the field, not to the project', async () => {
  await chord(['Control', 'Shift'], 'z');
  assert.match(await schoolShown(), /^7 Oaks/);
  await page.click('#search');
  await page.keyboard.type('abc');
  await chord(['Control'], 'z');
  assert.match(await schoolShown(), /^7 Oaks/, 'Ctrl+Z in the search box undid a change to the project');
  assert.notEqual(await page.$eval('#search', (el) => el.value), 'abc', 'the field did not get its own undo');
  await page.$eval('#search', (el) => {
    el.value = '';
    el.blur();
  });
  await chord(['Control'], 'z');
  assert.equal(await schoolShown(), SAMPLE_NAME);
});

test('/ and Ctrl+F go to the search box', async () => {
  await blurAll();
  // axe takes a placeholder for a name; a placeholder goes away when you type
  assert.equal(await page.$eval('#search', (el) => el.getAttribute('aria-label')), 'Search rooms, teachers and groups', 'the search box has no name of its own');
  assert.equal(await page.$eval('#search', (el) => el.closest('[role="search"]') !== null), true);
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  assert.equal(await page.$eval('#search', (el) => el.value), '', 'the / itself is not typed');
  await blurAll();
  await chord(['Control'], 'f');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  await blurAll();
});

test('a toast stays while the pointer is on it and goes six seconds after', async () => {
  assert.equal(await page.evaluate(() => import('./ui/components/toast.js').then((m) => m.TOAST_MS)), 6000);
  await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'A short one.', duration: 300 }));
  await page.hover('.toast .toast__text');
  await pause(700);
  assert.equal(await exists('.toast'), true, 'the toast left while the pointer was on it');
  await page.mouse.move(640, 300);
  await pause(600);
  assert.equal(await exists('.toast'), false, 'the toast stayed after the pointer left');
  await page.evaluate(() => {
    globalThis.sv2.ctx.toast({ text: 'First.' });
    globalThis.sv2.ctx.toast({ text: 'Second.' });
  });
  assert.deepEqual(await page.$$eval('.toast .toast__text', (all) => all.map((el) => el.textContent)), ['Second.'], 'one toast at a time');
  await page.click('.toast .toast__close');
  assert.equal(await exists('.toast'), false);
});

test('the theme switch is a menu; Dark changes the colours and is remembered on the device', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'auto');
  assert.equal(await paper(), PAPER);
  await page.click('#theme');
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await page.$$eval('.menu [role="menuitemradio"]', (all) => all.map((el) => [el.textContent, el.getAttribute('aria-checked')])),
    [['●Follow the device', 'true'], ['Light', 'false'], ['Dark', 'false']]);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '●Follow the device', 'focus starts on the chosen item');
  assert.equal(await page.$eval('#theme', (el) => el.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Dark', 'the arrow keys wrap');
  await page.keyboard.press('Escape');
  assert.equal(await exists('.menu'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'theme', 'Escape returns focus to the button');
  await page.click('#theme');
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await paper(), DARK_PAPER);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#topbar')).backgroundColor), 'rgb(29, 33, 38)');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')).theme), 'dark');
  assert.equal(await page.$eval('#theme', (el) => el.getAttribute('aria-label')), 'Theme: Dark');
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Undo: Change the theme', 'a setting is an undo step');
});

test('the remembered theme is on the page before the project loads, and Follow the device follows it', async () => {
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('readystatechange', () => {
      if (!globalThis.themeAtFirstLook) globalThis.themeAtFirstLook = document.documentElement.dataset.theme + ' ' + String(globalThis.sv2 === undefined);
    });
  });
  await page.reload({ waitUntil: 'load' });
  await waitForSection(page, 'building');
  assert.equal(await page.evaluate(() => globalThis.themeAtFirstLook), 'dark true', 'the theme was not set before the shell ran');
  assert.equal(await paper(), DARK_PAPER);
  assert.equal((await storeSettings()).theme, 'dark');
  await page.click('#theme');
  await page.click('.menu [role="menuitemradio"]:nth-of-type(2)');
  assert.equal(await paper(), PAPER);
  await page.click('#theme');
  await page.click('.menu [role="menuitemradio"]:nth-of-type(1)');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'auto');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  assert.equal(await paper(), DARK_PAPER, 'auto did not follow a dark device');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  assert.equal(await paper(), PAPER);
});

test('Help lists every shortcut, holds focus, ignores shortcuts behind it, and gives focus back', async () => {
  await page.click('#help');
  await page.waitForSelector('#help-dialog[open]');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close help', 'the safe button is last and focused');
  // axe has no rule for the name of a native <dialog>, so it is checked here
  assert.equal(await page.$eval('#help-dialog', (el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), 'These are the keyboard shortcuts.', 'the dialog is not named by its title');
  assert.equal(await page.$eval('#help-dialog .dialog__buttons button:last-child', (el) => el.textContent), 'Close help');
  const listed = await page.$$eval('#help-dialog tbody tr', (rows) => rows.map((row) => row.dataset.key));
  const registered = await page.evaluate(() => globalThis.sv2.shortcuts.list().map((entry) => entry.id));
  assert.deepEqual(listed, registered);
  for (const id of ['section-building', 'section-project', 'undo', 'redo', 'redo-y', 'search', 'search-slash', 'help', 'regions']) assert.ok(listed.includes(id), 'Help does not list ' + id);
  assert.deepEqual(await page.$$eval('#help-dialog tbody tr', (rows) => rows.slice(0, 7).map((row) => row.cells[0].textContent)), ['1', '2', '3', '4', '5', '6', '7']);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('dialog') !== null), true, 'Tab left the dialog');
  }
  await page.keyboard.press('3');
  // a section change arrives a moment after the key, so give it the moment
  await pause(200);
  assert.equal(await sectionShown(), 'building', 'a shortcut fired behind an open dialog');
  await page.click('#help-dialog th button');
  assert.equal(await page.$eval('#help-dialog th', (el) => el.getAttribute('aria-sort')), 'ascending');
  await page.click('#help-dialog th button');
  assert.equal(await page.$eval('#help-dialog th', (el) => el.getAttribute('aria-sort')), 'descending');
  assert.equal(await page.$eval('#help-dialog tbody tr', (row) => row.cells[0].textContent), 'Z', 'sorted from the end, the first row is the Leave out tool\'s key now that Help lists the plan\'s keys');
  await page.keyboard.press('Escape');
  assert.equal(await exists('#help-dialog'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'help', 'focus did not return to the opener');
  await blurAll();
  await page.keyboard.press('?');
  await page.waitForSelector('#help-dialog[open]');
  await page.keyboard.press('Enter');
  assert.equal(await exists('#help-dialog'), false);
});

test('Getting started has the five steps as links, ticks what the project has, hides and comes back', async () => {
  const steps = await page.$$eval('#getting-started .steps__step', (all) => all.map((li) => [li.dataset.step, li.querySelector('a').getAttribute('href'), li.dataset.done]));
  assert.deepEqual(steps, [
    ['floor', '#building', 'true'],
    ['rooms', '#building', 'true'],
    ['teachers', '#schedule/teachers', 'true'],
    ['groups', '#schedule/groups', 'true'],
    ['movement', '#movement', 'true'], // SV2-17: the cases above opened the movement view, and it ticks its own step
  ]);
  assert.equal(await text('#getting-started .getting-started__tally'), 'All five are done.');
  await page.click('#getting-started .steps__step[data-step="teachers"] a');
  await waitForSection(page, 'schedule');
  assert.equal(await text('#surface [role="tab"][aria-selected="true"]'), 'Teachers');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), false, 'the card is on every section');
  await page.click('#getting-started [data-action="dismiss"]');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), true);
  assert.equal(await toastText(), 'Getting started is hidden. Help brings it back.');
  await page.click('#help');
  await page.waitForSelector('#help-dialog[open]');
  await page.click('#help-dialog .dialog__buttons button:first-child');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), false, 'Help did not bring the card back');
  await page.click('#getting-started [data-action="never"]');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.onboarding.neverShow), true);
  await go(page, '#project');
  await page.click('#about [data-action="show-getting-started"]');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), false);
});

test('the Project section shows the sample school in figures and every setting with its one line', async () => {
  await go(page, '#project');
  const figures = Object.fromEntries(await page.$$eval('.figures__item', (all) => all.map((el) => [el.dataset.figure, el.querySelector('dd').textContent])));
  assert.deepEqual(figures, { floors: '3', rooms: '13', teachers: '12', groups: '8', subjects: '9', dayTypes: '2', exits: '2' });
  const rows = await page.$$eval('#settings .setting', (all) => all.map((row) => [row.querySelector('.setting__label').textContent, row.querySelector('.setting__hint').textContent.length]));
  assert.deepEqual(rows.map((row) => row[0]), [
    'School name', 'Periods per day', 'Period word', 'Day types', 'Bell schedules', 'Default passing time', 'Calendar', 'Subjects',
    'Default head count', 'Seconds per corridor cell', 'Seconds per stair connection', 'Cell scale', 'Colour scale', 'Absolute bands',
    'Consecutive-periods limit', 'Passing margin', 'Checks switched off',
    'Time format', 'Paper size', 'Paper orientation', 'Theme', 'North direction',
  ]);
  for (const [label, length] of rows) assert.ok(length > 20, label + ' has no one-line explanation');
  // every control is tied to its name and its explanation
  const untied = await page.$$eval('#settings .setting__control input, #settings .setting__control [role="radiogroup"]', (all) => all
    .filter((el) => el.type !== 'radio')
    .filter((el) => !document.getElementById((el.getAttribute('aria-labelledby') || '').split(' ')[0]) || !document.getElementById((el.getAttribute('aria-describedby') || '').split(' ')[0]))
    .map((el) => el.name || el.className));
  assert.deepEqual(untied, []);
  assert.equal(await page.$$eval('#settings button', (all) => all.filter((button) => /save/i.test(button.textContent)).length), 0, 'no Save buttons');
});

test('a setting commits on Enter and on leaving the field, and each is one undo step', async () => {
  await intoField('defaultPassingSeconds');
  await page.keyboard.type('4:30');
  await page.keyboard.press('Enter');
  assert.equal((await storeSettings()).defaultPassingSeconds, 270);
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Undo: Change the default passing time');
  await intoField('defaultHeadCount');
  await page.keyboard.type('31');
  await page.keyboard.press('Tab');
  assert.equal((await storeSettings()).defaultHeadCount, 31, 'leaving the field did not commit it');
  await page.click('#undo');
  assert.equal(await page.$eval('#settings input[name="defaultHeadCount"]', (el) => el.value), '25', 'undo did not show in the field');
  await page.click('#undo');
  assert.equal(await page.$eval('#settings input[name="defaultPassingSeconds"]', (el) => el.value), '4');
  assert.equal(await toastText(), 'Undid: Change the default passing time');
});

test('a refusal says what was wrong under the field, and Escape puts the old value back', async () => {
  await intoField('secondsPerCell');
  await page.keyboard.type('99');
  await page.keyboard.press('Enter');
  const refusal = '#settings .setting__control:has(input[name="secondsPerCell"]) .field__refusal';
  assert.equal(await text(refusal), 'Seconds per corridor cell is a whole number from 1 to 10.');
  assert.equal(await page.$eval('#settings input[name="secondsPerCell"]', (el) => el.getAttribute('aria-invalid')), 'true');
  assert.ok((await page.$eval('#settings input[name="secondsPerCell"]', (el) => el.getAttribute('aria-describedby'))).includes(await page.$eval(refusal, (el) => el.id)), 'the refusal is not tied to the field');
  assert.equal(await page.$eval('#settings input[name="secondsPerCell"]', (el) => el.value), '99', 'what was typed is kept so it can be fixed');
  assert.equal((await storeSettings()).secondsPerCell, 3);
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  assert.match(await text(refusal), /is a whole number\. "99x" is not one\./);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#settings input[name="secondsPerCell"]', (el) => el.value), '3');
  assert.equal(await page.$eval(refusal, (el) => el.hidden), true);
  assert.equal(await sectionShown(), 'project');
});

test('the period word changes every label that uses it', async () => {
  await page.click('#settings input[name="periodWord"][value="Mod"]');
  const labels = await page.$$eval('#settings .setting__label', (all) => all.map((el) => el.textContent));
  assert.ok(labels.includes('Mods per day') && !labels.includes('Periods per day'));
  await go(page, '#schedule/day');
  assert.match(await text('#surface [role="tabpanel"]'), /The day is 8 mods long/);
  await go(page, '#project');
  await page.click('#undo');
  assert.equal(await page.$eval('#settings input[name="periodWord"][value="Period"]', (el) => el.checked), true);
});

test('fewer periods asks first, with buttons that name the action and the safe one focused', async () => {
  await intoField('periods');
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog .dialog__title'), 'Remove Period 7 and Period 8 from every day?');
  assert.match(await text('dialog .dialog__body'), /^That takes away 32 room entries in 8 groups and 4 bell times\. Undo brings them back\.$/);
  assert.deepEqual(await page.$$eval('dialog .dialog__buttons button', (all) => all.map((el) => el.textContent)), ['Remove Period 7 and Period 8', 'Keep 8 periods']);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep 8 periods');
  await page.keyboard.press('Escape');
  assert.equal(await exists('dialog[open]'), false);
  assert.equal((await storeSettings()).periods, 8, 'Escape removed the periods');
  assert.equal(await page.$eval('#settings input[name="periods"]', (el) => el.value), '8');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'periods', 'focus did not return to the field that asked');
  await intoField('periods');
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.dialog[open]');
  await page.click('dialog .dialog__buttons button:first-child');
  assert.equal((await storeSettings()).periods, 6);
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Undo: Change periods per day to 6');
  await page.click('#undo');
  assert.equal((await storeSettings()).periods, 8);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups[0].days.dsample00a[7].room !== null), true, 'undo did not bring the removed periods back');
});

test('the picker narrows as you type; a check is switched off and back on', async () => {
  const input = '#settings .picker__input';
  await page.click(input);
  assert.equal(await page.$$eval('#settings .picker__option', (all) => all.length), 14);
  await page.keyboard.type('WALK');
  assert.deepEqual(await page.$$eval('#settings .picker__option', (all) => all.map((el) => el.textContent)), ['A teacher’s walk that is too long', 'A group’s walk that is too long']);
  assert.equal(await page.$eval(input, (el) => el.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval(input, (el) => document.getElementById(el.getAttribute('aria-activedescendant')).textContent), 'A group’s walk that is too long');
  await page.keyboard.press('Enter');
  assert.deepEqual((await storeSettings()).checks.off, ['group-walk']);
  assert.deepEqual(await page.$$eval('#settings .chip', (all) => all.map((el) => el.dataset.check)), ['group-walk']);
  assert.equal(await page.$eval(input, (el) => el.value), '');
  await page.keyboard.type('zzz');
  assert.equal(await text('#settings .picker__empty'), 'No check that is on matches.');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#settings .picker__list', (el) => el.hidden), true);
  assert.equal(await sectionShown(), 'project');
  await page.$eval(input, (el) => {
    el.value = '';
  });
  await page.click('#settings .chip__remove');
  assert.deepEqual((await storeSettings()).checks.off, []);
  assert.equal(await exists('#settings .chip'), false);
});

test('Reset to defaults resets settings only, and can be undone', async () => {
  await page.click('#settings input[name="timeFormat"][value="24h"]');
  await intoField('secondsPerStair');
  await page.keyboard.type('12');
  await page.keyboard.press('Enter');
  await page.click('#settings [data-action="reset-settings"]');
  assert.equal(await toastText(), 'Reset the settings to their defaults.');
  const reset = await storeSettings();
  assert.equal(reset.timeFormat, '12h');
  assert.equal(reset.secondsPerStair, 8);
  assert.equal(reset.schoolName, '', 'the school name is a setting and resets too');
  assert.equal(await schoolShown(), 'Schedule Visualizer 2', 'with no school name the tool shows its own');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups.length), 8, 'reset touched the schedule');
  await page.click('.toast .toast__action');
  const back = await storeSettings();
  assert.equal(back.timeFormat, '24h');
  assert.equal(back.secondsPerStair, 12);
  assert.equal(await schoolShown(), SAMPLE_NAME);
  await page.click('#settings [data-action="reset-settings"]');
  await page.click('#settings [data-action="reset-settings"]');
  assert.equal(await toastText(), 'The settings are already the defaults.');
  await page.click('#undo');
});

test('one click removes the sample school, one click loads it, and both can be undone', async () => {
  assert.equal(await text('#sample-school [data-action="sample"]'), 'Remove the sample school');
  assert.match(await text('#sample-school'), /It is invented: no real school, teacher or student is in it\./);
  await page.click('#sample-school [data-action="sample"]');
  assert.equal(await page.$eval('#sample-chip', (el) => el.hidden), true);
  assert.equal(await schoolShown(), 'Schedule Visualizer 2');
  assert.equal(await toastText(), 'Removed the sample school. This is an empty project.');
  assert.equal(await text('.figures__item[data-figure="rooms"] dd'), '0');
  assert.equal(await text('.figures__item[data-figure="subjects"] dd'), '10');
  assert.equal(await text('#getting-started .getting-started__tally'), '0 of 5 done.');
  assert.equal(await exists('dialog[open]'), false, 'removing the sample asked a question');
  await go(page, '#building');
  assert.match(await text('#surface .intro__facts'), /^Nothing is drawn yet\. Floor 1 is 40 × 30 squares\.$/);
  await page.click('#getting-started [data-action="load-sample"]');
  assert.equal(await exists('dialog[open]'), false, 'an empty project has nothing to lose, so no question');
  assert.equal(await schoolShown(), SAMPLE_NAME);
  assert.equal(await page.$eval('#sample-chip', (el) => el.hidden), false);
  await page.click('#undo');
  assert.equal(await toastText(), 'Undid: Load the sample school');
  assert.equal(await schoolShown(), 'Schedule Visualizer 2');
  await page.click('#redo');
  assert.equal(await schoolShown(), SAMPLE_NAME);
});

test('loading the sample over a project with work in it asks first', async () => {
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const { newProject } = await import('./engine/schema.js');
    const { createIds, seededRandom } = await import('./engine/ids.js');
    store.apply(actions.replaceProject, { project: newProject(createIds(seededRandom(7)), () => new Date('2026-09-01T12:00:00Z')), label: 'Start an empty project' });
    store.apply(actions.addTeacher, { name: 'Mx. <i>Quillfeather</i>' });
  });
  await go(page, '#project');
  assert.equal(await text('#sample-school [data-action="sample"]'), 'Load the sample school');
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog .dialog__title'), 'Replace this project with the sample school?');
  assert.deepEqual(await page.$$eval('dialog .dialog__buttons button', (all) => all.map((el) => el.textContent)), ['Replace my project with the sample school', 'Keep my project']);
  await page.keyboard.press('Enter');
  assert.equal(await text('.figures__item[data-figure="teachers"] dd'), '1', 'Keep my project replaced it');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'sample', 'focus did not return to the button');
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForSelector('dialog.dialog[open]');
  await page.click('dialog .dialog__buttons button:first-child');
  assert.equal(await text('.figures__item[data-figure="teachers"] dd'), '12');
});

test('a menu opens on right-click, on the Menu key and on a long-press, and not on a short or a moving one', async () => {
  await go(page, '#building');
  await page.evaluate(async () => {
    const { contextMenu } = await import('./ui/components/menu.js');
    const target = document.createElement('button');
    target.id = 'menu-target';
    target.textContent = 'A thing with a menu';
    document.querySelector('.surface__section').append(target);
    globalThis.picked = [];
    contextMenu(target, () => [
      { label: 'Rename', run: () => globalThis.picked.push('rename') },
      'separator',
      { label: 'Cannot do this', disabled: true, run: () => globalThis.picked.push('disabled') },
      { label: 'Delete', danger: true, run: () => globalThis.picked.push('delete') },
    ], 'A thing');
  });
  const press = (type, x, y) => page.$eval('#menu-target', (el, t, px, py) => {
    const box = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 5, bubbles: true, clientX: box.left + px, clientY: box.top + py }));
  }, type, x, y);

  await page.click('#menu-target', { button: 'right' });
  await page.waitForSelector('.menu[role="menu"]');
  assert.deepEqual(await page.$$eval('.menu [role="menuitem"]', (all) => all.map((el) => el.textContent)), ['Rename', 'Cannot do this', 'Delete']);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => globalThis.picked), ['delete']);
  assert.equal(await exists('.menu'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-target');

  await page.click('#menu-target', { button: 'right' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => globalThis.picked), ['delete'], 'a disabled item ran');
  await page.mouse.click(700, 500);
  assert.equal(await exists('.menu'), false, 'a click outside did not close the menu');

  await page.focus('#menu-target');
  await chord(['Shift'], 'F10');
  await page.waitForSelector('.menu[role="menu"]');
  await page.keyboard.press('Escape');

  await press('pointerdown', 10, 10);
  await pause(250);
  await press('pointerup', 10, 10);
  await pause(400);
  assert.equal(await exists('.menu'), false, 'a short touch opened the menu');

  await press('pointerdown', 10, 10);
  await pause(200);
  await press('pointermove', 30, 10);
  await pause(450);
  assert.equal(await exists('.menu'), false, 'a finger that moved 20 px opened the menu');
  await press('pointerup', 30, 10);

  await press('pointerdown', 10, 10);
  await press('pointermove', 14, 12);
  await pause(650);
  assert.equal(await exists('.menu'), true, 'a long-press did not open the menu');
  await press('pointerup', 14, 12);
  await page.keyboard.press('Escape');
  await page.$eval('#menu-target', (el) => el.remove());
});

test('under 900 px the rail is icons only, and under 640 px it is a bar along the bottom', async () => {
  const shape = () => page.evaluate(() => {
    const rail = document.getElementById('rail').getBoundingClientRect();
    const main = document.getElementById('surface').getBoundingClientRect();
    const label = document.querySelector('.rail__label').getBoundingClientRect();
    return { railBelowMain: rail.top >= main.bottom - 1, railLeftOfMain: rail.right <= main.left + 1, labelWidth: Math.round(label.width), railWidth: Math.round(rail.width) };
  });
  assert.deepEqual(await shape(), { railBelowMain: false, railLeftOfMain: true, labelWidth: await page.$eval('.rail__label', (el) => Math.round(el.getBoundingClientRect().width)), railWidth: 56 });
  assert.ok((await shape()).labelWidth > 20, 'the rail shows its words at full width');
  await page.setViewport({ width: 800, height: 900 });
  assert.equal((await shape()).labelWidth, 1, 'the rail still shows its words under 900 px');
  assert.equal((await shape()).railLeftOfMain, true);
  await page.setViewport({ width: 600, height: 900 });
  assert.equal((await shape()).railBelowMain, true, 'the rail is not along the bottom under 640 px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways at 600 px');
  await page.setViewport({ width: 1280, height: 900 });
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
