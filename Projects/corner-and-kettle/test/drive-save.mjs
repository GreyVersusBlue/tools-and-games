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
const PAGE = `${BASE}/Projects/coffee_shop_sim.html`;
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
  const html = fs.readFileSync(path.resolve(HERE, '..', '..', 'coffee_shop_sim.html'), 'utf8');
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

  const moneyBefore = await p.evaluate(() => window.__CK_DEBUG__.state.money);

  // Base: pull a shot. This is a runProgress() button — the callback only fires
  // if requestAnimationFrame is running, which is the whole reason for the
  // no-backgrounding flags.
  await p.click('.stationTab[data-tab="base"]');
  await p.click('#btnEspresso');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.shots >= 1, { timeout: 5000 });
  t.ok(true, 'Pull Espresso Shot ran its progress bar to the end and landed a shot');

  await p.click('.stationTab[data-tab="milk"]');
  await p.click('[data-milk="oat"]');
  await p.click('#btnSteam');
  await waitFor(p, () => window.__CK_DEBUG__.state.slots[0].cup.milkSteamed, { timeout: 5000 });
  t.ok(true, 'Steam Milk ran its progress bar to the end');

  const done = await p.evaluate(() => window.__CK_DEBUG__.orderIsComplete(window.__CK_DEBUG__.state.slots[0]));
  t.ok(done, 'the ticket is complete');
  const dots = await p.$$eval('.stationTab .needdot', els => els.length);
  t.ok(dots === 0, 'and no station tab still shows a needed-work dot', `${dots} dots`);

  await p.click('.slot .servebtn');
  await wait(900);
  const moneyAfter = await p.evaluate(() => window.__CK_DEBUG__.state.money);
  t.ok(moneyAfter > moneyBefore, 'serving it paid', `$${moneyBefore} -> $${moneyAfter}`);
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.combo >= 1), 'and started a streak');
  t.ok(await p.evaluate(() => window.__CK_DEBUG__.state.slots[0] === null), 'the station cleared');

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
    s.baristas = [{ id: 'b1', name: 'Juno', level: 2, spec: 'bar', trained: true, working: true, targetSlot: null, acc: 0 }];
    s.presets = [{ id: 'p1', name: 'Oat Vanilla Latte', cup: { base: 'espresso', shots: 2, milk: 'oat',
      milkSteamed: true, syrup: 'vanilla', toppings: ['whip'], ice: false, blended: false } }];
    s.regulars = { Nora: { isFood: false, recipeId: 'latte', price: 45,
      custom: { milk: 'oat', syrup: 'vanilla', toppings: ['whip'], ice: false } } };
    d.saveState();
    return { day: s.day, money: s.money };
  });

  await p.goto(PAGE, { waitUntil: 'load' });
  await waitFor(p, () => !!window.__CK_DEBUG__, { timeout: 10000 });
  const back = await p.evaluate(() => {
    const s = window.__CK_DEBUG__.state;
    return { day: s.day, money: s.money, stations: s.slots.length, staff: s.baristas.length,
      staffLevel: s.baristas[0]?.level, staffSpec: s.baristas[0]?.spec,
      presetShots: s.presets[0]?.cup.shots, presetName: s.presets[0]?.name,
      regulars: Object.keys(s.regulars), nora: s.regulars.Nora,
      frappe: s.unlockedRecipes.has('frappe'), grinder: s.upgrades.has('grinder'),
      loyalty: s.loyaltyLevel, shields: s.comboShields, rep: s.reputation };
  });
  t.ok(back.day === 9 && back.money === warped.money, 'day and takings survived the reload', `day ${back.day}, $${back.money}`);
  t.ok(back.stations === 3, 'the bought third station survived');
  t.ok(back.staff === 1 && back.staffLevel === 2 && back.staffSpec === 'bar', 'Juno came back a bar-specialist Senior');
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
  t.ok(back.nora?.recipeId === 'latte' && back.nora?.custom?.milk === 'oat'
    && back.nora?.custom?.toppings?.join(',') === 'whip',
    'with her standing order intact', JSON.stringify(back.nora?.custom));
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
      regularIsFood: s.regulars.Otis?.isFood, regularFoodId: s.regulars.Otis?.foodId };
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
