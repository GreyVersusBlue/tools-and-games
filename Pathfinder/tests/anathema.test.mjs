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
// and bookmark-stub resolution. Exits non-zero on any failure.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../Tools/board-check/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8140; // see Tools/board-check/README for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/Pathfinder/Anathema_Archive.html`;

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

async function freshPage(browser, hash = '') {
  const page = await prepPage(browser, BASE, { width: 1280, height: 900 });
  page.setDefaultTimeout(20000);
  await page.goto(URL + hash, { waitUntil: 'load' });
  await waitFor(page, () => typeof S !== 'undefined' && !!S.manifest, { label: 'S.manifest loaded' });
  return page;
}

async function clickCat(page, type) {
  await page.click(`.cat[data-type="${type}"]`);
  await waitFor(page, t => S.cat === t, { label: `S.cat === ${type}`, arg: type });
}

async function clickLevelChip(page, lvl) {
  await page.click(`#shardbar .chip[data-lvl="${lvl}"]`);
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

  await page.click('#vspacer .row[data-i="0"]');
  await waitFor(page, name => S.curEntry?.name === name, { label: 'stub resolved to a real entry', arg: OOZELET.name });
  const resolvedName = await page.evaluate(() => S.curEntry?.name);
  ok(resolvedName === OOZELET.name, 'clicking the stub lazy-loads its shard and opens the real entry', String(resolvedName));
  const hasSystem = await page.evaluate(() => !!(S.curEntry && S.curEntry.system));
  ok(hasSystem, 'the resolved entry is the full record (has .system), not the bare stub');
  ok(await page.evaluate(l => S.npcLoaded.has(l), OOZELET.level), '...having lazy-loaded the correct shard to find it');

  await page.close();
}

/* ============================ run ============================ */
const server = await serve(PORT);
const browser = await launch({ headed: false });
const tests = [testLevelBar, testShardSync, testHashRouting, testBookmarkResolution];
for (const t of tests) {
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
