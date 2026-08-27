// bootcheck.test.mjs — the boot diagnosis, and the drift alarm between it and
// index.html's inline guard. bootcheck.js promises that the guard's two
// hard-coded sentences are copies of its own, so the parity test at the
// bottom reads the actual file and holds it to that — same bargain as
// theme.test.mjs and the `:root` block, and for the same reason: the one
// failure the guard exists to catch is the one where no module can load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BOOT_FAILURES, diagnose, failureText, probeWebGL } from '../js/bootcheck.js';

test('a page served over http with a context to draw in has nothing to say', () => {
  assert.equal(diagnose({ protocol: 'https:', webgl: true }), null);
  assert.equal(diagnose({ protocol: 'http:', webgl: true }), null);
});

test('a file:// page is the first answer, before anything else is consulted', () => {
  assert.equal(diagnose({ protocol: 'file:' }), 'file-url');
  // Its modules never ran, so a WebGL probe or an error from one cannot have
  // happened — and if something claims otherwise, the protocol still wins.
  assert.equal(diagnose({ protocol: 'file:', webgl: false }), 'file-url');
  assert.equal(diagnose({ protocol: 'file:', error: new Error('boom') }), 'file-url');
});

test('a missing context beats the error it caused', () => {
  assert.equal(diagnose({ protocol: 'https:', webgl: false }), 'no-webgl');
  assert.equal(
    diagnose({ protocol: 'https:', webgl: false, error: new Error('Error creating WebGL context.') }),
    'no-webgl');
});

test('anything else that threw is reported as a crash', () => {
  assert.equal(diagnose({ protocol: 'https:', webgl: true, error: new Error('boom') }), 'crashed');
});

test('an unprobed context is not a missing one', () => {
  // `webgl` absent means "not asked yet", which is not the same as "no".
  assert.equal(diagnose({ protocol: 'https:' }), null);
  assert.equal(diagnose({ protocol: 'https:', webgl: null }), null);
});

test('diagnose survives being handed nothing', () => {
  assert.equal(diagnose(), null);
  assert.equal(diagnose({}), null);
});

test('every failure has all three lines, and they are sentences', () => {
  for (const [code, t] of Object.entries(BOOT_FAILURES)) {
    for (const field of ['title', 'detail', 'remedy']) {
      assert.equal(typeof t[field], 'string', `${code}.${field} should be a string`);
      assert.ok(t[field].length > 20, `${code}.${field} should say something`);
      assert.match(t[field], /[.!]$/, `${code}.${field} should end as a sentence`);
    }
  }
});

test('failureText hands back the record, or null for a code nobody defined', () => {
  assert.equal(failureText('no-webgl'), BOOT_FAILURES['no-webgl']);
  assert.equal(failureText('nonsense'), null);
  assert.equal(failureText(undefined), null);
});

// ---------- the probe ----------

const stubCanvas = (contexts) => () => ({
  getContext: (kind) => contexts[kind] ?? null,
});

test('the probe takes webgl2, or webgl, or neither', () => {
  assert.equal(probeWebGL(stubCanvas({ webgl2: {} })), true);
  assert.equal(probeWebGL(stubCanvas({ webgl: {} })), true);
  assert.equal(probeWebGL(stubCanvas({})), false);
});

test('a context that arrives already lost does not count', () => {
  assert.equal(probeWebGL(stubCanvas({ webgl2: { isContextLost: () => true } })), false);
  assert.equal(probeWebGL(stubCanvas({ webgl2: { isContextLost: () => false } })), true);
});

test('a browser that throws on getContext reads as no WebGL, not as a crash', () => {
  assert.equal(probeWebGL(() => { throw new Error('blocked by policy'); }), false);
  assert.equal(probeWebGL(stubCanvas({ get webgl2() { throw new Error('nope'); } })), false);
});

// ---------- the drift alarm ----------

test("index.html's guard quotes bootcheck.js word for word", async () => {
  const html = await readFile(
    fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const guard = html.match(/<script>\s*\(function \(\)[\s\S]*?\}\(\)\);\s*<\/script>/);
  assert.ok(guard, 'index.html should still carry the inline boot guard');
  const src = guard[0];

  // The guard hard-codes exactly these two — the ones it can reach when no
  // module can load, and the one it shows for anything that throws on the way
  // up. Every other failure is looked up from the module at the call site.
  for (const code of ['file-url', 'crashed']) {
    const t = BOOT_FAILURES[code];
    for (const field of ['title', 'detail', 'remedy']) {
      assert.ok(
        src.includes(t[field]),
        `index.html's guard should carry BOOT_FAILURES['${code}'].${field} verbatim.\n` +
        `  expected: ${t[field]}`);
    }
  }
});

test('the guard disarms itself once the editor exists', async () => {
  const html = await readFile(
    fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  // A boot guard that keeps listening would blank the page over a stray
  // runtime error hours into somebody's drawing session.
  assert.match(html, /if \(window\.app\) return teardown\(\)/);
  // Added capturing (so a module that 404s is seen — that error fires on the
  // <script> element and does not bubble) and therefore removed capturing:
  // removeEventListener only matches a listener registered the same way, so a
  // mismatched pair here would leave the guard armed for the whole session.
  assert.match(html, /addEventListener\('error', onBootError, true\)/);
  assert.match(html, /removeEventListener\('error', onBootError, true\)/);
});

test('the failure surface starts hidden and is the last word on the page', async () => {
  const html = await readFile(
    fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  assert.match(html, /<div id="boot-fail" role="alert" hidden>/);
  // It has to cover the chrome, not sit beside it: a toolbar you can still
  // half-see is a toolbar you will still try to click.
  const css = html.match(/#boot-fail \{([\s\S]*?)\}/)[1];
  assert.match(css, /position: fixed/);
  assert.match(css, /inset: 0/);
});
