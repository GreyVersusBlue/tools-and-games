// tests/wiring.mjs — the wiring audit, run by a machine instead of a person.
// Phase 8.
//
// Round 2 of this project's review mapped every data-action in the page
// against both suites by hand and found ten player-facing actions no test
// had ever clicked, plus the whole change/input family with no coverage at
// all. Round 3 re-ran the same grep after round 2 declared it closed and
// found cancelMove. That audit is a person with grep, it has to be re-run
// by hand forever, and the two rounds prove it does not survive being
// skipped once.
//
// So this file is that grep. It reads js/ui.js and js/main.js as text and
// answers three questions:
//
//   1. Does every action the page emits have somewhere to land — a case in
//      handleAction, or a branch on the delegated change listener?
//   2. Does every case and every change branch have something that emits
//      it? A case nothing can reach is dead code that reads as a feature.
//   3. Is every one of them exercised by tests/smoke.mjs or by
//      Tools/board-check/play-games.mjs?
//
// **Why this is its own file and not a Section of smoke.mjs.** Question 3
// reads the suites as text and looks for each action's name in them. A
// scanner that lives inside one of the files it scans satisfies itself:
// every name it looks for is written down in its own source, so every
// action would come back covered and the check would be worth nothing.
// That is #34's re-implementation trap exactly. This file reads smoke.mjs
// and play-games.mjs and never itself.
//
// Tools/board-check/play-games.mjs is read-only here. Nothing under Tools/
// is edited by this project.
//
// Run with `node tests/wiring.mjs`; `npm test` runs it after the other
// three suites.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const siteRoot = path.join(root, '..', '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// Comments are prose, not wiring. Section 22's own header lists ten action
// names in a sentence and clicks none of them there; counting that as
// coverage would hand this file the exact false pass it exists to prevent.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

function read(rel, from = root) {
  const full = path.join(from, rel);
  if (!fs.existsSync(full)) {
    console.error(`FAIL: ${rel} is not where this audit expects it (${full}) — the audit cannot run at all`);
    process.exit(1);
  }
  return fs.readFileSync(full, 'utf8');
}

const SOURCES = {
  'js/ui.js': stripComments(read('js/ui.js')),
  'js/main.js': stripComments(read('js/main.js')),
};
const SUITES = {
  'tests/smoke.mjs': stripComments(read('tests/smoke.mjs')),
  'Tools/board-check/play-games.mjs': stripComments(read(path.join('Tools', 'board-check', 'play-games.mjs'), siteRoot)),
};

// The stripper is doing real work on real files, so prove it did not eat
// the thing every question below is asked about. A regex that quietly
// returned '' would make every "for each emitted action" loop below pass
// by having nothing to loop over.
assert(SOURCES['js/ui.js'].includes('data-action="autoFillStalls"'),
  'the comment stripper left js/ui.js’s markup intact');
assert(SOURCES['js/main.js'].includes("case 'openGates':"),
  'the comment stripper left js/main.js’s handleAction intact');
assert(SUITES['tests/smoke.mjs'].includes('data-action="autoFillStalls"'),
  'the comment stripper left smoke.mjs’s selectors intact');
assert(SUITES['Tools/board-check/play-games.mjs'].includes('data-action="openGates"'),
  'the comment stripper left play-games.mjs’s selectors intact');

// ---------------------------------------------------------------------
// What the page emits
// ---------------------------------------------------------------------

// The straightforward half: a literal in the markup.
const emitted = new Map(); // name -> where it was found
for (const [file, src] of Object.entries(SOURCES)) {
  for (const m of src.matchAll(/data-action="([A-Za-z][\w]*)"/g)) {
    if (!emitted.has(m[1])) emitted.set(m[1], file);
  }
}

// The awkward half: ui.js builds the three contract buttons through one
// helper and interpolates the action name into the markup, so `contract`,
// `contractCrew` and `hireVendor` appear nowhere as literals. A hardcoded
// list of the three would be this file lying about what it read, so the
// name is resolved from the source: find the function the interpolation
// sits in, work out which parameter it is, and read that argument off
// every call site. An interpolation this cannot resolve fails by name
// rather than being skipped, because a skipped emitter is exactly the
// blind spot the whole file is about.

// Every `function name(params) {` in a file, with the byte range of its body.
function functionRanges(src) {
  const out = [];
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
    const bodyStart = m.index + m[0].length - 1;
    let depth = 0, end = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    out.push({ name: m[1], params: m[2].split(',').map(s => s.trim()).filter(Boolean), start: m.index, bodyStart, end: end === -1 ? src.length : end });
  }
  return out;
}

// Split an argument list at top level, so a nested call or an object does
// not get cut in half at its own commas.
function splitArgs(text) {
  const args = [];
  let depth = 0, quote = null, current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      current += c;
      if (c === '\\') { current += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; current += c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// The argument list that follows `name(` at index i, by brace matching.
function callArgsAt(src, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return splitArgs(src.slice(openParen + 1, i)); }
  }
  return null;
}

let interpolationSites = 0;
for (const [file, src] of Object.entries(SOURCES)) {
  const fns = functionRanges(src);
  for (const m of src.matchAll(/data-action="\$\{([A-Za-z_$][\w$]*)\}"/g)) {
    interpolationSites++;
    const ident = m[1];
    // Innermost enclosing function.
    const owner = fns
      .filter(f => m.index > f.bodyStart && m.index < f.end)
      .sort((a, b) => (b.end - b.bodyStart) - (a.end - a.bodyStart))
      .pop();
    if (!owner) {
      assert(false, `${file} interpolates data-action="\${${ident}}" outside any named function, so this audit cannot resolve what it emits`);
      continue;
    }
    const argIndex = owner.params.indexOf(ident);
    if (argIndex === -1) {
      assert(false, `${file}'s ${owner.name}() interpolates data-action="\${${ident}}" but ${ident} is not one of its parameters, so this audit cannot resolve what it emits`);
      continue;
    }
    const found = [];
    for (const [callFile, callSrc] of Object.entries(SOURCES)) {
      for (const call of callSrc.matchAll(new RegExp(`(?<![\\w$.])${owner.name}\\s*\\(`, 'g'))) {
        if (callFile === file && call.index === owner.start) continue; // the declaration
        if (callSrc.slice(Math.max(0, call.index - 9), call.index).includes('function')) continue;
        const args = callArgsAt(callSrc, call.index + call[0].length - 1);
        const arg = args && args[argIndex];
        const literal = arg && /^'([A-Za-z][\w]*)'$|^"([A-Za-z][\w]*)"$/.exec(arg);
        if (!literal) {
          assert(false, `${callFile} calls ${owner.name}() with ${arg === undefined ? 'no' : `a non-literal (${arg})`} action argument, so this audit cannot tell which data-action that call emits`);
          continue;
        }
        const name = literal[1] || literal[2];
        found.push(name);
        if (!emitted.has(name)) emitted.set(name, `${file} via ${owner.name}(), called from ${callFile}`);
      }
    }
    assert(found.length > 0,
      `${file}'s ${owner.name}() interpolates a data-action but nothing calls it, so the buttons it builds are unreachable`);
  }
}

assert(interpolationSites === 1,
  `js/ui.js and js/main.js hold exactly one interpolated data-action (found ${interpolationSites}) — each one is a hole in a literal scan and has to be resolved by name above`);
// Named rather than counted, because a resolver that silently stopped
// reading call sites and a fourth call site that emits something new both
// land here, and the three names say which.
assert(emitted.has('contractCrew') && emitted.has('contract') && emitted.has('hireVendor'),
  `the interpolated contract buttons still resolve to contract, contractCrew and hireVendor (got: ${[...emitted.keys()].filter(n => /^(contract|contractCrew|hireVendor)$/.test(n)).join(', ') || 'none of the three'})`);

// ---------------------------------------------------------------------
// What the page handles
// ---------------------------------------------------------------------

const mainSrc = SOURCES['js/main.js'];

function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(bodyStart, i); }
  }
  return null;
}

const handleActionBody = bodyOf(mainSrc, 'function handleAction(');
assert(!!handleActionBody, 'js/main.js still has a handleAction() to read — this audit is scoped to it by name');

const clickHandled = new Set(
  [...(handleActionBody || '').matchAll(/case\s+'([A-Za-z][\w]*)'\s*:/g)].map(m => m[1]));

const wireBody = bodyOf(mainSrc, 'function wire(');
assert(!!wireBody, 'js/main.js still has a wire() to read');
const changeHandled = new Set(
  [...(wireBody || '').matchAll(/dataset\.action\s*===\s*'([A-Za-z][\w]*)'/g)].map(m => m[1]));

// The other event path's other half: an input the change listener matches
// by element id rather than by action, which no data-action scan can see.
const idHandled = new Set(
  [...(wireBody || '').matchAll(/target\.id\s*[!=]==\s*'([A-Za-z][\w]*)'/g)].map(m => m[1]));

const handled = new Set([...clickHandled, ...changeHandled]);

// Vacuity guards. Every check below is a loop over one of these sets, and
// a regex that matched nothing would make all of them pass in silence.
assert(clickHandled.size >= 30, `handleAction still answers a switch of real size (${clickHandled.size} cases read)`);
assert(emitted.size >= 30, `the markup still emits a real number of actions (${emitted.size} read)`);
assert(changeHandled.has('schedule') && changeHandled.has('assignVendor') && changeHandled.has('offerTerm'),
  `the delegated change listener’s three action branches were read (${[...changeHandled].join(', ')})`);
assert(idHandled.has('ticketPrice'),
  `the change listener’s id-matched inputs were read (${[...idHandled].join(', ') || 'none'})`);

// ---------------------------------------------------------------------
// Question 1 and 2: the two sets agree
// ---------------------------------------------------------------------

for (const [name, where] of emitted) {
  assert(handled.has(name),
    `data-action="${name}" is emitted by ${where} and nothing answers it — no case in handleAction and no branch on the change listener, so clicking it does nothing at all`);
}
for (const name of clickHandled) {
  assert(emitted.has(name),
    `handleAction has a case for '${name}' and nothing in js/ui.js or js/main.js emits data-action="${name}" — dead code that reads as a working feature`);
}
for (const name of changeHandled) {
  assert(emitted.has(name),
    `the change listener has a branch for '${name}' and nothing emits data-action="${name}" — dead code that reads as a working feature`);
}
for (const name of idHandled) {
  assert(SOURCES['js/ui.js'].includes(`id="${name}"`),
    `the change listener matches on element id '${name}' and js/ui.js never renders id="${name}" — that input can never fire`);
}

// ---------------------------------------------------------------------
// Question 3: every one of them is exercised
//
// The signature of a click in either suite is the selector: the suites
// reach a button by [data-action="name"]. Two actions are reached another
// way for a reason, and those reasons are written down here rather than
// counted off in a percentage (#13: a check that only prints gets
// ignored, and a coverage number is a check that only prints).
//
// Every entry is checked three ways: the name is a real action, the
// selector it names really appears in the suite it names, and the entry
// is still *needed* — an action that has since been reached by its own
// data-action selector fails here until its entry is deleted, so this
// list can only shrink on its own.
// ---------------------------------------------------------------------

const ALTERNATES = {
  placeAt: {
    via: '.plot-marker.ghost',
    suites: ['tests/smoke.mjs', 'Tools/board-check/play-games.mjs'],
    why: 'a ghost cell is picked by the coordinates it carries, not by its action — both suites click .plot-marker.ghost[data-x][data-y] because which cell was placed on is the whole assertion',
  },
  offerTerm: {
    via: 'select[data-term=',
    suites: ['tests/smoke.mjs'],
    why: 'the two negotiation <select>s are told apart by data-term (commitDays against cancelFeeMult), which is what Section 26 dispatches change on; the shared data-action is the listener’s business, not the test’s',
  },
};

// Actions one suite covers and the other does not, on purpose. Asserted
// both ways so a note cannot outlive its reason.
const ONE_SUITE_ONLY = {
  commitAll: {
    suite: 'Tools/board-check/play-games.mjs',
    absentFrom: 'tests/smoke.mjs',
    why: 'the commit banner is a whole-grounds action worth one click on a real browser and a fixture-shaped detour in jsdom; smoke.mjs commits through State.commitAllPlots directly and play-games.mjs does the clicking',
  },
};

const selectorFor = name => `data-action="${name}"`;
const directlyIn = name => Object.entries(SUITES).filter(([, src]) => src.includes(selectorFor(name))).map(([f]) => f);

// Over what the page emits, not over emitted-plus-handled: a case with
// nothing emitting it is already reported by name above, and asking
// whether a suite clicks a button that does not exist produces a second
// failure whose sentence is false (#147).
for (const name of [...emitted.keys()].sort()) {
  const direct = directlyIn(name);
  const alt = ALTERNATES[name];
  if (direct.length > 0) {
    assert(true, `${name} is clicked by name in ${direct.join(' and ')}`);
    continue;
  }
  if (alt) {
    const hits = alt.suites.filter(s => SUITES[s].includes(alt.via));
    assert(hits.length > 0,
      `${name} is exercised through ${alt.via} per its allowlist entry, but that selector appears in none of ${alt.suites.join(', ')} — either the coverage went away or the entry is stale`);
    continue;
  }
  assert(false,
    `data-action="${name}" is emitted by ${emitted.get(name)} and neither tests/smoke.mjs nor Tools/board-check/play-games.mjs ever reaches it — a player-facing action no test has clicked`);
}

for (const name of idHandled) {
  const hits = Object.entries(SUITES).filter(([, src]) => src.includes(`#${name}`)).map(([f]) => f);
  assert(hits.length > 0,
    `the change listener's '${name}' input is reached by no suite — #${name} appears in neither tests/smoke.mjs nor Tools/board-check/play-games.mjs, and the change/input path is a different event path from every click`);
}

// --- the allowlist audits itself ---
for (const [name, entry] of Object.entries(ALTERNATES)) {
  assert(emitted.has(name) || handled.has(name),
    `the alternate-selector allowlist names '${name}', which is not an action this page has any more — delete the entry`);
  assert(!!entry.why && entry.why.length > 20,
    `the allowlist entry for '${name}' carries a reason, not just a name`);
  assert(directlyIn(name).length === 0,
    `'${name}' is now clicked by [data-action="${name}"] in ${directlyIn(name).join(' and ')}, so its alternate-selector entry is dead weight — delete it`);
  for (const suite of entry.suites) {
    assert(Object.prototype.hasOwnProperty.call(SUITES, suite),
      `the allowlist entry for '${name}' names a suite this audit does not read (${suite})`);
  }
}

for (const [name, entry] of Object.entries(ONE_SUITE_ONLY)) {
  assert(emitted.has(name) || handled.has(name),
    `the one-suite-only list names '${name}', which is not an action this page has any more — delete the entry`);
  assert(!!entry.why && entry.why.length > 20,
    `the one-suite-only entry for '${name}' carries a reason, not just a name`);
  assert(SUITES[entry.suite].includes(selectorFor(name)),
    `'${name}' is recorded as covered only by ${entry.suite}, and that suite no longer clicks it`);
  assert(!SUITES[entry.absentFrom].includes(selectorFor(name)),
    `'${name}' is recorded as absent from ${entry.absentFrom}, and it is there now — the note is stale, delete it`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
