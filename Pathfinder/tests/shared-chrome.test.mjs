// shared-chrome.test.mjs — characters.html and campaigns.html are a matched
// pair, and the rules each one marks [shared] have to stay identical in both.
//
//   node Pathfinder/tests/shared-chrome.test.mjs      (from the repo root)
//
// Exits non-zero on any drift.
//
// WHY A TEST AND NOT A NOTE. Locked decision #17 says no file is shared between
// projects, so these two pages each carry their own copy of the same chrome:
// the ember field, the tome frame, the masthead, the footer, the two media
// queries, and the sixteen-ember seeding loop. Both files said "confirmed by
// diff 2026-07-31" and asked whoever edits one to mirror the edit. That is a
// person's promise, checked by a person re-running a diff — it was a ranked
// backlog row twice for exactly that reason. This is the diff, and it fails.
//
// WHAT IT DOES NOT CLAIM. Only the marked rules. The pages share more than they
// mark (`body`, `*`, and `a` are identical too, unmarked), and they differ on
// purpose in places the markers name: `.tome`'s max-width is each page's own
// content width, campaigns.html's `:root` carries three colours characters.html
// has no use for, and the `[shared pattern]` hover-lift rules apply the same
// declarations to each page's own selectors and are not compared here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const A = 'characters.html';
const B = 'campaigns.html';

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

/* --------------------------------------------------------------- the pairs ---
 * Each entry is one [shared] block, named by the first and last selector it
 * covers — the range the marker's own prose describes. A rule added between the
 * two in one file and not the other lands inside the slice and fails, which is
 * the drift a selector-by-selector list would miss.
 */
const BLOCKS = [
  { start: ':root', end: ':root', extraProps: { [B]: ['--sage', '--slate', '--dustrose'] } },
  { start: '.embers', end: '@keyframes drift' },
  { start: '.tome', end: '.corner.br', mayDiffer: { '.tome': ['max-width'] } },
  { start: 'header.masthead', end: '.subtitle' },
  { start: 'main', end: 'main' },
  { start: 'footer', end: 'footer a' },
  { start: '@media (prefers-reduced-motion:reduce)', end: '@media (max-width:600px)' },
];

const read = (f) => fs.readFileSync(path.join(PF, f), 'utf8');

/** The contents of the page's one <style> element. */
function styleOf(src) {
  const open = src.indexOf('<style');
  return src.slice(src.indexOf('>', open) + 1, src.indexOf('</style>'));
}

/**
 * Top-level rules, in order: { selector, body }. Comments are dropped, which is
 * what lets the marker comments themselves — each naming the *other* file —
 * stay out of the comparison.
 */
function rules(css) {
  const out = [];
  let i = 0, sel = '';
  while (i < css.length) {
    if (css.startsWith('/*', i)) { i = css.indexOf('*/', i) + 2; continue; }
    const ch = css[i];
    if (ch === '{') {
      let depth = 1, j = i + 1;
      while (j < css.length && depth > 0) {
        if (css.startsWith('/*', j)) { j = css.indexOf('*/', j) + 2; continue; }
        if (css[j] === '{') depth++;
        if (css[j] === '}') depth--;
        j++;
      }
      out.push({ selector: sel.trim().replace(/\s+/g, ' '), body: css.slice(i + 1, j - 1) });
      sel = ''; i = j; continue;
    }
    if (ch === '}') { sel = ''; i++; continue; }
    sel += ch; i++;
  }
  return out;
}

/**
 * `a:1; b:2` -> ['a:1', 'b:2'], whitespace flattened, nesting kept whole.
 * Comments go first: the `:root` marker sits INSIDE the rule, on the same line
 * as its brace, and each file's copy of it names the other file.
 */
function decls(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';').map(d => d.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

function slice(list, block, file) {
  const from = list.findIndex(r => r.selector === block.start);
  if (from === -1) { fail(`${file}: no rule for ${block.start}`); return null; }
  const to = list.findIndex((r, i) => i >= from && r.selector === block.end);
  if (to === -1) { fail(`${file}: ${block.start} is there but ${block.end} is not`); return null; }
  return list.slice(from, to + 1);
}

console.log(`${A} and ${B}: the [shared] chrome\n`);

const cssA = rules(styleOf(read(A)));
const cssB = rules(styleOf(read(B)));

for (const block of BLOCKS) {
  const a = slice(cssA, block, A);
  const b = slice(cssB, block, B);
  if (!a || !b) continue;
  const label = block.start === block.end ? block.start : `${block.start} … ${block.end}`;

  if (a.length !== b.length) {
    fail(`${label}: ${A} has ${a.length} rule(s) here, ${B} has ${b.length} — ` +
      `${A}: ${a.map(r => r.selector).join(', ')} / ${B}: ${b.map(r => r.selector).join(', ')}`);
    continue;
  }

  let clean = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].selector !== b[i].selector) {
      fail(`${label}: rule ${i + 1} is ${a[i].selector} in ${A} and ${b[i].selector} in ${B}`);
      clean = false; continue;
    }
    const sel = a[i].selector;
    const da = decls(a[i].body), db = decls(b[i].body);
    const extra = block.extraProps?.[B] || [];
    const dbTrimmed = db.filter(d => !extra.some(p => d.startsWith(`${p}:`)));
    const found = db.filter(d => extra.some(p => d.startsWith(`${p}:`))).length;
    if (extra.length && found !== extra.length) {
      fail(`${sel}: ${B} declares ${found} of the ${extra.length} colours that are its own (${extra.join(', ')})`);
      clean = false;
    }
    const may = block.mayDiffer?.[sel] || [];
    const strip = (list) => list.filter(d => !may.some(p => d.startsWith(`${p}:`)));
    const [xa, xb] = [strip(da), strip(dbTrimmed)];
    for (const p of may) {
      const inA = da.some(d => d.startsWith(`${p}:`)), inB = db.some(d => d.startsWith(`${p}:`));
      if (!inA || !inB) {
        fail(`${sel}: ${p} is allowed to differ, but ${inA ? B : A} does not set it at all`);
        clean = false;
      }
    }
    if (xa.join(' | ') !== xb.join(' | ')) {
      const only = (l, r) => l.filter(d => !r.includes(d));
      fail(`${sel}: ${A} only: [${only(xa, xb).join('; ')}] — ${B} only: [${only(xb, xa).join('; ')}]`);
      clean = false;
    }
  }
  if (clean) {
    const allowed = [
      ...Object.entries(block.mayDiffer || {}).map(([sel, ps]) => `${sel}'s ${ps.join('/')}`),
      ...Object.entries(block.extraProps || {}).map(([f, ps]) => `${f}'s own ${ps.join('/')}`),
    ];
    pass(`${label} — ${a.length} rule(s), identical${allowed.length ? `, apart from ${allowed.join(' and ')}` : ''}`);
  }
}

/* ------------------------------------------------- the ember-seeding script ---
 * The one [shared] block that is not CSS. Compared as text, from the marker to
 * the end of the `prefers-reduced-motion` guard it opens.
 */
function emberScript(src, file) {
  const at = src.indexOf('// [shared]');
  if (at === -1) { fail(`${file}: no [shared] marker in the script`); return null; }
  const from = src.indexOf('\n', at) + 1;
  const end = src.indexOf('\n  }', from);
  if (end === -1) { fail(`${file}: the [shared] script block does not close`); return null; }
  return src.slice(from, end + 4);
}
const ja = emberScript(read(A), A), jb = emberScript(read(B), B);
if (ja && jb) {
  if (ja !== jb) fail(`the ember-seeding loop has drifted:\n--- ${A}\n${ja}\n--- ${B}\n${jb}`);
  else pass(`the ember-seeding loop — ${ja.trim().split('\n').length} lines, byte-identical`);
}

/* ------------------------------------------------------ nothing unaccounted ---
 * A ninth marker in either file means somebody marked a new block as shared and
 * this list never heard about it. `[shared pattern]` is a different marker and
 * deliberately not counted; so is prose that merely mentions "[shared]".
 */
const markers = (file) => (read(file).match(/(\/\*|\/\/)\s*\[shared\]/g) || []).length;
const want = BLOCKS.length + 1; // + the script block
for (const f of [A, B]) {
  const n = markers(f);
  if (n !== want) fail(`${f} carries ${n} [shared] markers and this file pairs up ${want}`);
  else pass(`${f}: ${n} [shared] markers, all of them paired`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nno drift');
process.exit(failures ? 1 : 0);
