// The custom colours a school already holds (#961). Since the free pick, a wall can
// be any '#rrggbb', and the Wall panel had no way to get one back but typing
// it again. wallrun.js's `customAccentsOf` is the list the panel's "In this
// school" row shows: this states what is in it, in what order, and that it
// follows the design through paint, erase, undo by snapshot and a file.
// Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, addFloor } from '../js/grid.js';
import { addShape, setSegAccent, ACCENT_PALETTE } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import {
  addWallLine, setLineAccent, customAccentsOf, LINE_LEFT, LINE_RIGHT,
} from '../js/wallrun.js';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const MOSS = '#3a7f5c', BLACK = '#000000', WHITE = '#ffffff', ROSE = '#c08090';

// Two storeys, each one grey room x 4..28 and z 4..20 with a screen down the
// middle of it from (16, 8) to (16, 16).
function school() {
  const s = createState(20, 20);
  addFloor(s);
  const on = (fi) => {
    const room = addShape(s, fi, [
      { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
    ], { paint: '#808080', name: `Hall ${fi}` });
    const line = addWallLine(s, fi, { x: 16, z: 8 }, { x: 16, z: 16 });
    return { room, line };
  };
  return { s, ground: on(0), upper: on(1) };
}

test('a school with no accent, and one with only named colours, has none', () => {
  const { s, ground } = school();
  assert.deepEqual(customAccentsOf(s), []);
  setSegAccent(ground.room, 0, 0, 'harbor-blue');
  setLineAccent(ground.line, LINE_LEFT, 'spruce');
  assert.deepEqual(customAccentsOf(s), []);
});

test('a palette colour held as its hex, as a file from before the ids has it, is not custom', () => {
  const { s, ground } = school();
  for (const [i, c] of ACCENT_PALETTE.slice(0, 4).entries()) setSegAccent(ground.room, 0, i, c.hex);
  setLineAccent(ground.line, LINE_RIGHT, ACCENT_PALETTE[16].hex);
  assert.deepEqual(customAccentsOf(s), []);
});

test('a room face and a free-standing wall face each count, on every storey', () => {
  const { s, ground, upper } = school();
  setSegAccent(ground.room, 0, 1, MOSS);
  assert.deepEqual(customAccentsOf(s), [MOSS]);
  setLineAccent(upper.line, LINE_RIGHT, ROSE);
  assert.deepEqual(customAccentsOf(s), [MOSS, ROSE]);
  setLineAccent(ground.line, LINE_LEFT, WHITE);
  setSegAccent(upper.room, 0, 3, BLACK);
  assert.deepEqual(customAccentsOf(s), [BLACK, MOSS, ROSE, WHITE]);
  // The storey being looked at does not change what the school holds.
  s.currentFloor = 1;
  assert.deepEqual(customAccentsOf(s), [BLACK, MOSS, ROSE, WHITE]);
});

test('each colour once, however many faces wear it and whatever case the file has', () => {
  const { s, ground, upper } = school();
  setSegAccent(ground.room, 0, 0, MOSS);
  setSegAccent(ground.room, 0, 2, MOSS);
  setSegAccent(upper.room, 0, 1, MOSS);
  setLineAccent(ground.line, LINE_LEFT, MOSS);
  setLineAccent(ground.line, LINE_RIGHT, MOSS);
  // Hand-edited: upper case is read as the same paint.
  upper.line.accents = ['#3A7F5C', null];
  assert.deepEqual(customAccentsOf(s), [MOSS]);
});

test('hex order, whichever was painted first and wherever it is', () => {
  const a = school(), b = school();
  setSegAccent(a.ground.room, 0, 0, ROSE);
  setLineAccent(a.upper.line, LINE_LEFT, MOSS);
  setSegAccent(a.upper.room, 0, 2, '#0a0a0a');
  setLineAccent(b.ground.line, LINE_RIGHT, '#0a0a0a');
  setSegAccent(b.upper.room, 0, 1, MOSS);
  setSegAccent(b.ground.room, 0, 3, ROSE);
  assert.deepEqual(customAccentsOf(a.s), ['#0a0a0a', MOSS, ROSE]);
  assert.deepEqual(customAccentsOf(b.s), customAccentsOf(a.s));
});

test('the list follows the school: the last face of a colour taken off takes it out', () => {
  const { s, ground } = school();
  setSegAccent(ground.room, 0, 0, MOSS);
  setLineAccent(ground.line, LINE_LEFT, MOSS);
  setSegAccent(ground.room, 0, 1, ROSE);
  setSegAccent(ground.room, 0, 0, null);
  assert.deepEqual(customAccentsOf(s), [MOSS, ROSE], 'the screen still wears it');
  setLineAccent(ground.line, LINE_LEFT, null);
  assert.deepEqual(customAccentsOf(s), [ROSE]);
  // Repainted in a named colour: gone from the list.
  setSegAccent(ground.room, 0, 1, 'plum');
  assert.deepEqual(customAccentsOf(s), []);
});

test('it comes back from a file, and an undo by snapshot puts it where it was', () => {
  const { s, ground, upper } = school();
  const bare = serialize(s);
  setSegAccent(ground.room, 0, 1, MOSS);
  setLineAccent(upper.line, LINE_RIGHT, ROSE);
  const painted = serialize(s);
  assert.deepEqual(customAccentsOf(deserialize(painted)), [MOSS, ROSE]);
  assert.deepEqual(customAccentsOf(deserialize(bare)), []);
  // Reading the list changes nothing.
  assert.equal(serialize(s), painted);
});

test('what is not a colour is not listed, and a broken school is an empty list', () => {
  const { s, ground } = school();
  ground.room.rings[0].accents = [null, 'moss', '#12', 7, MOSS, '#3a7f5c80'];
  ground.line.accents = ['', { hex: ROSE }];
  assert.deepEqual(customAccentsOf(s), [MOSS]);
  for (const bad of [null, undefined, {}, { floors: null }, { floors: [null, {}, { shapes: [{}], walls: [null] }] }]) {
    assert.deepEqual(customAccentsOf(bad), []);
  }
});

// ---------- the panel, by its source ----------
// test/tools/run.mjs's `accent-free` paints a wall and presses the swatch.

test('the row sits between the palette and the free pick, labelled, and hidden until there is one', () => {
  const html = src('index.html');
  assert.match(html, /<div id="accent-used-row" class="hidden">\s*<label id="accent-used-label">In this school<\/label>\s*<div id="accent-used" role="group" aria-labelledby="accent-used-label"><\/div>/);
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('accent-swatches') < at('accent-used') && at('accent-used') < at('accent-custom'));
});

test('the panel reads the list on every edit and every replaced design, and a swatch arms its hex', () => {
  const main = src('js/main.js');
  assert.match(main, /const used = customAccentsOf\(state\);/);
  assert.match(main, /editor\.setAccentPaint\(sameAccent\(editor\.accentPaint, hex\) \? undefined : hex\);/);
  // designChanged (edit, undo, redo), adoptState (new, load) and the swatches' own repaint.
  assert.equal(main.match(/if \(editor\.tool === 'wall'\) renderAccentUsed\(\);/g).length, 2);
  assert.match(main, /renderAccentCustom\(\);\n  renderAccentUsed\(\);\n\}/);
});
