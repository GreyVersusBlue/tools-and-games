// tools.mjs — the sweep play-games.mjs and play-castle.mjs never do.
//
//   npm run tools
//
// Both existing suites only ever open the seven games, which is how three
// cdnjs.cloudflare.com hotlinks sat in Tools/final_grade_checker.html
// indefinitely: nothing measured it. This opens every page linked from the
// Town Services board and asserts the cheap things a browser can check that a
// human would otherwise have to click through by hand. It is not a replacement
// for check-integrity.mjs's static offsite sweep — that one covers pages this
// script doesn't drive too, and needs no browser to do it — this one is for
// what only a real render can catch: a page that throws on load, or a title
// nobody set.
//
// Headless on purpose. None of these pages need pointer lock or WebGL, and
// running headless means this can run alongside a headed suite without
// stealing its focus (v7 §6) — the two are otherwise forbidden to overlap.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8127; // 8123 checks/shoot, 8124 play-castle, 8125 previews, 8126 games
const BASE = `http://127.0.0.1:${PORT}`;

const PAGES = [
  'Tools/final_grade_checker.html',
  'Tools/image-to-pdf.html',
  'Tools/Name Picker.html',
  'Tools/Seating Chart Generator.html',
  'Tools/schedule-browser.html',
  'Tools/schedule-visualizer.html',
];

const server = await serve(PORT);
const browser = await launch({ headed: false });
let checks = 0, failures = 0;

const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};

for (const rel of PAGES) {
  console.log(`\n${rel}`);
  const page = await prepPage(browser, BASE, { width: 1280, height: 900 });
  page.setDefaultTimeout(20000);
  try {
    await page.goto(`${BASE}/${encodeURI(rel)}`, { waitUntil: 'load', timeout: 20000 });
    await new Promise(r => setTimeout(r, 500));
    const title = await page.title();
    ok(!!title, 'document.title is non-empty', title);
    ok(page.__blocked.length === 0, 'no offsite requests refused',
      page.__blocked.slice(0, 3).join(' | '));
    ok(page.__errs.length === 0, 'no page or console errors',
      page.__errs.slice(0, 3).join(' | '));
  } catch (err) {
    failures++;
    console.log(`  ABORTED  ${String(err.message || err).slice(0, 200)}`);
  }
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
