// The free pick for accent walls (#944). The Wall panel's seventeen swatches
// are shapes.js's ACCENT_PALETTE (#912); under them a colour input and a hex
// field take any other colour. A face has stored a '#rrggbb' for a colour
// outside the palette since #827, so nothing about the file changes: this
// states what is accepted, how it is normalised, where it goes, and that it
// comes back from every way a design leaves the page.
// Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../js/grid.js';
import {
  addShape, ACCENT_PALETTE, accentHex, accentName, sameAccent, readAccentPaint,
  parseAccentHex, accentPick, isNamedAccent, accentInk, accentLuminance, INK_DARK, INK_LIGHT,
  segAccent, setSegAccent,
} from '../js/shapes.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { wallFaceRuns } from '../js/finish.js';
import {
  addWallLine, wallLinesOf, lineAccent, setLineAccent, LINE_LEFT, LINE_RIGHT,
} from '../js/wallrun.js';
import { designDiff } from '../js/designdiff.js';
import { encodeShare, decodeShare } from '../js/share.js';
import { spliceDesign } from '../tools/export-walk.mjs';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const GREY = '#808080';
// Three colours no palette has: one mid, and the two ends.
const MOSS = '#3a7f5c', BLACK = '#000000', WHITE = '#ffffff';

// One grey room, x 4..28 and z 4..20, with a screen in the middle of it from
// (16, 8) to (16, 16): its left face looks west.
function hall() {
  const s = createState(20, 20);
  const room = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
  ], { paint: GREY, name: 'Hall' });
  const line = addWallLine(s, 0, { x: 16, z: 8 }, { x: 16, z: 16 });
  const ring = room.rings[0];
  const west = ring.pts.findIndex((p, i) => p.x === 4 && ring.pts[(i + 1) % ring.pts.length].x === 4);
  return { s, f: s.floors[0], room, ring, west, line };
}
const westFace = (f) => wallFaceRuns(f, 4, 4, 4, 20)[0].right;

// WCAG contrast, written out here and not taken from shapes.js.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// ---------- what is typed ----------

test('six digits or three, with or without the #, any case, spaces round it', () => {
  assert.equal(parseAccentHex('#3a7f5c'), MOSS);
  assert.equal(parseAccentHex('3a7f5c'), MOSS);
  assert.equal(parseAccentHex('#3A7F5C'), MOSS);
  assert.equal(parseAccentHex('  #3a7F5c\n'), MOSS);
  assert.equal(parseAccentHex('#abc'), '#aabbcc');
  assert.equal(parseAccentHex('F0c'), '#ff00cc');
  assert.equal(parseAccentHex('#000'), BLACK);
  assert.equal(parseAccentHex('FFFFFF'), WHITE);
});

test('anything else is refused', () => {
  for (const bad of ['', ' ', '#', '#12', '#1234', '#12345', '#1234567', '#12345678',
    '#3a7f5g', 'moss', 'red', 'rgb(1,2,3)', '##3a7f5c', '#3a7 f5c', '0x3a7f5c',
    'harbor-blue', null, undefined, 0x3a7f5c, {}, []]) {
    assert.equal(parseAccentHex(bad), null, `${JSON.stringify(bad)} is not a colour`);
    assert.equal(accentPick(bad), null);
  }
});

test('a pick that is a palette colour is that colour by id, and any other is its hex', () => {
  for (const c of ACCENT_PALETTE) {
    assert.equal(accentPick(c.hex), c.id);
    assert.equal(accentPick(c.hex.slice(1).toUpperCase()), c.id);
    assert.equal(isNamedAccent(c.id), true);
    assert.equal(isNamedAccent(c.hex), true);
  }
  assert.equal(accentPick('3A7F5C'), MOSS);
  assert.equal(accentPick('#fff'), WHITE);
  assert.equal(isNamedAccent(MOSS), false);
  assert.equal(isNamedAccent(null), false);
  // One step off a palette colour is not that colour.
  assert.equal(accentPick('#2f5d8b'), '#2f5d8b');
  // What the pick gives is what a face stores.
  for (const v of [accentPick('3A7F5C'), accentPick('#000'), accentPick('#2f5d8a')]) {
    assert.equal(readAccentPaint(v), v);
  }
});

test('a custom colour is called by its hex, a palette colour by its name', () => {
  assert.equal(accentName(MOSS), MOSS);
  assert.equal(accentName(BLACK), BLACK);
  assert.equal(accentName(accentPick('#2F5D8A')), 'Harbor Blue');
});

// ---------- where it goes ----------

test('a custom colour is stored on a room and on a free-standing wall as its hex, and painted', () => {
  for (const hex of [MOSS, BLACK, WHITE]) {
    const { f, room, ring, west, line } = hall();
    assert.equal(setSegAccent(room, 0, west, hex), true);
    assert.equal(ring.accents[west], hex);
    assert.equal(segAccent(ring, west), hex);
    assert.equal(westFace(f), hex);
    assert.equal(setLineAccent(line, LINE_LEFT, hex), true);
    assert.deepEqual(line.accents, [hex, null]);
    assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
      { t0: 0, t1: 1, left: hex, right: GREY, body: GREY },
    ]);
    // The same colour again is no change, however it is spelled.
    assert.equal(setSegAccent(room, 0, west, hex.toUpperCase()), false);
    assert.equal(sameAccent(hex, hex.toUpperCase()), true);
  }
});

test('what is not a colour is not stored, and the colour before it stays', () => {
  const { room, ring, west, line } = hall();
  setSegAccent(room, 0, west, MOSS);
  setLineAccent(line, LINE_RIGHT, MOSS);
  for (const bad of ['#12', 'moss', '3a7f5c', '#3a7f5g', '']) {
    assert.equal(setSegAccent(room, 0, west, bad), false);
    assert.equal(setLineAccent(line, LINE_RIGHT, bad), false);
  }
  assert.equal(ring.accents[west], MOSS);
  assert.deepEqual(line.accents, [null, MOSS]);
});

// ---------- the save, the share link and the walk ----------

test('a custom colour goes through the file and comes back as the same bytes', () => {
  const { s, room, west, line } = hall();
  const bare = serialize(s);
  setSegAccent(room, 0, west, MOSS);
  setLineAccent(line, LINE_LEFT, BLACK);
  setLineAccent(line, LINE_RIGHT, WHITE);
  const text = serialize(s);
  assert.equal(SAVE_VERSION, 12, 'no new version');
  assert.equal(JSON.parse(text).version, 12);
  const file = JSON.parse(text).floors[0];
  assert.deepEqual(file.walls[0].accents, [BLACK, WHITE]);
  assert.equal(text.split(`"${MOSS}"`).length - 1, 1);
  const back = deserialize(text);
  assert.equal(serialize(back), text, 'written back as the bytes it was read from');
  const f = back.floors[0];
  assert.equal(westFace(f), MOSS);
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: BLACK, right: WHITE, body: GREY },
  ]);
  assert.equal(lineAccent(wallLinesOf(f)[0], LINE_LEFT), BLACK);
  // Taken off again, the file is the one from before.
  setSegAccent(room, 0, west, null);
  setLineAccent(line, LINE_LEFT, null);
  setLineAccent(line, LINE_RIGHT, null);
  assert.equal(serialize(s), bare);
});

test('a design with no custom colour is written as it was before the pick existed', () => {
  const { s, room, west } = hall();
  const bare = serialize(s);
  assert.equal(/accents/.test(bare), false);
  assert.equal(serialize(deserialize(bare)), bare);
  setSegAccent(room, 0, west, 'plum');
  const named = serialize(s);
  assert.equal(/#[0-9a-f]{6}"\]|"accents":\[[^\]]*#/.test(named), false, 'a named colour is still its id');
  assert.equal(serialize(deserialize(named)), named);
});

test('a hex written in capitals by hand is read, and written back in lower case', () => {
  const { s, room, west } = hall();
  setSegAccent(room, 0, west, MOSS);
  const text = serialize(s);
  const back = deserialize(text.replace(`"${MOSS}"`, '"#3A7F5C"'));
  assert.equal(westFace(back.floors[0]), MOSS);
  assert.equal(serialize(back), text);
});

test('the share link and the exported walk carry a custom colour', async () => {
  const { s, room, west, line } = hall();
  setSegAccent(room, 0, west, MOSS);
  setLineAccent(line, LINE_RIGHT, WHITE);
  const text = serialize(s, { omitOverlay: true });
  const payload = await encodeShare(text);
  assert.equal(await decodeShare(payload), text);
  // The walk: the same payload in the template's slot, read back the way the
  // exported page reads it. The walk paints with finish.js's painter too.
  const exported = spliceDesign(src('walk-template.html'), payload);
  const m = exported.match(/<script id="sg-design" type="text\/plain">([^<]*)<\/script>/);
  assert.ok(m, 'the design rides in its own text script tag');
  const f = deserialize(await decodeShare(m[1])).floors[0];
  assert.equal(westFace(f), MOSS);
  assert.equal(wallFaceRuns(f, 16, 8, 16, 16)[0].right, WHITE);
  // The template has the reader in it, the pick's own code only as far as
  // shapes.js is one module.
  assert.equal(src('walk-template.html').includes('function accentHex('), true);
});

test('the design diff reads a custom colour changed for another as a repaint', () => {
  const { s, room, west } = hall();
  setSegAccent(room, 0, west, MOSS);
  const a = deserialize(serialize(s));
  setSegAccent(room, 0, west, '#3a7f5d');
  const d = designDiff(a, deserialize(serialize(s)));
  assert.equal(d.changes.length, 1);
  assert.deepEqual(d.changes[0].whats, ['had an accent wall repainted']);
  assert.equal(designDiff(a, deserialize(serialize(a))).changes.length, 0);
});

// ---------- ink on a colour that can be anything ----------

test('black wall takes white ink, white wall takes black', () => {
  assert.equal(accentInk(BLACK), INK_LIGHT);
  assert.equal(accentInk(WHITE), INK_DARK);
  assert.equal(INK_LIGHT, '#ffffff');
  assert.equal(INK_DARK, '#000000');
  assert.equal(accentInk('not a colour'), null);
  assert.equal(accentInk(null), null);
  assert.equal(accentLuminance(BLACK), 0);
  assert.equal(accentLuminance(WHITE), 1);
});

test('the ink clears 4.5 to 1 on every colour, and is the better of the two', () => {
  // All 4096 short-form colours, every grey, and the palette.
  const all = [];
  const h = '0123456789abcdef';
  for (const r of h) for (const g of h) for (const b of h) all.push(`#${r}${r}${g}${g}${b}${b}`);
  for (let i = 0; i < 256; i++) all.push(`#${i.toString(16).padStart(2, '0').repeat(3)}`);
  for (const c of ACCENT_PALETTE) all.push(c.hex);
  let worst = Infinity, at = null;
  for (const hex of all) {
    const ink = accentInk(hex);
    const k = contrast(hex, ink);
    const other = contrast(hex, ink === INK_DARK ? INK_LIGHT : INK_DARK);
    assert.ok(k >= other, `${hex}: ${ink} is not the better ink`);
    if (k < worst) { worst = k; at = hex; }
  }
  assert.ok(worst >= 4.5, `${at} has ${worst.toFixed(2)} to 1`);
  // The figure the comment in shapes.js quotes, where the two inks tie.
  assert.equal(worst.toFixed(2), '4.58');
  // By id as well as by hex.
  assert.equal(accentInk('ink'), INK_LIGHT);
  assert.equal(accentInk('goldenrod'), INK_DARK);
});

// ---------- the panel and the brush, by their source ----------
// test/tools/run.mjs's `accent-free` presses them in a browser.

test('the panel has a colour input, a labelled hex field and a place to say no', () => {
  const html = src('index.html');
  assert.match(html, /<input id="accent-color" type="color" value="#808080"\s+aria-label="Accent colour picker"/);
  assert.match(html, /<input id="accent-hex" type="text"[^>]*aria-label="Accent colour as a hex code" aria-describedby="accent-hex-msg"/);
  assert.match(html, /<button id="accent-chip" type="button" aria-pressed="false">/);
  assert.match(html, /<div id="accent-hex-msg" class="readout" role="status" aria-live="polite">/);
  // The swatches come first in the panel, and stay what Tab reaches first.
  assert.ok(html.indexOf('id="accent-swatches"') < html.indexOf('id="accent-custom"'));
  // The chip's colour and its ink change together, with no fade between.
  assert.match(html, /#accent-chip \{[^}]*transition: none;/);
  // A lit swatch is ringed in both inks.
  assert.match(html, /#accent-swatches \.swatch\.active, #accent-chip\.active \{ border-color: #fff; box-shadow: inset 0 0 0 2px #000; \}/);
});

test('the panel writes the chip in the ink for its colour, and the brush outlines its bar in it', () => {
  const main = src('js/main.js');
  assert.match(main, /accentChip\.style\.color = accentInk\(customAccent\);/);
  assert.match(main, /const v = accentPick\(text\);/);
  const editor = src('js/editor.js');
  assert.match(editor, /accentRim\.material\.color\.set\(accentInk\(accentPaint\) \|\| '#000000'\);/);
});
