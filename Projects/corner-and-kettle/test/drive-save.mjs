// drive-save.mjs — Corner & Kettle in a real browser, with real clicks.
//
//   node Projects/corner-and-kettle/test/drive-save.mjs
//
// The Node suite next door (smoke-save.mjs) drives the save schema directly and
// is blind to the wiring: whether the module script actually ran, whether the
// bar mounted, whether an import redraws the shop. That is what this is for.
// Every beat here is something that only breaks in a browser.
//
// Imports the shared harness from Tools/board-check read-only — same launch
// flags, so requestAnimationFrame keeps running in a window nobody is looking
// at (v7 §6). Without those flags the clock stalls and the progress bars on the
// Base and Milk stations never fire their callbacks, which reads exactly like a
// broken game.
//
// Exits non-zero on any missed beat (locked decision #13).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Outside the repo on purpose. Four of the files this writes are deliberately
// corrupt JSON, and `npm run check`'s integrity sweep parses every .json in the
// tree — a fixture in here reads as a broken unit and fails a clean repo.
const OUT = path.join(os.tmpdir(), 'corner-and-kettle-test');
// 8123 checks/shoot, 8124 play-castle, 8125 previews, 8126 games.
const PORT = 8131;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/corner-and-kettle/`;
const KEY = 'cornerKettleSave_v1';

const harness = path.resolve(HERE, '..', '..', '..', 'Tools', 'board-check', 'harness.mjs');
if (!fs.existsSync(harness)) {
  console.error(`Cannot find the shared harness at ${harness}`);
  process.exit(1);
}
const drive = path.resolve(HERE, '..', '..', '..', 'Tools', 'board-check', 'drive.mjs');
// Windows reads a bare C:\... import as URL scheme `c:` and refuses it (v7 §7).
const { serve, launch, prepPage } = await import(pathToFileURL(harness).href);
const { waitFor } = await import(pathToFileURL(drive).href);

/* ---------- harness ---------- */

let passed = 0;
const failures = [];
const t = {
  ok(cond, label, detail) {
    if (cond) { passed++; process.stdout.write(`  ok    ${label}${detail ? ` — ${detail}` : ''}\n`); return true; }
    failures.push(label + (detail ? ` — ${detail}` : ''));
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}\n`);
    return false;
  },
  section(name) { process.stdout.write(`\n${name}\n`); },
};
const wait = ms => new Promise(r => setTimeout(r, ms));
// `--a11y` runs section 15 alone, on its own page: the cues and the reduced-
// motion rules, about ten seconds instead of the whole file.
const ONLY_A11Y = process.argv.includes('--a11y');

/**
 * Click a control inside the chalkboard. The panel is a ~3,000 px scroll
 * container, so a row near the bottom sits far outside the viewport: a bare
 * page.click() on the Legacy section's buttons landed on nothing and reported
 * nothing, which is how section 14 first "passed" a purchase that never
 * happened. Scroll it into the middle of the panel first, then click it with
 * the real mouse, so hit-testing still applies.
 */
async function clickInChalkboard(page, selector) {
  await page.$eval(selector, el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await wait(150);
  await page.click(selector);
}

/** The blob on disk, parsed. Only for things a reload has to survive (#39). */
const savedState = p => p.evaluate(k => {
  const raw = localStorage.getItem(k);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}, KEY);

/** Answer a file picker. Has to be registered before the click that opens it. */
async function setFiles(page, file, trigger) {
  if (page.__engine === 'puppeteer') {
    const [chooser] = await Promise.all([page.waitForFileChooser(), trigger()]);
    await chooser.accept([file]);
    return;
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(file);
}

/** Re-hook the export path. A reload throws the last hook away. */
const hookExport = p => p.evaluate(() => {
  window.__exports = [];
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => { blob.text().then(txt => window.__exports.push(txt)); return create(blob); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!this.download) return click.call(this); };
});

/** Boot the page onto whatever is in storage, waiting for the module to run. */
async function boot(p, { wipe = false } = {}) {
  await p.goto(PAGE, { waitUntil: 'load' });
  if (wipe) {
    await p.evaluate(k => localStorage.removeItem(k), KEY);
    await p.goto(PAGE, { waitUntil: 'load' });
  }
  // The debug hook is the last thing the module assigns, so it is the signal
  // that a `type="module"` script actually parsed and ran.
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  await p.waitForSelector('#save-bar button[data-gvb="export"]');
}

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(PORT);
const browser = await launch();
const p = await prepPage(browser, BASE, { width: 1280, height: 1000, dsf: 1 });

try {
  sections: {
  if (ONLY_A11Y) break sections;
  /* ---------- 1. the page boots at all ---------- */

  t.section('1. the module script runs');
  await boot(p, { wipe: true });
  t.ok(true, 'a type="module" script parsed and ran to the end');
  const day1 = await p.$eval('#dayNum', el => el.textContent);
  t.ok(day1 === '1', 'a wiped browser opens on day 1', `day ${day1}`);
  t.ok((await p.$$('#save-bar button')).length === 2,
    'the save bar mounted export and import, and no third eraser next to New Game');
  const kinds = await p.$$eval('#save-bar button', els => els.map(e => e.dataset.gvb));
  t.ok(kinds.join(',') === 'export,import', 'each button carries its data-gvb', kinds.join(','));
  t.ok((await p.$$('#newGameBtn')).length === 1, 'the game keeps its own New Game button');

  /* ---------- 2. fonts and offsite ---------- */

  t.section('2. vendored fonts, nothing offsite');
  const html = fs.readFileSync(path.resolve(HERE, '..', 'index.html'), 'utf8');
  t.ok(!html.includes('fonts.googleapis.com'), 'the page has zero fonts.googleapis.com hits');
  const faces = await p.evaluate(() => Promise.all([
    ['400', 'Kalam'], ['700', 'Kalam'], ['400', 'Quicksand'], ['600', 'Quicksand'],
    ['700', 'Quicksand'], ['400', '"Space Mono"'], ['700', '"Space Mono"'],
  ].map(([w, f]) => document.fonts.load(`${w} 1rem ${f}`).then(l => `${f} ${w} ${l.length ? 'ok' : 'MISSING'}`))));
  t.ok(faces.every(f => f.endsWith('ok')), 'all seven vendored faces resolve', faces.join(', '));
  const woff = await p.evaluate(() => performance.getEntriesByType('resource')
    .filter(r => r.name.endsWith('.woff2')).map(r => r.name.split('/').pop()));
  t.ok(woff.length === 7 && woff.every(n => n.includes('-latin-')),
    'served from corner-and-kettle/fonts, not a CDN', `${woff.length} files`);
  // page.__blocked is NOT the check for a font hotlink: prepPage fulfills
  // Google Fonts requests locally before the blocked list is written.
  t.ok(p.__blocked.length === 0, 'nothing offsite was refused either', p.__blocked.join(' ') || 'none');

  /* ---------- 2b. the cup and food sheet ---------- */

  t.section('2b. the cups and plates are drawn from the sheet (#810)');
  const sheetState = await waitFor(p, () => window.__CK_DEBUG__.sheet !== 'loading', { timeout: 10000 })
    .then(() => p.evaluate(() => window.__CK_DEBUG__.sheet), () => 'loading');
  t.ok(sheetState === 'loaded', 'the page loaded cups.png itself', sheetState);
  const sheetRes = await p.evaluate(() => performance.getEntriesByType('resource')
    .filter(r => r.name.endsWith('/assets/sprites/cups.png')).map(r => r.name));
  t.ok(sheetRes.length >= 1 && sheetRes[0].startsWith(BASE + '/Projects/corner-and-kettle/'),
    'from this project, not anywhere else', sheetRes.join(' ') || 'never requested');
  const bubbles = await p.$$eval('.customer .bubble', els => els.map(e => ({
    images: e.querySelectorAll('image').length,
    href: e.querySelector('image')?.getAttribute('href') || '',
  })));
  t.ok(bubbles.length > 0 && bubbles.every(b => b.images >= 1 && b.href.endsWith('/assets/sprites/cups.png')),
    'every waiting customer\'s bubble draws from the sheet', JSON.stringify(bubbles.map(b => b.images)));

  // A sheet that will not load says so. The page's own loader is pointed at
  // a file that is not there, before the module runs.
  const p404 = await prepPage(browser, BASE, { width: 1280, height: 1000, dsf: 1 });
  await p404.evaluateOnNewDocument(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true, get() { return d.get.call(this); },
      set(v) { d.set.call(this, String(v).replace('cups.png', 'cups-not-here.png')); },
    });
  });
  const errors = [];
  p404.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p404.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p404, () => window.__CK_DEBUG__ && window.__CK_DEBUG__.sheet !== 'loading', { timeout: 10000 }).catch(() => {});
  const failed = await p404.evaluate(() => ({ sheet: window.__CK_DEBUG__?.sheet,
    toast: [...document.querySelectorAll('.toast')].map(e => e.textContent).join(' | ') }));
  t.ok(failed.sheet === 'failed' && /cup pictures did not load/.test(failed.toast),
    'a sheet that will not load is a toast, not a blank cup', JSON.stringify(failed));
  t.ok(errors.some(e => e.includes('corner-and-kettle: the cup and food sheet did not load')),
    'and a console error naming the file', errors.filter(e => e.startsWith('corner-and-kettle')).join(' ') || 'none');
  await p404.close();

  /* ---------- 3. actually play ---------- */

  t.section('3. build a drink and serve it');
  // Force a simple hot drink into station 1 so the beat is deterministic:
  // a random order might be food, or want a syrup that isn't unlocked.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o);
    d.tryAcceptCustomer(o.id);
  });
  await p.waitForSelector('.slot .ticket');
  const ticket = await p.$eval('.slot .ticket', el => el.innerText.replace(/\n/g, ' / '));
  t.ok(/Latte/.test(ticket) && /Oat Milk, steamed/.test(ticket), 'the ticket lists what the cup needs', ticket);
  t.ok(await p.$eval('.slot .servebtn', el => el.disabled), 'Serve is disabled on an empty cup');
  // A disabled control is never mute (#341): it names what the cup needs first.
  const emptyLabel = await p.$eval('.slot .servebtn', el => el.getAttribute('aria-label'));
  t.ok(/Nothing to serve yet/.test(emptyLabel) && /1 espresso shot/.test(emptyLabel) && /Oat Milk, steamed/.test(emptyLabel),
    'and its label says what the cup still needs', emptyLabel);

  const moneyBefore = await p.evaluate(() => window.__CK_DEBUG__.state.money);
  // The S key used to call serveSlot() straight past the disabled button.
  await p.keyboard.press('s');
  await wait(150);
  const afterS = await p.evaluate(() => ({ money: window.__CK_DEBUG__.state.money, serving: !!window.__CK_DEBUG__.state.slots[0]?.serving }));
  t.ok(afterS.money === moneyBefore && !afterS.serving, 'pressing S on the empty cup serves nothing either',
    `$${moneyBefore} -> $${afterS.money}`);

  // Base: pull a shot. This is a runProgress() button — the callback only fires
  // if requestAnimationFrame is running, which is the whole reason for the
  // no-backgrounding flags.
  await p.click('.stationTab[data-tab="base"]');
  await p.click('#btnEspresso');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.shots >= 1, { timeout: 5000 });
  t.ok(true, 'Pull Espresso Shot ran its progress bar to the end and landed a shot');

  await p.click('.stationTab[data-tab="milk"]');
  await p.click('[data-milk="oat"]');
  // Shot in, oat milk poured cold: a real attempt, one line short. The button
  // says so in its text, its style and its name (#341), against the DOM (#39).
  const short = await p.$eval('.slot .servebtn', el => ({ text: el.textContent.trim(), disabled: el.disabled,
    short: el.classList.contains('short'), label: el.getAttribute('aria-label') }));
  t.ok(short.text === 'Serve 1/2' && !short.disabled && short.short, 'a short cup reads "Serve 1/2", enabled, styled as a warning',
    `${short.text}${short.disabled ? ' (disabled)' : ''}${short.short ? ' .short' : ''}`);
  t.ok(/Still missing: Oat Milk, steamed\./.test(short.label), 'and names exactly what is missing', short.label);
  const dotTabs = await p.$$eval('.stationTab', els => els.filter(e => e.querySelector('.needdot')).map(e => e.dataset.tab).join(','));
  t.ok(dotTabs === 'milk', 'the only tab with a still-needed dot is Milk', dotTabs || 'none');
  await p.click('#btnSteam');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.milkSteamed, { timeout: 5000 });
  t.ok(true, 'Steam Milk ran its progress bar to the end');

  const done = await p.evaluate(() => window.__CK_DEBUG__.orderIsComplete(window.__CK_DEBUG__.state.slots[0]));
  t.ok(done, 'the ticket is complete');
  const dots = await p.$$eval('.stationTab .needdot', els => els.length);
  t.ok(dots === 0, 'and no station tab still shows a needed-work dot', `${dots} dots`);
  const full = await p.$eval('.slot .servebtn', el => ({ text: el.textContent.trim(), short: el.classList.contains('short') }));
  t.ok(full.text === 'Serve' && !full.short, 'and the button is plain "Serve" again', full.text);

  await p.click('.slot .servebtn');
  await wait(900);
  const moneyAfter = await p.evaluate(() => window.__CK_DEBUG__.state.money);
  t.ok(moneyAfter > moneyBefore, 'serving it paid', `$${moneyBefore} -> $${moneyAfter}`);
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.combo >= 1), 'and started a streak');
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.slots[0] === null), 'the station cleared');

  // Now serve one short on purpose, and check the scorer paid what the button said.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'whole', syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o);
    d.tryAcceptCustomer(o.id);
  });
  await p.click('.stationTab[data-tab="base"]');
  await p.click('#btnEspresso');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0]?.cup.shots >= 1, { timeout: 5000 });
  await p.click('.stationTab[data-tab="milk"]');
  await p.click('[data-milk="whole"]');
  const shortText = await p.$eval('.slot .servebtn', el => el.textContent.trim());
  const acc0 = await p.evaluate(() => ({ sum: window.__CK_DEBUG__.state.dayStats.accuracySum, n: window.__CK_DEBUG__.state.dayStats.accuracyCount }));
  await p.click('.slot .servebtn');
  await wait(200);
  const acc1 = await p.evaluate(() => ({ sum: window.__CK_DEBUG__.state.dayStats.accuracySum, n: window.__CK_DEBUG__.state.dayStats.accuracyCount,
    combo: window.__CK_DEBUG__.state.combo }));
  const scored = Math.round((acc1.sum - acc0.sum) * 1000) / 1000;
  t.ok(shortText === 'Serve 1/2' && acc1.n === acc0.n + 1 && scored === 0.5,
    'serving the "Serve 1/2" cup scored it at exactly 1/2', `${shortText}, ratio ${scored}`);
  t.ok(acc1.combo === 0, 'and a short cup ends the streak, as it always has');
  await wait(700);

  // A Frappe by hand, the way the Blend station's hint says: a shot, milk, then
  // blend. Blending kept an espresso base as 'espresso', so the ticket's
  // "Blended base" line could never tick and a hand-built Frappe topped out at
  // 2/3 (#343). Only a barista, who sets the base directly, could finish one.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'frappe', price: 65,
      custom: { milk: 'skim', syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o);
    d.tryAcceptCustomer(o.id);
  });
  await p.click('.stationTab[data-tab="base"]');
  await p.click('#btnEspresso');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0]?.cup.shots >= 1, { timeout: 5000 });
  await p.click('.stationTab[data-tab="milk"]');
  await p.click('[data-milk="skim"]');
  await p.click('.stationTab[data-tab="blend"]');
  await p.click('#btnBlend');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0]?.cup.blended, { timeout: 5000 });
  await wait(100);
  const frappe = await p.$eval('.slot .servebtn', el => el.textContent.trim());
  t.ok(frappe === 'Serve' && await p.evaluate(() => window.__CK_DEBUG__.orderIsComplete(window.__CK_DEBUG__.state.slots[0])),
    'a Frappe built by hand (shot, milk, blend) is complete', frappe);
  await p.evaluate(() => { const s = window.__CK_DEBUG__.state; s.slots[0] = null; });

  /* ---------- 4. the clock runs and a day ends ---------- */

  t.section('4. the day loop');
  const phase0 = await p.$eval('#phaseLabel', el => el.textContent);
  await p.evaluate(() => { window.__CK_DEBUG__.state.shiftElapsed = 34000 * 1.2; });
  await wait(400);
  const phase1 = await p.$eval('#phaseLabel', el => el.textContent);
  t.ok(phase0 === 'Dawn' && phase1 === 'Morning Rush', 'the clock advances the phase', `${phase0} -> ${phase1}`);

  // Warp to the end of the shift and let the loop notice.
  await p.evaluate(() => { window.__CK_DEBUG__.state.shiftElapsed = 34000 * 4 - 50; });
  await waitFor(p, () => document.getElementById('modalOverlay').classList.contains('show'),
    { timeout: 8000 });
  const summary = await p.$eval('#modalBody', el => el.innerText.replace(/\n+/g, ' / '));
  t.ok(/Drinks served/.test(summary) && /Reputation/.test(summary), 'the day-end summary is built', summary.slice(0, 110));
  t.ok(await p.$eval('#modalTitle', el => el.textContent) === 'Day 1 Complete!', 'titled with the day that just ended');
  const savedAtDayEnd = await savedState(p);
  t.ok(savedAtDayEnd && savedAtDayEnd.__v === 1, 'end of day wrote a versioned save', `__v ${savedAtDayEnd?.__v}`);

  await p.click('#modalBtn');
  await wait(300);
  t.ok(await p.$eval('#dayNum', el => el.textContent) === '2', 'Start Next Shift opens day 2');
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.shiftElapsed < 1000), 'with the clock back at Dawn');

  /* ---------- 5. the save round trip ---------- */

  t.section('5. play, reload, same shop');
  // A shop worth losing: bought recipe, third station, staff, a preset, a regular.
  const warped = await p.evaluate(() => {
    const d = window.__CK_DEBUG__, s = d.state;
    s.day = 9; s.money = 4210; s.reputation = 71;
    s.unlockedRecipes.add('frappe'); s.unlockedSyrups.add('mocha');
    s.upgrades.add('grinder'); s.upgrades.add('music');
    s.slots = [null, null, null];
    s.loyaltyLevel = 1; s.comboShields = 2; s.shieldsPurchased = 2;
    s.baristas = [{ id: 'b1', name: 'Juno', level: 2, skill: { bar: 1, kitchen: 0, register: 0 }, morale: 80, training: null, working: true, targetSlot: null, acc: 0 }];
    s.presets = [{ id: 'p1', name: 'Oat Vanilla Latte', cup: { base: 'espresso', shots: 2, milk: 'oat',
      milkSteamed: true, syrup: 'vanilla', toppings: ['whip'], ice: false, blended: false } }];
    s.regulars = { Nora: { order: { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: 'vanilla', toppings: ['whip'], ice: false } },
      visits: 4, lastDay: 8, satisfaction: 72, tolerance: 1.16, stopped: false } };
    d.saveState();
    return { day: s.day, money: s.money };
  });

  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const back = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { day: s.day, money: s.money, stations: s.slots.length, staff: s.baristas.length,
      staffLevel: s.baristas[0]?.level, staffSkillBar: s.baristas[0]?.skill?.bar,
      presetShots: s.presets[0]?.cup.shots, presetName: s.presets[0]?.name,
      regulars: Object.keys(s.regulars), nora: s.regulars.Nora,
      frappe: s.unlockedRecipes.has('frappe'), grinder: s.upgrades.has('grinder'),
      loyalty: s.loyaltyLevel, shields: s.comboShields, rep: s.reputation };
  });
  t.ok(back.day === 9 && back.money === warped.money, 'day and takings survived the reload', `day ${back.day}, $${back.money}`);
  t.ok(back.stations === 3, 'the bought third station survived');
  t.ok(back.staff === 1 && back.staffLevel === 2 && back.staffSkillBar === 1, 'Juno came back a bar-trained Senior');
  // targetSlot and acc are deliberately not saved, so assert that on the blob:
  // the live values are fair game for the game loop the moment the page boots,
  // and reading them a beat later is a race, not a check (#39).
  const blob = await savedState(p);
  t.ok(blob.baristas[0].targetSlot === undefined && blob.baristas[0].acc === undefined,
    'a staffer\'s claimed slot and step timer are not persisted');
  t.ok(back.presetShots === 2 && back.presetName === 'Oat Vanilla Latte', 'the preset survived intact');
  // Not an exact key match: init rebuilds the queue with three random orders and
  // any of them can mint a new named regular, so `=== 'Nora'` is a coin flip
  // dressed as an assertion (locked decision #40).
  t.ok(back.regulars.includes('Nora'), 'Nora is still a regular', back.regulars.join(',') || 'none');
  t.ok(back.nora?.order?.recipeId === 'latte' && back.nora?.order?.custom?.milk === 'oat'
    && back.nora?.order?.custom?.toppings?.join(',') === 'whip',
    'with her standing order intact', JSON.stringify(back.nora?.order?.custom));
  // >= 4, not === 4: init() rebuilds the queue with three random orders and,
  // same coin flip as the name match above, one of them can be Nora walking
  // in again, which bumps her visit count for real (#40, #349). Tolerance
  // only moves on a serve, so it survives exactly.
  t.ok((back.nora?.visits ?? 0) >= 4 && Math.abs((back.nora?.tolerance ?? 0) - 1.16) < 1e-9,
    'and her visit count and tolerance too (#349)', `visits ${back.nora?.visits}, tolerance ${back.nora?.tolerance}`);
  t.ok(back.frappe && back.grinder, 'bought recipe and equipment survived');
  t.ok(back.loyalty === 1 && back.shields === 2 && back.rep === 71, 'loyalty, shields and reputation survived');
  t.ok(await p.$eval('#dayNum', el => el.textContent) === '9', 'and the topbar says day 9 too');
  t.ok((await p.$$('.customer')).length > 0, 'the queue was rebuilt, so the shop is playable');

  /* ---------- 6. export to a file ---------- */

  t.section('6. export');
  await hookExport(p);
  await p.click('#chalkToggle');
  await wait(400);
  await p.click('#save-bar [data-gvb="export"]');
  await waitFor(p, () => window.__exports && window.__exports.length > 0, { timeout: 5000 });
  const text = await p.evaluate(() => window.__exports[0]);
  let env = null;
  try { env = JSON.parse(text); } catch (e) { /* asserted below */ }
  t.ok(!!env && env.format === 'gvb-save', 'Export save wrote a gvb-save envelope');
  t.ok(env?.game === 'corner-and-kettle' && env?.version === 1, 'stamped with the game and version',
    `${env?.game} v${env?.version}`);
  t.ok(env?.state?.day === 9 && env?.state?.money === warped.money, 'holding the shop as it stands',
    `day ${env?.state?.day}, $${env?.state?.money}`);
  t.ok(env?.state?.presets?.[0]?.cup?.shots === 2, 'including the preset');
  const exportFile = path.join(OUT, 'ck-export.json');
  fs.writeFileSync(exportFile, text);
  t.ok(fs.statSync(exportFile).size > 200, 'and it is a real file on disk', `${fs.statSync(exportFile).size} bytes`);

  /* ---------- 7. a cleared browser, then import ---------- */

  t.section('7. cleared browser, imported file');
  await boot(p, { wipe: true });
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.day) === 1, 'wiped back to day 1 before importing');
  await p.click('#chalkToggle');
  await wait(400);
  await setFiles(p, exportFile, () => p.click('#save-bar [data-gvb="import"]'));
  await wait(900);
  const imported = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { day: s.day, money: s.money, stations: s.slots.length, staff: s.baristas[0]?.name,
      preset: s.presets[0]?.name, regulars: Object.keys(s.regulars), queue: s.queue.length };
  });
  t.ok(imported.day === 9 && imported.money === warped.money, 'importing the file restored the shop over a wiped save',
    `day ${imported.day}, $${imported.money}`);
  t.ok(imported.stations === 3 && imported.staff === 'Juno' && imported.preset === 'Oat Vanilla Latte',
    'stations, staff and presets all came back');
  t.ok(imported.regulars.includes('Nora'), 'and so did the regular', imported.regulars.join(',') || 'none');
  t.ok(imported.queue > 0, 'the import redrew a playable queue rather than an empty counter');
  t.ok(await p.$eval('#dayNum', el => el.textContent) === '9', 'the topbar redrew to the imported day');
  t.ok((await savedState(p)).day === 9, 'and the import was written to storage, so a reload keeps it');

  /* ---------- 8. a corrupt file is refused ---------- */

  t.section('8. a corrupt file is refused');
  const badFiles = {
    'ck-corrupt-truncated.json': '{"format":"gvb-save","game":"corner-and-kettle","version":1,"state":{"day":9,',
    'ck-corrupt-shape.json': JSON.stringify({ format: 'gvb-save', game: 'corner-and-kettle', version: 1,
      state: { day: 'banana', money: 'free' } }),
    'ck-corrupt-othergame.json': JSON.stringify({ format: 'gvb-save', game: 'closing-time', version: 1,
      state: { day: 40, money: 90000, unlockedRecipes: [] } }),
    'ck-corrupt-notasave.json': JSON.stringify({ hello: 'world' }),
  };
  for (const [name, body] of Object.entries(badFiles)) {
    const f = path.join(OUT, name);
    fs.writeFileSync(f, body);
    await setFiles(p, f, () => p.click('#save-bar [data-gvb="import"]'));
    await wait(700);
    const still = await p.evaluate(() => ({ day: window.__CK_DEBUG__.state.day, money: window.__CK_DEBUG__.state.money }));
    t.ok(still.day === 9 && still.money === warped.money, `${name} was refused and the shop is untouched`,
      `still day ${still.day}, $${still.money}`);
  }
  const toastText = await p.$$eval('#toastWrap .toast', els => els.map(e => e.textContent).join(' | '));
  t.ok(/not a valid corner-and-kettle save/i.test(toastText), 'and the player was told why', toastText.slice(0, 90));
  t.ok(p.__errs.filter(e => e.startsWith('pageerror')).length === 0,
    'no uncaught error anywhere in the four refusals', p.__errs.join(' | ') || 'clean');

  /* ---------- 9. a save written before this session's changes ---------- */

  t.section('9. a save from the old hand-rolled writer');
  // Byte-for-byte what the previous saveState() wrote: no __v, and staff as a
  // single baristaLevel from the build before that. Seeded, then reloaded.
  const legacy = {
    day: 14, money: 6100,
    unlockedRecipes: ['drip', 'americano', 'latte', 'cappuccino', 'icedcoffee', 'mocha', 'caramelmac'],
    unlockedSyrups: ['vanilla', 'caramel', 'mocha'],
    unlockedToppings: ['whip', 'cinnamon'],
    unlockedFoods: ['croissant', 'bagel', 'muffin'],
    stationCount: 3, muted: true, baristaLevel: 2,
    regulars: { Otis: { food: true, foodId: 'bagel', price: 26 } },
    presets: [{ id: 'pOld', name: 'Legacy Latte', cup: { base: 'espresso', milk: 'whole' } }],
  };
  await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, legacy]);
  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const old = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { day: s.day, money: s.money, stations: s.slots.length, muted: s.muted,
      staff: s.baristas.length, staffName: s.baristas[0]?.name, staffLevel: s.baristas[0]?.level,
      rep: s.reputation, prestige: s.prestigeLevel, loyalty: s.loyaltyLevel,
      trigger: s.eventTriggerAt, upgrades: [...s.upgrades].length,
      presetShots: s.presets[0]?.cup.shots, presetToppings: s.presets[0]?.cup.toppings,
      regularIsFood: s.regulars.Otis?.order?.isFood, regularFoodId: s.regulars.Otis?.order?.foodId };
  });
  t.ok(old.day === 14 && old.money === 6100, 'an unversioned save still boots', `day ${old.day}, $${old.money}`);
  t.ok(old.stations === 3 && old.muted === true, 'stations and the mute setting survived');
  t.ok(old.staff === 1 && old.staffName === 'Pip' && old.staffLevel === 2,
    'baristaLevel migrated to one Senior with a name', `${old.staffName} L${old.staffLevel}`);
  t.ok(old.rep === 50 && old.prestige === 0 && old.loyalty === 0 && old.upgrades === 0,
    'every field added since filled in');
  t.ok(Number.isFinite(old.trigger) && old.trigger > 0,
    'the day\'s event time was rolled rather than left undefined', String(old.trigger));
  t.ok(old.presetShots === 0, 'a preset cup with no shots repaired to 0, not undefined', String(old.presetShots));
  t.ok(Array.isArray(old.presetToppings) && old.presetToppings.length === 0,
    'and its missing toppings list repaired to []');
  t.ok(old.regularIsFood === true && old.regularFoodId === 'bagel',
    'a regular saved with the old `food` flag reads as a food order');

  // The two bugs this guards, both from the same legacy preset:
  //   cup.toppings missing -> applyPreset's [...src.toppings] throws, so the
  //     preset silently does nothing at all
  //   cup.shots missing    -> cup.shots++ is NaN, NaN >= 1 is false forever,
  //     and the base line on the ticket can never be ticked off
  // Assert the apply LANDED before asserting the arithmetic. Without that first
  // check this beat passes when the spread throws, because a thrown applyPreset
  // leaves the untouched newCup() behind — which has shots: 0 already.
  const errsBefore = p.__errs.length;
  const applied = await p.evaluate(() => {
    const d = window.__CK_DEBUG__, s = d.state;
    s.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'whole', syrup: undefined, toppings: [], ice: false } });
    s.queue.push(o);
    d.tryAcceptCustomer(o.id);
    document.querySelector('.stationTab[data-tab="presets"]').click();
    let threw = null;
    try { document.querySelector('[data-apply-preset="pOld"]').click(); }
    catch (e) { threw = String(e); }
    const cup = s.slots[0].cup;
    const before = cup.shots;
    cup.shots++;
    return { threw, landed: cup.base === 'espresso' && cup.milk === 'whole',
      before, after: cup.shots, satisfiable: cup.shots >= 1 };
  });
  await wait(200);
  // An exception thrown inside a click handler never reaches the .click() call
  // site — it surfaces as an uncaught window error instead, which is why the
  // try/catch above cannot be the check. Watch the page's error stream.
  const newErrs = p.__errs.slice(errsBefore);
  t.ok(!applied.threw && newErrs.length === 0, 'applying a legacy preset raised nothing',
    newErrs.join(' | ') || 'clean');
  t.ok(applied.landed, 'and it actually landed on the cup rather than doing nothing');
  t.ok(applied.before === 0 && applied.after === 1 && applied.satisfiable,
    'then pulling a shot gives 1, not NaN', `${applied.before} -> ${applied.after}`);

  /* ---------- 10. a hand-edited save can't take the loop down ---------- */

  t.section('10. a hand-edited save that used to freeze the game');
  // loyaltyLevel indexes LOYALTY_UPGRADES on every spawn and every serve. An
  // out-of-range value threw inside the rAF loop, which is a frozen shop.
  await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, {
    day: 4, money: 800, unlockedRecipes: ['drip', 'latte'], unlockedFoods: [],
    loyaltyLevel: 9, comboShields: 99, reputation: 5000, stationCount: 2.5,
    baristas: [{ id: 'x', level: 7 }, { id: 'y', level: 1 }, { id: 'z', level: 1 }, { id: 'w', level: 1 }],
    // "Nonesuch" is deliberately not one of REGULAR_NAMES. Keying the broken
    // regular on a real name makes the "was it dropped" check a coin flip,
    // because init's three random orders can mint a fresh one of those and put
    // the name straight back (locked decision #40).
    regulars: { Nonesuch: { isFood: false, recipeId: 'pumpkinspice' }, Gideon: { isFood: false, recipeId: 'latte' } },
    presets: [{ id: 'p', name: 'x' }],
    dailyModifierId: 'nonsense', upgrades: ['teleporter'],
  }]);
  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const clamped = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { loyalty: s.loyaltyLevel, shields: s.comboShields, rep: s.reputation,
      stations: s.slots.length, staff: s.baristas.length, staffLevel: s.baristas[0]?.level,
      regulars: Object.keys(s.regulars), modifier: s.dailyModifierId,
      upgrades: [...s.upgrades], presetToppings: s.presets[0]?.cup?.toppings,
      foods: [...s.unlockedFoods] };
  });
  t.ok(clamped.loyalty === 2, 'loyaltyLevel 9 clamped to the table length', String(clamped.loyalty));
  t.ok(clamped.shields === 3 && clamped.rep === 100, 'shields and reputation clamped');
  t.ok(clamped.stations === 3, 'stationCount 2.5 rounded — new Array(2.5) throws outright', String(clamped.stations));
  t.ok(clamped.staff === 3 && clamped.staffLevel === 1, 'the roster clamped to the cap and the bad tier read as Junior');
  t.ok(!clamped.regulars.includes('Nonesuch') && clamped.regulars.includes('Gideon'),
    'the regular wanting a recipe that does not exist was dropped, the one next to them kept',
    clamped.regulars.join(','));
  t.ok(clamped.modifier === null && clamped.upgrades.length === 0, 'unknown modifier and upgrade ids dropped');
  t.ok(Array.isArray(clamped.presetToppings), 'a preset with no cup at all got one');
  t.ok(clamped.foods.length === 2, 'an emptied food menu was unioned back to the starters — rand([]) is undefined');

  // Now let it actually run: spawns and serves are where the throws happened.
  await p.evaluate(() => { window.__CK_DEBUG__.state.shiftElapsed = 34000 * 1.1; });
  await wait(2500);
  const alive = await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    const before = d.state.shiftElapsed;
    return new Promise(r => setTimeout(() => r({
      moved: d.state.shiftElapsed > before, queue: d.state.queue.length,
    }), 1200));
  });
  t.ok(alive.moved, 'the game loop is still running after loading that save');
  t.ok(alive.queue > 0, 'and customers are still spawning', `${alive.queue} in the queue`);
  t.ok(p.__errs.filter(e => e.startsWith('pageerror')).length === 0,
    'no uncaught page error across the whole run', p.__errs.join(' | ') || 'clean');

  /* ---------- 11. New Game ---------- */

  t.section('11. New Game');
  // The chalkboard slides in from off-screen, so both New Game and the save bar
  // sit outside the viewport until it is opened. Playwright still calls them
  // "visible" and then times out trying to click, which is a confusing failure
  // for the next person: open the panel first.
  await p.evaluate(() => { window.confirm = () => true; });
  await p.click('#chalkToggle');
  await wait(500);
  await p.click('#newGameBtn');
  await wait(600);
  const fresh = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { day: s.day, money: s.money, stations: s.slots.length, staff: s.baristas.length,
      recipes: [...s.unlockedRecipes].length, queue: s.queue.length, trigger: s.eventTriggerAt };
  });
  t.ok(fresh.day === 1 && fresh.money === 60, 'New Game reopens on day 1 with the starting float',
    `day ${fresh.day}, $${fresh.money}`);
  t.ok(fresh.stations === 2 && fresh.staff === 0 && fresh.recipes === 5, 'and the day-one shop');
  t.ok(fresh.queue > 0, 'with a queue already forming');
  t.ok(fresh.trigger > 0, 'and an event time rolled, not 0 — a 0 fires the day\'s event at Dawn',
    String(fresh.trigger));
  t.ok((await savedState(p)).day === 1, 'the fresh shop was written to storage');

  /* ---------- 12. keyboard and screen reader ---------- */

  t.section('12. keyboard and screen reader');
  await boot(p, { wipe: true });
  const a11y = await p.evaluate(() => {
    const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => +h.tagName[1]);
    const custs = [...document.querySelectorAll('.customer')];
    return {
      headings,
      custCount: custs.length,
      custAreButtons: custs.every(c => c.tagName === 'BUTTON'),
      custLabels: custs.map(c => c.getAttribute('aria-label')),
      toastLive: document.getElementById('toastWrap').getAttribute('aria-live'),
      emojiOnlyUnnamed: [...document.querySelectorAll('button')].filter(b =>
        /^[\p{Emoji}️\s]+$/u.test(b.textContent.trim()) && !b.getAttribute('aria-label')).length,
    };
  });
  t.ok(a11y.headings.every((lvl, i) => i === 0 ? lvl === 1 : lvl - a11y.headings[i - 1] <= 1),
    'heading levels never skip a step', a11y.headings.join(' → '));
  t.ok(a11y.custCount > 0 && a11y.custAreButtons,
    'every waiting customer is a real button, so the queue is keyboard-reachable',
    `${a11y.custCount} customers`);
  t.ok(a11y.custLabels.every(l => l && /waiting for .+patience left/.test(l)),
    'each one is named with the order and how long they will wait',
    a11y.custLabels[0]?.slice(0, 76));
  t.ok(a11y.toastLive === 'polite', 'the toast strip is a live region', String(a11y.toastLive));
  t.ok(a11y.emojiOnlyUnnamed === 0, 'no emoji-only button is left without an accessible name');

  // Tab to the first customer and take their order with the keyboard alone.
  const taken = await p.evaluate(async () => {
    const first = document.querySelector('.customer');
    first.focus();
    const focused = document.activeElement === first;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    first.click();  // what Enter on a <button> does natively
    await new Promise(r => setTimeout(r, 200));
    return { focused, inStation: !!window.__CK_DEBUG__.state.slots.find(s => s !== null) };
  });
  t.ok(taken.focused, 'a customer can take focus');
  t.ok(taken.inStation, 'and Enter on them puts the order into a station');

  /* ---------- 12b. both hands on the keys (Phase 8) ---------- */

  t.section('12b. both hands on the keys');
  // Start from a known cup so the beats below are about the keyboard and not
  // about which order the queue happened to spawn.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.slots = d.state.slots.map(() => null);
    d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o);
    d.tryAcceptCustomer(o.id);
  });
  await p.waitForSelector('.slot .ticket');
  await p.click('.stationTab[data-tab="base"]');

  /**
   * The legend and the bindings, read separately off the page. The phase's
   * claim is that they come from one array; two readings that disagree is the
   * failure it is written against, so neither side re-derives the other here.
   */
  const keyMap = () => p.evaluate(() => ({
    legend: [...document.querySelectorAll('#keyLegend .legendRow')].map(r => r.textContent.trim()),
    // key and the words printed next to it, as one string per entry. Keys
    // alone are too weak to catch a legend that has stopped reading the
    // buttons: a hardcoded "Q W E" matches the Base tab's real keys exactly
    // (#147 — a claim the comparison cannot distinguish is worth nothing).
    legendPairs: [...document.querySelectorAll('#keyLegend .legendRow')].slice(1)
      .flatMap(r => [...r.querySelectorAll('.kk')].map(k =>
        `${k.textContent.trim().toLowerCase()}=${k.parentElement.textContent.slice(k.textContent.length).trim()}`)),
    legendOff: [...document.querySelectorAll('#keyLegend .legendRow .off .kk')].map(k => k.textContent.trim().toLowerCase()),
    btns: [...document.querySelectorAll('#stationsAll .actionbtn')].map(b => ({
      name: b.textContent.trim(),
      key: b.getAttribute('aria-keyshortcuts'),
      nokey: b.hasAttribute('data-nokey'),
      disabled: b.disabled,
      title: b.title,
    })),
  }));

  const base = await keyMap();
  t.ok(/^Keys/.test(base.legend[0]) && /serve the focused station/.test(base.legend[0])
    && /previous \/ next station/.test(base.legend[0]),
    'the legend is on screen and names the keys that are not the panel\'s', base.legend[0]);
  t.ok(base.btns.length === 3 && base.btns.every(b => b.key),
    'every control in the Base tab carries aria-keyshortcuts',
    base.btns.map(b => `${b.key}=${b.name}`).join(' '));
  t.ok(base.btns.map(b => b.key).join('') === 'qwe',
    'and they are the first letters of the map, in the order they are rendered',
    base.btns.map(b => b.key).join(''));
  const pairsOf = m => m.btns.filter(b => !b.nokey).map(b => `${b.key}=${b.name}`).join(' · ');
  t.ok(base.legendPairs.join(' · ') === pairsOf(base),
    'the legend prints exactly the keys the buttons answer to, and names the same controls',
    `legend [${base.legendPairs.join(' · ')}] vs buttons [${pairsOf(base)}]`);
  t.ok(base.btns.every(b => b.title.includes(`Shortcut: ${b.key.toUpperCase()}`)),
    'and each button says its own key on hover', base.btns[0].title);

  // Build the drink with nothing but keystrokes: 1 for the Base tab, the key
  // the page says pulls a shot, 2 for Milk, the key for oat, the key to steam.
  const shotKey = base.btns.find(b => /Pull Espresso Shot/.test(b.name)).key;
  await p.keyboard.press('1');
  await p.keyboard.press(shotKey);
  // Caught rather than awaited bare: a key that does nothing is the failure
  // this beat exists for, and an uncaught TimeoutError kills the process
  // before the twelve beats below it get to say anything.
  const landed = await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.shots >= 1,
    { timeout: 5000 }).then(() => true, () => false);
  t.ok(landed, `pressing ${shotKey.toUpperCase()} ran the progress bar and landed a shot`);

  await p.keyboard.press('2');
  const milk0 = await keyMap();
  const steam0 = milk0.btns.find(b => /Steam Milk/.test(b.name));
  t.ok(steam0.disabled && !!steam0.key && milk0.legendOff.includes(steam0.key),
    'Steam Milk is bound before it is usable, and the legend shows it dimmed rather than skipping it',
    `key ${steam0.key}, ${milk0.legendOff.length} dimmed`);
  // A key on a disabled control does nothing. What this actually guards is
  // that pressKey clicks the button rather than reaching past it to the
  // handler: the disabled refusal is the DOM's, and a version of pressKey
  // that dispatched its own click event would steam an empty cup. That is the
  // shape of the bug the S key had before #341.
  //
  // Waited out of the page's own clock, not a guessed number: Steam Milk is a
  // progress-bar button, so a 200 ms wait reports "nothing happened" about a
  // bar that had 700 ms left to run and passes against a pressKey that has
  // stopped honouring the gate entirely.
  const steamMs = await p.evaluate(() => window.__CK_DEBUG__.sim.cupActionMs('steamMilk'));
  await p.keyboard.press(steam0.key);
  await wait(steamMs + 500);
  t.ok(await p.evaluate(() => !window.__CK_DEBUG__.state.slots[0].cup.milkSteamed),
    'and pressing its key with no milk in the cup steams nothing', `waited ${steamMs + 500}ms`);

  const oatKey = milk0.btns.find(b => /Oat Milk/.test(b.name)).key;
  await p.keyboard.press(oatKey);
  await wait(150);
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.slots[0].cup.milk === 'oat'),
    `${oatKey.toUpperCase()} poured the oat milk`);
  const milk1 = await keyMap();
  const steamKey = milk1.btns.find(b => /Steam Milk/.test(b.name)).key;
  t.ok(steamKey === steam0.key && !milk1.legendOff.includes(steamKey),
    'Steam Milk keeps its key and loses the dim once milk is in the cup — the map does not shift under the hand',
    `${steam0.key} -> ${steamKey}`);
  await p.keyboard.press(steamKey);
  const steamed = await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.milkSteamed,
    { timeout: 5000 }).then(() => true, () => false);
  t.ok(steamed, `${steamKey.toUpperCase()} steamed it`);

  const ready = await p.$eval('.slot .servebtn', el => el.textContent.trim());
  t.ok(ready === 'Serve', 'the cup the keyboard built reads as complete on the button', ready);
  const keyMoney = await p.evaluate(() => window.__CK_DEBUG__.state.money);
  await p.keyboard.press('s');
  await wait(900);
  const servedByKey = await p.evaluate(() => ({
    money: window.__CK_DEBUG__.state.money,
    slot: window.__CK_DEBUG__.state.slots[0],
  }));
  t.ok(servedByKey.money > keyMoney && servedByKey.slot === null,
    'a full drink built and served with the keyboard alone paid and cleared the station',
    `$${keyMoney} -> $${servedByKey.money}`);

  // [ and ] across the stations. The DOM is the assertion (#39): the focus
  // ring is a class on the slot, and the station panel follows it.
  const slotFocus = () => p.evaluate(() => ({
    idx: window.__CK_DEBUG__.state.focusedSlot,
    dom: [...document.querySelectorAll('#slots .slot')].findIndex(el => el.classList.contains('focused')),
    count: document.querySelectorAll('#slots .slot').length,
  }));
  const f0 = await slotFocus();
  await p.keyboard.press(']');
  await wait(120);
  const f1 = await slotFocus();
  await p.keyboard.press('[');
  await wait(120);
  const f2 = await slotFocus();
  t.ok(f0.count >= 2 && f1.idx === (f0.idx + 1) % f0.count && f2.idx === f0.idx,
    '] moves the focused station on and [ moves it back', `${f0.idx} -> ${f1.idx} -> ${f2.idx}`);
  t.ok(f1.dom === f1.idx && f2.dom === f2.idx,
    'and the focus ring in the DOM followed both times', `ring on slot ${f1.dom} then ${f2.dom}`);
  // Wrapping, so the last station is one press from the first.
  await p.evaluate(n => { window.__CK_DEBUG__.state.focusedSlot = n - 1; window.__CK_DEBUG__.renderAll(); }, f0.count);
  await p.keyboard.press(']');
  await wait(120);
  t.ok((await slotFocus()).idx === 0, '] wraps from the last station to the first');

  // A recipe bought without its own syrup says so on the board, and a cup
  // with a shot too many says so at the Base station (#913). The rules are
  // smoke-sim.mjs section 17's; this is the page drawing them.
  const boardRow = () => p.evaluate(() => {
    const short = document.querySelector('#chalkContent [data-recipe-short="mocha"]');
    const row = [...document.querySelectorAll('#chalkContent .chalk-item')].find(el => /Mocha \(\$55\)/.test(el.textContent));
    return { short: short ? short.textContent.replace(/\s+/g, ' ').trim() : null, row: row ? row.textContent.replace(/\s+/g, ' ').trim() : null,
      button: !!(row && row.querySelector('button')) };
  });
  await p.evaluate(() => { const d = window.__CK_DEBUG__; d.state.money = 9999; d.renderAll(); });
  const board0 = await boardRow();
  await p.evaluate(() => { const d = window.__CK_DEBUG__; d.doUnlock('recipe', 'mocha'); d.renderAll(); });
  await wait(150);
  const board1 = await boardRow();
  t.ok(board0.button && board0.short === null, 'before it is bought, Mocha is an Unlock button on the board', board0.row);
  t.ok(board1.short !== null && /nobody orders it until you buy Mocha syrup \(\$35\), below/.test(board1.short) && !board1.button && !/✓/.test(board1.short),
    'bought with its syrup not bought, the row says what to buy and carries no tick', board1.short);
  const baseHint = async shots => p.evaluate(shots => {
    const d = window.__CK_DEBUG__;
    d.state.slots[0] = null; d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'ristretto', price: 42, custom: { milk: undefined, syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o); d.tryAcceptCustomer(o.id);
    d.state.focusedSlot = 0; d.state.stationTab = 'base';
    Object.assign(d.state.slots[0].cup, { base: 'espresso', shots });
    d.renderAll();
    return [...document.querySelectorAll('.stationBlock .draghint')].map(el => el.textContent.replace(/\s+/g, ' ').trim()).find(x => /Shots in cup/.test(x)) || null;
  }, shots);
  const hint1 = await baseHint(1), hint2 = await baseHint(2);
  t.ok(hint1 !== null && /Shots in cup: 1/.test(hint1) && !/the ticket asks for/.test(hint1), 'a Ristretto with its one shot has a plain Base hint', hint1);
  t.ok(hint2 !== null && /Shots in cup: 2/.test(hint2) && /the ticket asks for 1: 🗑️ Dump starts the cup over/.test(hint2),
    'a second shot in it says the ticket asked for 1 and that Dump is the way back', hint2);

  // An unlock is a button, a key and a legend row in one render. A syrup
  // bought mid-shift used to leave the legend saying what it said before.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.slots[0] = null;
    d.state.queue = [];
    const o = d.generateOrder();
    Object.assign(o, { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: undefined, toppings: [], ice: false } });
    d.state.queue.push(o);
    d.tryAcceptCustomer(o.id);
    d.state.focusedSlot = 0;
    d.renderAll();
  });
  await p.keyboard.press('4');
  const syrup0 = await keyMap();
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.money = 9999;
    d.doUnlock('syrup', 'mocha');
  });
  await wait(150);
  const syrup1 = await keyMap();
  t.ok(syrup1.btns.length === syrup0.btns.length + 1
    && syrup1.btns.some(b => /Mocha/.test(b.name) && b.key),
    'an unlocked syrup arrives already bound',
    `${syrup0.btns.length} -> ${syrup1.btns.length} controls`);
  t.ok(syrup1.legendPairs.join(' · ') === pairsOf(syrup1) && /Mocha/.test(syrup1.legend[1]),
    'and the legend redrew with it, still naming exactly the keys the buttons hold',
    syrup1.legend[1]);
  const board2 = await boardRow();
  t.ok(board2.short === null && board2.row !== null && /✓/.test(board2.row), 'and with the syrup bought the Mocha row on the board is a tick again', board2.row);

  // The widest tab the game can build: six presets, each with a delete button
  // beside it. Thirteen controls, ten keys — the deleters opt out so that the
  // six that apply a preset and Save Current all keep one.
  await p.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.presets = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({
      id: 'p' + i, name: 'Build ' + n,
      cup: { base: null, shots: 0, milk: null, milkSteamed: false, syrup: null,
        toppings: [], ice: false, blended: false },
    }));
    d.renderAll();
  });
  await p.keyboard.press('7');
  const presets = await keyMap();
  const bound = presets.btns.filter(b => !b.nokey);
  const deleters = presets.btns.filter(b => b.nokey);
  t.ok(bound.length === 7 && bound.every(b => b.key) && bound.length <= 10,
    'six presets plus Save Current all fit the map', `${bound.length} bound of ${presets.btns.length}`);
  t.ok(deleters.length === 6 && deleters.every(b => !b.key),
    'and the six deleters take no key from them', `${deleters.length} opted out`);
  t.ok(presets.legendPairs.join(' · ') === pairsOf(presets),
    'the legend on the widest tab still matches the buttons exactly',
    presets.legendPairs.join(' · '));
  await p.evaluate(() => { const d = window.__CK_DEBUG__; d.state.presets = []; d.state.slots[0] = null; d.renderAll(); });

  /* ---------- 14. the reopen ledger, and the Legacy board ---------- */

  t.section('14. the reopen ledger and the Legacy board (#360)');
  // Seed a shop worth losing: day 12, money in the till, upgrades, a barista,
  // reputation. The ledger's whole job is to name those before they go.
  await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, {
    day: 12, money: 4000, unlockedRecipes: ['drip', 'americano', 'latte', 'cappuccino', 'icedcoffee', 'mocha'],
    unlockedFoods: ['croissant', 'bagel'], unlockedSyrups: ['vanilla', 'caramel'], unlockedToppings: ['whip', 'cinnamon'],
    stationCount: 2, reputation: 70, loyaltyLevel: 1, comboShields: 2,
    upgrades: ['music', 'grinder'],
    baristas: [{ id: 'b1', name: 'Pip', level: 2, skill: { bar: 1, kitchen: 0, register: 0 }, morale: 60, working: true }],
    meta: { beans: 0, unlocks: [] }, layoutId: 'corner',
  }]);
  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  await p.click('#chalkToggle');
  await wait(400);

  // The reopen row is a button now, not a window.confirm behind one. A stub
  // that records and refuses is installed rather than left alone: with the
  // real dialog the click hangs until the CDP timeout, which is a five-minute
  // protocol error instead of a named failure. Refusing also means a page that
  // did still reach for confirm() never opens the ledger, so both assertions
  // below say so plainly. (A reload throws the stub away, hence here and not
  // in section 11.)
  await p.evaluate(() => {
    window.__confirms = [];
    window.confirm = msg => { window.__confirms.push(String(msg)); return false; };
  });
  const reopenBtn = await p.$('[data-prestige]');
  t.ok(!!reopenBtn, 'the chalkboard offers a Reopen button on day 12');
  const rowText = await p.$eval('[data-prestige]', el => el.closest('.chalk-item').textContent.replace(/\s+/g, ' ').trim());
  t.ok(/\d+ beans?/.test(rowText), 'and the row says what closing now pays, before it is clicked', rowText.slice(0, 110));

  // Through the panel's own scroll, like every other row down here: a bare
  // click died "not clickable" on one run in two at load 5 to 6 (#878's run
  // and #913's), with the row a third of the way down a sliding panel.
  await clickInChalkboard(p, '[data-prestige]');
  await wait(300);
  const shown = await p.evaluate(() => {
    const o = document.getElementById('reopenOverlay');
    return {
      open: o.classList.contains('show'),
      body: document.getElementById('reopenBody').textContent.replace(/\s+/g, ' ').trim(),
      layouts: [...document.querySelectorAll('#reopenLayouts [data-layout]')].map(b => ({ id: b.dataset.layout, disabled: b.disabled })),
      day: window.__CK_DEBUG__.state.day,
      money: window.__CK_DEBUG__.state.money,
      confirms: window.__confirms || [],
    };
  });
  t.ok(shown.open, 'clicking it opens the ledger rather than reopening the shop');
  t.ok(shown.confirms.length === 0, 'and asks through the page, not a window.confirm',
    shown.confirms.join(' | ') || 'confirm() never called');
  t.ok(shown.day === 12 && shown.money === 4000, 'and nothing has happened to the shop yet',
    `day ${shown.day}, $${shown.money}`);
  t.ok(/4,?000 in the till/.test(shown.body), 'the ledger names the till it would empty', shown.body.slice(0, 90));
  t.ok(/Day 12 back to day 1/.test(shown.body), 'and the day it would reset');
  t.ok(/2 equipment, ambiance and business upgrades/.test(shown.body), 'and the upgrades');
  t.ok(/1 barista/.test(shown.body), 'and the barista');
  t.ok(/Reputation 70 back to 50/.test(shown.body), 'and the reputation');
  t.ok(/beans/.test(shown.body), 'and what it pays out');
  t.ok(shown.layouts.length >= 2, 'every layout is offered', shown.layouts.map(l => l.id).join(','));
  t.ok(shown.layouts[0].id === 'corner' && !shown.layouts[0].disabled, "day one's is always pickable");
  t.ok(shown.layouts.filter(l => l.disabled).length >= 1,
    'and the ones above this level are disabled, not hidden',
    shown.layouts.filter(l => l.disabled).map(l => l.id).join(','));

  // Cancelling leaves the shop exactly where it was.
  await p.click('#reopenCancel');
  await wait(250);
  const cancelled = await p.evaluate(() => ({
    open: document.getElementById('reopenOverlay').classList.contains('show'),
    day: window.__CK_DEBUG__.state.day, money: window.__CK_DEBUG__.state.money,
  }));
  t.ok(!cancelled.open && cancelled.day === 12 && cancelled.money === 4000,
    'cancelling closes the ledger and changes nothing', `day ${cancelled.day}, $${cancelled.money}`);

  // Reopen for real, into the base layout, and check both the DOM and the save.
  await p.click('[data-prestige]');
  await wait(250);
  await p.click('#reopenLayouts [data-layout="corner"]');
  await wait(600);
  const after = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { open: document.getElementById('reopenOverlay').classList.contains('show'),
      day: s.day, money: s.money, level: s.prestigeLevel, beans: s.meta.beans,
      layout: s.layoutId, upgrades: s.upgrades.size, staff: s.baristas.length,
      dayLabel: document.getElementById('dayNum').textContent };
  });
  t.ok(!after.open, 'picking a layout closes the ledger');
  t.ok(after.day === 1 && after.money === 80 && after.level === 1,
    'and the shop reopened at level 1 on day 1 with $80', `day ${after.day}, $${after.money}, level ${after.level}`);
  t.ok(after.dayLabel === '1', 'the topbar redrew to day 1', after.dayLabel);
  t.ok(after.upgrades === 0 && after.staff === 0, 'the upgrades and the barista went, as the ledger said');
  // 5 for the eleven days past the first, 3 for reputation 70.
  t.ok(after.beans === 8, 'and the beans the ledger promised arrived', `${after.beans} beans`);

  // Only what a reload has to survive is asserted against the save (#39).
  const savedAfter = await savedState(p);
  t.ok(savedAfter && savedAfter.meta && savedAfter.meta.beans === 8,
    'the beans are in the save, not only on screen', JSON.stringify(savedAfter && savedAfter.meta));
  t.ok(savedAfter && savedAfter.layoutId === 'corner', 'so is the layout the run opened in');
  t.ok(savedAfter && savedAfter.prestigeLevel === 1, 'so is the level');

  // The Legacy board spends them, and a reload keeps what they bought.
  const legacyTree = await p.$$eval('[data-buy-meta]', els => els.map(e => ({ id: e.dataset.buyMeta, disabled: e.disabled, label: e.textContent.trim() })));
  t.ok(legacyTree.length >= 4, 'the Legacy section lists the tree', legacyTree.map(l => l.id).join(','));
  t.ok(legacyTree.some(l => !l.disabled), 'with at least one affordable on 8 beans',
    legacyTree.filter(l => !l.disabled).map(l => l.id).join(','));
  t.ok(legacyTree.every(l => /\d+/.test(l.label)), 'and every button prints its bean price', legacyTree[0] && legacyTree[0].label);
  const gatedBtn = legacyTree.find(l => l.id === 'menuColdbrew');
  t.ok(gatedBtn && gatedBtn.disabled, 'a gated entry is disabled until its parent is bought');

  await clickInChalkboard(p, '[data-buy-meta="thirdCounter"]');
  await wait(500);
  const spent = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { beans: s.meta.beans, owns: [...s.meta.unlocks], money: s.money };
  });
  t.ok(spent.beans === 4 && spent.owns.includes('thirdCounter'),
    'buying one takes beans, not dollars', `${spent.beans} beans left, $${spent.money}`);
  t.ok(spent.money === 80, 'the till is untouched by a bean purchase', `$${spent.money}`);
  const savedSpent = await savedState(p);
  t.ok(savedSpent.meta.beans === 4 && savedSpent.meta.unlocks.includes('thirdCounter'),
    'and the purchase reached the save at once, not on the next autosave tick');

  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const reloaded = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { beans: s.meta.beans, owns: [...s.meta.unlocks], level: s.prestigeLevel, layout: s.layoutId };
  });
  t.ok(reloaded.beans === 4 && reloaded.owns.includes('thirdCounter'),
    'a reload comes back holding the beans and the unlock', `${reloaded.beans} beans, ${reloaded.owns.join(',')}`);
  t.ok(reloaded.level === 1 && reloaded.layout === 'corner', 'and the level and layout it reopened in');

  // The keyboard must not reach the shop through the ledger: the digits switch
  // station tabs, and an overlay the player has to answer should swallow them.
  // Day 12 again so the reopen row is back, and asked to repaint: setting the
  // day by hand changes nothing the game did, so nothing redraws on its own.
  await p.evaluate(() => { window.__CK_DEBUG__.state.day = 12; window.__CK_DEBUG__.renderAll(); });
  // The reload closed the chalkboard, and a panel translated off-screen has no
  // clickable point at all — not the same failure as a row scrolled out of
  // view, and not one scrollIntoView can fix. Open it first (section 11).
  await p.click('#chalkToggle');
  await wait(400);
  t.ok(await p.$eval('#chalkboard', el => el.classList.contains('open')), 'the chalkboard reopens after a reload');
  await clickInChalkboard(p, '[data-prestige]');
  await wait(250);
  const tabBefore = await p.evaluate(() => window.__CK_DEBUG__.state.stationTab);
  await p.keyboard.press('4');
  await wait(200);
  const tabAfter = await p.evaluate(() => window.__CK_DEBUG__.state.stationTab);
  t.ok(tabBefore === tabAfter, 'a digit pressed over the ledger does not switch station tabs behind it',
    `${tabBefore} -> ${tabAfter}`);
  await p.click('#reopenCancel');
  await wait(200);

  t.ok(p.__errs.filter(e => e.startsWith('pageerror')).length === 0,
    'and no uncaught page error through any of it', p.__errs.join(' | ') || 'clean');

  /* ---------- 13. mobile ---------- */

  t.section('13. mobile at 375x812');
  const mp = await prepPage(browser, BASE, { width: 375, height: 812, dsf: 2, mobile: true });
  await mp.goto(PAGE, { waitUntil: 'load' });
  await waitFor(mp, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const mob = await mp.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    slots: document.querySelectorAll('.slot').length,
    tabs: document.querySelectorAll('.stationTab').length,
    barButtons: document.querySelectorAll('#save-bar button').length,
  }));
  t.ok(mob.overflow <= 1, 'the page does not scroll sideways on a phone', `${mob.overflow}px overflow`);
  t.ok(mob.slots === 2 && mob.tabs === 7, 'both stations and all seven tabs render');
  t.ok(mob.barButtons === 2, 'and the save bar is reachable there too');
  await mp.close();
  }

  /* ---------- 15. without colour, and without motion ---------- */
  // What the page used to say by hue alone (#916), read off the DOM as text,
  // attributes and computed shapes, and prefers-reduced-motion (#917) on the
  // page's real stylesheet. Its own page and a wiped save, so `--a11y` can run
  // it alone.

  t.section('15. without colour, and without motion (#916, #917)');
  const ap = await prepPage(browser, BASE, { width: 1280, height: 1000, dsf: 1 });
  await boot(ap, { wipe: true });
  const reduceMotion = on => ap.__engine === 'puppeteer'
    ? ap.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }])
    : ap.emulateMedia({ reducedMotion: on ? 'reduce' : 'no-preference' });
  await reduceMotion(false);

  // Two orders the test wrote: a Latte with oat milk and vanilla, and a bagel.
  const ids = await ap.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.queue = [];
    const a = d.generateOrder();
    Object.assign(a, { isFood: false, isRegular: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: 'vanilla', toppings: [], ice: false } });
    const b = d.generateOrder();
    Object.assign(b, { isFood: true, isRegular: false, foodId: 'bagel', price: 26 });
    d.state.queue.push(a, b);
    d.renderAll();
    return { a: a.id, b: b.id };
  });
  const titles = await ap.$$eval('.customer', els => els.map(e => e.title));
  t.ok(titles[0] === 'Wants: Latte, Oat Milk, Vanilla syrup' && titles[1] === 'Wants: Bagel',
    'a queue card says its order in words on hover, the syrup and the milk included', titles.join(' | '));

  await ap.evaluate(id => window.__CK_DEBUG__.tryAcceptCustomer(id), ids.a);
  await ap.waitForSelector('.slot .ticket');
  /** Everything section 15 reads off the counter, in one pass. */
  const counter = () => ap.evaluate(() => {
    const d = window.__CK_DEBUG__;
    const slot = d.state.slots[d.state.focusedSlot];
    return {
      notes: [...document.querySelectorAll('.slot')].map(el => el.querySelector('.cupnote')?.textContent ?? null),
      current: [...document.querySelectorAll('.slot')].map(el => el.getAttribute('aria-current')),
      marks: [...document.querySelectorAll('.slot')].map(el => {
        const cs = getComputedStyle(el, '::before');
        return cs.content === 'none' ? 0 : parseFloat(cs.borderLeftWidth) || 0;
      }),
      need: slot ? [...d.sim.stationsNeedingWork(slot)].sort().join(',') : '',
      tabs: [...document.querySelectorAll('.stationTab')].map(el => ({
        id: el.dataset.tab,
        dot: !!el.querySelector('.needdot'),
        ring: el.querySelector('.needdot') ? getComputedStyle(el.querySelector('.needdot')).boxShadow : 'none',
        said: /, still needed$/.test(el.textContent),
        hover: /still needs something here/.test(el.title),
        hiddenWidth: el.querySelector('.sronly') ? el.querySelector('.sronly').getBoundingClientRect().width : 0,
        pressed: el.getAttribute('aria-pressed'),
        active: el.classList.contains('active'),
      })),
      lines: [...document.querySelectorAll('.slot.focused .ticket .want li')].map(li => ({
        text: li.textContent, done: li.classList.contains('done'),
        bullet: getComputedStyle(li, '::before').content, struck: getComputedStyle(li).textDecorationLine,
      })),
    };
  });
  const dotted = c => c.tabs.filter(x => x.dot).map(x => x.id).sort().join(',');

  let c = await counter();
  t.ok(c.notes[0] === 'Empty cup', 'an empty cup says so under its picture', String(c.notes[0]));
  t.ok(c.current[0] === 'true' && c.current[1] === null, 'the focused station is marked aria-current, the other is not', c.current.join(' | '));
  t.ok(c.marks[0] === 8 && c.marks[1] === 0, 'and carries a corner mark the other does not (a shape, not a border colour)', c.marks.join(' | '));
  t.ok(c.need === 'base,milk,syrup' && dotted(c) === c.need, 'the dots are on the three tabs the ticket needs', `${dotted(c)} against ${c.need}`);
  t.ok(c.tabs.every(x => x.said === x.dot && x.hover === x.dot), 'a tab with a dot says "still needed" in its name and on hover, and a tab without does not',
    c.tabs.map(x => `${x.id}:${x.dot ? 'dot' : '-'}${x.said ? '+said' : ''}${x.hover ? '+hover' : ''}`).join(' '));
  t.ok(c.tabs.filter(x => x.dot).every(x => x.ring !== 'none' && x.hiddenWidth <= 1), 'the dot is ringed, and its words take no room on screen',
    c.tabs.filter(x => x.dot).map(x => `${x.ring} ${x.hiddenWidth}px`)[0]);
  t.ok(c.tabs.every(x => x.pressed === String(x.active)) && c.tabs.filter(x => x.pressed === 'true').length === 1,
    'aria-pressed is true on the open tab and false on the other six');

  // A shot and cold oat milk through the sim's own action table.
  await ap.evaluate(() => {
    const d = window.__CK_DEBUG__, slot = d.state.slots[0];
    d.sim.cupAction(slot, 'pullShot'); d.sim.cupAction(slot, 'pickMilk', 'oat');
    d.state.stationTab = 'milk';
    d.renderAll();
  });
  c = await counter();
  t.ok(c.notes[0] === '1 espresso shot · Oat Milk', 'the line under the cup reads what is in it', String(c.notes[0]));
  t.ok(dotted(c) === 'milk,syrup' && c.need === 'milk,syrup', 'the Base dot is gone with its words', dotted(c));
  const doneLine = c.lines.find(l => l.done), openLine = c.lines.find(l => !l.done);
  t.ok(doneLine && /✓/.test(doneLine.bullet) && /line-through/.test(doneLine.struck) && /espresso shot/.test(doneLine.text),
    'a finished ticket line is ticked and struck through', doneLine ? `${doneLine.bullet} ${doneLine.struck}` : 'none done');
  t.ok(openLine && /•/.test(openLine.bullet) && !/line-through/.test(openLine.struck), 'and an open one is a bullet, not struck',
    openLine ? `${openLine.bullet} ${openLine.struck}` : 'none open');
  const milks = await ap.$$eval('[data-milk]', els => els.map(e => `${e.dataset.milk}:${e.getAttribute('aria-pressed')}:${e.classList.contains('selected')}`).join(' '));
  t.ok(/oat:true:true/.test(milks) && (milks.match(/:false:false/g) || []).length === 3, 'the picked milk is aria-pressed, the other three are not', milks);

  // The plate's picture is the bagel either way; only the words change.
  await ap.evaluate(id => window.__CK_DEBUG__.tryAcceptCustomer(id), ids.b);
  await waitFor(ap, () => document.querySelectorAll('.slot .ticket').length === 2, { timeout: 3000 });
  c = await counter();
  const plateArt = () => ap.$eval('.slot.focused .cupwrap', el => el.innerHTML);
  const artBefore = await plateArt();
  t.ok(c.notes[1] === 'Nothing plated yet', 'an unplated food order says nothing is plated', String(c.notes[1]));
  t.ok(c.current[0] === null && c.current[1] === 'true' && c.marks[0] === 0 && c.marks[1] === 8, 'the mark and aria-current moved with the focus', `${c.current.join(' | ')} / ${c.marks.join(' | ')}`);
  await ap.evaluate(() => { const d = window.__CK_DEBUG__; d.sim.cupAction(d.state.slots[1], 'plateFood', 'bagel'); d.renderAll(); });
  c = await counter();
  t.ok(c.notes[1] === 'Plated: Bagel' && artBefore === await plateArt(), 'plated, the words change and the picture does not', String(c.notes[1]));
  const foods = await ap.$$eval('[data-food]', els => els.map(e => `${e.dataset.food}:${e.getAttribute('aria-pressed')}`).join(' '));
  t.ok(/bagel:true/.test(foods) && /croissant:false/.test(foods), 'and the plated food\'s button is aria-pressed', foods);

  // ---- reduced motion ----
  /** Put every animated state on screen at once and read what the stylesheet
   *  makes of it, synchronously, so no redraw can take the classes away. */
  const motion = () => ap.evaluate(() => {
    const d = window.__CK_DEBUG__;
    d.state.stationTab = 'base'; d.state.focusedSlot = 0;
    d.state.queue.push(d.generateOrder());
    d.renderAll();
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.textContent = 'section 15';
    document.getElementById('toastWrap').appendChild(toast);
    const slots = document.querySelectorAll('.slot');
    slots[0].classList.add('serving'); slots[1].classList.add('baristaWorking');
    const cust = document.querySelector('.customer');
    cust.classList.add('served');
    const cs = (el) => getComputedStyle(el);
    const secs = v => v.split(',').map(x => parseFloat(x) || 0).reduce((a, b) => Math.max(a, b), 0);
    const moving = [...document.querySelectorAll('*')].filter(el =>
      cs(el).animationName !== 'none' || secs(cs(el).transitionDuration) > 0)
      .map(el => (el.id ? '#' + el.id : '.' + [...el.classList].join('.')));
    const out = {
      moving: [...new Set(moving)].sort(),
      toast: { anim: cs(toast).animationName, opacity: cs(toast).opacity },
      serving: { anim: cs(slots[0]).animationName, opacity: cs(slots[0]).opacity },
      pulse: { anim: cs(slots[1]).animationName, ring: cs(slots[1]).boxShadow },
      served: { anim: cs(cust).animationName, opacity: cs(cust).opacity },
      chalk: secs(cs(document.getElementById('chalkboard')).transitionDuration),
      bar: secs(cs(document.querySelector('.progressfill')).transitionDuration),
    };
    // The board opens instantly or it slides: read where it is in the same
    // task as the click, before a frame can move it.
    const board = document.getElementById('chalkboard');
    document.getElementById('chalkToggle').click();
    out.boardLeft = Math.round(board.getBoundingClientRect().left);
    out.viewport = document.documentElement.clientWidth;
    document.getElementById('chalkToggle').click();
    toast.remove();
    d.state.queue.pop();
    d.renderAll();
    return out;
  });
  const withMotion = await motion();
  t.ok(withMotion.toast.anim === 'toastpop' && withMotion.serving.anim === 'slotServed' && withMotion.pulse.anim === 'baristaPulse'
    && withMotion.served.anim === 'walkoff' && withMotion.chalk === 0.35,
    'with motion wanted, the four animations and the board\'s slide are all there (the control)',
    `${withMotion.toast.anim} ${withMotion.serving.anim} ${withMotion.pulse.anim} ${withMotion.served.anim} ${withMotion.chalk}s`);
  t.ok(withMotion.moving.length >= 9 && withMotion.boardLeft >= withMotion.viewport, 'and the board is still off screen in the task that opened it',
    `${withMotion.moving.length} kinds of moving element, board at ${withMotion.boardLeft} of ${withMotion.viewport}`);

  await reduceMotion(true);
  const still = await motion();
  t.ok(still.moving.length === 0, 'under prefers-reduced-motion no element has an animation or a transition', still.moving.join(' ') || 'none');
  t.ok(still.toast.anim === 'none' && still.toast.opacity === '1', 'a toast does not animate and is fully visible', `${still.toast.anim} opacity ${still.toast.opacity}`);
  t.ok(still.serving.anim === 'none' && still.serving.opacity === '0.45', 'a served station dims in place', `${still.serving.anim} opacity ${still.serving.opacity}`);
  t.ok(still.pulse.anim === 'none' && still.pulse.ring !== 'none', 'a barista\'s station keeps a steady ring instead of a pulse', still.pulse.ring);
  t.ok(still.served.anim === 'none' && still.served.opacity === '0', 'a served customer is gone without the walk-off');
  t.ok(still.chalk === 0 && still.bar === 0 && still.boardLeft < still.viewport, 'the board is open in the task that opened it',
    `board at ${still.boardLeft} of ${still.viewport}`);

  // And the shop plays the same: a timed button lands, a serve pays, the
  // clock clears the station and the toast leaves on its timer.
  await ap.evaluate(() => {
    const d = window.__CK_DEBUG__, slot = d.state.slots[0];
    d.state.focusedSlot = 0; d.state.stationTab = 'milk';
    d.sim.cupAction(slot, 'pickSyrup', 'vanilla');
    d.renderAll();
  });
  await ap.click('#btnSteam');
  await waitFor(ap, () => window.__CK_DEBUG__.state.slots[0].cup.milkSteamed, { timeout: 5000 });
  t.ok(true, 'Steam Milk still runs its bar to the end and lands');
  c = await counter();
  t.ok(c.notes[0] === '1 espresso shot · Oat Milk, steamed · Vanilla syrup' && dotted(c) === '', 'the finished cup reads as its ticket and no tab has a dot', String(c.notes[0]));
  const moneyThen = await ap.evaluate(() => window.__CK_DEBUG__.state.money);
  await ap.click('.slot.focused .servebtn');
  const paid = await ap.evaluate(() => ({ money: window.__CK_DEBUG__.state.money,
    toast: [...document.querySelectorAll('.toast')].map(e => `${e.textContent} @${getComputedStyle(e).opacity}`).join(' | ') }));
  t.ok(paid.money > moneyThen && /Served! \+\d+.* @1/.test(paid.toast), 'the serve pays and its toast is readable at once', `$${moneyThen} -> $${paid.money}, ${paid.toast}`);
  await waitFor(ap, () => window.__CK_DEBUG__.state.slots[0] === null, { timeout: 4000 });
  t.ok(true, 'the clock clears the served station, with no animation to wait on');
  await wait(2500);
  t.ok(await ap.$$eval('.toast', els => els.filter(e => /Served!/.test(e.textContent)).length) === 0, 'and the toast leaves on its timer');
  t.ok(ap.__errs.filter(e => e.startsWith('pageerror')).length === 0, 'no uncaught page error through any of it', ap.__errs.join(' | ') || 'clean');
  await ap.close();

} finally {
  await p.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();
}

process.stdout.write(`\n${passed} checks, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.exit(1);
}
