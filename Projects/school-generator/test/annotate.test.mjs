// Dimensions and notes. Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// The one rule of the module — the number on a dimension is derived from the
// geometry it points at, never typed — is what most of these pin: move an
// anchor and the label follows, and there is no field anywhere a stale number
// could survive in. The chain is checked against a room the tools actually
// produce (drawn on a scratch lattice and baked, like every fixture since
// Phase 12), because a jamb the chain and the collider disagree about is the
// kind of bug only real openings find.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { boxRoom } from './build.mjs';
import { shapesOf, segEnds, addOpening } from '../js/shapes.js';
import {
  addDim, removeDim, addNote, removeNote, dimsOf, notesOf,
  dimLabel, dimLength, dimGeometry, dimAt, noteAt,
  setDimOffset, moveNote, setNoteText, noteText,
  chainStations, chainDims, sheetDims, stackDims,
  normalizeDims, normalizeNotes,
  MAX_DIMS, MAX_NOTES, MAX_DIM_OFF, MAX_NOTE_TEXT, MIN_DIM_LEN, DIM_OFF,
} from '../js/annotate.js';
import { serialize, deserialize } from '../js/save-load.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// ---------- the label ----------

test('a length prints as feet and inches, to the nearest inch', () => {
  assert.equal(dimLabel(24), `24'-0"`);
  assert.equal(dimLabel(24.5), `24'-6"`);
  assert.equal(dimLabel(2 / 3), '8"');
  assert.equal(dimLabel(0), '0"');
});

test('eleven and a half inches carries to the next foot, not to 12"', () => {
  // 10ft 11.96in — rounds to 12 inches, which is not an inch count a drawing
  // may print.
  assert.equal(dimLabel(10 + 11.96 / 12), `11'-0"`);
  assert.equal(dimLabel(0.999), `1'-0"`);
});

// ---------- the record ----------

test('a dimension goes on the storey and the last one takes the key with it', () => {
  const s = createState();
  const dim = addDim(s, 0, { x: 0, z: 0 }, { x: 24, z: 0 }, 5);
  assert.ok(dim);
  assert.ok(dim.id > 0, 'a dimension has an id like everything else');
  assert.equal(dimsOf(s.floors[0]).length, 1);
  assert.ok(removeDim(s, 0, dim.id));
  assert.ok(!('dims' in s.floors[0]), 'the empty list removes its own key');
});

test('two anchors on top of each other are refused', () => {
  const s = createState();
  assert.equal(addDim(s, 0, { x: 5, z: 5 }, { x: 5, z: 5 + MIN_DIM_LEN / 2 }), null);
  assert.ok(!('dims' in s.floors[0]));
});

test('the offset clamps to what a sheet can hold', () => {
  const s = createState();
  const dim = addDim(s, 0, { x: 0, z: 0 }, { x: 10, z: 0 }, 1e6);
  assert.equal(dim.off, MAX_DIM_OFF);
  setDimOffset(dim, -1e6);
  assert.equal(dim.off, -MAX_DIM_OFF);
});

test('a note keeps its sentence, trimmed and capped, and never an empty one', () => {
  const s = createState();
  const note = addNote(s, 0, { x: 4, z: 4 }, 10, 6, '  align with the column  ');
  assert.equal(note.text, 'align with the column');
  setNoteText(note, 'x'.repeat(MAX_NOTE_TEXT + 50));
  assert.equal(note.text.length, MAX_NOTE_TEXT);
  assert.equal(noteText('   '), 'Note');
  assert.ok(removeNote(s, 0, note.id));
  assert.ok(!('notes' in s.floors[0]));
});

// ---------- the geometry ----------

test('the drawn parts of a horizontal dimension', () => {
  const g = dimGeometry({ ax: 0, az: 0, bx: 24, bz: 0, off: 5 });
  assert.equal(g.label, `24'-0"`);
  near(g.len, 24, 1e-9, 'measured length');
  // The left normal of a +x run points +z, so the line stands at z = 5.
  near(g.la.z, 5, 1e-9, 'line height a');
  near(g.lb.z, 5, 1e-9, 'line height b');
  near(g.la.x, 0, 1e-9, 'line end a');
  near(g.lb.x, 24, 1e-9, 'line end b');
  near(g.mid.x, 12, 1e-9, 'text midpoint');
  // The extension line leaves a gap at the anchor and overshoots the line.
  const [e0, e1] = g.ext[0];
  assert.ok(e0.z > 0 && e0.z < 1, 'gap at the anchor');
  assert.ok(e1.z > 5, 'overshoot past the line');
  assert.equal(g.ext.length, 2);
  assert.equal(g.ticks.length, 2);
});

test('a negative offset stands the line on the other side', () => {
  const g = dimGeometry({ ax: 0, az: 0, bx: 24, bz: 0, off: -5 });
  near(g.la.z, -5, 1e-9, 'line on the right of the run');
  assert.ok(g.ext[0][0].z < 0, 'extension gap on the same side');
  assert.ok(g.tn.z < 0, 'text side follows');
});

test('the number is derived: move an anchor and the label follows', () => {
  const dim = { ax: 0, az: 0, bx: 24, bz: 0, off: 5 };
  assert.equal(dimGeometry(dim).label, `24'-0"`);
  dim.bx = 32.5;
  assert.equal(dimGeometry(dim).label, `32'-6"`);
  // There is no stored text to go stale — the record is five numbers.
  assert.ok(!('label' in dim) && !('text' in dim));
});

// ---------- finding one ----------

test('a dimension is picked by its drawn line, not its anchors', () => {
  const s = createState();
  const dim = addDim(s, 0, { x: 0, z: 0 }, { x: 24, z: 0 }, 5);
  const f = s.floors[0];
  assert.equal(dimAt(f, 12, 5, 2), dim, 'the line is clickable');
  assert.equal(dimAt(f, 12, 0, 2), null, 'the anchor run is not the line');
});

test('a note answers at its text spot and at its anchor, and drags by the text', () => {
  const s = createState();
  const note = addNote(s, 0, { x: 4, z: 4 }, 12, 8, 'here');
  const f = s.floors[0];
  assert.equal(noteAt(f, 12, 8, 2), note);
  assert.equal(noteAt(f, 4, 4, 2), note);
  assert.equal(noteAt(f, 30, 30, 2), null);
  assert.ok(moveNote(note, 20, 10));
  assert.equal(noteAt(f, 20, 10, 2), note);
  near(note.x, 4, 1e-9, 'the anchor never moves with the text');
});

// ---------- the chain ----------

test('stations break a run at every jamb', () => {
  const st = chainStations(24, [{ t: 0.5, w: 4 }]);
  assert.deepEqual(st, [0, 10, 14, 24]);
});

test('a chain dimensions piers and openings end to end', () => {
  const s = createState();
  const dims = chainDims(s, 0, { x: 0, z: 0 }, { x: 24, z: 0 }, [{ t: 0.5, w: 4 }], 5);
  assert.equal(dims.length, 3);
  const lens = dims.map(dimLength);
  near(lens[0], 10, 1e-9, 'first pier');
  near(lens[1], 4, 1e-9, 'the opening, jamb to jamb');
  near(lens[2], 10, 1e-9, 'second pier');
  near(lens.reduce((a, b) => a + b, 0), 24, 1e-9, 'the chain sums to the run');
});

test('a wall with no openings chains to its one overall dimension', () => {
  const s = createState();
  const dims = chainDims(s, 0, { x: 0, z: 0 }, { x: 0, z: 16 }, [], -5);
  assert.equal(dims.length, 1);
  near(dimLength(dims[0]), 16, 1e-9, 'end to end');
});

test('the chain reads a baked room the way the collider does', () => {
  // The state the tools actually produce: a 24ft wall with a real doorway cut
  // into it, drawn on a scratch lattice and baked.
  const s = createState(30, 30);
  const shape = boxRoom(s, 0, 0, 0, 5, 3, { name: 'Hall' });
  const ring = shape.rings[0];
  // The room's north wall runs along z = 0. Find it and cut a 3ft door at
  // its middle.
  let seg = -1;
  for (let i = 0; i < ring.pts.length; i++) {
    const [a, b] = segEnds(ring, i);
    if (Math.abs(a.z) < 1e-6 && Math.abs(b.z) < 1e-6) { seg = i; break; }
  }
  assert.ok(seg >= 0, 'found the north wall');
  const [a, b] = segEnds(ring, seg);
  addOpening(shape, 0, seg, 0.5, 3);
  const openings = ring.openings.filter((o) => o.seg === seg);
  const dims = chainDims(s, 0, a, b, openings, 5);
  assert.equal(dims.length, 3);
  const total = dims.reduce((n, d) => n + dimLength(d), 0);
  near(total, Math.hypot(b.x - a.x, b.z - a.z), 1e-6, 'jambs account for the whole run');
});

// ---------- the vertical sheets ----------

test('an elevation takes only the dimensions parallel to its plane', () => {
  const s = createState();
  addDim(s, 0, { x: 0, z: 20 }, { x: 24, z: 20 }, 5);    // parallel to a south facade
  addDim(s, 0, { x: 0, z: 0 }, { x: 20, z: 15 }, 5);     // oblique — foreshortened
  // The south facade's u axis is +x (elevation.js).
  const dims = sheetDims(s.floors[0], (x) => x);
  assert.equal(dims.length, 1, 'the oblique one stays on the plan');
  near(dims[0].u0, 0, 1e-9, 'left');
  near(dims[0].u1, 24, 1e-9, 'right');
  assert.equal(dims[0].label, `24'-0"`, 'the same number the plan prints');
});

test('overlapping strings stack into rows; disjoint ones share one', () => {
  const rows = stackDims([
    { u0: 0, u1: 10 },
    { u0: 4, u1: 14 },
    { u0: 20, u1: 30 },
  ]);
  const byLeft = rows.slice().sort((p, q) => p.u0 - q.u0);
  assert.equal(byLeft[0].row, 0);
  assert.equal(byLeft[1].row, 1, 'the overlap moves down a row');
  assert.equal(byLeft[2].row, 0, 'clear of the first — same row again');
});

// ---------- the loader's half ----------

test('normalize keeps the good records and drops the rest, quietly', () => {
  const dims = normalizeDims([
    { ax: 0, az: 0, bx: 24, bz: 0, off: 5 },
    { ax: 0, az: 0, bx: 0.01, bz: 0 },              // too short
    { ax: 'x', az: 0, bx: 24, bz: 0 },              // not numbers
    { ax: 0, az: 0, bx: 1e9, bz: 0 },               // off the sheet
    null,
    { ax: 0, az: 0, bx: 10, bz: 0, off: 1e9 },      // hostile offset
  ]);
  assert.equal(dims.length, 2);
  assert.equal(dims[1].off, MAX_DIM_OFF, 'the offset clamps rather than rejects');

  const notes = normalizeNotes([
    { x: 4, z: 4, tx: 10, tz: 6, text: 'ok' },
    { x: 'x', z: 4 },
    { x: 4, z: 4, tx: 1e9, tz: 6, text: 'runaway leader' },
    { x: 4, z: 4 },                                  // no sentence
  ]);
  assert.equal(notes.length, 3);
  near(notes[1].tx, 4, 1e-9, 'a runaway leader lands back on its anchor');
  assert.equal(notes[2].text, 'Note');
});

test('the caps hold', () => {
  const many = Array.from({ length: MAX_DIMS + 50 }, (_, i) => (
    { ax: 0, az: i, bx: 10, bz: i }));
  assert.equal(normalizeDims(many).length, MAX_DIMS);
  const s = createState();
  for (let i = 0; i < MAX_NOTES + 5; i++) addNote(s, 0, { x: 1, z: i }, 2, i, 'n');
  assert.equal(notesOf(s.floors[0]).length, MAX_NOTES);
});

// ---------- the file ----------

test('annotations survive a save round trip', () => {
  const s = createState();
  boxRoom(s, 0, 0, 0, 5, 3, { name: 'Hall' });
  const dim = addDim(s, 0, { x: 0, z: 0 }, { x: 24, z: 0 }, 5);
  const note = addNote(s, 0, { x: 4, z: 4 }, 12, 8, 'align with the column');
  const back = deserialize(serialize(s));
  const f = back.floors[0];
  assert.equal(dimsOf(f).length, 1);
  assert.equal(notesOf(f).length, 1);
  near(dimsOf(f)[0].ax, dim.ax, 1e-9, 'anchor a');
  near(dimsOf(f)[0].off, 5, 1e-9, 'offset');
  assert.equal(notesOf(f)[0].text, note.text);
  assert.equal(dimsOf(f)[0].id, dim.id, 'ids from the file win');
});

test('a design with no annotations writes neither key', () => {
  const s = createState();
  boxRoom(s, 0, 0, 0, 5, 3, { name: 'Hall' });
  const json = serialize(s);
  assert.ok(!json.includes('"dims"'));
  assert.ok(!json.includes('"notes"'));
  // ...including one that was annotated and then cleaned. (`nextId` moves —
  // an id was taken and given back, same as drawing and erasing a wall — so
  // the comparison is field-for-field rather than byte-for-byte.)
  const dim = addDim(s, 0, { x: 0, z: 0 }, { x: 24, z: 0 });
  removeDim(s, 0, dim.id);
  const cleaned = JSON.parse(serialize(s));
  const before = JSON.parse(json);
  delete cleaned.nextId;
  delete before.nextId;
  assert.deepEqual(cleaned, before, 'annotate-then-clean writes the same design');
});

test('a file whose annotations have no ids gets fresh ones off the shared counter', () => {
  const s = createState();
  boxRoom(s, 0, 0, 0, 5, 3, { name: 'Hall' });
  const d = JSON.parse(serialize(s));
  d.floors[0].dims = [{ ax: 0, az: 0, bx: 10, bz: 0 }];
  d.floors[0].notes = [{ x: 2, z: 2, text: 'n' }];
  const back = deserialize(JSON.stringify(d));
  const ids = new Set();
  for (const sh of shapesOf(back.floors[0])) ids.add(sh.id);
  const dimId = dimsOf(back.floors[0])[0].id;
  const noteId = notesOf(back.floors[0])[0].id;
  assert.ok(dimId > 0 && noteId > 0, 'both got ids');
  assert.ok(!ids.has(dimId) && !ids.has(noteId) && dimId !== noteId,
    'no collision with anything else in the file');
});
