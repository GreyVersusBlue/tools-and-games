// theme.test.mjs — the palette module, and the drift alarm between it and
// the stylesheet: theme.js promises that UI mirrors index.html's :root
// block, so the parity test below reads the actual file and holds it to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UI, INK, normHex, withAlpha, paperTint } from '../js/theme.js';

test('normHex accepts six-digit hex, with or without the hash', () => {
  assert.equal(normHex('#4da3ff'), '#4da3ff');
  assert.equal(normHex('4DA3FF'), '#4da3ff');
  assert.equal(normHex('  #4da3ff  '), '#4da3ff');
});

test('normHex expands three-digit hex', () => {
  assert.equal(normHex('#abc'), '#aabbcc');
  assert.equal(normHex('fff'), '#ffffff');
});

test('normHex rejects what would poison a color buffer', () => {
  assert.equal(normHex(''), null);
  assert.equal(normHex('#12345'), null);
  assert.equal(normHex('#gggggg'), null);
  assert.equal(normHex('rgba(0,0,0,1)'), null);
  assert.equal(normHex(null), null);
  assert.equal(normHex(0x4da3ff), null);
});

test('withAlpha turns hex + alpha into rgba()', () => {
  assert.equal(withAlpha('#4da3ff', 0.25), 'rgba(77,163,255,0.25)');
  assert.equal(withAlpha('#fff', 1), 'rgba(255,255,255,1)');
});

test('withAlpha matches what hex + "40" used to mean', () => {
  // The sheet used to write `r.color + '40'` — hex alpha 0x40 is 64/255.
  assert.equal(withAlpha('#f5d491', 64 / 255), `rgba(245,212,145,${64 / 255})`);
});

test('withAlpha falls back to the neutral grey for a bad color', () => {
  assert.equal(withAlpha('mauve', 0.5), 'rgba(204,204,204,0.5)');
});

test('paperTint defaults to the plan wash, and survives a missing color', () => {
  assert.equal(paperTint('#f5d491'), 'rgba(245,212,145,0.25)');
  assert.equal(paperTint(undefined), 'rgba(204,204,204,0.25)');
});

test('every palette entry is well-formed', () => {
  for (const [k, v] of Object.entries(INK)) {
    assert.ok(normHex(v), `INK.${k} should be a hex color, got ${v}`);
  }
  for (const [k, v] of Object.entries(UI)) {
    if (k === 'panel') continue; // the one rgba() in the set
    assert.ok(normHex(v), `UI.${k} should be a hex color, got ${v}`);
  }
});

test('UI mirrors the :root tokens in index.html', async () => {
  const html = await readFile(
    fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const root = html.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const token = (name) => {
    const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(m, `:root should define --${name}`);
    return m[1].trim();
  };
  assert.equal(token('text'), UI.text);
  assert.equal(token('text-dim'), UI.textDim);
  assert.equal(token('accent'), UI.accent);
  assert.equal(token('ok'), UI.ok);
  assert.equal(token('warn'), UI.warn);
  assert.equal(token('fail'), UI.fail);
  // the panel rgba, spelled with spaces in CSS and without in JS
  assert.equal(token('panel').replace(/\s+/g, ''), UI.panel.replace(/\s+/g, ''));
});
