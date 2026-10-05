// anathema.test.mjs — the test suite Anathema Archive didn't have.
//
//   node "Pathfinder/tests/anathema.test.mjs"
//
// Drives a real headless browser at the real page and real data via
// Tools/board-check/harness.mjs's serve()/launch()/prepPage() (run only, per
// this project's boundary — not edited). Covers the four things flagged as
// hand-tested-only: the level-bar anchor/range state machine, npc shard
// load/unload sync (including the open-detail-pane-just-unloaded case),
// hash-routing round trips (including the 3-segment npc/<level>/<name> form),
// and bookmark-stub resolution. Since 2026-10-05 it also drives the filters,
// deep search, the bookmark export and import round trip, and the keyboard,
// back button and edited-URL navigation, each through the control a user
// would use, asserting what the page then shows. Exits non-zero on any failure.
//
// Two environment variables, both for breaking the page on purpose (#34):
//   ANATHEMA_PAGE=<file>  drive a scratch copy sitting beside the page in
//                         Pathfinder/ (it needs the same relative data/), so the
//                         real page is never edited to watch an assertion fail
//   ANATHEMA_ONLY=a,b     run only the named scenarios

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../Tools/board-check/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8140; // see Tools/board-check/README for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/Pathfinder/${process.env.ANATHEMA_PAGE || 'Anathema_Archive.html'}`;

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};

/* Polls `page.evaluate(fn, opts.arg)` until truthy. `fn` must take its inputs
   through the single `arg` parameter — page.evaluate re-parses the function
   source in the browser, so it cannot close over this file's Node-side
   variables the way an ordinary JS closure would. */
async function waitFor(page, fn, opts = {}) {
  const { timeout = 8000, interval = 100, label = 'condition', arg } = opts;
  const start = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${label}`);
    await new Promise(r => setTimeout(r, interval));
  }
}

async function freshPage(browser, hash = '', width = 1280) {
  const page = await prepPage(browser, BASE, { width, height: 900 });
  page.setDefaultTimeout(20000);
  await page.goto(URL + hash, { waitUntil: 'load' });
  await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'S.manifest loaded' });
  return page;
}

/* A chip click re-renders #shardbar. Puppeteer's page.click queries the element
   and then scrolls to it and measures it before pressing the mouse, and a
   re-render landing in between throws "Node is detached from document" or
   "Node is either not clickable or not an Element". Both are thrown before the
   mouse goes down, so a retry cannot double-click. Playwright re-queries on its
   own, so this never failed on Windows; on Linux, where the harness launches
   Puppeteer, the unwrapped helper passed 1 run in 10 (#353). Re-query and click
   again on those two errors only; anything else still throws. */
async function click(page, selector) {
  for (let attempt = 1; ; attempt++) {
    try { return await page.click(selector); }
    catch (e) {
      if (attempt >= 10 || !/detached from document|not clickable or not an Element/.test(String(e?.message))) throw e;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

async function clickCat(page, type) {
  await click(page, `.cat[data-type="${type}"]`);
  await waitFor(page, t => S.cat === t, { label: `S.cat === ${type}`, arg: type });
}

async function clickLevelChip(page, lvl) {
  await click(page, `#shardbar .chip[data-lvl="${lvl}"]`);
}

/* Known-good fixtures pulled straight from the real data files (checked once
   with node -e against Pathfinder/data/spell.json and data/npcs/npc-level-0.json
   before writing this file — not invented): */
const FIREBALL = { name: 'Fireball', level: 3 };
const OOZELET = { name: 'Acid Oozelet', id: 'FD4aoeVkKq0vjTIK', level: 0 };

/* ============================ 1. level-bar anchor/range state machine ============================ */
async function testLevelBar(browser) {
  console.log('\nlevel-bar anchor/range selection (npc scope)');
  const page = await freshPage(browser);
  await clickCat(page, 'npc');

  await clickLevelChip(page, -1);
  ok(await page.evaluate(() => S.lvlAnchor) === -1, 'first click sets lvlAnchor to that level');
  ok(await page.evaluate(() => S.lvlRange) === null, 'first click leaves lvlRange null');
  ok(await page.$eval('#shardbar .chip[data-lvl="-1"]', el => el.classList.contains('anchor')),
    'anchor chip carries .anchor class');

  await clickLevelChip(page, 0);
  const range1 = await page.evaluate(() => S.lvlRange);
  ok(JSON.stringify(range1) === JSON.stringify([-1, 0]), 'second click completes the range [lo,hi]', JSON.stringify(range1));
  for (const l of [-1, 0]) {
    ok(await page.$eval(`#shardbar .chip[data-lvl="${l}"]`, el => el.classList.contains('on')),
      `level ${l} chip is marked .on as part of the completed range`);
  }

  await clickLevelChip(page, -1); // clicking the anchor again clears everything
  ok(await page.evaluate(() => S.lvlAnchor) === null, 'clicking the anchor again clears lvlAnchor');
  ok(await page.evaluate(() => S.lvlRange) === null, 'clicking the anchor again clears lvlRange');

  await clickLevelChip(page, 1);
  await clickLevelChip(page, 2);  // range [1,2], anchor stays 1
  await clickLevelChip(page, 24); // neither the anchor nor mid-range: starts a fresh single-level pick
  ok(await page.evaluate(() => S.lvlAnchor) === 24, 'a click after a completed range starts a fresh anchor');
  ok(await page.evaluate(() => S.lvlRange) === null, 'a click after a completed range clears the old range');

  await page.close();
}

/* ============================ 2. npc shard load/unload sync ============================ */
async function testShardSync(browser) {
  console.log('\nnpc shard sync (load, unload, and the open-detail-just-unloaded case)');
  const page = await freshPage(browser);
  await clickCat(page, 'npc');

  await clickLevelChip(page, OOZELET.level);
  await waitFor(page, l => S.npcLoaded.has(l), { label: 'shard 0 loaded', arg: OOZELET.level });
  const loaded1 = await page.evaluate(() => [...S.npcLoaded]);
  ok(loaded1.length === 1 && loaded1[0] === 0, 'selecting level 0 loads exactly that shard', JSON.stringify(loaded1));
  const npcCount = await page.evaluate(() => S.cache.npc.length);
  ok(npcCount === 139, 'level-0 shard loads its full 139 entries', String(npcCount));

  // open a detail pane for an entry in the shard we just loaded
  await page.evaluate((id) => openDetail(S.cache.npc.find(x => x._id === id)), OOZELET.id);
  const openedName = await page.evaluate(() => S.curEntry?.name);
  ok(openedName === OOZELET.name, 'detail pane opened for the loaded entry', String(openedName));
  ok(await page.$eval('#detail', el => el.classList.contains('open')), 'detail pane has .open');

  // widen the range to include level 0 plus level 1 — level 0 stays loaded, detail stays open
  await clickLevelChip(page, 1); // anchor 0, second click -> range [0,1]
  await waitFor(page, () => S.npcLoaded.has(0) && S.npcLoaded.has(1), { label: 'shards 0..1 loaded' });
  ok(await page.evaluate(() => S.curEntry?.name) === OOZELET.name,
    'widening the range without dropping level 0 leaves the open detail pane alone');

  // click the anchor (0) again: clears the whole selection, drops every loaded shard,
  // including the one backing the currently-open detail pane
  await clickLevelChip(page, 0);
  await waitFor(page, () => S.npcLoaded.size === 0, { label: 'all shards unloaded' });
  const loaded2 = await page.evaluate(() => [...S.npcLoaded]);
  ok(loaded2.length === 0, 'clearing the level selection unloads every shard', JSON.stringify(loaded2));
  const npcCount2 = await page.evaluate(() => S.cache.npc.length);
  ok(npcCount2 === 0, 'S.cache.npc is emptied once its only shards unload', String(npcCount2));
  ok(await page.evaluate(() => S.curEntry) === null,
    'the detail pane whose entry just got unloaded is cleared (S.curEntry)');
  ok(await page.evaluate(() => S.selId) === null, '...and S.selId is cleared too');
  ok(!(await page.$eval('#detail', el => el.classList.contains('open'))),
    '...and the detail pane itself closes (.open removed)');

  await page.close();
}

/* ============================ 3. hash-routing round trips ============================ */
async function testHashRouting(browser) {
  console.log('\nhash-routing round trips');

  // 2-segment: #category/name
  {
    const page = await freshPage(browser, `#spell/${encodeURIComponent(FIREBALL.name)}`);
    await waitFor(page, name => S.curEntry?.name === name, { label: 'Fireball opened from hash', arg: FIREBALL.name });
    const name = await page.evaluate(() => S.curEntry?.name);
    ok(name === FIREBALL.name, '#spell/Fireball opens the Fireball entry on load', String(name));
    ok(await page.evaluate(() => S.cat) === 'spell', 'and sets scope to spell');
    await page.close();
  }

  // 3-segment: #npc/<level>/<name> — the form that carries the shard level so a link
  // can restore a creature without the page having to guess which shard holds it
  {
    const page = await freshPage(browser, `#npc/${OOZELET.level}/${encodeURIComponent(OOZELET.name)}`);
    await waitFor(page, name => S.curEntry?.name === name, { label: 'Acid Oozelet opened from 3-segment hash', arg: OOZELET.name });
    ok(await page.evaluate(l => S.npcLoaded.has(l), OOZELET.level), '3-segment hash loads the named shard level');
    ok(await page.evaluate(() => S.curEntry?.name) === OOZELET.name, '...and opens the named entry');
    ok(await page.evaluate(() => S.lvlAnchor) === OOZELET.level, '...and sets the level-bar anchor to match');
    await page.close();
  }

  // round trip: opening an entry through the UI produces the hash applyHash expects to consume
  {
    const page = await freshPage(browser);
    await clickCat(page, 'npc');
    await clickLevelChip(page, OOZELET.level);
    await waitFor(page, l => S.npcLoaded.has(l), { label: 'shard loaded for round trip', arg: OOZELET.level });
    await page.evaluate((id) => openDetail(S.cache.npc.find(x => x._id === id)), OOZELET.id);
    const hash = await page.evaluate(() => location.hash);
    const expected = `#npc/${OOZELET.level}/${encodeURIComponent(OOZELET.name)}`;
    ok(hash === expected, 'opening a creature writes the 3-segment #npc/<level>/<name> hash', hash);
    await page.close();
  }

  // unknown category degrades to the All-Categories fallback rather than crashing
  {
    const page = await freshPage(browser, '#not-a-real-category/Something');
    await waitFor(page, () => S.cat === '__all__', { label: 'fell back to All Categories', timeout: 5000 });
    ok(await page.evaluate(() => S.cat) === '__all__', 'an unrecognized hash category falls back to All Categories scope');
    ok(page.__errs.length === 0, '...without throwing any page or console errors', page.__errs.slice(0, 3).join(' | '));
    await page.close();
  }
}

/* ============================ 4. bookmark-stub resolution ============================ */
async function testBookmarkResolution(browser) {
  console.log('\nbookmark-stub resolution');
  const page = await freshPage(browser);
  // seed a bookmark stub the way saveBookmarks() would have written one, then reload so
  // the boot sequence picks it up via loadBookmarks()
  await page.evaluate((b) => localStorage.setItem('aa.bookmarks', JSON.stringify([b])),
    { type: 'npc', level: OOZELET.level, name: OOZELET.name, _id: OOZELET.id });
  await page.goto(URL, { waitUntil: 'load' });
  await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'reloaded with seeded bookmark' });

  await clickCat(page, 'bookmarks');
  const stubCount = await page.evaluate(() => S.filtered.length);
  ok(stubCount === 1, 'the bookmarked-category list shows the one seeded stub', String(stubCount));
  const isStub = await page.evaluate(() => S.filtered[0]._bm === true);
  ok(isStub, 'the row is a stub ({_bm:true}), not yet the resolved entry');

  await click(page, '#vspacer .row[data-i="0"]');
  await waitFor(page, name => S.curEntry?.name === name, { label: 'stub resolved to a real entry', arg: OOZELET.name });
  const resolvedName = await page.evaluate(() => S.curEntry?.name);
  ok(resolvedName === OOZELET.name, 'clicking the stub lazy-loads its shard and opens the real entry', String(resolvedName));
  const hasSystem = await page.evaluate(() => !!(S.curEntry && S.curEntry.system));
  ok(hasSystem, 'the resolved entry is the full record (has .system), not the bare stub');
  ok(await page.evaluate(l => S.npcLoaded.has(l), OOZELET.level), '...having lazy-loaded the correct shard to find it');

  await page.close();
}

/* ============================ helpers for scenarios 5 to 9 ============================ */
/* The expected numbers below are counted here, in Node, from the same data
   files the page fetches, with one plain predicate each. They are not literals
   because `fetch json data.py` refreshes the data, and not read back from the
   page because that would be the page marking its own work. Every count is
   also checked to be a real cut (more than none, fewer than all) where that is
   the point of the step. */
const DATA = name => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', `${name}.json`), 'utf8'));
const fmt = n => n.toLocaleString('en-US');
const countLine = (n, total) => `${fmt(n)} of ${fmt(total)} entries`;
const collate = new Intl.Collator('en').compare; // not localeCompare: under LANG=C Node's default locale is en-US-u-va-posix
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* What the user can read off the page. */
const countText = page => page.$eval('#count', el => el.textContent);
const rowNames = page => page.$$eval('#vspacer .row .nm', els => els.map(el => el.textContent));
const selName = page => page.evaluate(() => document.querySelector('#vspacer .row.sel .nm')?.textContent ?? null);
const openName = page => page.evaluate(() => $('detail').classList.contains('open') ? (document.querySelector('#detail h2')?.textContent ?? null) : null);
const statusText = page => page.$eval('#status', el => el.textContent);
const textOf = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent ?? null, sel);
const bookmarksInStorage = page => page.evaluate(() => JSON.parse(localStorage.getItem('aa.bookmarks') || '[]'));

/* Polls `read(page)` until it equals `want`, then records one check. Unlike
   waitFor it does not throw: a miss is a FAIL line carrying what the page
   showed instead, and the scenario goes on. */
async function shows(page, label, read, want, timeout = 6000) {
  const start = Date.now();
  let got;
  for (;;) {
    got = await read(page);
    if (same(got, want) || Date.now() - start > timeout) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const hit = same(got, want);
  ok(hit, label, hit ? '' : `wanted ${JSON.stringify(want)}, page shows ${JSON.stringify(got)}`.slice(0, 400));
  return hit;
}

/* Storage is per origin and the harness's Linux engine opens every page in one
   context, so a scenario that reads or writes localStorage starts by emptying
   it. A hash that names a category also keeps the boot from fetching every
   category for the All scope, which no scenario below needs until it asks. */
async function cleanPage(browser, hash = '') {
  const page = await freshPage(browser, hash);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'S.manifest loaded after clearing storage' });
  return page;
}

/* Real keystrokes into a field, and a real select. */
async function typeInto(page, selector, text) {
  await page.focus(selector);
  await page.type(selector, text);
}
async function clearField(page, selector) {
  await page.focus(selector);
  const n = await page.$eval(selector, el => { el.select(); return el.value.length; });
  if (n) await page.keyboard.press('Backspace');
}
const choose = (page, selector, value) =>
  page.selectOption ? page.selectOption(selector, value) : page.select(selector, value);

/* ============================ 5. the filters ============================ */
async function testFilters(browser) {
  console.log('\nthe filters (spell scope): search, rarity, source, tradition, type, sort, rank, traits, source mode, scope');
  const spells = DATA('spell');
  const N = spells.length;
  const traitsOf = e => e.system.traits.value || [];
  const withTrait = t => spells.filter(e => traitsOf(e).some(x => x.includes(t)));
  const page = await cleanPage(browser, '#spell');
  await shows(page, 'the spell scope lists every spell', countText, countLine(N, N), 20000);
  ok(await textOf(page, '#scopeBtn') === 'Only search: Spell', 'the scope button names the restricted scope');

  // #q
  const fire = spells.filter(e => e.name.toLowerCase().includes('fire'));
  ok(fire.length > 0 && fire.length < 20, 'fixture: a handful of spells have "fire" in the name', String(fire.length));
  await typeInto(page, '#q', 'fire');
  await shows(page, 'typing in the search box cuts the list to the names that contain it', countText, countLine(fire.length, N));
  const fireRows = await rowNames(page);
  ok(fireRows.length === fire.length && fireRows.every(n => n.toLowerCase().includes('fire')),
    'every row shown has the search text in its name', fireRows.slice(0, 4).join(', '));
  await clearField(page, '#q');
  await shows(page, 'emptying the search box brings every spell back', countText, countLine(N, N));

  // #rarity
  const rare = spells.filter(e => e.system.traits.rarity === 'rare');
  ok(rare.length > 0 && rare.length < N, 'fixture: some spells are rare', String(rare.length));
  await choose(page, '#rarity', 'rare');
  await shows(page, 'the rarity select keeps only that rarity', countText, countLine(rare.length, N));
  const subs = await page.$$eval('#vspacer .row .sub', els => els.map(el => el.textContent));
  ok(subs.length > 0 && subs.every(t => t.startsWith('rare')), 'every row shown is labelled rare', subs[0]);
  await choose(page, '#rarity', '');
  await shows(page, 'the blank rarity option clears it', countText, countLine(N, N));

  // #source
  const SRC = 'Pathfinder Player Core';
  const fromSrc = spells.filter(e => e.system.publication?.title === SRC);
  ok(fromSrc.length > 0 && fromSrc.length < N, `fixture: some spells are from ${SRC}`, String(fromSrc.length));
  await choose(page, '#source', SRC);
  await shows(page, 'the source select keeps only that publication', countText, countLine(fromSrc.length, N));
  await choose(page, '#source', '');
  await shows(page, 'the blank source option clears it', countText, countLine(N, N));

  // #tradition, #spelltype
  ok(await page.evaluate(() => !$('tradition').hidden && !$('spelltype').hidden), 'the tradition and type selects are shown in spell scope');
  const primal = spells.filter(e => (e.system.traits.traditions || []).includes('primal') || traitsOf(e).includes('primal'));
  await choose(page, '#tradition', 'primal');
  await shows(page, 'the tradition select keeps only that tradition', countText, countLine(primal.length, N));
  const cantrip = e => traitsOf(e).includes('cantrip') && !traitsOf(e).includes('focus')
    && !e.system.ritual && e.system.category !== 'ritual' && e.system.category !== 'focus';
  const primalCantrips = primal.filter(cantrip);
  ok(primalCantrips.length > 0 && primalCantrips.length < primal.length, 'fixture: some primal spells are cantrips', String(primalCantrips.length));
  await choose(page, '#spelltype', 'cantrip');
  await shows(page, 'the type select narrows the tradition further', countText, countLine(primalCantrips.length, N));
  await choose(page, '#tradition', '');
  await shows(page, 'clearing the tradition leaves the type filter standing', countText, countLine(spells.filter(cantrip).length, N));
  await choose(page, '#spelltype', '');
  await shows(page, 'clearing the type brings every spell back', countText, countLine(N, N));

  // #sort
  const lvl = e => e.level ?? e.system.level?.value ?? 99;
  const byLevel = [...spells].sort((a, b) => lvl(a) - lvl(b) || collate(a.name, b.name)).slice(0, 8).map(e => e.name);
  await shows(page, 'the default order is by rank, then name', async p => (await rowNames(p)).slice(0, 8), byLevel);
  const byName = [...spells].sort((a, b) => collate(a.name, b.name)).slice(0, 8).map(e => e.name);
  ok(!same(byLevel, byName), 'fixture: the two orders start with different spells');
  await choose(page, '#sort', 'name');
  await shows(page, 'the sort select reorders the list by name', async p => (await rowNames(p)).slice(0, 8), byName);
  const src = e => e.system.publication?.title || '';
  const bySource = [...spells].sort((a, b) => collate(src(a), src(b)) || collate(a.name, b.name)).slice(0, 8).map(e => e.name);
  await choose(page, '#sort', 'source');
  await shows(page, '...and by source', async p => (await rowNames(p)).slice(0, 8), bySource);
  await choose(page, '#sort', 'level');
  await shows(page, '...and back to rank', async p => (await rowNames(p)).slice(0, 8), byLevel);

  // the rank bar's Clear chip
  const rank3 = spells.filter(e => lvl(e) === 3);
  await clickLevelChip(page, 3);
  await shows(page, 'a rank chip keeps only that rank', countText, countLine(rank3.length, N));
  await click(page, '#shardbar .chip[data-lvl="clear"]');
  await shows(page, 'the Clear chip on the rank bar brings every rank back', countText, countLine(N, N));
  ok(await page.$('#shardbar .chip[data-lvl="clear"]') === null, '...and takes itself off the bar');

  // #trait: live term, Enter, blur, and the chips
  const chips = page => page.$$eval('#traitchips .chip', els => els.map(el => el.dataset.trait));
  const nFire = withTrait('fire').length;
  ok(nFire > 0 && nFire < N, 'fixture: some spells carry the fire trait', String(nFire));
  await typeInto(page, '#trait', 'fire');
  await shows(page, 'typing a trait filters as you type', countText, countLine(nFire, N));
  ok(same(await chips(page), []), '...before any chip is committed');
  await page.keyboard.press('Enter');
  await shows(page, 'Enter in the trait box commits it as a chip', chips, ['fire']);
  ok(await page.$eval('#trait', el => el.value) === '', '...and empties the box');
  ok(await countText(page) === countLine(nFire, N), '...with the list still cut to that trait');
  const both = spells.filter(e => ['fire', 'manipulate'].every(c => traitsOf(e).some(x => x.includes(c))));
  ok(both.length > 0 && both.length < nFire, 'fixture: fewer spells carry both fire and manipulate', String(both.length));
  await typeInto(page, '#trait', 'manipulate');
  await shows(page, 'a second trait narrows the first (both must match)', countText, countLine(both.length, N));
  ok(same(await chips(page), ['fire']), '...still one chip while the second is only typed');
  await page.keyboard.press('Tab');
  await shows(page, 'leaving the trait box commits what was typed as a second chip', chips, ['fire', 'manipulate']);
  await click(page, '#traitchips .chip[data-trait="fire"]');
  await shows(page, 'clicking a chip removes that trait only', chips, ['manipulate']);
  await shows(page, '...and the list widens to the trait that is left', countText, countLine(withTrait('manipulate').length, N));
  await click(page, '#traitchips .chip[data-trait="manipulate"]');
  await shows(page, 'removing the last chip brings every spell back', countText, countLine(N, N));
  ok(await page.$eval('#traitchips', el => el.hidden), '...and hides the chip row');

  // a trait badge in the stat block
  await click(page, '#vspacer .row[data-i="0"]');
  await shows(page, 'clicking the first row opens its stat block', openName, byLevel[0]);
  const badge = await page.evaluate(() => document.querySelector('#detail .trait[data-trait]')?.dataset.trait ?? null);
  ok(!!badge && withTrait(badge).length < N, 'fixture: that spell shows a trait badge', String(badge));
  await click(page, '#detail .trait[data-trait]');
  await shows(page, 'clicking a trait badge in the stat block adds it as a chip', chips, [badge]);
  await shows(page, '...and filters the list by it', countText, countLine(withTrait(badge).length, N));
  await click(page, '#traitchips .chip');
  await shows(page, 'and its chip clears it again', countText, countLine(N, N));

  // #srcModeBtn, which a reload has to survive
  const remaster = spells.filter(e => e.system.publication?.remaster === true);
  ok(remaster.length > 0 && remaster.length < N && spells.every(e => typeof e.system.publication?.remaster === 'boolean'),
    'fixture: every spell says whether it is Remaster, and only some are', String(remaster.length));
  ok(await textOf(page, '#srcModeBtn') === 'All sources', 'the source-mode button starts on All sources');
  await click(page, '#srcModeBtn');
  await shows(page, 'the source-mode button switches to Remaster only', p => textOf(p, '#srcModeBtn'), 'Remaster only');
  await shows(page, '...and drops every pre-Remaster spell', countText, countLine(remaster.length, N));
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'reloaded in Remaster-only mode' });
  await shows(page, 'Remaster only survives a reload: the button', p => textOf(p, '#srcModeBtn'), 'Remaster only');
  await shows(page, '...and the list', countText, countLine(remaster.length, N), 20000);
  await click(page, '#srcModeBtn');
  await shows(page, 'clicking it again goes back to All sources', countText, countLine(N, N));
  ok(await page.evaluate(() => localStorage.getItem('aa.remasterOnly')) === '0', '...and stores that');

  // #scopeBtn
  await choose(page, '#rarity', 'rare');
  await click(page, '#scopeBtn');
  await shows(page, 'the scope button returns to All categories', p => textOf(p, '#scopeBtn'), 'Searching: All categories');
  ok(await page.evaluate(() => document.querySelector('.cat.active')?.dataset.type) === '__all__', '...and marks All Categories active in the sidebar');
  ok(await page.evaluate(() => location.hash) === '', '...and drops the category from the URL');
  ok(await page.$eval('#rarity', el => el.value) === '', '...and resets the rarity filter with the scope');
  const manifest = DATA('manifest');
  const allTotal = Object.keys(manifest).filter(t => t !== 'npc').reduce((n, t) => n + manifest[t].count, 0);
  await shows(page, 'All categories then lists every non-creature entry in the manifest', countText, countLine(allTotal, allTotal), 60000);

  await page.evaluate(() => localStorage.clear());
  await page.close();
}

/* ============================ 6. deep search ============================ */
async function testDeepSearch(browser) {
  console.log('\ndeep search (condition scope)');
  const conds = DATA('condition');
  const N = conds.length;
  /* Matched against the raw description: both phrases sit inside one text node
     in every condition that has them (checked 2026-10-05), so stripping tags
     the way the page does changes neither count. */
  const hits = q => conds.filter(e => e.name.toLowerCase().includes(q) || e.system.description.value.toLowerCase().includes(q))
    .map(e => e.name).sort(collate);
  const named = q => conds.filter(e => e.name.toLowerCase().includes(q)).length;
  const penalty = hits('penalty'), flat = hits('flat check');
  ok(named('penalty') === 0 && penalty.length > 0 && penalty.length < N, 'fixture: "penalty" is in no condition name and in some descriptions', String(penalty.length));
  ok(named('flat check') === 0 && flat.length > 0 && flat.length !== penalty.length, 'fixture: "flat check" likewise, in a different number', String(flat.length));

  const page = await freshPage(browser, '#condition');
  await shows(page, 'the condition scope lists every condition', countText, countLine(N, N), 20000);
  await typeInto(page, '#q', 'penalty');
  await shows(page, 'a word that is in no name finds nothing by default', countText, countLine(0, N));
  ok(await textOf(page, '#vspacer .empty') === 'No entries match the current filters.', '...and the list says so');
  await click(page, '#deepBtn');
  await shows(page, 'Search descriptions finds it in the description text', countText, countLine(penalty.length, N));
  ok(same(await rowNames(page), penalty), '...and lists exactly those conditions', (await rowNames(page)).slice(0, 4).join(', '));
  ok(await page.$eval('#deepBtn', el => el.classList.contains('restricted')), '...with the button lit');
  await clearField(page, '#q');
  await shows(page, 'emptying the box with deep search on brings every condition back', countText, countLine(N, N));
  await typeInto(page, '#q', 'flat check');
  await shows(page, 'typing with deep search on searches descriptions too', countText, countLine(flat.length, N));
  await click(page, '#deepBtn');
  await shows(page, 'switching Search descriptions off goes back to names only', countText, countLine(0, N));
  ok(!(await page.$eval('#deepBtn', el => el.classList.contains('restricted'))), '...and unlights the button');
  await page.close();
}

/* ============================ 7. bookmarks: star, export, import ============================ */
/* The page builds an <a download> on a blob: URL and clicks it. This reads the
   file name and the bytes off that anchor in place of a download folder, which
   the two engines the harness launches expose differently. */
async function exportedFile(page) {
  await page.evaluate(() => {
    window.__dl = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return realClick.call(this);
      const dl = { name: this.download, text: null };
      window.__dl = dl;
      fetch(this.href).then(r => r.text()).then(t => { dl.text = t; });
    };
  });
  await click(page, '#bmExport');
  try { return await waitFor(page, () => window.__dl && window.__dl.text !== null && window.__dl, { label: 'the exported file', timeout: 5000 }); }
  catch { return null; }
}
/* The Import button opens the file picker; the picker hands the page a file. */
async function importFile(page, file) {
  const puppeteer = !!page.waitForFileChooser;
  const waiting = (puppeteer ? page.waitForFileChooser({ timeout: 5000 }) : page.waitForEvent('filechooser', { timeout: 5000 })).catch(() => null);
  await click(page, '#bmImport');
  const chooser = await waiting;
  ok(!!chooser, `Import JSON opens the file picker (${path.basename(file)})`);
  if (!chooser) return;
  if (puppeteer) await chooser.accept([file]); else await chooser.setFiles(file);
}

async function testBookmarkRoundTrip(browser) {
  console.log('\nbookmarks: star two entries, export them, import the file back');
  const conds = DATA('condition');
  const [A, B] = [...conds].sort((a, b) => collate(a.name, b.name)); // conditions have no level, so the list is by name
  const stub = e => ({ type: 'condition', level: null, name: e.name, _id: e._id });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anathema-bm-'));
  const page = await cleanPage(browser, '#condition');
  try {
    await shows(page, 'the condition scope is listed', countText, countLine(conds.length, conds.length), 20000);

    // star two entries from their stat blocks
    await click(page, '#vspacer .row[data-i="0"]');
    await shows(page, 'the first condition opens', openName, A.name);
    ok(await textOf(page, '#detail .star') === '☆', 'its star starts hollow');
    await click(page, '#detail .star');
    await shows(page, 'clicking the star fills it', p => textOf(p, '#detail .star'), '★');
    ok(await textOf(page, '#bmCount') === '1', '...and the Bookmarked category counts 1');
    ok(same(await bookmarksInStorage(page), [stub(A)]), '...and the bookmark is stored as a stub', JSON.stringify(await bookmarksInStorage(page)));
    await click(page, '#vspacer .row[data-i="1"]');
    await shows(page, 'the second condition opens', openName, B.name);
    await click(page, '#detail .star');
    await shows(page, 'starring it too makes the count 2', p => textOf(p, '#bmCount'), '2');

    // the Bookmarked category, and Export
    await clickCat(page, 'bookmarks');
    await shows(page, 'the Bookmarked category lists both', rowNames, [A.name, B.name]);
    ok(!(await page.$eval('#bmbar', el => el.hidden)), '...and shows the export and import bar');
    const file = await exportedFile(page);
    ok(file?.name === 'anathema-bookmarks.json', 'Export JSON offers a file named anathema-bookmarks.json', String(file?.name));
    let exported = null;
    try { exported = JSON.parse(file.text); } catch { /* reported by the next check */ }
    ok(same(exported, [stub(A), stub(B)]), '...holding both bookmarks as JSON',
      same(exported, [stub(A), stub(B)]) ? '' : String(file?.text).replace(/\s+/g, ' ').slice(0, 200));
    const exportPath = path.join(tmp, 'anathema-bookmarks.json');
    fs.writeFileSync(exportPath, file?.text ?? '');

    // remove one through its star, from inside the Bookmarked list
    await click(page, '#vspacer .row[data-i="1"]');
    await shows(page, 'a bookmarked row opens the real entry', openName, B.name);
    ok(await textOf(page, '#detail .star') === '★', '...with its star filled');
    await click(page, '#detail .star');
    await shows(page, 'unstarring it drops it from the Bookmarked list at once', rowNames, [A.name]);
    ok(await textOf(page, '#detail .star') === '☆', '...and hollows the star');
    ok(same(await bookmarksInStorage(page), [stub(A)]), '...and removes it from storage');

    // import the exported file: merge, then no duplicates, then a bad file
    await importFile(page, exportPath);
    await shows(page, 'importing the exported file adds the one that was missing', statusText, 'Imported 1 bookmark.');
    await shows(page, '...and the list shows both again', rowNames, [A.name, B.name]);
    ok(await textOf(page, '#bmCount') === '2', '...and the category counts 2');
    await importFile(page, exportPath);
    await shows(page, 'importing the same file again adds nothing', statusText, 'Imported 0 bookmarks.');
    ok(same(await rowNames(page), [A.name, B.name]), '...and duplicates no row');
    const badPath = path.join(tmp, 'not-a-list.json');
    fs.writeFileSync(badPath, JSON.stringify({ bookmarks: [stub(A)] }));
    await importFile(page, badPath);
    await shows(page, 'a file that is not a JSON array is refused, with the reason', statusText, 'Import failed: not a JSON array');
    ok(same(await bookmarksInStorage(page), [stub(A), stub(B)]), '...and leaves the bookmarks as they were');

    // the round trip proper: an empty browser, the exported file, the same list
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'reloaded with empty storage' });
    await clickCat(page, 'bookmarks');
    await shows(page, 'with storage emptied the Bookmarked list is empty', countText, countLine(0, 0));
    await importFile(page, exportPath);
    await shows(page, 'importing the export into an empty browser restores both', statusText, 'Imported 2 bookmarks.');
    await shows(page, '...in the list', rowNames, [A.name, B.name]);
    ok(same(await bookmarksInStorage(page), [stub(A), stub(B)]), '...and in storage, identical to what was exported');
    await click(page, '#vspacer .row[data-i="0"]');
    await shows(page, 'an imported bookmark opens its real entry', openName, A.name);
    ok(await textOf(page, '#detail .star') === '★', '...already starred');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.evaluate(() => localStorage.clear());
    await page.close();
  }
}

/* ============================ 8. keyboard, back button, scrolling, an edited URL ============================ */
async function testListNavigation(browser) {
  console.log('\nlist navigation (condition scope): arrow keys, Enter, Escape, the back button, scrolling, an edited URL');
  const conds = DATA('condition');
  const names = conds.map(e => e.name).sort(collate);
  const last = names[names.length - 1];
  /* Blinded's description links to Dazzled, another condition. */
  const FROM = 'Blinded', TO = 'Dazzled';
  ok(names[0] === FROM && /@UUID\[[^\]]*\.Dazzled\]/.test(conds.find(e => e.name === FROM).system.description.value),
    `fixture: ${FROM} is the first condition and links to ${TO}`);
  const page = await freshPage(browser, '#condition');
  await shows(page, 'the condition scope is listed', countText, countLine(names.length, names.length), 20000);
  const backLabel = p => textOf(p, '#backbtn');

  // arrows
  ok(await selName(page) === null, 'no row is selected to begin with');
  await page.keyboard.press('ArrowDown');
  await shows(page, 'Down with nothing selected selects the first row', selName, names[0]);
  await page.keyboard.press('ArrowDown');
  await shows(page, 'Down again moves to the second', selName, names[1]);
  await page.keyboard.press('ArrowUp');
  await shows(page, 'Up moves back to the first', selName, names[0]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await shows(page, 'Up at the top stays on the first row (one Down from there is the second)', selName, names[1]);
  await page.keyboard.press('ArrowUp');
  await shows(page, '...and Up returns to the first', selName, names[0]);
  ok(await openName(page) === null, 'moving the selection opens nothing');

  // Enter, a cross-reference, Escape, the back button
  await page.keyboard.press('Enter');
  await shows(page, 'Enter opens the selected row', openName, FROM);
  ok(await page.evaluate(() => location.hash) === `#condition/${FROM}`, '...and writes it to the URL');
  ok(await backLabel(page) === '← Back to list', '...with a back button that leads to the list');
  await click(page, '#detail a.ref');
  await shows(page, 'a cross-reference in the text opens the entry it names', openName, TO);
  await shows(page, '...and the back button names where it came from', backLabel, `← Back to ${FROM}`);
  await page.keyboard.press('Escape');
  await shows(page, 'Escape steps back to the entry before', openName, FROM);
  ok(await backLabel(page) === '\u2190 Back to list', '...where the back button leads to the list again');
  await page.keyboard.press('Escape');
  await shows(page, 'Escape on the first entry closes the stat block', openName, null);
  ok(await page.evaluate(() => location.hash) === '#condition', '...and the URL goes back to the bare category');

  // keys typed into a field belong to the field
  await page.keyboard.press('Enter');
  await shows(page, 'Enter reopens the row that is still selected', openName, FROM);
  await page.focus('#q');
  await page.keyboard.press('ArrowDown');
  ok(await selName(page) === names[0], 'Down while the search box has focus does not move the selection');
  await page.keyboard.press('Escape');
  await shows(page, 'Escape in the search box only leaves the box', p => p.evaluate(() => document.activeElement?.id || ''), '');
  ok(await openName(page) === FROM, '...and the stat block stays open');
  await page.keyboard.press('Escape');
  await shows(page, 'a second Escape, outside the box, closes the stat block', openName, null);

  // Up from nothing wraps to the end and scrolls there; scrolling redraws the rows
  await clickCat(page, 'condition');
  ok(await selName(page) === null, 'picking the category again clears the selection');
  await page.keyboard.press('ArrowUp');
  await shows(page, 'Up with nothing selected selects the last row', selName, last);
  ok(await page.$eval('#vlist', el => el.scrollTop) > 0, '...and scrolls the list down to it');
  ok(!(await rowNames(page)).includes(names[0]), 'fixture: scrolled to the end, the first row is not drawn');
  await page.evaluate(() => { $('vlist').scrollTop = 0; });
  await shows(page, 'scrolling back to the top draws the first rows again', async p => (await rowNames(p))[0], names[0]);

  // an edited URL
  await page.evaluate(() => { location.hash = '#condition/Clumsy'; });
  await shows(page, 'editing the URL to name an entry opens it', openName, 'Clumsy');
  const nSpells = DATA('manifest').spell.count;
  await page.evaluate(() => { location.hash = '#spell'; });
  await shows(page, 'editing the URL to another category switches scope', p => p.evaluate(() => document.querySelector('.cat.active')?.dataset.type), 'spell');
  await shows(page, '...and lists that category', countText, countLine(nSpells, nSpells), 20000);
  await page.close();

  // the back button is drawn only where the stat block covers the list (900px and under)
  const phone = await freshPage(browser, '#condition', 600);
  await shows(phone, 'at 600px wide the condition scope is listed', countText, countLine(names.length, names.length), 20000);
  await click(phone, '#vspacer .row[data-i="0"]');
  await shows(phone, 'tapping a row opens its stat block over the list', openName, FROM);
  ok(await phone.$eval('#backbtn', el => getComputedStyle(el).display !== 'none'), '...with the back button drawn');
  await click(phone, '#detail a.ref');
  await shows(phone, 'following a cross-reference there', openName, TO);
  await click(phone, '#backbtn');
  await shows(phone, 'the back button steps back to the entry before', openName, FROM);
  await click(phone, '#backbtn');
  await shows(phone, 'the back button on the first entry closes the stat block', openName, null);
  ok(await phone.$eval('#detail', el => getComputedStyle(el).display === 'none'), '...and uncovers the list');
  await phone.close();
}

/* ============================ 9. picking a category while it is still loading ============================ */
/* The All scope fetches every category in the background. A category picked
   while its own file is still in flight has to list itself when the file
   lands; it used to show "0 of 0 entries" until it was picked a second time
   (#867). The fetch is held here so the click is certain to land in that gap. */
async function testCategoryDuringAllLoad(browser) {
  console.log('\npicking a category whose file is still loading for the All scope');
  const nSpells = DATA('manifest').spell.count;
  const page = await freshPage(browser, '#condition'); // a restricted start: nothing for the All scope is requested yet
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.__release = null;
    const gate = new Promise(r => { window.__release = r; });
    window.fetch = (...a) => gate.then(() => realFetch(...a));
  });
  await click(page, '#scopeBtn');
  await waitFor(page, () => S.cat === '__all__' && S.fetching.has('spell'), { label: 'the All scope has asked for spell.json' });
  await clickCat(page, 'spell');
  ok(await page.evaluate(() => S.fetching.has('spell') && !S.cache.spell), 'fixture: the click landed while spell.json was still in flight');
  await page.evaluate(() => window.__release());
  await shows(page, 'the picked category lists itself once its file arrives', countText, countLine(nSpells, nSpells), 30000);
  ok((await rowNames(page)).length > 0, '...with rows drawn, not the "No entries match" message');
  await page.close();
}

/* ============================ 10. the page's interaction surface ============================ */
/* Every way the page takes input, read out of its source, against the list
   below. No browser. A new listener, key, delegated target or data-* action
   fails here until it is listed, which is the moment BACKLOG.md's "extend this
   suite if the page gains interaction logic" row comes true (#626): list it
   with the scenario that drives it, or '' if none does yet and say why in the
   PR. A listed entry the page no longer has fails too, so the list cannot rot.

   The value is the scenario that drives the entry through the real page, or
   '' where nothing does. On 2026-09-24, 6 of 47 were driven: the first four
   scenarios were written for four hand-tested-only behaviours, not for
   coverage. Scenarios 5 to 9 (2026-10-05) took it to 36. The 11 left are the
   encounter builder (ten entries) and the window resize listener. */
const SURFACE = {
  '#cats click': 'testLevelBar',          // clickCat, in every scenario
  'closest .cat': 'testLevelBar',
  '#shardbar click': 'testLevelBar',
  'closest .chip': 'testLevelBar',        // shared with #traitchips, which testFilters drives
  '#vspacer click': 'testBookmarkResolution',
  'closest .row': 'testBookmarkResolution',
  'window hashchange': 'testListNavigation',
  'data-lvl clear': 'testFilters',
  '#rarity input': 'testFilters', '#trait input': 'testFilters', '#source input': 'testFilters', '#tradition input': 'testFilters',
  '#spelltype input': 'testFilters', '#sort input': 'testFilters', '#q input': 'testFilters',
  '#trait change': 'testFilters', '#trait keydown': 'testFilters', '#traitchips click': 'testFilters',
  '#encToggle click': '', '#encbar click': '', '#encbar input': '',
  'closest [data-enc]': '', 'data-enc inc': '', 'data-enc dec': '', 'data-enc del': '', 'data-enc clear': '',
  'closest .encadd': '', 'closest .encaddbtn': '',
  '#detail click': 'testFilters', 'closest .star': 'testBookmarkRoundTrip', 'closest .trait[data-trait]': 'testFilters',
  'closest a.ref': 'testListNavigation',
  '#vlist scroll': 'testListNavigation', 'window resize': '',
  '#scopeBtn click': 'testFilters', '#deepBtn click': 'testDeepSearch', '#srcModeBtn click': 'testFilters',
  '#bmExport click': 'testBookmarkRoundTrip', '#bmImport click': 'testBookmarkRoundTrip',
  '#bmFile change': 'testBookmarkRoundTrip', 'rd load': 'testBookmarkRoundTrip',
  '#backbtn click': 'testListNavigation',
  'document keydown': 'testListNavigation', 'key Escape': 'testListNavigation', 'key ArrowDown': 'testListNavigation',
  'key ArrowUp': 'testListNavigation', 'key Enter': 'testListNavigation',
};

function interactionSurface(src) {
  const found = new Set();
  let listeners = 0;
  // `for (const el of ['rarity', ...]) $(el).addEventListener('input', ...)`, one entry per id
  for (const m of src.matchAll(/for \(const (\w+) of \[([^\]]*)\]\) \$\(\1\)\.addEventListener\('(\w+)'/g)) {
    listeners++;
    for (const id of m[2].match(/'[\w-]+'/g)) found.add(`#${id.slice(1, -1)} ${m[3]}`);
  }
  for (const m of src.matchAll(/(?:\$\('([\w-]+)'\)|\b(window|document))\.addEventListener\('(\w+)'/g)) {
    listeners++;
    found.add(`${m[1] ? '#' + m[1] : m[2]} ${m[3]}`);
  }
  for (const m of src.matchAll(/(?:\$\('([\w-]+)'\)|\b(\w+))\.on(\w+)\s*=/g)) found.add(`${m[1] ? '#' + m[1] : m[2]} ${m[3]}`);
  for (const m of src.matchAll(/<[^>]*\son(\w+)\s*=/g)) found.add(`inline on${m[1]}`);
  for (const m of src.matchAll(/\.key === '(\w+)'/g)) found.add(`key ${m[1]}`);
  for (const m of src.matchAll(/\.closest\('([^']+)'\)/g)) found.add(`closest ${m[1]}`);
  for (const m of src.matchAll(/\.dataset\.(\w+) === '([^']+)'/g)) found.add(`data-${m[1]} ${m[2]}`);
  // A listener in a form the patterns above do not read would slip past them.
  const unread = (src.match(/addEventListener\(/g) || []).length - listeners;
  return { found, unread };
}

async function testInteractionSurface() {
  console.log('\nthe page\'s interaction surface (static, against SURFACE)');
  const src = fs.readFileSync(path.join(HERE, '..', 'Anathema_Archive.html'), 'utf8');
  const { found, unread } = interactionSurface(src);
  ok(unread === 0, 'every addEventListener call is in a form this check reads',
    unread === 0 ? '' : `${unread} call(s) it cannot attribute to a target; teach interactionSurface() the form`);
  const added = [...found].filter(k => !(k in SURFACE));
  ok(added.length === 0, `no entry point the suite has not been told about (${found.size} found)`,
    added.length === 0 ? '' : `new: ${added.join(', ')}. The page gained interaction logic; drive it from a scenario here and list it in SURFACE`);
  const gone = Object.keys(SURFACE).filter(k => !found.has(k));
  ok(gone.length === 0, 'every entry point in SURFACE is still on the page', gone.length === 0 ? '' : `gone: ${gone.join(', ')}`);
  const names = new Set(tests.map(t => t.name));
  const unknown = [...new Set(Object.values(SURFACE).filter(Boolean))].filter(n => !names.has(n));
  ok(unknown.length === 0, 'every scenario SURFACE credits is one this file runs', unknown.length === 0 ? '' : `not run: ${unknown.join(', ')}`);
  const driven = Object.values(SURFACE).filter(Boolean).length;
  console.log(`        ${driven} of ${Object.keys(SURFACE).length} driven by a scenario`);
}

/* ============================ run ============================ */
const tests = [testLevelBar, testShardSync, testHashRouting, testBookmarkResolution,
  testFilters, testDeepSearch, testBookmarkRoundTrip, testListNavigation, testCategoryDuringAllLoad];
await testInteractionSurface();
const only = (process.env.ANATHEMA_ONLY || '').split(',').filter(Boolean);
if (only.length) {
  const unknownOnly = only.filter(n => !tests.some(t => t.name === n));
  if (unknownOnly.length) { console.log(`  FAIL  ANATHEMA_ONLY names no scenario: ${unknownOnly.join(', ')}`); process.exit(1); }
}
const server = await serve(PORT);
const browser = await launch({ headed: false });
for (const t of tests) {
  if (only.length && !only.includes(t.name)) continue;
  try { await t(browser); }
  catch (err) {
    failures++; checks++;
    console.log(`  ABORTED  ${t.name}: ${String(err.message || err).slice(0, 300)}`);
  }
}
await browser.close();
server.close();

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
