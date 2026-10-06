// The accent palette (#912). shapes.js's ACCENT_PALETTE is the one list of
// accent colours: seventeen, each with an id a design stores, a name a
// designer would say, and a hex. The first eight are the hexes the brush
// stored before the palette had ids. A face holds an id, or a hex from an
// older file, never a place in the list.
// Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../js/grid.js';
import {
  addShape, ACCENT_PALETTE, accentHex, accentName, sameAccent, readAccentPaint,
  segAccent, setSegAccent, accentSpans, accentBreaks, insertVertex,
} from '../js/shapes.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { wallFaceRuns, DEFAULT_PAINT } from '../js/finish.js';
import {
  addWallLine, wallLinesOf, lineAccent, setLineAccent, LINE_LEFT, LINE_RIGHT,
} from '../js/wallrun.js';
import { designDiff } from '../js/designdiff.js';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const GREY = '#808080';

// The eight the Wall panel offered before #912, as `ACCENT_PAINTS` in main.js
// had them at d0f5c1a. A design saved then holds these strings.
const BEFORE = ['#2f5d8a', '#3f7d6b', '#8fb8a8', '#d9a441', '#c2573a', '#a33b45', '#7a4e8a', '#4a4f57'];

// One grey room, x 4..28 and z 4..20, with a screen in the middle of it from
// (16, 8) to (16, 16): its left face looks west.
function hall() {
  const s = createState(20, 20);
  const room = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
  ], { paint: GREY, name: 'Hall' });
  const line = addWallLine(s, 0, { x: 16, z: 8 }, { x: 16, z: 16 });
  // The room's own wall along x = 4.
  const ring = room.rings[0];
  const west = ring.pts.findIndex((p, i) => p.x === 4 && ring.pts[(i + 1) % ring.pts.length].x === 4);
  return { s, f: s.floors[0], room, ring, west, line };
}
// The room's face of its west wall, whichever way the ring runs it.
const westFace = (f) => {
  // Going +z the room is on the right; the left face is the weather's (null).
  const runs = wallFaceRuns(f, 4, 4, 4, 20);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].left, null);
  return runs[0].right;
};

// ---------- colour arithmetic, for the figures below ----------
//
// sRGB to linear light, Machado, Oliveira and Fernandes (2009) at severity 1
// for the three dichromacies, and OKLab (Ottosson 2020) for distance, times
// 100 so that about 2 is a difference a viewer can just see.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const VIEWS = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const clamp = (v) => Math.min(1, Math.max(0, v));
const seen = (c, m) => (m ? m.map((r) => clamp(r[0] * c[0] + r[1] * c[1] + r[2] * c[2])) : c);
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const dist = (a, b, m) => {
  const p = oklab(seen(rgb(a), m)), q = oklab(seen(rgb(b), m));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
// The least of the four views, and which one it was.
const worst = (a, b) => Object.entries(VIEWS)
  .map(([view, m]) => ({ view, d: dist(a, b, m) }))
  .sort((x, y) => x.d - y.d)[0];

// The room paints, read out of main.js so this cannot drift from the panel.
function roomPaints() {
  const m = /const PAINTS = \[null,([^\]]+)\]/.exec(src('js/main.js'));
  assert.ok(m, 'main.js still has the room paints as `const PAINTS = [null, ...]`');
  return m[1].match(/#[0-9a-f]{6}/g);
}

// ---------- the list ----------

test('seventeen colours, each with an id, a name and a hex of its own', () => {
  assert.equal(ACCENT_PALETTE.length, 17);
  for (const c of ACCENT_PALETTE) {
    assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, `${c.id} is a lower-case word or words`);
    assert.match(c.hex, /^#[0-9a-f]{6}$/, `${c.id} is a lower-case hex`);
    assert.match(c.name, /^[A-Z][a-z]+( [A-Z][a-z]+)*$/, `${c.id} has a name`);
  }
  for (const key of ['id', 'name', 'hex']) {
    assert.equal(new Set(ACCENT_PALETTE.map((c) => c[key])).size, 17, `no two share a ${key}`);
  }
  // An id is never a hex and never a number, so it cannot be mistaken for
  // either in a file.
  for (const c of ACCENT_PALETTE) assert.equal(/^#|^\d/.test(c.id), false);
});

test('the list cannot be edited from outside', () => {
  assert.throws(() => { ACCENT_PALETTE.push({ id: 'x', name: 'X', hex: '#000000' }); }, TypeError);
  assert.throws(() => { ACCENT_PALETTE[0].hex = '#000000'; }, TypeError);
});

test('the eight colours from before are the first eight, value for value', () => {
  assert.deepEqual(ACCENT_PALETTE.slice(0, 8).map((c) => c.hex), BEFORE);
});

test('an id means the colour it was given: every one, pinned', () => {
  // Adding a colour adds a line here. Changing one of these moves a wall in
  // somebody's saved school.
  assert.deepEqual(Object.fromEntries(ACCENT_PALETTE.map((c) => [c.id, c.hex])), {
    'harbor-blue': '#2f5d8a', spruce: '#3f7d6b', seafoam: '#8fb8a8', goldenrod: '#d9a441',
    terracotta: '#c2573a', cranberry: '#a33b45', plum: '#7a4e8a', charcoal: '#4a4f57',
    ink: '#23262b', periwinkle: '#8088d8', pumpkin: '#d9772b', aubergine: '#4b2f55',
    'warm-gray': '#9a958c', brick: '#8a3324', oxblood: '#6b2633', steel: '#70808f',
    indigo: '#3d3a7a',
  });
});

// ---------- the figures ----------

test('to normal sight no two colours are closer than 6.8', () => {
  let least = { d: Infinity };
  ACCENT_PALETTE.forEach((a, i) => ACCENT_PALETTE.slice(i + 1).forEach((b) => {
    const d = dist(a.hex, b.hex, null);
    if (d < least.d) least = { d, pair: `${a.id}/${b.id}` };
  }));
  assert.equal(least.pair, 'cranberry/brick');
  assert.equal(least.d.toFixed(2), '6.80');
});

test('a new colour is at least 5.4 from every other in all four views', () => {
  // Normal sight, protanopia, deuteranopia, tritanopia. 5.4 is the closest
  // pair there is: Charcoal and Indigo, to a tritanope.
  let least = { d: Infinity };
  ACCENT_PALETTE.slice(8).forEach((a) => ACCENT_PALETTE.forEach((b) => {
    if (a === b) return;
    const w = worst(a.hex, b.hex);
    assert.ok(w.d >= 5.4, `${a.id} and ${b.id} are ${w.d.toFixed(2)} apart to a ${w.view}`);
    if (w.d < least.d) least = { ...w, pair: `${b.id}/${a.id}` };
  }));
  assert.equal(`${least.pair} ${least.view} ${least.d.toFixed(2)}`, 'charcoal/indigo tritan 5.45');
});

test('the old eight are not all told apart by colour alone, and the figure says which', () => {
  // They cannot move (a saved school holds them), so this is on the record
  // instead of fixed: to a protanope Harbor Blue and Plum are 1.19 apart,
  // under the 2 a viewer can see. The swatch's name is what tells them apart.
  const close = [];
  ACCENT_PALETTE.slice(0, 8).forEach((a, i) => ACCENT_PALETTE.slice(i + 1, 8).forEach((b) => {
    const w = worst(a.hex, b.hex);
    if (w.d < 5.4) close.push(`${a.id}/${b.id} ${w.view} ${w.d.toFixed(2)}`);
  }));
  assert.deepEqual(close, ['harbor-blue/plum protan 1.19', 'cranberry/charcoal protan 3.42']);
});

test('every colour stands off every room paint by 11 or more in all four views', () => {
  const rooms = [DEFAULT_PAINT, ...roomPaints()];
  assert.equal(rooms.length, 9, 'the default and the eight room paints');
  let least = { d: Infinity };
  for (const c of ACCENT_PALETTE) {
    for (const r of rooms) {
      const w = worst(c.hex, r);
      assert.ok(w.d >= 11, `${c.id} on ${r} is ${w.d.toFixed(2)} to a ${w.view}`);
      if (w.d < least.d) least = { ...w, id: c.id };
    }
  }
  assert.equal(`${least.id} ${least.d.toFixed(1)}`, 'seafoam 11.1');
});

test('contrast against the default wall paint runs from 1.92 to 13.34', () => {
  const by = ACCENT_PALETTE.map((c) => ({ id: c.id, k: contrast(c.hex, DEFAULT_PAINT) }))
    .sort((a, b) => a.k - b.k);
  assert.equal(`${by[0].id} ${by[0].k.toFixed(2)}`, 'seafoam 1.92');
  assert.equal(`${by.at(-1).id} ${by.at(-1).k.toFixed(2)}`, 'ink 13.34');
  // No new colour is paler against the wall than the palest old one.
  for (const c of ACCENT_PALETTE.slice(8)) {
    assert.ok(contrast(c.hex, DEFAULT_PAINT) >= 1.92, `${c.id} is too pale to read as an accent`);
  }
});

// ---------- what a face stores ----------

test('a face stores the id it was given, and reads as that colour', () => {
  for (const c of ACCENT_PALETTE) {
    const { room, ring, west, line } = hall();
    assert.equal(setSegAccent(room, 0, west, c.id), true);
    assert.equal(ring.accents[west], c.id, 'the id, not the hex and not a number');
    assert.equal(segAccent(ring, west), c.id);
    assert.equal(accentHex(segAccent(ring, west)), c.hex);
    assert.equal(setLineAccent(line, LINE_RIGHT, c.id), true);
    assert.deepEqual(line.accents, [null, c.id]);
    assert.equal(accentHex(lineAccent(line, LINE_RIGHT)), c.hex);
  }
});

test('a hex is still stored as the hex it is, and a name nobody has is refused', () => {
  const { room, ring, west, line } = hall();
  assert.equal(setSegAccent(room, 0, west, '#00AA00'), true);
  assert.equal(ring.accents[west], '#00aa00');
  assert.equal(accentHex('#00AA00'), '#00aa00');
  assert.equal(accentName('#00aa00'), '#00aa00', 'a colour the palette never had is called by its hex');
  for (const bad of ['teal', 'Harbor Blue', 'HARBOR-BLUE', '0', 0, 3, '#0a0', '', {}]) {
    assert.equal(readAccentPaint(bad), null, `${JSON.stringify(bad)} is not an accent`);
    assert.equal(accentHex(bad), null);
    assert.equal(setSegAccent(room, 0, west, bad), false);
    assert.equal(setLineAccent(line, LINE_LEFT, bad), false);
  }
  assert.equal(ring.accents[west], '#00aa00', 'and a bad one is not a way to take one off');
  assert.equal('accents' in line, false);
});

test('a name is said by id and by hex alike', () => {
  for (const c of ACCENT_PALETTE) {
    assert.equal(accentName(c.id), c.name);
    assert.equal(accentName(c.hex), c.name);
    assert.equal(accentName(c.hex.toUpperCase()), c.name);
  }
  assert.equal(accentName(null), null);
});

test('an old hex and its id are the same paint: setting one over the other changes nothing', () => {
  const { room, ring, west, line } = hall();
  assert.equal(sameAccent('#2f5d8a', 'harbor-blue'), true);
  assert.equal(sameAccent('#2f5d8a', 'plum'), false);
  assert.equal(sameAccent(null, null), true);
  assert.equal(sameAccent('harbor-blue', null), false);
  setSegAccent(room, 0, west, '#2f5d8a');
  assert.equal(setSegAccent(room, 0, west, 'harbor-blue'), false);
  assert.equal(ring.accents[west], '#2f5d8a', 'the file keeps what it had');
  setLineAccent(line, LINE_LEFT, '#7a4e8a');
  assert.equal(setLineAccent(line, LINE_LEFT, 'plum'), false);
  assert.deepEqual(line.accents, ['#7a4e8a', null]);
  assert.equal(setLineAccent(line, LINE_LEFT, 'spruce'), true);
  assert.deepEqual(line.accents, ['spruce', null]);
});

// ---------- the save ----------

test('an id goes through the file as the id, on a room and on a free-standing wall', () => {
  const { s, room, west, line } = hall();
  const bare = serialize(s);
  setSegAccent(room, 0, west, 'pumpkin');
  setLineAccent(line, LINE_LEFT, 'indigo');
  setLineAccent(line, LINE_RIGHT, 'steel');
  const text = serialize(s);
  assert.equal(SAVE_VERSION, 12, 'no new version');
  assert.equal(JSON.parse(text).version, 12);
  const file = JSON.parse(text).floors[0];
  assert.deepEqual(file.walls[0].accents, ['indigo', 'steel']);
  assert.equal(JSON.stringify(file).includes('"pumpkin"'), true);
  for (const c of ACCENT_PALETTE) {
    assert.equal(text.includes(c.hex), false, `no hex is written for a palette colour (${c.id})`);
  }
  const back = deserialize(text);
  assert.equal(serialize(back), text, 'written back as the bytes it was read from');
  const f = back.floors[0];
  assert.equal(westFace(f), '#d9772b');
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: '#3d3a7a', right: '#70808f', body: GREY },
  ]);
  // Taken off again, the file is the one from before.
  setSegAccent(room, 0, west, null);
  setLineAccent(line, LINE_LEFT, null);
  setLineAccent(line, LINE_RIGHT, null);
  assert.equal(serialize(s), bare);
});

test('a save holding one of the old hexes loads, shows that colour, and is written back as it was', () => {
  for (const hex of BEFORE) {
    const { s, room, west, line } = hall();
    setSegAccent(room, 0, west, hex);
    setLineAccent(line, LINE_RIGHT, hex);
    const old = serialize(s);
    assert.equal(old.split(`"${hex}"`).length - 1, 2, 'the file a build before #912 wrote');
    const back = deserialize(old);
    const f = back.floors[0];
    assert.equal(westFace(f), hex);
    assert.equal(wallFaceRuns(f, 16, 8, 16, 16)[0].right, hex);
    assert.equal(lineAccent(wallLinesOf(f)[0], LINE_RIGHT), hex, 'still the hex in memory');
    assert.equal(serialize(back), old, 'byte for byte');
  }
});

test('a name this build does not know is read as no accent', () => {
  const { s, room, west, line } = hall();
  const bare = serialize(s);
  setSegAccent(room, 0, west, 'brick');
  setLineAccent(line, LINE_LEFT, 'brick');
  const text = serialize(s).replaceAll('"brick"', '"chartreuse"');
  const back = deserialize(text);
  assert.equal(westFace(back.floors[0]), GREY);
  assert.equal(serialize(back), bare, 'and the key goes with it');
});

// ---------- the readers ----------

test('the painter gives the hex for every colour, on a room wall and on each face of a screen', () => {
  for (const c of ACCENT_PALETTE) {
    const { f, room, west, line } = hall();
    setSegAccent(room, 0, west, c.id);
    assert.equal(westFace(f), c.hex);
    setLineAccent(line, LINE_LEFT, c.id);
    assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
      { t0: 0, t1: 1, left: c.hex, right: GREY, body: GREY },
    ]);
    setLineAccent(line, LINE_LEFT, null);
    setLineAccent(line, LINE_RIGHT, c.id);
    assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
      { t0: 0, t1: 1, left: GREY, right: c.hex, body: GREY },
    ]);
  }
});

test('the design diff reads an old hex and its id as one paint, and two ids as a repaint', () => {
  const { s, room, west, line } = hall();
  setSegAccent(room, 0, west, '#2f5d8a');
  setLineAccent(line, LINE_LEFT, '#a33b45');
  const hexed = deserialize(serialize(s));
  // The same walls, said by id.
  setSegAccent(room, 0, west, null); setSegAccent(room, 0, west, 'harbor-blue');
  setLineAccent(line, LINE_LEFT, null); setLineAccent(line, LINE_LEFT, 'cranberry');
  const named = deserialize(serialize(s));
  assert.notEqual(serialize(hexed), serialize(named));
  assert.equal(designDiff(hexed, named).changes.length, 0);
  // The room's wall repainted.
  setSegAccent(room, 0, west, 'plum');
  const d = designDiff(named, deserialize(serialize(s)));
  assert.equal(d.changes.length, 1);
  assert.deepEqual(d.changes[0].whats, ['had an accent wall repainted']);
  // The screen's face repainted.
  const plum = deserialize(serialize(s));
  setLineAccent(line, LINE_LEFT, 'oxblood');
  const e = designDiff(plum, deserialize(serialize(s)));
  assert.equal(e.changes.length, 1);
  assert.equal(e.changes[0].kind, 'wall');
});

test('an accent keeps its id through a split wall, and a hex beside its own id is no break', () => {
  const { room, ring, west } = hall();
  setSegAccent(room, 0, west, 'periwinkle');
  const [a, b] = [ring.pts[west], ring.pts[(west + 1) % ring.pts.length]];
  assert.equal((a.z + b.z) / 2, 12);
  assert.notEqual(insertVertex(room, 0, west, 4, 12), -1);
  assert.deepEqual(accentSpans(room).map((sp) => sp.paint), ['periwinkle', 'periwinkle']);
  assert.equal(accentBreaks(room).filter((k) => k.x === 4 && k.z === 12).length, 0);
  // One half said as a hex of the same colour: still one wall of one colour.
  const i = ring.accents.indexOf('periwinkle');
  ring.accents[i] = '#8088d8';
  assert.equal(accentBreaks(room).filter((k) => k.x === 4 && k.z === 12).length, 0);
  // A different colour there is a break.
  ring.accents[i] = 'steel';
  assert.equal(accentBreaks(room).filter((k) => k.x === 4 && k.z === 12).length, 1);
});

// ---------- one place ----------

test('no file but shapes.js writes a palette colour down as an accent', () => {
  // The panel, the brush, the painter, the diff and the wall line each import
  // what they need; none keeps a list of its own.
  const main = src('js/main.js');
  assert.match(main, /const ACCENT_PAINTS = \[null, \.\.\.ACCENT_PALETTE\];/);
  for (const file of ['js/main.js', 'js/editor.js', 'js/finish.js', 'js/designdiff.js',
    'js/wallrun.js', 'js/paint.js', 'js/polyedit.js', 'js/render.js', 'index.html']) {
    const text = src(file);
    for (const c of ACCENT_PALETTE) {
      assert.equal(text.includes(c.hex), false, `${file} has ${c.id}'s hex in it`);
    }
  }
});

test('the panel makes a named button a colour, and the brush takes the id', () => {
  const main = src('js/main.js');
  assert.match(main, /b\.dataset\.accent = id \|\| '';/);
  assert.match(main, /b\.setAttribute\('aria-label', c \? `Accent paint \$\{c\.name\}` : 'Remove accent'\);/);
  assert.match(main, /editor\.setAccentPaint\(editor\.accentPaint === id \? undefined : id\);/);
  const editor = src('js/editor.js');
  assert.match(editor, /: \(readAccentPaint\(v\) \|\| undefined\);/);
  // The armed brush says the colour's name, and so does the paint.
  assert.match(editor, /`Accent, \$\{accentName\(accentPaint\)\} —`/);
  assert.match(editor, /say\(accentPaint === undefined \? HINT_WALL : accentHint\(\)\);/);
  // Said by name on a room's wall and on a free-standing one: both lines.
  assert.equal(editor.match(/painted \$\{accentName\(paint\)\}\./g).length, 2);
  assert.equal(/painted \$\{paint\}/.test(editor), false);
});

test('the walk-through carries the palette', () => {
  const walk = src('walk-template.html');
  for (const c of ACCENT_PALETTE) {
    assert.equal(walk.includes(c.hex), true, `the template has ${c.id}`);
  }
});
