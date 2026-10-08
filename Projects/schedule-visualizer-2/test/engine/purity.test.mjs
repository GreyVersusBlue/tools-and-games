// The engine line (ARCHITECTURE 3): everything under engine/ imports only
// other engine/ modules and uses no DOM, no storage, no timers, no clock and
// no randomness of its own. Time and randomness are passed in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine');

const FORBIDDEN = [
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['navigator', /\bnavigator\b/],
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['fetch', /\bfetch\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date() with no argument', /\bnew\s+Date\s*(\(\s*\)|(?!\s*\())/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['crypto.getRandomValues', /\bgetRandomValues\b/],
  ['crypto.randomUUID', /\brandomUUID\b/],
];

// crypto.subtle is allowed in one module only.
const SUBTLE_ALLOWED = new Set(['publish-crypto.js']);

// The source with its comments blanked out. Strings are kept, so a forbidden
// name inside a string is still a hit: the rule is "outside a comment".
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] === undefined ? '' : source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
    } else if (two === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
    } else {
      if (ch === '"' || ch === '\'' || ch === '`') quote = ch;
      out += ch;
      i += 1;
    }
  }
  return out;
}

function hits(source) {
  const code = stripComments(source);
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

function imports(source) {
  const code = stripComments(source);
  const found = [];
  for (const match of code.matchAll(/^\s*(?:import|export)\b[^;'"]*\bfrom\s*(['"])([^'"]+)\1/gm)) found.push(match[2]);
  for (const match of code.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)) found.push(match[2]);
  for (const match of code.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) found.push(match[2]);
  return found;
}

const files = readdirSync(ENGINE_DIR).filter((file) => file.endsWith('.js')).sort();

test('the scanner sees each forbidden name in code and in a string, and not in a comment', () => {
  assert.deepEqual(hits('const t = Date.now();'), ['Date.now']);
  assert.deepEqual(hits('const t = new Date();'), ['new Date() with no argument']);
  assert.deepEqual(hits('const t = new Date;'), ['new Date() with no argument']);
  assert.deepEqual(hits('const t = new Date(value);'), []);
  assert.deepEqual(hits('const r = Math.random();'), ['Math.random']);
  assert.deepEqual(hits('setTimeout(run, 5);'), ['setTimeout']);
  assert.deepEqual(hits('const d = document.body;'), ['document']);
  assert.deepEqual(hits('const s = "open the window";'), ['window']);
  assert.deepEqual(hits('// Date.now() and Math.random() are named here only\nconst a = 1; /* document */'), []);
  assert.deepEqual(hits('const url = "http://example.invalid/x"; const t = Date.now();'), ['Date.now']);
});

test('there are engine modules to check', () => {
  assert.ok(files.length >= 10, 'expected the engine modules, found ' + files.length);
});

for (const file of files) {
  const source = readFileSync(path.join(ENGINE_DIR, file), 'utf8');

  test(file + ' uses no DOM, storage, timer, clock or randomness of its own', () => {
    assert.deepEqual(hits(source), [], file + ' names something the engine may not use');
  });

  test(file + ' imports only other engine modules', () => {
    for (const specifier of imports(source)) {
      assert.match(specifier, /^\.\/[a-z0-9-]+\.js$/, file + ' imports ' + specifier);
    }
  });

  test(file + (SUBTLE_ALLOWED.has(file) ? ' may use crypto.subtle' : ' does not use crypto.subtle'), () => {
    if (SUBTLE_ALLOWED.has(file)) return;
    assert.doesNotMatch(stripComments(source), /\bcrypto\b/, file + ' names crypto');
  });
}

// The modules a published file carries are joined by a linker that reads
// only simple forms (ARCHITECTURE 8). Three of them are written in this unit.
for (const file of ['schema.js', 'day-types.js', 'bells.js']) {
  test(file + ' keeps to the linker rule', () => {
    const code = stripComments(readFileSync(path.join(ENGINE_DIR, file), 'utf8'));
    for (const line of code.split('\n')) {
      if (/^\s*import\b/.test(line)) assert.match(line, /^import \{ [A-Za-z0-9_$, ]+ \} from '\.\/[a-z0-9-]+\.js';$/, file + ': ' + line);
      if (/^\s*export\b/.test(line)) assert.match(line, /^export (async function|function|const|let|class) /, file + ': ' + line);
    }
    assert.doesNotMatch(code, /\bimport\s*\(/, file + ' has a dynamic import');
    assert.doesNotMatch(code, /import\.meta/, file + ' uses import.meta');
    assert.doesNotMatch(code, /<\/script/i, file + ' holds a closing script tag');
  });
}
