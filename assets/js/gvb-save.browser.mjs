// gvb-save.browser.mjs — the v2 tiers against a real browser.
//
//   cd Tools/board-check && npm ci --ignore-scripts   (once)
//   node assets/js/gvb-save.browser.mjs               (from the repo root)
//
// gvb-save.test.mjs drives every v2 path on stubs, which is where the logic
// is checked. Two things a stub cannot vouch for: what a real localStorage
// does at its ceiling (the exception's name, the exact character count, that
// the previous value survives the refused write), and that a real IndexedDB
// takes a save localStorage never could, keeps it across a page reload, and
// reports itself through navigator.storage.estimate(). This suite is those,
// headless, over Tools/board-check's harness. Exits 1 on any failure.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../Tools/board-check/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8153; // see Tools/board-check/README and sibling test scripts for ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = BASE + '/404.html';   // any page on the origin; the module is imported by hand

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) passed++; else { failed++; console.log('  FAIL ' + label); } return !!cond; };
const eq = (a, b, label) => ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const server = await serve(PORT);
const browser = await launch();
let page = await prepPage(browser, BASE);
const go = async () => { await page.goto(PAGE, { waitUntil: 'load' }); };
await go();

// Every beat runs inside the page. `page.evaluate` re-parses the function in
// the browser, so nothing here closes over Node-side variables; the module is
// imported inside each call.
const inPage = (fn, arg) => page.evaluate(fn, arg);

// ---- 1. a real localStorage ceiling -----------------------------------------
{
  const r = await inPage(async () => {
    const m = await import('/assets/js/gvb-save.js');
    localStorage.clear();
    const head = m.probeHeadroom(localStorage);
    const slot = m.createSaveSlot({ game: 'browser-test', key: 'gvb-browser-test', defaults: { day: 1 } });
    const okSmall = slot.save({ day: 1, pad: 'x'.repeat(1000) });
    const afterSmall = slot.usage();
    // Bigger than the whole store: must be refused, and must not touch what was there.
    const okHuge = slot.save({ day: 2, pad: 'x'.repeat(head + 4096) });
    const err = slot.lastError;
    const still = slot.load();
    const usage = slot.usage();
    // Fill to the brim, then read the share.
    const fill = head - afterSmall.chars - 4096;
    const okFill = slot.save({ day: 3, pad: 'x'.repeat(Math.max(0, fill)) });
    const full = slot.usage();
    const headAfter = m.probeHeadroom(localStorage);
    const cleared = slot.clear();
    return { head, okSmall, okHuge, err, stillDay: still && still.day, usage, okFill, fullShare: full.share, fullChars: full.chars, headAfter, cleared, quota: m.LOCAL_QUOTA_CHARS, msg: m.failureMessage(slot) };
  });
  ok(r.head > 1024 * 1024 && r.head < 64 * 1024 * 1024, `probeHeadroom on a real localStorage is a real number (${r.head} chars)`);
  ok(Math.abs(r.head - r.quota) < r.quota * 0.02, `and it is within 2% of LOCAL_QUOTA_CHARS (${r.head} vs ${r.quota})`);
  eq(r.okSmall, true, 'a small save fits');
  eq(r.okHuge, false, 'a save larger than the store is refused');
  eq(r.err && r.err.name, 'QuotaExceededError', 'the refusal is named QuotaExceededError');
  eq(r.err && r.err.quota, true, 'and isQuotaError() recognises it');
  eq(r.stillDay, 1, 'the previous save is intact after the refused write');
  eq(r.usage.origin.counted, true, 'a real localStorage is countable');
  eq(r.usage.chars, r.usage.origin.chars, 'this slot is the whole origin when it is the only key');
  eq(r.okFill, true, 'a save sized to the measured headroom fits');
  ok(r.fullShare > 0.95 && r.fullShare <= 1.0, `share reads nearly full after filling (${r.fullShare.toFixed(3)})`);
  ok(r.headAfter < 8192 && r.headAfter >= 0, `and headroom is nearly gone (${r.headAfter} chars)`);
  eq(r.cleared, true, 'clear() empties it again');
  ok(/refused|full|blocks/.test(r.msg), 'failureMessage() has a line for the last failure');
}

// ---- 2. IndexedDB takes what localStorage cannot ------------------------------
const BIG = 12 * 1024 * 1024;   // 12 M characters: over twice the localStorage ceiling
{
  const r = await inPage(async big => {
    const m = await import('/assets/js/gvb-save.js');
    const slot = m.createAsyncSaveSlot({ game: 'browser-test', key: 'gvb-browser-idb', version: 1, defaults: { day: 1 } });
    const before = await slot.load();
    const tier = slot.tier;
    const okBig = await slot.save({ day: 7, pad: 'y'.repeat(big) });
    const err = slot.lastError;
    const back = await slot.load();
    const usage = await slot.usage();
    // The same key in localStorage would not take it.
    const sync = m.createSaveSlot({ game: 'browser-test', key: 'gvb-browser-idb-sync' });
    const okSync = sync.save({ day: 7, pad: 'y'.repeat(big) });
    return { before, tier, okBig, err, backDay: back && back.day, padLen: back && back.pad.length, usage, okSync, syncQuota: sync.lastError && sync.lastError.quota };
  }, BIG);
  eq(r.before, null, 'a fresh IndexedDB slot loads null');
  eq(r.tier, 'idb', 'with no storage given, the tier is IndexedDB');
  eq(r.okBig, true, `a ${BIG / 1024 / 1024} M-character save lands in IndexedDB`);
  eq(r.err, null, 'with no error recorded');
  eq(r.backDay, 7, 'and loads back');
  eq(r.padLen, BIG, 'whole');
  eq(r.usage.tier, 'idb', 'usage() reports the tier');
  eq(r.usage.origin.counted, true, 'navigator.storage.estimate() answered');
  ok(r.usage.origin.quota > BIG * 2, `and the origin quota is far past localStorage's (${Math.round(r.usage.origin.quota / 1048576)} MB)`);
  ok(r.usage.chars > BIG, 'this key measures the full save');
  eq(r.okSync, false, 'the same save through a sync slot is refused by localStorage');
  eq(r.syncQuota, true, 'as a quota error');
}

// ---- 3. reload: IndexedDB persists across a navigation ------------------------
{
  await go();
  const r = await inPage(async big => {
    const m = await import('/assets/js/gvb-save.js');
    const slot = m.createAsyncSaveSlot({ game: 'browser-test', key: 'gvb-browser-idb', version: 1 });
    const back = await slot.load();
    return { day: back && back.day, padLen: back && back.pad.length };
  }, BIG);
  eq(r.day, 7, 'the IndexedDB save survives a page reload');
  eq(r.padLen, BIG, 'in full');
}

// ---- 4. promotion: a save in localStorage moves up on first load, verbatim ------
{
  const r = await inPage(async () => {
    const m = await import('/assets/js/gvb-save.js');
    const raw = '{"day":4,"staff":[]}';   // unversioned: reads as version 0
    localStorage.setItem('gvb-browser-promote', raw);
    const slot = m.createAsyncSaveSlot({
      game: 'browser-test', key: 'gvb-browser-promote', version: 2,
      validate: s => typeof s.day === 'number',
      migrate: (s, from) => { if (from < 2) s.upgrades = s.upgrades || []; return s; }
    });
    const st = await slot.load();
    const inIdb = await m.idbStorage().getItem('gvb-browser-promote');
    return { day: st && st.day, migrated: st && Array.isArray(st.upgrades), promoted: slot.promoted, local: localStorage.getItem('gvb-browser-promote'), inIdb, raw };
  });
  eq(r.day, 4, 'the localStorage save loads through the IndexedDB slot');
  eq(r.migrated, true, 'and its version-0 shape was migrated on the way out');
  eq(r.promoted, true, 'the slot reports the promotion');
  eq(r.local, null, 'the localStorage copy is gone');
  eq(r.inIdb, r.raw, 'and IndexedDB holds the original string, byte for byte');

  await go();
  const r2 = await inPage(async () => {
    const m = await import('/assets/js/gvb-save.js');
    const slot = m.createAsyncSaveSlot({ game: 'browser-test', key: 'gvb-browser-promote', version: 2, migrate: (s, from) => { if (from < 2) s.upgrades = []; return s; } });
    const st = await slot.load();
    return { day: st && st.day, promoted: slot.promoted, migrated: st && Array.isArray(st.upgrades) };
  });
  eq(r2.day, 4, 'after a reload the promoted save reads from IndexedDB');
  eq(r2.promoted, false, 'with nothing left to promote');
  eq(r2.migrated, true, 'and still migrates, because the marker was never rewritten');
}

// ---- 5. an async namespace in IndexedDB, and one bundle for all of it ---------
{
  const r = await inPage(async () => {
    const m = await import('/assets/js/gvb-save.js');
    const ns = m.createNamespace({ game: 'browser-hall', prefix: 'browser-hall.', async: true });
    const a = ns.slot('careers', { defaults: { list: [] }, validate: s => Array.isArray(s.list) });
    const b = ns.slot('settings', { defaults: { sound: true } });
    await a.save({ list: [1, 2, 3] }); await b.save({ sound: false });
    const names = (await ns.names()).sort();
    const usage = await ns.usage();
    const text = ns.serialize(await ns.snapshot());
    const cleared = await ns.clearAll();
    const gone = await a.load();
    const imp = await ns.importAll(text);
    const back = await a.load();
    return { tier: ns.tier, names, usageKeys: usage.keys.length, cleared, gone, stored: imp.stored.sort(), backLen: back && back.list.length };
  });
  eq(r.tier, 'idb', 'an async namespace with no storage given lives in IndexedDB');
  eq(r.names.join(), 'careers,settings', 'names() enumerates the object store under the prefix');
  eq(r.usageKeys, 2, 'usage() counts both members');
  eq(r.cleared, 2, 'clearAll() removes both');
  eq(r.gone, null, 'and a member reads empty');
  eq(r.stored.join(), 'careers,settings', 'importAll() writes the bundle back');
  eq(r.backLen, 3, 'and the member reads its state again');
}

// ---- 6. the save bar over an async slot, and its line for a full store --------
{
  const r = await inPage(async () => {
    const m = await import('/assets/js/gvb-save.js');
    const slot = m.createAsyncSaveSlot({ game: 'browser-test', key: 'gvb-browser-bar', defaults: { day: 1 } });
    await slot.save({ day: 9 });
    let state = await slot.load();
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const messages = [];
    m.mountSaveBar(bar, slot, { buttons: ['reset'], confirmReset: false, getState: () => state, setState: s => { state = s; }, onMessage: t => messages.push(t) });
    bar.querySelector('[data-gvb="reset"]').click();
    await new Promise(r => setTimeout(r, 200));
    const after = await slot.load();
    // A sync slot at the ceiling: what the bar would say.
    const full = m.createSaveSlot({ game: 'browser-test', key: 'gvb-browser-full' });
    full.save({ pad: 'z'.repeat(64 * 1024 * 1024) });
    return { stateDay: state && state.day, after, messages, line: m.failureMessage(full) };
  });
  eq(r.stateDay, 1, 'reset through the bar hands setState a fresh state');
  eq(r.after, null, 'and the IndexedDB key is gone');
  eq(r.messages.join('|'), 'Save erased.', 'the bar says so once');
  ok(/storage is full/.test(r.line) && /MB/.test(r.line), `a full localStorage gets the "storage is full" line with a size: ${JSON.stringify(r.line)}`);
}

// ---- clean up: nothing this suite wrote outlives it ---------------------------
await inPage(async () => {
  const m = await import('/assets/js/gvb-save.js');
  localStorage.clear();
  const s = m.idbStorage();
  for (const k of await s.keys()) await s.removeItem(k);
  await s.close();
});

await page.close();
await browser.close();
server.close();
console.log(`\ngvb-save browser: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
