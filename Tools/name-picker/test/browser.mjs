// browser.mjs — the Name Picker in a real browser.
//
//   node Tools/name-picker/test/browser.mjs
//
// smoke.mjs covers np-store.js and np-pick.js directly, under plain Node. That is
// blind to the wiring: a button whose handler was never attached, an export that
// never triggers a real download, a corrupt-roster guard that only "works" against
// a hand-built store rather than the page's own boot sequence. `npm run tools` (in
// Tools/board-check) opens this page headless and checks title/offsite/console,
// but nothing drives it — no click, no export, no fairness assertion. This is that
// missing suite, scoped to this project's own test/ folder rather than board-check
// (which prompt 21 owns) — same pattern as Tools/seating-chart/test/drive-seating.mjs
// and Projects/integer-foundry/test/browser.mjs.
//
// Every beat below is transcribed from a real hands-on session, recorded in
// Recorded in HISTORY.md under the prompt rounds; what round 1 verified:
// export (hook createObjectURL, neuter the anchor click, read the exact bytes),
// import (a real file chooser, not a shortcut), fairness (read np_history off
// disk after real clicks), the corrupt-roster guard (seed a truncated np_rosters
// and confirm the page does not throw), and the erase flow (six keys gone, seven
// kept). Headless: none of this needs WebGL or pointer lock, and headless means
// it never fights `npm run games`/`play`/`previews` for the screen.
//
// Exits 1 on any failure. The exported backup and a couple of screenshots land in
// test/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage, settle } from '../../board-check/harness.mjs';
import { waitFor, textContent } from '../../board-check/drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const PORT = 8148; // see Tools/board-check/README and sibling test/ scripts for ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const URL_PAGE = BASE + '/Tools/Name%20Picker.html';
const ROSTER_NAME = 'Period 3 Honors';

fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const fails = [];
const ok = (cond, label) => {
  if (cond) { passed++; return true; }
  failed++; fails.push(label); console.log('  FAIL ' + label); return false;
};
const eq = (a, b, label) => ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Fabricated — same 28 names test/smoke.mjs uses, so this project's fixtures don't
// multiply. Nobody's real roster, ever (see the prompt's student-data section).
const CLASS_OF_28 = [
  'Aiden Alvarez', 'Brooklyn Bell', 'Camila Castro', 'Declan Doyle',
  'Elena Espinoza', 'Finn Fletcher', 'Grace Gallagher', 'Hassan Haddad',
  'Isabel Ibarra', 'Jonah Jennings', 'Kaia Kowalski', 'Liam Lindqvist',
  'Maya Mensah', 'Nolan Nakamura', 'Olivia Okonkwo', 'Priya Patel',
  'Quinn Quintero', 'Rosa Reyes', 'Silas Sandoval', 'Tessa Thornton',
  'Umar Usman', 'Violet Vance', 'Wyatt Whitfield', 'Ximena Xiong',
  'Yusuf Yilmaz', 'Zoe Zaman', 'Amara Adebayo', 'Bruno Baptiste',
];
const STUDENT_KEYS = ['np_rosters', 'np_current', 'np_lucky', 'np_stats', 'np_history', 'np_hof'];
const PREFS_KEYS = ['np_theme', 'np_prompts', 'np_options', 'np_lucky_enabled', 'np_retro_active', 'np_retro_unlocked'];

/**
 * Answer a real OS file chooser. `promptImport()` opens a bare `<input
 * type=file>` and clicks it, so this is the same picker a teacher restoring a
 * backup would see — not a shortcut around it. Puppeteer and Playwright expose
 * the chooser differently; see play-games.mjs's `setFiles` for the same split.
 */
async function chooseFile(page, filePath, trigger) {
  if (page.__engine === 'puppeteer') {
    const [chooser] = await Promise.all([page.waitForFileChooser(), trigger()]);
    await chooser.accept([filePath]);
    return;
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(filePath);
}

const localGet = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const readGroup = (page, keys) =>
  page.evaluate(ks => Object.fromEntries(ks.map(k => [k, localStorage.getItem(k)])), keys);

const server = await serve(PORT);
const browser = await launch();
let exportedPath = null;

/* ================================================================ main flow === */
{
  const page = await prepPage(browser, BASE, { width: 1280, height: 900, dsf: 1 });
  page.setDefaultTimeout(15000);
  // Every confirm()/alert() in this tool is a deliberate speed bump before an
  // erase, export or import — accept them all, and answer the one prompt()
  // (naming a saved roster) with a real name.
  page.on('dialog', d => (d.type() === 'prompt' ? d.accept(ROSTER_NAME) : d.accept()));

  await page.goto(URL_PAGE, { waitUntil: 'load' });
  await settle(page, 400);

  ok(!!(await page.title()), 'the page has a title');
  const tabs = await page.$$eval('.tab-buttons button', els => els.map(b => b.dataset.tab));
  eq(tabs.length, 8, 'all eight settings tabs are wired');
  eq(await textContent(page, '#countDisplay'), '', 'a first visit has no roster loaded');

  /* --------------------------------------------------------- load and save --- */
  await page.click('#settingsBtn');
  await page.fill('#namesInput', CLASS_OF_28.join('\n'));
  await page.click('#loadNames');
  eq(await textContent(page, '#countDisplay'), '28 names in pool', 'loading 28 names fills the pool');

  // loadNamesFromInput() closes the panel behind itself.
  await page.click('#settingsBtn');
  await page.click('#saveRoster');
  const rosterList = await textContent(page, '#rosterList');
  ok(rosterList.includes(ROSTER_NAME) && rosterList.includes('(28)'),
    `the saved roster shows up with its count (${rosterList.slice(0, 80)})`);

  /* -------------------------------------------------------------- fairness --- */
  await page.click('[data-tab="options"]');
  await page.fill('#multiPickCount', '7');
  await page.click('#closePanel');

  for (let i = 0; i < 4; i++) {
    await page.click('#pickBtn');
    await page.waitForSelector('#multiDone', { state: 'visible', timeout: 8000 });
    await page.click('#multiDone');
  }

  const today = new Date().toISOString().slice(0, 10);
  const [history, stats] = await Promise.all([
    page.evaluate(() => JSON.parse(localStorage.getItem('np_history') || '[]')),
    page.evaluate(() => JSON.parse(localStorage.getItem('np_stats') || '{}')),
  ]);
  eq(history.length, 28, 'four picks of seven cover a class of 28 exactly once');
  eq(new Set(history.map(h => h.name)).size, 28, 'every name in the history is distinct');
  const backToBack = history.some((h, i) => i > 0 && h.name === history[i - 1].name);
  ok(!backToBack, 'nobody was picked twice in a row across the four multi-picks');
  ok(history.every(h => h.date === today), 'every history entry is stamped with today\'s date');
  eq(Object.keys(stats).length, 28, 'every student has a tracked pick count');
  ok(Object.values(stats).every(v => v === 1), 'and each of them was picked exactly once');

  /* -------------------------------------------------------------- Data tab --- */
  await page.click('#settingsBtn');
  await page.click('[data-tab="data"]');
  await settle(page, 150);
  const census1 = await page.$$eval('#census .census-num', els => els.map(e => e.textContent));
  eq(census1.join(','), '1,28,28,28,0', 'census: 1 roster, 28 names, 28 tracked, 28 history, 0 hof');
  const rows = await page.$$eval('#keyTable tbody tr', els => els.length);
  eq(rows, 14, 'the key table lists all thirteen keys plus its header row');

  /* ---------------------------------------------------------------- export --- */
  await page.evaluate(() => {
    window.__npExports = [];
    window.__npDownloadNames = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { blob.text().then(txt => window.__npExports.push(txt)); return create(blob); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__npDownloadNames.push(this.download); return; }
      return click.call(this);
    };
  });
  await page.click('#exportRosters');
  await waitFor(page, () => window.__npExports.length > 0, { timeout: 5000 });
  const [exportedText] = await page.evaluate(() => window.__npExports);
  const [downloadName] = await page.evaluate(() => window.__npDownloadNames);

  ok(/^name-picker-roster-backup-\d{4}-\d{2}-\d{2}\.json$/.test(downloadName),
    `the export is named for a roster backup, not the generic save name (${downloadName})`);
  ok(!/"__v"/.test(exportedText), 'no gvb-save version stamp leaks into the exported file');
  const env = JSON.parse(exportedText);
  eq(env.format, 'gvb-save', 'the export carries the shared envelope');
  eq(env.game, 'name-picker', "and this tool's slug");
  eq(env.version, 3, 'and the bundle version');
  eq(Object.keys(env.state).length, 13, 'and all thirteen keys');
  eq(env.state.np_rosters[ROSTER_NAME].length, 28, 'including the saved roster, in full');
  eq(Object.keys(env.state.np_stats).length, 28, 'and every tracked pick count');
  eq(env.state.np_history.length, 28, 'and the full pick history');

  exportedPath = path.join(SHOTS, 'export.json');
  fs.writeFileSync(exportedPath, exportedText);

  /* ----------------------------------------------------------------- erase --- */
  await page.click('#settingsBtn');
  await page.click('[data-tab="data"]');
  const prefsBefore = await readGroup(page, PREFS_KEYS);

  await page.click('#eraseStudentData');
  await settle(page, 200);

  const wiped = await readGroup(page, STUDENT_KEYS);
  ok(Object.values(wiped).every(v => v === null), 'all six student-data keys are gone after the erase');
  const prefsAfter = await readGroup(page, PREFS_KEYS);
  for (const k of PREFS_KEYS) eq(prefsAfter[k], prefsBefore[k], `${k} survives a student-data erase unchanged`);
  eq(await page.inputValue('#namesInput'), '', 'the names box is cleared too');
  eq(await textContent(page, '#countDisplay'), '', 'the board comes back empty');

  /* ---------------------------------------------------------------- import --- */
  await chooseFile(page, exportedPath, () => page.click('#importRostersBtn'));
  await settle(page, 300);

  const rosterListAfterImport = await textContent(page, '#rosterList');
  ok(rosterListAfterImport.includes(ROSTER_NAME) && rosterListAfterImport.includes('(28)'),
    'the imported roster is back immediately, before any reload');
  const census2 = await page.$$eval('#census .census-num', els => els.map(e => e.textContent));
  eq(census2.join(','), '1,28,28,28,0', 'the census reflects the restored roster, stats and history');

  // The tool itself has to pick the restored data up, not just localStorage.
  await page.reload({ waitUntil: 'load' });
  await settle(page, 400);
  eq(await textContent(page, '#countDisplay'), '28 names in pool', 'a reload restores the on-screen roster');
  const namesBack = (await page.inputValue('#namesInput')).split('\n');
  eq(namesBack.length, 28, 'all 28 names came back into the input');
  const rosterListFinal = await textContent(page, '#rosterList');
  ok(rosterListFinal.includes(ROSTER_NAME), 'the saved roster is still there after the reload');

  await page.screenshot({ path: path.join(SHOTS, 'after-import.png') });

  const errs = page.__errs.filter(e => !/favicon/.test(e));
  eq(errs.length, 0, 'no page or console errors across the whole run' + (errs.length ? ':\n       ' + errs.join('\n       ') : ''));
  const offsite = [...new Set(page.__blocked)];
  eq(offsite.length, 0, 'no offsite requests' + (offsite.length ? ': ' + offsite.join(', ') : ''));
  await page.close();
}

/* ===================================================== corrupt-roster guard === */
// Round 1's own bug, put back on purpose (locked decision #34) rather than
// trusted from memory: a truncated np_rosters used to take updateRosterUI() down
// mid-function, which meant everything after it — including #countDisplay — never
// ran, even though np_current (a different key) was perfectly readable.
{
  const page = await prepPage(browser, BASE, { width: 1280, height: 900, dsf: 1 });
  await page.goto(URL_PAGE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('np_current', JSON.stringify(['Alpha Alvarez', 'Beta Bravo', 'Gamma Castro']));
    localStorage.setItem('np_rosters', '{"Period 3":["Aiden Alvarez"');   // truncated mid-array
  });
  await page.reload({ waitUntil: 'load' });
  await settle(page, 300);

  eq(await textContent(page, '#countDisplay'), '3 names in pool',
    'a corrupt np_rosters does not stop np_current from loading');
  ok((await textContent(page, '#rosterList')).includes('No saved rosters yet'),
    'the corrupt roster blob is dropped rather than crashing the whole set');
  const errs = page.__errs.filter(e => !/favicon/.test(e));
  eq(errs.length, 0, 'no page errors from the corrupt roster' + (errs.length ? ':\n       ' + errs.join('\n       ') : ''));
  await page.close();
}

/* ================================================ non-array roster entry === */
// A second, distinct failure round 1 found in the same function: this one is
// valid JSON — gvb-save's load() has nothing to catch — so the only thing
// standing between this and a crash is np-store.js's own repair. loadRosterByName
// used to do `rosters[name].join('\n')`; a roster whose value is a number throws
// there. One bad entry should be dropped, and a good entry beside it survives.
{
  const page = await prepPage(browser, BASE, { width: 1280, height: 900, dsf: 1 });
  await page.goto(URL_PAGE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('np_rosters', JSON.stringify({ 'Period 3': 42, 'Period 5': ['Real Reyes', 'Sam Sandoval'] }));
  });
  await page.reload({ waitUntil: 'load' });
  await settle(page, 300);

  const rosterList = await textContent(page, '#rosterList');
  ok(rosterList.includes('Period 5') && rosterList.includes('(2)'),
    `the good roster survives (${rosterList.slice(0, 80)})`);
  ok(!rosterList.includes('Period 3'), 'the non-array roster entry is dropped rather than crashing the whole set');
  const errs = page.__errs.filter(e => !/favicon/.test(e));
  eq(errs.length, 0, 'no page errors from the non-array roster entry' + (errs.length ? ':\n       ' + errs.join('\n       ') : ''));
  await page.close();
}

/* ========================================================== two rosters === */
// np_rosters handles more than one saved roster structurally, but neither round
// 1 nor round 2's browser suite exercised switching between two of them — both
// left it on their own "if session left over" list. Two classes, saved under
// two names, switched back and forth, one deleted: the other must come out
// unscathed, not silently merged or corrupted.
{
  const page = await prepPage(browser, BASE, { width: 1280, height: 900, dsf: 1 });
  const rosterNames = ['Period 3', 'Period 5'];
  let promptIdx = 0;
  page.on('dialog', d => (d.type() === 'prompt' ? d.accept(rosterNames[promptIdx++]) : d.accept()));
  await page.goto(URL_PAGE, { waitUntil: 'load' });
  await settle(page, 400);

  const CLASS_A = CLASS_OF_28.slice(0, 14);
  const CLASS_B = CLASS_OF_28.slice(14);

  await page.click('#settingsBtn');
  await page.fill('#namesInput', CLASS_A.join('\n'));
  await page.click('#loadNames');           // closes the panel behind itself
  await page.click('#settingsBtn');
  await page.click('#saveRoster');          // prompt() answered with "Period 3"

  await page.fill('#namesInput', CLASS_B.join('\n'));
  await page.click('#loadNames');
  await page.click('#settingsBtn');
  await page.click('#saveRoster');          // prompt() answered with "Period 5"

  let rosterList = await textContent(page, '#rosterList');
  ok(rosterList.includes('Period 3') && rosterList.includes('(14)'), 'Period 3 is saved with its own count');
  ok(rosterList.includes('Period 5') && rosterList.includes('(14)'), 'Period 5 is saved beside it with its own count');

  await page.click('[data-load="Period 3"]');
  await settle(page, 150);
  eq(await textContent(page, '#countDisplay'), '14 names in pool', 'loading Period 3 shows only its 14, not both classes combined');
  let namesNow = (await page.inputValue('#namesInput')).split('\n');
  eq(namesNow.length, 14, 'the names box holds exactly Period 3 after the switch');
  ok(namesNow.includes(CLASS_A[0]) && !namesNow.includes(CLASS_B[0]), 'Period 3 is really loaded, not Period 5 left over from the save above');

  await page.click('#settingsBtn');
  await page.click('[data-load="Period 5"]');
  await settle(page, 150);
  eq(await textContent(page, '#countDisplay'), '14 names in pool', 'switching to Period 5 shows only its 14');
  namesNow = (await page.inputValue('#namesInput')).split('\n');
  ok(namesNow.includes(CLASS_B[0]) && !namesNow.includes(CLASS_A[0]), 'Period 5 is really loaded, not Period 3 left over from the switch');

  await page.click('#settingsBtn');
  await page.click('[data-delete="Period 3"]');   // confirm() accepted by the generic dialog handler
  await settle(page, 150);
  rosterList = await textContent(page, '#rosterList');
  ok(!rosterList.includes('Period 3'), 'Period 3 is gone after its own delete');
  ok(rosterList.includes('Period 5') && rosterList.includes('(14)'), "Period 5 survives the other roster's delete with its full count");

  const errs = page.__errs.filter(e => !/favicon/.test(e));
  eq(errs.length, 0, 'no page errors across the two-roster switch' + (errs.length ? ':\n       ' + errs.join('\n       ') : ''));
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${passed} checks, ${failed} failed`);
if (failed) {
  console.log('\nfailures:\n  ' + fails.join('\n  '));
  process.exit(1);
}
