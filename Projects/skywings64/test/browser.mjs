// browser.mjs — SkyWings 64's own suite.
//
//   node Projects/skywings64/test/browser.mjs
//   node Projects/skywings64/test/browser.mjs --models    only the model and herd checks (a quick run while changing them)
//
// Runs test/assets.mjs first (Node only: what assets/models/ holds), then opens the game headless on the board-check harness, injects test/checks.js and runs it. The checks
// step the game synchronously through window.__qa.sim, so nothing here waits on requestAnimationFrame
// and a software-GL frame rate cannot make a beat pass or fail (#53). Exits non-zero on any failed
// check, any page error, or any offsite request (#13). Last, test/draws.mjs counts one frame's draw
// calls from the first three of its nine views (quality=high, a second page) and holds them to test/draws.json.
//
// Borrows Tools/board-check's harness rather than copying it; its bare specifiers resolve from that
// folder, so run `npm install` in Tools/board-check once and nothing needs installing here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { checkAssets } from './assets.mjs';
import { measure, compareCounts, FIXTURE, VIEWS } from './draws.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8172; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
// quality=low keeps the software renderer quick; touch=1 forces the on-screen controls on.
const URL_ = `${BASE}/Projects/skywings64/index.html?quality=low&touch=1`;

const MODELS_ONLY = process.argv.includes('--models');
let failures = 0, results = [];
const show = (r) => { if (!r.ok) failures++; console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.detail ? '  ' + r.detail : ''}`); };
const assets = checkAssets();
assets.forEach(show);

const server = await serve(PORT);
const browser = await launch();
try {
  const page = await prepPage(browser, BASE, { width: 960, height: 540, dsf: 1 });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa && window.__game, { timeout: 120000 });
  await page.addScriptTag({ path: path.join(HERE, 'checks.js') });
  if (MODELS_ONLY) await page.evaluate(() => { window.__swOnly = 'models'; });
  results = await page.evaluate(() => window.__swChecks());
  results.forEach(show);
  // the AudioContext autoplay notice is a warning, not an error, so it never lands in __errs
  const errs = page.__errs || [];
  for (const e of errs) { failures++; console.log('  FAIL  page error: ' + String(e).slice(0, 300)); }
  const blocked = [...(page.__blocked || []), ...(page.__shimmed || [])];
  for (const b of blocked) { failures++; console.log('  FAIL  offsite request: ' + b); }
  if (!results.length) failures++;
} finally {
  await browser.close();
  server.close();
}
// ---- draw calls: the first three of draws.mjs's nine views (a view's count belongs to its place in
// the order, so never a pick); `node test/draws.mjs` runs all nine
if (MODELS_ONLY) { console.log(`\n${results.length} model checks only, ${failures} failure(s); the suite is the run without --models`); process.exit(failures ? 1 : 0); }
const DRAW_VIEWS = Object.keys(VIEWS).slice(0, 3);
const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).views;
const now = await measure({ first: DRAW_VIEWS.length });
for (const e of now.__errors) show({ ok: false, label: 'draws: page error: ' + e });
for (const v of DRAW_VIEWS) {
  const moved = compareCounts({ [v]: pinned[v] }, now);
  show({ ok: moved.length === 0, label: `draws: ${v} is drawn in the pinned number of calls (${pinned[v].draws.total}), by pass and owner`, detail: moved.length ? moved.join('; ') : '' });
}
console.log(`\n${assets.length + results.length + DRAW_VIEWS.length} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
