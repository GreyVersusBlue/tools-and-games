// flags.mjs — the flag bag, audited as text. No browser.
//
//   node Projects/daredevil/test/flags.mjs
//
// Exits non-zero on any failure (locked decision #13).
//
// Every wiring bug this game has shipped is the same shape: content that
// exists, a route or a guard that does not, and nothing that throws. Two hub
// cards were gated on flags their own scenes never set. `pressAtFair` guarded
// five written lines and was set by nothing in the file — it could only ever
// be the `false` that save.js handed it. `m5Decision` was written by all eight
// Milestone 5 choices and read by nothing, so a headline, a nerve verdict and
// a three-line retrospective keyed to the Earl-picked ending were dead.
//
// A player sees none of that. A run sees none of it. The only thing that sees
// it is a count of who writes each flag against a count of who reads it, which
// is what this is.
//
// This file is not scanned by itself, on purpose (locked decision #262): an
// audit that lives inside a file it reads counts its own inventory back as
// coverage. It reads js/engine.js and js/scenes.js and imports save.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshState } from '../js/save.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(HERE, '..', 'js');

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.error('  FAIL ' + what); }
};

/** Line and block comments out. A comment that names a flag is not a wire —
 *  `fr2Pete01Done` survives only in the comment explaining why it was wrong,
 *  and an audit that reads comments would call that a live read. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The body of the `{...}` that starts at `open` (the index OF the brace). */
function braceBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  throw new Error(`unbalanced braces from index ${open}`);
}

/** Top-level `key:` names of an object-literal body. Nested braces, brackets
 *  and parens are skipped, so `flags:{ a:1, b:{ c:2 } }` yields a and b. */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '[' || c === '(') { depth++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
    if (m && (i === 0 || /[,\s]/.test(body[i - 1]))) { keys.push(m[1]); i += m[0].length - 1; }
  }
  return keys;
}

// money.js joined the scan in Phase 6. It is where `money`, `monthlyOutgo`
// and `hubTakePaid` are read and written, and an audit that does not read it
// reports all three as flags the save seeds and the game ignores — which is
// what it did on the first run of this change. A new module that touches
// GS.flags has to be added here or the audit fails, loudly, by name.
const src = stripComments(
  ['engine.js', 'scenes.js', 'money.js'].map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n\n'));

/* ------------------------------------------------------------------ reads */

const reads = new Set();
for (const m of src.matchAll(/GS\.flags\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
for (const m of src.matchAll(/GS\.flags\[\s*['"]([^'"]+)['"]\s*\]/g)) reads.add(m[1]);

/* ----------------------------------------------------------------- writes */

// Every `flags:` in an effects or statUpdate block. Most are object literals.
// One — Milestone 5's pair of stunt outcomes — is a call to a helper, and the
// audit resolves it off the call site rather than carrying a hardcoded list of
// what that helper writes (locked decision #263). A second helper anywhere
// fails here until it is resolved too, which is the point: an unresolved
// `flags:` is an inventory the audit cannot see.
const writes = new Set();
const unresolved = [];
let plumbing = 0;
for (const m of src.matchAll(/\bflags\s*:\s*/g)) {
  const at = m.index + m[0].length;
  if (src[at] === '{') { topLevelKeys(braceBody(src, at)).forEach(k => writes.add(k)); continue; }
  // `flags: su.flags||{}` — triggerStatUpdate's two callers handing a scene's
  // own bag straight through. Plumbing, not a declaration; the literal it came
  // from was counted at its own site. Two of them, and a third has to be
  // looked at rather than waved past.
  if (/^[\w.]*\.flags\s*\|\|/.test(src.slice(at))) { plumbing++; continue; }
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(at));
  if (!call) { unresolved.push(src.slice(at, at + 40).replace(/\s+/g, ' ')); continue; }
  // `const NAME = args => ({ ... })`, which is the only form in the file.
  const decl = new RegExp(`\\b${call[1]}\\s*=[^=]*?=>\\s*\\(\\s*\\{`).exec(src);
  if (!decl) { unresolved.push(call[1] + '()'); continue; }
  topLevelKeys(braceBody(src, decl.index + decl[0].length - 1)).forEach(k => writes.add(k));
}
// Direct assignment, which is how the engine records something mid-handler.
for (const m of src.matchAll(/GS\.flags\.([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+\+|--|\+=|-=)/g)) writes.add(m[1]);

const defaults = Object.entries(freshState().flags);
const defaultNames = new Set(defaults.map(([k]) => k));

/* ------------------------------------------------------------ assertions */

console.log(`\n  ${reads.size} flags read, ${writes.size} written, ${defaults.length} in the save's defaults\n`);

ok(unresolved.length === 0,
   `every \`flags:\` in the source is an object literal or a resolvable helper (unresolved: ${unresolved.join(' | ') || 'none'})`);
ok(plumbing === 2, `exactly two \`flags:\` sites are pass-through plumbing (found ${plumbing})`);

// 1. A read of a name nothing writes and the save does not seed is a typo or a
//    rename that only half happened.
{
  const orphan = [...reads].filter(f => !writes.has(f) && !defaultNames.has(f)).sort();
  ok(orphan.length === 0, `every flag the game reads is written or seeded (orphans: ${orphan.join(', ') || 'none'})`);
}

// 2. A flag that starts `false` and is written by nothing can only ever be
//    false, so whatever it guards is unreachable. This is what `pressAtFair`
//    was for three rounds. Numbers and nulls are seeds, not guards, and are
//    left alone — `hubEvenings` is 5 and stays 5 by design.
{
  const stuck = defaults.filter(([k, v]) => v === false && !writes.has(k)).map(([k]) => k).sort();
  ok(stuck.length === 0, `no flag defaults to false with nothing able to set it (stuck: ${stuck.join(', ') || 'none'})`);
}

// 3. The other direction. A flag written and never read is a breadcrumb: it
//    costs a save slot and pays nothing, and it is exactly what `m5Decision`
//    was until Phase 2 gave the Earl-picked ending its own outcome. Twenty-seven
//    are left and they are not this row's to spend, so the list is frozen
//    rather than emptied: it can shrink, and a twenty-eighth fails here.
//    `tommyKnowsWhatHeWants` came off it in Phase 4: the Free Roam 3 evening
//    had set it for two phases and nothing read it, and the Free Roam 4 bar
//    scene reads it now.
//    Every entry is checked from both ends (locked decision #264) — a name
//    that has since found a reader fails too, so the list cannot rot.
const WRITE_ONLY = [
  'biographerLater', 'biographerNo', 'biographerYes', 'calStrained', 'calWarmed',
  'dannyChallenge', 'dannyEventOutcome', 'familyOrigin', 'fr2Cal02Done',
  'fr2Danny03Done', 'fr2DannyEventDone', 'fr3CalTalked', 'fr3EarlCalTalked',
  'fr3EarlDeal', 'fr3EarlTalked', 'fr3HollisTalked', 'fr3RuthieTalked',
  'fr3SandraTV', 'fr3TommyTalked', 'm3Complete', 'm4Complete', 'peteGone',
  'peteMistakeResponse', 'ruthieEstablished', 'ruthieStrainSeed',
  'sandraFeatureDone', 'sandraResponse',
];
{
  const actual = [...writes].filter(f => !reads.has(f)).sort();
  const listed = [...WRITE_ONLY].sort();
  const added = actual.filter(f => !listed.includes(f));
  const stale = listed.filter(f => !actual.includes(f));
  ok(added.length === 0, `no new write-only flag (new: ${added.join(', ') || 'none'})`);
  ok(stale.length === 0, `every name on the write-only list is still write-only (stale: ${stale.join(', ') || 'none'})`);
}

// 4. The save's defaults and the game have to agree about what a run carries.
//    A default for a flag nothing reads or writes is a leftover; that is the
//    half of `pressAtFair` that lived in save.js.
{
  const orphanDefaults = [...defaultNames].filter(f => !reads.has(f) && !writes.has(f)).sort();
  ok(orphanDefaults.length === 0,
     `every flag in the save's defaults is read or written by the game (leftovers: ${orphanDefaults.join(', ') || 'none'})`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
