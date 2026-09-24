// showcase.test.mjs: characters.html and campaigns.html are showcases, not
// living sheets, and keep nothing in the browser.
//
//   node Pathfinder/tests/showcase.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. Whether characters.html becomes an editable character sheet is Q39 in
// BACKLOG.md's "Questions for Devon", and only Devon can answer it (#628).
// campaigns.html answered the same question for itself twice: a chronicle
// changes a few times a year, and git history beats browser storage that can
// drift or be cleared (campaigns-assets/generator/README.md). No test can see
// a page's role change, so this one watches for the first line of code that
// would change it: a storage call, a gvb-save.js import, an editable field.
// If Devon has answered Q39 yes, record it, strike Q39, and narrow this file
// to the page that is still a showcase. Do not add an exception to pass it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Which decision each page's showcase role rests on, for the failure message.
const PAGES = {
  'characters.html': "Editing this page is Q39, Devon's call (#628)",
  'campaigns.html': 'This page turned down browser editing twice (campaigns-assets/generator/README.md, #628)',
};

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// What each rule looks for, in the live page: HTML comments stripped (the
// dossier template lives in one), and JS comments stripped inside <script>.
const RULES = [
  ['keeps nothing in browser storage',
    /\b(localStorage|sessionStorage|indexedDB|openDatabase|caches)\b|document\.cookie/g],
  ['does not load gvb-save.js',
    /gvb-save/g],
  ['has no editable field',
    /<(input|textarea|select|form)\b|contenteditable|designMode/gi],
  ['loads no script from a file',
    /<script\b[^>]*\b(src=|type=["']?module)|\bimport\s*\(|\bimport\s[^;]*\bfrom\s/g],
];

// A stripped comment keeps its newlines, so a failure's line number is the file's.
const blank = (s) => s.replace(/[^\n]/g, '');
const live = (src) => src
  .replace(/<!--[\s\S]*?-->/g, blank)
  .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) =>
    open + body.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/.*$/gm, '$1') + close);

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

for (const [page, why] of Object.entries(PAGES)) {
  const src = live(fs.readFileSync(path.join(HERE, '..', page), 'utf8'));
  console.log(`\n${page}`);
  ok((src.match(/<script\b/g) || []).length === 1, `${page} has one inline <script>`,
    `it has ${(src.match(/<script\b/g) || []).length}; read the new one against the rules below`);
  for (const [label, re] of RULES) {
    const hits = [...src.matchAll(re)].map(m => `line ${lineOf(src, m.index)}: ${m[0].trim()}`);
    ok(hits.length === 0, `${page} ${label}`,
      `${hits.join('; ')}\n        ${why}. Answered otherwise? Record it in HISTORY.md, then change this file.`);
  }
}

console.log(`\n${checks} checks${failures ? `, ${failures} FAILED` : ', all passed'}`);
process.exit(failures ? 1 : 0);
