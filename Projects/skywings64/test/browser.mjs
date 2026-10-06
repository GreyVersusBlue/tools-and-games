// browser.mjs — SkyWings 64's own suite.
//
//   node Projects/skywings64/test/browser.mjs
//
// Runs test/assets.mjs first (Node only: what assets/models/ holds), then opens the game headless on the board-check harness, injects test/checks.js and runs it. The checks
// step the game synchronously through window.__qa.sim, so nothing here waits on requestAnimationFrame
// and a software-GL frame rate cannot make a beat pass or fail (#53). Exits non-zero on any failed
// check, any page error, or any offsite request (#13).
//
// Borrows Tools/board-check's harness rather than copying it; its bare specifiers resolve from that
// folder, so run `npm install` in Tools/board-check once and nothing needs installing here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { checkAssets } from './assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8172; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
// quality=low keeps the software renderer quick; touch=1 forces the on-screen controls on.
const URL_ = `${BASE}/Projects/skywings64/index.html?quality=low&touch=1`;

let failures = 0;
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
  const results = await page.evaluate(() => window.__swChecks());
  results.forEach(show);
  // the AudioContext autoplay notice is a warning, not an error, so it never lands in __errs
  const errs = page.__errs || [];
  for (const e of errs) { failures++; console.log('  FAIL  page error: ' + String(e).slice(0, 300)); }
  const blocked = [...(page.__blocked || []), ...(page.__shimmed || [])];
  for (const b of blocked) { failures++; console.log('  FAIL  offsite request: ' + b); }
  console.log(`\n${assets.length + results.length} checks, ${failures} failure(s)`);
  if (!results.length) failures++;
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
