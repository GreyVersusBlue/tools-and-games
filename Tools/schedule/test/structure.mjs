// structure.mjs — the guard the restructure needed and smoke.mjs cannot give.
//
//   node Tools/schedule/test/structure.mjs
//
// Exits non-zero on any failure (locked decision #13).
//
// Why this exists. schedule-visualizer.html used to be one 863,737-byte file.
// It is now a 124,555-byte shell plus one stylesheet and seven classic scripts
// under schedule/app/. Classic scripts share one global lexical scope, so the
// split works at all; but that same property is what makes it fragile in a way
// no other check here would notice:
//
//   - Two files declaring the same top-level `const` is a load-time
//     SyntaxError in the browser. smoke.mjs would report it as forty broken
//     assertions with no hint at the cause.
//   - The tool runs 130 non-declaration top-level statements, about forty of
//     which are document.getElementById(...).addEventListener(...) that bind
//     at parse time. Reorder the <script src> tags and those move past each
//     other. Some reorderings still pass smoke.
//   - Adding `defer` or `type="module"` to any of those tags changes when they
//     run. `defer` happens to survive; `type="module"` gives every file its own
//     scope and the tool stops existing.
//
// No dependencies. node:vm is the parser, which is enough: parsing the six
// generator modules as one concatenated unit is exactly the check the browser
// performs across sibling classic scripts.
//
// Break it on purpose before trusting it (locked decision #34), four ways:
//   1. add `const AppState = {};` to the top of app/pathfinding.js  -> D fails
//   2. swap the pathfinding and data-model <script src> lines       -> B fails
//   3. add defer to any of the seven tags                           -> B fails
//   4. paste a https://cdn... URL into any app/ file                -> F fails
// Each one currently fails on its own line and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..', '..');
const APP = path.join(TOOLS, 'schedule', 'app');
const HTML = path.join(TOOLS, 'schedule-visualizer.html');

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

/** Load order is source order. This list is the contract. */
const GENERATOR = [
  'data-model.js', 'layout-editor.js', 'schedule-ui.js',
  'pathfinding.js', 'viz-playback.js', 'app-shell.js',
];
const BROWSER = ['browser-template.js'];
const ALL = [...GENERATOR, ...BROWSER];

console.log('schedule visualizer structure\n');

const html = fs.readFileSync(HTML, 'utf8');

/* ── A. every file in the contract exists ──────────────────────────────── */
console.log('files');
for (const f of ALL) {
  ok(fs.existsSync(path.join(APP, f)), `schedule/app/${f} exists`);
}
ok(fs.existsSync(path.join(APP, 'visualizer.css')), 'schedule/app/visualizer.css exists');

/* ── B. the shell loads them, in order, as plain classic scripts ───────── */
console.log('\nscript tags');
const tags = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
const appTags = tags.filter(a => /schedule\/app\//.test(a));
const srcOrder = appTags.map(a => (a.match(/src="schedule\/app\/([^"]+)"/) || [])[1]);

ok(srcOrder.join(',') === ALL.join(','),
   'the seven app scripts load in source order',
   `got: ${srcOrder.join(', ')}`);

ok(appTags.every(a => !/\bdefer\b|\basync\b|type\s*=/.test(a)),
   'no defer, async or type= on any app script',
   'these run at parse time and wire ~40 DOM listeners; changing when they run breaks that');

ok(!/<script>\s*\n\s*\/\*/.test(html) && !/<script>[\s\S]{200,}<\/script>/.test(html),
   'no inline application <script> left in the shell');

/* ── C. the stylesheet moved out and is linked exactly once ────────────── */
console.log('\nstylesheet');
ok(!/<style[\s>]/.test(html), 'no <style> block left in the shell');
const cssLinks = [...html.matchAll(/schedule\/app\/visualizer\.css/g)].length;
ok(cssLinks === 1, 'visualizer.css linked exactly once', `found ${cssLinks}`);
ok(html.indexOf('schedule/fonts/fonts.css') < html.indexOf('schedule/app/visualizer.css'),
   'fonts.css still loads before visualizer.css');

/* ── D. the modules parse, alone and concatenated ──────────────────────── */
// Concatenated is the one that matters. Two files declaring the same top-level
// const parse fine on their own and throw the moment a browser loads both.
console.log('\nparse');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
for (const f of ALL) {
  let err = null;
  try { new vm.Script(read(f), { filename: f }); } catch (e) { err = e.message; }
  ok(!err, `${f} parses`, err || '');
}
let concatErr = null;
try {
  new vm.Script(GENERATOR.map(read).join('\n'), { filename: 'generator-concat' });
} catch (e) { concatErr = e.message; }
ok(!concatErr,
   'the six generator modules parse as one unit (no duplicate top-level names)',
   concatErr || '');

/* ── E. no top-level name is declared in two files ─────────────────────── */
// D already catches this for const/let/class. Function declarations are the
// gap: redeclaring one is legal, silently wins by load order, and is exactly
// how a bad split loses a function.
console.log('\ndeclarations');
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const owner = new Map();
const dupes = [];
for (const f of ALL) {
  for (const line of read(f).split('\n')) {
    const m = DECL.exec(line);          // column 0 only: top level by construction
    if (!m) continue;
    const name = m[1] || m[2] || m[3];
    if (owner.has(name) && owner.get(name) !== f) dupes.push(`${name} (${owner.get(name)} + ${f})`);
    else owner.set(name, f);
  }
}
ok(dupes.length === 0, 'no top-level declaration appears in two files', dupes.join(', '));
console.log(`        (${owner.size} top-level names across ${ALL.length} files)`);

/* ── F. the offsite guarantee still holds in the new files ─────────────── */
// check-integrity.mjs greps every .html in the repo. It does not walk .js, and
// the tool's code now lives in .js.
console.log('\noffsite');
const OFFSITE = /(?:https?:)?\/\/(?!127\.0\.0\.1|localhost)[a-z0-9-]+\.[a-z]{2,}/gi;

// Blank out comments rather than deleting them, so line numbers survive. Only
// /* */ blocks and whole-line // comments, which is every comment style in
// these files: a smarter stripper would have to understand strings, and the
// string it would trip over first is "https://", the exact thing being hunted.
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n');
}

for (const f of [...ALL, 'visualizer.css']) {
  const src = codeOnly(read(f));
  const hits = [];
  for (const m of src.matchAll(OFFSITE)) {
    hits.push(`${f}:${src.slice(0, m.index).split('\n').length} ${m[0]}`);
  }
  ok(hits.length === 0, `${f} references no offsite host`, hits.join('\n        '));
}

/* ── report ────────────────────────────────────────────────────────────── */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
