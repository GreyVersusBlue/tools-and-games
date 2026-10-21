// The free pick remembers (#962). The Wall panel's custom colour is tool
// state: it started every visit at mid grey and a colour used the day before
// was typed again. It is kept now, in a localStorage key of its own and not in
// the school. This states what is read back from that key, and that nothing
// of it reaches a design however the design leaves the page.
// Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../js/grid.js';
import { addShape, setSegAccent, keptCustomAccent, ACCENT_PALETTE } from '../js/shapes.js';
import { serialize, SAVE_VERSION } from '../js/save-load.js';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const MOSS = '#3a7f5c';

test('a kept hex comes back as the colour, normalised as a typed one is', () => {
  assert.equal(keptCustomAccent(MOSS), MOSS);
  assert.equal(keptCustomAccent('#3A7F5C'), MOSS);
  assert.equal(keptCustomAccent('3a7f5c'), MOSS);
  assert.equal(keptCustomAccent('#000000'), '#000000');
  assert.equal(keptCustomAccent('#fff'), '#ffffff');
});

test('nothing kept, or something that is not a colour, is no colour', () => {
  for (const bad of [null, undefined, '', 'null', 'undefined', '{}', '"#3a7f5c"', '#3a7f5', '#3a7f5c80',
    'moss', 'harbor-blue', 0x3a7f5c, {}, []]) {
    assert.equal(keptCustomAccent(bad), null, `${JSON.stringify(bad)} should not come back`);
  }
});

test('a palette colour is never the custom one, by any of the seventeen hexes', () => {
  for (const c of ACCENT_PALETTE) {
    assert.equal(keptCustomAccent(c.hex), null, c.name);
    assert.equal(keptCustomAccent(c.hex.toUpperCase()), null, c.name);
  }
});

// ---------- where it is kept, by the page's source ----------
// test/tools/run.mjs's `accent-free` opens a second page and reads the field.

test('the page reads its own key once, through the rule above, and falls back to mid grey', () => {
  const main = src('js/main.js');
  assert.match(main, /const ACCENT_KEY = 'sg-accent-custom';\nlet customAccent = '#808080';\ntry \{ customAccent = keptCustomAccent\(localStorage\.getItem\(ACCENT_KEY\)\) \|\| customAccent; \} catch \{/);
});

test('every change of the custom colour goes through the one function that keeps it', () => {
  const main = src('js/main.js');
  assert.match(main, /function keepCustomAccent\(hex\) \{\n  if \(hex === customAccent\) return;\n  customAccent = hex;\n  try \{ localStorage\.setItem\(ACCENT_KEY, hex\); \} catch \{/);
  // Typed or picked, and armed from a swatch of the school's own colours.
  assert.match(main, /\} else \{\n    keepCustomAccent\(v\);/);
  assert.match(main, /if \(on\) keepCustomAccent\(accentHex\(editor\.accentPaint\)\);/);
  // Nowhere else is it assigned: the declaration, the read, and the keeper.
  assert.equal(main.match(/\bcustomAccent = /g).length, 3);
});

test('the key is the page\'s and not the school\'s: no module that writes a design names it', () => {
  for (const name of ['js/save-load.js', 'js/filestore.js', 'js/share.js', 'js/snapshots.js', 'js/cloud.js', 'tools/export-walk.mjs']) {
    assert.ok(!src(name).includes('sg-accent-custom'), name);
  }
  // And the autosave's own key is a different one, untouched.
  assert.match(src('js/save-load.js'), /school-generator-autosave-v1/);
});

test('a design holds its walls\' colours and nothing of the tool', () => {
  const s = createState(20, 20);
  const room = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
  ], { paint: '#808080', name: 'Hall' });
  const bare = JSON.parse(serialize(s));
  setSegAccent(room, 0, 0, MOSS);
  const painted = JSON.parse(serialize(s));
  assert.equal(SAVE_VERSION, 12);
  assert.equal(painted.version, bare.version);
  assert.deepEqual(Object.keys(painted).sort(), Object.keys(bare).sort());
  assert.ok(!Object.keys(painted).some((k) => /accent|custom|tool/i.test(k)), Object.keys(painted).join());
});
